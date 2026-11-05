/**
 * 服务器本地文件状态
 * 一次 /api/music/cache/list 建立 "歌曲ID -> { 音质: 所在目录 }" 映射，
 * 供搜索结果徽标、下载弹窗的音质标注复用，避免每首歌每个音质都打一次 check。
 */
const SERVER_FILE_STATE_TTL = 60 * 1000;

window.ServerFileState = {
    bySong: new Map(),
    lastLoad: 0,
    loading: null,
    unavailable: false,

    // 与服务端 normalizeSongId 保持一致：songmid > songId > id，缺前缀时补 source_
    songKey(song) {
        let id = String((song && (song.songmid || song.songId || song.id)) || '');
        const source = song && song.source;
        if (id && !id.includes('_') && source) id = `${source}_${id}`;
        return id;
    },

    invalidate() {
        this.lastLoad = 0;
    },

    /**
     * @param {boolean} force 忽略 TTL 重新拉取
     * @returns {Promise<boolean>} 映射是否可用
     */
    async ensure(force = false) {
        const now = Date.now();
        if (!force && this.lastLoad && now - this.lastLoad < SERVER_FILE_STATE_TTL) return !this.unavailable;
        if (this.loading) return this.loading;

        this.loading = (async () => {
            try {
                const headers = window.getUserAuthHeaders ? window.getUserAuthHeaders() : {};
                const res = await fetch('/api/music/cache/list', { headers });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (!data.success || !Array.isArray(data.data)) throw new Error(data.message || '列表格式异常');

                const map = new Map();
                for (const item of data.data) {
                    const id = item.id || this.songKey(item);
                    if (!id) continue;
                    if (!map.has(id)) map.set(id, {});
                    const quality = item.quality || 'unknown';
                    // 同一音质两处都有时，下载目录优先（与服务端播放优先级一致）
                    const current = map.get(id)[quality];
                    if (current && current.folder === 'music') continue;
                    map.get(id)[quality] = { folder: item.folder === 'music' ? 'music' : 'cache', filename: item.filename };
                }
                this.bySong = map;
                this.unavailable = false;
                this.lastLoad = Date.now();
                return true;
            } catch (e) {
                console.warn('[ServerFileState] 拉取服务器文件列表失败，音质状态将改按单曲查询:', e.message);
                this.unavailable = true;
                this.lastLoad = Date.now();
                return false;
            } finally {
                this.loading = null;
            }
        })();
        return this.loading;
    },

    /**
     * 同步读取该歌已存在的音质：{ 音质: 'cache' | 'music' }
     * 返回 null 表示映射不可用（调用方应改用 foldersByCheck），空对象表示确实一首都没有
     */
    foldersFor(song) {
        return this.foldersForKey(this.songKey(song));
    },

    foldersForKey(key) {
        if (this.unavailable) return null;
        const entries = this.bySong.get(key);
        if (!entries) return {};
        const out = {};
        for (const [quality, info] of Object.entries(entries)) out[quality] = info.folder;
        return out;
    },

    /** 该歌某音质在服务器上的落点；没有则返回 null */
    locate(key, quality) {
        if (this.unavailable) return null;
        const info = (this.bySong.get(key) || {})[quality];
        return info ? { ...info, key } : null;
    },

    /**
     * 弹窗兜底：映射不可用时逐音质问 /api/music/cache/check
     * @returns {Promise<Object>} { 音质: 'cache' | 'music' }
     */
    async foldersByCheck(song, qualities) {
        const out = {};
        if (!window.checkServerCache) return out;
        await Promise.all(qualities.map(async q => {
            const r = await window.checkServerCache(song, q, true);
            if (r && r.exists && !r.isCollision) out[q] = r.folder === 'music' ? 'music' : 'cache';
        }));
        return out;
    },

    stateText(folder) {
        return folder === 'music' ? '服务器已下载' : '服务器已缓存';
    },

    qualityName(quality) {
        return window.QualityManager?.getQualityDisplayName(quality) || quality;
    },

    /** 列表徽标：一个综合标记 + 悬停列出全部已存在音质 */
    describeKey(key) {
        const folders = this.foldersForKey(key);
        if (!folders) return null;
        const entries = Object.entries(folders);
        if (entries.length === 0) return null;

        const priority = (window.QualityManager && window.QualityManager.QUALITY_PRIORITY) || [];
        const rank = q => {
            const i = priority.indexOf(q);
            return i === -1 ? 99 : i;
        };
        const ranked = [...entries].sort((a, b) => rank(a[0]) - rank(b[0]));
        const musicHit = ranked.find(e => e[1] === 'music');
        return {
            text: musicHit ? '已下载' : '已缓存',
            folder: musicHit ? 'music' : 'cache',
            title: ranked.map(([q, f]) => `${this.qualityName(q)} ${f === 'music' ? '已下载' : '已缓存'}`).join(' · ')
        };
    },

    describe(song) {
        return this.describeKey(this.songKey(song));
    },

    badgeHtmlFor(key) {
        const info = this.describeKey(key);
        if (!info) return '';
        const cls = info.folder === 'music'
            ? 't-badge-blue border-blue-200 dark:border-blue-500/30'
            : 't-badge-green border-emerald-200 dark:border-emerald-500/30';
        return `<span class="song-tag ${cls} transition-colors cursor-help" title="${info.title}">${info.text}</span>`;
    },

    badgeHtml(song) {
        return this.badgeHtmlFor(this.songKey(song));
    },

    repaintNodes(nodes) {
        [].forEach.call(nodes, node => {
            node.innerHTML = this.badgeHtmlFor(node.dataset.serverBadge || '');
        });
    },

    /** 首次渲染后填充徽标（映射未就绪时会自动拉一次） */
    paintBadges(container) {
        if (!container || container.querySelectorAll('[data-server-badge]').length === 0) return;
        this.ensure().then(ok => {
            if (!ok) return;
            const target = document.contains(container) ? container : document;
            this.repaintNodes(target.querySelectorAll('[data-server-badge]'));
        });
    },

    /** 服务器文件发生变化后，强制重拉并刷新页面上已有的徽标 */
    async repaintAll() {
        this.invalidate();
        // 若有请求在飞，先等它结束，避免复用到失效前发出的旧结果
        if (this.loading) {
            try { await this.loading; } catch (e) { }
            this.lastLoad = 0;
        }
        const ok = await this.ensure(true);
        if (!ok) return;
        // 节点必须在数据回来之后再查：期间列表可能已重渲染，旧节点会被丢弃
        this.repaintNodes(document.querySelectorAll('[data-server-badge]'));
    }
};

console.log('[ServerFileState] 服务器文件状态模块已加载');
