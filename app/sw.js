// Offline cache for the app shell. Bump VERSION on every release so clients refresh.
const VERSION = 'weller-v25';
const SHELL = ['./', './index.html', './synth.js', './js/apicodes.js', './js/las.js', './js/qc.js', './js/petro.js', './js/tables.js', './js/survey.js', './js/grid.js', './js/points.js', './js/map.js', './js/stats.js', './js/interp.js', './js/zip.js', './js/views.js', './js/core.js', './js/tools.js', './js/mudcal.js', './js/mudlog.js', './js/mudworker.js', './vendor/d3.min.js', './vendor/leaflet.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// Files that never change at their URL (versioned CDN libraries, vendor copies, example data) come from the cache
// first: no network round trip on reload. App code stays network first, so a fresh deploy wins. The example data
// counts as fixed between releases; bumping VERSION clears it.
const FIXED = /cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com|\/vendor\/|\/data\/niobrara\//;
const keep = (req, r) => { if ((r.ok || (r.type === 'opaque' && FIXED.test(req.url))) && (new URL(req.url).origin === location.origin || FIXED.test(req.url))) { const c = r.clone(); caches.open(VERSION).then(k => k.put(req, c)); } return r; };
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (FIXED.test(e.request.url)) { e.respondWith(caches.match(e.request).then(m => m || fetch(e.request).then(r => keep(e.request, r)))); return; }
  e.respondWith(fetch(e.request).then(r => keep(e.request, r))
    .catch(() => caches.match(e.request).then(m => m || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined))));
});
