const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/music/app.js', 'utf8');
const slice = (startMarker, endMarker) => {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `missing ${startMarker}`);
    return source.slice(start, source.indexOf(endMarker, start));
};
const code = [
    slice('function playNext() {', '\nfunction playPrev('),
    slice('function cleanSongData(', '\n\n// Modified handler for Grid Buttons'),
    slice('function getNextIndex() {', '\n// 解析并缓存一首歌的播放链接'),
].join('\n');

const song = (id, name = `song${id}`) => ({ id, songmid: id, source: 'tx', name, singer: 'singer' });

function setup({ list, index, similar = [], settings = {}, playMode = 'list', armed = true, fetchImpl, timer = setTimeout }) {
    const context = vm.createContext({
        console: { log() {}, warn() {} },
        window: {},
        URLSearchParams, AbortController, setTimeout: timer, clearTimeout, performance,
        prefetchManager: { generation: 0, stop() { this.generation++; } },
        prefetchNextSong() {}, prefetchSongUrl: async () => true,
        API_BASE: '/api/music',
        settings, playMode,
        currentPlaylist: list, currentIndex: index, preSelectedNextIndex: null,
        searchRadioArmed: armed, searchRadioCache: null, searchRadioSongs: new WeakSet(),
        loadingRequestCounter: 0,
        getUserAuthHeaders: () => ({}),
        localStorage: { setItem() {} },
        showInfo() {},
        fetched: [], played: [], updated: null,
        fetch: fetchImpl || (async url => {
            context.fetched.push(url);
            return { ok: true, json: async () => ({ list: similar, strategy: 'similar' }) };
        }),
        playSong(item, i) { context.played.push(i); context.currentIndex = i; },
        updatePlaylist(newList, startIndex, scope) {
            context.updated = { ids: [...newList].map(s => s.id), startIndex, scope };
            context.currentPlaylist = newList;
            context.currentIndex = startIndex;
        },
    });
    vm.runInContext(code, context);
    return context;
}
const settle = () => new Promise(resolve => setTimeout(resolve, 10));

test('a song picked from search results is followed by similar songs, ahead of the remaining results', async () => {
    const c = setup({ list: [song('a'), song('b'), song('c')], index: 1, similar: [song('a'), song('x'), song('y'), song('x')] });
    c.playNext();
    await settle();
    assert.deepEqual(c.updated, { ids: ['a', 'b', 'x', 'y', 'c'], startIndex: 2, scope: 'network' });
    assert.equal(c.searchRadioArmed, true);
    assert.equal(c.fetched.length, 1);
    assert.match(c.fetched[0], /^\/api\/music\/similar\?source=tx&songId=&songmid=b&name=songb&singer=singer$/);
    assert.deepEqual(c.played, []);
});

test('inserted similar songs play in order, then the last one seeds the next batch', async () => {
    const c = setup({ list: [song('a'), song('b')], index: 0, similar: [song('x'), song('y')] });
    c.playNext();
    await settle();
    assert.deepEqual(c.updated.ids, ['a', 'x', 'y', 'b']);
    c.updated = null;
    c.playNext();
    await settle();
    assert.deepEqual(c.played, [2]);
    assert.equal(c.fetched.length, 1);
    c.playNext();
    await settle();
    assert.equal(c.fetched.length, 2);
    assert.match(c.fetched[1], /songmid=y/);
});

test('the last song of the queue also continues with similar songs', async () => {
    const c = setup({ list: [song('a'), song('b')], index: 1, similar: [song('x')] });
    c.playNext();
    await settle();
    assert.deepEqual(c.updated.ids, ['a', 'b', 'x']);
});

test('a default-list seed sends the numeric QQ id kept in meta', async () => {
    const seed = { id: 'tx_mid1', source: 'tx', name: 'n', singer: 's', meta: { songId: 'mid1', id: 97773 } };
    const c = setup({ list: [seed], index: 0, similar: [song('x')] });
    c.playNext();
    await settle();
    assert.match(c.fetched[0], /songId=97773&songmid=mid1/);
});

test('other play modes, non-search queues and the disabled setting keep normal behaviour', async () => {
    const cases = [
        { index: 1, playMode: 'random' },
        { index: 1, playMode: 'single' },
        { index: 1, armed: false },
        { index: 1, settings: { autoPlaySimilarAfterSearch: false } },
    ];
    for (const options of cases) {
        const c = setup({ list: [song('a'), song('b')], similar: [song('x')], ...options });
        c.playNext();
        await settle();
        assert.equal(c.fetched.length, 0, JSON.stringify(options));
        assert.equal(c.updated, null);
        assert.equal(c.played.length, 1);
    }
});

test('no usable similar songs or a failed request falls back to the play mode', async () => {
    const empty = setup({ list: [song('a'), song('b')], index: 1, similar: [song('a')] });
    empty.playNext();
    await settle();
    assert.deepEqual(empty.played, [0]);

    const failed = setup({
        list: [song('a'), song('b')], index: 1, playMode: 'order',
        fetchImpl: async () => ({ ok: false, status: 500 }),
    });
    failed.playNext();
    await settle();
    assert.deepEqual(failed.played, []);
    assert.equal(failed.updated, null);
    assert.equal(failed.searchRadioCache, null);
});

test('switching songs while the request is pending leaves the new playback alone', async () => {
    let release;
    const c = setup({
        list: [song('a'), song('b')], index: 1,
        fetchImpl: () => new Promise(resolve => {
            release = () => resolve({ ok: true, json: async () => ({ list: [song('x')] }) });
        }),
    });
    c.playNext();
    c.currentIndex = 0;
    release();
    await settle();
    assert.equal(c.updated, null);
    assert.deepEqual(c.played, []);
});

test('disliked songs are skipped and repeated triggers share one request', async () => {
    const c = setup({ list: [song('a')], index: 0, similar: [song('x'), song('y')] });
    c.window = { DislikeManager: { isDisliked: s => s.id === 'x' } };
    c.playNext();
    c.playNext();
    await settle();
    assert.equal(c.fetched.length, 1);
    assert.deepEqual(c.updated.ids, ['a', 'y']);
    assert.equal(c.searchRadioArmed, true);
});

test('a song the user queued as next plays before any similar songs', async () => {
    const c = setup({ list: [song('a'), song('b'), song('c')], index: 0, similar: [song('x')] });
    c.keepAsNextSong(c.currentPlaylist[1]);
    c.playNext();
    await settle();
    assert.equal(c.fetched.length, 0);
    assert.equal(c.updated, null);
    assert.deepEqual(c.played, [1]);
});

test('pausing while similar songs are being fetched cancels the automatic continuation', async () => {
    let release;
    const c = setup({
        list: [song('a'), song('b')], index: 1,
        fetchImpl: () => new Promise(resolve => {
            release = () => resolve({ ok: true, json: async () => ({ list: [song('x')] }) });
        }),
    });
    c.playNext();
    c.cancelSearchRadioContinuation();
    release();
    await settle();
    assert.equal(c.updated, null);
    assert.deepEqual(c.played, []);
});

test('similar songs restored with a saved queue are still recognised after a reload', async () => {
    const restored = { ...song('x'), _searchRadio: true };
    const c = setup({ list: [song('a'), restored, song('b')], index: 0, similar: [song('y')] });
    c.playNext();
    await settle();
    assert.equal(c.fetched.length, 0);
    assert.deepEqual(c.played, [1]);
});

test('playing something else and coming back to the same song cancels the pending continuation', async () => {
    let release;
    const c = setup({
        list: [song('a'), song('b')], index: 1,
        fetchImpl: () => new Promise(resolve => {
            release = () => resolve({ ok: true, json: async () => ({ list: [song('x')] }) });
        }),
    });
    c.playNext();
    c.loadingRequestCounter += 2; // the user played another song, then this one again
    release();
    await settle();
    assert.equal(c.updated, null);
    assert.deepEqual(c.played, []);
});


test('a successful but empty prefetch is retried when the song ends', async () => {
    let calls = 0;
    const c = setup({ list: [song('a'), song('b')], index: 0, fetchImpl: async () => ({
        ok: true, json: async () => ({ list: ++calls === 1 ? [] : [song('x')], strategy: 'radio' }),
    }) });
    await c.prefetchUpcomingSong();
    await c.continueWithSimilarSongs();
    assert.equal(calls, 2);
    assert.deepEqual(c.updated?.ids, ['a', 'x', 'b']);
    assert.deepEqual(c.played, []);
});

test('Next while prefetch is in flight gets at most one retry inside its remaining budget', async () => {
    let now = 0, firstReply, calls = 0;
    const timers = [];
    const c = setup({ list: [song('a'), song('b')], index: 0, fetchImpl: () => {
        if (++calls === 1) return new Promise(resolve => { firstReply = resolve; });
        return Promise.resolve({ ok: true, json: async () => ({ list: [] }) });
    } });
    c.performance = { now: () => now };
    c.setTimeout = (_, ms) => { timers.push(ms); return timers.length; };
    c.clearTimeout = () => {};
    const prefetch = c.prefetchUpcomingSong();
    const firstNext = c.continueWithSimilarSongs(), duplicateNext = c.continueWithSimilarSongs();
    now += 1000;
    firstReply({ ok: true, json: async () => ({ list: [] }) });
    await Promise.all([prefetch, firstNext, duplicateNext]);
    assert.equal(calls, 2);
    assert.equal(timers[1], timers[0] - 1000);
    assert.deepEqual(c.played, [1], 'only the latest transition may advance');
});

test('a stuck response body times out, aborts transport, and cannot insert tracks after fallback', async () => {
    let finishBody, signal, expire, budget;
    const c = setup({ list: [song('a'), song('b')], index: 0, fetchImpl: async (_, options) => {
        signal = options.signal;
        return { ok: true, json: () => new Promise(resolve => { finishBody = resolve; }) };
    } });
    c.setTimeout = (callback, ms) => { expire = callback; budget = ms; return 1; };
    c.clearTimeout = () => {};
    const next = c.continueWithSimilarSongs();
    await settle();
    assert.ok(expire && budget > 0 && budget <= 9000, 'bounded whole-request timeout');
    expire();
    await next;
    assert.equal(signal.aborted, true);
    assert.deepEqual(c.played, [1]);
    finishBody({ list: [song('too-late')] });
    await settle();
    assert.equal(c.updated, null);
    assert.equal(c.searchRadioCache, null);
});

test('same-artist fallback is labelled as such instead of as similar songs', async () => {
    let message;
    const c = setup({ list: [song('a')], index: 0, fetchImpl: async () => ({
        ok: true, json: async () => ({ list: [song('b')], strategy: 'artist' }),
    }) });
    c.showInfo = text => { message = text; };
    await c.continueWithSimilarSongs();
    assert.match(message, /同歌手/);
    assert.doesNotMatch(message, /相似歌曲/);
});

test('completed healthy pools last six hours, while thin and artist-only pools expire after one minute', async () => {
    for (const [strategy, count, ttl] of [['artist', 6, 60000], ['radio', 4, 60000], ['similar', 5, 21600000]]) {
        const seed = song('a');
        let now = 200, calls = 0;
        const c = setup({ list: [seed], index: 0, fetchImpl: async () => {
            calls++;
            return { ok: true, json: async () => ({ list: Array.from({ length: count }, (_, i) => song(i + 1)), strategy }) };
        } });
        c.performance = { now: () => now };
        await c.loadSearchRadioSongs(seed, { prefetch: true });
        now += ttl - 1;
        await c.loadSearchRadioSongs(seed);
        assert.equal(calls, 1, strategy);
        now++;
        await c.loadSearchRadioSongs(seed);
        assert.equal(calls, 2, strategy);
    }
});

test('an expired artist prefetch is retained for this play if a track-level refresh still misses', async () => {
    let now = 0, calls = 0;
    const c = setup({ list: [song('a'), song('b')], index: 0, fetchImpl: async () => ({
        ok: true, json: async () => ({ list: ++calls === 1 ? [song('x')] : [], strategy: 'artist' }),
    }) });
    c.performance = { now: () => now };
    await c.prefetchUpcomingSong();
    now += 60000;
    await c.continueWithSimilarSongs();
    assert.equal(calls, 2);
    assert.deepEqual(c.played, []);
    assert.deepEqual(c.updated.ids, ['a', 'x', 'b']);
});


test('a prepared track-related pool survives expiry during the same playback without waiting on failed or weaker providers', async () => {
    for (const status of [503, 200]) {
        let now = 0, calls = 0, preloaded;
        const c = setup({ list: [song('seed'), song('ordinary')], index: 0, fetchImpl: async () => {
            if (++calls === 1) return { ok: true, json: async () => ({ strategy: 'radio', list: [song('related')] }) };
            return { ok: status === 200, status, json: async () => ({ strategy: 'artist', list: [song('catalog')] }) };
        } });
        c.performance = { now: () => now };
        c.prefetchSongUrl = track => { preloaded = track.id; return true; };
        await c.prefetchUpcomingSong();
        now += 180000;
        await c.continueWithSimilarSongs();
        assert.equal(preloaded, 'related');
        assert.equal(calls, 1);
        assert.deepEqual(c.updated?.ids, ['seed', 'related', 'ordinary']);
    }
});

test('an expired playback-specific pick cannot cross a replay, dislike change, or manual next', async () => {
    for (const action of ['replay', 'dislike', 'manual-next', 'pause']) {
        let now = 0, calls = 0;
        const c = setup({ list: [song('seed'), song('ordinary')], index: 0, fetchImpl: async () => ({
            ok: true, json: async () => ({ strategy: 'radio', list: ++calls === 1 ? [song('related')] : [] }),
        }) });
        c.performance = { now: () => now };
        await c.prefetchUpcomingSong();
        now += 180000;
        if (action === 'replay') c.loadingRequestCounter++;
        if (action === 'dislike') c.window = { DislikeManager: { isDisliked: track => track.id === 'related' } };
        if (action === 'manual-next') c.keepAsNextSong(c.currentPlaylist[1]);
        c.playNext();
        if (action === 'pause') c.cancelSearchRadioContinuation();
        await settle();
        assert.equal(c.updated, null, action);
        assert.deepEqual(c.played, action === 'pause' ? [] : [1], action);
    }
});

test('pool truncated by provider deadline expires after a minute even if it has many matches', async () => {
    const seed = song('seed');
    let now = 0, calls = 0;
    const c = setup({ list: [seed], index: 0, fetchImpl: async () => {
        calls++;
        return {ok:true, json:async()=>({strategy:'radio', incomplete:true, list:Array.from({length:8},(_,i)=>song(i+1))})};
    } });
    c.performance = { now: () => now };
    await c.loadSearchRadioSongs(seed); now += 60000; await c.loadSearchRadioSongs(seed);
    assert.equal(calls, 2);
});

test('insertion preserves distinct provider IDs, deduplicates same-source quality and reselects the intended recording', async () => {
    const seed = {...song(1000), source:'wy', name:'Seed'};
    const other = {...song(1000), source:'kg', name:'Related'};
    const c = setup({list:[seed], index:0, similar:[other], settings:{deduplicatePlaylistByQuality:true}});
    c.window.QualityManager = {QUALITY_PRIORITY:['flac','128k']};
    c.document = { getElementById: () => ({ classList: { contains: () => true } }) };
    const selected = [];
    c.playSong = (track, index) => { selected.push(track); c.currentIndex = index; };
    vm.runInContext(slice('function updatePlaylist(list,', '\nwindow.updatePlaylist ='), c);
    await c.continueWithSimilarSongs();
    assert.equal(selected[0], other);
    assert.deepEqual(Array.from(c.currentPlaylist), [seed, other]);
    const better = {...other,quality:'flac'};
    c.updatePlaylist([seed,other,better],1,'network');
    assert.deepEqual(Array.from(c.currentPlaylist), [seed,better]);
    assert.equal(selected[1], better);
});


test('a failed media prefetch cannot pin an expired pick ahead of fresh recommendations', async () => {
    let now = 0, calls = 0;
    const c = setup({list:[song('seed')], index:0, fetchImpl: async () => ({ ok:true,
        json:async()=>({strategy:'radio', list:[song(++calls === 1 ? 'not-ready' : 'fresh-related')]}) })});
    c.performance = {now:()=>now};
    c.prefetchSongUrl = async () => { throw new Error('no usable audio'); };
    await c.prefetchUpcomingSong();
    now += 180000;
    await c.continueWithSimilarSongs();
    assert.deepEqual(c.updated?.ids, ['seed','fresh-related']);
});

test('radio pins only confirmed media for this play, including on a retry or quality change', async t => {
    for (const scenario of ['quality changed', 'both URLs dead', 'retry works', 'first URL works', 'cached URL works']) {
        await t.test(scenario, async () => {
            let now = 0, calls = 0, resolves = 0;
            const probes = [], writes = [];
            const c = setup({ list: [song('seed')], index: 0, settings: { preferredQuality: 'flac' },
                fetchImpl: async () => ({ ok: true, json: async () => ({
                    strategy: 'radio', list: [song(++calls === 1 ? 'first' : 'refreshed')],
                }) }),
            });
            c.performance = { now: () => now };
            c.window.QualityManager = { getBestQuality: (_track, quality) => quality };
            c.prefetchManager.get = () => scenario === 'cached URL works' ? { url: 'cached' } : null;
            c.prefetchManager.set = (_track, _quality, media) => writes.push(media.url);
            c.localStorage.removeItem = () => {};
            c.getSourceTypeText = () => '';
            c.resolveSongUrl = async () => {
                if (scenario === 'quality changed') c.settings.preferredQuality = '128k';
                return { url: ++resolves === 1 ? 'original' : 'replacement' };
            };
            c.probeUrl = async url => {
                probes.push(url);
                return scenario === 'first URL works' || scenario === 'cached URL works' ||
                    (scenario === 'retry works' && url === 'replacement');
            };
            vm.runInContext(slice('async function prefetchSongUrl(', '\n// --- Server Cache Helpers'), c);
            await c.prefetchUpcomingSong();
            now += 180000; // the single-item pool has expired
            await c.continueWithSimilarSongs();
            const ready = ['first URL works', 'retry works', 'cached URL works'].includes(scenario);
            assert.equal(calls, ready ? 1 : 2);
            assert.deepEqual(c.updated?.ids, ['seed', ready ? 'first' : 'refreshed']);
            assert.deepEqual(writes, !ready ? [] : [scenario === 'retry works' ? 'replacement' :
                scenario === 'cached URL works' ? 'cached' : 'original']);
            assert.deepEqual(probes, scenario === 'quality changed' ? [] : scenario === 'first URL works' ?
                ['original'] : scenario === 'cached URL works' ? ['cached'] : ['original', 'replacement']);
        });
    }
});

test('saving and restoring a recommendation queue preserves the next-song identity', async () => {
    const c = setup({ list: [song('a'), song('b')], index: 0, similar: [song('x'), song('y')] });
    c.playNext();
    await settle();
    let saved;
    Object.assign(c, { currentPlayingSong: c.currentPlaylist[1], currentPlayingScope: 'network',
        currentQuality: 'flac', audio: { currentTime: 4 },
        localStorage: { setItem(key, value) { saved = value; } } });
    vm.runInContext(slice('function savePlaybackState() {', '\nasync function restorePlaybackState()'), c);
    assert.equal(c.savePlaybackState(), true);
    const state = JSON.parse(saved);
    const restored = setup({ list: state.playlist, index: state.index, similar: [song('z')] });
    restored.playNext();
    await settle();
    assert.equal(restored.fetched.length, 0);
    assert.deepEqual(restored.played, [2]);
});

test('explicit play-next identity also survives JSON persistence', async () => {
    const c = setup({ list: [song('a'), song('b')], index: 0 });
    c.keepAsNextSong(c.currentPlaylist[1]);
    const restored = setup({ list: JSON.parse(JSON.stringify(c.currentPlaylist)), index: 0 });
    restored.playNext();
    await settle();
    assert.equal(restored.fetched.length, 0);
    assert.deepEqual(restored.played, [1]);
});

test('device-disconnect pause cancels pending radio continuation before pausing', () => {
    const deviceHandler = slice('const handleDeviceChange = async () => {', "navigator.mediaDevices.addEventListener");
    assert.match(deviceHandler, /cancelSearchRadioContinuation\(\);\s*audio.pause\(\)/);
});

test('recommendation deadline covers both fetch and JSON and lets the original queue continue', async () => {
    for (const phase of ['fetch', 'json']) {
        let signal;
        const c = setup({ list: [song('a'), song('b')], index: 0,
            timer: fn => setTimeout(fn, 20),
            fetchImpl: async (_url, options) => { signal = options.signal;
                return phase === 'fetch' ? new Promise(() => {}) : { ok: true, json: () => new Promise(() => {}) };
            },
        });
        c.playNext();
        await new Promise(resolve => setTimeout(resolve, 60));
        assert.equal(c.searchRadioCache, null);
        assert.equal(signal?.aborted, true);
        assert.deepEqual(c.played, [1]);
    }
});
test('quality deduplication and starting position preserve same raw IDs across platforms', () => {
    const c = setup({ list: [], index: 0, settings: { deduplicatePlaylistByQuality: true } });
    c.window.QualityManager = { QUALITY_PRIORITY: ['flac', '320k', '128k'] };
    c.document = { getElementById: () => ({ classList: { contains: () => true } }) };
    c.renderQueue = () => {};
    vm.runInContext(slice('function updatePlaylist(', '\nfunction ',), c);
    const first = { ...song('123'), source: 'kw' }, next = { ...song('123'), source: 'wy' };
    c.updatePlaylist([first, next], 1, 'network');
    assert.equal(c.currentPlaylist.length, 2);
    assert.deepEqual(c.played, [1]);
});

test('a timed-out old recommendation does not evict a newer seed request', async () => {
    const timers = [];
    const c = setup({ list: [song('a')], index: 0, timer: fn => { timers.push(fn); return timers.length; },
        fetchImpl: () => new Promise(() => {}) });
    const first = c.loadSearchRadioSongs(song('a'));
    const second = c.loadSearchRadioSongs(song('b'));
    timers[0](); await first;
    assert.equal(c.searchRadioCache.promise, second);
    timers[1](); await second;
    assert.equal(c.searchRadioCache, null);
});
