// 差分校验：快速走法生成器必须和 engine.mjs 的 movesOf 完全一致。
// 用法：node test-diff.mjs [局数]
import { initialState, applyMove, movesOf, PIECE_NAME } from './engine.mjs';
import { genMoves, boardFromState, searchMove, moveToCoords, CX, CY } from './ai-search.mjs';

let games = Number(process.argv[2]) || 200;
let failures = 0;
let positions = 0;

const key = (p, m) => `${p.x},${p.y}->${m.x},${m.y}`;

function engineMoves(state, side) {
  const set = new Set();
  for (const p of state.pieces) {
    if (p.alive === false || p.side !== side) continue;
    for (const m of movesOf(state, p)) set.add(key(p, m));
  }
  return set;
}

function fastMoves(state, side) {
  const board = boardFromState(state);
  const sideNum = side === 'red' ? 1 : -1;
  const set = new Set();
  for (const m of genMoves(board, sideNum)) {
    const from = m >> 6;
    const to = m & 63;
    set.add(`${CX(from)},${CY(from)}->${CX(to)},${CY(to)}`);
  }
  return set;
}

function compare(state, side) {
  positions++;
  const a = engineMoves(state, side);
  const b = fastMoves(state, side);
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

function randomPlayout(rng) {
  const state = initialState();
  for (let ply = 0; ply < 220; ply++) {
    const side = state.turn;
    if (!compare(state, side)) {
      failures++;
      console.error(`✗ 分歧 @ ply ${ply} side=${side}`);
      console.error('  engine:', [...engineMoves(state, side)].join(' '));
      console.error('  fast  :', [...fastMoves(state, side)].join(' '));
      return;
    }
    const list = [];
    for (const p of state.pieces) {
      if (p.alive === false || p.side !== side) continue;
      for (const m of movesOf(state, p)) list.push({ from: { x: p.x, y: p.y }, to: { x: m.x, y: m.y } });
    }
    if (!list.length) return;
    const pick = list[(rng() * list.length) | 0];
    const res = applyMove(state, pick.from, pick.to);
    if (!res.ok || res.winner) return;
  }
}

// 线性同余，保证可复现
let seed = 20261102;
const rng = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

console.log(`[1/4] 随机对局差分校验（${games} 局）…`);
for (let g = 0; g < games && failures === 0; g++) randomPlayout(rng);
console.log(`  位置 ${positions} 个，分歧 ${failures} 个`);

// [2/4] 搜索给出的走法必须落在合法走法集合里
console.log('[2/4] 搜索走法合法性…');
let illegal = 0;
let searched = 0;
for (let g = 0; g < 12; g++) {
  const state = initialState();
  for (let ply = 0; ply < 40; ply++) {
    const side = state.turn;
    const legal = engineMoves(state, side);
    if (!legal.size) break;
    if (side === 'red' && ply % 4 === 0) {
      const mv = searchMove(state, { timeMs: 120 });
      if (mv) {
        searched++;
        const k = `${mv.from.x},${mv.from.y}->${mv.to.x},${mv.to.y}`;
        if (!legal.has(k)) {
          illegal++;
          console.error(`  ✗ 非法走法 ${k}`);
        }
        applyMove(state, mv.from, mv.to);
        continue;
      }
    }
    const arr = [...legal];
    const pick = arr[(rng() * arr.length) | 0];
    const [from, to] = pick.split('->').map((s) => s.split(',').map(Number));
    const res = applyMove(state, { x: from[0], y: from[1] }, { x: to[0], y: to[1] });
    if (!res.ok || res.winner) break;
  }
}
console.log(`  搜索 ${searched} 次，非法 ${illegal} 个`);

// [3/4] 实力：AI 对随机走子
console.log('[3/4] 实力：AI(红) vs 随机(蓝)，10 局…');
let win = 0;
let loss = 0;
let draw = 0;
for (let g = 0; g < 10; g++) {
  const state = initialState();
  let result = 'draw';
  for (let ply = 0; ply < 200; ply++) {
    const side = state.turn;
    let move = null;
    if (side === 'red') {
      move = searchMove(state, { timeMs: 150 });
    } else {
      const list = [];
      for (const p of state.pieces) {
        if (p.alive === false || p.side !== side) continue;
        for (const m of movesOf(state, p)) list.push({ from: { x: p.x, y: p.y }, to: { x: m.x, y: m.y } });
      }
      if (list.length) move = list[(rng() * list.length) | 0];
    }
    if (!move) {
      result = side === 'red' ? 'loss' : 'win';
      break;
    }
    const res = applyMove(state, move.from, move.to);
    if (!res.ok) {
      console.error(`  ✗ applyMove 拒绝 ${JSON.stringify(move)} ${res.error}`);
      failures++;
      break;
    }
    if (res.winner) {
      result = res.winner === 'red' ? 'win' : 'loss';
      break;
    }
  }
  if (result === 'win') win++;
  else if (result === 'loss') loss++;
  else draw++;
}
console.log(`  AI 胜 ${win} / 负 ${loss} / 平 ${draw}`);

// [4/4] 耗时与深度
console.log('[4/4] 各难度耗时…');
for (const [name, timeMs] of [['轻松', 120], ['普通', 400], ['困难', 900]]) {
  const state = initialState();
  const t0 = Date.now();
  const mv = searchMove(state, { timeMs });
  console.log(`  ${name} ${timeMs}ms → 实耗 ${Date.now() - t0}ms, 深度 ${mv.depth}, 节点 ${mv.nodes}`);
}

console.log('');
const ok = failures === 0 && illegal === 0 && win >= 9;
console.log(ok ? '✓ 全部通过' : `✗ 失败：分歧 ${failures}, 非法 ${illegal}, AI 胜 ${win}`);
process.exit(ok ? 0 : 1);
