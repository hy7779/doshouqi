/**
 * 大富翁 · 纯规则引擎（无 DOM、无网络）
 * 浏览器与 Node 共用。所有动作函数都返回新的 state，不修改入参。
 */

export const START_CASH = 1500;
export const GO_BONUS = 200;
export const JAIL_FINE = 50;
export const JAIL_POS = 10;

/* ---------------- 棋盘 ---------------- */

// 40 格，0 = 起点（右下角），逆时针一圈。
// 类型：go 起点 / prop 地产 / rail 车站 / util 公用 / tax 税金
//       chance 机遇 / fate 命运 / jail 监狱(探监) / parking 免费停车 / gotojail 入狱
export const TILES = [
  { pos: 0,  type: 'go',      name: '起点',        sub: '经过领 200' },
  { pos: 1,  type: 'prop',    name: '中山路',      group: 'brown',   price: 60,  house: 50,  rents: [2, 10, 30, 90, 160, 250] },
  { pos: 2,  type: 'fate',    name: '命运',        sub: '抽一张命运卡' },
  { pos: 3,  type: 'prop',    name: '解放路',      group: 'brown',   price: 60,  house: 50,  rents: [4, 20, 60, 180, 320, 450] },
  { pos: 4,  type: 'tax',     name: '所得税',      amount: 200,      sub: '缴纳 200 元' },
  { pos: 5,  type: 'rail',    name: '南站',        price: 200,       sub: '火车站' },
  { pos: 6,  type: 'prop',    name: '鼓楼街',      group: 'cyan',    price: 100, house: 50,  rents: [6, 30, 90, 270, 400, 550] },
  { pos: 7,  type: 'chance',  name: '机遇',        sub: '抽一张机遇卡' },
  { pos: 8,  type: 'prop',    name: '太平街',      group: 'cyan',    price: 100, house: 50,  rents: [6, 30, 90, 270, 400, 550] },
  { pos: 9,  type: 'prop',    name: '长安街',      group: 'cyan',    price: 120, house: 50,  rents: [8, 40, 100, 300, 450, 600] },
  { pos: 10, type: 'jail',    name: '监狱',        sub: '探监 / 服刑' },
  { pos: 11, type: 'prop',    name: '西湖路',      group: 'pink',    price: 140, house: 100, rents: [10, 50, 150, 450, 625, 750] },
  { pos: 12, type: 'util',    name: '电力公司',    price: 150,       sub: '公用事业' },
  { pos: 13, type: 'prop',    name: '苏堤街',      group: 'pink',    price: 140, house: 100, rents: [10, 50, 150, 450, 625, 750] },
  { pos: 14, type: 'prop',    name: '钱塘街',      group: 'pink',    price: 160, house: 100, rents: [12, 60, 180, 500, 700, 900] },
  { pos: 15, type: 'rail',    name: '东站',        price: 200,       sub: '火车站' },
  { pos: 16, type: 'prop',    name: '秦淮河',      group: 'orange',  price: 180, house: 100, rents: [14, 70, 200, 550, 750, 950] },
  { pos: 17, type: 'fate',    name: '命运',        sub: '抽一张命运卡' },
  { pos: 18, type: 'prop',    name: '夫子庙',      group: 'orange',  price: 180, house: 100, rents: [14, 70, 200, 550, 750, 950] },
  { pos: 19, type: 'prop',    name: '新街口',      group: 'orange',  price: 200, house: 100, rents: [16, 80, 220, 600, 800, 1000] },
  { pos: 20, type: 'parking', name: '免费停车',    sub: '安全区' },
  { pos: 21, type: 'prop',    name: '宽窄巷',      group: 'red',     price: 220, house: 150, rents: [18, 90, 250, 700, 875, 1050] },
  { pos: 22, type: 'chance',  name: '机遇',        sub: '抽一张机遇卡' },
  { pos: 23, type: 'prop',    name: '春熙路',      group: 'red',     price: 220, house: 150, rents: [18, 90, 250, 700, 875, 1050] },
  { pos: 24, type: 'prop',    name: '锦里街',      group: 'red',     price: 240, house: 150, rents: [20, 100, 300, 750, 925, 1100] },
  { pos: 25, type: 'rail',    name: '西站',        price: 200,       sub: '火车站' },
  { pos: 26, type: 'prop',    name: '外滩',        group: 'yellow',  price: 260, house: 150, rents: [22, 110, 330, 800, 975, 1150] },
  { pos: 27, type: 'prop',    name: '南京路',      group: 'yellow',  price: 260, house: 150, rents: [22, 110, 330, 800, 975, 1150] },
  { pos: 28, type: 'util',    name: '自来水厂',    price: 150,       sub: '公用事业' },
  { pos: 29, type: 'prop',    name: '淮海路',      group: 'yellow',  price: 280, house: 150, rents: [24, 120, 360, 850, 1025, 1200] },
  { pos: 30, type: 'gotojail',name: '入狱',        sub: '直接进监狱' },
  { pos: 31, type: 'prop',    name: '王府井',      group: 'green',   price: 300, house: 200, rents: [26, 130, 390, 900, 1100, 1275] },
  { pos: 32, type: 'prop',    name: '三里屯',      group: 'green',   price: 300, house: 200, rents: [26, 130, 390, 900, 1100, 1275] },
  { pos: 33, type: 'fate',    name: '命运',        sub: '抽一张命运卡' },
  { pos: 34, type: 'prop',    name: '后海街',      group: 'green',   price: 320, house: 200, rents: [28, 150, 450, 1000, 1200, 1400] },
  { pos: 35, type: 'rail',    name: '北站',        price: 200,       sub: '火车站' },
  { pos: 36, type: 'chance',  name: '机遇',        sub: '抽一张机遇卡' },
  { pos: 37, type: 'prop',    name: '陆家嘴',      group: 'blue',    price: 350, house: 200, rents: [35, 175, 500, 1100, 1300, 1500] },
  { pos: 38, type: 'tax',     name: '奢侈税',      amount: 100,      sub: '缴纳 100 元' },
  { pos: 39, type: 'prop',    name: '世纪大道',    group: 'blue',    price: 400, house: 200, rents: [50, 200, 600, 1400, 1700, 2000] },
];

export const GROUPS = {
  brown:  { name: '棕', color: '#8d5a3b' },
  cyan:   { name: '青', color: '#5fb0c9' },
  pink:   { name: '粉', color: '#c9557e' },
  orange: { name: '橙', color: '#d98236' },
  red:    { name: '红', color: '#c0392b' },
  yellow: { name: '黄', color: '#d4b02c' },
  green:  { name: '绿', color: '#2f8f5b' },
  blue:   { name: '蓝', color: '#2b5f9e' },
};

export const TOKENS = ['🐟', '🐘', '🐯', '🦁'];
export const TOKEN_NAMES = ['鱼', '象', '虎', '狮'];

/* ---------------- 卡牌 ---------------- */

const CHANCE_CARDS = [
  { text: '银行分红，收入 150 元。', cash: 150 },
  { text: '前进到「起点」，领取 200 元。', move: 'to', pos: 0 },
  { text: '股票大涨，收入 300 元。', cash: 300 },
  { text: '缴纳道路维修费：每栋房屋 25 元。', perHouse: -25 },
  { text: '直接进监狱，不得经过起点。', jail: true },
  { text: '获得一张「出狱卡」。', jailCard: true },
  { text: '后退三格。', move: 'back', n: 3 },
  { text: '向每位玩家支付 50 元。', each: -50 },
  { text: '理发生意兴隆，从每位玩家收取 50 元。', each: 50 },
  { text: '前往「北站」。', move: 'to', pos: 35 },
  { text: '违规停车，罚款 100 元。', cash: -100 },
  { text: '中了一笔小奖，收入 80 元。', cash: 80 },
];

const FATE_CARDS = [
  { text: '医疗费，支付 100 元。', cash: -100 },
  { text: '继承遗产，收入 250 元。', cash: 250 },
  { text: '缴纳税款，支付 150 元。', cash: -150 },
  { text: '销售业绩突出，收入 200 元。', cash: 200 },
  { text: '获得一张「出狱卡」。', jailCard: true },
  { text: '直接进监狱，不得经过起点。', jail: true },
  { text: '前往「免费停车」，休息一下。', move: 'to', pos: 20 },
  { text: '生日到了，每位玩家送你 40 元。', each: 40 },
  { text: '缴纳学费，支付 120 元。', cash: -120 },
  { text: '银行利息，收入 60 元。', cash: 60 },
  { text: '前往「南站」。', move: 'to', pos: 5 },
  { text: '修缮屋顶：每栋房屋 30 元。', perHouse: -30 },
];

export const DECKS = { chance: CHANCE_CARDS, fate: FATE_CARDS };

/* ---------------- 小工具 ---------------- */

const clone = (o) => structuredClone(o);

export function money(n) {
  return n.toLocaleString('zh-CN');
}

function tileAt(pos) {
  return TILES[((pos % 40) + 40) % 40];
}

function alivePlayers(s) {
  return s.players.filter((p) => p.alive);
}

function player(s, id) {
  return s.players.find((p) => p.id === id);
}

function pushLog(s, text) {
  s.log.push(text);
  if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
}

export function ownedInGroup(s, group) {
  return TILES.filter((t) => t.type === 'prop' && t.group === group);
}

export function groupComplete(s, playerId, group) {
  const tiles = ownedInGroup(s, group);
  return tiles.length > 0 && tiles.every((t) => s.owners[t.pos] === playerId);
}

export function housesAt(s, pos) {
  return s.houses[pos] || 0;
}

export function isBuildable(s, pos) {
  const t = tileAt(pos);
  if (t.type !== 'prop') return false;
  const owner = s.owners[pos];
  if (owner === undefined) return false;
  if (housesAt(s, pos) >= 5) return false;
  if (!groupComplete(s, owner, t.group)) return false;
  const group = ownedInGroup(s, t.group);
  const low = Math.min(...group.map((g) => housesAt(s, g.pos)));
  return housesAt(s, pos) === low;
}

export function canBuild(s, pos, playerId) {
  return s.players[s.turn]?.id === playerId && isBuildable(s, pos) && player(s, playerId).cash >= tileAt(pos).house;
}

/** 当前该玩家能买的地产（供 UI 高亮） */
export function buildsAvailable(s, playerId) {
  return TILES.filter((t) => canBuild(s, t.pos, playerId)).map((t) => t.pos);
}

export function rentOf(s, pos, diceSum) {
  const t = tileAt(pos);
  const owner = s.owners[pos];
  if (owner === undefined) return 0;
  if (t.type === 'prop') {
    const h = housesAt(s, pos);
    if (h > 0) return t.rents[h];
    if (groupComplete(s, owner, t.group)) return t.rents[0] * 2;
    return t.rents[0];
  }
  if (t.type === 'rail') {
    const n = TILES.filter((x) => x.type === 'rail' && s.owners[x.pos] === owner).length;
    return [0, 25, 50, 100, 200][n] || 0;
  }
  if (t.type === 'util') {
    const n = TILES.filter((x) => x.type === 'util' && s.owners[x.pos] === owner).length;
    return diceSum * (n === 2 ? 10 : 4);
  }
  return 0;
}

export function netWorth(s, p) {
  let total = p.cash;
  for (const pos of Object.keys(s.owners)) {
    if (s.owners[pos] !== p.id) continue;
    const t = tileAt(Number(pos));
    total += t.price || 0;
    total += housesAt(s, Number(pos)) * (t.house || 0);
  }
  return total;
}

/* ---------------- 开局 ---------------- */

export function newGame(names, opts = {}) {
  const list = (names && names.length ? names : ['玩家 1', '玩家 2']).slice(0, 4);
  const s = {
    players: list.map((name, i) => ({
      id: i,
      name: String(name).slice(0, 12) || `玩家 ${i + 1}`,
      token: TOKENS[i],
      cash: START_CASH,
      pos: 0,
      inJail: false,
      jailTurns: 0,
      jailCards: 0,
      alive: true,
    })),
    turn: 0,
    phase: 'awaitRoll',
    dice: [0, 0],
    doubles: 0,
    owners: {},
    houses: {},
    pending: null,
    winner: null,
    round: 1,
    maxRounds: Math.max(20, Math.min(500, opts.maxRounds || 80)),
    chanceDeck: shuffle([...CHANCE_CARDS.keys()], opts.rng),
    fateDeck: shuffle([...FATE_CARDS.keys()], opts.rng),
    log: [],
  };
  pushLog(s, `开局：${s.players.map((p) => p.name).join('、')}，每人 ${START_CASH} 元。`);
  pushLog(s, `轮到 ${s.players[0].name} 掷骰。`);
  return s;
}

function shuffle(arr, rng) {
  const r = typeof rng === 'function' ? rng : Math.random;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ---------------- 资金与破产 ---------------- */

/** 给钱（可为负）。autoSell=true 时不足则先自动卖房。返回是否付清。 */
function transfer(s, fromId, toId, amount) {
  const from = player(s, fromId);
  const to = toId === null || toId === undefined ? null : player(s, toId);
  if (!from) return true;
  if (amount <= 0) {
    // amount 为负表示收款
    return true;
  }
  if (from.cash < amount) {
    autoLiquidate(s, from, amount);
  }
  if (from.cash < amount) {
    // 破产
    bankrupt(s, from, to);
    return false;
  }
  from.cash -= amount;
  if (to) to.cash += amount;
  return true;
}

function autoLiquidate(s, p, need) {
  const owned = Object.keys(s.owners)
    .filter((pos) => s.owners[pos] === p.id)
    .map(Number)
    .sort((a, b) => housesAt(s, b) - housesAt(s, a));
  for (const pos of owned) {
    while (housesAt(s, pos) > 0 && p.cash < need) {
      s.houses[pos] = housesAt(s, pos) - 1;
      p.cash += Math.floor(tileAt(pos).house / 2);
      pushLog(s, `${p.name} 卖掉「${tileAt(pos).name}」的一级建筑，回收 ${Math.floor(tileAt(pos).house / 2)} 元。`);
    }
    if (p.cash >= need) return;
  }
}

function bankrupt(s, p, creditor) {
  p.alive = false;
  const cash = p.cash;
  p.cash = 0;
  if (creditor && creditor.alive !== false) creditor.cash += cash;
  for (const pos of Object.keys(s.owners)) {
    if (s.owners[pos] !== p.id) continue;
    if (creditor) {
      s.owners[pos] = creditor.id;
    } else {
      delete s.owners[pos];
      delete s.houses[pos];
    }
  }
  pushLog(s, `💥 ${p.name} 破产出局${creditor ? `，资产归 ${creditor.name}` : '，资产收归银行'}。`);
  checkWin(s);
}

export function checkWin(s) {
  const alive = alivePlayers(s);
  if (alive.length <= 1 && s.phase !== 'ended') {
    s.phase = 'ended';
    s.winner = alive[0] ? alive[0].id : null;
    s.pending = null;
    pushLog(s, alive[0] ? `🏆 ${alive[0].name} 获胜！` : '游戏结束。');
  }
  return s.phase === 'ended';
}

/* ---------------- 回合 ---------------- */

function endByNetWorth(s) {
  const alive = alivePlayers(s);
  if (!alive.length) {
    s.phase = 'ended';
    s.winner = null;
    return;
  }
  alive.sort((a, b) => netWorth(s, b) - netWorth(s, a));
  s.phase = 'ended';
  s.winner = alive[0].id;
  s.pending = null;
  pushLog(s, `⏱ 达到 ${s.maxRounds} 回合上限，按总资产结算。`);
  pushLog(s, `🏆 ${alive[0].name} 以 ${money(netWorth(s, alive[0]))} 元总资产获胜！`);
}

function nextTurn(s) {
  if (s.phase === 'ended') return;
  if (s.round > s.maxRounds) {
    endByNetWorth(s);
    return;
  }
  s.doubles = 0;
  s.pending = null;
  s.dice = [0, 0];
  const n = s.players.length;
  let i = s.turn;
  for (let k = 0; k < n; k++) {
    i = (i + 1) % n;
    if (s.players[i].alive) {
      if (i <= s.turn) s.round += 1;
      s.turn = i;
      break;
    }
  }
  if (s.round > s.maxRounds) {
    endByNetWorth(s);
    return;
  }
  s.phase = s.players[s.turn].inJail ? 'awaitJail' : 'awaitRoll';
  pushLog(s, `—— 第 ${s.round} 回合 · 轮到 ${s.players[s.turn].name}。`);
}

/** 掷骰 */
export function roll(s0, rng) {
  const s = clone(s0);
  if (s.phase !== 'awaitRoll' && s.phase !== 'awaitJail') return s0;
  const r = typeof rng === 'function' ? rng : Math.random;
  const d1 = 1 + Math.floor(r() * 6);
  const d2 = 1 + Math.floor(r() * 6);
  s.dice = [d1, d2];
  const p = s.players[s.turn];
  const sum = d1 + d2;
  const isDouble = d1 === d2;

  if (s.phase === 'awaitJail') {
    if (isDouble) {
      p.inJail = false;
      p.jailTurns = 0;
      pushLog(s, `${p.name} 掷出对子 ${d1}+${d2}，出狱！`);
      return moveAndLand(s, sum, false);
    }
    p.jailTurns += 1;
    if (p.jailTurns >= 3) {
      pushLog(s, `${p.name} 服刑满 3 回合，缴纳 ${JAIL_FINE} 元保释。`);
      p.inJail = false;
      p.jailTurns = 0;
      transfer(s, p.id, null, JAIL_FINE);
      if (s.phase === 'ended') return s;
      if (!p.alive) return settle(s);
      return moveAndLand(s, sum, false);
    }
    pushLog(s, `${p.name} 掷出 ${d1}+${d2}，不是对子，继续留在监狱（${p.jailTurns}/3）。`);
    s.phase = 'awaitEnd';
    return s;
  }

  pushLog(s, `${p.name} 掷出 ${d1}+${d2}（${sum}）。`);
  if (isDouble) {
    s.doubles += 1;
    if (s.doubles >= 3) {
      pushLog(s, `${p.name} 连掷三次对子，被送进监狱。`);
      sendToJail(s, p);
      s.phase = 'awaitEnd';
      return s;
    }
  }
  return moveAndLand(s, sum, isDouble);
}

function sendToJail(s, p) {
  p.pos = JAIL_POS;
  p.inJail = true;
  p.jailTurns = 0;
}

function settle(s) {
  if (s.phase === 'ended') return s;
  const p = s.players[s.turn];
  if (!p.alive) {
    s.pending = null;
    if (!checkWin(s)) nextTurn(s);
  }
  return s;
}

function moveAndLand(s, steps, isDouble) {
  const p = s.players[s.turn];
  const from = p.pos;
  const to = from + steps;
  if (to >= 40) {
    p.cash += GO_BONUS;
    pushLog(s, `${p.name} 经过起点，领取 ${GO_BONUS} 元。`);
  }
  p.pos = to % 40;
  land(s, isDouble);
  return settle(s);
}

function land(s, isDouble, depth = 0) {
  if (depth > 4) {
    s.phase = 'awaitEnd';
    return;
  }
  const p = s.players[s.turn];
  const t = tileAt(p.pos);
  const owner = s.owners[p.pos];

  const finish = () => {
    if (s.phase === 'ended') return;
    if (!p.alive) {
      // 刚才结算时破产了：直接交给下一位
      s.pending = null;
      if (!checkWin(s)) nextTurn(s);
      return;
    }
    s.phase = isDouble && !p.inJail ? 'awaitRoll' : 'awaitEnd';
  };

  switch (t.type) {
    case 'go':
      p.cash += GO_BONUS;
      pushLog(s, `${p.name} 停在起点，额外领取 ${GO_BONUS} 元。`);
      return finish();
    case 'jail':
      pushLog(s, `${p.name} 路过监狱，探个监。`);
      return finish();
    case 'parking':
      pushLog(s, `${p.name} 在免费停车区休息。`);
      return finish();
    case 'gotojail':
      pushLog(s, `${p.name} 踩进「入狱」，直接进监狱。`);
      sendToJail(s, p);
      return finish();
    case 'tax':
      pushLog(s, `${p.name} 缴纳${t.name} ${t.amount} 元。`);
      transfer(s, p.id, null, t.amount);
      return finish();
    case 'chance':
    case 'fate':
      return resolveCard(s, t.type, isDouble, depth);
    case 'prop':
    case 'rail':
    case 'util': {
      if (owner === undefined) {
        if (p.cash >= t.price) {
          s.pending = { type: 'buy', pos: p.pos, price: t.price };
          s.phase = 'awaitBuy';
        } else {
          pushLog(s, `${p.name} 现金不足，买不起「${t.name}」。`);
          return finish();
        }
        return;
      }
      if (owner === p.id) {
        pushLog(s, `${p.name} 回到自己的「${t.name}」。`);
        return finish();
      }
      const rent = rentOf(s, p.pos, s.dice[0] + s.dice[1]);
      if (rent <= 0) return finish();
      const landlord = player(s, owner);
      pushLog(s, `${p.name} 落在 ${landlord.name} 的「${t.name}」，支付租金 ${rent} 元。`);
      transfer(s, p.id, owner, rent);
      return finish();
    }
    default:
      return finish();
  }
}

function resolveCard(s, which, isDouble, depth) {
  const p = s.players[s.turn];
  const deckKey = which === 'chance' ? 'chanceDeck' : 'fateDeck';
  const cards = which === 'chance' ? CHANCE_CARDS : FATE_CARDS;
  const deck = s[deckKey];
  const idx = deck.shift();
  deck.push(idx);
  const card = cards[idx];
  pushLog(s, `${p.name} 抽到${which === 'chance' ? '机遇' : '命运'}：${card.text}`);

  if (card.jail) {
    sendToJail(s, p);
    s.phase = 'awaitEnd';
    return;
  }
  if (card.jailCard) {
    p.jailCards += 1;
    s.phase = isDouble ? 'awaitRoll' : 'awaitEnd';
    return;
  }
  if (card.cash) {
    if (card.cash > 0) {
      p.cash += card.cash;
    } else {
      transfer(s, p.id, null, -card.cash);
      if (s.phase === 'ended') return;
      if (!p.alive) return settle(s);
    }
  }
  if (card.perHouse) {
    let houses = 0;
    for (const pos of Object.keys(s.owners)) if (s.owners[pos] === p.id) houses += housesAt(s, Number(pos));
    const due = Math.abs(card.perHouse) * houses;
    if (due > 0) {
      pushLog(s, `${p.name} 有 ${houses} 栋建筑，共付 ${due} 元。`);
      transfer(s, p.id, null, due);
      if (!p.alive) return settle(s);
    } else {
      pushLog(s, `${p.name} 没有建筑，免付。`);
    }
  }
  if (card.each) {
    for (const other of s.players) {
      if (other.id === p.id || !other.alive) continue;
      if (card.each > 0) {
        transfer(s, other.id, p.id, card.each);
      } else {
        transfer(s, p.id, other.id, -card.each);
      }
      if (!p.alive) break;
    }
    if (!p.alive) return settle(s);
  }
  if (card.move) {
    if (s.phase === 'ended') return;
    if (card.move === 'to') {
      const from = p.pos;
      if (card.pos <= from && card.pos !== from) {
        p.cash += GO_BONUS;
        pushLog(s, `${p.name} 经过起点，领取 ${GO_BONUS} 元。`);
      }
      p.pos = card.pos;
    } else if (card.move === 'back') {
      p.pos = ((p.pos - card.n) % 40 + 40) % 40;
    }
    return land(s, isDouble, depth + 1);
  }
  s.phase = isDouble ? 'awaitRoll' : 'awaitEnd';
}

/* ---------------- 玩家动作 ---------------- */

export function decideBuy(s0, want) {
  const s = clone(s0);
  if (s.phase !== 'awaitBuy' || !s.pending) return s0;
  const p = s.players[s.turn];
  const t = tileAt(s.pending.pos);
  if (want) {
    if (p.cash < t.price) return s0;
    p.cash -= t.price;
    s.owners[s.pending.pos] = p.id;
    s.houses[s.pending.pos] = 0;
    pushLog(s, `${p.name} 买下「${t.name}」，花费 ${t.price} 元。`);
  } else {
    pushLog(s, `${p.name} 放弃购买「${t.name}」。`);
  }
  s.pending = null;
  s.phase = s.doubles > 0 ? 'awaitRoll' : 'awaitEnd';
  return s;
}

export function build(s0, pos) {
  const s = clone(s0);
  const p = s.players[s.turn];
  if (!['awaitRoll', 'awaitEnd'].includes(s.phase)) return s0;
  if (!canBuild(s, pos, p.id)) return s0;
  const t = tileAt(pos);
  p.cash -= t.house;
  s.houses[pos] = housesAt(s, pos) + 1;
  pushLog(s, `${p.name} 把「${t.name}」升到 ${['空地', '1 级', '2 级', '3 级', '4 级', '旅馆'][s.houses[pos]]}，花费 ${t.house} 元。`);
  return s;
}

export function sellBuilding(s0, pos) {
  const s = clone(s0);
  const p = s.players[s.turn];
  if (!['awaitRoll', 'awaitEnd'].includes(s.phase)) return s0;
  if (s.owners[pos] !== p.id) return s0;
  if (housesAt(s, pos) <= 0) return s0;
  const t = tileAt(pos);
  const group = ownedInGroup(s, t.group);
  const high = Math.max(...group.map((g) => housesAt(s, g.pos)));
  if (housesAt(s, pos) !== high) return s0; // 只能从最高处拆
  s.houses[pos] = housesAt(s, pos) - 1;
  p.cash += Math.floor(t.house / 2);
  pushLog(s, `${p.name} 拆掉「${t.name}」一级建筑，回收 ${Math.floor(t.house / 2)} 元。`);
  return s;
}

export function payJailFine(s0) {
  const s = clone(s0);
  const p = s.players[s.turn];
  if (s.phase !== 'awaitJail' || !p.inJail || p.cash < JAIL_FINE) return s0;
  p.cash -= JAIL_FINE;
  p.inJail = false;
  p.jailTurns = 0;
  pushLog(s, `${p.name} 缴纳 ${JAIL_FINE} 元保释，出狱。`);
  s.phase = 'awaitRoll';
  return s;
}

export function useJailCard(s0) {
  const s = clone(s0);
  const p = s.players[s.turn];
  if (s.phase !== 'awaitJail' || p.jailCards <= 0) return s0;
  p.jailCards -= 1;
  p.inJail = false;
  p.jailTurns = 0;
  pushLog(s, `${p.name} 使用「出狱卡」出狱。`);
  s.phase = 'awaitRoll';
  return s;
}

export function endTurn(s0) {
  const s = clone(s0);
  if (s.phase !== 'awaitEnd') return s0;
  nextTurn(s);
  return s;
}

/** 进入某玩家回合时校正阶段（供 UI 初始化/载入存档调用） */
export function normalize(s0) {
  const s = clone(s0);
  if (s.phase === 'ended') return s;
  const p = s.players[s.turn];
  if (p.inJail && (s.phase === 'awaitRoll')) s.phase = 'awaitJail';
  return s;
}
