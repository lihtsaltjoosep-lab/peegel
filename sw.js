// sw.js v111 - Ultra Stability
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));

self.addEventListener('message', (event) => {
    if (event.data === 'STAY_ALIVE') {
        // Hoiab SW protsessi aktiivsena läbi sündmuste ahela
    }
});

setInterval(() => {
    self.clients.matchAll().then(clients => {
        clients.forEach(client => {
            client.postMessage({ type: 'HEARTBEAT', timestamp: Date.now() });
        });
    });
}, 10000);
