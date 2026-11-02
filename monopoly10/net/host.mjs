/**
 * 房主：持有唯一真 state，接收客户端动作并广播视图
 *
 * 传输层是抽象的：只要对象有 send(obj) 和 on('data', cb) / on('close', cb) 就行，
 * 这样测试里可以用假连接，浏览器里用 PeerJS 的 DataConnection。
 */
import { MSG, PROTO, redact, welcome, stateMsg, actionMsg, errorMsg, seatInfo, seatsMsg } from './protocol.mjs';
import { applyAction } from '../engine/engine.mjs';

export class GameHost {
  constructor(state, { onChange } = {}) {
    this.state = state;
    this.conns = new Map();   // seatId -> conn
    this.onChange = onChange || (() => {});
    this.version = 0;
  }

  get seatCount() {
    return this.conns.size + 1; // 房主自己算 0 号
  }

  /** 房主自己的座位是 0 */
  get hostSeat() {
    return 0;
  }

  attach(conn) {
    conn.on('data', (msg) => this.handleMessage(conn, msg));
    conn.on('close', () => this.dropConn(conn));
    return conn;
  }

  seatOf(conn) {
    for (const [seat, c] of this.conns) if (c === conn) return seat;
    return null;
  }

  handleMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.proto !== undefined && msg.proto !== PROTO) {
      conn.send(errorMsg('协议版本不一致，请刷新页面'));
      return;
    }

    if (msg.t === MSG.HELLO) return this.acceptJoin(conn, msg);

    const seat = this.seatOf(conn);
    if (seat == null) {
      conn.send(errorMsg('你还没有入座'));
      return;
    }

    if (msg.t === MSG.ACTION) return this.receiveAction(seat, msg.action);
  }

  acceptJoin(conn, msg) {
    if (this.state.players.length >= 8) {
      conn.send(errorMsg('房间已满'));
      return;
    }
    const used = new Set([this.hostSeat, ...this.conns.keys()]);
    let seat = 1;
    while (used.has(seat)) seat++;
    if (seat >= this.state.players.length) {
      conn.send(errorMsg('这局已经坐满了'));
      return;
    }
    this.conns.set(seat, conn);
    conn.send(welcome({
      you: seat,
      seats: seatInfo(this.state),
      view: redact(this.state, seat),
      hostSeat: this.hostSeat,
    }));
    this.broadcast();
    this.onChange();
  }

  dropConn(conn) {
    for (const [seat, c] of [...this.conns]) {
      if (c === conn) {
        this.conns.delete(seat);
        this.broadcast();
        this.onChange();
      }
    }
  }

  /** 只有当前回合玩家的动作才被接受 */
  receiveAction(seat, action) {
    if (this.state.phase === 'ended') return;
    if (seat !== this.state.turn) {
      this.conns.get(seat)?.send(errorMsg('还没轮到你'));
      return;
    }
    try {
      const next = applyAction(this.state, action);
      if (next === this.state) return; // 非法动作，忽略
      this.state = next;
      this.version++;
      this.broadcast();
      this.onChange();
    } catch (err) {
      this.conns.get(seat)?.send(errorMsg(err.message));
    }
  }

  /** 房主自己的操作，和客户端走同一个入口 */
  act(action) {
    const next = applyAction(this.state, action);
    if (next === this.state) return false;
    this.state = next;
    this.version++;
    this.broadcast();
    this.onChange();
    return true;
  }

  broadcast() {
    for (const [seat, conn] of this.conns) {
      conn.send(stateMsg(redact(this.state, seat), this.state.turn));
    }
  }

  sendSeats() {
    for (const [, conn] of this.conns) conn.send(seatsMsg(seatInfo(this.state)));
  }
}
