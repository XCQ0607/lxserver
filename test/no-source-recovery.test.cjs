const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/music/app.js', 'utf8');
function load(name, end, globals) {
    const context = vm.createContext({ console, ...globals });
    vm.runInContext(source.slice(source.indexOf(`async function ${name}(`), source.indexOf(end, source.indexOf(`async function ${name}(`))), context);
    return context;
}
const noSource = { errorCode: 'NO_AVAILABLE_SOURCE', message: '暂无可用音源' };

test('no source stops playback recovery and clears pending skip without retrying', async () => {
    const state = { currentSong: { source: 'wy' } };
    const errors = [];
    let cleared;
    const context = load('runRecoveryFlow', 'async function playSong(', {
        currentRecoveryState: state, restorePlaybackSession: async () => false,
        window: { _autoSkipTimer: 42 }, clearTimeout: id => { cleared = id; },
        shouldAutoRecoverPlayback: true, setPlayerStatus() {}, updatePlayButton() {},
        RecoveryToast: { error: msg => errors.push(msg) },
    });
    await context.runRecoveryFlow(noSource);
    assert.equal(cleared, 42);
    assert.equal(context.window._autoSkipTimer, null);
    assert.equal(context.shouldAutoRecoverPlayback, false);
    assert.deepEqual(errors, [noSource.message]);
});

test('global no-source bypasses fallback but cache success still returns normally', async () => {
    let result = { url: '/api/music/cache/file/song.mp3' };
    const context = load('resolveSongUrl', 'async function resolveDownloadSongUrl(', {
        fetchSongUrl: async () => { if (result) return result; throw noSource; },
    });
    assert.equal((await context.resolveSongUrl({}, 'flac')).url, result.url);
    result = null;
    await assert.rejects(context.resolveSongUrl({}, 'flac'), err => err === noSource);
});

test('unsupported platform skips same-platform retry and quality degradation, still searches alternatives', async () => {
    const song = { source: 'wy' };
    const state = { currentSong: song, originalSong: song, triedPlatforms: ['wy'],
        steps: ['degrade', 'switch_platform'], currentStepIndex: 0 };
    let searches = 0;
    const context = load('runRecoveryFlow', 'async function playSong(', {
        currentRecoveryState: state, restorePlaybackSession: async () => false,
        settings: {}, window: {}, setPlayerStatus() {}, updatePlayButton() {},
        RecoveryToast: { show() {}, markStepFailed() {}, error() {} },
        findOtherSourceMatches: async () => { searches++; return []; },
        fetchSongUrl: () => assert.fail('retried unsupported platform'),
    });
    await context.runRecoveryFlow({ errorCode: 'PLATFORM_SOURCE_UNAVAILABLE' });
    assert.equal(searches, 1);
    assert.equal(state.samePlatformExhausted, true);
    assert.equal(state.currentStepIndex, 2);
});

test('no-source stops recursive background prefetch', async () => {
    let calls = 0;
    const context = load('prefetchNextSong', '// --- Server Cache Helpers ---', {
        settings: {}, playMode: 'list', currentIndex: 0, currentPlaylist: [{ id: 0 }, { id: 1 }, { id: 2 }],
        window: { QualityManager: { getBestQuality: () => 'flac' } },
        prefetchManager: { generation: 0, stop() { this.generation++; }, get: () => null },
        resolveSongUrl: async () => { calls++; throw noSource; },
    });
    await context.prefetchNextSong(1);
    assert.equal(calls, 1);
});

test('download stops immediately on global no-source', async () => {
    let calls = 0;
    const context = load('resolveDownloadSongUrl', 'function normalizeSongMatchText(', {
        settings: {}, window: {}, fetchSongUrl: async () => { calls++; throw noSource; },
    });
    await assert.rejects(context.resolveDownloadSongUrl({ id: '1', source: 'wy' }, 'flac'), err => err === noSource);
    assert.equal(calls, 1);
});
