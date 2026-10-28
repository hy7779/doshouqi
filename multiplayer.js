'use strict';

(() => {
  const COLS = 7;
  const ROWS = 9;
  const RIVERS = [[2, 4, 3, 6], [5, 4, 6, 6]];
  const DENS = { red: { x: 4, y: 9 }, blue: { x: 4, y: 1 } };
  const TRAPS = {
    red: [{ x: 3, y: 9 }, { x: 5, y: 9 }, { x: 4, y: 8 }],
    blue: [{ x: 3, y: 1 }, { x: 5, y: 1 }, { x: 4, y: 2 }],
  };
  const NAMES = { 1: '鼠', 2: '猫', 3: '狗', 4: '狼', 5: '豹', 6: '虎', 7: '狮', 8: '象' };

  const $ = id => document.getElementById(id);

  const boardEl = $('board');
  const joinScreen = $('joinScreen');
  const roomInput = $('roomInput');
  const joinBtn = $('joinBtn');
  const joinHint = $('joinHint');
  const roomBadge = $('roomBadge');
  const roomLabel = $('roomLabel');
  const roleText = $('roleText');
  const playersText = $('playersText');
  const messageEl = $('message');
  const statusText = $('statusText');
  const turnText = $('turnText');
  const statusDot = $('statusDot');
  const spectatorPanel = $('spectatorPanel');
  const chatLog = $('chatLog');
  const chatInput = $('chatInput');
  const chatSendBtn = $('chatSendBtn');

  let socket = null;
  let connected = false;
  let myRole = null;
  let roomId = null;
  let state = null;
  let selected = null;

  const isRiver = (x, y) => RIVERS.some(([x1, y1, x2, y2]) =>
    x >= x1 && x <= x2 && y >= y1 && y <= y2);
  const isTrap = (x, y, side) => TRAPS[side].some(t => t.x === x && t.y === y);
  const isDen = (x, y, side) => DENS[side].x === x && DENS[side].y === y;
  const pieceAt = (st, x, y) => st.pieces.find(p => p.x === x && p.y === y) || null;

  /* ================= WebSocket ================= */

  function connect() {
    // 绝不在代码里写死 localhost：跟随当前页面协议与域名。
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${window.location.host}`);

    socket.addEventListener('open', () => {
      connected = true;
      joinBtn.disabled = false;
      joinHint.textContent = '已连接。输入房间号加入。';
    });

    socket.addEventListener('message', event => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      handleMessage(msg);
    });

    socket.addEventListener('close', () => {
      connected = false;
      joinBtn.disabled = true;
      joinHint.textContent = '连接已断开，请刷新页面重试。';
      statusText.textContent = '已断开';
      turnText.textContent = '';
      statusDot.className = 'dot over';
      setMessage('与服务器的连接已断开，请刷新页面。');
      setChatEnabled(false);
    });

    socket.addEventListener('error', () => {
      joinHint.textContent = '连接失败，请确认服务器已启动。';
    });
  }

  function send(payload) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'hello':
        break;
      case 'joined':
        onJoined(msg);
        break;
      case 'start':
        onStart(msg);
        break;
      case 'state':
        onState(msg);
        break;
      case 'players':
        onPlayers(msg);
        break;
      case 'opponentLeft':
        onOpponentLeft(msg);
        break;
      case 'roomClosed':
        onRoomClosed(msg);
        break;
      case 'chat':
        appendChat(msg);
        break;
      case 'notice':
        setMessage(msg.message || '');
        break;
      case 'error':
        setMessage(msg.message || '操作失败');
        if (!myRole) {
          joinBtn.disabled = !connected;
          joinHint.textContent = msg.message || '加入失败';
        }
        break;
      default:
        break;
    }
  }

  function onJoined(msg) {
    myRole = msg.role;
    roomId = msg.roomId;

    joinScreen.hidden = true;
    roomBadge.hidden = false;
    roomLabel.textContent = roomId;

    spectatorPanel.hidden = myRole !== 'spectator';
    roleText.className = myRole === 'spectator' ? '' : myRole;
    roleText.textContent = myRole === 'spectator'
      ? '你是：观战者'
      : `你是：${myRole === 'red' ? '红方' : '蓝方'}`;

    setPlayers(msg.players);
    resetChat();
    setChatEnabled(true);

    if (msg.started) {
      setMessage('对局已经开始。');
    } else if (myRole === 'spectator') {
      setMessage('已作为观战者加入，棋盘只读。');
    } else {
      setMessage('已加入房间，等待另一名玩家…');
    }

    render();
  }

  function onStart(msg) {
    state = msg.state;
    selected = null;
    setPlayers(msg.players || (state && state.players));
    setMessage(`对局开始：${msg.first === 'red' ? '红方' : '蓝方'}先手。`);
    render();
  }

  function onState(msg) {
    state = msg.state;
    selected = null;
    if (msg.players) setPlayers(msg.players);

    if (state && state.status !== 'playing') {
      setMessage(`${state.winner === 'red' ? '红方' : '蓝方'}获胜：${state.reason || ''}`);
    } else if (msg.move) {
      const side = msg.move.side === 'red' ? '红方' : '蓝方';
      setMessage(`${side}落子：(${msg.move.from.x},${msg.move.from.y}) → (${msg.move.to.x},${msg.move.to.y})`);
    }

    render();
  }

  function onPlayers(msg) {
    if (state) state.players = msg.players;
    setPlayers(msg.players);
    render();
  }

  function onOpponentLeft(msg) {
    if (msg.state) state = msg.state;
    if (msg.players) setPlayers(msg.players);
    setMessage(msg.message || '对方已断线');
    render();
  }

  function onRoomClosed(msg) {
    state = null;
    selected = null;
    myRole = null;
    roomId = null;
    roomBadge.hidden = true;
    spectatorPanel.hidden = true;
    joinScreen.hidden = false;
    joinBtn.disabled = !connected;
    joinHint.textContent = connected ? '房间已关闭，输入新的房间号加入。' : '连接已断开，请刷新页面。';
    setMessage(msg.message || '房间已关闭。');
    setChatEnabled(false);
    render();
  }

  /* ================= 界面 ================= */

  function setPlayers(players) {
    if (!players) return;
    const red = players.red ? '已加入' : '等待加入';
    const blue = players.blue ? '已加入' : '等待加入';
    const watchers = players.spectators ? `　观战：${players.spectators} 人` : '';
    playersText.textContent = `红方：${red}　蓝方：${blue}${watchers}`;
  }

  function setMessage(text) {
    messageEl.textContent = text || '';
  }

  function setChatEnabled(enabled) {
    chatInput.disabled = !enabled;
    chatSendBtn.disabled = !enabled;
  }

  function resetChat() {
    chatLog.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.textContent = '还没有人说话';
    chatLog.appendChild(empty);
  }

  function appendChat(msg) {
    const empty = chatLog.querySelector('.chat-empty');
    if (empty) empty.remove();

    const role = msg.role === 'red' || msg.role === 'blue' ? msg.role : 'spectator';
    const line = document.createElement('div');
    line.className = `chat-line ${role}`;

    const label = document.createElement('span');
    label.className = 'chat-role';
    label.textContent = `${msg.sender || (role === 'red' ? '红方' : role === 'blue' ? '蓝方' : '观战者')}：`;

    const body = document.createElement('span');
    body.className = 'chat-text';
    body.textContent = String(msg.text ?? '');

    line.appendChild(label);
    line.appendChild(body);
    chatLog.appendChild(line);

    while (chatLog.children.length > 200) {
      chatLog.firstElementChild.remove();
    }
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function sendChat() {
    const text = chatInput.value.trim();
    if (!text) {
      setMessage('聊天内容不能为空');
      chatInput.focus();
      return;
    }
    if (!myRole) {
      setMessage('加入房间后才能聊天');
      return;
    }
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setMessage('连接已断开，无法发送消息');
      return;
    }
    if (Array.from(text).length > 50) {
      setMessage('聊天内容最多 50 个字');
      return;
    }

    send({ type: 'chat', text });
    chatInput.value = '';
    chatInput.focus();
  }

  function bothPresent() {
    return !!(state && state.players && state.players.red && state.players.blue);
  }

  function locked() {
    if (!state || state.status !== 'playing') return true;
    if (myRole !== 'red' && myRole !== 'blue') return true;
    if (!bothPresent()) return true;
    return state.turn !== myRole;
  }

  function lockReason() {
    if (!state) return '等待玩家加入';
    if (state.status !== 'playing') return '对局已经结束';
    if (myRole !== 'red' && myRole !== 'blue') return '观战中，不能落子';
    if (!bothPresent()) return '对方已断线，等待重新加入';
    return '还没轮到你，等待对方';
  }

  function updateStatus() {
    if (!state) {
      statusText.textContent = '等待玩家…';
      turnText.textContent = '';
      statusDot.className = 'dot';
      return;
    }

    if (state.status !== 'playing') {
      statusText.textContent = state.winner
        ? `${state.winner === 'red' ? '红方' : '蓝方'}获胜`
        : '对局结束';
      turnText.textContent = state.reason || '';
      statusDot.className = 'dot over';
      return;
    }

    if (myRole === 'spectator') {
      statusText.textContent = '观战中';
      turnText.textContent = `${state.turn === 'red' ? '红方' : '蓝方'}回合`;
      statusDot.className = `dot ${state.turn}`;
      return;
    }

    if (!bothPresent()) {
      statusText.textContent = '对方已断线，等待重新加入';
      turnText.textContent = '';
      statusDot.className = 'dot';
      return;
    }

    if (state.turn === myRole) {
      statusText.textContent = '轮到你';
      turnText.textContent = `${myRole === 'red' ? '红方' : '蓝方'}回合`;
      statusDot.className = `dot ${myRole}`;
    } else {
      statusText.textContent = '等待对方落子…';
      turnText.textContent = `${state.turn === 'red' ? '红方' : '蓝方'}回合`;
      statusDot.className = `dot ${state.turn}`;
    }
  }

  function makeMark(className, text) {
    const mark = document.createElement('span');
    mark.className = `mark ${className}`;
    mark.textContent = text;
    mark.setAttribute('aria-hidden', 'true');
    return mark;
  }

  function render() {
    // 即使还没开局也把空棋盘画出来，等待时不会只剩一块黑底。
    const view = state || { pieces: [], lastMove: null };
    const canClick = !locked();
    const last = view.lastMove;
    const map = new Map(view.pieces.map(p => [`${p.x},${p.y}`, p]));
    const fragment = document.createDocumentFragment();

    for (let y = 1; y <= ROWS; y++) {
      for (let x = 1; x <= COLS; x++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'cell';
        cell.dataset.x = String(x);
        cell.dataset.y = String(y);

        const river = isRiver(x, y);
        const trap = isTrap(x, y, 'red') || isTrap(x, y, 'blue');
        const den = isDen(x, y, 'red') || isDen(x, y, 'blue');
        const piece = map.get(`${x},${y}`);

        if (river) cell.classList.add('river');
        if (trap) cell.classList.add('trap');
        if (den) cell.classList.add('den');
        if (canClick) cell.classList.add('can-click');

        if (selected && selected.x === x && selected.y === y) {
          cell.classList.add('selected');
        }
        if (last && last.from.x === x && last.from.y === y) {
          cell.classList.add('last-from');
        }
        if (last && last.to.x === x && last.to.y === y) {
          cell.classList.add('last-to');
        }

        let label = `第${x}列，第${y}行`;
        if (river) label += '，河流';
        if (trap) label += '，陷阱';
        if (den) label += '，兽穴';
        if (piece) label += `，${piece.side === 'red' ? '红方' : '蓝方'}${NAMES[piece.rank]}`;
        cell.setAttribute('aria-label', label);

        if (river) cell.appendChild(makeMark('wave', '≈'));
        if (trap) cell.appendChild(makeMark('trap', '陷'));
        if (den) cell.appendChild(makeMark('den', '穴'));

        if (piece) {
          const pieceEl = document.createElement('span');
          pieceEl.className = `piece ${piece.side}`;
          pieceEl.textContent = NAMES[piece.rank];
          pieceEl.setAttribute('aria-hidden', 'true');
          cell.appendChild(pieceEl);
        }

        fragment.appendChild(cell);
      }
    }

    boardEl.replaceChildren(fragment);
    updateStatus();
  }

  function onCellClick(x, y) {
    if (locked()) {
      setMessage(lockReason());
      return;
    }

    const piece = pieceAt(state, x, y);

    if (!selected) {
      if (!piece || piece.side !== myRole) {
        setMessage('先点一枚自己的棋子');
        return;
      }
      selected = { x, y };
      render();
      return;
    }

    if (selected.x === x && selected.y === y) {
      selected = null;
      render();
      return;
    }

    if (piece && piece.side === myRole) {
      selected = { x, y };
      render();
      return;
    }

    const from = selected;
    selected = null;
    setMessage(`已提交：(${from.x},${from.y}) → (${x},${y})`);
    send({ type: 'move', from, to: { x, y } });
    render();
  }

  /* ================= 启动 ================= */

  boardEl.addEventListener('click', event => {
    const cell = event.target.closest('.cell');
    if (!cell || !boardEl.contains(cell)) return;

    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    if (!Number.isInteger(x) || !Number.isInteger(y)) return;

    onCellClick(x, y);
  });

  joinBtn.addEventListener('click', () => {
    const id = roomInput.value.trim();
    if (!id) {
      joinHint.textContent = '请输入房间号';
      return;
    }
    if (!connected) {
      joinHint.textContent = '还没连上服务器，请稍候';
      return;
    }
    joinBtn.disabled = true;
    joinHint.textContent = '正在加入…';
    send({ type: 'join', roomId: id });
  });

  roomInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') joinBtn.click();
  });

  chatSendBtn.addEventListener('click', sendChat);

  chatInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      sendChat();
    }
  });

  document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!myRole || !connected) {
        setMessage('加入房间后才能聊天');
        return;
      }
      const emoji = btn.dataset.emoji || '';
      if (!emoji) return;

      const next = chatInput.value + emoji;
      if (Array.from(next).length > 50) {
        setMessage('聊天内容最多 50 个字');
        return;
      }
      chatInput.value = next;
      chatInput.focus();
    });
  });

  resetChat();
  render();
  connect();
})();
