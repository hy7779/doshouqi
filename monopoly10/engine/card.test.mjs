/**
 * 卡片效果自检
 * 运行：node card.test.mjs
 */
import { createGame } from './state.mjs';
import { useCard, roll, buyCard, closeShop, respondReaction, IMPLEMENTED_EFFECTS } from './engine.mjs';
import { makeRuleset } from '../config/ruleset.mjs';
import { CARD_LIST } from '../config/cards.mjs';

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

function game(seed = 1) {
  return createGame({
    ruleset: makeRuleset('standard', { 'rules.mapId': 'small' }),
    mapId: 'small',
    names: ['甲', '乙', '丙'],
    seed,
    characterIds: ['rat', 'dog', 'lion'],
  });
}

const give = (s, pid, cardId) => { s.players[pid].hand.push(cardId); return s; };

console.log('1) 遥控骰子');
{
  let s = game();
  give(s, 0, 'dice');
  s = useCard(s, 'dice', 4);
  check('设置了指定步数', s.pendingDice === 4, `pendingDice=${s.pendingDice}`);
  const before = s.players[0].pos;
  s = roll(s);
  const moved = (s.players[0].pos - before + s.tiles.length) % s.tiles.length;
  check('按指定步数走', moved === 4, `走了 ${moved} 步`);
}

console.log('2) 路障');
{
  let s = game(2);
  const p = s.players[0];
  p.pos = 5;
  give(s, 0, 'barrier');
  s = useCard(s, 'barrier', 9);
  check('放在前方 4 格', s.tiles[9].barrier === true);
  const far = game(2);
  far.players[0].pos = 5;
  give(far, 0, 'barrier');
  const rejected = useCard(far, 'barrier', 40);
  check('超出 15 格被拒绝', rejected === far);
}

console.log('3) 地雷');
{
  let s = game(3);
  give(s, 0, 'mine');
  s.players[0].pos = 3;
  s = useCard(s, 'mine', 8);
  check('埋雷成功', s.tiles[8].mine === true);
}

console.log('4) 机器娃娃');
{
  let s = game(4);
  s.players[0].pos = 3;
  s.tiles[5].barrier = true;
  s.tiles[7].mine = true;
  give(s, 0, 'robot');
  s = useCard(s, 'robot');
  check('清掉前方 10 格内的障碍', !s.tiles[5].barrier && !s.tiles[7].mine);
}

console.log('5) 转向 / 乌龟');
{
  let s = game(5);
  s.players[1].dir = 1;
  s.players[1].pos = (s.players[0].pos + 5) % s.tiles.length; // 放到射程内
  give(s, 0, 'reverse');
  s = useCard(s, 'reverse', 1);
  check('目标掉头', s.players[1].dir === -1);

  let t = game(6);
  give(t, 0, 'turtle');
  t = useCard(t, 'turtle', 1);
  check('目标被减速 3 回合', t.players[1].slow === 3);

  const before = t.players[0].pos;
  t = roll(t);
  check('施法者本身不受影响', t.players[0].pos !== before);
}

console.log('6) 查税 / 抢夺');
{
  let s = game(7);
  s.players[1].cash = 100000;
  s.players[0].cash = 10000;
  give(s, 0, 'audit');
  s = useCard(s, 'audit', 1);
  check('拿走目标 15% 现金', s.players[1].cash === 85000 && s.players[0].cash === 25000,
    `甲=${s.players[0].cash} 乙=${s.players[1].cash}`);

  let t = game(8);
  t.players[1].hand = ['dice', 'mine'];
  give(t, 0, 'rob');
  t = useCard(t, 'rob', 1);
  check('抢到一张卡', t.players[0].hand.includes('dice') || t.players[0].hand.includes('mine'));
  check('对方手牌减少', t.players[1].hand.length === 1);
}

console.log('7) 停留 / 陷害');
{
  let s = game(9);
  give(s, 0, 'freeze');
  s = useCard(s, 'freeze', 1);
  check('目标跳过 1 回合', s.players[1].skip === 1);

  let t = game(10);
  give(t, 0, 'frame');
  t = useCard(t, 'frame', 1);
  check('目标有免罪卡时先暂停询问', t.phase === 'reaction', 'phase=' + t.phase);
  t = respondReaction(t, 'pardon');
  check('免罪卡生效，没有坐牢', t.players[1].zone === 'ring' && t.players[1].skip === 0);
  check('免罪卡被消耗', !t.players[1].hand.includes('pardon'));
}

console.log('8) 商店');
{
  let s = game(11);
  s.players[0].cash = 200000;
  s.phase = 'shop';
  s.pending = { shop: ['dice', 'mine'] };
  s = buyCard(s, 'mine');
  check('买卡扣钱', s.players[0].cash === 200000 - s.ruleset.cards.prices.common, `现金 ${s.players[0].cash}`);
  check('卡片进手牌', s.players[0].hand.includes('mine'));
  check('商店里被移除', !s.pending.shop.includes('mine'));
  s = closeShop(s);
  check('关店回到回合', s.phase === 'postRoll' && s.pending === null);
}

console.log('9) 每张卡都有实现或明确标记');
{
  const implemented = IMPLEMENTED_EFFECTS;
  const types = [...new Set(CARD_LIST.map((c) => c.effect.type))];
  const missing = types.filter((t) => !implemented.has(t));
  console.log(`  已实现 ${implemented.size} 种效果 / 共 ${types.length} 种`);
  console.log(`  未实现：${missing.join(', ')}`);
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
