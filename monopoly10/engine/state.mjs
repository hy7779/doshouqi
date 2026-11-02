/**
 * 游戏状态：建局、建棋盘、玩家初始化
 * 棋盘由 board.mjs 生成（同 seed 同图）
 */
import { MAPS } from '../config/maps.mjs';
import { CHARACTER_LIST } from '../config/characters.mjs';
import { CARD_LIST } from '../config/cards.mjs';
import { makeSeed } from './rng.mjs';
import { pct } from './money.mjs';
import { generateBoard } from './board.mjs';

export function pushLog(state, text) {
  state.log.push({ day: state.day, round: state.round, text });
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
}

function modValue(char, type, field) {
  return (char.mods || [])
    .filter((m) => m.type === type)
    .reduce((sum, m) => sum + (typeof m[field] === 'number' ? m[field] : 0), 0);
}

export function createPlayer(state, index, name, charId) {
  const ruleset = state.ruleset;
  const char = CHARACTER_LIST.find((c) => c.id === charId) || CHARACTER_LIST[index % CHARACTER_LIST.length];
  const cashPct = modValue(char, 'startCashPercent', 'percent');
  const depPct = modValue(char, 'startDepositPercent', 'percent');

  const hand = [];
  for (const m of char.mods || []) {
    if (m.type === 'startCard' && CARD_LIST.some((c) => c.id === m.cardId)) hand.push(m.cardId);
  }

  return {
    id: index,
    name: name || `玩家 ${index + 1}`,
    charId: char.id,
    cash: pct(ruleset.economy.initialCash, 100 + cashPct),
    deposit: pct(ruleset.economy.initialCash, depPct),
    zone: 'ring',
    pos: Math.floor((index * state.board.ring.length) / Math.max(1, state.playerCount)),
    innerReturn: null,
    exitPath: null,
    alive: true,
    skip: 0,
    hand,
    laps: 0,
  };
}

export function createGame({ ruleset, mapId, names = [], seed = 1, characterIds = null }) {
  const map = MAPS[mapId || ruleset.rules.mapId];
  if (!map) throw new Error(`未知地图 ${mapId}`);

  const state = {
    version: 1,
    ruleset,
    mapId: map.id,
    rngSeed: makeSeed(seed),
    playerCount: names.length || 2,
    day: 1,
    round: 1,
    turn: 0,
    phase: 'preRoll',
    dice: [0, 0],
    pending: null,
    board: null,
    tiles: null,
    mapSides: { w: map.sides.w, h: map.sides.h },
    players: [],
    log: [],
    stats: { cardsDrawn: 0, cardsPlayed: 0, bankruptcies: 0 },
  };

  state.board = generateBoard(map, seed);
  state.tiles = state.board.ring; // 常用别名：环上的格子

  const pool = [...CHARACTER_LIST];
  for (let i = 0; i < state.playerCount; i++) {
    const charId = characterIds?.[i] || pool[i % pool.length].id;
    state.players.push(createPlayer(state, i, names[i], charId));
  }

  pushLog(state, `开局：${state.players.map((p) => `${p.name}(${p.charId})`).join('、')} · 地图 ${map.name} · seed ${seed}`);
  startTurn(state);
  return state;
}

export function startTurn(state) {
  const p = state.players[state.turn];
  if (!p.alive) return;
  state.phase = 'preRoll';
  state.pending = null;
  pushLog(state, `轮到 ${p.name}`);
}
