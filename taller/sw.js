// Mínimo para que el panel se pueda instalar en la pantalla de inicio. No guarda
// nada en caché: el panel siempre trae los datos frescos de la red.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
