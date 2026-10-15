// EDITFLOW の service worker：画面の部品は先に覚えておき、データ（GitHub の API）は取りに行けなければ最後に読んだものを出す
const 版 = 'editflow-v2.5-0';
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

// ── 通知（Web Push）。EDITFLOW-data の GitHub Actions が送る。中身は {title, body, url, badge} ──
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'EDITFLOW', body: e.data ? e.data.text() : '' }; }
  const 札 = self.navigator && self.navigator.setAppBadge && d.badge != null
    ? (d.badge ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge()).catch(() => { }) : Promise.resolve();
  e.waitUntil(Promise.all([札, self.registration.showNotification(d.title || 'EDITFLOW', { body: d.body || '', data: { url: d.url || './' }, icon: 'icon-192.png', tag: d.title || 'editflow' })]));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if ('focus' in c) { if ('navigate' in c) c.navigate(url).catch(() => { }); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
