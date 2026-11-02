/**
 * 角色被动接线自检
 */
import { createGame } from './state.mjs';
import { roll, useCard, sendToHospital, applyJail } from './engine.mjs';
import { makeRuleset } from '../config/ruleset.mjs';

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

function game(seed = 1, chars = ['rat', 'cat', 'dog', 'elephant']) {
  return createGame({
    ruleset: makeRuleset('standard', { 'rules.mapId': 'small' }),
    mapId: 'small',
    names: ['甲', '乙', '丙', '丁'],
    seed,
    characterIds: chars,
  });
}

console.log('1) 鼠：踩卡片格多拿一张');
{
  let s = game(1, ['rat', 'cat', 'dog', 'elephant']);
  const idx = s.tiles.findIndex((t) => t.label === 'card');
  const p = s.players[0];
  p.pos = (idx - 1 + s.tiles.length) % s.tiles.length;
  p.hand = [];
  s.pendingDice = 1;
  s = roll(s);
  const hand = s.players[0].hand;
  check('拿到 2 张卡', hand.length === 2, `手牌 ${hand.length}`);
}

console.log('2) 猫：减速状态 -1 天');
{
  let s = game(2, ['wolf', 'cat', 'dog', 'elephant']);
  s.players[1].pos = (s.players[0].pos + 3) % s.tiles.length;
  s.players[0].hand = ['turtle'];
  s = useCard(s, 'turtle', 1);
  check('乌龟从 3 回合变 2 回合', s.players[1].slow === 2, `slow=${s.players[1].slow}`);
}

console.log('3) 狗：入狱 -1 天');
{
  let s = game(3, ['wolf', 'dog', 'lion', 'rat']);
  s.players[1].skip = 0;
  applyJail(s, s.players[1], 3);
  check('入狱 3 天 → 2 天', s.players[1].skip === 2, `skip=${s.players[1].skip}`);
}

console.log('4) 象：住院 -1 天');
{
  let s = game(4, ['wolf', 'dog', 'lion', 'elephant']);
  s.players[3].skip = 0;
  sendToHospital(s, s.players[3], 3, '测试');
  check('住院 3 天 → 2 天', s.players[3].skip === 2, `skip=${s.players[3].skip}`);
}

console.log('5) 豹：路障射程 +3');
{
  let s = game(5, ['leopard', 'dog', 'lion', 'rat']);
  const p = s.players[0];
  p.pos = 0;
  p.dir = 1;
  p.hand = ['barrier'];
  // 基础射程 15，豹 +3 → 18 内有效
  const okInside = useCard(s, 'barrier', 17);
  check('17 格内可以放', okInside !== s, '已放置');
  const out = useCard(s, 'barrier', 25);
  check('25 格被拒绝', out === s);
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
