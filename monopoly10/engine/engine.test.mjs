/**
 * 引擎自检：确定性、整数性、终止性、租金公式
 * 运行：node engine.test.mjs
 */
import { createGame } from './state.mjs';
import { roll, buy, pass, endTurn, upgrade, rentFor, inflationBp, closeShop, buyCard, respondReaction, leaveBank, leaveLottery, leaveMagic, chooseBigType } from './engine.mjs';
import { makeRuleset } from '../config/ruleset.mjs';
import { mulDivRound, pct } from './money.mjs';

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function checkIntegers(state) {
  for (const p of state.players) {
    for (const k of ['cash', 'deposit', 'pos', 'skip']) {
      if (!Number.isInteger(p[k])) throw new Error(`玩家 ${p.name}.${k} 非整数：${p[k]}`);
    }
  }
  for (const t of state.tiles) {
    if (t.price !== undefined && !Number.isInteger(t.price)) throw new Error(`地块价格非整数 ${t.price}`);
  }
  if (!Number.isInteger(state.round)) throw new Error('round 非整数');
}

function playGame(seed, players = 4, mapId = 'medium') {
  const ruleset = makeRuleset('standard', { 'rules.mapId': mapId });
  let state = createGame({ ruleset, mapId, names: ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛'].slice(0, players), seed });
  const policy = mulberry(seed * 31 + 7);
  let steps = 0;

  while (state.phase !== 'ended' && steps < 40000) {
    steps++;
    if (state.phase === 'preRoll') {
      state = roll(state);
    } else if (state.phase === 'awaitBuy') {
      const p = state.players[state.turn];
      state = p.cash >= state.tiles[p.pos].price + 20000 ? buy(state) : pass(state);
    } else if (['bank','lottery','magic'].includes(state.phase)) {
      state = state.phase === 'bank' ? leaveBank(state) : state.phase === 'lottery' ? leaveLottery(state) : leaveMagic(state);
    } else if (state.phase === 'reaction') {
      const cards = state.pending.cards;
      state = respondReaction(state, policy() < 0.4 ? cards[0] : null);
    } else if (state.phase === 'shop') {
      const p = state.players[state.turn];
      const affordable = state.pending.shop.find((id) => p.cash >= 12000 && p.hand.length < 8);
      state = affordable && policy() < 0.5 ? buyCard(state, affordable) : closeShop(state);
    } else if (state.phase === 'bigType') {
      state = chooseBigType(state, ['mall', 'hotel', 'lab', 'temple', 'oil', 'bank2'][Math.floor(policy() * 6)]);
    } else if (state.phase === 'postRoll') {
      const p = state.players[state.turn];
      const own = state.tiles.map((t, i) => ({ t, i })).filter(({ t }) => t.owner === p.id && t.level < 5);
      if (own.length && policy() < 0.5) {
        const pick = own[Math.floor(policy() * own.length)];
        const before = state;
        state = upgrade(state, pick.i);
        if (state === before) state = endTurn(state);
      } else {
        state = endTurn(state);
      }
    } else {
      throw new Error(`未知阶段 ${state.phase}`);
    }
    checkIntegers(state);
  }
  return { state, steps };
}

let failures = 0;
const fail = (msg) => { console.log('  ✗', msg); failures++; };

/* 1. 终止性 + 整数性 */
console.log('1) 50 局随机对局');
let ended = 0, stepsTotal = 0, maxRound = 0;
for (let i = 1; i <= 50; i++) {
  const { state, steps } = playGame(i * 13, 2 + (i % 4));
  stepsTotal += steps;
  if (state.phase === 'ended') ended++; else fail(`第 ${i} 局没有结束（phase=${state.phase}）`);
  maxRound = Math.max(maxRound, state.round);
}
console.log(`  结束 ${ended}/50 · 平均 ${Math.round(stepsTotal / 50)} 步 · 最长回合 ${maxRound}`);

/* 2. 确定性：同一种子 + 同一策略 → 完全相同的终局 */
console.log('2) 确定性');
const a = playGame(777, 4).state;
const b = playGame(777, 4).state;
const same = JSON.stringify(a) === JSON.stringify(b);
console.log('  同种子两次结果一致：', same ? '是' : '否');
if (!same) fail('确定性被破坏');

/* 3. 不同种子必须不同（防止随机没生效） */
const c = playGame(778, 4).state;
console.log('  不同种子结果不同：', JSON.stringify(a) !== JSON.stringify(c) ? '是' : '否');
if (JSON.stringify(a) === JSON.stringify(c)) fail('随机数没有生效');

/* 4. 租金公式 */
console.log('3) 租金公式');
{
  const ruleset = makeRuleset('standard', { 'rules.mapId': 'medium' });
  let s = createGame({ ruleset, mapId: 'medium', names: ['甲', '乙'], seed: 5 });
  const idx = s.tiles.findIndex((t) => t.kind === 'small');
  const t = s.tiles[idx];
  // 清掉邻居的归属，保证没有连锁加成
  for (let d = 1; d <= 4; d++) {
    const j = (idx + d) % s.tiles.length;
    if (s.tiles[j].kind === 'small') { s.tiles[j].owner = null; s.tiles[j].streetId = 'X' + j; }
  }
  t.owner = 0; t.level = 1;
  s.players[0].charId = 'wolf'; // 不提供租金加成
  const expect1 = pct(t.price, 40);
  const got1 = rentFor(s, idx, s.players[1]);
  console.log(`  ${t.price} 的 1 级租金：期望 ${expect1} 实得 ${got1}`, got1 === expect1 ? '✓' : '✗');
  if (got1 !== expect1) fail('1 级租金不符');

  t.level = 5;
  const expect5 = pct(t.price * 15, 40); // 5 级累计投入 = 15 倍地价
  const got5 = rentFor(s, idx, s.players[1]);
  console.log(`  5 级租金：期望 ${expect5} 实得 ${got5}`, got5 === expect5 ? '✓' : '✗');
  if (got5 !== expect5) fail('5 级租金不符');

  // 虎：收租 +20%
  s.players[0].charId = 'tiger';
  const gotTiger = rentFor(s, idx, s.players[1]);
  const expectTiger = pct(expect5, 120);
  console.log(`  虎收租 +20%：期望 ${expectTiger} 实得 ${gotTiger}`, gotTiger === expectTiger ? '✓' : '✗');
  if (gotTiger !== expectTiger) fail('角色加成不符');

  // 狗：付租 -15%
  s.players[0].charId = 'wolf';
  s.players[1].charId = 'dog';
  const gotDog = rentFor(s, idx, s.players[1]);
  const expectDog = pct(expect5, 85);
  console.log(`  狗付租 -15%：期望 ${expectDog} 实得 ${gotDog}`, gotDog === expectDog ? '✓' : '✗');
  if (gotDog !== expectDog) fail('付租减免不符');

  // 物价：第 11 回合应为 1.20
  s.round = 11;
  console.log(`  第 11 回合物价：${inflationBp(s)}（期望 12000）`, inflationBp(s) === 12000 ? '✓' : '✗');
  if (inflationBp(s) !== 12000) fail('物价指数不符');
}

/* 5. 回合上限 */
console.log('4) 回合上限');
{
  const ruleset = makeRuleset('standard', { 'rules.maxRounds': 5 });
  let s = createGame({ ruleset, mapId: 'small', names: ['甲', '乙'], seed: 9 });
  let n = 0;
  while (s.phase !== 'ended' && n++ < 5000) {
    if (s.phase === 'preRoll') s = roll(s);
    else if (s.phase === 'awaitBuy') s = pass(s);
    else if (s.phase === 'bank') s = leaveBank(s);
    else if (s.phase === 'lottery') s = leaveLottery(s);
    else if (s.phase === 'magic') s = leaveMagic(s);
    else if (s.phase === 'shop') s = closeShop(s);
    else if (s.phase === 'reaction') s = respondReaction(s, null);
    else s = endTurn(s);
  }
  console.log(`  上限 5 回合 → 结束于第 ${s.round} 回合`, s.phase === 'ended' && s.round <= 6 ? '✓' : '✗');
  if (!(s.phase === 'ended' && s.round <= 6)) fail('回合上限未生效');
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
