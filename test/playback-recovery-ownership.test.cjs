const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/music/app.js', 'utf8');
const between = (a, b) => { const i = source.indexOf(a); assert.ok(i >= 0); return source.slice(i, source.indexOf(b, i)); };
function setup(noPlay = false) {
    let release, calls = 0;
    const pending = new Promise(resolve => { release = resolve; });
    const timers = [];
    const context = vm.createContext({
        console, settings: {}, playbackAccount: () => '', noPlay, thisRequestId: 7, playbackRecoveryTriggeredForRequestId: 0,
        shouldAutoRecoverPlayback: !noPlay, currentRecoveryState: { thisRequestId: 7 },
        currentPlayingSong: { id: 'track' }, song: { id: 'track' }, playbackSong: { id: 'track' },
        prefetchedResult: null, prefetchQuality: 'flac', currentQuality: '320k', targetQuality: 'flac', index: 0,
        urlResult: { sourceType: 'server_cache' }, finalUrl: '/local', sourceAssigned: false,
        currentPlaybackErrorHandler: null, playbackStallDetectionTimer: null, lyricPlayer: null,
        isServerReconnecting: false, lastKnownPlaybackTime: 5,
        audio: { currentTime: 5, paused: false, ended: false, isRemote: false, addEventListener() {} },
        prefetchManager: { invalidate() {} }, cleanSongData: s => s, setPlayerStatus() {},
        checkServerOnline: async () => true,
        runRecoveryFlow: async () => { calls++; await pending; },
        reconnectServerAndResume: () => assert.fail('must not reconnect an online server'),
        setTimeout: fn => { timers.push(fn); return 1; },
    });
    vm.runInContext(between('let playbackCacheUpgrade', 'const watchedCacheSongKeys') +
        between('function canRetryCachedTransport(', 'async function retryCachedTransport(') +
        between('// A native media event and play() rejection', '        audio.src = finalUrl;') +
        between('function handlePlaybackStallOrWait(', "audio.addEventListener('waiting'"), context);
    return { context, timers, release, calls: () => calls };
}
test('preloaded media stays paused on failure, but manual playback enables its recovery handler', async () => {
    const { context: c, calls } = setup(true);
    const handler = c.currentPlaybackErrorHandler;
    await handler();
    assert.equal(calls(), 0);
    assert.equal(c.currentPlaybackErrorHandler, handler);
    c.shouldAutoRecoverPlayback = true;
    await handler();
    assert.equal(calls(), 1);
});
test('a stall and native media error share one claim while replacement lookup is pending', async () => {
    const { context: c, timers, calls } = setup();
    const handler = c.currentPlaybackErrorHandler;
    c.handlePlaybackStallOrWait();
    timers[0]();
    await new Promise(resolve => setImmediate(resolve));
    await handler();
    assert.equal(calls(), 1);
});
test('local prepared replacement preserves the original online target quality', () => {
    const block = between('        if (currentRecoveryState) {\n            currentRecoveryState.currentApiSourceName', '        // [Fix] 移除 dismissAllToasts()');
    for (const sourceType of ['server_cache', 'openlist', 'normal']) {
        const context = vm.createContext({ currentRecoveryState: { mediaRequestedQuality: 'flac' },
            isRetry: true, preparedResult: {}, urlResult: { sourceType, quality: '128k' }, targetQuality: '128k', prefetchQuality: null });
        vm.runInContext(block, context);
        assert.equal(context.currentRecoveryState.currentQuality, '128k');
        assert.equal(context.currentRecoveryState.mediaRequestedQuality, sourceType === 'normal' ? '128k' : 'flac');
    }
});
