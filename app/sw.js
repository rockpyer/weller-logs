// Offline cache for the app shell. Bump VERSION on every release so clients refresh.
const VERSION = 'weller-v2';
const SHELL = ['./', './index.html', './synth.js', './js/points.js', './js/map.js', './js/stats.js', './js/core.js', './vendor/d3.min.js', './vendor/leaflet.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Network first for same-origin shell files (fresh deploys win), cache fallback when offline. CDN scripts: cache after first success.
  e.respondWith(fetch(e.request).then(r => { if (r.ok && (new URL(e.request.url).origin === location.origin || /cdnjs\.cloudflare\.com/.test(e.request.url))) caches.open(VERSION).then(c => c.put(e.request, r.clone())); return r; })
    .catch(() => caches.match(e.request).then(m => m || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined))));
});
