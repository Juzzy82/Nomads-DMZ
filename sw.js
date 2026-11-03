/* NOMADS DMZ HUB app helper (service worker).
   Pages and files load from the internet first, so updates show straight away; a copy is kept on the device
   and used when the connection is slow (over 4 seconds) or offline. Logins, saved progress and the live boxes
   (/api/ and /auth/) always go straight to the internet and are never stored. */
const CACHE = 'nomads-dmz-v1';
const TIMEOUT_MS = 4000;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
const skip = (url, req) => req.method !== 'GET' || url.origin !== self.location.origin || /^\/(api|auth|patch-admin)(\/|$)/.test(url.pathname) || url.pathname === '/sw.js';
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (skip(url, e.request)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const net = fetch(e.request).then((r) => { if (r && r.ok && r.type === 'basic') cache.put(e.request, r.clone()).catch(() => {}); return r; });
    const slow = new Promise((res) => setTimeout(res, TIMEOUT_MS, 'slow'));
    try {
      const first = await Promise.race([net, slow]);
      if (first !== 'slow') return first;
      const saved = await cache.match(e.request, { ignoreSearch: e.request.mode === 'navigate' });
      return saved || await net;
    } catch (err) {
      const saved = await cache.match(e.request, { ignoreSearch: e.request.mode === 'navigate' }) || (e.request.mode === 'navigate' ? await cache.match('/') : null);
      if (saved) return saved;
      throw err;
    }
  })());
});
