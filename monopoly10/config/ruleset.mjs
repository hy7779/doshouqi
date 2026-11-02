/**
 * 大富翁10 简陋版 · 规则配置（ruleset）
 *
 * 约定（重要，别改）：
 *   1. 金额一律用「元」的整数。任何比例用整数表示，不留浮点：
 *        - 百分比：25 表示 25%
 *        - 万分比：20 表示 0.20%（1bp）
 *      这样整条计算链路都是整数，最后一步才四舍五入，
 *      房主和客户端算出来的结果一模一样。
 *   2. 这份对象必须能 JSON.stringify / parse 往返不丢信息（联机时整份下发给客户端）。
 *   3. 改结构（加字段/删字段/改单位）时 schema +1，并写迁移说明。
 */

export const SCHEMA = 1;

/* ------------------------------------------------------------------ *
 * 预设：开房时先选一套，再按白名单微调
 * 三套只差几个全局倍率与起始资金，其余共用 DEFAULT
 * ------------------------------------------------------------------ */
export const PRESETS = {
  casual: {
    labels: { name: '休闲', desc: '起步宽裕、租金温和，适合边聊边玩' },
    patch: {
      'economy.initialCash': 200000,
      'multipliers.rentBp': 8000,    // 租金 ×0.8
      'multipliers.salaryBp': 12000, // 工资 ×1.2
    },
  },
  standard: {
    labels: { name: '标准', desc: '默认节奏，45 回合内能分出差距' },
    patch: {},
  },
  brutal: {
    labels: { name: '残酷', desc: '起步紧、租金高，前期就可能出局' },
    patch: {
      'economy.initialCash': 120000,
      'multipliers.rentBp': 13000,   // 租金 ×1.3
      'multipliers.salaryBp': 9000,  // 工资 ×0.9
    },
  },
};

/* ------------------------------------------------------------------ *
 * 默认值（= standard 的数值）
 * ------------------------------------------------------------------ */
export const DEFAULT_RULESET = {
  schema: SCHEMA,
  preset: 'standard',

  /**
   * 全局倍率，作用在最终结算上（万分比，10000 = ×1.0）
   * 改一个就能整体调快/调慢，不用逐个改数值。
   */
  multipliers: {
    rentBp: 10000,      // 租金倍率
    salaryBp: 10000,    // 工资倍率
    inflationBp: 10000, // 物价指数倍率（作用在指数本身，不是租金）
  },

  economy: {
    initialCash: 150000,      // 开局现金
    salary: 45000,            // 经过起点、每圈工资（未乘物价）
    hospitalFeePerDay: 7500,  // 住院/入狱每天医疗费
    jailFine: 0,              // 保释金（暂未启用，留位）
    wageTileBase: 3000,       // 工资格基准
    wageTileGrowthPercent: 10,// 每过一天，工资格 +10%
  },

  land: {
    small: {
      // 三档地价
      tiers: [2000, 3000, 4000],
      upgradeRate: 60,                              // 兼容旧字段，实际升级费 = 目标级数 × 地价
      rentOfInvestmentPercent: 40,                  // 租金 = 累计投入 × 40%
      chainBonus: [0, 10, 20, 30, 40],              // 连 1/2/3/4/5 块时的加成百分比
    },
    big: {
      // 大地皮占 2 格，走到任一格都可操作
      prices: [10000],
      upgradeRate: 50,
      rentOfInvestmentPercent: 40,
      maxLevel: 5,
    },
  },

  buildings: {
    // 六种大型建筑；数值全部是整数百分比或元
    mall:   { spinMin: 10000, spinMax: 30000, levelScale: [100, 130, 170, 220, 280] },
    oil:    { incomePerLevel: 1500, energyFee: 15 },
    bank2:  { transferRate: 2, capPerTarget: 22500 },
    hotel:  { rentRate: 6, stayTurns: 1 },
    lab:    { produceEvery: 5, fromLevel: 3, nukeEvery: 15 },
    temple: { rentBonusPerLevel: 5 },
  },

  cards: {
    prices: { common: 2000, rare: 5000, legend: 8000 },
    shop: { count: 12, weights: [60, 30, 10] },   // 普通/稀有/传说 抽取权重
    hand: { startCards: 0, limit: 8 },
  },

  lottery: {
    ticketPrice: 500,
    numbers: 31,                                   // 号码池大小
    winners: { first: 1, second: 3, third: 5 },    // 各奖项的中奖号码个数
    poolGrowthPerRound: 7500,                      // 奖池每回合自然增长
    split: [50, 30, 20],                           // 一二三等奖的奖池占比
    payoutPercent: 30,                             // 每期只拿出奖池的 30% 发奖，其余滚存
  },

  bank: {
    interestPercent: 10,   // 每次结算：存款余额 × 10%
    cycleTurnsPerPlayer: 3,// 每「人数 × 3」个回合结算一次
  },

  inflation: {
    baseBp: 10000,     // 初值 1.00
    stepBp: 200,       // 每回合 +0.02
    capBp: 25000,      // 上限 2.50
    rentUses: true,    // 租金是否乘物价
    salaryMode: 'sqrt', // 工资乘 sqrt(物价)，低于租金涨幅
  },

  rules: {
    maxRounds: 45,                   // 回合上限（与 maps 的推荐值配合）
    mapId: 'medium',                 // 引用 maps.mjs 的 id
    bankruptcyOrder: ['cash', 'deposit'], // 扣款顺序：先现金后存款，都没有则破产
    skipOnHospital: 1,               // 普通住院/入狱跳过回合数
    skipOnNuke: 3,                   // 核弹住院跳过回合数
  },
};

/* ------------------------------------------------------------------ *
 * 玩家白名单：开房时允许改的字段（点路径 + 范围 + 步进）
 * 完整表只有开发者能改；这里是给房主的旋钮。
 * ------------------------------------------------------------------ */
export const PLAYER_TUNABLE = [
  { path: 'economy.initialCash',          min: 50000, max: 1000000, step: 10000 },
  { path: 'economy.salary',               min: 15000, max: 90000,   step: 5000 },
  { path: 'multipliers.rentBp',           min: 5000,  max: 20000,   step: 500 },
  { path: 'multipliers.salaryBp',         min: 5000,  max: 20000,   step: 500 },
  { path: 'inflation.stepBp',             min: 0,     max: 500,     step: 50 },
  { path: 'rules.maxRounds',              min: 10,    max: 60,      step: 5 },
  { path: 'cards.hand.startCards',        min: 0,     max: 8,       step: 1 },
  { path: 'cards.hand.limit',             min: 4,     max: 12,      step: 1 },
  { path: 'bank.dailyRateBp',             min: 0,     max: 100,     step: 5 },
  { path: 'lottery.poolGrowthPerRound',   min: 0,     max: 30000,   step: 1500 },
];

/* ------------------------------------------------------------------ *
 * 工具：点路径读写（给白名单和预设 patch 用）
 * ------------------------------------------------------------------ */
export function getAt(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setAt(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] = o[k] || {}), obj);
  target[last] = value;
  return obj;
}

export function makeRuleset(presetName = 'standard', overrides = {}) {
  const base = structuredClone(DEFAULT_RULESET);
  base.preset = presetName;
  const preset = PRESETS[presetName];
  if (preset) for (const [k, v] of Object.entries(preset.patch)) setAt(base, k, v);
  for (const [k, v] of Object.entries(overrides || {})) setAt(base, k, v);
  return base;
}

/** 联机传输前统一走一次，确保是纯 JSON 且无浮点 */
export function toWire(ruleset) {
  return JSON.parse(JSON.stringify(ruleset));
}
