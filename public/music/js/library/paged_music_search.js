// One page per provider per round. Previously displayed rounds never move.
(function () {
    const normalize = text => String(text || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
    function identity(song) {
        const source = song.source || '';
        const id = song.songmid ?? song.songId ?? song.hash ?? song.mid ?? song.copyrightId ?? song.id;
        return `${source}:${id == null ? `${normalize(song.name)}:${normalize(song.singer)}:${song.interval || ''}` : String(id)}`;
    }
    function relevance(song, keyword) {
        const query = normalize(keyword), name = normalize(song.name), singer = normalize(song.singer);
        if (name === query) return 4;
        // Artist names only participate when the query actually names an artist.
        const full = `${name} ${singer}`;
        if (full === query || `${singer} ${name}` === query) return 4;
        if (name.includes(query)) return 3;
        const tokens = query.split(' ').filter(Boolean);
        if (tokens.length > 1 && tokens.every(token => full.includes(token))) return 3;
        if (singer === query || singer.includes(query)) return 2;
        return 1;
    }
    function rankBatch(groups, keyword) {
        // Relevance tier, provider rank, then provider order: equal title matches
        // alternate sources without favouring short singer names.
        return groups.flatMap((group, sourceIndex) => group.map((song, rank) => ({
            song, rank, sourceIndex, relevance: relevance(song, keyword),
        }))).sort((a, b) => b.relevance - a.relevance || a.rank - b.rank || a.sourceIndex - b.sourceIndex).map(entry => entry.song);
    }
    function create({ keyword, sources, limit = 30 }) {
        const state = {
            keyword, sources: sources.slice(), list: [], loading: false, rounds: 0,
            providers: sources.map(source => ({ source, page: 0, done: false, error: '', seen: new Set() })),
        };
        let pending = null;
        async function load({ fetchPage, current = () => true, progress = () => {} }) {
            if (pending) return pending;
            const providers = state.providers.filter(provider => !provider.done);
            if (!providers.length) return state;
            state.loading = true;
            pending = (async () => {
                let completed = 0;
                const results = await Promise.all(providers.map(async provider => {
                    try {
                        const data = await fetchPage(provider.source, provider.page + 1, limit);
                        if (!data || data.error || !Array.isArray(data.list)) throw new Error('音源返回的数据格式错误');
                        return { provider, data };
                    } catch (error) {
                        return { provider, error: error.message || '请求失败' };
                    } finally {
                        completed++;
                        if (current()) progress(completed, providers.length);
                    }
                }));
                // Commit the whole round only if its search still owns the view.
                if (!current()) return state;
                const groups = results.map(({ provider, data, error }) => {
                    if (error) { provider.error = error; return []; }
                    provider.error = '';
                    provider.page++;
                    const fresh = [];
                    for (const raw of data.list) {
                        const song = { ...raw, source: provider.source };
                        const key = identity(song);
                        if (provider.seen.has(key)) continue;
                        provider.seen.add(key);
                        // Namespace IDs for batch selection and independently numbered providers.
                        const rawId = song.songmid ?? song.songId ?? song.hash ?? song.mid ?? song.copyrightId ?? song.id ?? key;
                        song.id = String(rawId).startsWith(`${song.source}_`) ? String(rawId) : `${song.source}_${rawId}`;
                        fresh.push(song);
                    }
                    provider.done = !fresh.length || data.hasMore === false ||
                        (Number.isFinite(data.allPage) && provider.page >= data.allPage);
                    return fresh;
                });
                state.list = state.list.concat(rankBatch(groups, keyword));
                state.rounds++;
                return state;
            })();
            try { return await pending; }
            finally { state.loading = false; pending = null; }
        }
        return { state, load };
    }
    window.PagedMusicSearch = { create, identity, rankBatch, relevance };
})();
