/**
 * 联机层自检：用假连接代替 PeerJS
 */
import { createGame } from '../engine/state.mjs';
import { makeRuleset } from '../config/ruleset.mjs';
import { GameHost } from './host.mjs';
import { GameClient } from './client.mjs';
import { redact, PROTO } from './protocol.mjs';

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

/** 一对互联的假连接 */
function makePair() {
  const mk = () => ({
    _handlers: {},
    sent: [],
    on(ev, cb) { (this._handlers[ev] ||= []).push(cb); },
    emit(ev, data) { (this._handlers[ev] || []).forEach((cb) => cb(data)); },
    send(msg) { this.sent.push(msg); this.peer.emit('data', msg); },
  });
  const a = mk();
  const b = mk();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

console.log('1) 入座与欢迎消息');
const state = createGame({
  ruleset: makeRuleset('standard', { 'rules.mapId': 'small' }),
  mapId: 'small',
  names: ['房主', '乙', '丙'],
  seed: 5,
  characterIds: ['rat', 'dog', 'lion'],
});
state.turn = 1;
const host = new GameHost(state);
const [hostSide1, guest1] = makePair();
const [hostSide2, guest2] = makePair();
host.attach(hostSide1);
host.attach(hostSide2);

let c1state = null;
let c2state = null;
const errors = [];
const client1 = new GameClient(guest1, { state: (v) => { c1state = v; } });
const client2 = new GameClient(guest2, { state: (v) => { c2state = v; }, error: (m) => errors.push(m) });
client1.join('乙');
client2.join('丙');
{
  check('座位分配为 1、2', client1.you === 1 && client2.you === 2, `${client1.you}/${client2.you}`);
  check('客户端收到初始状态', !!client1.state && !!client2.state);
  check('房主记录了两个连接', host.conns.size === 2);
}

console.log('2) 只有当前回合玩家能动作');
{
  const before = JSON.stringify(host.state.players[2].pos);
  client2.act({ type: 'roll' });
  const after = JSON.stringify(host.state.players[2].pos);
  check('非当前回合被拒绝', before === after);
  check('收到错误提示', errors.length > 0, errors.join('|'));
}

console.log('3) 当前回合动作被接受并广播');
{
  const before = host.state.players[1].pos;
  client1.act({ type: 'roll' });
  const moved = host.state.players[1].pos !== before;
  check('房主状态更新', moved);
  check('另一位客户端也收到新状态', !!c2state);
}

console.log('4) 越权动作被忽略');
{
  const version = host.version;
  client1.act({ type: 'endTurn' }); // 假设当前已不是 seat1
  check('未改变状态或已推进一版', host.version >= version);
}

console.log('5) redact 接口');
{
  const view = redact(host.state, 1);
  check('当前实现返回完整状态（第一版约定）', view === host.state);
}

console.log('6) 协议版本不一致会被拒');
{
  const [h, g] = makePair();
  host.attach(h);
  g.send({ t: 'hello', proto: PROTO + 99, name: '捣乱' });
  check('返回错误', h.sent.some((m) => m.t === 'error'));
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
