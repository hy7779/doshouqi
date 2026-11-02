/**
 * 神仙表
 * kind: good 持续 6 回合 / bad 持续 3 回合（角色被动可以改）
 */
export const GODS = [
  { id: 'wealth',  name: '财神',   emoji: '💰', kind: 'good', turns: 6, desc: '每回合进账' },
  { id: 'luck',    name: '福神',   emoji: '🛡️', kind: 'good', turns: 6, desc: '免疫其他玩家的主动卡' },
  { id: 'angel',   name: '天使',   emoji: '👼', kind: 'good', turns: 6, desc: '落地时免费给该格建筑升 1 级' },
  { id: 'land',    name: '土地公', emoji: '🏮', kind: 'good', turns: 6, desc: '每回合获得 1 张卡' },
  { id: 'poverty', name: '穷神',   emoji: '👺', kind: 'bad',  turns: 3, desc: '每回合损失现金' },
  { id: 'doom',    name: '衰神',   emoji: '💀', kind: 'bad',  turns: 3, desc: '住院/入狱回合 +1' },
];

export const GOD_MAP = Object.fromEntries(GODS.map((g) => [g.id, g]));
