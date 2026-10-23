const CACHE_NAME = 'reza-chat-shell-v52';
const SHELL_FILES = [
    './',
    './index.html',
    './style.css?v=52',
    './script.js?v=52',
    './naz-tools.js?v=39',
    './cloud-config.js?v=34',
    './manifest.webmanifest',
    './icons/reza-chat-192.png',
    './icons/reza-chat-512.png'
];

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await Promise.all(SHELL_FILES.map(async path => {
            const request = new Request(new URL(path, self.registration.scope), { cache: 'reload' });
            try {
                const response = await fetch(request);
                if (response.ok && response.type !== 'opaque') await cache.put(request, response);
            } catch {
                // Keep install resilient; each asset is cached when it is first requested online.
            }
        }));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter(name => name.startsWith('reza-chat-shell-') && name !== CACHE_NAME).map(name => caches.delete(name)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    if (request.mode === 'navigate') {
        event.respondWith((async () => {
            try {
                const response = await fetch(request);
                if (response.ok) {
                    const cache = await caches.open(CACHE_NAME);
                    await cache.put(new URL('./index.html', self.registration.scope), response.clone());
                }
                return response;
            } catch {
                return (await caches.match(new URL('./index.html', self.registration.scope))) || Response.error();
            }
        })());
        return;
    }

    const appRoot = new URL(self.registration.scope).pathname;
    if (!url.pathname.startsWith(appRoot) || !/\.(?:html|css|js|webmanifest|png|svg|ico)$/i.test(url.pathname)) return;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        const network = fetch(request).then(response => {
            if (response.ok && response.type !== 'opaque') void cache.put(request, response.clone());
            return response;
        }).catch(() => null);
        return cached || await network || Response.error();
    })());
});
