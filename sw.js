// 앱 화면 파일을 휴대폰에 저장해 두고 바로 띄운다(기록 데이터는 여기서 다루지 않음).
// 배포할 때마다 VERSION을 바꾸면 새 파일 묶음을 통째로 받아 한 번에 교체한다(옛 파일과 섞이지 않게).
const VERSION = 'v20261104-135322';
const SHELL = ['./', 'index.html', 'style.css', 'config.js', 'art.js', 'demo.js', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION)
    .then((c) => Promise.all(SHELL.map((u) => fetch(u, { cache: 'no-cache' }).then((res) => { if (!res.ok) throw new Error(u); return c.put(u, res); }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    return hit || fetch(e.request);
  }));
});
