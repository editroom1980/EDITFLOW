// ながら宅トレの service worker：画面を覚えておき、電波が無くても開けるようにする。新しい版は次に開いたときに入れ替わる
const 版 = 'nagara-800dfef9';
const 部品 = ['./', 'index.html', 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(版).then(c => c.addAll(部品)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('nagara-') && k !== 版).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin || !u.pathname.includes('/training/')) return;   // 字体などはそのまま取りに行く
  // 画面は「まず取りに行き、だめなら覚えた分」。新しい版がすぐ届くように
  e.respondWith(fetch(r).then(res => { const c = res.clone(); caches.open(版).then(x => x.put(r, c)); return res; })
    .catch(() => caches.match(r, {ignoreSearch: true}).then(m => m || caches.match('index.html'))));
});
