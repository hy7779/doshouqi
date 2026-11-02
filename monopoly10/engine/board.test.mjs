/**
 * 地图生成器自检
 * 运行：node board.test.mjs
 */
import { MAPS } from '../config/maps.mjs';
import { generateBoard, validateBoard, boardFingerprint } from './board.mjs';
import { createGame } from './state.mjs';
import { roll } from './engine.mjs';
import { makeRuleset } from '../config/ruleset.mjs';

let failures = 0;
const fail = (m) => { console.log('  ✗', m); failures++; };

/* 1. 三张图 × 20 个 seed 的结构校验 */
console.log('1) 结构校验');
for (const [id, map] of Object.entries(MAPS)) {
  let bad = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const board = generateBoard(map, seed);
    const errs = validateBoard(board, map);
    if (errs.length) { bad++; if (bad === 1) fail(`${id} seed=${seed}: ${errs[0]}`); }
  }
  console.log(`  ${id.padEnd(6)} 20 个 seed，失败 ${bad}`);
}

/* 2. 同 seed 同图，不同 seed 不同图 */
console.log('2) 确定性');
for (const [id, map] of Object.entries(MAPS)) {
  const a = boardFingerprint(generateBoard(map, 42));
  const b = boardFingerprint(generateBoard(map, 42));
  const c = boardFingerprint(generateBoard(map, 43));
  const ok = a === b && a !== c;
  console.log(`  ${id.padEnd(6)} 同 seed 一致 / 异 seed 不同：${ok ? '✓' : '✗'}`);
  if (!ok) fail(`${id} 确定性异常`);
}

/* 3. 商店必须在角上、地皮必须成对 */
console.log('3) 位置约束');
for (const [id, map] of Object.entries(MAPS)) {
  const board = generateBoard(map, 7);
  const corners = board.meta.corners;
  const shopsOk = board.meta.shops.every((s) => corners.includes(s));
  const plots = {};
  for (const t of board.ring) if (t.kind === 'big') (plots[t.plotId] ||= []).push(t);
  const pairOk = Object.values(plots).every((l) => l.length === 2);
  console.log(`  ${id.padEnd(6)} 商店在角上：${shopsOk ? '✓' : '✗'} · 大地皮成对：${pairOk ? '✓' : '✗'}`);
  if (!shopsOk) fail(`${id} 商店不在角上`);
  if (!pairOk) fail(`${id} 大地皮没成对`);
}

/* 4. 进内圈 → 从内圈出口回大道 */
console.log('4) 内圈往返');
{
  const ruleset = makeRuleset('standard', { 'rules.mapId': 'small' });
  let s = createGame({ ruleset, mapId: 'small', names: ['甲', '乙'], seed: 3 });
  const entrance = s.board.meta.innerEntrances[0];
  s.players[0].pos = (entrance - 1 + s.tiles.length) % s.tiles.length;
  s.pendingDice = 2;
  s = roll(s);
  const p1 = s.players[0];
  console.log(`  踩到传送点后 zone=${p1.zone} pos=${p1.pos}`, p1.zone === 'inner' ? '✓' : '✗');
  if (p1.zone !== 'inner') fail('没有进入内圈');

  // 走到内圈出口
  const inner = s.board.inner;
  const exitIdx = s.board.meta.innerExitIndex;
  p1.pos = (exitIdx - 1 + inner.length) % inner.length;
  s.phase = 'preRoll';
  s.pendingDice = 1;
  s = roll(s);
  const p2 = s.players[0];
  console.log(`  经过内圈出口后 zone=${p2.zone} pos=${p2.pos}`, p2.zone === 'ring' ? '✓' : '✗');
  if (p2.zone !== 'ring') fail('没有从内圈出来');
}

/* 5. 出院支路：走满 5 格汇入大道 */
console.log('5) 支路');
{
  const ruleset = makeRuleset('standard', { 'rules.mapId': 'small' });
  let s = createGame({ ruleset, mapId: 'small', names: ['甲', '乙'], seed: 4 });
  s.players[0].zone = 'exit';
  s.players[0].exitPath = 'hospital';
  s.players[0].pos = -1;
  s.phase = 'preRoll';
  s.pendingDice = 6;
  s = roll(s);
  const p = s.players[0];
  const junction = s.board.meta.hospitalJunction;
  // 支路 5 格 + 第 6 步离开支路，正好落在汇入点
  const expect = junction;
  console.log(`  走 6 步后 zone=${p.zone} pos=${p.pos}（汇入点 ${junction}）`,
    p.zone === 'ring' && p.pos === expect ? '✓' : '✗');
  if (!(p.zone === 'ring' && p.pos === expect)) fail('支路汇入位置不对');
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
