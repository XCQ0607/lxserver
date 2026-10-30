const CACHE_NAME = 'lx-music-web-v58';
// Refresh cached assets after organizing JavaScript modules by feature.
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './login.html',
    './app.js',
    // CSS
    './css/theme_variables.css',
    './css/utilities.css',
    './css/app.css',
    './js/library/search_requests.js',
    './js/ui/ui_accessibility.js',
    './assets/fontawesome/css/all.min.css',
    // 核心 JS
    './js/lyrics/lyric-parser.js',
    './js/lyrics/lyric-utils.js',
    './js/player/quality.js',
    './js/core/idb_store.js',
    './js/sync/user_sync.js',
    './js/ui/batch_pagination.js',
    './js/library/single_song_ops.js',
    './js/library/songlist_manager.js',
    './js/library/list_search.js',
    './js/library/leaderboard_manager.js',
    './js/library/dislike_manager.js',
    './js/local/local_music.js',
    './js/download/download_manager.js',
    './js/ui/common_ui.js',
    './js/core/pwa.js',
    './js/ui/theme_manager.js',
    './js/ui/log_viewer.js',
    './js/player/ios-background-audio.js',
    './js/player/airplay.js',
    './js/player/playback.js',
    './js/player/chromecast.js',
    // 第三方库
    './js/vendor/crypto-js.min.js',
    './js/vendor/NoSleep.min.js',
    './js/vendor/Sortable.min.js',
    './js/vendor/marked.min.js',
    // 音频效果
    './js/player/sound-effects.js',
    './js/player/visualizer.js',
    './js/vendor/wave.js',
    // 变调器
    './js/player/pitch-shifter/fft.js',
    './js/player/pitch-shifter/ola-processor.js',
    './js/player/pitch-shifter/phase-vocoder.js',
    // 静态资源
    './assets/logo.svg',
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
    const url = new URL(event.request.url);

    // 1. 过滤非 http(s) 协议 (如 chrome-extension://)，避免 cache.put 报错
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== self.location.origin) return;

    // 2. 忽略所有音频请求、下载请求、API 请求以及动态配置接口，让浏览器直接处理
    // 拦截下载会导致大文件占用 Cache 且单个失败可能引起 SW state 不良
    const isApiOrAudio = url.pathname.includes('/api/') ||
        url.pathname === '/js/config.js' ||
        url.pathname.endsWith('/manifest.json') ||
        url.href.match(/\.(mp3|flac|m4a|ogg|aac)(\?.*)?$/i);

    if (isApiOrAudio) {
        return; // 直接 return 就不走 event.respondWith，相当于不拦截
    }

    // 3. 常规静态资源采用 Network First 策略
    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // 如果请求成功，更新缓存并返回
                if (response && response.status === 200 && response.type === 'basic') {
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache).catch(err => {
                            console.error('[SW] Cache put error:', err);
                        });
                    });
                }
                return response;
            })
            .catch(() => {
                // 网络不可用时，尝试从缓存获取
                return caches.open(CACHE_NAME).then(cache => cache.match(event.request)).then(response => response || new Response('Offline', { status: 503 }));
            })
    );
});

const KNOWN_CACHES = [CACHE_NAME];

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName.startsWith('lx-music-web-') && !KNOWN_CACHES.includes(cacheName)) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});
