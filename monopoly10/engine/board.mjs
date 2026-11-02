/**
 * 地图生成器
 *
 * 输入：maps.mjs 的地图配置 + seed
 * 输出：整张棋盘（外环 / 内圈 / 两条支路）+ 连接关系
 *
 * 要求：
 *   - 同一个 seed 在任何客户端上生成完全相同的棋盘
 *   - 商店只出现在四个角上
 *   - 医院、监狱各有一个固定的支路汇入点
 *   - 地皮成对（大地皮占 2 格）或成串（小地皮 2–5 格）出现
 *
 * 生成顺序很重要：先放固定格（起点/商店/汇入点），再放地皮，
 * 最后把剩下的空格分给传送点和特殊格 —— 否则地皮会被切碎，凑不够数。
 */
import { cornersOf } from '../config/maps.mjs';

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledRuns(freeIdx) {
  const runs = [];
  let cur = [];
  for (const i of freeIdx) {
    if (!cur.length || i === cur[cur.length - 1] + 1) cur.push(i);
    else { runs.push(cur); cur = [i]; }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

export function generateBoard(map, seed = 1) {
  const rnd = mulberry(seed);
  const N = map.tiles;
  const corners = cornersOf(map);
  const ring = new Array(N).fill(null);

  ring[0] = { kind: 'go', label: 'go' };

  // ---- 1. 商店：只放在角上（起点那个角除外） ----
  const shopCorners = corners.filter((c) => c !== 0).slice(0, map.shops.count);
  for (const c of shopCorners) ring[c] = { kind: 'special', label: 'shop' };

  // ---- 2. 医院 / 监狱的支路汇入点 ----
  const isFree = (i) => ring[i] === null;
  const pickFreeNear = (target) => {
    for (let d = 0; d < N; d++) {
      const a = (target + d) % N;
      if (isFree(a)) return a;
      const b = (target - d + N) % N;
      if (isFree(b)) return b;
    }
    return -1;
  };
  const hospitalJunction = pickFreeNear(Math.floor(N * 0.3));
  ring[hospitalJunction] = { kind: 'special', label: 'junction' };
  const jailJunction = pickFreeNear(Math.floor(N * 0.7));
  ring[jailJunction] = { kind: 'special', label: 'junction' };

  // ---- 3. 大地皮：沿环均匀分布（每个锚点找最近的连续两格空位） ----
  let bigLeft = map.land.bigPlots;
  let smallLeft = map.land.smallPlots;
  let streetSeq = 0;

  const anchors = [];
  for (let k = 0; k < map.land.bigPlots; k++) {
    anchors.push(Math.floor((N * (k + 0.5)) / map.land.bigPlots));
  }
  // 打乱锚点顺序，避免总是从同一头开始找位置
  for (let i = anchors.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [anchors[i], anchors[j]] = [anchors[j], anchors[i]];
  }

  for (const anchor of anchors) {
    let placed = false;
    for (let d = 0; d < N && !placed; d++) {
      for (const raw of [anchor + d, anchor - d]) {
        const i = ((raw % N) + N) % N;
        const j = (i + 1) % N;
        if (ring[i] === null && ring[j] === null) {
          const price = [90000, 120000, 150000][Math.floor(rnd() * 3)];
          const plotId = `B${map.land.bigPlots - bigLeft}`;
          ring[i] = { kind: 'big', plotId, price, owner: null, level: 0, type: null };
          ring[j] = { kind: 'big', plotId, price, owner: null, level: 0, type: null };
          bigLeft--;
          placed = true;
          break;
        }
      }
    }
  }

  // ---- 3b. 小地皮：剩下的连续段里铺 2–5 格一串 ----
  const freeAfterBig = [];
  for (let i = 0; i < N; i++) if (ring[i] === null) freeAfterBig.push(i);
  for (const run of shuffledRuns(freeAfterBig)) {
    let k = 0;
    while (k < run.length) {
      const remain = run.length - k;
      if (remain < 2 || smallLeft <= 0) break;
      const len = Math.min(remain, 2 + Math.floor(rnd() * 4), smallLeft, 5);
      const price = [18000, 27000, 36000, 48000, 60000][Math.floor(rnd() * 5)];
      const streetId = `S${streetSeq++}`;
      for (let i = 0; i < len; i++) {
        ring[run[k + i]] = { kind: 'small', streetId, price, owner: null, level: 0 };
      }
      smallLeft -= len;
      k += len;
    }
  }

  // 兜底：万一还有大地皮没放下（碎片太多），把两个相邻空位拼成一对
  if (bigLeft > 0) {
    for (let i = 0; i < N && bigLeft > 0; i++) {
      if (ring[i] === null && ring[(i + 1) % N] === null) {
        const price = [90000, 120000, 150000][Math.floor(rnd() * 3)];
        const plotId = `B${map.land.bigPlots - bigLeft}`;
        ring[i] = { kind: 'big', plotId, price, owner: null, level: 0, type: null };
        ring[(i + 1) % N] = { kind: 'big', plotId, price, owner: null, level: 0, type: null };
        bigLeft--;
      }
    }
  }

  // ---- 4. 传送点与特殊格：在剩下的空格里铺 ----
  const rest = [];
  for (let i = 0; i < N; i++) if (isFree(i)) rest.push(i);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  let cursor = 0;
  const take = () => (cursor < rest.length ? rest[cursor++] : -1);

  const innerEntrances = [];
  for (let i = 0; i < map.teleporters.innerEntrance; i++) {
    const idx = take();
    if (idx < 0) break;
    ring[idx] = { kind: 'special', label: 'teleportInner' };
    innerEntrances.push(idx);
  }
  const outerTeleports = [];
  for (let i = 0; i < map.teleporters.outer; i++) {
    const idx = take();
    if (idx < 0) break;
    ring[idx] = { kind: 'special', label: 'teleportOuter' };
    outerTeleports.push(idx);
  }
  for (const [label, count] of Object.entries(map.specials)) {
    for (let i = 0; i < count; i++) {
      const idx = take();
      if (idx < 0) break;
      ring[idx] = { kind: 'special', label };
    }
  }

  // ---- 5. 剩下的空格补事件格 ----
  for (let i = 0; i < N; i++) {
    if (!ring[i]) ring[i] = { kind: 'special', label: 'event' };
    ring[i].index = i;
    ring[i].zone = 'ring';
  }

  // ---- 6. 内圈 30 格 ----
  const innerLabels = [];
  for (const [label, count] of Object.entries(map.inner.distribution)) {
    for (let i = 0; i < count; i++) innerLabels.push(label);
  }
  for (let i = innerLabels.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [innerLabels[i], innerLabels[j]] = [innerLabels[j], innerLabels[i]];
  }
  const innerExitIndex = Math.floor(rnd() * innerLabels.length);
  const inner = innerLabels.map((label, i) => ({
    zone: 'inner', index: i,
    label: i === innerExitIndex ? 'exit' : label,
    isExit: i === innerExitIndex,
  }));

  // ---- 7. 两条支路 ----
  const makeExit = (cfg) => {
    const list = [];
    for (let i = 0; i < cfg.wageUp; i++) list.push({ zone: 'exit', label: 'wageUp' });
    for (let i = 0; i < cfg.wageDown; i++) list.push({ zone: 'exit', label: 'wageDown' });
    for (let i = 0; i < cfg.empty; i++) list.push({ zone: 'exit', label: 'empty' });
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list.map((t, i) => ({ ...t, index: i }));
  };

  return {
    ring,
    inner,
    exits: { hospital: makeExit(map.exits.hospital), jail: makeExit(map.exits.jail) },
    meta: {
      mapId: map.id,
      seed,
      tiles: N,
      corners,
      shops: shopCorners,
      hospitalJunction,
      jailJunction,
      innerEntrances,
      outerTeleports,
      innerExitIndex,
      bigPlots: map.land.bigPlots,
      smallPlots: map.land.smallPlots,
      placedBig: map.land.bigPlots - bigLeft,
      placedSmall: map.land.smallPlots - smallLeft,
    },
  };
}

/** 生成后的结构校验 */
export function validateBoard(board, map) {
  const errors = [];
  const { ring, inner, exits, meta } = board;

  if (ring.length !== map.tiles) errors.push(`环长 ${ring.length} ≠ ${map.tiles}`);
  if (inner.length !== map.inner.tiles) errors.push(`内圈 ${inner.length} ≠ ${map.inner.tiles}`);

  for (const c of meta.shops) {
    if (!meta.corners.includes(c)) errors.push(`商店 ${c} 不在角上`);
  }
  if (meta.shops.length !== map.shops.count) errors.push(`商店数量 ${meta.shops.length} ≠ ${map.shops.count}`);

  const bigs = ring.filter((t) => t.kind === 'big').length;
  const smalls = ring.filter((t) => t.kind === 'small').length;
  if (bigs !== map.land.bigPlots * 2) errors.push(`大地皮格数 ${bigs} ≠ ${map.land.bigPlots * 2}`);
  if (smalls !== map.land.smallPlots) errors.push(`小地皮格数 ${smalls} ≠ ${map.land.smallPlots}`);

  const byPlot = {};
  for (const t of ring) if (t.kind === 'big') (byPlot[t.plotId] ||= []).push(t);
  for (const [id, list] of Object.entries(byPlot)) {
    if (list.length !== 2) errors.push(`大地皮 ${id} 占 ${list.length} 格`);
    if (list[0].price !== list[1].price) errors.push(`大地皮 ${id} 两块价格不一致`);
  }

  for (const j of [meta.hospitalJunction, meta.jailJunction]) {
    const t = ring[j];
    if (!t || t.kind !== 'special') errors.push(`汇入点 ${j} 被地皮占用`);
  }

  if (!inner.some((t) => t.isExit)) errors.push('内圈缺少出口');

  for (const [name, list] of Object.entries(exits)) {
    if (list.length !== map.exits[name].length) errors.push(`${name} 支路长度 ${list.length} 不符`);
  }

  return errors;
}

/** 棋盘指纹：用于"所有客户端生成的是同一张图"的校验 */
export function boardFingerprint(board) {
  const pick = (t) => [t.kind, t.label || '', t.price || 0, t.plotId || '', t.streetId || ''].join(':');
  return [board.ring.map(pick).join('|'), board.inner.map((t) => t.label).join('|')].join('#');
}
