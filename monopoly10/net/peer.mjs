/**
 * PeerJS 封装：建房 / 加入
 * 传输对象只需要 send / on('data'|'close')，和 net/host、net/client 的约定一致
 */
export const PREFIX = 'dsq10-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function createHost(code, { onConn, onOpen, onError }) {
  const peer = new window.Peer(PREFIX + code, { debug: 0 });
  peer.on('open', (id) => onOpen?.(id));
  peer.on('connection', (conn) => onConn?.(conn));
  peer.on('error', (err) => onError?.(err));
  return peer;
}

export function joinRoom(code, { onConn, onError }) {
  const peer = new window.Peer(undefined, { debug: 0 });
  peer.on('error', (err) => onError?.(err));
  peer.on('open', () => {
    const conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
    conn.on('open', () => onConn?.(conn));
    conn.on('error', (err) => onError?.(err));
  });
  return peer;
}
