/**
 * Dislike Manager for LX Music Web
 * 不喜欢管理模块
 *
 * 与 Subsonic 评分联动，读写同一份 lx-music 原生 dislike 规则：
 *   歌名@歌手                    → 精确屏蔽一首歌
 *   歌名                         → 屏蔽所有同名（翻唱 / 多版本）
 *   @歌手                        → 屏蔽该歌手全部歌曲
 *   !<专辑名>@<歌手> → 屏蔽整张专辑
 *
 * 规则由服务端统一解析（/api/music/dislike），这里只做前端判定与增删，
 * 归一化规则与 src/modules/dislike/match.ts 保持一致。
 */
window.DislikeManager = (function () {
    const API_BASE = '/api/music/dislike';

    const state = {
        initialized: false,
        loading: false,
        exact: new Set(),
        musicNames: new Set(),
        singerNames: new Set(),
        albums: [], // [{ albumName, singers: [] }]
        // 匹配选项由服务端下发，保证前后端判定一致
        crossSource: false,
        duetMode: 'any', // any | all | primary
        normalizeName: true,
        requireSinger: true,
    };

    /** 归一化：与服务端一致（@ → #、去空格、小写） */
    const normalize = (v) => String(v ?? '').replaceAll('@', '#').trim().toLowerCase();

    /** 拆分歌手：「A、B」「A,B」「A/B」「A feat.B」「A & B」 */
    const splitSingers = (singer) =>
        String(singer ?? '')
            .split(/[、,，\/]|\s*(?:feat\.?|ft\.?|featuring|&|;)\s*/i)
            .map((s) => normalize(s))
            .filter(Boolean);

    /**
     * 歌名归一化：剥离常见版本后缀，与服务端 normalizeSongName 保持一致。
     * 「晴天 (Live)」→「晴天」
     */
    // 与 src/server/utils/songVersion.ts 的 VERSION_SUFFIX_RE 保持一致：支持括号内与无括号连字符两种形式
    const VERSION_SUFFIX_RE =
        /(?:[\s\-–—_]*[（(](?:live|remix|现场|伴奏|纯音乐|demo|翻唱|acoustic|instrumental|off\s*vocal|版)[^）)]*[）)]|[\s]*[-–—]\s*(?:live|remix|现场|伴奏|纯音乐|demo|翻唱|acoustic|instrumental|off\s*vocal))\s*$/i;
    const normalizeSongName = (v) => normalize(v).replace(VERSION_SUFFIX_RE, '').trim();

    const getAlbumName = (song) => song?.albumName ?? song?.meta?.albumName ?? song?.album ?? '';

    async function request(url, payload) {
        const headers = { ...(typeof getUserAuthHeaders === 'function' ? getUserAuthHeaders() : {}) };
        if (payload) headers['Content-Type'] = 'application/json';
        const res = await fetch(url, {
            method: payload ? 'POST' : 'GET',
            headers,
            body: payload ? JSON.stringify(payload) : undefined,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    }

    function applyData(data, options) {
        state.exact = new Set(data?.exact || []);
        state.musicNames = new Set(data?.musicNames || []);
        state.singerNames = new Set(data?.singerNames || []);
        state.albums = data?.albums || [];
        if (options) {
            state.crossSource = !!options.crossSource;
            state.duetMode = options.duetMode || 'any';
            state.normalizeName = options.normalizeName !== false;
            state.requireSinger = options.requireSinger !== false;
        }
        state.initialized = true;
    }

    /** 拉取规则（已加载过则直接返回，force=true 强制刷新） */
    async function load(force) {
        if (state.initialized && !force) return state;
        if (state.loading) return state;
        state.loading = true;
        try {
            const r = await request(API_BASE);
            if (r && r.success) applyData(r.data, r.options);
        } catch (e) {
            console.error('[Dislike] load failed:', e);
        } finally {
            state.loading = false;
        }
        return state;
    }

    /** 判定一首歌是否命中不喜欢规则 */
    function isDisliked(song) {
        if (!song) return false;
        const name = normalize(song.name);
        const allSingers = splitSingers(song.singer);
        // primary 模式只看主唱（第一位歌手）
        const singers = state.duetMode === 'primary' ? allSingers.slice(0, 1) : allSingers;
        // 候选歌名：原名 + 去后缀名（去重），提升 Live / Remix 版本召回
        const candidateNames = Array.from(
            new Set([name, state.normalizeName ? normalizeSongName(song.name) : ''].filter(Boolean))
        );

        // 1. 专辑维度（专辑名 + 歌手 双重校验）
        // 服务端 serializeDislikeRules 仅返回 { albumName, singers }，故按专辑名匹配
        const albumName = getAlbumName(song);
        if (albumName) {
            const an = normalize(albumName);
            for (const alb of state.albums) {
                if (normalize(alb.albumName ?? '') !== an) continue;
                if (alb.singers && alb.singers.length) {
                    if (!singers.length) {
                        // 歌曲没有歌手信息：requireSinger 时无法确认，保守放过
                        if (state.requireSinger) continue;
                    } else {
                        const albumSingers = alb.singers.map((s) =>
                            state.normalizeName ? normalizeSongName(s) : normalize(s)
                        );
                        const hit = singers.some((x) =>
                            albumSingers.some((a) => x === a || x.includes(a) || a.includes(x))
                        );
                        if (!hit) continue;
                    }
                }
                return true;
            }
        }

        // 2. 歌手维度
        if (singers.length) {
            if (state.duetMode === 'all') {
                // all：所有歌手都被屏蔽才算命中，避免牵连合作者
                if (singers.every((s) => state.singerNames.has(s))) return true;
            } else {
                for (const s of singers) {
                    if (state.singerNames.has(s)) return true;
                }
            }
        }

        // 3. 歌曲维度（歌名 + 歌手 双重校验）
        for (const n of candidateNames) {
            if (!n) continue;
            // 纯歌名规则：requireSinger 时不单独命中，避免同名歌被误杀
            if (state.musicNames.has(n) && !state.requireSinger) return true;
            if (singers.length) {
                if (state.duetMode === 'all') {
                    if (singers.every((s) => state.exact.has(`${n}@${s}`))) return true;
                } else {
                    for (const s of singers) {
                        if (state.exact.has(`${n}@${s}`)) return true;
                    }
                }
            }
        }

        return false;
    }

    async function mutate(action, payload) {
        const r = await request(`${API_BASE}/${action}`, payload);
        if (r && r.success) applyData(r.data, r.options);
        return !!(r && r.success);
    }

    const addSong = (song) => mutate('add', { type: 'song', name: song?.name || '', singer: song?.singer || '', source: song?.source || '', id: song?.id || '' });
    const removeSong = (song) => mutate('remove', { type: 'song', name: song?.name || '', singer: song?.singer || '', source: song?.source || '', id: song?.id || '' });
    const addSinger = (singer) => mutate('add', { type: 'singer', singer: singer || '' });
    const removeSinger = (singer) => mutate('remove', { type: 'singer', singer: singer || '' });
    const addAlbum = (song) =>
        mutate('add', { type: 'album', albumName: getAlbumName(song), singer: song?.singer || '' });
    const removeAlbum = (song) =>
        mutate('remove', { type: 'album', albumName: getAlbumName(song), singer: song?.singer || '' });

    /** 切换某首歌的不喜欢状态 */
    async function toggleSong(song) {
        await load();
        return isDisliked(song) ? removeSong(song) : addSong(song);
    }

    return {
        load,
        isDisliked,
        addSong,
        removeSong,
        addSinger,
        removeSinger,
        addAlbum,
        removeAlbum,
        toggleSong,
        get state() {
            return state;
        },
    };
})();
