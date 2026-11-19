// INDAI website service worker: offline shell + always-fresh app files.
// Market data, the backend and the voice models' downloads go straight to the network
// (the models are kept by the browser's own model cache after the first download).
const CACHE = 'indai-web-v1';
// The on-device voice runtime (about 24 MB) is kept in its own cache so it is downloaded once and works offline.
// sync.sh changes this name whenever those files change, which makes browsers fetch the new ones.
const VOICE = 'indai-web-voice-17629cb';
const SHELL = ['./', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/views.js', './js/sheets.js', './js/chart.js', './js/demo.js', './js/hud.js', './js/panels.js',
  './js/feeds.js', './js/market.js', './js/store.js', './js/indai.js', './js/voice.js', './js/relay.js', './js/options.js', './js/analysis.js', './js/speech.js', './js/signals.js',
  './fonts/geist.woff2', './fonts/geist-mono.woff2', './brand/indai-logo.png', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('indai-web-') && k !== CACHE && k !== VOICE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// Cross-origin isolation: with these headers the browser lets the voice models run on several CPU cores
// (about 3x faster listening and speaking). Browsers that don't know "credentialless" ignore it.
function isolate(res) {
  if (!res || res.status === 0 || res.type === 'opaque' || res.type === 'opaqueredirect') return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'credentialless');
  h.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // The big on-device voice runtime: from its cache when we have it, otherwise the network (and keep a copy).
  if (url.pathname.includes('/vendor/ort/') || url.pathname.endsWith('voice-worker.js')) {
    e.respondWith(caches.open(VOICE).then(c => c.match(e.request).then(hit => hit ? isolate(hit) : fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return isolate(res); }))));
    return;
  }
  // Network first, always revalidated, so a new version shows up on the very next launch; the cache is the offline fallback.
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return isolate(res); })
      .catch(() => caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' }).then(r => r ? isolate(r) : (e.request.mode === 'navigate' ? caches.match('./index.html').then(isolate) : Response.error())))
  );
});
