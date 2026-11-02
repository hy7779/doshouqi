/**
 * 大富翁10 简陋版 · 地图配置
 *
 * 地图是「内容」不是「参数」：ruleset 只存 mapId，具体布局由生成器按 seed 摆放。
 * 结构：外环大道 + 内圈小路（30 格）+ 两条出院/出狱支路（各 5 格）。
 *
 * 几何约定：
 *   sides.w / sides.h 是「含角的边长」，环上格数 = 2w + 2h - 4
 *   四个角索引 = [0, w-1, w+h-2, 2w+h-3]
 */

export const MAPS = {
  small: {
    id: 'small',
    name: '小图',
    tiles: 50,
    sides: { w: 14, h: 13 },
    land: { bigPlots: 4, smallPlots: 22 },
    shops: { count: 2, rule: 'corner' },
    teleporters: { outer: 2, innerEntrance: 1 },
    specials: { lottery: 2, bank: 1, news: 2, card: 4, magic: 1 },    inner: {
      tiles: 30,
      distribution: { wageUp: 6, wageDown: 6, card: 6, news: 6, magic: 6 },
      exit: 1,
    },
    exits: {
      hospital: { length: 5, wageUp: 2, wageDown: 2, empty: 1 },
      jail:     { length: 5, wageUp: 2, wageDown: 2, empty: 1 },
    },
    recommended: { minPlayers: 2, maxPlayers: 8, rounds: 30 },
  },

  medium: {
    id: 'medium',
    name: '中图',
    tiles: 90,
    sides: { w: 24, h: 23 },
    land: { bigPlots: 8, smallPlots: 34 },
    shops: { count: 2, rule: 'corner' },
    teleporters: { outer: 3, innerEntrance: 1 },
    specials: { lottery: 4, bank: 2, news: 4, card: 7, magic: 2 },
    inner: {
      tiles: 30,
      distribution: { wageUp: 6, wageDown: 6, card: 6, news: 6, magic: 6 },
      exit: 1,
    },
    exits: {
      hospital: { length: 5, wageUp: 2, wageDown: 2, empty: 1 },
      jail:     { length: 5, wageUp: 2, wageDown: 2, empty: 1 },
    },
    recommended: { minPlayers: 2, maxPlayers: 8, rounds: 45 },
  },

  large: {
    id: 'large',
    name: '大图',
    tiles: 150,
    sides: { w: 39, h: 38 },
    land: { bigPlots: 12, smallPlots: 56 },
    shops: { count: 3, rule: 'corner' },
    teleporters: { outer: 4, innerEntrance: 2 },
    specials: { lottery: 6, bank: 3, news: 6, card: 12, magic: 3 },
    inner: {
      tiles: 30,
      distribution: { wageUp: 6, wageDown: 6, card: 6, news: 6, magic: 6 },
      exit: 1,
    },
    exits: {
      hospital: { length: 5, wageUp: 2, wageDown: 2, empty: 1 },
      jail:     { length: 5, wageUp: 2, wageDown: 2, empty: 1 },
    },
    recommended: { minPlayers: 5, maxPlayers: 8, rounds: 65 },
  },
};

/** 环上的四个角 */
export function cornersOf(map) {
  const { w, h } = map.sides;
  return [0, w - 1, w + h - 2, 2 * w + h - 3].map((i) => ((i % map.tiles) + map.tiles) % map.tiles);
}

export function validateMap(map) {
  const errors = [];
  const { w, h } = map.sides;
  const perimeter = 2 * w + 2 * h - 4;
  if (perimeter !== map.tiles) errors.push(`${map.id}: 边长 ${w}×${h} 的周长 ${perimeter} ≠ tiles ${map.tiles}`);

  const landTiles = map.land.bigPlots * 2 + map.land.smallPlots;
  if (landTiles > map.tiles) errors.push(`${map.id}: 地皮占用 ${landTiles} 超过总格数 ${map.tiles}`);

  const innerSum = Object.values(map.inner.distribution).reduce((a, b) => a + b, 0);
  if (innerSum !== map.inner.tiles) errors.push(`${map.id}: 小圈配比之和 ${innerSum} ≠ ${map.inner.tiles}`);

  for (const [k, exit] of Object.entries(map.exits)) {
    const sum = exit.wageUp + exit.wageDown + exit.empty;
    if (sum !== exit.length) errors.push(`${map.id}.${k}: 支路配比之和 ${sum} ≠ ${exit.length}`);
  }

  const fixed = 1 + map.shops.count + map.teleporters.outer + map.teleporters.innerEntrance
    + Object.values(map.specials).reduce((a, b) => a + b, 0);
  if (fixed + landTiles > map.tiles) errors.push(`${map.id}: 固定格 ${fixed} + 地皮 ${landTiles} 超过 ${map.tiles}`);

  return errors;
}

export function getMap(id) {
  const map = MAPS[id];
  if (!map) throw new Error(`未知地图：${id}`);
  return map;
}
