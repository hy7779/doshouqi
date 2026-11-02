// 测试"构建产物"本身：从 ai-local.html 里抽出内联脚本，在 Node 里跑起来。
// 这验证的是用户真正双击打开的那份文件，而不是源模块。
import fs from 'node:fs';

const html = fs.readFileSync(new URL('./ai-local.html', import.meta.url), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (blocks.length !== 2) throw new Error(`预期 2 个内联脚本，实际 ${blocks.length}`);

const sandbox = {};
new Function('window', blocks[0])(sandbox);
const DSQ = sandbox.DSQ;

const assert = (cond, msg) => {
  if (!cond) throw new Error('断言失败：' + msg);
};

assert(DSQ && typeof DSQ.searchMove === 'function', 'DSQ 导出缺失');
assert(DSQ.GEO.cols === 7 && DSQ.GEO.rows === 9, '棋盘尺寸');
assert(Object.keys(DSQ.PIECE_NAME).length === 8, '棋子名称');

// 初始局面 + 走法数量
const start = DSQ.initialState();
assert(start.pieces.length === 16, '初始 16 枚棋子');
const redMoves = start.pieces
  .filter((p) => p.side === 'red')
  .reduce((n, p) => n + DSQ.movesOf(start, p).length, 0);
console.log(`初始红方可走 ${redMoves} 步`);

// AI 对决 AI：完整跑 120 手，所有走法都必须被 applyMove 接受
let state = DSQ.initialState();
let plies = 0;
let winner = null;
const t0 = Date.now();
while (plies < 120 && !winner) {
  const mv = DSQ.searchMove(state, { timeMs: 120, maxDepth: 8 });
  assert(mv, `第 ${plies} 手 AI 没有给出走法`);
  const legal = DSQ.movesOf(state, DSQ.pieceAt(state, mv.from.x, mv.from.y))
    .some((m) => m.x === mv.to.x && m.y === mv.to.y);
  assert(legal, `第 ${plies} 手 AI 给出的 ${JSON.stringify(mv)} 不在合法走法里`);
  const res = DSQ.applyMove(state, mv.from, mv.to);
  assert(res.ok, `第 ${plies} 手 applyMove 拒绝：${res.error}`);
  if (res.winner) winner = `${res.winner}（${res.reason}）`;
  plies++;
}
console.log(`AI 自对弈 ${plies} 手，用时 ${Date.now() - t0}ms，结果：${winner || '未分胜负'}`);
assert(plies > 8, '对局没走起来');

// 快速走法生成器与 engine 规则的一致性（在产物里再验一次）
const board = DSQ.boardFromState(state);
const side = state.turn === 'blue' ? -1 : 1;
const fast = new Set(DSQ.genMoves(board, side).map((m) => `${m >> 6}->${m & 63}`));
const slow = new Set();
for (const p of state.pieces) {
  if (p.alive === false || p.side !== state.turn) continue;
  for (const m of DSQ.movesOf(state, p)) slow.add(`${(p.y - 1) * 7 + p.x - 1}->${(m.y - 1) * 7 + m.x - 1}`);
}
assert(fast.size === slow.size && [...slow].every((k) => fast.has(k)), '产物内快速生成器与规则不一致');

// 各难度都能在预算内给出走法
for (const [name, opts] of Object.entries({
  轻松: { timeMs: 150, maxDepth: 2 },
  普通: { timeMs: 350, maxDepth: 4 },
  困难: { timeMs: 900, maxDepth: 8 },
  大师: { timeMs: 1600, maxDepth: 12 }
})) {
  const t = Date.now();
  const mv = DSQ.searchMove(start, opts);
  const used = Date.now() - t;
  assert(mv && Date.now() - t < opts.timeMs + 400, `${name} 超时或没走法`);
  console.log(`  ${name}: 深度 ${mv.depth}, 节点 ${mv.nodes}, 用时 ${used}ms`);
}

console.log('✓ 产物测试全部通过');
