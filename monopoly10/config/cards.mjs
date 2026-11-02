/**
 * 30 张卡片 · 纯数据
 *
 * 设计约定：
 *   - 每张卡 = 一个枚举类型（effect.type）+ 一组成员整数参数
 *   - 不放函数、不放浮点 → 可以直接 JSON 下发，房主校验、客户端渲染
 *   - 效果逻辑在 engine 里按 type 分发；这里只描述"是什么卡、有什么参数"
 *   - 新增一张卡 = 加一条数据；新增一种效果 = 在 engine 里加一个 type
 *
 * 字段：
 *   id        唯一标识（英文，进代码）
 *   name      中文名
 *   rarity    common | rare | legend（对应商店价格与抽取权重）
 *   timing    active（自己回合用） | reactive（被结算时弹窗触发）
 *   target    self | other | tile | street | none
 *   minRound  从第几回合起可被抽到（0 = 一开局就有）
 *   effect    { type, ...整数参数 }
 */

export const CARD_LIST = [
  /* ---------------- 控场与移动 ---------------- */
  {
    id: 'dice', name: '遥控骰子', rarity: 'rare', timing: 'active', target: 'self', minRound: 0,
    effect: { type: 'chooseDice', minStep: 1, maxStep: 6 },
    desc: '自行指定 1–6 步，遇到岔路可任选方向（医院/监狱方向除外）。',
  },
  {
    id: 'barrier', name: '路障', rarity: 'common', timing: 'active', target: 'tile', minRound: 0,
    effect: { type: 'placeBarrier', range: 15, durationTurns: 3 },
    desc: '在指定地点放置路障，强制路过的角色停下。',
  },
  {
    id: 'freeze', name: '停留', rarity: 'common', timing: 'active', target: 'other', minRound: 0,
    effect: { type: 'freeze', radius: 15, turns: 1 },
    desc: '让周围 15 格内任意角色冰冻 1 回合。',
  },
  {
    id: 'reverse', name: '转向', rarity: 'common', timing: 'active', target: 'other', minRound: 0,
    effect: { type: 'reverse', radius: 15 },
    desc: '令周围 15 格内任意角色掉头。',
  },
  {
    id: 'turtle', name: '乌龟', rarity: 'rare', timing: 'active', target: 'other', minRound: 0,
    effect: { type: 'turtle', turns: 3, steps: 1 },
    desc: '附身任意角色 3 回合，期间每次只能走 1 步。',
  },
  {
    id: 'robot', name: '机器娃娃', rarity: 'rare', timing: 'active', target: 'self', minRound: 0,
    effect: { type: 'clearObstacles', range: 10 },
    desc: '扫清前方 10 步内的神仙、地雷、野狗。',
  },

  /* ---------------- 地产干预 ---------------- */
  {
    id: 'buyLand', name: '购地卡', rarity: 'legend', timing: 'active', target: 'tile', minRound: 0,
    effect: { type: 'forceBuy', payPrice: 1, payUpgrade: 1 },
    desc: '强制收购所在土地，需支付地价与加盖费。',
  },
  {
    id: 'swapHouse', name: '换屋卡', rarity: 'rare', timing: 'active', target: 'tile', minRound: 0,
    effect: { type: 'swapProperty', sameGroupOnly: 1 },
    desc: '把自己的一处房产与对手的交换。',
  },
  {
    id: 'rebuild', name: '改建卡', rarity: 'rare', timing: 'active', target: 'tile', minRound: 0,
    effect: { type: 'rebuildProperty', allowPark: 1, keepLevel: 1 },
    desc: '把所在格建筑改成任意类型，也可把公园复原。',
  },
  {
    id: 'seal', name: '查封卡', rarity: 'rare', timing: 'active', target: 'street', minRound: 0,
    effect: { type: 'sealStreet', untilCorner: 1, turns: 0 },
    desc: '查封当前街道到转弯处所有非己方建筑，使其无法收租。',
  },
  {
    id: 'excavator', name: '工程车卡', rarity: 'rare', timing: 'active', target: 'tile', minRound: 0,
    effect: { type: 'demolish', range: 8, pickMin: 1, pickMax: 5, levels: 1 },
    desc: '拆除前方 8 格内 1–5 格非己方房屋，各降 1 级。',
  },
  {
    id: 'worker', name: '机器工人卡', rarity: 'common', timing: 'active', target: 'self', minRound: 0,
    effect: { type: 'upgradeOwn', levels: 1 },
    desc: '为自己任意一处房屋加盖 1 级。',
  },
  {
    id: 'priceUp', name: '涨价卡', rarity: 'common', timing: 'active', target: 'street', minRound: 0,
    effect: { type: 'raisePrice', multPercent: 200, turns: 6 },
    desc: '所选街道地价翻倍，持续 6 回合。',
  },

  /* ---------------- 攻击与干扰 ---------------- */
  {
    id: 'frame', name: '陷害卡', rarity: 'rare', timing: 'active', target: 'other', minRound: 0,
    effect: { type: 'jail', turns: 1 },
    desc: '陷害一名敌人入狱。',
  },
  {
    id: 'audit', name: '查税卡', rarity: 'rare', timing: 'active', target: 'other', minRound: 0,
    effect: { type: 'tax', percent: 15 },
    desc: '从指定敌人处获得其 15% 现金。',
  },
  {
    id: 'rob', name: '抢夺卡', rarity: 'common', timing: 'active', target: 'other', minRound: 0,
    effect: { type: 'stealCard', radius: 15, count: 1 },
    desc: '随机抢夺周围角色一张手牌。',
  },
  {
    id: 'equalizePoor', name: '均贫卡', rarity: 'common', timing: 'active', target: 'other', minRound: 0,
    effect: { type: 'averageCash', includeDeposit: 0 },
    desc: '与指定角色平均现金（不含存款）。',
  },
  {
    id: 'mine', name: '地雷卡', rarity: 'common', timing: 'active', target: 'tile', minRound: 0,
    effect: { type: 'placeMine', hospitalTurns: 1, levelDown: 1, durationTurns: 30 },
    desc: '埋在指定格，踩中者住院 1 回合，该格房屋降 1 级。',
  },
  {
    id: 'bomb', name: '定时炸弹卡', rarity: 'rare', timing: 'active', target: 'self', minRound: 0,
    effect: { type: 'plantBomb', steps: 30, hospitalTurns: 1, levelDown: 2, transferable: 1 },
    desc: '30 步后爆炸，住院 1 回合，建筑降 2 级，可路过传给他人。',
  },
  {
    id: 'missile', name: '飞弹卡', rarity: 'legend', timing: 'active', target: 'tile', minRound: 30,
    effect: { type: 'areaDamage', radius: 1, hospitalTurns: 1, levelDown: 1, destroyAll: 0 },
    desc: '炸伤 3×3 范围内目标，住院 1 回合，房屋降 1 级。',
  },
  {
    id: 'nuke', name: '核弹卡', rarity: 'legend', timing: 'active', target: 'tile', minRound: 30,
    effect: { type: 'areaDamage', radius: 2, hospitalTurns: 3, levelDown: 5, destroyAll: 1 },
    desc: '摧毁 5×5 范围内所有房屋，范围内角色住院 3 回合。',
  },

  /* ---------------- 防御与反制 ---------------- */
  {
    id: 'free', name: '免费卡', rarity: 'rare', timing: 'reactive', target: 'self', minRound: 0,
    effect: { type: 'waiveLoss', threshold: 50000, once: 1 },
    desc: '单次损失超过 5 万时，可免除一次。',
  },
  {
    id: 'pardon', name: '免罪卡', rarity: 'rare', timing: 'reactive', target: 'self', minRound: 0,
    effect: { type: 'ignoreJail', times: 1 },
    desc: '免于一次牢狱之灾。',
  },
  {
    id: 'revenge', name: '复仇卡', rarity: 'rare', timing: 'reactive', target: 'other', minRound: 0,
    effect: { type: 'revengeJail', sameTurns: 1, capTurns: 3 },
    desc: '让陷害你的人入狱相同天数。',
  },
  {
    id: 'blame', name: '嫁祸卡', rarity: 'legend', timing: 'reactive', target: 'other', minRound: 0,
    effect: { type: 'shiftPunishment', jailThreshold: 1, lossThreshold: 100000 },
    desc: '入狱或损失超过 10 万时，找人替你承担。',
  },

  /* ---------------- 其他功能 ---------------- */
  {
    id: 'equalizeRich', name: '均富卡', rarity: 'legend', timing: 'active', target: 'none', minRound: 0,
    effect: { type: 'averageAllCash', includeDeposit: 0 },
    desc: '所有在场角色的现金取平均。',
  },
  {
    id: 'summon', name: '请神卡', rarity: 'legend', timing: 'active', target: 'self', minRound: 0,
    effect: { type: 'summonNearest', clearsBad: 1 },
    desc: '请最近的神仙附身，可顶掉坏神仙或定时炸弹。',
  },
  {
    id: 'dismiss', name: '送神卡', rarity: 'common', timing: 'active', target: 'self', minRound: 0,
    effect: { type: 'dismiss' },
    desc: '送走附身的神仙或定时炸弹。',
  },
  {
    id: 'sleepwalk', name: '梦游卡', rarity: 'common', timing: 'active', target: 'other', minRound: 0,
    effect: { type: 'sleepwalk', turns: 3 },
    desc: '令指定角色梦游 3 回合。',
  },
  {
    id: 'hibernate', name: '冬眠卡', rarity: 'common', timing: 'active', target: 'other', minRound: 0,
    effect: { type: 'hibernate', turns: 3 },
    desc: '令指定角色冬眠 3 回合，原地不动。',
  },
];

/** 稀有度 → 商店价格字段名（价格在 ruleset.cards.prices 里） */
export const RARITY_KEYS = ['common', 'rare', 'legend'];

/**
 * 单卡权重（同稀有度内部再抽一次）
 * 默认 10；越低越难抽到。
 * 核弹压到 1，飞弹压到 3 —— 同一稀有度里它们出现的概率约为其他卡的 1/10、3/10。
 */
export const CARD_WEIGHTS = {
  nuke: 1,
  missile: 3,
};
export const DEFAULT_CARD_WEIGHT = 10;

/** 已知的效果类型（engine 必须为每个 type 实现一个处理分支） */
export const EFFECT_TYPES = [
  'chooseDice', 'placeBarrier', 'freeze', 'reverse', 'turtle', 'clearObstacles',
  'forceBuy', 'swapProperty', 'rebuildProperty', 'sealStreet', 'demolish', 'upgradeOwn', 'raisePrice',
  'jail', 'tax', 'stealCard', 'averageCash', 'placeMine', 'plantBomb', 'areaDamage',
  'waiveLoss', 'ignoreJail', 'revengeJail', 'shiftPunishment',
  'averageAllCash', 'summonNearest', 'dismiss', 'sleepwalk', 'hibernate',
];

/** 基础校验：id 唯一、稀有度合法、参数全整数、类型已登记 */
export function validateCards(list = CARD_LIST) {
  const errors = [];
  const ids = new Set();
  for (const c of list) {
    if (ids.has(c.id)) errors.push(`重复 id: ${c.id}`);
    ids.add(c.id);
    if (!RARITY_KEYS.includes(c.rarity)) errors.push(`${c.id}: 稀有度非法 ${c.rarity}`);
    if (!['active', 'reactive'].includes(c.timing)) errors.push(`${c.id}: timing 非法`);
    if (!EFFECT_TYPES.includes(c.effect?.type)) errors.push(`${c.id}: 未知效果类型 ${c.effect?.type}`);
    for (const [k, v] of Object.entries(c.effect || {})) {
      if (typeof v === 'number' && !Number.isInteger(v)) errors.push(`${c.id}.${k} 不是整数`);
    }
    if (!Number.isInteger(c.minRound) || c.minRound < 0) errors.push(`${c.id}: minRound 非法`);
  }
  if (list.length !== 30) errors.push(`卡片数量应为 30，当前 ${list.length}`);
  return errors;
}

/** 按稀有度统计，给 UI / 平衡检查用 */
export function countByRarity(list = CARD_LIST) {
  return list.reduce((acc, c) => ((acc[c.rarity] = (acc[c.rarity] || 0) + 1), acc), {});
}

/** 商店抽卡：按 ruleset.cards.shop.weights 加权，且只抽已解锁的卡 */
export function pickShopCards(ruleset, round, rng) {
  const weights = ruleset.cards.shop.weights; // [common, rare, legend]
  const pool = RARITY_KEYS.map((r, i) => ({
    rarity: r, weight: weights[i],
    cards: CARD_LIST.filter((c) => c.rarity === r && c.minRound <= round),
  })).filter((g) => g.weight > 0 && g.cards.length);

  const out = [];
  const used = new Set();
  const count = ruleset.cards.shop.count;
  for (let n = 0; n < count; n++) {
    const total = pool.reduce((s, g) => s + g.weight, 0);
    let roll = rng() * total;
    let group = pool[0];
    for (const g of pool) { roll -= g.weight; if (roll <= 0) { group = g; break; } }
    // 稀有度内部再按单卡权重抽
    const candidates = group.cards.filter((c) => !used.has(c.id));
    if (!candidates.length) break;
    const w = candidates.map((c) => CARD_WEIGHTS[c.id] ?? DEFAULT_CARD_WEIGHT);
    const wTotal = w.reduce((a, b) => a + b, 0);
    let pick = rng() * wTotal;
    let idx = 0;
    for (let i = 0; i < candidates.length; i++) { pick -= w[i]; if (pick <= 0) { idx = i; break; } }
    const card = candidates[idx];
    used.add(card.id);
    out.push(card.id);
  }
  return out;
}
