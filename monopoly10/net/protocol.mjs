/**
 * 联机协议 · 第一版
 *
 * 设计：
 *   - 房主权威：只有房主持有真 state，客户端只发动作、只收视图
 *   - 视图统一走 redact(state, viewerId) —— 第一版直接返回原状态（全量），
 *     以后想藏手牌只改这一个函数，协议和 UI 都不用动
 *   - 座位号 = 玩家 id；房主是 0 号
 */

export const PROTO = 1;

/** 按观众裁剪状态。第一版不裁剪，保留接口。 */
export function redact(state, viewerId) {
  return state;
}

export const MSG = {
  HELLO: 'hello',
  WELCOME: 'welcome',
  ACTION: 'action',
  STATE: 'state',
  ERROR: 'error',
  SEATS: 'seats',
};

export function hello(name) {
  return { t: MSG.HELLO, proto: PROTO, name };
}

export function welcome({ you, seats, view, hostSeat }) {
  return { t: MSG.WELCOME, proto: PROTO, you, seats, view, hostSeat };
}

export function stateMsg(view, turn) {
  return { t: MSG.STATE, view, turn };
}

export function actionMsg(action) {
  return { t: MSG.ACTION, proto: PROTO, action };
}

export function errorMsg(message) {
  return { t: MSG.ERROR, message };
}

export function seatsMsg(seats) {
  return { t: MSG.SEATS, seats };
}

/** 简化给 UI 的座位信息 */
export function seatInfo(state) {
  return state.players.map((p) => ({
    id: p.id, name: p.name, charId: p.charId, alive: p.alive, cash: p.cash,
  }));
}
