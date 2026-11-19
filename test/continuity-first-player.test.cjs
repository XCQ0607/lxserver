const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/music/app.js', 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const location = { href: 'https://lx.example/', origin: 'https://lx.example', host: 'lx.example' };
const track = { id: 'wy_1', source: 'wy', name: 'Song', singer: 'Example', interval: '3:00', extra: 'not sent in cache identity' };
const ready = { exists: true, url: '/api/music/cache/file/example/track.mp3?folder=cache', folder: 'cache', quality: '320k', memberIndex: 0 };
const raw = 'https://provider.example/song.mp3';
const relay = '/api/music/download?url=' + encodeURIComponent(raw) + '&inline=1';
const offer = 'a'.repeat(32);

function setup({ cache = ready, status = 200, result = { url: raw, type: '128k', readThrough: offer },
    proxyUrl = relay, isCurrent, proxyOptions = {}, refresh, openlistResult = { exists: false } } = {}) {
    const calls = [];
    const writes = [];
    const downloads = [];
    let account = 'example';
    let token = 'old';
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        API_BASE: '/api/music', URL, URLSearchParams, AbortSignal,
        window: { location, QualityManager: { QUALITY_PRIORITY: ['hires', 'flac24bit', 'flac', '320k', '128k'] } },
        settings: { enableServerCache: true, enableProxyPlayback: true, ...proxyOptions },
        cleanSongData: s => s,
        getUserAuthHeaders: () => ({ 'x-user-name': account, 'x-user-token': token }),
        ensureUserAuthToken: async () => refresh?.({ updateAccount: s => { account = s; }, updateToken: s => { token = s; } }),
        authorizeMediaUrl: url => url,
        applyAutoProxy: async url => url === raw ? proxyUrl : url,
        setTimeout: cb => { cb(); return 0; },
        EventSource: class { close() {} },
        currentRecoveryState: null,
        localStorage: { getItem: () => null, setItem: (...params) => writes.push(params) },
        updateStorageStatsUI() {},
        triggerServerCache: (...args) => downloads.push(args),
        fetch: async (url, options) => {
            calls.push({ url, headers: options.headers, body: options.body && JSON.parse(options.body) });
            const body = url.endsWith('/cache/select') ? cache : url.includes('/cache/check?') ? openlistResult : result;
            const code = url.endsWith('/cache/select') && options.headers['x-user-token'] === 'old' ? status : 200;
            return { ok: code === 200, status: code, json: async () => body };
        },
    });
    vm.runInContext(extract('function getPlaybackCacheFileKey(', 'async function resolveDownloadSongUrl(') +
        extract('function addPlaybackCapture(', 'function getNextIndex()') +
        extract('async function checkServerCache(', '/**'), context);
    const resolve = (options = {}, song = track, retry = false) =>
        context.resolveSongUrl(song, 'flac', true, retry, true, { isCurrent, ...options });
    return { resolve, context, calls, writes, downloads };
}

test('one completed local selection precedes any OpenList or provider activity and creates no upgrade download', async () => {
    const fixture = setup();
    const result = await fixture.resolve({ requestReadThrough: true });
    assert.equal(result.url, ready.url);
    assert.equal(result.quality, '320k');
    assert.deepEqual(fixture.calls.map(call => call.url), ['/api/music/cache/select']);
    assert.deepEqual(fixture.calls[0].body.songs, [{ id: 'wy_1', source: 'wy', name: 'Song', singer: 'Example', interval: '3:00' }]);
    assert.equal(fixture.calls[0].headers['x-user-token'], 'old');
    assert.deepEqual(fixture.downloads, []);
});

test('manual cache opt-out still permits an explicitly selected local file', async () => {
    const fixture = setup({ proxyOptions: { preferServerCache: false } });
    assert.equal((await fixture.resolve({}, { ...track, url: ready.url, isLocal: true })).sourceType, 'server_cache');
    assert.deepEqual(fixture.calls, []);
});

test('cache miss preserves OpenList-only fallback without a second local lookup', async () => {
    const fixture = setup({ cache: null, openlistResult: { exists: true, origin: 'openlist', url: '/remote', quality: 'flac' } });
    assert.equal((await fixture.resolve()).sourceType, 'openlist');
    assert.deepEqual(fixture.calls.map(call => call.url.split('?')[0]), ['/api/music/cache/select', '/api/music/cache/check']);
    const query = new URL(fixture.calls[1].url, location.href).searchParams;
    assert.equal(query.get('includeOpenlist'), '1');
    assert.equal(query.get('openlistOnly'), '1');
});

test('rejected cache auth stops before providers; renewal may retry only the same account', async () => {
    const invalid = setup({ status: 401 });
    await assert.rejects(invalid.resolve(), err => err.status === 401);
    assert.equal(invalid.calls.length, 1);
    const switched = setup({ status: 401, refresh: ({ updateAccount }) => { updateAccount('new-owner'); return true; } });
    await assert.rejects(switched.resolve(), err => err.name === 'AbortError');
    assert.equal(switched.calls.length, 1);
    const renewed = setup({ status: 401, refresh: ({ updateToken }) => { updateToken('new'); return true; } });
    assert.equal((await renewed.resolve()).url, ready.url);
    assert.deepEqual(renewed.calls.map(call => call.headers['x-user-token']), ['old', 'new']);
});

test('strict cache selection rejects another tier, but treats the two 24-bit labels as aliases', async () => {
    const fallback = setup();
    assert.notEqual((await fallback.resolve({ exactQuality: true })).url, ready.url);
    assert.equal(fallback.calls[0].body.exactQuality, true);
    const alias = setup({ cache: { ...ready, quality: 'flac24bit' } });
    assert.equal((await alias.resolve({ exactQuality: true, cacheQuality: 'hires' })).quality, 'flac24bit');
});

test('eligible foreground built-in relay keeps the offer in memory and skips duplicate download', async () => {
    const fixture = setup({ cache: null });
    const resolution = await fixture.resolve({ requestReadThrough: true });
    assert.equal(fixture.calls.at(-1).body.requestReadThrough, true);
    assert.equal(new URL(resolution.url, location.href).searchParams.get('capture'), offer);
    assert.equal(resolution.relayUrl, relay);
    assert.deepEqual(fixture.downloads, []);
    assert.deepEqual(fixture.writes, []);
});

test('nonforeground, custom proxy, no-offer and unticketable direct streams keep existing download policy', async () => {
    for (const [options, fixture] of [
        [{}, setup({ cache: null })],
        [{ requestReadThrough: true }, setup({ cache: null, result: { url: raw } })],
        [{ requestReadThrough: true }, setup({ cache: null, proxyUrl: raw })],
        [{ requestReadThrough: true }, setup({ cache: null, proxyUrl: 'https://proxy.example/song', proxyOptions: { enableCustomProxy: true, customProxyUrl: 'https://proxy.example/{url}' } })],
    ]) {
        const resolution = await fixture.resolve(options);
        assert.ok(!resolution.url.includes('capture='));
        assert.equal(fixture.downloads.length, 1);
        assert.equal(fixture.downloads[0][1], raw);
        assert.equal(fixture.writes.length, 1);
    }
});

test('a superseded local miss does not start an online request', async () => {
    const fixture = setup({ cache: null, isCurrent: () => fixture.calls.length === 0 });
    await assert.rejects(fixture.resolve(), err => err.name === 'AbortError');
    assert.deepEqual(fixture.calls.map(call => call.url), ['/api/music/cache/select']);
});

test('recovery excludes the failed file and resumes a ready replacement without provider resolution', async () => {
    const calls = [];
    const alternate = { ...ready, url: '/api/music/cache/file/example/other.flac?folder=music', quality: 'flac' };
    const state = { originalSong: track, currentSong: track, thisRequestId: 7, currentIndex: 2, currentQuality: '320k', cacheTargetQuality: 'flac' };
    const context = vm.createContext({
        URL, console, settings: {}, window: { location }, currentRecoveryState: state,
        restorePlaybackSession: async () => false,
        resolvePlaybackCache: async (_song, wanted, options) => {
            calls.push({ wanted, exclusions: [...options.excludedFiles] });
            return alternate;
        },
        playSong: (...args) => calls.push(args),
        fetchSongUrl: () => assert.fail('queried a provider before using the replacement')
    });
    vm.runInContext(extract('function getPlaybackCacheFileKey(', 'const samePlaybackQuality') +
        extract('async function runRecoveryFlow(', 'async function playSong('), context);
    await context.runRecoveryFlow(new Error('media failed'), 42, state, { ...ready, sourceType: 'server_cache' });
    assert.deepEqual(calls[0], { wanted: 'flac', exclusions: ['["cache","track.mp3"]'] });
    assert.equal(calls[1][6], alternate);
    assert.equal(context.window._resumeInfo.time, 42);
});

test('after a cached media miss, refreshes the same track once before normal recovery even with source switching off', async () => {
    for (const sourceType of ['server_cache', 'cache', 'openlist']) {
        const calls = [];
        const state = { originalSong: track, currentSong: track, thisRequestId: 7, currentIndex: 2,
            currentQuality: '320k', mediaRequestedQuality: 'hires', originalQuality: 'flac', explicitQuality: true,
            cacheTargetQuality: 'flac', steps: ['switch_platform'], currentStepIndex: 0, currentHasMoreSources: false };
        const online = { url: raw, sourceType: 'normal', quality: 'flac' };
        const context = vm.createContext({
            URL, console: { log() {}, warn() {} }, settings: { enableAutoSwitchApiSource: false },
            window: { location }, currentRecoveryState: state, audio: { isRemote: false },
            cleanSongData: s => s, localStorage: { removeItem() {} },
            RecoveryToast: { show() {}, markStepFailed() {}, error() {} },
            setPlayerStatus() {}, updatePlayButton() {},
            restorePlaybackSession: async () => false,
            resolvePlaybackCache: async (_song, _quality, options) => {
                calls.push({ type: 'cache', exclusions: options.excludedFiles && [...options.excludedFiles] });
                return null;
            },
            fetchSongUrl: async (song, quality, retry, _silent, options) => {
                calls.push({ type: 'fresh', song, quality, retry,
                    onlineOnly: options.skipPlaybackCache, exact: options.exactQuality, excluded: Array.from(options.excludeApiSources) });
                return online;
            },
            findOtherSourceMatches: async () => { calls.push({ type: 'normal recovery' }); return []; },
            playSong: (...args) => calls.push({ type: 'play', song: args[0], prepared: args[6] }),
        });
        vm.runInContext(extract('function getPlaybackCacheFileKey(', 'const samePlaybackQuality') +
            extract('async function runRecoveryFlow(', 'async function playSong('), context);
        const failure = { ...ready, sourceType };
        await context.runRecoveryFlow(new Error('cached media failed'), 42, state, failure);
        assert.deepEqual(calls.map(call => call.type), ['cache', 'fresh', 'play']);
        if (sourceType === 'server_cache') assert.deepEqual(calls[0].exclusions, ['["cache","track.mp3"]']);
        assert.deepEqual(calls[1], { type: 'fresh', song: track, quality: 'flac', retry: true, onlineOnly: true, exact: true, excluded: [] });
        assert.equal(calls[2].prepared, online);
        assert.equal(context.window._resumeInfo.time, 42);
        // A later error in the same recovery chain must not restart the fresh retry.
        state.thisRequestId++;
        await context.runRecoveryFlow(new Error('cached media failed again'), 42, state, failure);
        assert.equal(calls.filter(call => call.type === 'fresh').length, 1);
        assert.equal(calls.at(-1).type, 'normal recovery');
    }
});

test('cache renewal exceeding its lookup budget is a miss, not a false authentication rejection', async () => {
    let finishRenewal;
    const fixture = setup({ status: 401, refresh: () => new Promise(resolve => { finishRenewal = resolve; }) });
    const controller = new AbortController();
    const pending = fixture.context.checkPlaybackCache([track], 'flac', false, controller.signal);
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    assert.equal(await pending, null);
    finishRenewal(true);
    assert.equal(fixture.calls.length, 1);
});

test('final non-aborted cache auth rejections remain terminal, including forbidden responses', async () => {
    for (const status of [401, 403]) {
        const fixture = setup({ status });
        const controller = new AbortController();
        await assert.rejects(fixture.context.checkPlaybackCache([track], 'flac', false, controller.signal), error => error.status === status);
        assert.equal(fixture.calls.length, 1);
    }
});
