/**
 * 2.5D 画面层：画棋盘、棋子、镜头，接引擎动作
 * 目前是本地同屏（2–8 人轮流），联机层后接。
 */
import { createGame } from '../engine/state.mjs';
import {
  applyAction, upgradeCostFor,
} from '../engine/engine.mjs';
import { GameHost } from '../net/host.mjs';
import { GameClient } from '../net/client.mjs';
import { createHost, joinRoom, makeCode } from '../net/peer.mjs';
import { makeRuleset } from '../config/ruleset.mjs';
import { MAPS } from '../config/maps.mjs';
import { CHARACTER_LIST } from '../config/characters.mjs';
import { CARD_LIST } from '../config/cards.mjs';
import { GOD_MAP } from '../config/gods.mjs';
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

const setupChoice = { map: 'small', players: 4, mode: 'solo' };

const net = { mode: 'solo', code: null, host: null, client: null, peer: null, you: 0 };

/** 所有操作统一走这里：单机本地执行 / 房主本地执行并广播 / 客人只发送
 *  返回值：单机与房主表示是否真的执行了；客人一律返回 true（由房主裁决） */
function submit(action) {
  if (net.mode === 'guest') {
    if (!net.client) return false;
    if (state.turn !== net.you) { toast('还没轮到你'); return false; }
    net.client.act(action);
    return true;
  }
  if (net.mode === 'host') {
    return !!net.host?.act(action);
  }
  const next = applyAction(state, action);
  if (next === state) { toast('这一步现在做不了'); return false; }
  state = next;
  afterChange();
  return true;
}

/* 兼容旧调用点：这些包装只负责把动作转成 submit，状态由 submit 更新 */
const act = (a) => { submit(a); return state; };
const roll = () => act({ type: 'roll' });
const buy = () => act({ type: 'buy' });
const pass = () => act({ type: 'pass' });
const endTurn = () => act({ type: 'endTurn' });
const upgrade = (_s, pos) => act({ type: 'upgrade', pos });
const useCard = (_s, cardId, target) => act({ type: 'useCard', cardId, target });
const buyCard = (_s, cardId) => act({ type: 'buyCard', cardId });
const closeShop = () => act({ type: 'closeShop' });
const respondReaction = (_s, cardId, target) => act({ type: 'respond', cardId, target });
const bankDeposit = (_s, percent) => act({ type: 'bankDeposit', percent });
const bankWithdrawAll = () => act({ type: 'bankWithdraw' });
const leaveBank = () => act({ type: 'leaveBank' });
const buyLottery = (_s, count) => act({ type: 'buyLottery', count });
const leaveLottery = () => act({ type: 'leaveLottery' });
const magicDraw = () => act({ type: 'magicDraw' });
const leaveMagic = () => act({ type: 'leaveMagic' });
const chooseBigType = (_s, typeId) => act({ type: 'chooseBigType', typeId });
const cancelBigType = () => act({ type: 'cancelBigType' });

function startSolo() {
  const map = MAPS[setupChoice.map];
  const rounds = map?.recommended?.rounds ?? 45;
  const gameRuleset = makeRuleset('standard', { 'rules.mapId': setupChoice.map, 'rules.maxRounds': rounds });
  const chars = CHARACTER_LIST.map((c) => c.id);
  const names = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛'];
  net.mode = 'solo';
  state = createGame({
    ruleset: gameRuleset,
    mapId: setupChoice.map,
    names: names.slice(0, setupChoice.players),
    seed: (Date.now() % 100000) | 1,
    characterIds: chars.slice(0, setupChoice.players),
  });
  targeting = null;
  legalTiles = null;
  anim = null;
  afterChange();
}

function startHost() {
  const map = MAPS[setupChoice.map];
  const rounds = map?.recommended?.rounds ?? 45;
  const gameRuleset = makeRuleset('standard', { 'rules.mapId': setupChoice.map, 'rules.maxRounds': rounds });
  const chars = CHARACTER_LIST.map((c) => c.id);
  const names = Array.from({ length: setupChoice.players }, (_, i) => (i === 0 ? '房主' : `玩家${i + 1}`));

  state = createGame({
    ruleset: gameRuleset,
    mapId: setupChoice.map,
    names,
    seed: (Date.now() % 100000) | 1,
    characterIds: chars.slice(0, setupChoice.players),
  });

  const code = makeCode();
  net.mode = 'host';
  net.code = code;
  net.you = 0;
  net.host = new GameHost(state, {
    onChange: () => {
      state = net.host.state;
      updateRoomBar();
      afterChange();
    },
  });
  if (window.Peer) {
    net.peer = createHost(code, {
      onConn: (conn) => net.host.attach(conn),
      onError: (err) => toast('联机错误：' + (err?.type || err)),
    });
  } else {
    toast('PeerJS 未加载，联机不可用');
  }
  $('roombar').hidden = false;
  updateRoomBar();
  afterChange();
}

function startJoin(code) {
  net.mode = 'guest';
  net.code = code;
  if (!window.Peer) { toast('PeerJS 未加载，联机不可用'); return; }
  net.peer = joinRoom(code, {
    onConn: (conn) => {
      net.client = new GameClient(conn, {
        welcome: (msg) => {
          net.you = msg.you;
          state = msg.view;
          afterChange();
        },
        state: (view) => { state = view; afterChange(); },
        error: (m) => toast(m),
        close: () => toast('与房主断开连接'),
      });
      net.client.join($('nameInput').value.trim() || '玩家');
    },
    onError: (err) => toast('连接失败：' + (err?.type || err)),
  });
}

function updateRoomBar() {
  if (net.mode !== 'host' || !net.code) return;
  $('roomCode').textContent = net.code;
  const joined = net.host ? net.host.conns.size : 0;
  const total = state.players.length - 1;
  $('roomStatus').textContent = joined < total ? `${joined}/${total} 已入座，等待玩家` : `${joined}/${total} 已入座，可以开始`;
}

function showSetup() {
  $('setup').hidden = false;
  $('mapOpts').querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', b.dataset.map === setupChoice.map);
    b.onclick = () => {
      setupChoice.map = b.dataset.map;
      $('mapOpts').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    };
  });
  $('countOpts').querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.n) === setupChoice.players);
    b.onclick = () => {
      setupChoice.players = Number(b.dataset.n);
      $('countOpts').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    };
  });
  $('modeOpts').querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', b.dataset.mode === setupChoice.mode);
    b.onclick = () => {
      setupChoice.mode = b.dataset.mode;
      $('modeOpts').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      $('codeRow').hidden = setupChoice.mode !== 'join';
      $('startBtn').textContent = setupChoice.mode === 'host' ? '创建房间'
        : setupChoice.mode === 'join' ? '进入房间' : '开始游戏';
    };
  });

  $('startBtn').onclick = () => {
    if (setupChoice.mode === 'join') {
      const code = $('codeInput').value.trim().toUpperCase();
      if (code.length !== 6) { toast('房间号是 6 位'); return; }
      $('setup').hidden = true;
      startJoin(code);
      return;
    }
    $('setup').hidden = true;
    if (setupChoice.mode === 'host') startHost();
    else startSolo();
  };
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

let anim = null;
let legalTiles = null;

function startAnim(playerId, from, steps) {
  if (steps <= 0) return;
  anim = { playerId, from, steps, start: performance.now(), duration: Math.min(720, 110 * steps + 140) };
  requestAnimationFrame(tick);
}

function tick() {
  if (anim && performance.now() - anim.start > anim.duration) anim = null;
  draw();
  if (anim) requestAnimationFrame(tick);
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
    if (t.tile.god) {
      ctx.font = `${Math.round(12 * cam.zoom)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(GOD_MAP[t.tile.god]?.emoji || '✨', t.center.x, t.center.y - 14);
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

  // 选卡时高亮可选目标
  if (legalTiles) {
    for (const t of ring) {
      if (!legalTiles.has(t.i)) continue;
      drawQuad(t.quad, 'rgba(217,178,106,0.18)', '#f2d28a', 2);
    }
  }

  // 棋子：先算出每人所在格的中心，再按格子堆叠
  const centerByIdx = new Map(ring.map((t) => [t.i, t.center]));
  const animCenter = () => {
    if (!anim) return null;
    const el = performance.now() - anim.start;
    const ratio = Math.min(1, el / anim.duration);
    const eased = ratio * ratio * (3 - 2 * ratio);
    const pos = anim.from + anim.steps * eased;
    const i0 = Math.floor(pos) % state.tiles.length;
    const i1 = (i0 + 1) % state.tiles.length;
    const f = pos - Math.floor(pos);
    const a = centerByIdx.get(i0) || centerByIdx.values().next().value;
    const b = centerByIdx.get(i1) || centerByIdx.values().next().value;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };

  const stacks = new Map();
  for (const p of state.players) {
    if (!p.alive) continue;
    let center = null;
    if (p.zone === 'ring') center = ring.find((t) => t.i === p.pos)?.center;
    else if (p.zone === 'inner') center = inner[p.pos]?.center;
    else if (p.zone === 'exit') center = exits.find((t) => t.name === p.exitPath && t.i === Math.max(0, p.pos))?.center;
    if (!center) continue;
    if (anim && anim.playerId === p.id) center = animCenter() || center;
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

  if (targeting && targeting.kind === 'tile') {
    applyTargetCard(hit.i);
    return;
  }

  const t = hit.tile;
  if (t.owner === state.players[state.turn].id && ['postRoll', 'preRoll'].includes(state.phase)) {
    if (submit({ type: 'upgrade', pos: hit.i })) toast('升级成功');
    else toast('这里现在不能升级');
  }
}

/* ---------------- 界面 ---------------- */

const $ = (id) => document.getElementById(id);

function afterChange() {
  if (state.phase !== 'reaction') blamePick = false;
  if (!targeting) legalTiles = null;
  centerOnCurrent();
  draw();
  renderHUD();
  save();
}

function renderHUD() {
  const p = state.players[state.turn];
  $('turn').textContent = `${CHARACTER_LIST.find((c) => c.id === p.charId)?.token || ''} ${p.name}`;
  $('cash').textContent = `现金 ¥${p.cash.toLocaleString()} · 存款 ¥${p.deposit.toLocaleString()}`;
  $('round').textContent = `第 ${state.round} 轮 / 上限 ${state.ruleset.rules.maxRounds}`;

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

  const blocked = (net.mode === 'guest' && state.turn !== net.you)
    || (net.mode === 'host' && net.host && net.host.conns.size < state.players.length - 1);

  if (blocked) {
    const msg = document.createElement('div');
    msg.className = 'waiting';
    msg.textContent = net.mode === 'host' ? '等待其他玩家入座…' : `等待 ${state.players[state.turn].name} 操作…`;
    acts.appendChild(msg);
  } else if (state.phase === 'preRoll') {
    mk('掷骰子', doRoll, 'primary');
    if (targeting) mk('取消选卡', () => { targeting = null; renderHUD(); draw(); });
  } else if (state.phase === 'awaitBuy') {
    const price = state.pending.price;
    mk(`买下 ¥${price.toLocaleString()}`, () => { state = buy(state); afterChange(); }, 'primary');
    mk('放弃', () => { state = pass(state); afterChange(); });
  } else if (state.phase === 'shop') {
    const money = state.players[state.turn].cash;
    for (const id of state.pending.shop) {
      const card = CARD_LIST.find((c) => c.id === id);
      const price = state.ruleset.cards.prices[card.rarity];
      const b = document.createElement('button');
      b.textContent = `${card.name} ¥${Math.round(price / 1000)}k`;
      b.disabled = money < price;
      b.onclick = () => { state = buyCard(state, id); afterChange(); };
      acts.appendChild(b);
    }
    mk('离开商店', () => { state = closeShop(state); afterChange(); });
  } else if (state.phase === 'reaction') {
    const pend = state.pending;
    const victim = state.players[pend.victimId];
    for (const id of pend.cards) {
      const card = CARD_LIST.find((c) => c.id === id);
      mk(`用「${card.name}」`, () => {
        if (id === 'blame') {
          blamePick = true;
          renderHUD();
          toast('点击右侧玩家，选择替罪者');
          return;
        }
        state = respondReaction(state, id);
        afterChange();
      }, 'primary');
    }
    mk('不使用', () => { state = respondReaction(state, null); afterChange(); });
    $('turn').textContent = `${CHARACTER_LIST.find((c) => c.id === victim.charId)?.token || ''} ${victim.name} · 响应中`;
  } else if (state.phase === 'bank') {
    mk('存入一半现金', () => { state = bankDeposit(state, 50); afterChange(); });
    mk('取出全部', () => { state = bankWithdrawAll(state); afterChange(); });
    mk('离开', () => { state = leaveBank(state); afterChange(); });
  } else if (state.phase === 'lottery') {
    mk('买 1 张', () => { state = buyLottery(state, 1); afterChange(); });
    mk('买 2 张', () => { state = buyLottery(state, 2); afterChange(); });
    mk('离开', () => { state = leaveLottery(state); afterChange(); });
  } else if (state.phase === 'magic') {
    mk('抽一张卡 ¥20k', () => { state = magicDraw(state); afterChange(); });
    mk('离开', () => { state = leaveMagic(state); afterChange(); });
  } else if (state.phase === 'bigType') {
    const names = { mall: '商业中心', hotel: '大饭店', lab: '研究所', temple: '土地庙', oil: '石油公司', bank2: '证券中心' };
    const cost = upgradeCostFor(state, state.pending.pos);
    const afford = p.cash >= cost;
    for (const [id, label] of Object.entries(names)) {
      const b = document.createElement('button');
      b.textContent = `${label} ¥${Math.round(cost / 1000)}k`;
      b.className = 'primary';
      b.disabled = !afford;
      b.onclick = () => { state = chooseBigType(state, id); afterChange(); };
      acts.appendChild(b);
    }
    mk('暂不建造', () => { state = cancelBigType(state); afterChange(); });
    $('turn').textContent = `${p.name} · 选择建筑类型${afford ? '' : '（现金不足）'}`;
  } else if (state.phase === 'postRoll') {
    mk('结束回合', () => { state = endTurn(state); afterChange(); }, 'primary');
    if (targeting) mk('取消选卡', () => { targeting = null; renderHUD(); draw(); });
  } else {
    mk('再来一局', showSetup, 'primary');
  }

  // 玩家列表（选目标 / 嫁祸选人模式下可点）
  $('players').innerHTML = state.players.map((q) => {
    const pickable = (targeting && targeting.kind === 'player' && targeting.byId !== q.id)
      || (blamePick && state.pending?.victimId !== q.id);
    const gods = (q.gods || []).map((g) => GOD_MAP[g.id]?.emoji || '').join('');
    return `<div class="pl ${q.id === state.turn ? 'on' : ''} ${q.alive ? '' : 'out'} ${pickable ? 'targetable' : ''}"
         data-pid="${q.id}">
      <span class="dot" style="background:${PLAYER_COLOR[q.id % PLAYER_COLOR.length]}"></span>
      <span class="nm">${CHARACTER_LIST.find((c) => c.id === q.charId)?.token || ''} ${q.name}${gods ? ' ' + gods : ''}</span>
      <span class="money">¥${q.cash.toLocaleString()}</span>
    </div>`;
  }).join('');
  $('players').querySelectorAll('[data-pid]').forEach((row) => {
    row.onclick = () => {
      const pid = Number(row.dataset.pid);
      if (blamePick && state.phase === 'reaction') {
        state = respondReaction(state, 'blame', pid);
        blamePick = false;
        afterChange();
        return;
      }
      if (!targeting || targeting.kind !== 'player') return;
      if (pid === targeting.byId) return;
      applyTargetCard(pid);
    };
  });

  // 手牌
  const hand = $('hand');
  hand.innerHTML = '';
  if (!p.hand.length) hand.innerHTML = '<span class="empty">手上没有卡</span>';
  for (const id of p.hand) {
    const card = CARD_LIST.find((c) => c.id === id);
    const b = document.createElement('button');
    b.className = 'card';
    b.textContent = card ? card.name : id;
    b.title = card ? card.desc : '';
    b.onclick = () => startTargeting(id);
    hand.appendChild(b);
  }

  // 提示条
  const hint = $('hint');
  if (targeting) {
    hint.textContent = targeting.kind === 'tile' ? '点击棋盘上的目标格子' : '点击右侧玩家头像';
    hint.classList.add('on');
  } else {
    hint.textContent = state.phase === 'shop' ? '商店：点卡片购买，也可以直接离开' : '';
    hint.classList.toggle('on', state.phase === 'shop');
  }

  // 日志
  $('log').innerHTML = state.log.slice(-6).map((l) => `<div>${l.text}</div>`).join('');
  $('log').scrollTop = $('log').scrollHeight;
}

/* ---------------- 卡片使用 ---------------- */

const TILE_TARGET = new Set(['placeBarrier', 'placeMine', 'areaDamage', 'forceBuy', 'rebuildProperty', 'demolish', 'swapProperty', 'sealStreet', 'raisePrice', 'upgradeOwn']);
const PLAYER_TARGET = new Set(['freeze', 'reverse', 'turtle', 'jail', 'tax', 'stealCard', 'sleepwalk', 'hibernate', 'averageCash']);
let targeting = null;
let blamePick = false;

function startTargeting(cardId) {
  if (net.mode === 'guest' && state.turn !== net.you) { toast('还没轮到你'); return; }
  const card = CARD_LIST.find((c) => c.id === cardId);
  if (!card) return;
  if (card.timing !== 'active') { toast('这张卡只能在被结算时触发'); return; }
  if (!['preRoll', 'postRoll'].includes(state.phase)) return;

  const type = card.effect.type;
  if (TILE_TARGET.has(type)) {
    targeting = { cardId, kind: 'tile', byId: state.turn };
    const p = state.players[state.turn];
    legalTiles = new Set();
    if (type === 'placeBarrier' || type === 'placeMine') {
      const range = (card.effect.range || 15) + 3; // 上限，实际由引擎再校验
      for (let k = 1; k <= range; k++) {
        legalTiles.add(((p.pos + (p.dir || 1) * k) % state.tiles.length + state.tiles.length) % state.tiles.length);
      }
      toast(`点击前方 ${range} 格内的目标`);
    } else {
      for (let i = 0; i < state.tiles.length; i++) legalTiles.add(i);
      toast('点击目标格子');
    }
    draw();
  } else if (PLAYER_TARGET.has(type)) {
    targeting = { cardId, kind: 'player', byId: state.turn };
    toast('点击右侧玩家头像');
  } else {
    if (!submit({ type: 'useCard', cardId })) { toast('现在不能用这张卡'); return; }
  }
  renderHUD();
}

function applyTargetCard(target) {
  if (!targeting) return;
  const cardId = targeting.cardId;
  targeting = null;
  legalTiles = null;
  if (!submit({ type: 'useCard', cardId, target })) toast('这个目标不合法');
  afterChange();
}

let rolling = false;
function doRoll() {
  if (rolling) return;
  rolling = true;
  const el = $('dice');
  const moverId = state.turn;
  const from = state.players[moverId].pos;
  const fromZone = state.players[moverId].zone;
  let n = 0;
  const timer = setInterval(() => {
    el.textContent = `${1 + Math.floor(Math.random() * 6)} + ${1 + Math.floor(Math.random() * 6)}`;
    if (++n > 6) {
      clearInterval(timer);
      submit({ type: 'roll' });
      const mover = state.players[moverId];
      if (fromZone === 'ring' && mover.zone === 'ring') {
        const steps = ((mover.pos - from) % state.tiles.length + state.tiles.length) % state.tiles.length;
        startAnim(moverId, from, steps);
      }
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
    if (!s || !s.board || !s.players) return null;
    // 地价与当前配置对不上 → 视为旧存档，直接丢弃（否则会看到上一版的价格）
    const tile = s.tiles?.find((t) => t.kind === 'small');
    const tiers = ruleset.land.small.tiers;
    if (!tile || !tiers.includes(tile.price)) return null;
    if (s.ruleset?.economy?.initialCash !== ruleset.economy.initialCash) return null;
    return s;
  } catch (_) { return null; }
}

/* ---------------- 启动 ---------------- */

$('follow').onclick = () => { follow = !follow; updateFollowBtn(); if (follow) { centerOnCurrent(); draw(); } };
$('newgame').onclick = showSetup;

const saved = load();
if (saved) {
  state = saved;
  setupChoice.map = saved.mapId || 'small';
  setupChoice.players = saved.players.length;
  $('setup').hidden = true;
} else {
  state = createGame({
    ruleset,
    mapId: 'small',
    names: ['甲', '乙', '丙', '丁'],
    seed: 20261102,
    characterIds: CHARACTER_LIST.slice(0, 4).map((c) => c.id),
  });
  showSetup();
}

resize();
centerOnCurrent();
draw();
renderHUD();
updateFollowBtn();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('../sw.js').catch(() => {}));
}
