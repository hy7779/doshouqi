/**
 * 神仙系统 + 嫁祸选人 自检
 */
import { createGame } from './state.mjs';
import { useCard, roll, respondReaction, hasGod, sendToHospital } from './engine.mjs';
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

console.log('1) 请神卡');
{
  let s = game(1);
  const idx = 6;
  s.tiles[idx].god = 'wealth';
  s.players[0].pos = 0;
  s.players[0].hand = ['summon'];
  s = useCard(s, 'summon');
  check('神仙附到身上', hasGod(s.players[0], 'wealth'), JSON.stringify(s.players[0].gods));
  check('地图上被清掉', s.tiles[idx].god === null);
}

console.log('2) 送神卡');
{
  let s = game(2);
  s.players[0].gods = [{ id: 'poverty', remaining: 3 }];
  s.players[0].bomb = 12;
  s.players[0].hand = ['dismiss'];
  s = useCard(s, 'dismiss');
  check('神仙被送走', s.players[0].gods.length === 0);
  check('炸弹也被清掉', s.players[0].bomb === null);
}

console.log('3) 福神免疫');
{
  let s = game(3);
  s.players[1].gods = [{ id: 'luck', remaining: 5 }];
  s.players[0].hand = ['frame'];
  const before = s.phase;
  s = useCard(s, 'frame', 1);
  check('陷害被挡下', s.players[1].zone === 'ring' && s.players[1].skip === 0);
  check('卡牌没有被消耗', s.players[0].hand.includes('frame'));
}

console.log('4) 衰神加刑');
{
  let s = game(4);
  s.players[0].gods = [{ id: 'doom', remaining: 3 }];
  s.players[0].skip = 0;
  sendToHospital(s, s.players[0], 1, '测试');
  check('住院变成 2 回合', s.players[0].skip === 2, `skip=${s.players[0].skip}`);
}

console.log('5) 天使免费升级');
{
  let s = game(5);
  const idx = 8;
  s.tiles[idx] = { ...s.tiles[idx], kind: 'small', streetId: 'T', price: 20000, owner: 1, level: 2 };
  const p = s.players[0];
  p.pos = (idx - 1 + s.tiles.length) % s.tiles.length;
  p.gods = [{ id: 'angel', remaining: 5 }];
  p.cash = 500000;
  s.pendingDice = 1;
  s = roll(s);
  check('建筑被升到 3 级', s.tiles[idx].level === 3, `level=${s.tiles[idx].level}`);
}

console.log('6) 嫁祸卡选人');
{
  let s = game(6);
  s.players[0].gods = [];
  s.players[2].hand = ['blame'];
  s.players[2].cash = 500000;
  s.players[0].hand = ['frame'];
  // 甲陷害丙，丙用嫁祸指给乙
  s = useCard(s, 'frame', 2);
  check('丙进入响应', s.phase === 'reaction', `phase=${s.phase}`);
  const before = s.players[1].skip;
  s = respondReaction(s, 'blame', 1);
  check('乙替丙坐牢', s.players[1].skip > before && s.players[2].skip === 0,
    `乙 skip=${s.players[1].skip} 丙 skip=${s.players[2].skip}`);
}

console.log('7) 神仙会自然刷新');
{
  let s = game(7);
  let seen = 0;
  for (let i = 0; i < 12 && s.phase !== 'ended'; i++) {
    while (s.phase === 'postRoll' || s.phase === 'awaitBuy') {
      s = s.phase === 'awaitBuy' ? s : s;
      break;
    }
    if (s.phase === 'preRoll') s = roll(s);
    if (s.phase === 'reaction') s = respondReaction(s, null);
    if (s.phase === 'awaitBuy') { s.phase = 'postRoll'; }
    if (s.phase === 'shop') { s.phase = 'postRoll'; }
    if (s.phase === 'postRoll') { s.players[s.turn].pos = s.players[s.turn].pos; s.phase = 'postRoll'; }
    // 直接推进到下一回合
    const { endTurn } = await import('./engine.mjs');
    if (s.phase === 'postRoll') s = endTurn(s);
    seen = Math.max(seen, s.players.reduce((n, p) => n + (p.gods?.length || 0), 0));
  }
  console.log(`  12 回合内最多同时附身 ${seen} 人（随机，仅供观察）`);
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
