/**
 * 第二批卡片自检（购地 / 查封 / 拆房 / 远程升级 / 涨价 / 均富 / 炸弹 / 范围伤害）
 */
import { createGame } from './state.mjs';
import { useCard, rentFor, roll, respondReaction } from './engine.mjs';
import { makeRuleset } from '../config/ruleset.mjs';

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
    characterIds: ['wolf', 'dog', 'lion'],
  });
}

const smallTiles = (s) => s.tiles.map((t, i) => ({ t, i })).filter(({ t }) => t.kind === 'small');

console.log('1) 购地卡');
{
  let s = game(1);
  const { t, i } = smallTiles(s)[0];
  t.owner = 1; t.level = 2;
  const price = t.price;
  const before = s.players[0].cash;
  s.players[0].hand = ['buyLand'];
  s = useCard(s, 'buyLand', i);
  check('产权转到自己名下', s.tiles[i].owner === 0);
  check('付了地价+加盖费', s.players[0].cash < before, `花了 ${before - s.players[0].cash}`);
  check('原主拿到地价', s.players[1].cash > 0, `原主现金 ${s.players[1].cash}`);
}

console.log('2) 查封卡');
{
  let s = game(2);
  const { t, i } = smallTiles(s)[0];
  t.owner = 1; t.level = 1;
  const rentBefore = rentFor(s, i, s.players[0]);
  s.players[0].hand = ['seal'];
  s = useCard(s, 'seal', i);
  const rentAfter = rentFor(s, i, s.players[0]);
  check('查封后租金归零', rentBefore > 0 && rentAfter === 0, `${rentBefore} → ${rentAfter}`);
  s.round += 7;
  const rentRestored = rentFor(s, i, s.players[0]);
  check('6 回合后自动恢复', rentRestored > 0, '恢复后 ' + rentRestored);
}

console.log('3) 工程车');
{
  let s = game(3);
  const p = s.players[0];
  p.pos = 2;
  const target = 6;
  s.tiles[target] = { ...s.tiles[target], kind: 'small', streetId: 'X', price: 36000, owner: 1, level: 3 };
  p.hand = ['excavator'];
  s = useCard(s, 'excavator', target);
  check('目标房屋降 1 级', s.tiles[target].level === 2, `level=${s.tiles[target].level}`);
}

console.log('4) 机器工人');
{
  let s = game(4);
  const { t, i } = smallTiles(s)[0];
  t.owner = 0; t.level = 1;
  const before = s.players[0].cash;
  s.players[0].hand = ['worker'];
  s = useCard(s, 'worker', i);
  check('远程升 1 级', s.tiles[i].level === 2);
  check('扣了升级费', s.players[0].cash < before);
}

console.log('5) 涨价卡');
{
  let s = game(5);
  const { t, i } = smallTiles(s)[0];
  t.owner = 1; t.level = 1;
  const before = rentFor(s, i, s.players[0]);
  s.players[0].hand = ['priceUp'];
  s = useCard(s, 'priceUp', i);
  const after = rentFor(s, i, s.players[0]);
  check('租金翻倍', after === before * 2, `${before} → ${after}`);
}

console.log('6) 均富卡');
{
  let s = game(6);
  s.players[0].cash = 10000;
  s.players[1].cash = 100000;
  s.players[2].cash = 40000;
  s.players[0].hand = ['equalizeRich'];
  s = useCard(s, 'equalizeRich');
  const all = s.players.map((p) => p.cash);
  check('所有人现金相同', new Set(all).size === 1, all.join('/'));
}

console.log('7) 定时炸弹');
{
  let s = game(7);
  s.players[0].hand = ['bomb'];
  s = useCard(s, 'bomb');
  check('炸弹挂在身上', s.players[0].bomb === 30, `bomb=${s.players[0].bomb}`);
}

console.log('8) 飞弹（范围伤害）');
{
  let s = game(8);
  const center = 10;
  const rc = (i) => {
    const { w, h } = s.mapSides;
    const [c1, c2, c3] = s.board.meta.corners.slice(1);
    if (i <= c1) return { col: w - 1 - i, row: h - 1 };
    if (i <= c2) return { col: 0, row: h - 1 - (i - c1) };
    if (i <= c3) return { col: i - c2, row: 0 };
    return { col: w - 1, row: i - c3 };
  };
  const c0 = rc(center);
  let damaged = 0;
  for (let i = 0; i < s.tiles.length; i++) {
    const t = s.tiles[i];
    if (t.kind !== 'small' && t.kind !== 'big') continue;
    const r = rc(i);
    if (Math.abs(r.col - c0.col) <= 1 && Math.abs(r.row - c0.row) <= 1) { t.level = 3; damaged++; }
  }
  s.players[0].hand = ['missile'];
  s = useCard(s, 'missile', center);
  const total = s.tiles.reduce((sum, t) => sum + (t.level || 0), 0);
  check('范围内建筑受影响', total < damaged * 3, `范围内 ${damaged} 处，剩余总等级 ${total}`);
}

console.log('9) 响应：踩到高价地时的免费卡');
{
  let s = game(9);
  const bigIdx = s.tiles.findIndex((t) => t.kind === 'big');
  const pid = s.tiles[bigIdx].plotId;
  s.tiles.forEach((t) => { if (t.plotId === pid) { t.owner = 1; t.level = 5; } });
  const p = s.players[0];
  p.pos = (bigIdx - 1 + s.tiles.length) % s.tiles.length;
  p.hand = ['free'];
  s.pendingDice = 1;
  const cashBefore = p.cash;
  s = roll(s);
  check('触发响应暂停', s.phase === 'reaction', 'phase=' + s.phase);
  if (s.phase === 'reaction') {
    s = respondReaction(s, 'free');
    check('免费卡免掉租金', s.players[0].cash === cashBefore, `现金 ${s.players[0].cash}`);
  }
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
