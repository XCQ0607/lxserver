/**
 * Download Manager for LX Server Web Frontend
 * Manages parallel downloads, progress tracking, pausing, resuming, retries using Fetch + ReadableStream.
 */

class DownloadManager {
    constructor() {
        this.tasks = []; // Queue of tasks
        this.maxConcurrent = this.normalizeConcurrency(window.settings?.downloadConcurrency);
        this.activeCount = 0; // Currently active (local downloading + triggered server tasks)

        // UI Elements
        this.drawer = document.getElementById('download-drawer');
        this.listContainer = document.getElementById('download-list-container');
        this.globalSpeedEl = document.getElementById('download-global-speed');
        this.progressTextEl = document.getElementById('download-progress-text');
        this.renderBuffer = 12;
        this.estimatedTaskHeight = 92;
        this.renderedRange = { start: 0, end: 0 };
        this.scrollRenderRaf = null;
        this.serverPollInFlight = false;
        this.serverQueueSyncInFlight = false;
        this.serverQueuePending = false;
        this.serverQueueLoaded = false;

        // Speed calculation
        this.lastTotalBytes = 0;
        this.lastTime = Date.now();
        this.speedInterval = setInterval(() => this.updateGlobalSpeed(), 1000);

        // [New] Poll for server-side caching progress
        this.serverPollInterval = setInterval(() => this.pollServerProgress(), 2000);

        if (this.listContainer) {
            this.listContainer.addEventListener('scroll', () => this.scheduleScrollRender());
        }

        // Restore tasks from sessionStorage
        this.restoreTasks();
        setTimeout(() => this.syncServerConcurrency(), 300);
        setTimeout(() => this.syncServerQueue(true), 500);
    }

    async mapWithConcurrency(items, limit, mapper) {
        const results = new Array(items.length);
        let nextIndex = 0;
        const workerCount = Math.min(limit, items.length);
        const workers = Array.from({ length: workerCount }, async () => {
            while (nextIndex < items.length) {
                const index = nextIndex++;
                results[index] = await mapper(items[index], index);
            }
        });
        await Promise.all(workers);
        return results;
    }

    extractRawDownloadUrl(url) {
        if (!url) return url;
        try {
            const parsedUrl = new URL(url, window.location.origin);
            if (parsedUrl.origin !== window.location.origin || parsedUrl.pathname !== '/api/music/download') return url;
            const proxyParams = parsedUrl.searchParams;
            const extracted = proxyParams.get('url');
            if (!extracted) return url;
            if (extracted.startsWith('http')) return extracted;
            const decoded = decodeURIComponent(extracted);
            return decoded.startsWith('http') ? decoded : extracted;
        } catch (e) {
            return url;
        }
    }

    shouldUseNativeDownload(batchSize, quality) {
        const memoryHeavyQualities = ['flac', 'flac24bit', 'hires', 'atmos', 'atmos_plus', 'master'];
        return batchSize > 1 || memoryHeavyQualities.includes(quality);
    }

    triggerNativeDownload(url, filename) {
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.rel = 'noopener';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    getDownloadExtension(url, quality) {
        try {
            const pathname = new URL(url, window.location.origin).pathname;
            const match = pathname.match(/\.([a-z0-9]{2,5})$/i);
            if (match && ['mp3', 'flac', 'm4a', 'ogg', 'wav', 'ape'].includes(match[1].toLowerCase())) {
                return match[1].toLowerCase();
            }
        } catch (e) { }

        if (quality === '128k' || quality === '192k' || quality === '320k') return 'mp3';
        if (quality === 'atmos' || quality === 'atmos_plus') return 'm4a';
        if (['flac', 'flac24bit', 'hires', 'master'].includes(quality)) return 'flac';
        return 'mp3';
    }

    // Update max concurrency limit dynamically
    updateMaxConcurrent(value) {
        this.maxConcurrent = this.normalizeConcurrency(value);
        console.log('[DownloadManager] Concurrency limit updated to:', this.maxConcurrent);
        this.syncServerConcurrency();
        this.processQueue();
    }

    async syncServerConcurrency() {
        try {
            await this.requestServerQueue('/api/music/cache/queue/concurrency', { concurrency: this.maxConcurrent });
        } catch (error) {
            console.warn('[DownloadManager] Failed to sync server concurrency:', error);
        }
    }

    normalizeConcurrency(value) {
        const parsed = parseInt(value, 10);
        if (!Number.isFinite(parsed)) return 3;
        return Math.min(5, Math.max(1, parsed));
    }

    getDownloadResolver() {
        return window.resolveDownloadSongUrl || window.resolveSongUrl;
    }

    getServerQueueHeaders() {
        return { 'Content-Type': 'application/json', ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {}) };
    }

    async requestServerQueue(path, body) {
        const options = { method: body === undefined ? 'GET' : 'POST', headers: this.getServerQueueHeaders() };
        if (body !== undefined) options.body = JSON.stringify(body);
        const response = await fetch(path, options);
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.success === false) throw new Error(result.message || `HTTP ${response.status}`);
        return result.data;
    }

    async enqueueServerTasks(tasks) {
        if (!tasks.length) return;
        this.serverQueuePending = true;
        try {
            const headers = this.getServerQueueHeaders();
            const payload = {
                concurrency: this.maxConcurrent,
                tasks: tasks.map(task => ({
                    id: task.id,
                    songInfo: this.getSongInfoForServer(task.song),
                    quality: task.quality,
                    enableOnlyDownloadMode: window.settings?.enableOnlyDownloadMode || false,
                    cacheLyric: window.settings?.enableServerLyricCache !== false,
                    embedLyric: !!(window.settings?.embedLyricToFile ?? true)
                }))
            };
            if (headers['x-frontend-auth'] && window.settings?.serverCacheNamingPattern) {
                payload.namingPattern = window.settings.serverCacheNamingPattern;
            }
            await this.requestServerQueue('/api/music/cache/queue', payload);
            tasks.forEach(task => {
                task.serverManaged = true;
                task.serverQueueRegistered = true;
                task.serverQueueId = task.id;
                task.status = 'waiting';
                task.errorMsg = '';
            });
            await this.syncServerQueue(true);
        } catch (error) {
            tasks.forEach(task => {
                task.serverQueueRegistered = false;
                task.status = 'error';
                task.errorMsg = error.message || '服务器队列登记失败';
            });
            this.renderList();
            this.saveTasks();
        } finally {
            this.serverQueuePending = false;
        }
    }

    async syncServerQueue(render = false) {
        if (this.serverQueueSyncInFlight) return;
        this.serverQueueSyncInFlight = true;
        try {
            const items = await this.requestServerQueue('/api/music/cache/queue');
            if (!Array.isArray(items)) return;
            const remoteIds = new Set();
            const updatedTasks = [];
            items.forEach(item => {
                remoteIds.add(item.id);
                let task = this.tasks.find(t => t.isServer && (t.serverQueueId === item.id || t.id === item.id));
                if (!task) {
                    task = {
                        id: item.id,
                        song: item.songInfo || {},
                        isServer: true,
                        serverManaged: true,
                        serverQueueRegistered: true,
                        serverQueueId: item.id,
                        serverSongKey: item.songKey || '',
                        quality: item.quality || item.requestedQuality || '',
                        status: item.status || 'waiting',
                        progress: item.progress || 0,
                        downloadedBytes: item.received || 0,
                        totalBytes: item.total || 0,
                        speed: item.speed || 0,
                        errorMsg: item.errorMsg || '',
                        retryCount: 0,
                        maxRetries: 2,
                        controller: null
                    };
                    this.tasks.push(task);
                } else {
                    task.song = item.songInfo || task.song;
                    task.serverManaged = true;
                    task.serverQueueRegistered = true;
                    task.serverQueueId = item.id;
                    task.serverSongKey = item.songKey || task.serverSongKey;
                    task.quality = item.quality || task.quality;
                    task.status = item.status || task.status;
                    task.progress = item.progress || 0;
                    task.downloadedBytes = item.received || 0;
                    task.totalBytes = item.total || 0;
                    task.speed = item.speed || 0;
                    task.errorMsg = item.errorMsg || '';
                }
                updatedTasks.push(task);
            });
            if (!this.serverQueuePending) {
                this.tasks = this.tasks.filter(task => !task.serverManaged || remoteIds.has(task.serverQueueId || task.id));
            }
            this.serverQueueLoaded = true;
            if (render) this.renderList();
            else updatedTasks.forEach(task => this.renderTask(task));
            this.saveTasks();
        } catch (error) {
            console.warn('[DownloadManager] Failed to sync server queue:', error);
        } finally {
            this.serverQueueSyncInFlight = false;
        }
    }

    normalizeServerSongId(songInfo) {
        let id = String(songInfo?.songmid || songInfo?.songId || songInfo?.id || '');
        const source = songInfo?.source || 'unknown';
        if (id && !id.includes('_') && source !== 'unknown') {
            id = `${source}_${id}`;
        }
        return id;
    }

    getSongIdentity(songInfo) {
        const meta = songInfo?.meta || {};
        const source = songInfo?.source || meta.source || 'unknown';
        const id = songInfo?.songmid || songInfo?.songId || meta.songmid || meta.songId ||
            songInfo?.id || songInfo?.hash || songInfo?.copyrightId || songInfo?.mid ||
            songInfo?.mediaMid || songInfo?.strMediaMid;
        if (id !== undefined && id !== null && id !== '') return `${source}:${id}`;

        return `${source}:${songInfo?.name || ''}:${songInfo?.singer || ''}:${songInfo?.albumName || ''}:${songInfo?.interval || ''}`;
    }

    getServerSongKey(songInfo, quality) {
        return `${this.normalizeServerSongId(songInfo)}_${quality || 'unknown'}`;
    }

    getTaskServerSongKey(task) {
        if (!task) return '';
        if (task.serverSongKey) return task.serverSongKey;
        const key = this.getServerSongKey(task.song || {}, task.quality);
        if (key && !key.startsWith('_')) return key;
        return task.id ? task.id.replace(/^server_(batch_)?/, '') : '';
    }

    createTaskId(prefix = 'dl') {
        const cryptoObj = window.crypto || window.msCrypto;
        if (cryptoObj?.randomUUID) return `${prefix}_${cryptoObj.randomUUID()}`;
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }

    async waitForDownloadResolver(timeoutMs = 10000) {
        const resolver = this.getDownloadResolver();
        if (typeof resolver === 'function') return resolver;

        const startedAt = Date.now();
        return new Promise((resolve, reject) => {
            const timer = setInterval(() => {
                const currentResolver = this.getDownloadResolver();
                if (typeof currentResolver === 'function') {
                    clearInterval(timer);
                    resolve(currentResolver);
                    return;
                }
                if (Date.now() - startedAt >= timeoutMs) {
                    clearInterval(timer);
                    reject(new Error('resolveSongUrl missing'));
                }
            }, 50);
        });
    }

    shouldAutoSyncLyric(task) {
        return !!(
            task &&
            task.isServer &&
            task.status === 'finished' &&
            window.requestServerLyricCache &&
            window.settings?.enableServerLyricCache !== false &&
            window.settings?.enableOnlyDownloadMode !== true
        );
    }

    completeServerTask(task, status = 'finished') {
        task.status = status;
        task.progress = 100;
        task.errorMsg = '';
        task.speed = 0;

        if (this.shouldAutoSyncLyric(task)) {
            window.requestServerLyricCache(task.song, task.quality).then((synced) => {
                if (synced) setTimeout(() => this.checkTaskLyric(task), 2000);
            });
        }

        this.renderTask(task);
        this.saveTasks();
        this.processQueue();
    }

    async refreshMissingServerTask(task) {
        if (task.cacheRecheckPending) return;
        task.cacheRecheckPending = true;
        try {
            const checker = window.checkServerCache || (typeof checkServerCache === 'function' ? checkServerCache : null);
            const check = checker ? await checker(task.song, task.quality, true) : null;
            if (check && check.exists && !check.isCollision) {
                this.completeServerTask(task, 'finished');
            } else if (task.isServer && task.status === 'downloading' && (task.missingProgressCount || 0) >= 6) {
                task.status = 'waiting';
                task.progress = 0;
                task.downloadedBytes = 0;
                task.totalBytes = 0;
                task.speed = 0;
                task.errorMsg = '';
                task.missingProgressCount = 0;
                this.renderTask(task);
                this.saveTasks();
                this.processQueue();
            }
        } catch (e) {
            console.warn('[DownloadManager] Missing progress cache recheck failed:', task.id, e);
        } finally {
            task.cacheRecheckPending = false;
        }
    }

    async pollServerProgress() {
        if (this.serverPollInFlight) return;
        this.serverPollInFlight = true;
        try {
        await this.syncServerQueue(false);
        // [Move to top] 对已完成但还未检测过歌词的云端任务，执行检测
        // 这样即使当前没有正在下载的任务，刷新页面后也能触发一次歌词状态刷新
        this.tasks.filter(t => t.isServer && t.status === 'finished' && t.hasLyric === undefined).slice(0, 3).forEach(t => {
            t.hasLyric = 'checking';
            this.checkTaskLyric(t);
        });

        // Poll for server tasks AND local proxy tasks
        const tasksToPoll = this.tasks.filter(t => !t.serverManaged && (t.isServer || (t.status === 'downloading' && !t.isServer)) && (t.status === 'waiting' || t.status === 'downloading' || t.status === 'tagging'));
        if (tasksToPoll.length === 0) return;

        // Map task IDs to names/keys the server uses
        const idMap = {};
        tasksToPoll.forEach(t => {
            if (t.isServer) {
                const rawId = this.getTaskServerSongKey(t);
                idMap[rawId] = t.id;
            } else {
                // Local proxy download uses taskId directly
                idMap[t.id] = t.id;
            }
        });

        const ids = Object.keys(idMap);
        const batchSize = 60;
        try {
            const batches = [];
            for (let i = 0; i < ids.length; i += batchSize) {
                batches.push(ids.slice(i, i + batchSize));
            }

            const batchResults = await Promise.all(batches.map(async (batch) => {
                try {
                    const resp = await fetch(`/api/music/cache/progress?ids=${encodeURIComponent(batch.join(','))}`);
                    const result = await resp.json();
                    return result.success ? (result.data || {}) : {};
                } catch (e) {
                    console.warn('[DownloadManager] Batch progress poll failed:', e);
                    return {};
                }
            }));
            const data = Object.assign({}, ...batchResults);

                // 处理有进度数据的任务
                Object.keys(data).forEach(rawId => {
                    const taskId = idMap[rawId];
                    const task = this.tasks.find(t => t.id === taskId);
                    if (!task) return;

                    const progressInfo = data[rawId];
                    if (progressInfo) {
                        // [Fix] 如果本地任务已处于暂停状态，则忽略轮询结果中的 downloading 状态覆盖，
                        // 但仍然更新收到的字节数等元数据。
                        if (task.status === 'paused' && (progressInfo.status === 'downloading' || progressInfo.status === 'waiting')) {
                            task.downloadedBytes = progressInfo.received || 0;
                            task.totalBytes = progressInfo.total || 0;
                            return;
                        }

                        // Calculate speed for polled tasks
                        if (typeof progressInfo.speed === 'number') {
                            task.speed = Math.max(0, progressInfo.speed);
                        } else if (task.lastPolledBytes !== undefined && task.lastPolledTime !== undefined) {
                            const now = Date.now();
                            const elapsed = (now - task.lastPolledTime) / 1000;
                            if (elapsed > 0) {
                                const downloaded = (progressInfo.received || 0) - task.lastPolledBytes;
                                task.speed = Math.max(0, downloaded / elapsed);
                            }
                        }
                        task.lastPolledBytes = progressInfo.received || 0;
                        task.lastPolledTime = Date.now();

                        if (progressInfo.status === 'error') {
                            task.status = 'error';
                            task.progress = progressInfo.progress || 0;
                            task.errorMsg = progressInfo.errorMsg || '服务器下载失败';
                            task.speed = 0;
                            this.renderTask(task);
                            this.saveTasks();
                            this.processQueue();
                            return;
                        }

                        task.status = progressInfo.status === 'tagging'
                            ? 'tagging'
                            : ((progressInfo.status === 'finished' || progressInfo.status === 'exists') ? progressInfo.status : 'downloading');
                        task.progress = progressInfo.progress || 0;
                        task.downloadedBytes = progressInfo.received || 0;
                        task.totalBytes = progressInfo.total || 0;
                        task.missingProgressCount = 0;

                        if (progressInfo.status === 'finished' || progressInfo.status === 'exists') {
                            this.completeServerTask(task, progressInfo.status === 'exists' ? 'exists' : 'finished');
                            return;
                        } else {
                            task.errorMsg = '';
                        }
                        this.renderTask(task);
                    }
                });

                // [Fix] 处理没有进度数据的任务：key 已被删除 = 下载完成或从未开始
                tasksToPoll.forEach(task => {
                    const rawId = task.isServer ? this.getTaskServerSongKey(task) : task.id;
                    if (data[rawId] === undefined && (task.status === 'downloading' || task.status === 'tagging')) {
                        // 没有进度条目 + 状态是 downloading/tagging
                        // → 如果之前进度很高或在嵌入中，说明已从内存队列移除，逻辑上视为已完成
                        console.log(`[DownloadManager] Missing progress info for ${task.id}, status: ${task.status}, prog: ${task.progress}`);
                        if (task.progress >= 99 || task.status === 'tagging') {
                            task.status = 'finished';
                            task.progress = 100;
                            task.errorMsg = '';
                            task.speed = 0;
                            task.missingProgressCount = 0;

                            // 成功完成后触发歌词同步（补充）
                            if (this.shouldAutoSyncLyric(task)) {
                                window.requestServerLyricCache(task.song, task.quality).then((synced) => {
                                    if (synced) setTimeout(() => this.checkTaskLyric(task), 2000);
                                });
                            }

                            this.renderTask(task);
                            this.saveTasks();
                            this.processQueue();
                        } else if (task.isServer) {
                            task.missingProgressCount = (task.missingProgressCount || 0) + 1;
                            this.refreshMissingServerTask(task);
                        } else if (task.nativeDownloadDispatched) {
                            task.missingProgressCount = (task.missingProgressCount || 0) + 1;
                            if (task.missingProgressCount >= 6) {
                                task.status = 'error';
                                task.speed = 0;
                                task.errorMsg = '浏览器未启动下载';
                                this.renderTask(task);
                                this.saveTasks();
                                this.processQueue();
                            }
                        }
                    }
                });
        } catch (e) {
            console.error('[DownloadManager] Server poll error:', e);
        }
        } finally {
            this.serverPollInFlight = false;
        }
    }

    // [New] 检测任务歌词是否存在
    async checkTaskLyric(task) {
        if (!task || !task.isServer || task.status !== 'finished') return;

        // [优化] 如果已经有结果，或者重试超过 3 次，则不再请求
        if ((task.hasLyric === true || task.hasLyric === false) || (task.lyricRetryCount || 0) >= 3) return;

        try {
            // 记录重试次数
            task.lyricRetryCount = (task.lyricRetryCount || 0) + 1;

            const song = task.song || {};
            const meta = song.meta || {};
            const source = song.source || meta.source || '';
            const songmid = song.songmid || song.songId || meta.songmid || meta.songId || song.id || '';
            const songId = song.id || song.songId || meta.songId || songmid;
            const url = `/api/music/cache/lyric?source=${encodeURIComponent(source)}&songmid=${encodeURIComponent(songmid)}&songId=${encodeURIComponent(songId || '')}&name=${encodeURIComponent(song.name || meta.songName || '')}&singer=${encodeURIComponent(song.singer || meta.singerName || '')}`;

            // [修复] 补全认证请求头
            const headers = {
                'Content-Type': 'application/json',
                ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
            };

            const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '';
            if (username && !headers['x-user-name']) headers['x-user-name'] = username;

            const resp = await fetch(url, { headers });
            if (resp.ok) {
                task.hasLyric = true;
            } else if (resp.status === 404) {
                task.hasLyric = false;
            } else {
                // 发生非 404 错误（如 401/500/网络错误）时才重置状态以便下次重试（受次数限制）
                task.hasLyric = undefined;
            }
            this.renderTask(task);
            this.saveTasks();
        } catch (e) {
            console.warn('[DownloadManager] Failed to check lyric cache:', task.id, e);
            task.hasLyric = undefined;
        }
    }

    // [New] 手动重试下载歌词
    async retryLyric(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task || !task.isServer) return;

        console.log('[DownloadManager] Retrying lyric sync for:', task.song.name);
        if (window.requestServerLyricCache) {
            task.hasLyric = 'checking';
            this.renderTask(task);

            try {
                const synced = await window.requestServerLyricCache(task.song, task.quality, true); // 强制补全
                if (!synced) throw new Error('No lyric data available');
                if (window.showSuccess) window.showSuccess(`已成功补全歌词: ${task.song.name}`);
                // 再次检查
                setTimeout(() => this.checkTaskLyric(task), 1500);
            } catch (e) {
                task.hasLyric = false;
                this.renderTask(task);
                this.saveTasks();
                if (window.showError) window.showError(`补全歌词失败: ${task.song.name}`);
            }
        }
    }

    // [New] 一键重试所有下载面板中缺失的歌词
    async retryAllLyrics() {
        const missingTasks = this.tasks.filter(t => t.isServer && t.status === 'finished' && t.hasLyric === false);
        if (missingTasks.length === 0) {
            if (window.showInfo) window.showInfo('没有缺失歌词的任务');
            return;
        }

        if (window.showInfo) window.showInfo(`正在尝试补全 ${missingTasks.length} 首歌曲的歌词...`);

        // 串行下载，避免并发过大
        for (const task of missingTasks) {
            await this.retryLyric(task.id);
            // 稍微等待一下
            await new Promise(r => setTimeout(r, 500));
        }
    }

    // Toggle drawer
    toggleDrawer() {
        if (this.drawer.classList.contains('translate-x-full')) {
            this.drawer.classList.remove('translate-x-full');
        } else {
            this.drawer.classList.add('translate-x-full');
        }
    }

    // Convert bytes to readable string
    formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Helper to escape HTML to prevent XSS
    escapeHtml(unsafe) {
        return (unsafe || '').toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    // Helper to get song cover
    getSongCover(song) {
        if (!song) return '/music/assets/logo.svg';
        return song.img || song.pic ||
            (song.meta && (song.meta.picUrl || song.meta.img)) ||
            (song.album && (song.album.picUrl || song.album.img)) ||
            '/music/assets/logo.svg';
    }

    getSongInfoForServer(song) {
        const cover = this.getSongCover(song);
        const normalizedCover = cover && cover !== '/music/assets/logo.svg' ? cover : '';
        return {
            ...song,
            img: song.img || normalizedCover,
            meta: {
                ...(song.meta || {}),
                picUrl: song.meta?.picUrl || normalizedCover
            }
        };
    }

    getSongInfoForStorage(song) {
        if (!song) return {};
        return {
            id: song.id,
            songmid: song.songmid,
            songId: song.songId,
            source: song.source,
            name: song.name,
            singer: song.singer,
            albumName: song.albumName,
            albumId: song.albumId,
            albumMid: song.albumMid,
            interval: song.interval,
            img: song.img,
            types: song.types,
            _types: song._types,
            strMediaMid: song.strMediaMid,
            hash: song.hash,
            meta: song.meta ? {
                songmid: song.meta.songmid,
                songId: song.meta.songId,
                source: song.meta.source,
                picUrl: song.meta.picUrl,
                singerName: song.meta.singerName,
                songName: song.meta.songName
            } : undefined
        };
    }

    // [Unified] Status generator for drawer lists
    getStatusHtml(icon, text, isSpin = false) {
        return `
            <div class="flex flex-col items-center justify-center h-full text-center p-10 space-y-4">
                <i class="fas ${icon} ${isSpin ? 'fa-spin' : ''} text-4xl t-text-muted opacity-20"></i>
                <p class="text-sm t-text-muted font-medium">${text}</p>
            </div>
        `;
    }

    // Add multiple tasks
    async addTasks(songs) {
        if (!songs || songs.length === 0) return;

        // Keep large batches responsive by limiting concurrent preflight requests.
        const results = await this.mapWithConcurrency(songs, 8, async (song) => {
            const targetPref = song.quality || window.settings?.preferredQuality || 'flac';
            const quality = song.quality || (window.QualityManager ? window.QualityManager.getBestQuality(song, targetPref) : targetPref);
            const cacheResult = await checkServerCache(song, quality, true);
            return { song, quality, cacheResult };
        });

        let skipCount = 0;
        const addedServerTasks = [];
        for (const { song, quality, cacheResult } of results) {
            const isServerTask = song.isServer || false;
            if (cacheResult.exists && !cacheResult.isCollision) {
                const onlyDownloadMode = window.settings?.enableOnlyDownloadMode === true;
                const targetAlreadyExists = !onlyDownloadMode || cacheResult.folder === 'music';
                if (isServerTask && targetAlreadyExists) { // 仅下载模式下 cache 命中仍需交给后端复制到 music 目录
                    skipCount++;
                    continue;
                }
                // 浏览器下载任务：即使已存在缓存也要添加任务，以便用户下载到本地，但后面会优先用缓存地址
            }

            // Check if already in queue (with same quality)
            const songIdentity = this.getSongIdentity(song);
            const existing = this.tasks.find(t =>
                this.getSongIdentity(t.song) === songIdentity &&
                t.quality === quality &&
                (t.status === 'waiting' || t.status === 'starting' || t.status === 'downloading' || t.status === 'tagging')
            );
            if (!existing) {
                const serverSongKey = isServerTask ? this.getServerSongKey(song, quality) : null;
                const taskId = song.taskId || this.createTaskId(isServerTask ? 'server' : 'dl');
                const useNativeDownload = !isServerTask && this.shouldUseNativeDownload(songs.length, quality);

                const task = {
                    id: taskId,
                    song: song,
                    isServer: isServerTask,
                    serverManaged: isServerTask,
                    serverQueueRegistered: false,
                    serverQueueId: isServerTask ? taskId : null,
                    useNativeDownload,
                    nativeDownloadDispatched: false,
                    serverSongKey,
                    quality: quality,
                    status: 'waiting',
                    errorMsg: '',
                    progress: 0,
                    downloadedBytes: 0,
                    totalBytes: 0,
                    speed: 0,
                    retryCount: 0,
                    maxRetries: 2,
                    controller: null,
                    collisionInfo: cacheResult.isCollision ? cacheResult : null,
                    cacheUrl: cacheResult.exists ? cacheResult.url : null // [新增] 保存缓存地址
                };
                this.tasks.push(task);
                if (isServerTask) addedServerTasks.push(task);
            }
        }

        if (skipCount > 0 && window.showInfo) {
            window.showInfo(`${skipCount} 首歌曲已存在，已跳过`);
        }

        // Auto open drawer; renderList only paints the first visible slice for large batches.
        if (this.drawer && this.drawer.classList.contains('translate-x-full')) {
            this.toggleDrawer();
        }

        this.renderList();
        this.processQueue();
        this.saveTasks();
        await this.enqueueServerTasks(addedServerTasks);
    }

    // Process the queue based on concurrency limits
    processQueue() {
        // Recalculate true active count including triggered server tasks
        const localActive = this.tasks.filter(t => !t.isServer && t.status === 'downloading').length;
        const serverActive = this.tasks.filter(t => t.isServer && !t.serverManaged && (t.status === 'downloading' || t.status === 'tagging')).length;
        this.activeCount = localActive + serverActive;

        while (this.activeCount < this.maxConcurrent) {
            const nextTask = this.tasks.find(t => t.status === 'waiting' && !t.serverManaged);
            if (!nextTask) break;
            if (nextTask.useNativeDownload && this.activeCount > 0) break;
            if (typeof this.getDownloadResolver() !== 'function') {
                setTimeout(() => this.processQueue(), 100);
                break;
            }
            nextTask.status = 'starting';
            this.activeCount++;
            if (nextTask.isServer) {
                this.startServerDownload(nextTask);
            } else {
                this.startDownload(nextTask);
            }
            if (nextTask.useNativeDownload) break;
        }
        this.renderList();
        this.updateGlobalProgress();
    }

    // Trigger backend cache for a server task
    async startServerDownload(task) {
        task.status = 'downloading'; // Change to downloading to occupy a slot
        this.renderTask(task);

        try {
            const downloadResolver = await this.waitForDownloadResolver();

            // 1. Resolve URL
            const requestedQuality = task.quality || (window.QualityManager ? window.QualityManager.getBestQuality(task.song, window.settings?.preferredQuality || 'flac') : 'flac');
            const requestedSource = task.song?.source || '';
            task.quality = requestedQuality;

            const result = await downloadResolver(task.song, requestedQuality, true);
            if (!result || !result.url) throw new Error('解析失败');

            const resolvedSong = result.songInfo || task.song;
            const resolvedQuality = result.quality || result.type || requestedQuality;
            if (resolvedSong !== task.song) {
                task.song = resolvedSong;
            }
            task.quality = resolvedQuality;
            task.serverSongKey = this.getServerSongKey(resolvedSong, resolvedQuality);
            this.renderTask(task);

            let rawUrl = this.extractRawDownloadUrl(result.url);
            if (!rawUrl.startsWith('http')) throw new Error('无法获取有效的外部下载地址');

            // 2. Post to backend
            const headers = { 'Content-Type': 'application/json', ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {}) };
            const payload = {
                songInfo: this.getSongInfoForServer(resolvedSong),
                url: rawUrl,
                quality: resolvedQuality,
                requestedSource,
                downloadSource: result.downloadSource || resolvedSong.source,
                sourceName: result.sourceName || '',
                enableOnlyDownloadMode: window.settings?.enableOnlyDownloadMode || false,
                cacheLyric: window.settings?.enableServerLyricCache !== false,
                embedLyric: !!(window.settings?.embedLyricToFile ?? true)
            };
            if (window.settings?.serverCacheNamingPattern && headers['x-frontend-auth']) {
                payload.namingPattern = window.settings.serverCacheNamingPattern;
            }

            const res = await fetch('/api/music/cache/download', {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error('服务器拒绝缓存');

            // Success: pollServerProgress will now handle its movement
            this.saveTasks();
            console.log(`[DownloadManager] Server task started: ${task.song.name}`);
        } catch (e) {
            console.warn('[DownloadManager] Failed to start server task:', task.id, e);
            task.status = 'error';
            task.errorMsg = e.message || '启动失败';
            this.renderTask(task);
            this.processQueue(); // Release slot immediately because it's errored
        }
    }

    // Start a specific download task
    async startDownload(task) {

        task.status = 'downloading';
        task.errorMsg = '';
        task.speed = 0;
        task.controller = new AbortController();
        this.renderTask(task);

        try {
            // 1. Resolve URL and Quality
            const quality = task.quality || (window.QualityManager ? window.QualityManager.getBestQuality(task.song, window.settings?.preferredQuality || 'flac') : 'flac');
            task.quality = quality;
            this.renderTask(task);

            let finalUrl = '';
            let ext = 'mp3';

            if (task.cacheUrl) {
                // 1. 如果有缓存地址，直接使用缓存下载
                console.log('[DownloadManager] Using server cache for download:', task.song.name);
                finalUrl = task.cacheUrl;

                // 补全 Token
                const authToken = (window.getUserAuthHeaders ? window.getUserAuthHeaders()['x-user-token'] : null) || localStorage.getItem('lx_user_token') || '';
                if (authToken && !finalUrl.includes('token=')) {
                    finalUrl += (finalUrl.includes('?') ? '&' : '?') + `token=${encodeURIComponent(authToken)}`;
                }

                ext = this.getDownloadExtension(finalUrl, quality);
            } else {
                const downloadResolver = await this.waitForDownloadResolver();
                const resolveData = await downloadResolver(task.song, quality, true);
                if (!resolveData || !resolveData.url) throw new Error('No download URL found');

                const resolvedSong = resolveData.songInfo || task.song;
                const resolvedQuality = resolveData.quality || resolveData.type || quality;
                if (resolvedSong !== task.song) {
                    task.song = resolvedSong;
                }
                task.quality = resolvedQuality;
                this.renderTask(task);

                finalUrl = resolveData.url;
                ext = this.getDownloadExtension(finalUrl, resolvedQuality);
            }

            // Determine filename with collision handling
            let filename = `${task.song.singer} - ${task.song.name}`;
            if (task.collisionInfo) {
                const currentMid = task.song.songmid || task.song.id;
                // If it's a collision (detected during addTasks), apply same suffixing as server
                if (task.collisionInfo.collisionSource !== task.song.source) {
                    filename += ` (${task.song.source})`;
                } else if (task.collisionInfo.collisionSongmid !== currentMid) {
                    filename += ` (${task.song.source} ${currentMid})`;
                }
            }
            filename += `.${ext}`;

            // Check if we need to proxy the download itself across domains
            let shouldProxyDownload = window.settings?.enableProxyDownload || true; // Force proxy for tagging support
            if (!shouldProxyDownload && window.settings?.enableAutoProxy) {
                if (window.location.protocol === 'https:' && finalUrl.startsWith('http://')) {
                    shouldProxyDownload = true;
                }
            }

            // [优化] 如果是本地缓存文件，不需要经过下载代理（已经有标签了）
            const isLocalCache = finalUrl.startsWith('/api/music/cache/file');
            finalUrl = this.extractRawDownloadUrl(finalUrl);

            if (shouldProxyDownload && !finalUrl.startsWith('/api/music/download') && !isLocalCache) {
                // Add metadata for tagging — 用 albumName 优先（playlist 字段），album 为兼容备选
                const albumName = task.song.albumName || (task.song.album && typeof task.song.album === 'string' ? task.song.album : (task.song.album?.name || ''));
                let coverUrl = this.getSongCover(task.song);

                // [Critical Fix] 相对路径改为绝对路径，服务器才能正确抓取并嵌入封面
                if (coverUrl && coverUrl.startsWith('/')) {
                    coverUrl = window.location.origin + coverUrl;
                }

                const metadataParams = [
                    `tag=1`,
                    `name=${encodeURIComponent(task.song.name)}`,
                    `singer=${encodeURIComponent(task.song.singer)}`,
                    `album=${encodeURIComponent(albumName)}`,
                    coverUrl ? `pic=${encodeURIComponent(coverUrl)}` : '',
                    // [新增] 传 source/songmid 供服务端调歌词接口，并标记需要嵌入歌词
                    task.song.source ? `source=${encodeURIComponent(task.song.source)}` : '',
                    (task.song.songmid || task.song.id) ? `songmid=${encodeURIComponent(task.song.songmid || task.song.id)}` : '',
                    task.song.hash ? `hash=${encodeURIComponent(task.song.hash)}` : '',
                    task.song.interval ? `interval=${encodeURIComponent(task.song.interval)}` : '',
                    (window.settings?.embedLyricToFile !== false) ? 'lyric=1' : ''
                ].filter(Boolean).join('&');

                finalUrl = `/api/music/download?url=${encodeURIComponent(finalUrl)}&filename=${encodeURIComponent(filename)}&taskId=${task.id}&${metadataParams}`;
                console.log('[DownloadManager] Download with metadata proxy:', finalUrl);
            } else {
                console.log('[DownloadManager] Simple download:', finalUrl);
            }

            if (task.useNativeDownload) {
                if (task.controller.signal.aborted) throw new DOMException('Download paused', 'AbortError');
                this.triggerNativeDownload(finalUrl, filename);
                task.nativeDownloadDispatched = true;
                task.status = 'downloading';
                task.progress = 0;
                task.speed = 0;
                task.controller = null;
                this.renderTask(task);
                this.saveTasks();
                return;
            }

            // 2. Fetch the actual file using Streams to track progress
            const response = await fetch(finalUrl, { signal: task.controller.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status} when fetching file`);

            const contentLength = response.headers.get('content-length');
            if (contentLength) {
                task.totalBytes = parseInt(contentLength, 10);
            } else {
                // Unknown length
                task.totalBytes = 0;
            }

            const reader = response.body.getReader();
            let receivedLength = 0;
            const chunks = [];

            // Time tracking for speed calc using short intervals
            let lastUpdate = performance.now();
            let downloadedSinceLastUpdate = 0;

            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    break;
                }

                chunks.push(value);
                receivedLength += value.length;
                task.downloadedBytes = receivedLength;
                downloadedSinceLastUpdate += value.length;

                if (task.totalBytes) {
                    task.progress = Math.round((receivedLength / task.totalBytes) * 100);
                }

                // Update speed every 500ms
                const now = performance.now();
                if (now - lastUpdate > 500) {
                    const elapsedSecs = (now - lastUpdate) / 1000;
                    task.speed = downloadedSinceLastUpdate / elapsedSecs;
                    lastUpdate = now;
                    downloadedSinceLastUpdate = 0;
                    // console.log(`[DownloadManager] Progress: ${task.progress}%, Speed: ${task.speed}`);
                    this.renderTask(task); // Update DOM smoothly
                }
            }

            // 3. Complete and Merge Chunks to Blob
            task.progress = 100;
            task.speed = 0;

            task.status = 'finished';
            this.renderTask(task);

            this.activeCount--;
            this.saveTasks();

            // Construct Blob and trigger browser download
            const blob = new Blob(chunks);
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            // 标记真正结束
            task.status = 'finished';
            this.renderTask(task);

            // Clean up to free memory
            setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

            // Trigger next
            this.processQueue();

        } catch (error) {
            this.activeCount--;
            if (task.controller && task.controller.signal.aborted) {
                task.status = 'paused';
                task.speed = 0;
                task.errorMsg = '已暂停';
            } else {
                console.error(`Download error for ${task.song.name}:`, error);
                task.errorMsg = error.message;

                // Retry logic
                if (task.retryCount < task.maxRetries) {
                    task.retryCount++;
                    task.status = 'error'; // Show error momentarily
                    this.renderTask(task);

                    // Add to end of queue after 2 seconds
                    setTimeout(() => {
                        // [Critical Fix] 检查任务是否在这 2 秒内被用户手动取消或暂停
                        if (task.controller?.signal?.aborted || task.status === 'paused' || task.status === 'finished') {
                            console.log('[DownloadManager] Abort retry for task:', task.id);
                            return;
                        }

                        // Create a new task effectively at the end but keeping retry count
                        const newTask = { ...task, status: 'waiting', errorMsg: '', downloadedBytes: 0, progress: 0, controller: null };
                        this.tasks = this.tasks.filter(t => t.id !== task.id);
                        this.tasks.push(newTask);
                        this.renderList();
                        this.processQueue();
                    }, 2000);
                    return; // exit current cycle
                } else {
                    task.status = 'error';
                }
            }
            this.renderTask(task);
            this.processQueue();
        }
    }

    pauseTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;

        if (task.isServer) {
            // 云端任务：通知后端停止，并更新本地状态
            if (task.status === 'downloading' || task.status === 'waiting' || task.status === 'tagging') {
                const songKey = this.getTaskServerSongKey(task);
                const headers = { 'Content-Type': 'application/json', ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {}) };

                fetch('/api/music/cache/stop', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(task.serverManaged ? { queueId: task.serverQueueId || task.id } : { songKey })
                }).catch(e => console.warn('[DownloadManager] Failed to stop server task:', e));
                task.status = 'paused';
                task.speed = 0;
                task.errorMsg = '已暂停';
                this.renderTask(task);
                this.saveTasks();
                this.updateGlobalProgress();
                this.processQueue();
            }
        } else {
            // 本地任务
            if (task.status === 'downloading') {
                if (task.controller) {
                    task.controller.abort(); // Triggers catch block in startDownload
                }
            } else if (task.status === 'waiting') {
                task.status = 'paused';
                task.speed = 0;
                this.renderTask(task);
                this.saveTasks();
                this.updateGlobalProgress();
            }
        }
    }

    resumeTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task || (task.status !== 'paused' && task.status !== 'error')) return;

        task.status = 'waiting';
        task.downloadedBytes = 0;
        task.totalBytes = 0;
        task.progress = 0;
        task.speed = 0;
        task.errorMsg = '';
        task.missingProgressCount = 0;
        task.cacheRecheckPending = false;
        task.lastPolledBytes = undefined;
        task.lastPolledTime = undefined;
        task.controller = null;
        if (task.serverManaged) {
            const request = task.serverQueueRegistered === false
                ? this.enqueueServerTasks([task])
                : this.requestServerQueue('/api/music/cache/queue/resume', { id: task.serverQueueId || task.id });
            request.catch(error => {
                task.status = 'error';
                task.errorMsg = error.message || '继续任务失败';
                this.renderTask(task);
            });
        }
        this.renderTask(task);
        this.saveTasks();
        this.processQueue();
    }

    deleteTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (task) {
            if (task.serverManaged) {
                this.requestServerQueue('/api/music/cache/queue/remove', { id: task.serverQueueId || task.id })
                    .catch(e => console.warn('[DownloadManager] Failed to remove server queue task:', e));
            } else if (task.isServer && (task.status === 'downloading' || task.status === 'waiting' || task.status === 'tagging')) {
                // 云端任务：通知后端停止
                const songKey = this.getTaskServerSongKey(task);
                const headers = { 'Content-Type': 'application/json', ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {}) };

                fetch('/api/music/cache/stop', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ songKey })
                }).catch(e => console.warn('[DownloadManager] Failed to stop server task on delete:', e));
            } else if (!task.isServer && task.status === 'downloading' && task.controller) {
                task.controller.abort();
            }
            this.tasks = this.tasks.filter(t => t.id !== taskId);
            this.renderList();
            this.processQueue();
            this.saveTasks();
        }
    }

    pauseAll() {
        const headers = { 'Content-Type': 'application/json', ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {}) };
        const hasManagedServerTasks = this.tasks.some(t => t.serverManaged && ['waiting', 'downloading', 'tagging'].includes(t.status));
        if (hasManagedServerTasks) {
            fetch('/api/music/cache/stop', {
                method: 'POST', headers, body: JSON.stringify({ all: true })
            }).catch(e => console.warn('[DownloadManager] Failed to pause persistent server queue:', e));
        }
        this.tasks.forEach(t => {
            if (t.status !== 'downloading' && t.status !== 'waiting' && t.status !== 'tagging' && t.status !== 'starting') return;
            if (t.nativeDownloadDispatched && t.status === 'downloading') return;

            if (t.isServer && !t.serverManaged) {
                const songKey = this.getTaskServerSongKey(t);
                fetch('/api/music/cache/stop', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ songKey })
                }).catch(e => console.warn('[DownloadManager] Failed to stop server task:', e));
            } else if (t.controller) {
                t.controller.abort();
            }

            t.status = 'paused';
            t.speed = 0;
            t.errorMsg = '已暂停';
        });
        this.activeCount = 0;
        this.renderList();
        this.saveTasks();
        this.updateGlobalProgress();
    }

    resumeAll() {
        const hasManagedServerTasks = this.tasks.some(t => t.serverManaged && (t.status === 'paused' || t.status === 'error'));
        if (hasManagedServerTasks) {
            this.requestServerQueue('/api/music/cache/queue/resume', { all: true })
                .catch(e => console.warn('[DownloadManager] Failed to resume persistent server queue:', e));
        }
        this.tasks.forEach(t => {
            if (t.status !== 'paused') return;
            t.status = 'waiting';
            t.downloadedBytes = 0;
            t.totalBytes = 0;
            t.progress = 0;
            t.speed = 0;
            t.errorMsg = '';
            t.missingProgressCount = 0;
            t.cacheRecheckPending = false;
            t.lastPolledBytes = undefined;
            t.lastPolledTime = undefined;
            t.controller = null;
        });
        this.renderList();
        this.saveTasks();
        this.processQueue();
    }

    retryAllFailed() {
        // 取出所有失败任务的快照，避免在遍历同时修改数组引起问题
        const failedTasks = this.tasks.filter(t => t.status === 'error');
        if (failedTasks.length === 0) return;
        const unregisteredServerTasks = failedTasks.filter(t => t.serverManaged && t.serverQueueRegistered === false);

        failedTasks.forEach(t => {
            if (t.serverManaged) {
                if (t.serverQueueRegistered !== false) this.requestServerQueue('/api/music/cache/queue/resume', { id: t.serverQueueId || t.id })
                    .catch(e => console.warn('[DownloadManager] Failed to retry server queue task:', e));
            }
            t.retryCount = 0;
            t.downloadedBytes = 0;
            t.progress = 0;
            t.errorMsg = '';
            // 移到队列末尾
            this.tasks = this.tasks.filter(x => x.id !== t.id);

            if (t.isServer) {
                // 云端任务：放回队列等待 processQueue 调度
                t.status = 'waiting';
                this.tasks.push(t);
                this.renderTask(t);
            } else {
                // 本地任务：放回队列等待 processQueue 调度
                t.status = 'waiting';
                this.tasks.push(t);
            }
        });

        if (unregisteredServerTasks.length) void this.enqueueServerTasks(unregisteredServerTasks);

        this.renderList();
        this.processQueue();
    }

    clearCompleted() {
        if (this.tasks.some(t => t.serverManaged && (t.status === 'finished' || t.status === 'exists'))) {
            this.requestServerQueue('/api/music/cache/queue/remove', { completed: true })
                .catch(e => console.warn('[DownloadManager] Failed to clear completed server queue tasks:', e));
        }
        this.tasks = this.tasks.filter(t => t.status !== 'finished' && t.status !== 'exists');
        this.renderList();
        this.saveTasks();
    }

    clearAll() {
        // 先弹确认框
        if (typeof showSelect === 'function') {
            const hasActiveTasks = this.tasks.some(t => t.status === 'downloading' || t.status === 'waiting' || t.status === 'tagging');
            const title = hasActiveTasks ? '停止并清空任务' : '清空任务列表';
            const message = hasActiveTasks ? '确认要立即停止所有进行中的任务并清空列表吗？' : '确认要清空所有下载任务记录吗？';
            showSelect(title, message, {
                confirmText: hasActiveTasks ? '确认停止' : '确认清空',
                danger: true
            }).then(confirmed => {
                if (!confirmed) return;
                this.tasks.forEach(t => {
                    // 本地任务调用 abort
                    if ((t.status === 'downloading' || t.status === 'waiting' || t.status === 'tagging') && t.controller) {
                        try { t.controller.abort(); } catch (e) { }
                    }
                });

                // [NEW] 通知服务器中止所有该用户的缓存任务
                const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '';
                fetch('/api/music/cache/stop', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-user-name': username,
                        ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
                    },
                    body: JSON.stringify({ all: true })
                }).catch(err => console.error('[DownloadManager] Failed to stop server tasks:', err));
                this.requestServerQueue('/api/music/cache/queue/remove', { all: true })
                    .catch(err => console.error('[DownloadManager] Failed to clear persistent server queue:', err));

                this.tasks = [];
                this.activeCount = 0;
                this.renderList();
                this.saveTasks();
            });
        } else {
            // fallback：直接清空
            this.tasks.forEach(t => {
                if (t.status === 'downloading' && t.controller) t.controller.abort();
            });
            this.requestServerQueue('/api/music/cache/queue/remove', { all: true })
                .catch(err => console.error('[DownloadManager] Failed to clear persistent server queue:', err));
            this.tasks = [];
            this.activeCount = 0;
            this.renderList();
            this.saveTasks();
        }
    }

    // Persist tasks to sessionStorage
    saveTasks() {
        try {
            // Serialize only the data we need, not the AbortController
            // Server-managed tasks are persisted by the backend and restored through
            // /api/music/cache/queue. Keep sessionStorage for browser downloads only.
            const data = this.tasks.filter(t => !t.serverManaged).map(t => ({
                id: t.id,
                song: this.getSongInfoForStorage(t.song),
                isServer: t.isServer,
                useNativeDownload: !!t.useNativeDownload,
                nativeDownloadDispatched: !!t.nativeDownloadDispatched,
                quality: t.quality,
                status: t.isServer
                    ? t.status
                    : (['waiting', 'starting', 'downloading', 'tagging'].includes(t.status) ? 'paused' : t.status),
                progress: (t.status === 'finished' || t.status === 'exists') ? 100 : (t.isServer ? t.progress : 0),
                downloadedBytes: t.downloadedBytes || 0,
                totalBytes: t.totalBytes || 0,
                speed: t.speed || 0,
                serverSongKey: t.serverSongKey || '',
                errorMsg: t.errorMsg || '',
                retryCount: t.retryCount || 0,
                maxRetries: t.maxRetries || 2,
                hasLyric: t.hasLyric === 'checking' ? undefined : t.hasLyric,
                lyricRetryCount: t.lyricRetryCount || 0
            }));
            sessionStorage.setItem('lx_download_tasks', JSON.stringify(data));
        } catch (e) {
            console.warn('[DownloadManager] Failed to save tasks to sessionStorage:', e);
        }
    }

    // Restore tasks from sessionStorage on page load
    restoreTasks() {
        try {
            const raw = sessionStorage.getItem('lx_download_tasks');
            if (!raw) return;
            const data = JSON.parse(raw);
            if (!Array.isArray(data) || data.length === 0) return;

            data.forEach(t => {
                const restoredStatus = !t.isServer && ['waiting', 'starting', 'downloading', 'tagging'].includes(t.status)
                    ? 'paused'
                    : t.status;
                this.tasks.push({
                    id: /^[A-Za-z0-9_-]+$/.test(String(t.id || '')) ? t.id : this.createTaskId(t.isServer ? 'server' : 'dl'),
                    song: t.song,
                    isServer: t.isServer || false,
                    // Migrate server tasks left by older versions without allowing
                    // the browser scheduler to start a duplicate download.
                    serverManaged: !!t.isServer,
                    serverQueueRegistered: false,
                    serverQueueId: t.isServer ? t.id : null,
                    useNativeDownload: !t.isServer && (t.useNativeDownload !== false),
                    nativeDownloadDispatched: !!t.nativeDownloadDispatched,
                    serverSongKey: t.serverSongKey || '',
                    quality: t.quality || '',
                    // Local downloading → reset to waiting to re-download; server/finished → keep status
                    status: restoredStatus,
                    progress: t.progress || 0,
                    downloadedBytes: t.downloadedBytes || 0,
                    totalBytes: t.totalBytes || 0,
                    speed: t.speed || 0,
                    errorMsg: t.errorMsg || '',
                    retryCount: t.retryCount || 0,
                    maxRetries: t.maxRetries || 2,
                    hasLyric: t.hasLyric === 'checking' ? undefined : t.hasLyric,
                    lyricRetryCount: t.lyricRetryCount || 0,
                    controller: null
                });
            });

            this.renderList();
            // Start queued local tasks
            this.processQueue();
            console.log(`[DownloadManager] Restored ${data.length} tasks from sessionStorage`);
        } catch (e) {
            console.warn('[DownloadManager] Failed to restore tasks from sessionStorage:', e);
        }
    }

    // Update the UI Global Speed Counter
    updateGlobalSpeed() {
        let totalSpeed = 0;
        let active = 0;
        let pctTotal = 0;
        let pctCount = 0;

        this.tasks.forEach(t => {
            if (t.status === 'downloading' || t.status === 'tagging') {
                totalSpeed += (t.speed || 0);
                active++;
            }
            // 所有任务都纳入进度计算（server 任务可能 totalBytes=0，但 progress/status 是已知的）
            if (t.status === 'finished' || t.status === 'exists') {
                pctTotal += 100;
                pctCount++;
            } else if (t.status === 'downloading' || t.status === 'waiting' || t.status === 'tagging') {
                pctTotal += t.status === 'tagging' ? 100 : (t.progress || 0);
                pctCount++;
            }
        });

        if (this.globalSpeedEl) {
            this.globalSpeedEl.innerText = `${this.formatSize(totalSpeed)}/s • ${this.tasks.length} TASKS`;
        }

        if (this.progressTextEl) {
            const overallProgress = pctCount > 0 ? Math.round(pctTotal / pctCount) : 0;
            this.progressTextEl.innerText = `${overallProgress}%`;
        }
    }

    updateGlobalProgress() {
        this.updateGlobalSpeed(); // Calculates and updates
    }

    // Render a single task row item to HTML
    addTaskToPlaylist(taskId) {
        const task = this.tasks.find(item => item.id === taskId);
        if (task?.song && typeof window.openPlaylistAddModalForSongObject === 'function') {
            window.openPlaylistAddModalForSongObject(task.song);
        }
    }

    renderTaskHtml(task) {
        const coverSrc = this.getSongCover(task.song);
        const sourceName = {
            'wy': '网易', 'tx': 'QQ', 'kg': '酷狗', 'kw': '酷我', 'mg': '咪咕'
        }[task.song.source] || task.song.source;

        let qualityLabel = task.quality || window.settings?.preferredQuality || '优先最高';
        // 如果是音质代码（如 320k），尝试转换为显示名称
        if (window.QualityManager) {
            // 先尝试把代码转换成名称（如 320k -> 高品质）
            const displayName = window.QualityManager.getQualityDisplayName(qualityLabel);
            if (displayName) qualityLabel = displayName;
        }

        let statusBg = 'bg-gray-100 t-text-muted';
        let statusText = '等待中';
        let actionBtnHTML = '';
        let progressWidth = task.progress || 0;
        let speedText = '';
        let isServerTask = task.isServer || false;

        if (task.status === 'downloading') {
            statusBg = isServerTask ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600';
            // 云端任务：若 totalBytes=0 且 progress=0，说明还没轮询到进度，显示 indeterminate 而非 "云端 0%"
            const hasRealProgress = isServerTask && (task.totalBytes > 0 || task.progress > 0);
            statusText = isServerTask
                ? (hasRealProgress ? `云端 ${progressWidth}%` : '云端下载中')
                : (task.nativeDownloadDispatched ? `浏览器 ${progressWidth}%` : `${progressWidth}%`);
            speedText = `${this.formatSize(Math.max(0, task.speed || 0))}/s`;

            if (!isServerTask && !task.nativeDownloadDispatched) {
                actionBtnHTML = `
                    <button onclick="window.SystemDownloadManager.pauseTask('${task.id}')" class="w-8 h-8 rounded-full border border-yellow-200 text-yellow-500 hover:bg-yellow-50 flex items-center justify-center transition-colors shadow-sm" title="暂停">
                        <i class="fas fa-pause text-xs"></i>
                    </button>
                `;
            }
        } else if (task.status === 'tagging') {
            statusBg = 'bg-orange-100 text-orange-600';
            statusText = isServerTask ? '写入标签' : '处理中';
            progressWidth = 100;
        } else if (task.status === 'paused') {
            statusBg = 'bg-yellow-100 text-yellow-600';
            statusText = '已暂停';
            actionBtnHTML = `
                <button onclick="window.SystemDownloadManager.resumeTask('${task.id}')" class="w-8 h-8 rounded-full border border-emerald-200 text-emerald-500 hover:bg-emerald-50 flex items-center justify-center transition-colors shadow-sm" title="继续">
                    <i class="fas fa-play text-xs"></i>
                </button>
            `;
        } else if (task.status === 'error') {
            statusBg = 'bg-red-100 text-red-600';
            statusText = task.retryCount > 0 && task.retryCount < task.maxRetries ? `重试 (${task.retryCount})` : '失败';
            actionBtnHTML = `
                <button onclick="window.SystemDownloadManager.resumeTask('${task.id}')" class="w-8 h-8 rounded-full border border-red-200 text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors shadow-sm" title="重试">
                    <i class="fas fa-redo text-xs"></i>
                </button>
            `;
        } else if (task.status === 'finished' || task.status === 'exists') {
            statusBg = 'bg-emerald-100 text-emerald-600';
            statusText = task.status === 'exists' ? '已存在' : (isServerTask ? '已存云端' : '已完成');
            progressWidth = 100;
        } else if (task.status === 'waiting') {
            statusText = isServerTask ? '云端排队' : '等待中';
            if (!isServerTask) {
                actionBtnHTML = `
                    <button onclick="window.SystemDownloadManager.pauseTask('${task.id}')" class="w-8 h-8 rounded-full border border-yellow-200 text-yellow-500 hover:bg-yellow-50 flex items-center justify-center transition-colors shadow-sm" title="暂停">
                        <i class="fas fa-pause text-xs"></i>
                    </button>
                `;
            }
        }

        // Always show delete button mostly
        if (task.status !== 'downloading' || isServerTask) {
            actionBtnHTML += `
                <button onclick="window.SystemDownloadManager.deleteTask('${task.id}')" class="w-8 h-8 rounded-full border border-red-100 text-red-400 hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition-colors ml-1 shadow-sm" title="移除任务">
                    <i class="fas fa-trash-alt text-xs"></i>
                </button>
            `;
        } else {
            actionBtnHTML += `
                <button onclick="window.SystemDownloadManager.deleteTask('${task.id}')" class="w-8 h-8 rounded-full border border-red-100 text-red-400 hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition-colors ml-1 shadow-sm" title="取消下载">
                    <i class="fas fa-times text-xs"></i>
                </button>
            `;
        }

        return `
            <div id="dl-task-${task.id}" class="relative p-3 rounded-xl t-bg-panel hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors border border-transparent hover:t-border-main group flex gap-3 overflow-hidden shadow-sm mb-2">
                <!-- Progress Bar Background -->
                ${task.status !== 'waiting' && task.status !== 'error' ? `
                <div class="absolute bottom-0 left-0 h-1.5 ${isServerTask ? 'bg-orange-400' : 'bg-emerald-400'} transition-all duration-300 opacity-60" style="width: ${progressWidth}%"></div>
                ` : ''}

                <!-- Cover -->
                <div class="relative w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 shadow-sm border t-border-main">
                    <img src="${this.escapeHtml(coverSrc)}" class="w-full h-full object-cover">
                    ${(task.status === 'downloading') ? `
                    <div class="absolute inset-0 bg-black/40 flex items-center justify-center backdrop-blur-[2px]">
                        <i class="fas ${(isServerTask ? 'fa-cloud-upload-alt' : 'fa-spinner fa-spin')} text-white text-xs"></i>
                    </div>` : ''}
                </div>

                <!-- Info -->
                <div class="flex-1 min-w-0 flex flex-col justify-center">
                    <div class="flex items-center gap-1.5 mb-1 flex-nowrap">
                        <span class="shrink-0 text-[10px] font-bold text-white ${isServerTask ? 'bg-orange-500' : 'bg-red-400'} px-1.5 py-0.5 rounded uppercase tracking-wider">${this.escapeHtml(sourceName)}</span>
                        <span class="shrink-0 text-[10px] font-bold text-white ${isServerTask ? 'bg-purple-500' : 'bg-sky-500'} px-1.5 py-0.5 rounded tracking-wider">${isServerTask ? '云端' : '本地'}</span>
                        <h4 class="text-sm font-bold t-text-main truncate leading-tight flex-1 min-w-0 dynamic-marquee overflow-hidden" data-text="${this.escapeHtml(task.song.name)}">${this.escapeHtml(task.song.name)}</h4>
                    </div>
                    
                    <div class="flex items-center justify-between mt-1">
                        <div class="text-[10px] t-text-muted truncate flex gap-2 items-center">
                            <span class="text-emerald-600 font-medium px-1 bg-emerald-50 rounded">${this.escapeHtml(qualityLabel)}</span>
                            <span class="truncate opacity-60">${this.escapeHtml(task.song.singer)}</span>
                        </div>
                        
                        <div class="flex items-center gap-1.5 font-bold">
                            ${speedText ? `<span class="text-[10px] font-mono text-emerald-500">${speedText}</span>` : ''}
                            
                            <!-- LRC Status Tag -->
                            ${isServerTask && task.status === 'finished' ? `
                                ${task.hasLyric === true ? `
                                    <span class="text-[9px] bg-emerald-500 text-white px-1 rounded h-3.5 flex items-center shadow-sm" title="歌词已同步">LRC</span>
                                ` : task.hasLyric === false ? `
                                    <div onclick="event.stopPropagation(); window.SystemDownloadManager.retryLyric('${task.id}')" class="text-[9px] bg-red-400 hover:bg-red-500 text-white px-1 rounded h-3.5 flex items-center gap-0.5 cursor-pointer shadow-sm transition-colors" title="歌词缺失，点击重试">
                                        <span>LRC+</span>
                                        <i class="fas fa-redo-alt text-[7px]"></i>
                                    </div>
                                ` : `
                                    <span class="text-[9px] bg-gray-400 text-white px-1 rounded h-3.5 flex items-center opacity-60" title="正在检查歌词...">LRC</span>
                                `}
                            ` : ''}

                            <span class="text-[10px] px-1.5 py-0.5 rounded ${statusBg} truncate max-w-[100px]">
                                ${task.errorMsg ? `<span title="${this.escapeHtml(task.errorMsg)}">${this.escapeHtml(task.errorMsg)}</span>` : statusText}
                            </span>
                        </div>
                    </div>
                </div>

                <!-- Actions -->
                <div class="flex items-center pl-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-all sm:translate-x-2 group-hover:translate-x-0">
                    <button onclick="window.SystemDownloadManager.addTaskToPlaylist('${task.id}')" class="w-8 h-8 rounded-full border border-emerald-100 text-emerald-500 hover:bg-emerald-50 flex items-center justify-center transition-colors mr-1 shadow-sm" title="添加到歌单">
                        <i class="fas fa-plus text-xs"></i>
                    </button>
                    ${actionBtnHTML}
                </div>
            </div>
        `;
    }

    // Refresh entire list DOM
    renderList() {
        if (!this.listContainer) return;

        if (this.tasks.length === 0) {
            this.renderedRange = { start: 0, end: 0 };
            this.listContainer.innerHTML = this.getStatusHtml('fa-inbox', '暂无下载任务');
            return;
        }

        const containerHeight = this.listContainer.clientHeight || 600;
        const visibleCount = Math.ceil(containerHeight / this.estimatedTaskHeight) + this.renderBuffer * 2;
        const maxStart = Math.max(0, this.tasks.length - visibleCount);
        const start = Math.min(
            maxStart,
            Math.max(0, Math.floor(this.listContainer.scrollTop / this.estimatedTaskHeight) - this.renderBuffer)
        );
        const end = Math.min(this.tasks.length, start + visibleCount);
        this.renderedRange = { start, end };

        const topSpacer = start * this.estimatedTaskHeight;
        const bottomSpacer = Math.max(0, (this.tasks.length - end) * this.estimatedTaskHeight);
        const visibleTasks = this.tasks.slice(start, end);

        this.listContainer.innerHTML = `
            <div style="height: ${topSpacer}px;"></div>
            ${visibleTasks.map(t => this.renderTaskHtml(t)).join('')}
            <div style="height: ${bottomSpacer}px;"></div>
        `;

        const firstTaskEl = this.listContainer.querySelector('[id^="dl-task-"]');
        if (firstTaskEl) {
            const measuredHeight = firstTaskEl.getBoundingClientRect().height + 8;
            if (measuredHeight > 0 && Math.abs(measuredHeight - this.estimatedTaskHeight) > 6) {
                this.estimatedTaskHeight = measuredHeight;
            }
        }

        // 触发标题滚动检测
        if (typeof applyMarqueeChecks === 'function') applyMarqueeChecks();
    }

    scheduleScrollRender() {
        if (this.scrollRenderRaf) return;
        this.scrollRenderRaf = requestAnimationFrame(() => {
            this.scrollRenderRaf = null;
            this.renderList();
        });
    }

    // Update specific task in DOM to avoid full re-render
    renderTask(task) {
        if (!this.listContainer) return;
        const taskEl = document.getElementById(`dl-task-${task.id}`);
        if (!taskEl) {
            const taskIndex = this.tasks.findIndex(t => t.id === task.id);
            if (taskIndex >= 0 && (taskIndex < this.renderedRange.start || taskIndex >= this.renderedRange.end)) return;
            // Task element doesn't exist (maybe switched views?), do full render
            this.renderList();
            return;
        }

        // Quick efficient replacement
        const div = document.createElement('div');
        div.innerHTML = this.renderTaskHtml(task);
        const newEl = div.firstElementChild;
        taskEl.parentNode.replaceChild(newEl, taskEl);
        // 触发标题滚动检测
        if (typeof applyMarqueeChecks === 'function') applyMarqueeChecks();
    }
}

// Global UI Toggles for Download Drawer
window.toggleDownloadDrawer = function () {
    if (window.SystemDownloadManager) {
        window.SystemDownloadManager.toggleDrawer();
    }
};

window.openDownloadManager = function () {
    if (window.SystemDownloadManager) {
        if (window.SystemDownloadManager.drawer.classList.contains('translate-x-full')) {
            window.SystemDownloadManager.toggleDrawer();
        }
    }
};

// Initialize globally
window.SystemDownloadManager = new DownloadManager();
