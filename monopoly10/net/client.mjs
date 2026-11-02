/**
 * 客户端：只发动作、只收视图
 * 传输层同样抽象：{ send(obj), on('data'|'close', cb) }
 */
import { MSG, hello, actionMsg } from './protocol.mjs';

export class GameClient {
  constructor(conn, handlers = {}) {
    this.conn = conn;
    this.you = null;
    this.seats = [];
    this.state = null;
    this.handlers = handlers;
    conn.on('data', (msg) => this.handle(msg));
    conn.on('close', () => this.handlers.close?.());
  }

  join(name) {
    this.conn.send(hello(name));
  }

  handle(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case MSG.WELCOME:
        this.you = msg.you;
        this.seats = msg.seats;
        this.state = msg.view;
        this.handlers.welcome?.(msg);
        break;
      case MSG.STATE:
        this.state = msg.view;
        this.handlers.state?.(msg.view, msg.turn);
        break;
      case MSG.SEATS:
        this.seats = msg.seats;
        this.handlers.seats?.(msg.seats);
        break;
      case MSG.ERROR:
        this.handlers.error?.(msg.message);
        break;
      default:
        break;
    }
  }

  act(action) {
    this.conn.send(actionMsg(action));
  }

  get isMyTurn() {
    return !!this.state && this.state.turn === this.you;
  }
}
