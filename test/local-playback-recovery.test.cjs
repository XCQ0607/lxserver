const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/music/app.js', 'utf8');
const extract = (start, end) => {
    const i = source.indexOf(start);
    assert.ok(i >= 0, `Missing start marker: ${start}`);
    const j = source.indexOf(end, i);
    assert.ok(j >= 0, `Missing end marker: ${end}`);
    return source.slice(i, j);
};

test('local-only song keeps local URL on retry and forwards AbortSignal for online fetch', async () => {
    const fetchCalls = [];
    const controller = new AbortController();
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        API_BASE: '/api/music',
        URL,
        URLSearchParams,
        AbortSignal,
        window: { location: { href: 'https://lx.example/', origin: 'https://lx.example', host: 'lx.example' } },
        settings: { enableServerCache: false, enableSongUrlCache: false },
        cleanSongData: s => s,
        getUserAuthHeaders: () => ({}),
        ensureUserAuthToken: async () => false,
        applyAutoProxy: async url => url,
        setTimeout: cb => { cb(); return 0; },
        EventSource: class { close() {} },
        currentRecoveryState: null,
        localStorage: { getItem: () => null, setItem() {} },
        updateStorageStatsUI() {},
        triggerServerCache() {},
        checkPlaybackStillCurrent() {},
        resolvePlaybackCache: async () => null,
        checkServerCache: async () => ({ exists: false }),
        fetch: async (url, options) => {
            fetchCalls.push({ url, options });
            return { ok: true, status: 200, json: async () => ({ url: 'https://online.example/1.mp3', type: '320k' }) };
        },
    });
    vm.runInContext(
        extract('async function fetchSongUrl(', 'function syncPlaybackQueueTrackers('),
        context
    );

    const localSong = { id: 'local_1', source: 'local', name: 'NAS Track', isLocal: true, url: '/api/music/cache/file/u/nas.flac?folder=music', quality: 'flac' };
    const retryRes = await context.fetchSongUrl(localSong, 'flac', true, false, {});
    assert.equal(retryRes.url, localSong.url);
    assert.equal(retryRes.sourceType, 'server_cache');
    assert.equal(fetchCalls.length, 0);

    const onlineSong = { id: 'wy_1', source: 'wy', name: 'Online Track' };
    await context.fetchSongUrl(onlineSong, '320k', false, false, { signal: controller.signal });
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].options.signal, controller.signal);
});

test('runRecoveryFlow retries local-only songs in place without searching online sources', async () => {
    const calls = [];
    const state = {
        originalSong: { id: 'local_2', source: 'local', isLocal: true, name: 'Local Song' },
        currentSong: { id: 'local_2', source: 'local', isLocal: true, name: 'Local Song' },
        thisRequestId: 9,
        currentIndex: 0,
        currentQuality: 'flac',
        recoveryEpoch: 1,
    };
    const context = vm.createContext({
        URL,
        console: { log() {}, warn() {}, error() {} },
        audio: { isRemote: false },
        settings: { preferServerCache: false },
        window: { location: { href: 'https://lx.example/' }, _autoSkipTimer: null },
        currentRecoveryState: state,
        shouldAutoRecoverPlayback: true,
        setPlayerStatus() {},
        updatePlayButton() {},
        RecoveryToast: { error() {}, show() {}, markStepFailed() {} },
        restorePlaybackSession: async () => false,
        setTimeout: fn => { fn(); return 0; },
        playSong: (...args) => calls.push({ type: 'playSong', args }),
        fetchSongUrl: () => assert.fail('must not resolve online URL for local-only song'),
        findOtherSourceMatches: () => assert.fail('must not search online sources for local-only song'),
    });
    vm.runInContext(
        extract('function getPlaybackCacheFileKey(', 'const samePlaybackQuality') +
        extract('async function runRecoveryFlow(', 'async function playSong('),
        context
    );

    await context.runRecoveryFlow(new Error('stall'), 12, state, { sourceType: 'server_cache', url: '/api/music/cache/file/u/a.flac?folder=music' });
    assert.equal(calls.length, 1);
    assert.equal(state.customRetryCount, 1);
    assert.equal(context.window._resumeInfo.time, 12);
});

test('handlePlaybackStallOrWait gives local, server_cache and openlist streams 30s timeout', () => {
    const timeouts = [];
    const context = vm.createContext({
        audio: { isRemote: false, paused: false, ended: false, readyState: 2, currentTime: 10, src: '/api/music/cache/file/u/a.flac' },
        lyricPlayer: null,
        isServerReconnecting: false,
        playbackStallDetectionTimer: null,
        currentRecoveryState: { thisRequestId: 1 },
        currentPlayingSong: { id: 'wy_1', source: 'wy', name: 'Cached Song' },
        currentSourceType: 'server_cache',
        shouldAutoRecoverPlayback: true,
        currentPlaybackErrorHandler: () => {},
        cleanSongData: s => s,
        setPlayerStatus() {},
        setTimeout: (fn, ms) => { timeouts.push(ms); return 1; },
    });
    vm.runInContext(extract('function handlePlaybackStallOrWait(', 'audio.addEventListener(\'timeupdate\''), context);

    context.handlePlaybackStallOrWait({ type: 'waiting' });
    assert.deepEqual(timeouts, [30000]);
});

test('customDir song resolves with folder=custom and forwards AbortSignal to OpenList cache check', async () => {
    const checkSignals = [];
    const controller = new AbortController();
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        API_BASE: '/api/music',
        URL,
        URLSearchParams,
        AbortSignal,
        window: { location: { href: 'https://lx.example/', origin: 'https://lx.example', host: 'lx.example' } },
        settings: { preferServerCache: true, enableServerCache: false, enableSongUrlCache: false },
        cleanSongData: s => s,
        getUserAuthHeaders: () => ({}),
        ensureUserAuthToken: async () => false,
        applyAutoProxy: async url => url,
        setTimeout: cb => { cb(); return 0; },
        EventSource: class { close() {} },
        currentRecoveryState: null,
        localStorage: { getItem: () => null, setItem() {} },
        updateStorageStatsUI() {},
        triggerServerCache() {},
        checkPlaybackStillCurrent() {},
        resolvePlaybackCache: async () => null,
        checkServerCache: async (_song, _q, _exact, _inc, signal) => {
            checkSignals.push(signal);
            return { exists: false };
        },
        fetch: async () => ({ ok: true, status: 200, json: async () => ({ url: 'https://online.example/1.mp3', type: '320k' }) }),
    });
    vm.runInContext(
        extract('async function fetchSongUrl(', 'function syncPlaybackQueueTrackers('),
        context
    );

    const customSong = {
        id: 'wy_123',
        source: 'wy',
        name: 'Custom NAS Track',
        isLocal: true,
        _isCustomDir: true,
        folder: 'custom',
        url: '/api/music/custom/file?filename=nas.flac&user=u',
        quality: 'flac',
    };
    const customRes = await context.fetchSongUrl(customSong, 'flac', true, false, {});
    assert.equal(customRes.url, customSong.url);
    assert.equal(customRes.folder, 'custom');
    assert.equal(customRes.sourceType, 'server_cache');

    const onlineSong = { id: 'wy_2', source: 'wy', name: 'Online Track' };
    await context.fetchSongUrl(onlineSong, '320k', false, false, { signal: controller.signal });
    assert.equal(checkSignals.length, 1);
    assert.equal(checkSignals[0], controller.signal);
});

test('runRecoveryFlow retries manually-indexed customDir song in place without resolvePlaybackCache', async () => {
    const calls = [];
    const state = {
        originalSong: { id: 'wy_123', source: 'wy', isLocal: true, _isCustomDir: true, folder: 'custom', name: 'Custom Track', url: '/api/music/custom/file?filename=a.flac&user=u' },
        currentSong: { id: 'wy_123', source: 'wy', isLocal: true, _isCustomDir: true, folder: 'custom', name: 'Custom Track', url: '/api/music/custom/file?filename=a.flac&user=u' },
        thisRequestId: 11,
        currentIndex: 0,
        currentQuality: 'flac',
        recoveryEpoch: 1,
    };
    const context = vm.createContext({
        URL,
        console: { log() {}, warn() {}, error() {} },
        audio: { isRemote: false },
        settings: { preferServerCache: true },
        window: { location: { href: 'https://lx.example/' }, _autoSkipTimer: null },
        currentRecoveryState: state,
        shouldAutoRecoverPlayback: true,
        setPlayerStatus() {},
        updatePlayButton() {},
        RecoveryToast: { error() {}, show() {}, markStepFailed() {} },
        restorePlaybackSession: async () => false,
        setTimeout: fn => { fn(); return 0; },
        playSong: (...args) => calls.push({ type: 'playSong', args }),
        resolvePlaybackCache: () => assert.fail('must not replace customDir song via resolvePlaybackCache'),
        fetchSongUrl: () => assert.fail('must not resolve online URL for customDir song'),
        findOtherSourceMatches: () => assert.fail('must not search online sources for customDir song'),
    });
    vm.runInContext(
        extract('function getPlaybackCacheFileKey(', 'const samePlaybackQuality') +
        extract('async function runRecoveryFlow(', 'async function playSong('),
        context
    );

    await context.runRecoveryFlow(new Error('stall'), 15, state, { sourceType: 'server_cache', folder: 'custom', url: '/api/music/custom/file?filename=a.flac&user=u' });
    assert.equal(calls.length, 1);
    assert.equal(state.customRetryCount, 1);
    assert.equal(context.window._resumeInfo.time, 15);
});

test('handlePlaybackStallOrWait gives /api/music/custom/file streams 30s timeout', () => {
    const timeouts = [];
    const context = vm.createContext({
        audio: { isRemote: false, paused: false, ended: false, readyState: 2, currentTime: 5, src: '/api/music/custom/file?filename=a.flac&user=u' },
        lyricPlayer: null,
        isServerReconnecting: false,
        playbackStallDetectionTimer: null,
        currentRecoveryState: { thisRequestId: 2 },
        currentPlayingSong: { id: 'custom_1', source: 'wy', name: 'Custom Track' },
        currentSourceType: 'normal',
        shouldAutoRecoverPlayback: true,
        currentPlaybackErrorHandler: () => {},
        cleanSongData: s => s,
        setPlayerStatus() {},
        setTimeout: (fn, ms) => { timeouts.push(ms); return 1; },
    });
    vm.runInContext(extract('function handlePlaybackStallOrWait(', 'audio.addEventListener(\'timeupdate\''), context);

    context.handlePlaybackStallOrWait({ type: 'stalled' });
    assert.deepEqual(timeouts, [30000]);
});

test('checkServerOnline uses 5000ms timeout and retries once before reporting offline', async () => {
    const fetchCalls = [];
    const timeouts = [];
    const context = vm.createContext({
        AbortController,
        setTimeout: (fn, ms) => { timeouts.push(ms); if (ms === 300) fn(); return 1; },
        clearTimeout() {},
        fetch: async (url) => {
            fetchCalls.push(url);
            if (fetchCalls.length === 1) throw new Error('transient timeout');
            return { ok: true, status: 200 };
        },
    });
    const fn = extract('async function checkServerOnline()', 'async function reconnectServerAndResume(');
    vm.runInContext(fn, context);

    const online = await context.checkServerOnline();
    assert.equal(online, true);
    assert.equal(fetchCalls.length, 2);
    assert.ok(timeouts.includes(5000));
});

test('prefetchManager.set skips bufferer preloading for local and customDir streams', () => {
    const context = vm.createContext({
        console: { log() {}, warn() {} },
        Audio: class { constructor() { this.src = ''; this.loadCalls = 0; } load() { this.loadCalls++; } removeAttribute() {} },
        cleanSongData: s => s,
        currentPlayingSong: { id: 'local_1', source: 'local', isLocal: true, url: '/api/music/cache/file/u/1.flac' },
        settings: {},
    });
    vm.runInContext(extract('const prefetchManager = {', 'prefetchManager.init();') + '\nglobalThis.prefetchManager = prefetchManager;', context);

    context.prefetchManager.set(
        { id: 'wy_2', source: 'wy', name: 'Next' },
        'flac',
        { url: '/api/music/custom/file?filename=next.flac', sourceType: 'server_cache' }
    );
    assert.equal(context.prefetchManager.bufferer.src, '');
    assert.equal(context.prefetchManager.bufferer.loadCalls, 0);
});
