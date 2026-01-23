// sw.js - Peegel Pro Stability Engine
const CACHE_NAME = 'peegel-v121';
const ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

// Installimine ja failide puhverdamine
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Aktiveerimine ja vana vahemälu puhastus
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
});

// Sidetee hoidmine põhiäpiga (Ping-Pong loogika)
self.addEventListener('message', (event) => {
  if (event.data.type === 'PING') {
    event.source.postMessage({ type: 'PONG' });
  }
});

// Fetch handler on vajalik PWA installimiseks
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
