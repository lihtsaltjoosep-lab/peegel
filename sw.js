self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  // See on vajalik, et Chrome peaks äppi offline-võimeliseks
  event.respondWith(
    fetch(event.request).catch(() => {
      return new Response("Offline mode active");
    })
  );
});
