// sw.js - Peegel Pro Stability Engine
const CACHE_NAME = 'peegel-v33-bg';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

// See hoiab workerit elus
self.addEventListener('message', (event) => {
    if (event.data.type === 'PING') {
        event.source.postMessage({ type: 'PONG' });
    }
});

self.addEventListener('fetch', (event) => {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
