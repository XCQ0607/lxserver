// 聚合搜索：把各平台上的同一首歌并成一条，并在播放 / 下载时挑选音质合适、最快的那个平台。
// 合并后的条目仍是一首普通歌曲（排名最靠前的那个平台的条目），其余平台的条目挂在 _alternates 上。
(function () {
    const STATS_KEY = 'lx_source_stats';
    // 两个平台的时长相差超过这个秒数，就当作不同版本（Live、重录等），不合并
    const MAX_DURATION_DIFF = 3;
    // 同一档音质在不同平台上的不同叫法：24bit 无损在酷我 / 酷狗 / 咪咕只叫 flac24bit，QQ / 网易同时叫 hires
    const QUALITY_ALIASES = [['hires', 'flac24bit']];

    const fold = text => String(text || '').normalize('NFKC').toLowerCase();
    // 只去掉空白和标点，括号里的附注保留：「晴天」和「晴天 (Live)」是不同的键
    const compact = text => fold(text).replace(/[\s·・,，.。!！?？:：;；'"‘’“”《》<>【】[\]()（）\-_/\\]/g, '');
    // 歌手名：去掉括号里的别名（「周杰伦 (Jay Chou)」→「周杰伦」）再按分隔符拆开
    const singerParts = text => fold(text).replace(/[（(\[【].*?[）)\]】]/g, ' ').split(/[、,，/&／|;；]+| feat\.? | ft\.? /).map(compact).filter(Boolean);
    const seconds = interval => {
        const parts = String(interval || '').split(':').map(Number);
        if (parts.length < 2 || parts.some(Number.isNaN)) return 0;
        return parts.reduce((total, part) => total * 60 + part, 0);
    };

    function singersOverlap(a, b) {
        const left = new Set(singerParts(a)), right = new Set(singerParts(b));
        return left.size > 0 && left.size === right.size && [...left].every(name => right.has(name));
    }

    function sameSong(a, b) {
        const name = compact(a.name);
        if (!name || name !== compact(b.name)) return false;
        if (!singersOverlap(a.singer, b.singer)) return false;
        const da = seconds(a.interval), db = seconds(b.interval);
        // 两边都要有时长才比得出是不是同一版；缺时长的条目各占一行，不合并
        return da > 0 && db > 0 && Math.abs(da - db) <= MAX_DURATION_DIFF;
    }

    const sources = song => (song ? [song, ...(song._alternates || [])] : []);

    // 把 incoming 并入 list：同一首歌且该平台还没出现过的，挂到已有条目上；其余按原顺序追加。
    // 若提供 preferredSources，则同组内优先级更高的平台会成为主条目（行位置不变），其余按优先级排在 _alternates 中。
    function mergeInto(list, incoming, options = {}) {
        const result = list.slice();
        const preferred = Array.isArray(options?.preferredSources) && options.preferredSources.length
            ? options.preferredSources : null;
        const rankOf = source => {
            if (!preferred) return Infinity;
            const idx = preferred.indexOf(source);
            return idx >= 0 ? idx : preferred.length;
        };
        const byName = new Map();
        const index = entry => {
            const key = compact(entry.name);
            if (!byName.has(key)) byName.set(key, []);
            byName.get(key).push(entry);
        };
        result.forEach(index);
        for (const song of incoming) {
            const key = compact(song.name);
            const bucket = byName.get(key) || [];
            const host = bucket.find(entry =>
                sources(entry).every(member => member.source !== song.source && sameSong(member, song)));
            if (host) {
                if (preferred && rankOf(song.source) < rankOf(host.source)) {
                    const oldAlternates = host._alternates || [];
                    const demotedHost = { ...host };
                    delete demotedHost._alternates;
                    const mergedAlternates = [demotedHost, ...oldAlternates]
                        .sort((a, b) => rankOf(a.source) - rankOf(b.source));
                    const promoted = { ...song, _alternates: mergedAlternates };
                    const resultIdx = result.indexOf(host);
                    if (resultIdx >= 0) result[resultIdx] = promoted;
                    const bucketIdx = bucket.indexOf(host);
                    if (bucketIdx >= 0) bucket[bucketIdx] = promoted;
                } else {
                    const nextAlternates = [...(host._alternates || []), song];
                    if (preferred) nextAlternates.sort((a, b) => rankOf(a.source) - rankOf(b.source));
                    host._alternates = nextAlternates;
                }
            } else {
                result.push(song);
                index(song);
            }
        }
        return result;
    }

    // 这个平台条目上与所选音质同档的音质名：自身有就原样返回，否则找同档的别名；都没有返回 null
    function qualityFor(member, quality, ownQualities) {
        const own = ownQualities ? ownQualities(member) : null;
        if (!own || own.includes(quality)) return quality;
        const group = QUALITY_ALIASES.find(names => names.includes(quality));
        return (group && group.find(name => own.includes(name))) || null;
    }

    function readStats() {
        try {
            return JSON.parse(localStorage.getItem(STATS_KEY) || '{}') || {};
        } catch (e) {
            return {};
        }
    }

    // 记录一次在线解析的结果：成功率和耗时都用滑动平均，近期表现权重更大
    function record(source, ok, ms) {
        if (!source) return;
        const stats = readStats();
        const entry = stats[source] || { rate: 1, ms: 0, count: 0 };
        entry.rate = entry.rate * 0.7 + (ok ? 0.3 : 0);
        if (ok && ms > 0) entry.ms = entry.ms ? entry.ms * 0.7 + ms * 0.3 : ms;
        entry.count++;
        stats[source] = entry;
        try {
            localStorage.setItem(STATS_KEY, JSON.stringify(stats));
        } catch (e) { /* 存储不可用时不记录 */ }
    }

    // 按「有这个音质 → 解析源支持该平台 → 历史成功率 → 历史耗时 → 搜索排名」给各平台的条目排序。
    // ownQualities(song) 返回该条目自身的音质；supported 为 null 表示不知道哪些平台可解析。
    function order(song, quality, { ownQualities, supported = null } = {}) {
        const members = sources(song);
        if (members.length < 2) return members;
        const stats = readStats();
        const scored = members.map((member, rank) => {
            const entry = stats[member.source] || {};
            return {
                member, rank,
                hasQuality: qualityFor(member, quality, ownQualities) !== null,
                isSupported: !supported || supported.has(member.source),
                // 没试过的平台按满分、零耗时算，先给一次机会，之后才有真实数据可比
                rate: entry.count ? Math.round(entry.rate * 10) / 10 : 1,
                ms: entry.ms || 0,
            };
        });
        return scored.sort((a, b) =>
            (b.hasQuality - a.hasQuality) || (b.isSupported - a.isSupported) ||
            (b.rate - a.rate) || (a.ms - b.ms) || (a.rank - b.rank)
        ).map(entry => entry.member);
    }

    // 播放 / 下载时要依次尝试的平台条目：只留有该音质的（都没有时全部保留），顺序见 order()
    async function candidates(song, quality) {
        const ownQualities = window.QualityManager && window.QualityManager.getOwnQualities;
        let supported = null;
        let timeout;
        try {
            supported = api.getSupportedPlatforms ? await Promise.race([
                Promise.resolve().then(() => api.getSupportedPlatforms()),
                new Promise(resolve => { timeout = setTimeout(() => resolve(null), 3000); }),
            ]) : null;
        } catch (e) { /* 不知道哪些平台可解析时不按这一项排序 */ }
        finally { clearTimeout(timeout); }
        const ordered = order(song, quality, { ownQualities, supported });
        if (!ownQualities) return ordered;
        const capable = ordered.filter(member => qualityFor(member, quality, ownQualities) !== null);
        return capable.length ? capable : ordered;
    }

    // 向某个平台条目请求所选音质时该用的音质名（该平台没有这一档时仍返回所选音质）
    const requestQuality = (member, quality) =>
        qualityFor(member, quality, window.QualityManager && window.QualityManager.getOwnQualities) || quality;

    // getSupportedPlatforms 由 app.js 提供：返回解析源支持的平台 Set，未知时返回 null
    const api = { mergeInto, sameSong, sources, order, record, candidates, requestQuality, getSupportedPlatforms: null };
    window.SongMerge = api;
})();
