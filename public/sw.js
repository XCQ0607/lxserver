const CACHE_NAME = 'lx-sync-server-v5';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './css/tokens.css',
    './css/dashboard.css',
    './theme.js',
    './dash.js',
    './app.js',
    './js/ui-utils.js',
    './js/notification-engine.js',
    './icon.svg',
    './manifest.json',
    './vendor/js/marked.min.js',
    './vendor/fonts/inter.css',
    './music/assets/tailwindcss.js',
    './music/assets/fontawesome/css/all.min.css'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    // Only cache GET requests
    if (event.request.method !== 'GET') return;
    if (!event.request.url.startsWith('http')) return;

    // [Fix] Do not cache API requests
    if (event.request.url.includes('/api/')) return;
    // [Fix] Do not cache Music Player files (dev mode)
    if (event.request.url.includes('/music/')) return;

    // [Fix] Do not cache external resources (CDN, placeholders, etc.)
    const url = new URL(event.request.url);
    if (url.origin !== location.origin) return;

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // 如果请求成功，更新缓存并返回
                if (response && response.status === 200 && response.type === 'basic') {
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return response;
            })
            .catch(() => {
                // 网络不可用时，尝试从缓存获取
                return caches.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) return cachedResponse;
                    throw new Error('Network failed and no cache available');
                });
            }).catch((error) => {
                console.error('[SW] Fetch failed:', event.request.url, error);
                return new Response('Network error', {
                    status: 408,
                    statusText: 'Request Timeout'
                });
            })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName.startsWith('lx-sync-server-') && cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});
