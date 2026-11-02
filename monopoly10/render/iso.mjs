/**
 * 2.5D 等轴测投影
 * 棋盘坐标 (x, y) → 屏幕坐标；带相机（平移 + 缩放）
 */
export const TILE_W = 64;
export const TILE_H = 32;
const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;

export function project(x, y, cam) {
  const sx = (x - y) * HALF_W;
  const sy = (x + y) * HALF_H;
  return {
    x: (sx - cam.x) * cam.zoom + cam.vw / 2,
    y: (sy - cam.y) * cam.zoom + cam.vh / 2,
  };
}

/** 一个格子（单位方格）投影后的四个角：上、右、下、左 */
export function quadOf(x, y, cam) {
  const a = project(x, y, cam);
  const b = project(x + 1, y, cam);
  const c = project(x + 1, y + 1, cam);
  const d = project(x, y + 1, cam);
  return [a, b, c, d];
}

export function pointInQuad(px, py, quad) {
  let inside = false;
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
    const xi = quad[i].x, yi = quad[i].y;
    const xj = quad[j].x, yj = quad[j].y;
    if (((yi > py) !== (yj > py)) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 环上第 i 个格子的 (col,row) */
export function ringCoord(i, map, corners) {
  const { w, h } = map.sides;
  const [c1, c2, c3] = corners.slice(1);
  if (i <= c1) return { col: w - 1 - i, row: h - 1 };
  if (i <= c2) return { col: 0, row: h - 1 - (i - c1) };
  if (i <= c3) return { col: i - c2, row: 0 };
  return { col: w - 1, row: i - c3 };
}

/** 相机跟随某个点 */
export function focusOn(cam, x, y, zoom) {
  cam.x = (x - y) * HALF_W;
  cam.y = (x + y) * HALF_H;
  cam.zoom = zoom;
}
