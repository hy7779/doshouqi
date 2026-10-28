'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 3000;

/* ============================================================
   斗兽棋规则（服务器唯一权威）
   ============================================================ */

const COLS = 7;
const ROWS = 9;
const RIVERS = [[2, 4, 3, 6], [5, 4, 6, 6]];
const DENS = { red: { x: 4, y: 9 }, blue: { x: 4, y: 1 } };
const TRAPS = {
  red: [{ x: 3, y: 9 }, { x: 5, y: 9 }, { x: 4, y: 8 }],
  blue: [{ x: 3, y: 1 }, { x: 5, y: 1 }, { x: 4, y: 2 }],
};

const OTHER = side => (side === 'red' ? 'blue' : 'red');
const inside = (x, y) => x >= 1 && x <= COLS && y >= 1 && y <= ROWS;
const isRiver = (x, y) => RIVERS.some(([x1, y1, x2, y2]) =>
  x >= x1 && x <= x2 && y >= y1 && y <= y2);
const isTrap = (x, y, side) => TRAPS[side].some(t => t.x === x && t.y === y);
const isDen = (x, y, side) => DENS[side].x === x && DENS[side].y === y;
const pieceAt = (st, x, y) =>
  st.pieces.find(p => p.alive !== false && p.x === x && p.y === y) || null;
const isCoord = v => v && Number.isInteger(v.x) && Number.isInteger(v.y) && inside(v.x, v.y);

function canCapture(a, d, tx, ty) {
  if (!d || a.side === d.side) return false;
  if (isTrap(tx, ty, OTHER(d.side))) return true;
  if (isRiver(d.x, d.y) && a.rank !== 1) return false;
  if (isRiver(a.x, a.y) && !isRiver(tx, ty)) return false;
  if (a.rank === 1 && d.rank === 8) return true;
  if (a.rank === 8 && d.rank === 1) return false;
  return a.rank >= d.rank;
}

function between(a, x2, y2) {
  const cells = [];
  if (a.y === y2) {
    const step = x2 > a.x ? 1 : -1;
    for (let x = a.x + step; x !== x2; x += step) cells.push({ x, y: a.y });
  } else if (a.x === x2) {
    const step = y2 > a.y ? 1 : -1;
    for (let y = a.y + step; y !== y2; y += step) cells.push({ x: a.x, y });
  } else {
    return null;
  }
  return cells;
}

function canJump(st, p, x, y) {
  if (p.rank !== 6 && p.rank !== 7) return false;
  const cells = between(p, x, y);
  if (!cells || cells.length < 2) return false;
  if (!cells.every(c => isRiver(c.x, c.y))) return false;
  if (cells.some(c => {
    const q = pieceAt(st, c.x, c.y);
    return q && q.rank === 1;
  })) return false;
  return true;
}

function movesOf(st, p) {
  const out = [];
  const push = (x, y, jump = false) => {
    if (!inside(x, y)) return;
    if (isDen(x, y, p.side)) return;
    if (isRiver(x, y) && p.rank !== 1) return;
    const target = pieceAt(st, x, y);
    if (target && !canCapture(p, target, x, y)) return;
    out.push({ x, y, capture: !!target, jump });
  };

  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    push(p.x + dx, p.y + dy);
  }

  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let x = p.x;
    let y = p.y;
    while (true) {
      x += dx;
      y += dy;
      if (!inside(x, y)) break;
      if (!isRiver(x, y)) {
        if (canJump(st, p, x, y)) push(x, y, true);
        break;
      }
    }
  }

  return out;
}

function hasAnyMove(st, side) {
  return st.pieces.some(p =>
    p.alive !== false && p.side === side && movesOf(st, p).length > 0);
}

function initialState(first) {
  const pieces = [];
  let id = 0;
  const put = (side, rank, x, y) =>
    pieces.push({ id: ++id, side, rank, x, y, alive: true });

  // 红方（下方）
  put('red', 6, 1, 9);  // 虎
  put('red', 7, 7, 9);  // 狮
  put('red', 2, 2, 8);  // 猫
  put('red', 3, 6, 8);  // 狗
  put('red', 8, 1, 7);  // 象
  put('red', 4, 3, 7);  // 狼
  put('red', 5, 5, 7);  // 豹
  put('red', 1, 7, 7);  // 鼠

  // 蓝方（上方），红方的 180° 镜像
  put('blue', 7, 1, 1); // 狮
  put('blue', 6, 7, 1); // 虎
  put('blue', 3, 2, 2); // 狗
  put('blue', 2, 6, 2); // 猫
  put('blue', 1, 1, 3); // 鼠
  put('blue', 5, 3, 3); // 豹
  put('blue', 4, 5, 3); // 狼
  put('blue', 8, 7, 3); // 象

  return {
    turn: first,
    pieces,
    status: 'playing',
    winner: null,
    reason: null,
    lastMove: null,
  };
}

function applyMove(st, from, to) {
  const p = pieceAt(st, from.x, from.y);
  if (!p) return { ok: false, error: '这一格没有棋子' };
  if (p.side !== st.turn) return { ok: false, error: '还没轮到这一方' };

  const mv = movesOf(st, p).find(m => m.x === to.x && m.y === to.y);
  if (!mv) return { ok: false, error: '这一步不合法' };

  if (mv.capture) {
    const cap = pieceAt(st, to.x, to.y);
    if (cap) cap.alive = false;
  }

  const fromPos = { x: p.x, y: p.y };
  p.x = to.x;
  p.y = to.y;
  st.lastMove = {
    from: fromPos,
    to: { x: to.x, y: to.y },
    side: p.side,
    rank: p.rank,
  };
  st.turn = OTHER(p.side);

  if (isDen(to.x, to.y, OTHER(p.side))) {
    st.status = `${p.side}_win`;
    st.winner = p.side;
    st.reason = '进入对方兽穴';
    return { ok: true };
  }

  const foe = st.pieces.filter(q => q.alive !== false && q.side !== p.side);
  if (foe.length === 0) {
    st.status = `${p.side}_win`;
    st.winner = p.side;
    st.reason = '对方没有子';
    return { ok: true };
  }
  if (!hasAnyMove(st, OTHER(p.side))) {
    st.status = `${p.side}_win`;
    st.winner = p.side;
    st.reason = '对方无子可走';
    return { ok: true };
  }

  st.status = 'playing';
  st.winner = null;
  st.reason = null;
  return { ok: true };
}

/* ============================================================
   房间与消息
   ============================================================ */

const rooms = new Map();
const ROLE_LABEL = { red: '红方', blue: '蓝方', spectator: '观战者' };

function playersInfo(room) {
  return {
    red: !!room.red,
    blue: !!room.blue,
    spectators: room.spectators.size,
  };
}

function publicState(room) {
  const st = room.state;
  if (!st) return null;
  return {
    turn: st.turn,
    status: st.status,
    winner: st.winner,
    reason: st.reason,
    lastMove: st.lastMove,
    pieces: st.pieces
      .filter(p => p.alive !== false)
      .map(p => ({ id: p.id, side: p.side, rank: p.rank, x: p.x, y: p.y })),
    players: playersInfo(room),
  };
}

function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendError(ws, message) {
  send(ws, { type: 'error', message });
}

function broadcast(room, payload, except = null) {
  const data = JSON.stringify(payload);
  const targets = [room.red, room.blue, ...room.spectators];
  for (const client of targets) {
    if (client && client !== except && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function startGame(room) {
  if (room.started || !room.red || !room.blue) return;

  room.started = true;
  const first = Math.random() < 0.5 ? 'red' : 'blue';
  room.state = initialState(first);

  broadcast(room, {
    type: 'start',
    roomId: room.id,
    first,
    state: publicState(room),
    players: playersInfo(room),
  });
}

function handleJoin(ws, msg) {
  if (ws.roomId) {
    return sendError(ws, '你已经在房间里了');
  }

  const roomId = String(msg.roomId || '').trim().slice(0, 40);
  if (!roomId) return sendError(ws, '请输入房间号');

  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      red: null,
      blue: null,
      spectators: new Set(),
      state: null,
      started: false,
    };
    rooms.set(roomId, room);
  }

  let role;
  if (!room.red) {
    room.red = ws;
    role = 'red';
  } else if (!room.blue) {
    room.blue = ws;
    role = 'blue';
  } else {
    room.spectators.add(ws);
    role = 'spectator';
  }

  ws.roomId = roomId;
  ws.role = role;

  const wasStarted = room.started;

  send(ws, {
    type: 'joined',
    roomId,
    role,
    started: room.started,
    players: playersInfo(room),
  });

  broadcast(room, { type: 'players', players: playersInfo(room) }, ws);

  if (role !== 'spectator') {
    broadcast(room, {
      type: 'notice',
      message: `${role === 'red' ? '红方' : '蓝方'}已加入房间`,
    }, ws);
  }

  startGame(room);

  if (wasStarted && room.state) {
    send(ws, {
      type: 'state',
      roomId,
      state: publicState(room),
      players: playersInfo(room),
    });
  }
}

function handleMove(ws, msg) {
  const room = rooms.get(ws.roomId);
  if (!room) return sendError(ws, '房间不存在');
  if (!room.started || !room.state) return sendError(ws, '对局还没开始');
  if (ws.role !== 'red' && ws.role !== 'blue') return sendError(ws, '观战者不能落子');
  if (!room.red || !room.blue) return sendError(ws, '对方已断线，等待重新加入');
  if (room.state.status !== 'playing') return sendError(ws, '对局已经结束');
  if (room.state.turn !== ws.role) return sendError(ws, '还没轮到你');

  if (!isCoord(msg.from) || !isCoord(msg.to)) {
    return sendError(ws, '坐标不合法');
  }

  const piece = pieceAt(room.state, msg.from.x, msg.from.y);
  if (!piece || piece.side !== ws.role) {
    return sendError(ws, '只能移动自己的棋子');
  }

  const result = applyMove(room.state, msg.from, msg.to);
  if (!result.ok) {
    return sendError(ws, result.error || '这一步不合法');
  }

  broadcast(room, {
    type: 'state',
    roomId: room.id,
    state: publicState(room),
    players: playersInfo(room),
    move: {
      from: { x: msg.from.x, y: msg.from.y },
      to: { x: msg.to.x, y: msg.to.y },
      side: ws.role,
    },
  });
}

function handleChat(ws, msg) {
  const room = rooms.get(ws.roomId);
  if (!room) return sendError(ws, '请先加入房间');
  if (!ws.role) return sendError(ws, '请先加入房间');

  const text = typeof msg.text === 'string' ? msg.text.trim() : '';
  if (!text) return sendError(ws, '聊天内容不能为空');
  if (Array.from(text).length > 50) return sendError(ws, '聊天内容最多 50 个字');

  broadcast(room, {
    type: 'chat',
    role: ws.role,
    sender: ROLE_LABEL[ws.role] || '观战者',
    text,
    at: Date.now(),
  });
}

function leaveRoom(ws) {
  const room = rooms.get(ws.roomId);
  if (!room) {
    ws.roomId = null;
    ws.role = null;
    return;
  }

  const role = ws.role;
  if (room.red === ws) room.red = null;
  else if (room.blue === ws) room.blue = null;
  else room.spectators.delete(ws);

  ws.roomId = null;
  ws.role = null;

  if (!room.red && !room.blue) {
    broadcast(room, { type: 'roomClosed', message: '玩家都已离开，房间已关闭' });
    for (const spectator of room.spectators) {
      spectator.roomId = null;
      spectator.role = null;
    }
    room.spectators.clear();
    rooms.delete(room.id);
    return;
  }

  broadcast(room, {
    type: 'opponentLeft',
    role,
    players: playersInfo(room),
    state: room.state ? publicState(room) : null,
    message: role === 'spectator'
      ? '一名观战者离开了'
      : `${role === 'red' ? '红方' : '蓝方'}已断线`,
  });
}

/* ============================================================
   HTTP + WebSocket 服务
   ============================================================ */

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'multiplayer.html'));
});

app.get('/multiplayer.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'multiplayer.html'));
});

app.get('/multiplayer.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'multiplayer.js'));
});

app.get('/health', (req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

app.use((req, res) => {
  res.status(404).send('Not found');
});

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.roomId = null;
  ws.role = null;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  send(ws, { type: 'hello' });

  ws.on('message', raw => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return sendError(ws, '消息不是合法 JSON');
    }

    if (!msg || typeof msg !== 'object') {
      return sendError(ws, '消息格式错误');
    }

    switch (msg.type) {
      case 'join':
        handleJoin(ws, msg);
        break;
      case 'move':
        handleMove(ws, msg);
        break;
      case 'chat':
        handleChat(ws, msg);
        break;
      default:
        sendError(ws, '未知消息类型');
    }
  });

  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => leaveRoom(ws));
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
heartbeat.unref?.();

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`斗兽棋联机版已启动：http://localhost:${PORT}`);
});
