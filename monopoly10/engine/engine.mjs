/**
 * 回合引擎（骨架）
 *
 * 所有对外的动作都是纯函数：接收 state，返回新的 state，绝不修改入参。
 * 这样客户端可以拿房主下发的 state 做预测，也可以重放验证。
 *
 * 已实现：移动、过起点工资、买地、升级、收租（连锁/角色/物价）、
 *         破产、特殊格基础处理、四张卡片效果、回合推进、回合上限结算。
 * 未实现（都标了 TODO）：内圈小路、出院支路、银行/彩票/商店/新闻/魔法屋的完整交互、
 *         建筑六种类型的特殊效果、响应式卡片、神仙系统。
 */
import { CARD_LIST, CARD_WEIGHTS, DEFAULT_CARD_WEIGHT } from '../config/cards.mjs';
import { CHARACTER_LIST } from '../config/characters.mjs';
import { rollDice, rngNext, rngInt } from './rng.mjs';
import { mulDivRound, pct, intSqrt } from './money.mjs';
import { pushLog, startTurn } from './state.mjs';

const clone = (s) => structuredClone(s);
const cur = (s) => s.players[s.turn];

/** 角色被动求和（例如 rentInPercent 的 percent=20）
 *  默认读取 mod.percent；天数/格数类可显式传 field（days / tiles / count / value）。 */
export function mod(state, player, type, field = 'percent') {
  const char = CHARACTER_LIST.find((c) => c.id === player.charId);
  if (!char) return 0;
  return (char.mods || [])
    .filter((m) => m.type === type)
    .reduce((sum, m) => sum + (typeof m[field] === 'number' ? m[field] : 0), 0);
}

export function inflationBp(state) {
  const inf = state.ruleset.inflation;
  const raw = inf.baseBp + inf.stepBp * (state.round - 1);
  return Math.min(inf.capBp, mulDivRound(raw, state.ruleset.multipliers.inflationBp, 10000));
}

export function salaryFor(state, player) {
  const base = pct(state.ruleset.economy.salary, 100 + mod(state, player, 'salaryPercent'));
  const mul = intSqrt(inflationBp(state) * 10000); // √物价（万分比）
  return mulDivRound(base, mul, 10000);
}

/** 同一街道上连续属于同一人的小地皮数量 */
function chainLength(state, pos, ownerId) {
  const t = state.tiles[pos];
  if (t.kind !== 'small') return 1;
  let len = 1;
  const N = state.tiles.length;
  for (let d = 1; d <= 4; d++) {
    const j = (pos - d + N) % N;
    const tj = state.tiles[j];
    if (tj.kind === 'small' && tj.owner === ownerId && tj.streetId === t.streetId) len++; else break;
  }
  for (let d = 1; d <= 4; d++) {
    const j = (pos + d) % N;
    const tj = state.tiles[j];
    if (tj.kind === 'small' && tj.owner === ownerId && tj.streetId === t.streetId) len++; else break;
  }
  return Math.min(5, len);
}

/**
 * 租金 = 地价 × 等级系数 × 连锁 × 物价 × 收租方加成 × 付租方减免
 * 全程整数。
 */
export function rentFor(state, pos, payer) {
  const t = state.tiles[pos];
  if (t.owner == null) return 0;
  const rs = state.ruleset;
  let base;

  if (t.kind === 'small') {
    base = pct(t.price, rs.land.small.rentCurve[t.level - 1]);
    if (t.owner >= 0) {
      const owner = state.players[t.owner];
      const chain = chainLength(state, pos, t.owner);
      // 角色连锁加成只在真正连成 2 块以上时生效
      const bonus = rs.land.small.chainBonus[chain - 1] + (chain >= 2 ? mod(state, owner, 'chainBonusPercent') : 0);
      base = pct(base, 100 + bonus);
    }
  } else if (t.kind === 'big') {
    const rate = t.level === 0 ? rs.land.big.level0Rent : rs.land.big.rentCurve[t.level - 1];
    base = pct(t.price, rate);
  } else {
    return 0;
  }

  base = mulDivRound(base, inflationBp(state), 10000);

  if (t.owner >= 0) {
    const owner = state.players[t.owner];
    base = mulDivRound(base, 10000 + mod(state, owner, 'rentInPercent') * 100, 10000);
  }
  base = mulDivRound(base, 10000 + (mod(state, payer, 'rentOutPercent') || 0) * 100, 10000);
  return Math.max(0, base);
}

/* ---------------- 钱与破产 ---------------- */

export function pay(state, payer, amount, to) {
  if (amount <= 0) return true;
  if (payer.cash >= amount) {
    payer.cash -= amount;
    if (to) to.cash += amount;
    return true;
  }
  // 现金不足：从存款补
  const need = amount - payer.cash;
  const take = Math.min(payer.deposit, need);
  payer.deposit -= take;
  payer.cash += take;
  if (payer.cash >= amount) {
    payer.cash -= amount;
    if (to) to.cash += amount;
    return true;
  }
  bankrupt(state, payer, to);
  return false;
}

function bankrupt(state, p, to) {
  p.alive = false;
  state.stats.bankruptcies++;
  // 地产收归系统（owner = -1），其他玩家踩到仍要付租
  for (const t of state.tiles) {
    if (t.owner === p.id) t.owner = -1;
  }
  if (to && to.alive) to.cash += p.cash;
  p.cash = 0;
  p.deposit = 0;
  p.hand = [];
  pushLog(state, `💥 ${p.name} 破产出局`);
  const alive = state.players.filter((x) => x.alive);
  if (alive.length <= 1) endGame(state, alive[0]);
}

export function endGame(state, winner) {
  if (state.phase === 'ended') return;
  state.phase = 'ended';
  if (!winner) {
    const alive = state.players.filter((p) => p.alive);
    if (alive.length === 1) winner = alive[0];
    else {
      winner = [...state.players].sort((a, b) => (b.cash + b.deposit) - (a.cash + a.deposit))[0];
    }
  }
  state.winner = winner ? winner.id : null;
  pushLog(state, `🏆 对局结束，${winner ? winner.name : '无人'} 获胜`);
}

/* ---------------- 回合推进 ---------------- */

function nextAliveFrom(state, from) {
  const n = state.players.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (state.players[i].alive) return i;
  }
  return -1;
}

function advance(state) {
  if (state.phase === 'ended') return;
  state.pending = null;
  state.dice = [0, 0];
  let guard = 0;
  while (guard++ < 1000) {
    const next = nextAliveFrom(state, state.turn);
    if (next < 0) return endGame(state);
    if (next <= state.turn) state.round++;
    state.turn = next;
    if (state.round > state.ruleset.rules.maxRounds) return endGame(state);

    const p = cur(state);
    if (p.skip > 0) {
      p.skip--;
      const fee = state.ruleset.economy.hospitalFeePerDay;
      pushLog(state, `${p.name} 休养/服刑，跳过本回合（医疗费 ${fee}，剩 ${p.skip}）`);
      pay(state, p, fee, null);
      if (!p.alive) continue;
      continue;
    }
    startTurn(state);
    return;
  }
}

/* ---------------- 落点结算 ---------------- */

function drawCard(state, p) {
  const rs = state.ruleset;
  const pool = CARD_LIST.filter((c) => c.minRound <= state.round);
  if (!pool.length) return;
  const weights = pool.map((c) => CARD_WEIGHTS[c.id] ?? DEFAULT_CARD_WEIGHT);
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rngNext(state) * total;
  let idx = 0;
  for (let i = 0; i < pool.length; i++) { roll -= weights[i]; if (roll <= 0) { idx = i; break; } }
  if (p.hand.length >= rs.cards.hand.limit) {
    pushLog(state, `${p.name} 手牌已满，${pool[idx].name} 作废`);
    return;
  }
  p.hand.push(pool[idx].id);
  state.stats.cardsDrawn++;
  pushLog(state, `${p.name} 抽到「${pool[idx].name}」`);
}

function landRing(state, p) {
  const t = state.tiles[p.pos];

  if (t.kind === 'small' || t.kind === 'big') {
    if (t.owner == null) {
      if (p.cash >= t.price) {
        state.pending = { pos: p.pos, price: t.price };
        state.phase = 'awaitBuy';
        return;
      }
      pushLog(state, `${p.name} 现金不足，买不起这里的 ${t.price}`);
    } else if (t.owner === p.id) {
      // 自己的地，可升级
    } else {
      const owner = t.owner >= 0 ? state.players[t.owner] : null;
      const rent = rentFor(state, p.pos, p);
      if (rent > 0) {
        pushLog(state, `${p.name} 踩到${owner ? owner.name : '系统'}的地，付租 ${rent}`);
        pay(state, p, rent, owner);
      }
    }
    if (!p.alive) { advance(state); return; }
    state.phase = 'postRoll';
    return;
  }

  if (t.kind === 'special') {
    switch (t.label) {
      case 'card':
        drawCard(state, p);
        break;
      case 'tax': {
        const amount = pct(p.cash, 10); // TODO: 税率进 ruleset
        pushLog(state, `${p.name} 缴税 ${amount}`);
        pay(state, p, amount, null);
        break;
      }
      case 'bank':    pushLog(state, `${p.name} 经过银行（交互待接入）`); break;
      case 'lottery': pushLog(state, `${p.name} 经过彩票点（交互待接入）`); break;
      case 'shop':    pushLog(state, `${p.name} 停在商店（交互待接入）`); break;
      case 'news':    pushLog(state, `${p.name} 触发新闻（待接入）`); break;
      case 'magic':   pushLog(state, `${p.name} 进入魔法屋（待接入）`); break;
      case 'junction': pushLog(state, `${p.name} 停在医院/监狱支路的汇入口`); break;
      case 'teleportOuter': {
        const N = state.tiles.length;
        let target = 0;
        for (let tries = 0; tries < 30; tries++) {
          target = rngInt(state, 0, N - 1);
          const tt = state.tiles[target];
          if (tt.label === 'teleportOuter') continue;
          if (target === state.board.meta.hospitalJunction || target === state.board.meta.jailJunction) continue;
          break;
        }
        p.pos = target;
        pushLog(state, `${p.name} 被外圈传送点送到第 ${target} 格`);
        landRing(state, p); // 落点可能可买地 / 商店
        return;
      }
      default:        pushLog(state, `${p.name} 什么也没发生`);
    }
    if (!p.alive) { advance(state); return; }
    state.phase = 'postRoll';
    return;
  }

  state.phase = 'postRoll';
}

/* ---------------- 移动（按区域） ---------------- */

/** 走一格；跨区域时自动切换 zone */
function stepOnce(state, p) {
  const ring = state.tiles;
  const N = ring.length;

  if (p.zone === 'ring') {
    p.pos = (p.pos + 1) % N;
    if (p.pos === 0) {
      p.laps++;
      const salary = salaryFor(state, p);
      p.cash += salary;
      pushLog(state, `${p.name} 经过起点，领工资 ${salary}`);
    }
    // 二类传送点：经过即进入内圈
    if (ring[p.pos].label === 'teleportInner') {
      p.innerReturn = p.pos;
      p.zone = 'inner';
      p.pos = 0;
      pushLog(state, `${p.name} 踩上二类传送点，进入内圈`);
    }
    return;
  }

  if (p.zone === 'inner') {
    const inner = state.board.inner;
    p.pos = (p.pos + 1) % inner.length;
    if (inner[p.pos].isExit) {
      const back = p.innerReturn ?? 0;
      p.zone = 'ring';
      p.pos = back;
      p.innerReturn = null;
      pushLog(state, `${p.name} 从内圈传送回大道第 ${back} 格，保持原方向`);
    }
    return;
  }

  if (p.zone === 'exit') {
    const path = state.board.exits[p.exitPath];
    p.pos += 1;
    if (p.pos >= path.length) {
      const junction = p.exitPath === 'hospital' ? state.board.meta.hospitalJunction : state.board.meta.jailJunction;
      p.zone = 'ring';
      p.pos = junction;
      p.exitPath = null;
      pushLog(state, `${p.name} 走出支路，汇入大道第 ${junction} 格`);
    }
  }
}

/** 落点结算：按区域分发 */
function landAny(state, p) {
  if (p.zone === 'inner') return landInner(state, p);
  if (p.zone === 'exit') return landExit(state, p);
  return landRing(state, p);
}

function landInner(state, p) {
  const t = state.board.inner[p.pos];
  const salary = state.ruleset.economy.salary;
  switch (t.label) {
    case 'wageUp': {
      const gain = pct(salary, 50); // TODO: 工资格金额进 ruleset
      p.cash += gain;
      pushLog(state, `${p.name} 在内圈领工资 ${gain}`);
      break;
    }
    case 'wageDown': {
      const loss = pct(salary, 50);
      pushLog(state, `${p.name} 在内圈被罚 ${loss}`);
      pay(state, p, loss, null);
      break;
    }
    case 'card': drawCard(state, p); break;
    case 'news': pushLog(state, `${p.name} 内圈新闻（待接入）`); break;
    case 'magic': pushLog(state, `${p.name} 内圈魔法屋（待接入）`); break;
    default: pushLog(state, `${p.name} 在内圈什么也没发生`);
  }
  if (!p.alive) { advance(state); return; }
  state.phase = 'postRoll';
}

function landExit(state, p) {
  const t = state.board.exits[p.exitPath][p.pos];
  const salary = state.ruleset.economy.salary;
  switch (t.label) {
    case 'wageUp': {
      const gain = pct(salary, 30); // TODO: 进 ruleset
      p.cash += gain;
      pushLog(state, `${p.name} 在支路领到 ${gain}`);
      break;
    }
    case 'wageDown': {
      const loss = pct(salary, 30);
      pushLog(state, `${p.name} 在支路被扣 ${loss}`);
      pay(state, p, loss, null);
      break;
    }
    default: break;
  }
  if (!p.alive) { advance(state); return; }
  state.phase = 'postRoll';
}

function moveAndLand(state, p, steps) {
  for (let i = 0; i < steps; i++) stepOnce(state, p);
  landAny(state, p);
}

/* ---------------- 对外动作 ---------------- */

export function roll(state0) {
  if (state0.phase !== 'preRoll') return state0;
  const state = clone(state0);
  const p = cur(state);
  let sum;
  if (state.pendingDice) {
    sum = state.pendingDice;
    state.dice = [sum, 0];
    state.pendingDice = null;
    pushLog(state, `${p.name} 使用遥控骰子，走 ${sum} 步`);
  } else {
    const r = rollDice(state);
    state.dice = r.dice;
    sum = r.sum;
    pushLog(state, `${p.name} 掷出 ${r.dice[0]}+${r.dice[1]}=${sum}`);
  }
  moveAndLand(state, p, sum);
  return state;
}

export function buy(state0) {
  if (state0.phase !== 'awaitBuy' || !state0.pending) return state0;
  const state = clone(state0);
  const p = cur(state);
  const { pos, price } = state.pending;
  if (p.cash < price) return state0;
  p.cash -= price;
  const t = state.tiles[pos];
  t.owner = p.id;
  t.level = 1;
  if (t.kind === 'big') {
    for (const other of state.tiles) if (other.plotId && other.plotId === t.plotId) { other.owner = p.id; other.level = 1; }
  }
  pushLog(state, `${p.name} 买下 ${price} 元的地产`);
  state.pending = null;
  state.phase = 'postRoll';
  return state;
}

export function pass(state0) {
  if (state0.phase !== 'awaitBuy') return state0;
  const state = clone(state0);
  pushLog(state, `${cur(state).name} 放弃购买`);
  state.pending = null;
  state.phase = 'postRoll';
  return state;
}

export function upgrade(state0, pos) {
  if (!['postRoll', 'preRoll'].includes(state0.phase)) return state0;
  const state = clone(state0);
  const p = cur(state);
  const t = state.tiles[pos];
  if (!t || t.owner !== p.id) return state0;
  if (t.level >= 5) return state0;
  const rs = state.ruleset;
  const rate = t.kind === 'small' ? rs.land.small.upgradeRate : rs.land.big.upgradeRate;
  const discount = mod(state, p, 'buildDiscountPercent');
  const cost = pct(pct(t.price, rate), 100 - discount);
  if (p.cash < cost) return state0;
  p.cash -= cost;
  t.level++;
  if (t.kind === 'big') {
    for (const other of state.tiles) if (other.plotId && other.plotId === t.plotId) other.level = t.level;
  }
  pushLog(state, `${p.name} 把地产升到 ${t.level} 级，花费 ${cost}`);
  return state;
}

export function endTurn(state0) {
  if (state0.phase !== 'postRoll') return state0;
  const state = clone(state0);
  advance(state);
  return state;
}

export function useCard(state0, cardId, target = null) {
  if (!['preRoll', 'postRoll'].includes(state0.phase)) return state0;
  const state = clone(state0);
  const p = cur(state);
  const idx = p.hand.indexOf(cardId);
  if (idx < 0) return state0;
  const card = CARD_LIST.find((c) => c.id === cardId);
  if (!card || card.timing !== 'active') return state0;

  const ok = applyCardEffect(state, p, card, target);
  if (!ok) return state0;
  p.hand.splice(idx, 1);
  state.stats.cardsPlayed++;
  return state;
}

/**
 * 卡片效果分发（骨架）
 * 返回 false 表示"这个效果当前还不能用"，调用方不做消耗。
 */
export function applyCardEffect(state, player, card, target) {
  const e = card.effect;
  const others = state.players.filter((q) => q.alive && q.id !== player.id);
  const pickTarget = () => (target != null && state.players[target] ? state.players[target] : others[0]);

  switch (e.type) {
    case 'chooseDice': {
      const v = Math.min(e.maxStep, Math.max(e.minStep, Number(target) || e.minStep));
      state.pendingDice = v;
      pushLog(state, `${player.name} 使用「${card.name}」，指定 ${v} 步`);
      return true;
    }
    case 'tax': {
      const t = pickTarget();
      if (!t) return false;
      const amount = pct(t.cash, e.percent);
      pushLog(state, `${player.name} 对 ${t.name} 查税，拿走 ${amount}`);
      pay(state, t, amount, player);
      return true;
    }
    case 'jail': {
      const t = pickTarget();
      if (!t) return false;
      t.skip += e.turns || 1;
      t.zone = 'exit';
      t.exitPath = 'jail';
      t.pos = -1;
      pushLog(state, `${player.name} 把 ${t.name} 送进监狱（跳过 ${e.turns || 1} 回合）`);
      return true;
    }
    case 'freeze':
    case 'sleepwalk':
    case 'hibernate': {
      const t = pickTarget();
      if (!t) return false;
      t.skip += e.turns || 1;
      pushLog(state, `${player.name} 对 ${t.name} 使用「${card.name}」，跳过 ${e.turns || 1} 回合`);
      return true;
    }
    default:
      pushLog(state, `⚠ 卡片「${card.name}」效果（${e.type}）尚未实现`);
      return false;
  }
}

/** 统一入口：action = { type, ... } */
export function applyAction(state, action) {
  switch (action.type) {
    case 'roll': return roll(state);
    case 'buy': return buy(state);
    case 'pass': return pass(state);
    case 'upgrade': return upgrade(state, action.pos);
    case 'endTurn': return endTurn(state);
    case 'useCard': return useCard(state, action.cardId, action.target);
    default: throw new Error(`未知动作 ${action.type}`);
  }
}
