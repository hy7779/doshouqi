// ============================================================
// 斗兽棋搜索模块（浏览器 / Node 共用）
//
// 这一份是"算得快"的规则副本：用 63 格 Int8Array 代替 pieces 数组，
// 走法生成和 engine.mjs 的 movesOf 必须完全等价。
// 任何规则改动都要同步 engine.mjs，并跑 test-diff.mjs 做差分校验。
//
// 红 = 正数，蓝 = 负数，0 = 空格；数值等于棋子等级。
// ============================================================
import { GEO } from './engine.mjs';

export const W = GEO.cols;
export const H = GEO.rows;
export const N = W * H;

export const IDX = (x, y) => (y - 1) * W + (x - 1);
export const CX = (i) => (i % W) + 1;
export const CY = (i) => ((i / W) | 0) + 1;

export const DEN = { red: IDX(GEO.dens.red.x, GEO.dens.red.y), blue: IDX(GEO.dens.blue.x, GEO.dens.blue.y) };
export const RIVER = new Uint8Array(N);
export const TRAP = { red: new Uint8Array(N), blue: new Uint8Array(N) };

for (let i = 0; i < N; i++) {
  const x = CX(i);
  const y = CY(i);
  RIVER[i] = GEO.rivers.some(([x1, y1, x2, y2]) => x >= x1 && x <= x2 && y >= y1 && y <= y2) ? 1 : 0;
  TRAP.red[i] = GEO.traps.red.some((t) => t.x === x && t.y === y) ? 1 : 0;
  TRAP.blue[i] = GEO.traps.blue.some((t) => t.x === x && t.y === y) ? 1 : 0;
}

export const NEI = Array.from({ length: N }, (_, i) => {
  const x = CX(i);
  const y = CY(i);
  const out = [];
  if (x > 1) out.push(i - 1);
  if (x < W) out.push(i + 1);
  if (y > 1) out.push(i - W);
  if (y < H) out.push(i + W);
  return out;
});

// 狮(7)/虎(6) 跳河：沿横竖走，穿过 >=2 格河道后落在第一块陆地上。
// 河道被鼠挡住时不能跳（和 engine.mjs 的 canJump 一致）。
const DELTA = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const JUMPS = Array.from({ length: N }, (_, i) => {
  const x0 = CX(i);
  const y0 = CY(i);
  const out = [];
  for (const [dx, dy] of DELTA) {
    let x = x0;
    let y = y0;
    const path = [];
    let land = -1;
    for (;;) {
      x += dx;
      y += dy;
      if (x < 1 || x > W || y < 1 || y > H) break;
      const j = IDX(x, y);
      if (!RIVER[j]) {
        land = j;
        break;
      }
      path.push(j);
    }
    if (land >= 0 && path.length >= 2) out.push({ to: land, path });
  }
  return out;
});

const DEN_OF = { 1: DEN.red, '-1': DEN.blue };
const ENEMY_DEN = { 1: DEN.blue, '-1': DEN.red };
const TRAP_OF = { 1: TRAP.red, '-1': TRAP.blue };
// 站在"对方"陷阱里的子等级归零（engine.mjs: isTrap(tx, ty, OTHER(d.side))）
const TRAP_ENEMY = { 1: TRAP.blue, '-1': TRAP.red };

// 到对方兽穴的曼哈顿距离，用于评估函数里的进攻倾向。
const DIST = { 1: new Int8Array(N), '-1': new Int8Array(N) };
for (let i = 0; i < N; i++) {
  const x = CX(i);
  const y = CY(i);
  DIST[1][i] = Math.abs(x - GEO.dens.blue.x) + Math.abs(y - GEO.dens.blue.y);
  DIST[-1][i] = Math.abs(x - GEO.dens.red.x) + Math.abs(y - GEO.dens.red.y);
}

// ---------- 局面转换 ----------
export function boardFromState(state) {
  const board = new Int8Array(N);
  for (const p of state.pieces) {
    if (p.alive === false) continue;
    board[IDX(p.x, p.y)] = p.side === 'red' ? p.rank : -p.rank;
  }
  return board;
}

export const moveFrom = (m) => m >> 6;
export const moveTo = (m) => m & 63;

export function moveToCoords(m) {
  const from = moveFrom(m);
  const to = moveTo(m);
  return { from: { x: CX(from), y: CY(from) }, to: { x: CX(to), y: CY(to) } };
}

// ---------- 吃子判定（完全对齐 engine.mjs 的 canCapture） ----------
export function canCaptureFast(board, from, rank, side, to) {
  const target = board[to];
  const defRank = target > 0 ? target : -target;
  if (TRAP_OF[side][to]) return true;                        // 防守方站在进攻方的陷阱里 → 等级归零
  if (RIVER[to] && rank !== 1) return false;                 // 只有鼠能下水
  if (RIVER[from] && !RIVER[to]) return false;               // 水里的子吃不到岸上
  if (rank === 1 && defRank === 8) return true;              // 鼠吃象
  if (rank === 8 && defRank === 1) return false;             // 象吃不了鼠
  return rank >= defRank;
}

// ---------- 走法生成 ----------
export function genMoves(board, side) {
  const out = [];
  const ownDen = DEN_OF[side];
  for (let i = 0; i < N; i++) {
    const v = board[i];
    if (v === 0) continue;
    if (v > 0 !== side > 0) continue;
    const rank = v > 0 ? v : -v;

    for (let k = 0; k < NEI[i].length; k++) {
      const j = NEI[i][k];
      if (j === ownDen) continue;
      if (RIVER[j] && rank !== 1) continue;
      const t = board[j];
      if (t !== 0) {
        if (t > 0 === side > 0) continue;
        if (!canCaptureFast(board, i, rank, side, j)) continue;
      }
      out.push((i << 6) | j);
    }

    if (rank === 6 || rank === 7) {
      const jumps = JUMPS[i];
      for (let k = 0; k < jumps.length; k++) {
        const { to, path } = jumps[k];
        let blocked = false;
        for (let c = 0; c < path.length; c++) {
          const q = board[path[c]];
          if (q === 1 || q === -1) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
        const t = board[to];
        if (t !== 0) {
          if (t > 0 === side > 0) continue;
          if (!canCaptureFast(board, i, rank, side, to)) continue;
        }
        out.push((i << 6) | to);
      }
    }
  }
  return out;
}

export function hasMove(board, side) {
  return genMoves(board, side).length > 0;
}

// ---------- 评估 ----------
// 等级价值。鼠偏低但能杀象、能下水，豹/狼是中坚，狮虎能跳河所以略高。
const VAL = { 1: 58, 2: 24, 3: 34, 4: 44, 5: 52, 6: 74, 7: 84, 8: 82 };

export function evaluate(board, side) {
  let score = 0;
  for (let i = 0; i < N; i++) {
    const v = board[i];
    if (v === 0) continue;
    const s = v > 0 ? 1 : -1;
    const rank = s > 0 ? v : -v;

    let val = VAL[rank];
    val += (12 - DIST[s][i]) * 1.7;          // 越靠近对方兽穴越值钱
    if (TRAP_ENEMY[s][i]) val -= 22;         // 深入对方陷阱，谁都能吃它
    if (rank === 1 && RIVER[i]) val += 3;    // 河里的鼠相对安全
    score += s * val;
  }
  return score * side;
}

// ---------- 搜索 ----------
const MATE = 1000000;
const INF = 2000000;
const ABORT = { abort: true };
const nowMs = () => Date.now();

function orderMoves(board, moves, side, ttMove, history) {
  const n = moves.length;
  const scores = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    const m = moves[k];
    if (m === ttMove) {
      scores[k] = 1 << 30;
      continue;
    }
    const to = m & 63;
    const cap = board[to];
    let s = 0;
    if (cap !== 0) s = 100000 + Math.abs(cap) * 100;
    s += history[m] || 0;
    scores[k] = s;
  }
  // 插入排序：走法数量很小（通常 < 30），比通用排序更快。
  for (let a = 1; a < n; a++) {
    const m = moves[a];
    const sc = scores[a];
    let b = a - 1;
    while (b >= 0 && scores[b] < sc) {
      moves[b + 1] = moves[b];
      scores[b + 1] = scores[b];
      b--;
    }
    moves[b + 1] = m;
    scores[b + 1] = sc;
  }
  return moves;
}

function qsearch(ctx, board, side, alpha, beta, ply) {
  if (++ctx.nodes % 1024 === 0 && nowMs() > ctx.deadline) throw ABORT;

  const enemyDen = ENEMY_DEN[side];
  const all = genMoves(board, side);
  if (all.length === 0) return -MATE + ply;

  // 能直接进穴就是赢，别让它跑掉。
  for (let k = 0; k < all.length; k++) {
    if ((all[k] & 63) === enemyDen) return MATE - ply;
  }

  const stand = evaluate(board, side);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (ply >= 24) return stand;

  const caps = [];
  for (let k = 0; k < all.length; k++) {
    if (board[all[k] & 63] !== 0) caps.push(all[k]);
  }
  if (caps.length === 0) return alpha;

  orderMoves(board, caps, side, 0, ctx.history);

  for (let k = 0; k < caps.length; k++) {
    const m = caps[k];
    const from = m >> 6;
    const to = m & 63;
    const captured = board[to];
    board[to] = board[from];
    board[from] = 0;
    const score = -qsearch(ctx, board, -side, -beta, -alpha, ply + 1);
    board[from] = board[to];
    board[to] = captured;

    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(ctx, board, side, depth, alpha, beta, ply) {
  if (++ctx.nodes % 1024 === 0 && nowMs() > ctx.deadline) throw ABORT;

  const enemyDen = ENEMY_DEN[side];
  const moves = genMoves(board, side);
  if (moves.length === 0) return -MATE + ply;
  for (let k = 0; k < moves.length; k++) {
    if ((moves[k] & 63) === enemyDen) return MATE - ply;
  }
  if (depth <= 0) return qsearch(ctx, board, side, alpha, beta, ply);

  orderMoves(board, moves, side, ctx.tt, ctx.history);

  let best = -INF;
  for (let k = 0; k < moves.length; k++) {
    const m = moves[k];
    const from = m >> 6;
    const to = m & 63;
    const captured = board[to];
    board[to] = board[from];
    board[from] = 0;
    const score = -negamax(ctx, board, -side, depth - 1, -beta, -alpha, ply + 1);
    board[from] = board[to];
    board[to] = captured;

    if (score > best) best = score;
    if (score > alpha) {
      alpha = score;
      if (ply === 0) ctx.bestRoot = m;
      ctx.tt = m;
      if (captured === 0) ctx.history[m] += depth * depth;
    }
    if (alpha >= beta) break;
  }
  return best;
}

// 根节点单独处理，方便做"上一轮最佳走法优先"和难度削弱。
function rootSearch(ctx, board, side, depth) {
  const enemyDen = ENEMY_DEN[side];
  const moves = genMoves(board, side);
  orderMoves(board, moves, side, ctx.bestRoot, ctx.history);

  let best = -INF;
  let bestMove = moves[0];
  let alpha = -INF;
  const beta = INF;

  for (let k = 0; k < moves.length; k++) {
    const m = moves[k];
    const from = m >> 6;
    const to = m & 63;
    const captured = board[to];
    board[to] = board[from];
    board[from] = 0;
    let score;
    if (to === enemyDen) score = MATE;
    else score = -negamax(ctx, board, -side, depth - 1, -beta, -alpha, 1);
    board[from] = board[to];
    board[to] = captured;

    if (score > best) {
      best = score;
      bestMove = m;
    }
    if (score > alpha) alpha = score;
  }
  return { move: bestMove, score: best };
}

/**
 * 找一个走法。
 * @param {object} state   engine.mjs 的局面（含 pieces / turn）
 * @param {object} options
 *   timeMs    思考时间上限（毫秒）
 *   maxDepth  最大深度
 *   random    0~1，走一步随机合法棋的概率（给"轻松"难度用）
 * @returns {{from:{x,y}, to:{x,y}, score:number, depth:number, nodes:number, elapsed:number}|null}
 */
export function searchMove(state, options = {}) {
  const {
    timeMs = 700,
    maxDepth = 12,
    random = 0,
    rng = Math.random,
  } = options;

  const board = boardFromState(state);
  const side = state.turn === 'blue' ? -1 : 1;
  const rootMoves = genMoves(board, side);
  if (rootMoves.length === 0) return null;

  const start = nowMs();
  const ctx = {
    nodes: 0,
    deadline: start + Math.max(30, timeMs),
    history: new Int32Array(N * 64),
    tt: 0,
    bestRoot: 0,
  };

  if (random > 0 && rng() < random) {
    const m = rootMoves[(rng() * rootMoves.length) | 0];
    return { ...moveToCoords(m), score: 0, depth: 0, nodes: 0, elapsed: nowMs() - start };
  }
  if (rootMoves.length === 1) {
    return { ...moveToCoords(rootMoves[0]), score: 0, depth: 1, nodes: 1, elapsed: nowMs() - start };
  }

  let best = { move: rootMoves[0], score: 0 };
  let depthDone = 0;

  for (let d = 1; d <= maxDepth; d++) {
    try {
      const result = rootSearch(ctx, board, side, d);
      best = result;
      depthDone = d;
      ctx.bestRoot = result.move;
      if (Math.abs(result.score) > MATE - 200) break;   // 已经算到必胜/必败
    } catch (error) {
      if (error !== ABORT) throw error;
      break;
    }
    if (nowMs() > ctx.deadline - 20) break;
  }

  return {
    ...moveToCoords(best.move),
    score: best.score,
    depth: depthDone,
    nodes: ctx.nodes,
    elapsed: nowMs() - start,
  };
}
