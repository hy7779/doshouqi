/**
 * ruleset 校验：所有配置在「开房下发」和「载入」时必须先过这一关。
 * 只做结构/范围/整数校验，不含任何游戏逻辑。
 */
import { PLAYER_TUNABLE, PRESETS, getAt } from './ruleset.mjs';
import { MAPS, validateMap } from './maps.mjs';

const isInt = (n) => typeof n === 'number' && Number.isInteger(n);

/** 递归检查：配置里除了字符串/布尔/数组/对象，不允许出现浮点 */
function findFloats(value, path = '', out = []) {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) out.push(path || '(root)');
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => findFloats(v, `${path}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) findFloats(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

export function validateRuleset(ruleset) {
  const errors = [];
  const warnings = [];

  if (!ruleset || typeof ruleset !== 'object') return { ok: false, errors: ['ruleset 不是对象'], warnings };

  // 1. 结构版本
  if (!isInt(ruleset.schema)) errors.push('schema 必须是整数');
  else if (ruleset.schema < 1) errors.push('schema 必须 ≥ 1');

  // 2. 不能有浮点
  const floats = findFloats(ruleset);
  if (floats.length) errors.push(`存在浮点字段（联机必须全整数）：${floats.slice(0, 6).join(', ')}`);

  // 3. 必须能 JSON 往返
  try {
    const round = JSON.parse(JSON.stringify(ruleset));
    if (JSON.stringify(round) !== JSON.stringify(ruleset)) errors.push('JSON 往返后不一致');
  } catch (e) {
    errors.push('JSON 序列化失败：' + e.message);
  }

  // 4. 白名单字段的范围
  for (const t of PLAYER_TUNABLE) {
    const v = getAt(ruleset, t.path);
    if (v === undefined) { errors.push(`缺少字段 ${t.path}`); continue; }
    if (!isInt(v)) { errors.push(`${t.path} 必须是整数`); continue; }
    if (v < t.min || v > t.max) errors.push(`${t.path}=${v} 超出范围 [${t.min}, ${t.max}]`);
  }

  // 5. 跨字段一致性
  const hand = ruleset.cards?.hand;
  if (hand) {
    if (hand.startCards > hand.limit) errors.push('起始手牌不能大于手牌上限');
    if (hand.limit > 12) warnings.push('手牌上限超过 12，横屏 UI 可能放不下');
  }

  const inf = ruleset.inflation;
  if (inf) {
    if (inf.capBp < inf.baseBp) errors.push('物价上限不能小于初值');
    if (inf.stepBp < 0) errors.push('物价增速不能为负（暂不支持通缩）');
  }

  const land = ruleset.land;
  if (land) {
    const { tiers, chainBonus, rentOfInvestmentPercent } = land.small;
    if (tiers.length < 1) errors.push('小地皮至少要有一档地价');
    if (chainBonus.length !== 5) errors.push('连锁加成必须有 5 档');
    if (!rentOfInvestmentPercent) errors.push('缺少 rentOfInvestmentPercent');
  }

  const lott = ruleset.lottery;
  if (lott) {
    const sum = lott.split.reduce((a, b) => a + b, 0);
    if (sum !== 100) errors.push(`彩票奖金分配之和必须为 100，当前 ${sum}`);
    const winners = lott.winners.first + lott.winners.second + lott.winners.third;
    if (winners > lott.numbers) errors.push('中奖号码数超过号码池');
  }

  const shop = ruleset.cards?.shop;
  if (shop) {
    if (shop.weights.reduce((a, b) => a + b, 0) !== 100) errors.push('商店权重之和必须为 100');
    if (shop.count > 12) warnings.push('商店上架超过 12 张，可能一屏放不下');
  }

  // 6. 地图引用
  const map = MAPS[ruleset.rules?.mapId];
  if (!map) errors.push(`未知地图 mapId=${ruleset.rules?.mapId}`);
  else errors.push(...validateMap(map));

  if (ruleset.preset && !PRESETS[ruleset.preset]) warnings.push(`未知预设名 ${ruleset.preset}`);

  return { ok: errors.length === 0, errors, warnings };
}

/** 校验所有预设（用于 CI / 启动自检） */
export function validateAllPresets(makeRuleset) {
  const report = {};
  for (const name of Object.keys(PRESETS)) {
    const r = makeRuleset(name);
    report[name] = validateRuleset(r);
  }
  return report;
}
