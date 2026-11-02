/**
 * 棋盘 → 屏幕几何：每个格子的菱形、内圈小格、支路格
 */
import { quadOf, project, ringCoord } from './iso.mjs';

export const TYPE_COLOR = {
  go: '#d9b26a',
  shop: '#8f6bd8',
  junction: '#5c6f66',
  teleportInner: '#3fb6c9',
  teleportOuter: '#3f86c9',
  bank: '#2f9e8f',
  lottery: '#d9822b',
  news: '#c9557e',
  card: '#6c5bd8',
  magic: '#c93fb6',
  event: '#2a3b34',
  tax: '#c9534a',
};

export const PLAYER_COLOR = ['#e0554a', '#4a9de0', '#4ac97a', '#e0b84a', '#c04ae0', '#e07a4a', '#4ae0d0', '#e04aa0'];

/** 环上所有格子的屏幕信息 */
export function ringTiles(state, cam) {
  const map = state.board.meta;
  const ring = state.board.ring;
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const { col, row } = ringCoord(i, { sides: { w: mapW(state), h: mapH(state) } }, map.corners);
    const t = ring[i];
    out.push({
      i, tile: t, col, row,
      depth: col + row,
      quad: quadOf(col, row, cam),
      center: project(col + 0.5, row + 0.5, cam),
    });
  }
  return out;
}

export function mapW(state) { return state.mapSides.w; }
export function mapH(state) { return state.mapSides.h; }

/** 内圈 30 格：沿一个内缩的椭圆排布 */
export function innerTiles(state, cam) {
  const inner = state.board.inner;
  const w = mapW(state), h = mapH(state);
  const cx = w / 2, cy = h / 2;
  const rx = w / 2 - 2.6, ry = h / 2 - 2.6;
  return inner.map((t, i) => {
    const a = (i / inner.length) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    return {
      i, tile: t,
      center: project(x, y, cam),
      depth: x + y,
      x, y,
    };
  });
}

/** 两条支路：从汇入点向外画 5 个小格 */
export function exitTiles(state, cam) {
  const w = mapW(state), h = mapH(state);
  const cx = w / 2, cy = h / 2;
  const out = [];
  for (const [name, list] of Object.entries(state.board.exits)) {
    const junction = name === 'hospital' ? state.board.meta.hospitalJunction : state.board.meta.jailJunction;
    const { col, row } = ringCoord(junction, { sides: { w, h } }, state.board.meta.corners);
    const dx = (col + 0.5) - cx;
    const dy = (row + 0.5) - cy;
    const len = Math.hypot(dx, dy) || 1;
    list.forEach((t, k) => {
      const d = 1.2 + k * 1.0;
      const x = col + 0.5 + (dx / len) * d;
      const y = row + 0.5 + (dy / len) * d;
      out.push({ name, i: k, tile: t, center: project(x, y, cam), depth: x + y, x, y });
    });
  }
  return out;
}
