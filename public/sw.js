// Offline shell cache. API calls always go to the network.
const CACHE = 'transportar-v3';
const SHELL = ['/', '/index.html', '/styles.css', '/vendor/qrcode.js', '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css',
  '/core/util.js', '/core/pricing.js', '/core/dispatch.js', '/core/nlp.js', '/core/analytics.js', '/core/core.js',
  '/js/i18n.js', '/js/base.js', '/js/map.js', '/js/book.js', '/js/track.js', '/js/driver.js', '/js/admin.js', '/js/platform.js', '/js/main.js',
  '/icons/icon.svg', '/icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  // Network first so updates show up right away; fall back to cache offline.
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok && url.origin === location.origin) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('/index.html'))));
});
