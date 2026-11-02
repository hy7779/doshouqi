// ============================================================
// 斗兽棋规则引擎
// 浏览器（index.html）与 Node 对局服务（game-host.mjs）共用这一份规则，
// 不包含任何 DOM、网络或计时器代码。
// ============================================================

export const GEO = {
  cols: 7, rows: 9,
  rivers: [[2, 4, 3, 6], [5, 4, 6, 6]],
  dens:   { red: { x: 4, y: 9 }, blue: { x: 4, y: 1 } },
  traps:  { red:  [{ x: 3, y: 9 }, { x: 5, y: 9 }, { x: 4, y: 8 }],
            blue: [{ x: 3, y: 1 }, { x: 5, y: 1 }, { x: 4, y: 2 }] }
};

export const PIECE_NAME = { 1: '鼠', 2: '猫', 3: '狗', 4: '狼', 5: '豹', 6: '虎', 7: '狮', 8: '象' };
export const SIDE_NAME  = { red: '红方', blue: '蓝方' };

export const OTHER  = s => s === 'red' ? 'blue' : 'red';
export const inside = (x, y) => x >= 1 && x <= GEO.cols && y >= 1 && y <= GEO.rows;
export const isRiver = (x, y) => GEO.rivers.some(([x1, y1, x2, y2]) =>
  x >= x1 && x <= x2 && y >= y1 && y <= y2);
export const isTrap = (x, y, side) => GEO.traps[side].some(t => t.x === x && t.y === y);
export const isDen  = (x, y, side) => GEO.dens[side].x === x && GEO.dens[side].y === y;

export const pieceAt = (st, x, y) =>
  st.pieces.find(p => p.alive !== false && p.x === x && p.y === y) || null;

export const alivePieces = (st, side) =>
  st.pieces.filter(p => p.alive !== false && (side === undefined || p.side === side));

// ====== 能不能吃 ======
export function canCapture(a, d, tx, ty) {
  if (!d || a.side === d.side) return false;
  if (isTrap(tx, ty, OTHER(d.side))) return true;
  if (isRiver(d.x, d.y) && a.rank !== 1) return false;
  if (isRiver(a.x, a.y) && !isRiver(tx, ty)) return false;
  if (a.rank === 1 && d.rank === 8) return true;
  if (a.rank === 8 && d.rank === 1) return false;
  return a.rank >= d.rank;
}

// ====== 走法 ======
function between(a, x2, y2) {
  const cells = [];
  if (a.y === y2) {
    const step = x2 > a.x ? 1 : -1;
    for (let x = a.x + step; x !== x2; x += step) cells.push({ x, y: a.y });
  } else if (a.x === x2) {
    const step = y2 > a.y ? 1 : -1;
    for (let y = a.y + step; y !== y2; y += step) cells.push({ x: a.x, y });
  } else {
    return null;
  }
  return cells;
}

function canJump(st, p, x, y) {
  if (p.rank !== 6 && p.rank !== 7) return false;
  const cells = between(p, x, y);
  if (!cells || cells.length < 2) return false;
  if (!cells.every(c => isRiver(c.x, c.y))) return false;
  if (cells.some(c => {
    const q = pieceAt(st, c.x, c.y);
    return q && q.rank === 1;
  })) return false;
  return true;
}

export function movesOf(st, p) {
  const out = [];
  const push = (x, y, jump = false) => {
    if (!inside(x, y)) return;
    if (isDen(x, y, p.side)) return;
    if (isRiver(x, y) && p.rank !== 1) return;
    const target = pieceAt(st, x, y);
    if (target && !canCapture(p, target, x, y)) return;
    out.push({ x, y, capture: !!target, jump });
  };
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) push(p.x + dx, p.y + dy);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let x = p.x, y = p.y;
    while (true) {
      x += dx; y += dy;
      if (!inside(x, y)) break;
      if (!isRiver(x, y)) {
        if (canJump(st, p, x, y)) push(x, y, true);
        break;
      }
    }
  }
  return out;
}

export function hasAnyMove(st, side) {
  return st.pieces.some(p =>
    p.alive !== false && p.side === side && movesOf(st, p).length > 0);
}

// ====== 落子与胜负 ======
// 注意：本函数会原地修改 st。服务端持有唯一权威状态；
// 浏览器只读快照，不直接调用它。
export function applyMove(st, from, to) {
  const p = pieceAt(st, from.x, from.y);
  if (!p) return { ok: false, error: '这一格没有棋子' };
  if (st.turn && p.side !== st.turn) return { ok: false, error: '还没轮到这一方' };

  const mv = movesOf(st, p).find(m => m.x === to.x && m.y === to.y);
  if (!mv) return { ok: false, error: '这一步不合法' };

  if (mv.capture) {
    const cap = pieceAt(st, to.x, to.y);
    if (cap) cap.alive = false;
  }
  p.x = to.x; p.y = to.y;
  st.turn = OTHER(p.side);

  if (isDen(to.x, to.y, OTHER(p.side))) {
    return { ok: true, winner: p.side, reason: '进入对方兽穴' };
  }

  const foe = st.pieces.filter(q => q.alive !== false && q.side !== p.side);
  if (foe.length === 0) {
    return { ok: true, winner: p.side, reason: '对方没有子' };
  }
  if (!foe.some(q => movesOf(st, q).length > 0)) {
    return { ok: true, winner: p.side, reason: '对方无子可走' };
  }

  return { ok: true, winner: null };
}

// ====== 开局 ======
export function initialState() {
  const pieces = []; let id = 0;
  const put = (side, rank, x, y) =>
    pieces.push({ id: side + (++id), side, rank, x, y, alive: true });

  // 按照经典斗兽棋阵型摆放 (x:1~7, y:1~9)

  // === 红方 (下方) ===
  // 第 9 行 (底线)
  put('red', 6, 1, 9); // 虎
  put('red', 7, 7, 9); // 狮
  // 第 8 行
  put('red', 2, 2, 8); // 猫
  put('red', 3, 6, 8); // 狗
  // 第 7 行
  put('red', 8, 1, 7); // 象
  put('red', 4, 3, 7); // 狼
  put('red', 5, 5, 7); // 豹
  put('red', 1, 7, 7); // 鼠

  // === 蓝方 (上方) ===
  // 第 1 行 (底线)
  put('blue', 7, 1, 1); // 狮
  put('blue', 6, 7, 1); // 虎
  // 第 2 行
  put('blue', 3, 2, 2); // 狗
  put('blue', 2, 6, 2); // 猫
  // 第 3 行
  put('blue', 1, 1, 3); // 鼠
  put('blue', 5, 3, 3); // 豹
  put('blue', 4, 5, 3); // 狼
  put('blue', 8, 7, 3); // 象

  return { turn: 'red', pieces };
}
