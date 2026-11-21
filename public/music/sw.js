/*
 * Service Worker — 仅负责清理历史缓存，不再拦截任何网络请求。
 *
 * 背景（2026-11-20 定位）：旧版本对同域所有 GET 做 Network First +
 * response.clone() + cache.put()。实测在部分网络环境下，clone 的响应体
 * 长期不被读取，会占住（泄漏）同域的 HTTP/1.1 连接；6 条连接被占满后，
 * 页面发出的所有请求（verify、封面、音频、CSS）都在浏览器侧排队 5~31 秒
 * 发不出去 —— 表现为「服务端连接中断，正在等待重连」、封面不显示、
 * 播放失败自动切歌。而服务器日志显示这些请求根本没到达 nginx。
 *
 * 因此这里彻底放弃 SW 缓存：静态资源交给浏览器 HTTP 缓存，API/音频直连。
 */
const CACHE_NAME = 'lx-music-web-v72';
const LEGACY_PREFIX = 'lx-music-web-';

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        try {
            const names = await caches.keys();
            await Promise.all(
                names
                    .filter((name) => name.startsWith(LEGACY_PREFIX) && name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        } catch (e) {
            // 清理失败不影响后续流程
        }
        try { await self.clients.claim(); } catch (e) { /* ignore */ }
    })());
});

// 不注册 fetch 监听器：所有请求由浏览器直接走网络/HTTP 缓存，互不阻塞。
