// 端到端：真浏览器（Edge headless）+ CDP，真点鼠标验证交互。
// 需要 Edge 能启动（受限沙箱下其 IPC 需要命名管道）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const PAGE = 'file:///' + path.join(here, 'ai-local.html').replace(/\\/g, '/');
const PORT = 9333;
const PROFILE = path.join(here, '.edge-e2e');
const shotPath = (name) => path.join(here, name);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--window-size=1360,1000',
  PAGE,
], { stdio: 'ignore' });

let ws;
let seq = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new Error('页面异常：' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
  }
  return res.result.value;
}

async function waitFor(expression, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await evaluate(`return !!(${expression})`)) return true;
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
    await sleep(120);
  }
}

const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok, extra });
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) throw new Error('检查失败：' + name);
}

try {
  // 等 CDP 端口
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.url.includes('ai-local.html'));
    } catch {}
    if (!target) await sleep(300);
  }
  if (!target) throw new Error('找不到浏览器页面');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });
  await send('Runtime.enable');

  // 1. 页面结构
  await waitFor("document.querySelectorAll('.cell').length === 63", '63 个格子');
  check('棋盘 63 格', true);

  const noServerErrors = await evaluate("return !document.body.textContent.includes('连不上')");
  check('没有"连不上服务"的兜底文案', noServerErrors);

  // 河流格必须和 engine.mjs 的 GEO 一致：x∈{2,3} 与 x∈{5,6} 的三行
  const river = await evaluate(`
    const cells = [...document.querySelectorAll('.cell.river')].map(c => c.dataset.x + ',' + c.dataset.y);
    return {
      count: cells.length,
      mid: document.querySelector('.cell[data-x="3"][data-y="5"]').classList.contains('river'),
      gap: document.querySelector('.cell[data-x="4"][data-y="5"]').classList.contains('river')
    };
  `);
  check('河流格与规则一致（12 格，中间留通道）', river.count === 12 && river.mid && !river.gap,
    JSON.stringify(river));

  const initial = await evaluate(`
    const badge = document.getElementById('engineBadge').textContent;
    const title = document.getElementById('statusTitle').textContent;
    const pieces = document.querySelectorAll('.piece').length;
    const history = window.doushouqi.history().length;
    return { badge, title, pieces, history };
  `);
  check('初始局面', initial.pieces === 16 && initial.history === 0 && initial.title.includes('红方'),
    JSON.stringify(initial));

  // 2. 人类走一步：鼠 (7,7) → (6,7)
  const click = (x, y) => evaluate(`
    const c = document.querySelector('.cell[data-x="${x}"][data-y="${y}"]');
    c.click();
    return true;
  `);

  await click(7, 7);
  const sel = await evaluate(`
    return {
      selected: !!document.querySelector('.cell.selected'),
      hints: document.querySelectorAll('.cell.can-move, .cell.can-capture').length
    };
  `);
  check('选子后高亮落点', sel.selected && sel.hints > 0, `高亮 ${sel.hints} 处`);

  await click(6, 7);

  // 3. AI 应招
  await waitFor("window.doushouqi.history().length >= 2", 'AI 落子', 12000);
  const afterAI = await evaluate(`
    const h = window.doushouqi.history();
    return {
      ply: h.length,
      first: h[0].side,
      second: h[1].side,
      turn: window.doushouqi.state().turn,
      title: document.getElementById('statusTitle').textContent,
      depth: document.getElementById('statDepth').querySelector('strong').textContent,
      nodes: document.getElementById('statNodes').querySelector('strong').textContent,
      record: document.querySelectorAll('.move-item').length
    };
  `);
  check('AI 自动应招', afterAI.ply === 2 && afterAI.first === 'red' && afterAI.second === 'blue',
    JSON.stringify(afterAI));
  check('回到红方回合', afterAI.title.includes('红方'), afterAI.title);
  check('棋谱记录 2 条', afterAI.record === 2);
  check('AI 统计有数据', afterAI.depth !== '—' && afterAI.nodes !== '—', `深度 ${afterAI.depth} / 节点 ${afterAI.nodes}`);

  // 4. 悔棋：应该把 AI 那步和我的那步一起撤掉
  await evaluate(`document.getElementById('undoButton').click(); return true;`);
  await waitFor("window.doushouqi.history().length === 0", '悔棋回到开局', 4000);
  const afterUndo = await evaluate(`
    return {
      ply: window.doushouqi.history().length,
      turn: window.doushouqi.state().turn,
      pieces: document.querySelectorAll('.piece').length,
      record: document.querySelectorAll('.move-item').length
    };
  `);
  check('悔棋撤销两手', afterUndo.ply === 0 && afterUndo.turn === 'red' && afterUndo.pieces === 16,
    JSON.stringify(afterUndo));

  // 5. 切难度
  await evaluate(`document.querySelector('.level-button[data-level="master"]').click(); return true;`);
  const lv = await evaluate(`
    return {
      active: document.querySelector('.level-button.is-active').dataset.level,
      level: window.doushouqi.level(),
      saved: localStorage.getItem('dsq.level')
    };
  `);
  check('难度切换并持久化', lv.active === 'master' && lv.level === 'master' && lv.saved === 'master',
    JSON.stringify(lv));
  await evaluate(`document.querySelector('.level-button[data-level="normal"]').click(); return true;`);

  // 6. 走完一局：脚本替红方选步，蓝方仍由页面自己的 AI 应招
  await evaluate(`document.querySelector('.level-button[data-level="easy"]').click(); return true;`);
  let plies = 0;
  for (let i = 0; i < 90; i++) {
    const st = await evaluate(`return { result: window.doushouqi.result(), turn: window.doushouqi.state().turn,
                                       ply: window.doushouqi.history().length };`);
    if (st.result) break;
    if (st.turn !== 'red') { await sleep(200); continue; }
    const mv = await evaluate(`
      const mv = window.DSQ.searchMove(window.doushouqi.state(), { timeMs: 60, maxDepth: 4 });
      return mv ? { from: mv.from, to: mv.to } : null;
    `);
    if (!mv) break;
    await click(mv.from.x, mv.from.y);
    await click(mv.to.x, mv.to.y);
    // 等这一来一回落定（红一步 + 蓝一步），或者对局结束
    await waitFor(`window.doushouqi.history().length >= ${st.ply + 2} || window.doushouqi.result()`, '一回合落定', 12000).catch(() => {});
    plies = st.ply + 2;

    if (plies === 10) {
      const mid = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(shotPath('shot-mid.png'), Buffer.from(mid.data, 'base64'));
    }
  }
  const over = await evaluate(`
    return { result: window.doushouqi.result(), overlay: !document.getElementById('resultOverlay').hidden,
             title: document.getElementById('statusTitle').textContent,
             seal: document.getElementById('resultSeal').textContent };
  `);
  check('对局能正常结束并弹出结算', !!over.result && over.overlay,
    `第 ${plies} 手 · ${over.title} · 印"${over.seal}" · ${over.result?.reason || ''}`);

  // 7. 再来一局
  await evaluate(`document.getElementById('playAgainButton').click(); return true;`);
  await sleep(300);
  const restarted = await evaluate(`
    return { ply: window.doushouqi.history().length, pieces: document.querySelectorAll('.piece').length,
             overlay: document.getElementById('resultOverlay').hidden };
  `);
  check('再来一局重置', restarted.ply === 0 && restarted.pieces === 16 && restarted.overlay,
    JSON.stringify(restarted));

  // 8. 截图：桌面 + 手机宽度
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(shotPath('shot-play.png'), Buffer.from(shot.data, 'base64'));

  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  });
  await sleep(600);
  const mobileLayout = await evaluate(`
    const board = document.querySelector('.board').getBoundingClientRect();
    const panel = document.querySelector('.side-panel').getBoundingClientRect();
    return {
      boardW: Math.round(board.width),
      boardH: Math.round(board.height),
      panelBelow: panel.top > board.bottom - 5,
      overflow: document.documentElement.scrollWidth - window.innerWidth
    };
  `);
  check('手机宽度下棋盘不溢出', mobileLayout.boardW <= 390 && mobileLayout.boardH <= 700 &&
    mobileLayout.overflow <= 1 && mobileLayout.panelBelow, JSON.stringify(mobileLayout));

  const mobileShot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(shotPath('shot-mobile.png'), Buffer.from(mobileShot.data, 'base64'));
  await send('Emulation.clearDeviceMetricsOverride');

  console.log('\n✓ 端到端全部通过');
} catch (error) {
  console.error('\n✗ ' + error.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  try { child.kill(); } catch {}
  await sleep(500);
}
