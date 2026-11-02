/**
 * 2.5D 画面层：画棋盘、棋子、镜头，接引擎动作
 * 目前是本地同屏（2–8 人轮流），联机层后接。
 */
import { createGame } from '../engine/state.mjs';
import { roll, buy, pass, endTurn, upgrade } from '../engine/engine.mjs';
import { makeRuleset } from '../config/ruleset.mjs';
import { CHARACTER_LIST } from '../config/characters.mjs';
import { CARD_LIST } from '../config/cards.mjs';
import { project, quadOf, pointInQuad, focusOn } from './iso.mjs';
import { ringTiles, innerTiles, exitTiles, TYPE_COLOR, PLAYER_COLOR } from './scene.mjs';

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

const cam = { x: 0, y: 0, zoom: 1, vw: 0, vh: 0 };
let follow = true;
let state = null;
let dragging = null;
let hover = null;

const PLAYERS = 4;
const ruleset = makeRuleset('standard', { 'rules.mapId': 'small', 'rules.maxRounds': 30 });

function newGame() {
  const chars = CHARACTER_LIST.map((c) => c.id);
  const names = ['甲', '乙', '丙', '丁'];
  state = createGame({
    ruleset,
    mapId: 'small',
    names: names.slice(0, PLAYERS),
    seed: (Date.now() % 100000) | 1,
    characterIds: chars.slice(0, PLAYERS),
  });
  afterChange();
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cam.vw = canvas.clientWidth;
  cam.vh = canvas.clientHeight;
  canvas.width = Math.floor(cam.vw * dpr);
  canvas.height = Math.floor(cam.vh * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}
window.addEventListener('resize', resize);

/* ---------------- 绘制 ---------------- */

function tileFill(t) {
  if (t.owner != null && t.owner >= 0) return shade(PLAYER_COLOR[t.owner % PLAYER_COLOR.length], 0.45);
  if (t.kind === 'small') return '#2f5a45';
  if (t.kind === 'big') return '#2c4a6b';
  return TYPE_COLOR[t.label] || '#2a3b34';
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c) => Math.round(c * (1 - amount) + 20 * amount);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

function drawQuad(quad, fill, stroke, lw = 1) {
  ctx.beginPath();
  ctx.moveTo(quad[0].x, quad[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(quad[i].x, quad[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.stroke();
}

function drawBoard() {
  const ring = ringTiles(state, cam);
  const inner = innerTiles(state, cam);
  const exits = exitTiles(state, cam);

  // 底板阴影
  ctx.save();
  const w = state.mapSides.w, h = state.mapSides.h;
  const outer = quadOf(0, 0, cam);
  const far = project(w, h, cam);
  const centerX = (outer[0].x + far.x) / 2;
  const centerY = (outer[0].y + far.y) / 2;
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(centerX, centerY + 30 * cam.zoom, (w + h) * 16 * cam.zoom, (w + h) * 8 * cam.zoom, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 环
  for (const t of ring.sort((a, b) => a.depth - b.depth)) {
    const fill = tileFill(t.tile);
    const isCur = t.i === state.players[state.turn].pos && state.players[state.turn].zone === 'ring';
    drawQuad(t.quad, fill, isCur ? '#f2d28a' : '#0d1714', isCur ? 2.5 : 1);
    if (t.tile.kind === 'small' || t.tile.kind === 'big') {
      const lv = t.tile.level || 0;
      for (let k = 0; k < lv; k++) {
        ctx.beginPath();
        ctx.arc(t.center.x - 10 + k * 5, t.center.y + 6, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd98a';
        ctx.fill();
      }
    }
    if (cam.zoom > 0.75) {
      ctx.fillStyle = 'rgba(255,255,255,.82)';
      ctx.font = `${Math.round(9 * cam.zoom)}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(labelOf(t.tile), t.center.x, t.center.y - 2);
      if (t.tile.price) {
        ctx.fillStyle = 'rgba(255,255,255,.45)';
        ctx.font = `${Math.round(7 * cam.zoom)}px monospace`;
        ctx.fillText(String(t.tile.price / 1000) + 'k', t.center.x, t.center.y + 9);
      }
    }
  }

  // 内圈
  for (const t of inner) {
    const r = 9 * cam.zoom;
    ctx.beginPath();
    ctx.arc(t.center.x, t.center.y, r, 0, Math.PI * 2);
    ctx.fillStyle = t.tile.isExit ? '#d9b26a' : (t.tile.label === 'card' ? '#6c5bd8' : t.tile.label === 'magic' ? '#c93fb6' : t.tile.label === 'news' ? '#c9557e' : '#3f6f5a');
    ctx.fill();
    ctx.strokeStyle = '#0d1714';
    ctx.stroke();
  }

  // 支路
  for (const t of exits) {
    ctx.beginPath();
    ctx.arc(t.center.x, t.center.y, 7 * cam.zoom, 0, Math.PI * 2);
    ctx.fillStyle = t.tile.label === 'wageUp' ? '#4ac97a' : t.tile.label === 'wageDown' ? '#c9534a' : '#3a4a44';
    ctx.fill();
    ctx.strokeStyle = '#0d1714';
    ctx.stroke();
  }

  // 棋子：先算出每人所在格的中心，再按格子堆叠
  const stacks = new Map();
  for (const p of state.players) {
    if (!p.alive) continue;
    let center = null;
    if (p.zone === 'ring') center = ring.find((t) => t.i === p.pos)?.center;
    else if (p.zone === 'inner') center = inner[p.pos]?.center;
    else if (p.zone === 'exit') center = exits.find((t) => t.name === p.exitPath && t.i === Math.max(0, p.pos))?.center;
    if (!center) continue;
    const key = `${Math.round(center.x)},${Math.round(center.y)}`;
    if (!stacks.has(key)) stacks.set(key, { center, list: [] });
    stacks.get(key).list.push(p);
  }
  for (const { center, list } of stacks.values()) {
    list.forEach((p, k) => {
      const ox = (k - (list.length - 1) / 2) * 11 * cam.zoom;
      drawToken(center.x + ox, center.y - 12 * cam.zoom, p);
    });
  }

  // 内圈虚线
  ctx.beginPath();
  inner.forEach((t, i) => (i ? ctx.lineTo(t.center.x, t.center.y) : ctx.moveTo(t.center.x, t.center.y)));
  ctx.closePath();
  ctx.strokeStyle = 'rgba(217,178,106,.15)';
  ctx.setLineDash([4, 6]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function labelOf(t) {
  if (t.kind === 'go') return '起点';
  if (t.kind === 'small') return '地';
  if (t.kind === 'big') return '大厦';
  const m = { shop: '商店', junction: '入口', teleportInner: '内圈', teleportOuter: '传送', bank: '银行', lottery: '彩票', news: '新闻', card: '卡片', magic: '魔法', event: '·', tax: '税' };
  return m[t.label] || '·';
}

function drawToken(x, y, p) {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y + 8, 9 * cam.zoom, 4 * cam.zoom, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, 9 * cam.zoom, 0, Math.PI * 2);
  ctx.fillStyle = PLAYER_COLOR[p.id % PLAYER_COLOR.length];
  ctx.fill();
  ctx.strokeStyle = p.id === state.turn ? '#fff' : 'rgba(0,0,0,.5)';
  ctx.lineWidth = p.id === state.turn ? 2 : 1;
  ctx.stroke();

  const char = CHARACTER_LIST.find((c) => c.id === p.charId);
  ctx.font = `${Math.round(10 * cam.zoom)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#101815';
  ctx.fillText(char ? char.token : '●', x, y + 1);
  ctx.restore();
}

function draw() {
  if (!state) return;
  ctx.clearRect(0, 0, cam.vw, cam.vh);
  const g = ctx.createLinearGradient(0, 0, 0, cam.vh);
  g.addColorStop(0, '#122019');
  g.addColorStop(1, '#0a1310');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cam.vw, cam.vh);
  drawBoard();
}

/* ---------------- 镜头 ---------------- */

function centerOnCurrent() {
  const p = state.players[state.turn];
  if (!p) return;
  let x = 0, y = 0;
  if (p.zone === 'ring') {
    const t = ringTiles(state, cam).find((r) => r.i === p.pos);
    if (t) { x = t.col + 0.5; y = t.row + 0.5; }
  } else if (p.zone === 'inner') {
    const t = innerTiles(state, cam)[p.pos];
    if (t) { x = t.x; y = t.y; }
  } else {
    const w = state.mapSides.w, h = state.mapSides.h;
    x = w / 2; y = h / 2;
  }
  focusOn(cam, x, y, cam.zoom);
}

canvas.addEventListener('pointerdown', (e) => {
  dragging = { x: e.clientX, y: e.clientY, camX: cam.x, camY: cam.y, moved: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (dragging) {
    const dx = e.clientX - dragging.x;
    const dy = e.clientY - dragging.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) {
      dragging.moved = true;
      follow = false;
      updateFollowBtn();
      cam.x = dragging.camX - (dx * 2) / cam.zoom;
      cam.y = dragging.camY - (dy * 2) / cam.zoom;
      draw();
    }
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (dragging && !dragging.moved) handleClick(e);
  dragging = null;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.zoom = Math.max(0.4, Math.min(2.4, cam.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
  draw();
}, { passive: false });

function handleClick(e) {
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left, py = e.clientY - rect.top;
  const hit = ringTiles(state, cam).find((t) => pointInQuad(px, py, t.quad));
  if (!hit) return;
  const t = hit.tile;
  if (t.owner === state.players[state.turn].id && ['postRoll', 'preRoll'].includes(state.phase)) {
    const next = upgrade(state, hit.i);
    if (next !== state) { state = next; afterChange(); toast('升级成功'); }
    else toast('这里现在不能升级');
  }
}

/* ---------------- 界面 ---------------- */

const $ = (id) => document.getElementById(id);

function afterChange() {
  centerOnCurrent();
  draw();
  renderHUD();
  save();
}

function renderHUD() {
  const p = state.players[state.turn];
  $('turn').textContent = `${CHARACTER_LIST.find((c) => c.id === p.charId)?.token || ''} ${p.name}`;
  $('cash').textContent = `现金 ¥${p.cash.toLocaleString()} · 存款 ¥${p.deposit.toLocaleString()}`;
  $('round').textContent = `第 ${state.round} 回合 / 上限 ${state.ruleset.rules.maxRounds}`;

  const dice = state.dice;
  $('dice').textContent = dice[0] ? `${dice[0]} + ${dice[1]}` : '—';

  const acts = $('actions');
  acts.innerHTML = '';
  const mk = (label, fn, cls = '') => {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = cls;
    b.onclick = fn;
    acts.appendChild(b);
  };

  if (state.phase === 'preRoll') {
    mk('掷骰子', doRoll, 'primary');
  } else if (state.phase === 'awaitBuy') {
    const price = state.pending.price;
    mk(`买下 ¥${price.toLocaleString()}`, () => { state = buy(state); afterChange(); }, 'primary');
    mk('放弃', () => { state = pass(state); afterChange(); });
  } else if (state.phase === 'postRoll') {
    mk('结束回合', () => { state = endTurn(state); afterChange(); }, 'primary');
  } else {
    mk('再来一局', newGame, 'primary');
  }

  // 玩家列表
  $('players').innerHTML = state.players.map((q) => `
    <div class="pl ${q.id === state.turn ? 'on' : ''} ${q.alive ? '' : 'out'}">
      <span class="dot" style="background:${PLAYER_COLOR[q.id % PLAYER_COLOR.length]}"></span>
      <span class="nm">${CHARACTER_LIST.find((c) => c.id === q.charId)?.token || ''} ${q.name}</span>
      <span class="money">¥${q.cash.toLocaleString()}</span>
    </div>`).join('');

  // 手牌
  $('hand').innerHTML = p.hand.length
    ? p.hand.map((id) => `<span class="card">${CARD_LIST.find((c) => c.id === id)?.name || id}</span>`).join('')
    : '<span class="empty">手上没有卡</span>';

  // 日志
  $('log').innerHTML = state.log.slice(-6).map((l) => `<div>${l.text}</div>`).join('');
  $('log').scrollTop = $('log').scrollHeight;
}

let rolling = false;
function doRoll() {
  if (rolling) return;
  rolling = true;
  const el = $('dice');
  let n = 0;
  const timer = setInterval(() => {
    el.textContent = `${1 + Math.floor(Math.random() * 6)} + ${1 + Math.floor(Math.random() * 6)}`;
    if (++n > 6) {
      clearInterval(timer);
      state = roll(state);
      rolling = false;
      afterChange();
    }
  }, 60);
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1400);
}

function updateFollowBtn() {
  $('follow').textContent = follow ? '🔒 跟随' : '🔓 自由';
}

/* ---------------- 存档 ---------------- */

const KEY = 'monopoly10-demo';
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.board && s.players ? s : null;
  } catch (_) { return null; }
}

/* ---------------- 启动 ---------------- */

$('follow').onclick = () => { follow = !follow; updateFollowBtn(); if (follow) { centerOnCurrent(); draw(); } };
$('newgame').onclick = newGame;

const saved = load();
if (saved) { state = saved; }
else { state = createGame({ ruleset, mapId: 'small', names: ['甲', '乙', '丙', '丁'], seed: 20261102, characterIds: CHARACTER_LIST.slice(0, 4).map((c) => c.id) }); }

resize();
centerOnCurrent();
draw();
renderHUD();
updateFollowBtn();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('../sw.js').catch(() => {}));
}
