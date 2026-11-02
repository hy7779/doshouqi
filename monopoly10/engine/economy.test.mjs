/**
 * 银行 / 彩票 / 魔法屋 自检
 */
import { createGame } from './state.mjs';
import { roll, endTurn, bankDeposit, bankWithdrawAll, leaveBank, buyLottery, leaveLottery, magicDraw, leaveMagic } from './engine.mjs';
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

console.log('1) 银行存取');
{
  let s = game(1);
  s.phase = 'bank';
  s.players[0].cash = 100000;
  s = bankDeposit(s, 50);
  check('存入一半', s.players[0].deposit === 50000 && s.players[0].cash === 50000,
    `现金 ${s.players[0].cash} 存款 ${s.players[0].deposit}`);
  s = bankWithdrawAll(s);
  check('取出全部', s.players[0].deposit === 0 && s.players[0].cash === 100000);
  s = leaveBank(s);
  check('离开银行', s.phase === 'postRoll');
}

console.log('2) 利息（18 回合一次）');
{
  let s = game(2);
  s.players[0].deposit = 100000;
  s.turn = s.players.length - 1;
  s.turnCount = s.players.length * 3 - 1;
  s.phase = 'postRoll';
  s = endTurn(s);
  const expect = 10000;
  check('每 3 轮（人数×3 回合）结算利息', s.players[0].deposit === 100000 + expect,
    `存款 ${s.players[0].deposit}（期望 ${100000 + expect}）`);
}

console.log('3) 彩票购买');
{
  let s = game(3);
  s.phase = 'lottery';
  s.players[0].cash = 100000;
  const pool0 = s.lottery.pool;
  s = buyLottery(s, 2);
  const count = Object.keys(s.lottery.tickets).length;
  check('买到 2 张', count === 2, `号码 ${Object.keys(s.lottery.tickets).join(',')}`);
  check('奖池增加', s.lottery.pool === pool0 + 2 * s.ruleset.lottery.ticketPrice);
  check('扣了钱', s.players[0].cash === 100000 - 2 * s.ruleset.lottery.ticketPrice);
  s = leaveLottery(s);
  check('离开彩票点', s.phase === 'postRoll');
}

console.log('4) 彩票开奖（第 30 回合）');
{
  let s = game(4);
  s.lottery.tickets = { 7: 0 };
  s.lottery.pool = 100000;
  s.turn = s.players.length - 1;
  s.turnCount = s.players.length * 3 - 1;
  s.phase = 'postRoll';
  s = endTurn(s);
  check('每 3 轮开一次奖', s.lottery.period === 2, `period=${s.lottery.period}`);
  check('票被清空', Object.keys(s.lottery.tickets).length === 0);
  check('开出 9 个中奖号', s.lottery.drawn.length === 9, `号码 ${s.lottery.drawn.join(',')}`);
}

console.log('5) 魔法屋（落地随机事件）');
{
  let fired = 0;
  const samples = [];
  for (let seed = 1; seed <= 30; seed++) {
    let s = game(seed);
    const idx = s.tiles.findIndex((t) => t.label === 'magic');
    if (idx < 0) continue;
    const p = s.players[0];
    p.pos = (idx - 1 + s.tiles.length) % s.tiles.length;
    s.pendingDice = 1;
    const before = s.log.length;
    s = roll(s);
    const added = s.log.slice(before).map((l) => l.text);
    const hit = added.find((x) => x.includes('魔法屋'));
    if (hit) {
      fired++;
      if (samples.length < 4) samples.push(hit);
    }
  }
  check('踩到魔法屋会触发随机事件', fired >= 25, `${fired}/30 次`);
  for (const s of samples) console.log('   · ' + s);
}

console.log('6) 系统地产租金进彩票池');
{
  let s = game(6);
  const idx = s.tiles.findIndex((t) => t.kind === 'small');
  const t = s.tiles[idx];
  t.owner = -1;
  t.level = 2;
  const p = s.players[0];
  p.pos = (idx - 1 + s.tiles.length) % s.tiles.length;
  p.cash = 500000;
  s.pendingDice = 1;
  const pool0 = s.lottery.pool;
  s = roll(s);
  check('租金进了奖池', s.lottery.pool > pool0, `奖池 ${pool0} → ${s.lottery.pool}`);
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
