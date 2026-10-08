// EDITFLOW の service worker：画面の部品は先に覚えておき、データ（GitHub の API）は取りに行けなければ最後に読んだものを出す
const 版 = 'editflow-v2.0-1';
const 部品 = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(版).then(c => c.addAll(部品)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== 版 && k !== 'editflow-data').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.hostname === 'api.github.com') {
    // データ：まず取りに行く。取れたら覚え、取れなければ覚えたものを出す（オフラインでも最後に読んだデータで開く）
    e.respondWith(fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open('editflow-data').then(k => k.put(r.url, c)); } return res; })
      .catch(() => caches.open('editflow-data').then(k => k.match(r.url)).then(m => m || new Response('', { status: 503 }))));
    return;
  }
  if (u.origin === location.origin) {
    // 画面の部品：まず取りに行き（新しい版を早く届ける）、取れなければ覚えたもの
    e.respondWith(fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(版).then(k => k.put(r, c)); } return res; })
      .catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match('index.html'))));
  }
});
