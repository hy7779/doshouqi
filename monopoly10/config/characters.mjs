/**
 * 角色表 · 斗兽棋八兽，各带 3 个被动
 *
 * 全部是数据：{ id, name, token, tagline, mods:[{ type, ...整数参数 }] }
 * 引擎按 mod.type 在对应结算点读取修正值；新增角色不改代码。
 *
 * 数值都是整数：
 *   百分比字段用整数（20 = +20%）
 *   天数/格数用整数
 *   减免类用负数（-15 = 少付 15%）
 */

export const CHARACTER_LIST = [
  {
    id: 'rat', name: '鼠', token: '🐭', tagline: '卡牌窃贼，越乱越强',
    mods: [
      { type: 'startCard', cardId: 'rob' },
      { type: 'cardRangeBonus', cardId: 'rob', tiles: 5 },
      { type: 'cardDrawExtra', tile: 'card', count: 1 },
    ],
  },
  {
    id: 'cat', name: '猫', token: '🐱', tagline: '走位灵活，想停哪就停哪',
    mods: [
      { type: 'startCard', cardId: 'dice' },
      { type: 'cardRangeBonus', cardId: 'reverse', tiles: 5 },
      { type: 'statusReduce', status: 'slow', days: 1 },
    ],
  },
  {
    id: 'dog', name: '狗', token: '🐶', tagline: '守得住，才活得久',
    mods: [
      { type: 'rentOutPercent', percent: -15 },
      { type: 'startCard', cardId: 'pardon' },
      { type: 'jailReduceDays', days: 1 },
    ],
  },
  {
    id: 'wolf', name: '狼', token: '🐺', tagline: '主动卡就是他的牙齿',
    mods: [
      { type: 'damageOutPercent', percent: 20 },
      { type: 'cardParamBonus', cardId: 'audit', field: 'percent', value: 5 },
      { type: 'cardDrawExtra', tile: 'god', count: 1 },
    ],
  },
  {
    id: 'leopard', name: '豹', token: '🐆', tagline: '起跑线就领先半个身位',
    mods: [
      { type: 'startCashPercent', percent: 20 },
      { type: 'salaryPercent', percent: 15 },
      { type: 'cardRangeBonus', cardId: 'barrier', tiles: 3 },
    ],
  },
  {
    id: 'tiger', name: '虎', token: '🐯', tagline: '地产是他真正的领地',
    mods: [
      { type: 'rentInPercent', percent: 20 },
      { type: 'chainBonusPercent', percent: 5 },
      { type: 'buildDiscountPercent', percent: 10 },
    ],
  },
  {
    id: 'lion', name: '狮', token: '🦁', tagline: '钱生钱，神也偏向他',
    mods: [
      { type: 'startCashPercent', percent: 15 },
      { type: 'startDepositPercent', percent: 35 },
      { type: 'godDuration', godId: 'wealth', days: 2 },
    ],
  },
  {
    id: 'elephant', name: '象', token: '🐘', tagline: '皮厚，扛得住一切',
    mods: [
      { type: 'hospitalReduceDays', days: 1 },
      { type: 'godDuration', godId: 'poverty', days: -1 },
      { type: 'damageInPercent', percent: -20 },
    ],
  },
];

/** 所有可用的修正类型（引擎需要逐条实现读取点） */
export const MOD_TYPES = [
  'startCashPercent', 'startDepositPercent', 'salaryPercent',
  'rentInPercent', 'rentOutPercent', 'chainBonusPercent',
  'damageOutPercent', 'damageInPercent',
  'buildDiscountPercent', 'shopDiscountPercent', 'bankInterestPercent',
  'startCard', 'cardDrawExtra', 'cardRangeBonus', 'cardParamBonus',
  'godDuration', 'statusReduce', 'jailReduceDays', 'hospitalReduceDays',
];

export function validateCharacters(list = CHARACTER_LIST) {
  const errors = [];
  const ids = new Set();
  for (const c of list) {
    if (ids.has(c.id)) errors.push(`重复角色 id: ${c.id}`);
    ids.add(c.id);
    if (!c.mods?.length) errors.push(`${c.id}: 没有被动`);
    for (const m of c.mods || []) {
      if (!MOD_TYPES.includes(m.type)) errors.push(`${c.id}: 未知修正类型 ${m.type}`);
      for (const [k, v] of Object.entries(m)) {
        if (typeof v === 'number' && !Number.isInteger(v)) errors.push(`${c.id}.${m.type}.${k} 不是整数`);
      }
    }
  }
  if (list.length !== 8) errors.push(`角色数量应为 8，当前 ${list.length}`);
  return errors;
}

/** 场上有 N 人时随机分配角色（保证不重复） */
export function assignCharacters(count, rng) {
  const pool = [...CHARACTER_LIST];
  const out = [];
  for (let i = 0; i < count && pool.length; i++) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0].id);
  }
  return out;
}
