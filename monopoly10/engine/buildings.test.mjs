/**
 * 大型建筑六种类型自检
 */
import { createGame } from './state.mjs';
import { roll, endTurn, chooseBigType, cancelBigType, upgrade, rentFor } from './engine.mjs';
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

console.log('1) 大地皮升 1 级要选类型');
{
  let s = game(1);
  const idx = s.tiles.findIndex((t) => t.kind === 'big');
  s.tiles.forEach((t) => { if (t.plotId === s.tiles[idx].plotId) { t.owner = 0; t.level = 0; } });
  s.players[0].cash = 500000;
  s.phase = 'postRoll';
  s = upgrade(s, idx);
  check('进入选类型阶段', s.phase === 'bigType', `phase=${s.phase}`);
  s = chooseBigType(s, 'mall');
  check('类型写入并升到 1 级', s.tiles[idx].type === 'mall' && s.tiles[idx].level === 1,
    `${s.tiles[idx].type} / 等级 ${s.tiles[idx].level}`);
  check('扣了 1 倍地价的建造费', s.players[0].cash < 500000, `现金 ${s.players[0].cash}`);
}

console.log('2) 商业中心租金高于研究所');
{
  const s = game(2);
  const idx = s.tiles.findIndex((t) => t.kind === 'big');
  const pid = s.tiles[idx].plotId;
  s.tiles.forEach((t) => { if (t.plotId === pid) { t.owner = 1; t.level = 1; t.type = 'mall'; } });
  const mallRent = rentFor(s, idx, s.players[0]);
  s.tiles.forEach((t) => { if (t.plotId === pid) { t.type = 'lab'; } });
  const labRent = rentFor(s, idx, s.players[0]);
  check('商业中心 > 研究所', mallRent > labRent, `${mallRent} vs ${labRent}`);
}

console.log('3) 石油公司每回合产钱');
{
  let s = game(3);
  const idx = s.tiles.findIndex((t) => t.kind === 'big');
  const pid = s.tiles[idx].plotId;
  s.tiles.forEach((t) => { if (t.plotId === pid) { t.owner = 0; t.level = 3; t.type = 'oil'; } });
  const before = s.players[0].cash;
  s.turn = s.players.length - 1;
  s.phase = 'postRoll';
  s = endTurn(s);
  check('油田收入到账', s.players[0].cash > before, `+${s.players[0].cash - before}`);
}

console.log('4) 大饭店强制住店');
{
  let s = game(4);
  const idx = s.tiles.findIndex((t) => t.kind === 'big');
  const pid = s.tiles[idx].plotId;
  s.tiles.forEach((t) => { if (t.plotId === pid) { t.owner = 1; t.level = 1; t.type = 'hotel'; } });
  const p = s.players[0];
  p.pos = (idx - 1 + s.tiles.length) % s.tiles.length;
  p.cash = 500000;
  p.skip = 0;
  s.pendingDice = 1;
  s = roll(s);
  check('住店 1 回合', s.players[0].skip >= 1, `skip=${s.players[0].skip}`);
}

console.log('5) 现金不足时不能建，但可以取消');
{
  let s = game(5);
  const idx = s.tiles.findIndex((t) => t.kind === 'big');
  s.tiles.forEach((t) => { if (t.plotId === s.tiles[idx].plotId) { t.owner = 0; t.level = 0; } });
  s.players[0].cash = 100;
  s.phase = 'postRoll';
  s = upgrade(s, idx);
  check('进入选类型阶段', s.phase === 'bigType');
  const before = s;
  const afterPick = chooseBigType(s, 'mall');
  check('钱不够时选择无效', afterPick === before);
  const cancelled = cancelBigType(afterPick);
  check('可以取消，地皮保持 0 级', cancelled.phase === 'postRoll' && cancelled.tiles[idx].level === 0);
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
