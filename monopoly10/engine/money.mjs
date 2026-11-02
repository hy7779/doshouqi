/**
 * 整数货币运算
 * 所有金额都是「元」的整数；比例一律用整数百分比/万分比传入。
 * 这样房主与客户端算出来的结果绝对一致（没有浮点累积误差）。
 */

export const isInt = (n) => typeof n === 'number' && Number.isInteger(n);

/**
 * (value × num / den) 四舍五入，全程整数（内部用 BigInt 保证精确）
 * 例：mulDivRound(45000, 125, 100) = 56250
 */
export function mulDivRound(value, num, den) {
  if (!isInt(value) || !isInt(num) || !isInt(den)) {
    throw new Error(`mulDivRound 只接受整数：${value}, ${num}, ${den}`);
  }
  if (den === 0) throw new Error('mulDivRound 除数为 0');
  const sign = Math.sign(value) * Math.sign(num) * Math.sign(den) || 1;
  const v = BigInt(Math.abs(value));
  const n = BigInt(Math.abs(num));
  const d = BigInt(Math.abs(den));
  // floor((2*v*n + d) / (2*d)) = 四舍五入
  const q = (2n * v * n + d) / (2n * d);
  return sign * Number(q);
}

/** 百分比：pct(45000, 15) = 6750（15%） */
export function pct(value, percent) {
  return mulDivRound(value, percent, 100);
}

/** 万分比：bp(100000, 20) = 200（0.20%） */
export function bp(value, basisPoints) {
  return mulDivRound(value, basisPoints, 10000);
}

/** 整数平方根（用于工资按 √物价 增长） */
export function intSqrt(n) {
  if (n < 0) throw new Error('intSqrt 不接受负数');
  if (n < 2) return n;
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

/** 数值区间夹取（整数） */
export function clampInt(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** 断言：整局状态里所有金额都必须是整数 */
export function assertIntegerMoney(value, path = '') {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error(`非整数金额：${path} = ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertIntegerMoney(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertIntegerMoney(v, path ? `${path}.${k}` : k);
  }
}
