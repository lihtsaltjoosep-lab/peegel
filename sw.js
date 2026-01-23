self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));

// See hoiab protsessi ärvel, vastates tühjadele päringutele
self.addEventListener('fetch', (event) => {
    event.respondWith(fetch(event.request));
});
