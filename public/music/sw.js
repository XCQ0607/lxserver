const CACHE_NAME = 'lx-music-web-v26';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './login.html',
    './app.js',
    // CSS
    './css/theme_variables.css',
    './assets/fontawesome/css/all.min.css',
    // 核心 JS
    './js/lyric-parser.js',
    './js/lyric-utils.js',
    './js/lyric-card.js',
    './js/quality.js',
    './js/idb_store.js',
    './js/user_sync.js',
    './js/batch_pagination.js',
    './js/single_song_ops.js',
    './js/songlist_manager.js',
    './js/list_search.js',
    './js/leaderboard_manager.js',
    './js/local_music.js',
    './js/download_manager.js',
    './js/common_ui.js',
    './js/pwa.js',
    './js/theme_manager.js',
    './js/tailwind_setup.js',
    './js/log_viewer.js',
    './js/ios-background-audio.js',
    // 第三方库
    './assets/tailwindcss.js',
    './js/crypto-js.min.js',
    './js/NoSleep.min.js',
    './js/Sortable.min.js',
    './js/marked.min.js',
    // 音频效果
    './js/sound-effects.js',
    './js/visualizer.js',
    './js/wave.js',
    // 变调器
    './js/pitch-shifter/fft.js',
    './js/pitch-shifter/ola-processor.js',
    './js/pitch-shifter/phase-vocoder.js',
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
    if (!url.protocol.startsWith('http')) return;

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
                return caches.match(event.request);
            })
    );
});

const KNOWN_CACHES = [CACHE_NAME];

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (!KNOWN_CACHES.includes(cacheName)) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});
