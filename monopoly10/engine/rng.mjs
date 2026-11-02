/**
 * 确定性随机数（mulberry32）
 * 种子存在 state 里，每次抽数都写回 —— 同一份存档 / 同一次开局，
 * 任何人重放都会得到一模一样的序列。
 */

export function makeSeed(seed) {
  return (seed >>> 0) || 1;
}

export function rngNext(state) {
  let a = state.rngSeed >>> 0;
  a = (a + 0x6d2b79f5) >>> 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  state.rngSeed = a;
  return value;
}

/** 闭区间整数：[min, max] */
export function rngInt(state, min, max) {
  return min + Math.floor(rngNext(state) * (max - min + 1));
}

export function rngPick(state, arr) {
  return arr[rngInt(state, 0, arr.length - 1)];
}

/** 2d6 */
export function rollDice(state) {
  const a = rngInt(state, 1, 6);
  const b = rngInt(state, 1, 6);
  return { dice: [a, b], sum: a + b };
}
