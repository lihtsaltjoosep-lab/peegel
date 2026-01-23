// sw.js - v108 Ping-Pong
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));

// See intervall hoiab Service Workeri ärvel
setInterval(() => {
    self.clients.matchAll().then(clients => {
        clients.forEach(client => {
            client.postMessage({ type: 'PING' }); // Saadab äpile "koputuse"
        });
    });
}, 20000); // Iga 20 sekundi järel
