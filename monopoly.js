/* 大富翁 · 界面层（规则全在 monopoly-engine.mjs） */
import * as E from './monopoly-engine.mjs';

const SAVE_KEY = 'monopoly-save-v1';
const COLORS = ['#c9534a', '#4a8fc9', '#55a06b', '#d4b03c'];
const TYPE_COLOR = {
  rail: '#8a7a5c', util: '#5b8f8a', chance: '#6c5b8f',
  fate: '#8f6c5b', tax: '#8a5b5b', go: '#d9b26a',
  jail: '#6b7f75', parking: '#5c7a6a', gotojail: '#9a5b4a',
};
const PHASE_TEXT = {
  awaitRoll: '掷骰前进', awaitJail: '狱中', awaitBuy: '决定是否买地',
  awaitEnd: '可以结束回合', ended: '对局结束',
};

let state = null;
let setup = { count: 2, rounds: 80 };
let soundOn = true;
let selectedPos = null;

const $ = (id) => document.getElementById(id);
const boardEl = $('board');

/* ---------- 音效 ---------- */
let actx = null;
function beep(freq = 520, dur = 0.06, type = 'sine', gain = 0.04) {
  if (!soundOn) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g); g.connect(actx.destination);
    o.start();
    o.stop(actx.currentTime + dur);
  } catch (_) { /* 静默 */ }
}

/* ---------- 棋盘 ---------- */
function gridOf(pos) {
  if (pos <= 10) return { col: 11 - pos, row: 11 };      // 下边：0 在右下角
  if (pos <= 20) return { col: 1, row: 21 - pos };        // 左边
  if (pos <= 30) return { col: pos - 19, row: 1 };        // 上边
  return { col: 11, row: pos - 29 };                      // 右边
}

function buildBoard() {
  const frag = document.createDocumentFragment();
  for (const t of E.TILES) {
    const { col, row } = gridOf(t.pos);
    const el = document.createElement('div');
    el.className = 'tile' + (['go', 'jail', 'parking', 'gotojail'].includes(t.type) ? ' corner' : '');
    el.dataset.pos = String(t.pos);
    el.style.gridColumn = String(col);
    el.style.gridRow = String(row);
    el.innerHTML = `
      <div class="band"></div>
      <div class="tname"></div>
      <div class="tsub"></div>
      <div class="houses"></div>
      <div class="tprice"></div>
      <div class="owner-dot" hidden></div>
      <div class="tokens"></div>`;
    el.addEventListener('click', () => openTile(t.pos));
    frag.appendChild(el);
  }
  boardEl.appendChild(frag);
}

function tileEl(pos) {
  return boardEl.querySelector(`.tile[data-pos="${pos}"]`);
}

/* ---------- 渲染 ---------- */
function render() {
  if (!state) return;
  const me = state.players[state.turn];
  $('roundInfo').textContent = `第 ${state.round} 回合 / 上限 ${state.maxRounds}`;
  $('turnLine').textContent = state.phase === 'ended' ? '对局结束' : PHASE_TEXT[state.phase] || '';
  $('turnName').textContent = state.phase === 'ended'
    ? (state.winner !== null ? `🏆 ${state.players[state.winner].name} 获胜` : '游戏结束')
    : `${me.token} ${me.name}`;

  $('die1').textContent = state.dice[0] || '?';
  $('die2').textContent = state.dice[1] || '?';

  renderTiles();
  renderPlayers();
  renderActions();
  renderPrompt();
  renderLog();
  renderMyProps();
}

function renderTiles() {
  const landed = state.lastLanded;
  for (const t of E.TILES) {
    const el = tileEl(t.pos);
    if (!el) continue;
    const owner = state.owners[t.pos];
    const h = state.houses[t.pos] || 0;
    const color = t.type === 'prop' ? E.GROUPS[t.group].color : (TYPE_COLOR[t.type] || '#2c4038');

    el.style.setProperty('--c', color);
    el.querySelector('.band').style.background = color;
    el.querySelector('.tname').textContent = t.name;
    el.querySelector('.tsub').textContent = t.type === 'prop' ? '' : (t.sub || '');
    const priceEl = el.querySelector('.tprice');
    priceEl.textContent = t.price ? `¥${t.price}` : (t.amount ? `-${t.amount}` : '');

    const housesEl = el.querySelector('.houses');
    housesEl.textContent = h === 5 ? '🏨' : '🏠'.repeat(h);

    const dot = el.querySelector('.owner-dot');
    if (owner !== undefined && owner !== null) {
      dot.hidden = false;
      dot.style.background = COLORS[owner % COLORS.length];
      el.style.setProperty('--oc', COLORS[owner % COLORS.length]);
      el.classList.add('owned');
      el.classList.toggle('mine', owner === state.turn);
    } else {
      dot.hidden = true;
      el.classList.remove('owned', 'mine');
    }
    el.classList.toggle('landed', landed === t.pos);

    const tokBox = el.querySelector('.tokens');
    tokBox.innerHTML = state.players
      .filter((p) => p.alive && p.pos === t.pos)
      .map((p) => `<span class="tok ${p.id === state.turn ? 'active' : ''}" title="${p.name}">${p.token}</span>`)
      .join('');
  }
}

function renderPlayers() {
  const box = $('players');
  box.innerHTML = state.players.map((p) => {
    const props = Object.keys(state.owners).filter((k) => state.owners[k] === p.id).length;
    const classes = ['pl'];
    if (p.id === state.turn && p.alive) classes.push('active');
    if (!p.alive) classes.push('out');
    const flags = [];
    if (p.inJail) flags.push(`<span class="badge">狱 ${p.jailTurns}/3</span>`);
    if (p.jailCards) flags.push(`<span class="badge">出狱卡 ×${p.jailCards}</span>`);
    if (!p.alive) flags.push('<span class="badge">出局</span>');
    return `<div class="${classes.join(' ')}">
      <div class="avatar" style="box-shadow:inset 0 0 0 1px ${COLORS[p.id % COLORS.length]}55">${p.token}</div>
      <div>
        <div class="nm">${escapeHtml(p.name)}${flags.join('')}</div>
        <div class="meta">${props} 处地产 · 总资产 ${E.money(E.netWorth(state, p))}</div>
      </div>
      <div class="cash">¥${E.money(p.cash)}<small>现金</small></div>
    </div>`;
  }).join('');
}

function renderActions() {
  const box = $('actions');
  const me = state.players[state.turn];
  const btns = [];
  if (state.phase === 'ended') {
    btns.push(`<button class="btn primary" data-act="restart">再来一局</button>`);
  } else if (state.phase === 'awaitRoll') {
    btns.push(`<button class="btn primary" data-act="roll">掷骰子</button>`);
  } else if (state.phase === 'awaitJail') {
    btns.push(`<button class="btn primary" data-act="roll">掷骰子（博对子）</button>`);
    btns.push(`<button class="btn" data-act="fine" ${me.cash < E.JAIL_FINE ? 'disabled' : ''}>缴 ${E.JAIL_FINE} 元保释</button>`);
    if (me.jailCards > 0) btns.push(`<button class="btn" data-act="card">用出狱卡（${me.jailCards}）</button>`);
  } else if (state.phase === 'awaitBuy') {
    // 购买选项在中央提示框里
    btns.push(`<button class="btn" data-act="pass">暂不购买</button>`);
    btns.push(`<button class="btn primary" data-act="buy">买下</button>`);
  } else if (state.phase === 'awaitEnd') {
    btns.push(`<button class="btn primary" data-act="end">结束回合</button>`);
  }
  box.innerHTML = btns.join('');
}

function renderPrompt() {
  const box = $('promptBox');
  if (state.phase === 'awaitBuy' && state.pending) {
    const t = E.TILES[state.pending.pos];
    box.innerHTML = `<div class="prompt">
      <p>停在「${t.name}」，售价 <b style="color:var(--gold)">¥${t.price}</b>，买下可以收租。</p>
    </div>`;
  } else if (state.phase === 'awaitJail') {
    box.innerHTML = `<div class="prompt"><p>你在监狱里。掷出对子即可出狱，或缴费、用卡。</p></div>`;
  } else if (state.phase === 'awaitEnd' && state.doubles > 0) {
    box.innerHTML = `<div class="prompt"><p>掷出对子，还能再走一次。</p></div>`;
  } else {
    box.innerHTML = '';
  }
}

function renderLog() {
  const box = $('log');
  const lines = state.log.slice(-40);
  box.innerHTML = lines.map((l) => {
    const hl = /🏆|破产|获胜|上限/.test(l);
    return `<div class="${hl ? 'hl' : ''}">${escapeHtml(l)}</div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

function renderMyProps() {
  const p = state.players[state.turn];
  const owned = Object.keys(state.owners).filter((k) => state.owners[k] === p.id).map(Number);
  $('myCount').textContent = owned.length ? `（${owned.length}）` : '';
  const box = $('myProps');
  if (!owned.length) {
    box.innerHTML = `<span style="color:#6f8579;font-size:12px">还没买地。停到空地时可以买下。</span>`;
    return;
  }
  box.innerHTML = owned.map((pos) => {
    const t = E.TILES[pos];
    const h = state.houses[pos] || 0;
    const hText = h === 5 ? '旅馆' : h > 0 ? `${h} 级` : '空地';
    return `<button class="chip" data-tile="${pos}">
      <span style="color:${t.type === 'prop' ? E.GROUPS[t.group].color : '#b0a184'}">■</span>
      ${escapeHtml(t.name)} <b>${hText}</b>
    </button>`;
  }).join('');
  box.querySelectorAll('[data-tile]').forEach((b) => {
    b.addEventListener('click', () => openTile(Number(b.dataset.tile)));
  });
}

/* ---------- 交互 ---------- */
function apply(next, soundFreq) {
  if (next === state) { toast('这一步现在做不了'); return; }
  const before = state;
  state = next;
  save();
  if (state.phase === 'ended' && before.phase !== 'ended') beep(880, 0.18, 'triangle', 0.05);
  else if (soundFreq) beep(soundFreq);
  render();
}

function doRoll() {
  const d1 = $('die1'), d2 = $('die2');
  const moverId = state.turn;
  d1.classList.add('rolling'); d2.classList.add('rolling');
  beep(300, 0.05, 'square', 0.03);
  let ticks = 0;
  const iv = setInterval(() => {
    d1.textContent = 1 + Math.floor(Math.random() * 6);
    d2.textContent = 1 + Math.floor(Math.random() * 6);
    if (++ticks > 7) {
      clearInterval(iv);
      d1.classList.remove('rolling'); d2.classList.remove('rolling');
      const next = E.roll(state);
      if (next !== state && next.players[moverId]) {
        next.lastLanded = next.players[moverId].pos;
      }
      apply(next, 660);
      setTimeout(() => { if (state) { state.lastLanded = undefined; renderTiles(); } }, 900);
    }
  }, 55);
}

boardEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'roll') return doRoll();
  if (act === 'buy') return apply(E.decideBuy(state, true), 720);
  if (act === 'pass') return apply(E.decideBuy(state, false), 380);
  if (act === 'end') return apply(E.endTurn(state), 420);
  if (act === 'fine') return apply(E.payJailFine(state), 480);
  if (act === 'card') return apply(E.useJailCard(state), 520);
  if (act === 'restart') return startFlow();
});

/* ---------- 地产详情 ---------- */
function openTile(pos) {
  if (!state) return;
  selectedPos = pos;
  renderTileModal();
  $('tileOverlay').hidden = false;
}

function renderTileModal() {
  const pos = selectedPos;
  const t = E.TILES[pos];
  const owner = state.owners[pos];
  const cur = state.players[state.turn];
  const h = state.houses[pos] || 0;

  let rows = '';
  if (t.type === 'prop') {
    const rents = t.rents;
    const labels = ['空地', '1 级', '2 级', '3 级', '4 级', '旅馆'];
    rows = rents.map((r, i) => `<tr class="${i === h ? 'cur' : ''}"><td>${labels[i]}</td><td>¥${r}${i === 0 && owner !== undefined && E.groupComplete(state, owner, t.group) ? '（整组翻倍 ¥' + r * 2 + '）' : ''}</td></tr>`).join('');
  } else if (t.type === 'rail') {
    rows = [25, 50, 100, 200].map((r, i) => `<tr class="${i === 0 ? 'cur' : ''}"><td>拥有 ${i + 1} 座车站</td><td>¥${r}</td></tr>`).join('');
  } else if (t.type === 'util') {
    rows = `<tr><td>拥有 1 座</td><td>骰点 × 4</td></tr><tr><td>拥有 2 座</td><td>骰点 × 10</td></tr>`;
  }

  const ownerName = owner !== undefined && owner !== null ? state.players[owner].name : '无主';
  const canBuildNow = owner !== undefined && owner === cur.id && E.canBuild(state, pos, cur.id) && ['awaitRoll', 'awaitEnd'].includes(state.phase);
  const canSellNow = owner !== undefined && owner === cur.id && h > 0 && ['awaitRoll', 'awaitEnd'].includes(state.phase);
  const buildCost = t.house ? Math.floor(t.house / 2) : 0;

  $('tileModal').innerHTML = `
    <h3>${escapeHtml(t.name)}${t.type === 'prop' ? ` <span class="badge" style="background:${E.GROUPS[t.group].color}22;color:${E.GROUPS[t.group].color}">${E.GROUPS[t.group].name}组</span>` : ''}</h3>
    <p>${t.type === 'prop' ? `地价 ¥${t.price} · 每级建筑 ¥${t.house}` : t.type === 'rail' ? '火车站 · 地价 ¥200' : t.type === 'util' ? '公用事业 · 地价 ¥150' : (t.sub || '')}</p>
    <p>当前归属：<b style="color:${owner !== undefined && owner !== null ? COLORS[owner % COLORS.length] : '#8a9a8f'}">${escapeHtml(ownerName)}</b>${h ? ` · 已建 <b>${h === 5 ? '旅馆' : h + ' 级'}</b>` : ''}</p>
    ${rows ? `<table class="rent">${rows}</table>` : ''}
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
      ${canBuildNow ? `<button class="btn primary" id="mBuild">升级（¥${t.house}）</button>` : ''}
      ${canSellNow ? `<button class="btn" id="mSell">拆一级（退 ¥${buildCost}）</button>` : ''}
      <button class="btn" id="mClose">关闭</button>
    </div>`;

  $('mClose').addEventListener('click', () => { $('tileOverlay').hidden = true; });
  const mb = $('mBuild'); if (mb) mb.addEventListener('click', () => {
    const next = E.build(state, pos);
    if (next === state) return toast('现在不能升级（需要整组齐全、且各组建筑数平衡）');
    apply(next, 700); renderTileModal();
  });
  const ms = $('mSell'); if (ms) ms.addEventListener('click', () => {
    const next = E.sellBuilding(state, pos);
    if (next === state) return toast('只能从建筑最多的一处拆，且要轮流拆');
    apply(next, 430); renderTileModal();
  });
}

$('tileOverlay').addEventListener('click', (e) => {
  if (e.target === $('tileOverlay')) $('tileOverlay').hidden = true;
});

/* ---------- 规则 / 音效 ---------- */
$('btnRules').addEventListener('click', () => { $('rulesOverlay').hidden = false; });
$('btnCloseRules').addEventListener('click', () => { $('rulesOverlay').hidden = true; });
$('rulesOverlay').addEventListener('click', (e) => { if (e.target === $('rulesOverlay')) $('rulesOverlay').hidden = true; });
$('btnSound').addEventListener('click', () => {
  soundOn = !soundOn;
  $('btnSound').textContent = soundOn ? '🔔' : '🔕';
  $('btnSound').setAttribute('aria-pressed', String(soundOn));
});

/* ---------- 设置 / 存档 ---------- */
function setupNames() {
  const box = $('nameFields');
  const names = [];
  box.innerHTML = Array.from({ length: setup.count }, (_, i) => `
    <div class="field">
      <label>玩家 ${i + 1} ${E.TOKENS[i]}</label>
      <input maxlength="12" data-i="${i}" value="玩家 ${i + 1}" />
    </div>`).join('');
  box.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('input', () => { names[Number(inp.dataset.i)] = inp.value; });
  });
}

$('countBtns').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-n]');
  if (!b) return;
  setup.count = Number(b.dataset.n);
  [...$('countBtns').children].forEach((x) => x.classList.toggle('on', x === b));
  setupNames();
});

$('roundBtns').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-r]');
  if (!b) return;
  setup.rounds = Number(b.dataset.r);
  [...$('roundBtns').children].forEach((x) => x.classList.toggle('on', x === b));
});

$('btnStart').addEventListener('click', () => {
  const inputs = [...$('nameFields').querySelectorAll('input')];
  const names = inputs.map((inp, i) => (inp.value || '').trim() || `玩家 ${i + 1}`);
  state = E.newGame(names, { maxRounds: setup.rounds });
  state = E.normalize(state);
  $('setupOverlay').hidden = true;
  save();
  render();
  beep(600, 0.08, 'triangle', 0.04);
});

function startFlow() {
  $('setupOverlay').hidden = false;
  setupNames();
}

$('btnNew').addEventListener('click', () => {
  if (state && state.phase !== 'ended' && !confirm('放弃当前对局，重新开一局？')) return;
  localStorage.removeItem(SAVE_KEY);
  startFlow();
});

function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (_) {}
}

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.players) || !s.players.length) return null;
    return E.normalize(s);
  } catch (_) { return null; }
}

/* ---------- 杂项 ---------- */
let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- 启动 ---------- */
buildBoard();
const saved = load();
if (saved) {
  state = saved;
  $('setupOverlay').hidden = true;
  render();
} else {
  $('setupOverlay').hidden = false;
  setupNames();
  renderEmptyBoard();
}

function renderEmptyBoard() {
  for (const t of E.TILES) {
    const el = tileEl(t.pos);
    const color = t.type === 'prop' ? E.GROUPS[t.group].color : (TYPE_COLOR[t.type] || '#2c4038');
    el.style.setProperty('--c', color);
    el.querySelector('.band').style.background = color;
    el.querySelector('.tname').textContent = t.name;
    el.querySelector('.tsub').textContent = t.type === 'prop' ? '' : (t.sub || '');
    el.querySelector('.tprice').textContent = t.price ? `¥${t.price}` : '';
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
