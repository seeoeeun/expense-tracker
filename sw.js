self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('expense-sync-v1').then(cache => cache.addAll([
      './',
      './index.html',
      './app.js',
      './config.js',
      './manifest.webmanifest',
      './icons/icon-192.png',
      './icons/icon-512.png'
    ]))
  );
});
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (event) => {
  event.respondWith(caches.match(event.request).then(resp => resp || fetch(event.request)));
});
