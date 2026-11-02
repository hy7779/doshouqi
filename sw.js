/* 游艺场 Service Worker：外壳预缓存 + 导航兜底 */
const VERSION = 'youyi-v2';
const CACHE = `youyi-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './monopoly.html',
  './monopoly.js',
  './monopoly-engine.mjs',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './webrtc.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const base = self.registration.scope;
    // 逐个添加：单个文件失败（比如首次部署缺图标）不拖垮整个安装
    await Promise.all(SHELL.map(async (url) => {
      const abs = new URL(url, base).href;
      try {
        const res = await fetch(new Request(abs, { cache: 'reload' }));
        if (res && res.ok) await cache.put(abs, res.clone());
      } catch (_) { /* 忽略单个失败 */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (!isSameOrigin(url)) return; // 跨域（PeerJS 等）交给网络

  // 页面导航：先网络，失败再回缓存
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (_) {
        const cache = await caches.open(CACHE);
        return (await cache.match(req))
          || (await cache.match(new URL('./index.html', self.registration.scope).href))
          || Response.error();
      }
    })());
    return;
  }

  // 静态资源：缓存优先，后台更新
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return hit || (await network) || Response.error();
  })());
});
