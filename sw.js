// sw.js
const CACHE = 'expense-sync-v6'; // 숫자 올리기(v5 -> v6)

self.addEventListener('install', (event) => {
  // 새 워커를 즉시 대기상태 건너뛰고 활성화 준비
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll([
      './',
      './index.html',
      './styles.css',
      './app.js',
      './config.js',
      './manifest.webmanifest',
      './icons/icon-192.png',
      './icons/icon-512.png'
    ]))
  );
});

self.addEventListener('activate', (event) => {
  // 기존 캐시 정리 + 새 워커를 즉시 모든 탭에 적용
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then(resp => resp || fetch(event.request))
  );
});
