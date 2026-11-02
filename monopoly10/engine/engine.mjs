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
import { CARD_LIST, CARD_WEIGHTS, DEFAULT_CARD_WEIGHT, pickShopCards } from '../config/cards.mjs';
import { CHARACTER_LIST } from '../config/characters.mjs';
import { rollDice, rngNext, rngInt } from './rng.mjs';
import { mulDivRound, pct, intSqrt } from './money.mjs';
import { pushLog, startTurn } from './state.mjs';
import { GODS, GOD_MAP } from '../config/gods.mjs';
import { ringCoordOf } from './board.mjs';

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

/** 某个角色的所有 mod 中，匹配 type 的条目 */
function modList(player, type) {
  const char = CHARACTER_LIST.find((c) => c.id === player.charId);
  return (char?.mods || []).filter((m) => m.type === type);
}

/** 卡片射程加成（鼠的抢夺 +5、猫的转向 +5、豹的路障 +3） */
function rangeBonus(player, cardId) {
  return modList(player, 'cardRangeBonus')
    .filter((m) => m.cardId === cardId)
    .reduce((s, m) => s + (m.tiles || 0), 0);
}

/** 踩到某类格子时额外抽卡（鼠：卡片格 +1） */
function extraDraws(player, tileLabel) {
  return modList(player, 'cardDrawExtra')
    .filter((m) => m.tile === tileLabel)
    .reduce((s, m) => s + (m.count || 0), 0);
}

/** 环形距离 */
function ringDistance(a, b, N) {
  const d = Math.abs(a - b) % N;
  return Math.min(d, N - d);
}

function withinCardRange(state, player, target, base, cardId) {
  if (player.zone !== 'ring' || target.zone !== 'ring') return true;
  return ringDistance(player.pos, target.pos, state.tiles.length) <= base + rangeBonus(player, cardId);
}

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

/** 大型建筑的类型倍率（作用在“累计投入 × 40%”之上） */
const BUILDING_RENT_MULTIPLIER = {
  mall: 200,   // 商业中心：收得多
  hotel: 110,  // 大饭店：稍高 + 强制停留
  lab: 90,     // 研究所：靠产卡
  temple: 90,  // 土地庙：全局加成
  oil: 90,     // 石油公司：靠每回合油田收入
  bank2: 90,   // 证券中心：靠转移存款
};

export function bigTypeMultiplier(type) {
  return BUILDING_RENT_MULTIPLIER[type] || 100;
}

/**
 * 一处地产的累计投入（买地 + 所有升级花费）
 * 小地皮：买来即 1 级，升到 L 级的花费 = 2+3+...+L 倍地价
 * 大地皮：买来是 0 级，升到 L 级的花费 = 1+2+...+L 倍地价
 */
export function investedIn(t) {
  const lvl = Math.max(0, Math.min(5, t.level || 0));
  if (t.kind === 'small') {
    const L = Math.max(1, lvl);
    return t.price * ((L * (L + 1)) / 2);
  }
  return t.price * (1 + (lvl * (lvl + 1)) / 2);
}

/**
 * 租金 = 累计投入 × 20%（再乘连锁、物价、角色加成）
 * 全程整数。
 */
export function rentFor(state, pos, payer) {
  const t = state.tiles[pos];
  if (t.owner == null) return 0;
  if (t.park) return 0;
  if (t.sealedUntilRound && state.round <= t.sealedUntilRound) return 0;
  const rs = state.ruleset;

  if (t.kind !== 'small' && t.kind !== 'big') return 0;

  const pctOfInvestment = t.kind === 'small'
    ? rs.land.small.rentOfInvestmentPercent
    : rs.land.big.rentOfInvestmentPercent;
  let base = pct(investedIn(t), pctOfInvestment);

  if (t.kind === 'big') base = pct(base, bigTypeMultiplier(t.type));

  if (t.kind === 'small' && t.owner >= 0) {
    const owner = state.players[t.owner];
    const chain = chainLength(state, pos, t.owner);
    // 角色连锁加成只在真正连成 2 块以上时生效
    const bonus = rs.land.small.chainBonus[chain - 1] + (chain >= 2 ? mod(state, owner, 'chainBonusPercent') : 0);
    base = pct(base, 100 + bonus);
  }

  base = mulDivRound(base, inflationBp(state), 10000);

  if (t.boostUntilRound && state.round <= t.boostUntilRound) base = base * 2;

  if (t.owner >= 0) {
    const owner = state.players[t.owner];
    // 土地庙：全局租金加成
    let templeLevel = 0;
    for (const other of state.tiles) {
      if (other.owner === owner.id && other.type === 'temple') templeLevel = Math.max(templeLevel, other.level || 0);
    }
    if (templeLevel > 0) {
      base = pct(base, 100 + state.ruleset.buildings.temple.rentBonusPerLevel * templeLevel);
    }
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
    if (next <= state.turn) {
      state.round++;
      state.lottery.pool += state.ruleset.lottery.poolGrowthPerRound;
      applyBuildingIncome(state);
    }
    state.turn = next;
    state.turnCount = (state.turnCount || 0) + 1;
    // 银行结息与彩票开奖都按「回合」计：人数 × 3 回合 = 3 轮
    const cycleTurns = state.players.length * 3;
    if (state.turnCount % cycleTurns === 0) {
      payInterest(state, 3);
      drawLottery(state);
    }
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
    if (p.slow > 0) p.slow--;
    maybeSpawnGod(state);
    godTurnStart(state, p);
    if (!p.alive) continue;
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
  if (t.god) {
    const godId = t.god;
    t.god = null;
    attachGod(state, p, godId);
  }

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
        // 有免费/嫁祸卡就先暂停，等受害者决定
        if (pauseForReaction(state, p, 'loss', { amount: rent, creditorId: owner ? owner.id : null })) return;
        pay(state, p, rent, owner);
        if (!owner) state.lottery.pool += rent;
        if (t.type === 'hotel') {
          p.skip += 1;
          pushLog(state, `${p.name} 被大饭店留下住店 1 回合`);
        } // 无主地产的租金进彩票池
      }
    }
    if (!p.alive) { advance(state); return; }
    state.phase = 'postRoll';
    return;
  }

  if (t.kind === 'special') {
    switch (t.label) {
      case 'card': {
        drawCard(state, p);
        const extra = extraDraws(p, 'card');
        for (let i = 0; i < extra; i++) drawCard(state, p);
        break;
      }
      case 'tax': {
        const amount = pct(p.cash, 10); // TODO: 税率进 ruleset
        pushLog(state, `${p.name} 缴税 ${amount}`);
        pay(state, p, amount, null);
        break;
      }
      case 'shop': {
        const shop = pickShopCards(state.ruleset, state.round, () => rngNext(state));
        state.pending = { shop };
        state.phase = 'shop';
        pushLog(state, `${p.name} 停在商店，上架 ${shop.length} 张卡`);
        return;
      }
      case 'bank': {
        state.phase = 'bank';
        pushLog(state, `${p.name} 停在银行，可以存取款`);
        return;
      }
      case 'lottery': {
        state.phase = 'lottery';
        pushLog(state, `${p.name} 停在彩票点，奖池 ${state.lottery.pool}`);
        return;
      }
      case 'magic': {
        applyMagicEvent(state, p);
        break;
      }
      case 'news': {
        applyNews(state, p);
        break;
      }
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
    p.pos = (p.pos + (p.dir || 1) + N) % N;
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
    // 定时炸弹：每走一格 -1
    if (p.bomb != null) {
      p.bomb -= 1;
      if (p.bomb <= 0) {
        p.bomb = null;
        const t = ring[p.pos];
        if (t.kind === 'small' || t.kind === 'big') t.level = Math.max(0, (t.level || 0) - 2);
        pushLog(state, `${p.name} 身上的定时炸弹爆炸了`);
        sendToHospital(state, p, 1, '被炸伤');
      }
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

/** 工资格金额：3000 × (1 + 0.1 × 天数) */
export function wageTileAmount(state) {
  const { wageTileBase, wageTileGrowthPercent } = state.ruleset.economy;
  return mulDivRound(wageTileBase, 100 + wageTileGrowthPercent * (state.round - 1), 100);
}

function landInner(state, p) {
  const t = state.board.inner[p.pos];
  const wage = wageTileAmount(state);
  switch (t.label) {
    case 'wageUp': {
      p.cash += wage;
      pushLog(state, `${p.name} 在内圈领工资 ${wage}`);
      break;
    }
    case 'wageDown': {
      pushLog(state, `${p.name} 在内圈被罚 ${wage}`);
      pay(state, p, wage, null);
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
  const wage = wageTileAmount(state);
  switch (t.label) {
    case 'wageUp': {
      p.cash += wage;
      pushLog(state, `${p.name} 在支路领到 ${wage}`);
      break;
    }
    case 'wageDown': {
      pushLog(state, `${p.name} 在支路被扣 ${wage}`);
      pay(state, p, wage, null);
      break;
    }
    default: break;
  }
  if (!p.alive) { advance(state); return; }
  state.phase = 'postRoll';
}

function moveAndLand(state, p, steps) {
  for (let i = 0; i < steps; i++) {
    stepOnce(state, p);
    // 中途被送进医院/监狱：本回合结束
    if (p.zone === 'exit' && p.pos < 0) { state.phase = 'postRoll'; return; }
    if (p.zone === 'ring') {
      const t = state.tiles[p.pos];
      if (t.barrier) {
        t.barrier = false;
        pushLog(state, `${p.name} 被路障拦下，停在第 ${p.pos} 格`);
        break;
      }
      if (t.mine) {
        t.mine = false;
        if (t.kind === 'small' || t.kind === 'big') t.level = Math.max(0, (t.level || 0) - 1);
        sendToHospital(state, p, 1, '踩中地雷');
        return;
      }
    }
    if (state.phase === 'ended') return;
  }
  landAny(state, p);
  if (p.zone === 'ring' && p.alive) angelUpgrade(state, p);
}

/** 送医院：切到支路起点，跳过 n 回合 */
export function sendToHospital(state, p, turns, reason = '受伤') {
  const extra = hasGod(p, 'doom') ? 1 : 0;
  const reduce = mod(state, p, 'hospitalReduceDays', 'days');
  const total = Math.max(1, turns + extra - reduce);
  p.zone = 'exit';
  p.exitPath = 'hospital';
  p.pos = -1;
  p.skip += total;
  pushLog(state, `${p.name} ${reason}，送进医院（跳过 ${total} 回合）`);
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
  let steps = sum;
  if (p.slow > 0) {
    steps = 1;
    pushLog(state, `${p.name} 中了乌龟卡，只走 1 步`);
  }
  moveAndLand(state, p, steps);
  return state;
}

export function buy(state0) {
  if (state0.phase !== 'awaitBuy' || !state0.pending) return state0;
  const state = clone(state0);
  const p = cur(state);
  const { pos, price } = state.pending;
  if (p.cash < price) return state0;
  p.cash -= price;
  state.lottery.pool += price; // 购地款进奖池
  chargeEnergyFee(state, p, price);
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

/** 升级花费：每次 = 目标级数 × 地价（1→2 级收 2 倍地价，依此类推） */
export function upgradeCost(t, levels = 1) {
  let cost = 0;
  for (let k = 0; k < levels; k++) cost += (t.level + 1 + k) * t.price;
  return cost;
}

export function upgrade(state0, pos) {
  if (!['postRoll', 'preRoll'].includes(state0.phase)) return state0;
  const state = clone(state0);
  const p = cur(state);
  const t = state.tiles[pos];
  if (!t || t.owner !== p.id) return state0;
  if (t.level >= 5) return state0;
  if (t.kind === 'big' && (t.level || 0) === 0) {
    state.pending = { type: 'chooseBigType', pos };
    state.phase = 'bigType';
    return state;
  }
  const discount = mod(state, p, 'buildDiscountPercent');
  const cost = pct(upgradeCost(t, 1), 100 - discount);
  if (p.cash < cost) return state0;
  p.cash -= cost;
  t.level++;
  state.lottery.pool += cost; // 升级费进奖池
  if (t.kind === 'big') {
    for (const other of state.tiles) if (other.plotId && other.plotId === t.plotId) other.level = t.level;
  }
  pushLog(state, `${p.name} 把地产升到 ${t.level} 级，花费 ${cost}`);
  chargeEnergyFee(state, p, cost);
  return state;
}

/** 当前玩家升级某块地的实际花费（含角色折扣），给 UI 显示用 */
export function upgradeCostFor(state, pos) {
  const p = cur(state);
  const t = state.tiles[pos];
  if (!t) return 0;
  const discount = mod(state, p, 'buildDiscountPercent');
  return pct(upgradeCost(t, 1), 100 - discount);
}

/** 取消选类型：地皮保持 0 级，以后有钱再建 */
export function cancelBigType(state0) {
  if (state0.phase !== 'bigType') return state0;
  const state = clone(state0);
  pushLog(state, `${cur(state).name} 暂时不建，地皮保持空地`);
  state.pending = null;
  state.phase = 'postRoll';
  return state;
}

const BIG_TYPES = ['mall', 'hotel', 'lab', 'temple', 'oil', 'bank2'];

/** 大地皮升到 1 级时选择建筑类型 */
export function chooseBigType(state0, typeId) {
  if (state0.phase !== 'bigType' || state0.pending?.type !== 'chooseBigType') return state0;
  if (!BIG_TYPES.includes(typeId)) return state0;
  const state = clone(state0);
  const p = cur(state);
  const pos = state.pending.pos;
  const t = state.tiles[pos];
  if (!t || t.owner !== p.id) return state0;
  const cost = pct(upgradeCost(t, 1), 100 - mod(state, p, 'buildDiscountPercent'));
  if (p.cash < cost) return state0;
  p.cash -= cost;
  state.lottery.pool += cost;
  t.type = typeId;
  t.level = 1;
  for (const o of state.tiles) if (o.plotId && o.plotId === t.plotId) { o.type = typeId; o.level = 1; }
  pushLog(state, `${p.name} 把大地皮建成了${BIG_TYPE_NAME[typeId]}，花费 ${cost}`);
  chargeEnergyFee(state, p, cost);
  state.pending = null;
  state.phase = 'postRoll';
  return state;
}

export const BIG_TYPE_NAME = {
  mall: '商业中心', hotel: '大饭店', lab: '研究所',
  temple: '土地庙', oil: '石油公司', bank2: '证券中心',
};

/** 石油公司：对手买地/升级时收 15% 能源费 */
function chargeEnergyFee(state, payer, amount) {
  const rate = state.ruleset.buildings.oil.energyFee;
  const owners = new Set(
    state.tiles.filter((t) => t.type === 'oil' && t.owner >= 0 && t.owner !== payer.id).map((t) => t.owner),
  );
  for (const id of owners) {
    const fee = pct(amount, rate);
    if (fee > 0) {
      pay(state, payer, fee, state.players[id]);
      pushLog(state, `${payer.name} 向 ${state.players[id].name} 支付能源费 ${fee}`);
    }
  }
}

/** 每轮结算：油田收入、证券中心转移、研究所产卡 */
function applyBuildingIncome(state) {
  const seen = new Set();
  for (const t of state.tiles) {
    if (t.owner == null || t.owner < 0) continue;
    const owner = state.players[t.owner];
    if (!owner?.alive) continue;
    const lvl = t.level || 0;
    if (lvl <= 0 || !t.type) continue;
    const key = `${t.owner}:${t.plotId || t.index}:${t.type}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (t.type === 'oil') {
      const income = state.ruleset.buildings.oil.incomePerLevel * lvl;
      owner.cash += income;
      pushLog(state, `${owner.name} 的石油公司产出 ${income}`);
    } else if (t.type === 'bank2') {
      const { transferRate, capPerTarget } = state.ruleset.buildings.bank2;
      for (const q of state.players) {
        if (q.id === owner.id || !q.alive || q.deposit <= 0) continue;
        const amount = Math.min(capPerTarget, pct(q.deposit, transferRate * lvl));
        if (amount > 0) {
          q.deposit -= amount;
          owner.cash += amount;
          pushLog(state, `${owner.name} 的证券中心从 ${q.name} 转走 ${amount}`);
        }
      }
    } else if (t.type === 'lab') {
      const lab = state.ruleset.buildings.lab;
      if (lvl >= lab.fromLevel && state.round % lab.produceEvery === 0) {
        drawCard(state, owner);
        pushLog(state, `${owner.name} 的研究所产出一张卡`);
      }
    }
  }
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
  const pickTarget = () => {
    const t = target != null && state.players[target] ? state.players[target] : others[0];
    if (t && luckShield(t)) {
      pushLog(state, `${t.name} 有福神护体，这张卡无效`);
      return null;
    }
    return t;
  };

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
      const turns = e.turns || 1;
      pushLog(state, `${player.name} 对 ${t.name} 使用「陷害卡」`);
      if (pauseForReaction(state, t, 'jail', { turns, sourceId: player.id })) return true;
      applyJail(state, t, turns);
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
    case 'placeBarrier':
    case 'placeMine': {
      const N = state.tiles.length;
      if (typeof target !== 'number') return false;
      const dir = player.dir || 1;
      const dist = ((((target - player.pos) * dir) % N) + N) % N;
      const range = e.range + rangeBonus(player, card.id);
      if (dist < 1 || dist > range) return false;
      if (e.type === 'placeBarrier') state.tiles[target].barrier = true;
      else state.tiles[target].mine = true;
      pushLog(state, `${player.name} 在前方 ${dist} 格放了${e.type === 'placeBarrier' ? '路障' : '地雷'}`);
      return true;
    }
    case 'clearObstacles': {
      const N = state.tiles.length;
      const dir = player.dir || 1;
      let cleared = 0;
      for (let k = 1; k <= e.range; k++) {
        const i = (((player.pos + dir * k) % N) + N) % N;
        if (state.tiles[i].barrier) { state.tiles[i].barrier = false; cleared++; }
        if (state.tiles[i].mine) { state.tiles[i].mine = false; cleared++; }
        if (state.tiles[i].god) { state.tiles[i].god = null; cleared++; }
      }
      pushLog(state, `${player.name} 用机器娃娃清掉前方 ${cleared} 个障碍`);
      return true;
    }
    case 'reverse': {
      const t = pickTarget();
      if (!t) return false;
      if (!withinCardRange(state, player, t, e.radius, 'reverse')) return false;
      t.dir = -(t.dir || 1);
      pushLog(state, `${player.name} 让 ${t.name} 掉头`);
      return true;
    }
    case 'turtle': {
      const t = pickTarget();
      if (!t) return false;
      const turns = Math.max(1, (e.turns || 3) - mod(state, t, 'statusReduce', 'days'));
      t.slow = turns;
      pushLog(state, `${player.name} 给 ${t.name} 套上乌龟壳（${turns} 回合每次只走 1 步）`);
      return true;
    }
    case 'stealCard': {
      const t = pickTarget();
      if (!t || !t.hand.length) return false;
      if (!withinCardRange(state, player, t, e.radius, 'rob')) return false;
      const idx = Math.floor(rngNext(state) * t.hand.length);
      const got = t.hand.splice(idx, 1)[0];
      player.hand.push(got);
      const cardName = CARD_LIST.find((c) => c.id === got)?.name || got;
      pushLog(state, `${player.name} 从 ${t.name} 手里抢走「${cardName}」`);
      return true;
    }
    case 'forceBuy': {
      const t = state.tiles[target];
      if (!t || (t.kind !== 'small' && t.kind !== 'big')) return false;
      if (t.owner == null || t.owner === player.id) return false;
      const rate = t.kind === 'small' ? state.ruleset.land.small.upgradeRate : state.ruleset.land.big.upgradeRate;
      const cost = t.price + pct(t.price, rate) * (t.level || 0);
      if (player.cash < cost) return false;
      const prev = t.owner >= 0 ? state.players[t.owner] : null;
      player.cash -= cost;
      if (prev) prev.cash += t.price;
      if (t.plotId) {
        for (const other of state.tiles) if (other.plotId === t.plotId) other.owner = player.id;
      }
      t.owner = player.id;
      t.park = false;
      t.sealedUntilRound = 0;
      pushLog(state, `${player.name} 花 ${cost} 强行买下这处地产`);
      return true;
    }
    case 'swapProperty': {
      const t = state.tiles[target];
      if (!t || t.owner == null || t.owner === player.id) return false;
      const mine = state.tiles
        .map((tile, i) => ({ tile, i }))
        .filter(({ tile }) => tile.owner === player.id)
        .sort((a, b) => (a.tile.level || 0) - (b.tile.level || 0));
      if (!mine.length) return false;
      const src = mine[0];
      const tmp = t.owner;
      t.owner = src.tile.owner;
      src.tile.owner = tmp;
      pushLog(state, `${player.name} 用自己的地换走了对手的地`);
      return true;
    }
    case 'rebuildProperty': {
      const t = state.tiles[target];
      if (!t || t.owner == null) return false;
      if (t.kind !== 'small' && t.kind !== 'big') return false;
      t.park = !t.park;
      pushLog(state, `${player.name} 把这处地产${t.park ? '改建成了公园（停止收租）' : '从公园恢复成地产'}`);
      return true;
    }
    case 'sealStreet': {
      const t = state.tiles[target];
      if (!t || !t.streetId) return false;
      let n = 0;
      for (const tile of state.tiles) {
        if (tile.streetId === t.streetId && tile.owner != null && tile.owner !== player.id) {
          tile.sealedUntilRound = state.round + 6;
          n++;
        }
      }
      pushLog(state, `${player.name} 查封了这条街上的 ${n} 处非己方房产（6 回合）`);
      return true;
    }
    case 'demolish': {
      const t = state.tiles[target];
      if (!t || t.owner === player.id) return false;
      if (t.kind !== 'small' && t.kind !== 'big') return false;
      if (!t.level) return false;
      const dir = player.dir || 1;
      const N = state.tiles.length;
      const dist = ((((target - player.pos) * dir) % N) + N) % N;
      if (dist < 1 || dist > e.range) return false;
      t.level -= e.levels || 1;
      if (t.plotId) for (const other of state.tiles) if (other.plotId === t.plotId && other !== t) other.level = t.level;
      pushLog(state, `${player.name} 拆掉了前方 ${dist} 格房屋的一级`);
      return true;
    }
    case 'upgradeOwn': {
      const t = state.tiles[target];
      if (!t || t.owner !== player.id) return false;
      if (t.kind !== 'small' && t.kind !== 'big') return false;
      if ((t.level || 0) >= 5) return false;
      const discount = mod(state, player, 'buildDiscountPercent');
      const cost = pct(upgradeCost(t, e.levels || 1), 100 - discount);
      if (player.cash < cost) return false;
      player.cash -= cost;
      state.lottery.pool += cost;
      t.level = (t.level || 0) + (e.levels || 1);
      if (t.plotId) for (const other of state.tiles) if (other.plotId === t.plotId) other.level = t.level;
      pushLog(state, `${player.name} 远程给自己的地产升了 ${e.levels || 1} 级`);
      return true;
    }
    case 'raisePrice': {
      const t = state.tiles[target];
      if (!t || !t.streetId) return false;
      let n = 0;
      for (const tile of state.tiles) {
        if (tile.streetId === t.streetId) { tile.boostUntilRound = state.round + (e.turns || 6); n++; }
      }
      pushLog(state, `${player.name} 让这条街的 ${n} 块地涨价，持续 ${e.turns || 6} 回合`);
      return true;
    }
    case 'averageCash': {
      const t = pickTarget();
      if (!t) return false;
      const avg = Math.floor((player.cash + t.cash) / 2);
      pushLog(state, `${player.name} 与 ${t.name} 均贫，双方现金变成 ${avg}`);
      player.cash = avg;
      t.cash = avg;
      return true;
    }
    case 'averageAllCash': {
      const alive = state.players.filter((q) => q.alive);
      const avg = Math.floor(alive.reduce((s, q) => s + q.cash, 0) / alive.length);
      for (const q of alive) q.cash = avg;
      pushLog(state, `均富：所有人现金变成 ${avg}`);
      return true;
    }
    case 'plantBomb': {
      player.bomb = e.steps || 30;
      pushLog(state, `${player.name} 给自己绑了定时炸弹（${e.steps || 30} 步后爆炸）`);
      return true;
    }
    case 'areaDamage': {
      if (typeof target !== 'number') return false;
      const N = state.tiles.length;
      const center = ringCoordOf(state, target);
      const r = e.radius ?? 1;
      let hitTiles = 0;
      for (let i = 0; i < N; i++) {
        const t = state.tiles[i];
        if (t.kind !== 'small' && t.kind !== 'big') continue;
        const rc = ringCoordOf(state, i);
        if (Math.abs(rc.col - center.col) > r || Math.abs(rc.row - center.row) > r) continue;
        if (t.level > 0) {
          t.level = e.destroyAll ? 0 : Math.max(0, t.level - (e.levelDown || 1));
          if (t.plotId) for (const other of state.tiles) if (other.plotId === t.plotId) other.level = t.level;
          hitTiles++;
        }
      }
      let hitPlayers = 0;
      for (const q of state.players) {
        if (!q.alive || q.zone !== 'ring') continue;
        if (luckShield(q)) continue;
        const rc = ringCoordOf(state, q.pos);
        if (Math.abs(rc.col - center.col) > r || Math.abs(rc.row - center.row) > r) continue;
        sendToHospital(state, q, e.hospitalTurns || 1, '被爆炸波及');
        hitPlayers++;
      }
      pushLog(state, `${player.name} 引爆，炸坏 ${hitTiles} 处建筑，${hitPlayers} 人受伤`);
      return true;
    }
    case 'summonNearest': {
      const N = state.tiles.length;
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < N; i++) {
        if (!state.tiles[i].god) continue;
        const d = Math.min((i - player.pos + N) % N, (player.pos - i + N) % N);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) return false;
      const godId = state.tiles[best].god;
      state.tiles[best].god = null;
      player.bomb = null;
      attachGod(state, player, godId);
      return true;
    }
    case 'dismiss': {
      const had = (player.gods || []).length > 0 || player.bomb != null;
      if (!had) return false;
      player.gods = [];
      player.bomb = null;
      pushLog(state, `${player.name} 送走了身上的神仙与炸弹`);
      return true;
    }
    default:
      pushLog(state, `⚠ 卡片「${card.name}」效果（${e.type}）尚未实现`);
      return false;
  }
}

/** 商店买卡 */
export function buyCard(state0, cardId) {
  if (state0.phase !== 'shop' || !state0.pending?.shop) return state0;
  const state = clone(state0);
  const p = cur(state);
  const shop = state.pending.shop;
  if (!shop.includes(cardId)) return state0;
  const card = CARD_LIST.find((c) => c.id === cardId);
  const discount = mod(state, p, 'shopDiscountPercent');
  const price = pct(state.ruleset.cards.prices[card.rarity], 100 - discount);
  if (p.cash < price) return state0;
  if (p.hand.length >= state.ruleset.cards.hand.limit) return state0;
  p.cash -= price;
  p.hand.push(cardId);
  state.pending.shop = shop.filter((id) => id !== cardId);
  pushLog(state, `${p.name} 花 ${price} 买下「${card.name}」`);
  if (!state.pending.shop.length) {
    state.pending = null;
    state.phase = 'postRoll';
  }
  return state;
}

/** 离开商店 */
export function closeShop(state0) {
  if (state0.phase !== 'shop') return state0;
  const state = clone(state0);
  state.pending = null;
  state.phase = 'postRoll';
  return state;
}

/** 已实现的卡片效果类型（测试和 UI 都读这个集合） */
export const IMPLEMENTED_EFFECTS = new Set([
  'chooseDice', 'placeBarrier', 'placeMine', 'clearObstacles',
  'freeze', 'reverse', 'turtle', 'jail', 'sleepwalk', 'hibernate',
  'tax', 'stealCard', 'forceBuy', 'swapProperty', 'rebuildProperty',
  'sealStreet', 'demolish', 'upgradeOwn', 'raisePrice',
  'averageCash', 'averageAllCash', 'plantBomb', 'areaDamage',
  'waiveLoss', 'ignoreJail', 'revengeJail', 'shiftPunishment',
  'summonNearest', 'dismiss',
]);

/* ---------------- 神仙 ---------------- */

function godTurns(p, godId) {
  const extra = (CHARACTER_LIST.find((c) => c.id === p.charId)?.mods || [])
    .filter((m) => m.type === 'godDuration' && m.godId === godId)
    .reduce((s, m) => s + (m.days || 0), 0);
  return Math.max(1, GOD_MAP[godId].turns + extra);
}

export function hasGod(p, godId) {
  return (p.gods || []).some((g) => g.id === godId);
}

/** 附身：顶掉身上原有的神仙 */
export function attachGod(state, p, godId) {
  const god = GOD_MAP[godId];
  if (!god) return false;
  if (p.gods?.length) pushLog(state, `${p.name} 身上的${GOD_MAP[p.gods[0].id].name}被${god.name}顶掉了`);
  p.gods = [{ id: godId, remaining: godTurns(p, godId) }];
  pushLog(state, `${p.name} 被${god.name}附身（${god.turns} 回合）`);
  return true;
}

function luckShield(p) {
  return hasGod(p, 'luck');
}

function maybeSpawnGod(state) {
  const occupied = state.tiles.filter((t) => t.god).length;
  if (occupied >= 3) return;
  if (rngNext(state) > 0.35) return;
  for (let tries = 0; tries < 40; tries++) {
    const i = rngInt(state, 0, state.tiles.length - 1);
    const t = state.tiles[i];
    if (t.god) continue;
    if (t.label === 'go' || t.label === 'junction' || t.label === 'teleportInner' || t.label === 'teleportOuter') continue;
    t.god = GODS[rngInt(state, 0, GODS.length - 1)].id;
    pushLog(state, `第 ${i} 格出现了一位神仙`);
    return;
  }
}

/** 自己回合开始时结算神仙效果，然后倒计时 */
function godTurnStart(state, p) {
  if (!p.gods?.length) return;
  for (const g of [...p.gods]) {
    const god = GOD_MAP[g.id];
    if (!god) continue;
    if (g.id === 'wealth') {
      const gain = pct(state.ruleset.economy.salary, 50);
      p.cash += gain;
      pushLog(state, `财神送来 ${gain}`);
    } else if (g.id === 'poverty') {
      const loss = pct(state.ruleset.economy.salary, 50);
      pushLog(state, `穷神拿走了 ${loss}`);
      pay(state, p, loss, null);
    } else if (g.id === 'land') {
      if (p.hand.length < state.ruleset.cards.hand.limit) {
        drawCard(state, p);
      }
    }
    g.remaining -= 1;
  }
  const kept = p.gods.filter((g) => g.remaining > 0);
  const lost = p.gods.filter((g) => g.remaining <= 0);
  for (const g of lost) pushLog(state, `${GOD_MAP[g.id].name}离开了 ${p.name}`);
  p.gods = kept;
}

/** 天使：落地免费升 1 级（不分归属） */
function angelUpgrade(state, p) {
  if (!hasGod(p, 'angel')) return;
  const t = state.tiles[p.pos];
  if (t.kind !== 'small' && t.kind !== 'big') return;
  if ((t.level || 0) >= 5) return;
  t.level = (t.level || 0) + 1;
  if (t.plotId) for (const other of state.tiles) if (other.plotId === t.plotId) other.level = t.level;
  pushLog(state, `天使给第 ${p.pos} 格的建筑免费升到 ${t.level} 级`);
}

/* ---------------- 响应式卡片 ---------------- */

function cardEffect(id) {
  return CARD_LIST.find((c) => c.id === id)?.effect;
}

/** 一次伤害/入狱发生时，受害者手上有哪些响应卡可用 */
function eligibleReactions(victim, kind, payload) {
  const has = (id) => victim.hand.includes(id);
  const out = [];
  if (kind === 'loss') {
    const free = cardEffect('free');
    const blame = cardEffect('blame');
    if (has('free') && payload.amount >= free.threshold) out.push('free');
    if (has('blame') && payload.amount >= blame.lossThreshold) out.push('blame');
  } else if (kind === 'jail') {
    if (has('pardon')) out.push('pardon');
    if (has('revenge') && payload.sourceId != null) out.push('revenge');
    if (has('blame')) out.push('blame');
  }
  return out;
}

function otherAlive(state, exceptId) {
  return state.players.filter((q) => q.alive && q.id !== exceptId);
}

export function applyJail(state, p, turns) {
  const extra = hasGod(p, 'doom') ? 1 : 0;
  const reduce = mod(state, p, 'jailReduceDays', 'days');
  p.skip += Math.max(1, turns + extra - reduce);
  p.zone = 'exit';
  p.exitPath = 'jail';
  p.pos = -1;
}

/** 暂停当前结算，等受害者决定是否出牌 */
function pauseForReaction(state, victim, kind, payload) {
  const cards = eligibleReactions(victim, kind, payload);
  if (!cards.length) return false;
  state.pending = {
    type: 'reaction',
    victimId: victim.id,
    kind,
    ...payload,
    cards,
    resumePhase: state.phase === 'reaction' ? 'postRoll' : state.phase,
  };
  state.phase = 'reaction';
  pushLog(state, `${victim.name} 可以出一张响应卡`);
  return true;
}

function resolvePending(state) {
  const p = state.pending;
  if (!p || p.type !== 'reaction') return;
  const victim = state.players[p.victimId];
  if (p.kind === 'loss') {
    const creditor = p.creditorId != null ? state.players[p.creditorId] : null;
    pay(state, victim, p.amount, creditor);
  } else if (p.kind === 'jail') {
    applyJail(state, victim, p.turns || 1);
  }
  const back = p.resumePhase || 'postRoll';
  state.pending = null;
  state.phase = back;
}

/** 受害者回应：cardId 为 null 表示不用；嫁祸卡需要 targetId 指定替罪者 */
export function respondReaction(state0, cardId, targetId = null) {
  if (state0.phase !== 'reaction' || state0.pending?.type !== 'reaction') return state0;
  const state = clone(state0);
  const p = state.pending;
  const victim = state.players[p.victimId];

  if (!cardId) {
    pushLog(state, `${victim.name} 没有使用响应卡`);
    resolvePending(state);
    if (!victim.alive) advance(state);
    return state;
  }

  if (!p.cards.includes(cardId)) return state0;
  const idx = victim.hand.indexOf(cardId);
  if (idx < 0) return state0;

  // 嫁祸卡必须先选一个替罪者
  let blameTarget = null;
  if (cardId === 'blame') {
    const others = otherAlive(state, victim.id);
    blameTarget = targetId != null ? others.find((q) => q.id === targetId) : null;
    if (!blameTarget) return state0;
  }

  victim.hand.splice(idx, 1);

  if (cardId === 'free') {
    pushLog(state, `${victim.name} 用「免费卡」免掉 ${p.amount} 元损失`);
  } else if (cardId === 'pardon') {
    pushLog(state, `${victim.name} 用「免罪卡」免掉牢狱之灾`);
  } else if (cardId === 'revenge') {
    const src = state.players[p.sourceId];
    if (src) {
      applyJail(state, src, p.turns || 1);
      pushLog(state, `${victim.name} 用「复仇卡」把 ${src.name} 送进监狱`);
    }
  } else if (cardId === 'blame') {
    if (p.kind === 'loss') {
      pay(state, blameTarget, p.amount, p.creditorId != null ? state.players[p.creditorId] : null);
      pushLog(state, `${victim.name} 用「嫁祸卡」让 ${blameTarget.name} 背了这笔钱`);
    } else {
      applyJail(state, blameTarget, p.turns || 1);
      pushLog(state, `${victim.name} 用「嫁祸卡」让 ${blameTarget.name} 替自己坐牢`);
    }
  }

  state.pending = null;
  state.phase = p.resumePhase || 'postRoll';
  if (!victim.alive) advance(state);
  return state;
}

/* ---------------- 银行 ---------------- */

export function bankDeposit(state0, percent = 50) {
  if (state0.phase !== 'bank') return state0;
  const state = clone(state0);
  const p = cur(state);
  const amount = pct(p.cash, percent);
  if (amount <= 0) return state0;
  p.cash -= amount;
  p.deposit += amount;
  pushLog(state, `${p.name} 存入 ${amount}，存款变成 ${p.deposit}`);
  return state;
}

export function bankWithdrawAll(state0) {
  if (state0.phase !== 'bank') return state0;
  const state = clone(state0);
  const p = cur(state);
  if (p.deposit <= 0) return state0;
  const amount = p.deposit;
  p.cash += amount;
  p.deposit = 0;
  pushLog(state, `${p.name} 取出全部 ${amount}`);
  return state;
}

export function leaveBank(state0) {
  if (state0.phase !== 'bank') return state0;
  const state = clone(state0);
  state.phase = 'postRoll';
  return state;
}

/** 每 (人数 × 3) 个回合结一次息：存款余额 × 10% */
function payInterest(state) {
  const rate = state.ruleset.bank.interestPercent;
  for (const p of state.players) {
    if (!p.alive || p.deposit <= 0) continue;
    const interest = pct(p.deposit, rate);
    if (interest > 0) {
      p.deposit += interest;
      pushLog(state, `${p.name} 收到存款利息 ${interest}`);
    }
  }
}

/* ---------------- 彩票 ---------------- */

export function buyLottery(state0, count = 1) {
  if (state0.phase !== 'lottery') return state0;
  const state = clone(state0);
  const p = cur(state);
  const L = state.lottery;
  const price = state.ruleset.lottery.ticketPrice;
  const maxNum = state.ruleset.lottery.numbers;
  const taken = new Set(Object.keys(L.tickets).map(Number));
  const free = [];
  for (let n = 1; n <= maxNum; n++) if (!taken.has(n)) free.push(n);

  const affordable = Math.floor(p.cash / price);
  const n = Math.min(count, 2, free.length, affordable);
  if (n <= 0) return state0;

  const bought = [];
  for (let i = 0; i < n; i++) {
    const num = free.splice(rngInt(state, 0, free.length - 1), 1)[0];
    L.tickets[num] = p.id;
    p.cash -= price;
    L.pool += price;
    bought.push(num);
  }
  pushLog(state, `${p.name} 买了第 ${bought.join('、')} 号彩票`);
  return state;
}

export function leaveLottery(state0) {
  if (state0.phase !== 'lottery') return state0;
  const state = clone(state0);
  state.phase = 'postRoll';
  return state;
}

function drawLottery(state) {
  const L = state.lottery;
  const maxNum = state.ruleset.lottery.numbers;
  const w = state.ruleset.lottery.winners;
  const total = w.first + w.second + w.third;
  const pool = L.pool;
  const payoutTotal = pct(pool, state.ruleset.lottery.payoutPercent || 100);

  const poolNums = [];
  for (let n = 1; n <= maxNum; n++) poolNums.push(n);
  for (let i = poolNums.length - 1; i > 0; i--) {
    const j = rngInt(state, 0, i);
    [poolNums[i], poolNums[j]] = [poolNums[j], poolNums[i]];
  }
  const winners = poolNums.slice(0, total);
  const first = winners.slice(0, w.first);
  const second = winners.slice(w.first, w.first + w.second);
  const third = winners.slice(w.first + w.second);

  const split = state.ruleset.lottery.split;
  let paid = 0;
  const payout = (nums, ratio) => {
    const bag = nums.filter((n) => L.tickets[n] != null);
    if (!bag.length || payoutTotal <= 0) return;
    const per = Math.floor((payoutTotal * ratio) / 100 / bag.length);
    for (const n of bag) {
      const owner = state.players[L.tickets[n]];
      if (owner) {
        owner.cash += per;
        paid += per;
        pushLog(state, `${owner.name} 的 ${n} 号中了奖，拿到 ${per}`);
      }
    }
  };
  pushLog(state, `第 ${L.period} 期开奖：${winners.join('、')}，奖池 ${pool}，本期发出 ${payoutTotal}`);
  payout(first, split[0]);
  payout(second, split[1]);
  payout(third, split[2]);

  L.drawn = winners;
  L.period += 1;
  L.tickets = {};
  L.pool = pool - paid; // 没发出去的滚进下一期
}

/* ---------------- 魔法屋 ---------------- */

const MAGIC_COST = 20000; // TODO: 进 ruleset

export function magicDraw(state0) {
  if (state0.phase !== 'magic') return state0;
  const state = clone(state0);
  const p = cur(state);
  if (p.cash < MAGIC_COST) return state0;
  if (p.hand.length >= state.ruleset.cards.hand.limit) return state0;
  p.cash -= MAGIC_COST;
  drawCard(state, p);
  pushLog(state, `${p.name} 花 ${MAGIC_COST} 在魔法屋抽了一张卡`);
  return state;
}

export function magicSwap(state0, cardId) {
  if (state0.phase !== 'magic') return state0;
  const state = clone(state0);
  const p = cur(state);
  const idx = p.hand.indexOf(cardId);
  if (idx < 0) return state0;
  p.hand.splice(idx, 1);
  drawCard(state, p);
  pushLog(state, `${p.name} 用「${CARD_LIST.find((c) => c.id === cardId)?.name}」换了一张新卡`);
  return state;
}

export function leaveMagic(state0) {
  if (state0.phase !== 'magic') return state0;
  const state = clone(state0);
  state.phase = 'postRoll';
  return state;
}

/* ---------------- 新闻 ---------------- */

function applyMagicEvent(state, p) {
  const r = rngNext(state);
  if (r < 0.16) {
    drawCard(state, p);
    pushLog(state, `魔法屋：${p.name} 得到一张卡`);
  } else if (r < 0.28) {
    drawCard(state, p);
    drawCard(state, p);
    pushLog(state, `魔法屋：${p.name} 一口气得了两张卡`);
  } else if (r < 0.38) {
    const n = p.hand.length;
    if (!n) { pushLog(state, `魔法屋：${p.name} 手上没卡，什么也没发生`); return; }
    // 统一按普通卡售价的 1.6 倍回收
    const unit = pct(state.ruleset.cards.prices.common, 160);
    const gain = n * unit;
    p.hand = [];
    p.cash += gain;
    pushLog(state, `魔法屋：变卖全部 ${n} 张卡，每张 ${unit}，共得 ${gain}`);
  } else if (r < 0.48) {
    if (p.cash <= 0) { pushLog(state, `魔法屋：${p.name} 没有现金可存`); return; }
    const amount = p.cash;
    p.deposit += amount;
    p.cash = 0;
    pushLog(state, `魔法屋：把 ${amount} 全部存进银行`);
  } else if (r < 0.56) {
    const good = GODS.filter((g) => g.kind === 'good');
    attachGod(state, p, good[rngInt(state, 0, good.length - 1)].id);
    pushLog(state, '魔法屋：神仙加持');
  } else if (r < 0.66) {
    applyJail(state, p, 1);
    pushLog(state, `魔法屋：${p.name} 被关进监狱 1 回合（免罪卡无效）`);
  } else if (r < 0.74) {
    sendToHospital(state, p, 1, '被魔法送进医院');
    pushLog(state, '魔法屋：住院 1 回合（免罪卡无效）');
  } else if (r < 0.82) {
    p.skip += 1;
    pushLog(state, `魔法屋：${p.name} 原地停留 1 回合`);
  } else {
    magicBuildingChange(state, p);
  }
}

/**
 * 魔法屋的建筑效果：
 * 先 50% 选自己的建筑、50% 选别人的，再 50% 升级、50% 降级。
 */
function magicBuildingChange(state, p) {
  const all = state.tiles
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => (t.kind === 'small' || t.kind === 'big') && t.owner != null);
  if (!all.length) {
    pushLog(state, '魔法屋：地图上还没有建筑，什么也没发生');
    return;
  }
  const mine = all.filter(({ t }) => t.owner === p.id);
  const theirs = all.filter(({ t }) => t.owner !== p.id);
  const useMine = rngNext(state) < 0.5;
  const pool = useMine && mine.length ? mine : (theirs.length ? theirs : mine);
  const { t, i } = pool[rngInt(state, 0, pool.length - 1)];
  const owner = t.owner >= 0 ? state.players[t.owner] : null;
  const up = rngNext(state) < 0.5;

  if (up) {
    if ((t.level || 0) >= 5) { pushLog(state, '魔法屋：选中的建筑已经满级'); return; }
    t.level = (t.level || 0) + 1;
  } else {
    if ((t.level || 0) <= 0) { pushLog(state, '魔法屋：选中的建筑还是空地'); return; }
    // 小地皮最低 1 级，拆到 0 会变成“无主空地”，这里直接不允许
    if (t.kind === 'small' && t.level <= 1) { pushLog(state, '魔法屋：小地皮已经是最低等级'); return; }
    t.level -= 1;
  }
  if (t.plotId) for (const o of state.tiles) if (o.plotId === t.plotId) o.level = t.level;
  pushLog(state, `魔法屋：${owner ? owner.name : '系统'}的第 ${i} 格建筑被${up ? '免费加盖到' : '拆到'} ${t.level} 级`);
}

function applyNews(state, p) {
  const r = rngNext(state);
  if (r < 0.25) {
    // 绯闻：随机 1–2 名玩家（可能是自己）进监狱
    const pool = state.players.filter((q) => q.alive);
    const n = Math.min(pool.length, 1 + (rngNext(state) < 0.4 ? 1 : 0));
    const victims = [];
    for (let i = 0; i < n; i++) {
      const q = pool.splice(rngInt(state, 0, pool.length - 1), 1)[0];
      victims.push(q);
    }
    for (const q of victims) applyJail(state, q, 1);
    pushLog(state, `绯闻缠身：${victims.map((q) => q.name).join('、')} 被关进监狱`);
  } else if (r < 0.45) {
    const gain = pct(state.ruleset.economy.salary, 40);
    p.cash += gain;
    pushLog(state, `新闻：${p.name} 上了头条，收入 ${gain}`);
  } else if (r < 0.6) {
    const loss = pct(state.ruleset.economy.salary, 30);
    pushLog(state, `新闻：${p.name} 被曝丑闻，罚款 ${loss}`);
    pay(state, p, loss, null);
  } else if (r < 0.75) {
    drawCard(state, p);
    pushLog(state, `新闻：${p.name} 从报道里得了张卡`);
  } else if (r < 0.9) {
    state.lottery.pool += pct(state.ruleset.lottery.poolGrowthPerRound, 50);
    pushLog(state, `新闻：彩票热潮，奖池涨了`);
  } else {
    pushLog(state, `新闻：平淡的一天`);
  }
}

/** 统一入口：action = { type, ... } */
export function applyAction(state, action) {  switch (action.type) {
    case 'roll': return roll(state);
    case 'buy': return buy(state);
    case 'pass': return pass(state);
    case 'upgrade': return upgrade(state, action.pos);
    case 'chooseBigType': return chooseBigType(state, action.typeId);
    case 'cancelBigType': return cancelBigType(state);
    case 'endTurn': return endTurn(state);
    case 'useCard': return useCard(state, action.cardId, action.target);
    case 'buyCard': return buyCard(state, action.cardId);
    case 'closeShop': return closeShop(state);
    case 'respond': return respondReaction(state, action.cardId ?? null, action.target ?? null);
    case 'bankDeposit': return bankDeposit(state, action.percent ?? 50);
    case 'bankWithdraw': return bankWithdrawAll(state);
    case 'leaveBank': return leaveBank(state);
    case 'buyLottery': return buyLottery(state, action.count ?? 1);
    case 'leaveLottery': return leaveLottery(state);
    case 'magicDraw': return magicDraw(state);
    case 'magicSwap': return magicSwap(state, action.cardId);
    case 'leaveMagic': return leaveMagic(state);
    default: throw new Error(`未知动作 ${action.type}`);
  }
}
