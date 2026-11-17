const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/music/app.js', 'utf8');
const start = source.indexOf('async function refreshPrefetchedCache(');
const end = source.indexOf('\n/**', start);

function setup(cached, preferServerCache = true) {
    const calls = [];
    const context = vm.createContext({
        settings: { preferServerCache }, console, AbortSignal,
        cleanSongData: song => song,
        checkServerCache: async (...args) => {
            calls.push(args);
            if (cached instanceof Error) throw cached;
            return cached;
        },
        applyAutoProxy: async url => `proxy:${url}`,
        checkAndTriggerBackgroundCacheUpgrade() {}
    });
    vm.runInContext(source.slice(start, end), context);
    return { refresh: context.refreshPrefetchedCache, calls };
}

const song = { id: '1', source: 'wy' };
const online = { url: 'https://online/song', sourceType: 'normal', quality: 'flac', isPrefetch: true };
class FakeAudio {
    src = '';
    load() {}
    removeAttribute() { this.src = ''; }
}

test('playback rechecks completed cache and preserves switched song identity', async () => {
    const { refresh, calls } = setup({ exists: true, url: '/cached', quality: '320k', folder: 'music' });
    const switched = { id: '2', source: 'tx' };
    const result = await refresh(song, { ...online, switchedSource: true, songInfo: switched });
    assert.equal(calls[0][0], switched);
    assert.equal(calls[0][3], false);
    assert.ok(calls[0][4] instanceof AbortSignal);
    assert.equal(result.url, 'proxy:/cached');
    assert.equal(result.sourceType, 'server_cache');
    assert.equal(result.quality, '320k');
    assert.equal(result.folder, 'music');
    assert.equal(result.songInfo, switched);
    assert.equal(online.url, 'https://online/song');
});

test('missing, colliding or failed cache keeps preloaded URL', async () => {
    for (const cached of [{ exists: false }, { exists: true, isCollision: true }, new Error('offline')]) {
        assert.equal(await setup(cached).refresh(song, online), online);
    }
});

test('cache preference off and existing local cache skip lookup', async () => {
    const disabled = setup({}, false);
    assert.equal(await disabled.refresh(song, online), online);
    assert.equal(disabled.calls.length, 0);
    const local = { ...online, sourceType: 'server_cache' };
    const enabled = setup({});
    assert.equal(await enabled.refresh(song, local), local);
    assert.equal(enabled.calls.length, 0);
});

test('OpenList hit retains source type', async () => {
    const { refresh } = setup({ exists: true, url: '/openlist', origin: 'openlist' });
    assert.equal((await refresh(song, online)).sourceType, 'openlist');
});

test('prefetch separates platforms and requested qualities using normalized identity', () => {
    const context = vm.createContext({
        Audio: FakeAudio, console, Date, settings: {},
        cleanSongData: s => ({ ...s, id: `${s.source}_${String(s.id).replace(`${s.source}_`, '')}` })
    });
    const from = source.indexOf('const prefetchManager =');
    const to = source.indexOf('async function refreshPrefetchedCache(', from);
    vm.runInContext(source.slice(from, to) + '\nthis.manager = prefetchManager;', context);
    const manager = context.manager;
    // Requested flac may have resolved to 320k; reuse under the original request only.
    manager.set(song, 'flac', { ...online, quality: '320k' });
    assert.equal(manager.get({ ...song, id: 'wy_1' }, 'flac').quality, '320k');
    assert.equal(manager.get({ ...song, source: 'tx' }, 'flac'), null);
    assert.equal(manager.get(song, '320k'), null);
    const key = manager.key(song, 'flac');
    manager.cache.get(key).timestamp = Date.now() - 31 * 60 * 1000;
    assert.equal(manager.get(song, 'flac'), null);
    assert.equal(manager.cache.has(key), false);
});

test('preference changes reject cached prefetches but preserve explicit local playback', () => {
    const settings = { preferServerCache: true };
    const context = vm.createContext({ Audio: FakeAudio, console, settings, cleanSongData: s => s });
    const from = source.indexOf('const prefetchManager =');
    const to = source.indexOf('async function refreshPrefetchedCache(', from);
    vm.runInContext(source.slice(from, to) + '\nthis.manager = prefetchManager;', context);
    const manager = context.manager;
    for (const sourceType of ['server_cache', 'openlist']) {
        settings.preferServerCache = true;
        manager.set(song, 'flac', { ...online, sourceType });
        settings.preferServerCache = false;
        assert.equal(manager.get(song, 'flac'), null);
    }
    manager.set(song, 'flac', online);
    assert.equal(manager.get(song, 'flac').url, online.url);
    const local = { ...song, isLocal: true };
    manager.set(local, 'flac', { ...online, sourceType: 'server_cache' });
    assert.equal(manager.get(local, 'flac').sourceType, 'server_cache');
});

test('failed playback evicts the consumed entry without deleting newer prefetches', () => {
    const context = vm.createContext({ Audio: FakeAudio, console, settings: {}, cleanSongData: s => s });
    const from = source.indexOf('const prefetchManager =');
    const to = source.indexOf('async function refreshPrefetchedCache(', from);
    vm.runInContext(source.slice(from, to) + '\nthis.manager = prefetchManager;', context);
    const manager = context.manager;
    manager.set(song, 'flac', online);
    const failed = manager.get(song, 'flac');
    manager.invalidate(song, 'flac', failed);
    assert.equal(manager.get(song, 'flac'), null);
    manager.set(song, 'flac', { ...online, url: 'https://new/song' });
    manager.invalidate(song, 'flac', failed);
    assert.equal(manager.get(song, 'flac').url, 'https://new/song');
    // Media error and play() rejection both invalidate, using the original requested song/quality.
    assert.equal(source.split('prefetchManager.invalidate(song, prefetchQuality, prefetchedResult);').length - 1, 2);
});

test('slow local cache lookup aborts and retains preloaded URL', async () => {
    let timeoutMs;
    let aborted = false;
    const context = vm.createContext({
        settings: {}, console: { error() {}, warn() {} },
        cleanSongData: s => s, currentListData: null,
        URLSearchParams, getUserAuthHeaders: () => ({}),
        AbortSignal: { timeout(ms) {
            timeoutMs = ms;
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 10);
            return controller.signal;
        } },
        fetch: async (url, { signal }) => new Promise((resolve, reject) => {
            assert.equal(new URL(url, 'http://localhost').searchParams.get('includeOpenlist'), '0');
            signal.addEventListener('abort', () => {
                aborted = true;
                reject(new Error('timeout'));
            }, { once: true });
        })
    });
    const checkStart = source.indexOf('async function checkServerCache(');
    const checkEnd = source.indexOf('\n/**', checkStart);
    vm.runInContext(source.slice(checkStart, checkEnd) + source.slice(start, end), context);
    assert.equal(await context.refreshPrefetchedCache(song, online), online);
    assert.equal(timeoutMs, 1200);
    assert.equal(aborted, true);
});

function prefetchSetup() {
    const pending = [];
    const context = vm.createContext({
        Audio: FakeAudio, console: { log() {}, warn() {} }, settings: {},
        cleanSongData: s => s,
        currentPlaylist: [song, { id: '2', source: 'wy' }, { id: '3', source: 'wy' }],
        currentIndex: 0, playMode: 'list', preSelectedNextIndex: null,
        window: { QualityManager: { getBestQuality: (s, q) => q } },
        getNextIndex: () => 1,
        resolveSongUrl: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
        probeUrl: async () => true,
        getSourceTypeText: () => '', localStorage: { removeItem() {} }
    });
    const from = source.indexOf('const prefetchManager =');
    const to = source.indexOf('async function refreshPrefetchedCache(', from);
    const taskFrom = source.indexOf('async function prefetchNextSong(');
    const taskTo = source.indexOf('// --- Server Cache Helpers ---', taskFrom);
    vm.runInContext(source.slice(from, to) + source.slice(taskFrom, taskTo) + '\nthis.manager = prefetchManager;', context);
    return { context, pending, manager: context.manager };
}

test('late old prefetch cannot replace newer buffer', async () => {
    const { context, pending, manager } = prefetchSetup();
    const old = context.prefetchNextSong(1);
    const latest = context.prefetchNextSong(2);
    pending[1].resolve({ ...online, url: 'https://new/song' });
    await latest;
    pending[0].resolve(online);
    await old;
    assert.equal(manager.bufferer.src, 'https://new/song');
    assert.equal(manager.get(context.currentPlaylist[1], 'flac'), null);
});

test('disable, queue mutation, quality change and new playback discard pending results', async () => {
    for (const mutate of [
        ({ context, manager }) => { context.settings.enablePreloader = false; manager.clear(); },
        ({ context }) => { context.currentPlaylist.reverse(); },
        ({ context }) => { context.settings.preferredQuality = '320k'; },
        ({ manager }) => manager.stop()
    ]) {
        const state = prefetchSetup();
        const task = state.context.prefetchNextSong(1);
        mutate(state);
        state.pending[0].resolve(online);
        await task;
        assert.equal(state.manager.bufferer.src, '');
        assert.equal(state.manager.cache.size, 0);
    }
});

test('stale failed task cannot recursively start another prefetch', async () => {
    const { context, pending, manager } = prefetchSetup();
    const task = context.prefetchNextSong(1);
    manager.clear();
    pending[0].reject(new Error('old failure'));
    await task;
    assert.equal(pending.length, 1);
});

test('cache hit restarts buffering after the previous buffer was stopped', async () => {
    const { context, pending, manager } = prefetchSetup();
    manager.set(context.currentPlaylist[1], 'flac', online);
    await context.prefetchNextSong(1);
    assert.equal(manager.bufferer.src, online.url);
    assert.equal(pending.length, 0);
    manager.clear();
    assert.equal(manager.bufferer.src, '');
});
