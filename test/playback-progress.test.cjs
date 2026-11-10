const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/music/app.js', 'utf8');
const start = source.indexOf('async function playSong(');
const playSong = source.slice(start, source.indexOf('\n}', start) + 2);

function setup({ retry = false, seekFails = false } = {}) {
    const nodes = new Map();
    const node = id => {
        if (!nodes.has(id)) nodes.set(id, {
            style: {}, classList: { contains: () => true, add() {}, remove() {} }
        });
        return nodes.get(id);
    };
    let position = 113;
    const context = vm.createContext({
        console: { log() {}, error() {} },
        setTimeout() { return 1; }, clearTimeout() {},
        window: { QualityManager: { getBestQuality: () => 'flac' },
            _resumeInfo: { time: 42, song: { id: 'C' } } },
        document: { getElementById: node },
        audio: {
            get currentTime() { return position; },
            set currentTime(value) { if (seekFails) throw Error('not seekable'); position = value; },
            pause() {}, removeEventListener() {}, paused: false
        },
        currentLoadingSongId: null, loadingRequestCounter: 0,
        currentPlaybackErrorHandler: null, lastKnownPlaybackTime: 113,
        serverReconnectTimer: null, settings: {},
        currentRecoveryState: retry ? { savedResumeTime: 37 } : null,
        scrollLockTimeout: null, hintTimeout: null,
        RecoveryToast: { dismiss() {}, isActive: () => false }, prefetchManager: { get() { return null; } },
        updatePlayerInfo() {}, updateMediaSessionMetadata() {}, fetchLyric() {},
        showInfo() {}, setPlayerStatus() {}, updatePlayButton() {},
        formatTime: seconds => seconds === 0 ? '00:00' : String(seconds),
        resolveSongUrl: async () => { throw Error('URL resolution failed'); },
        runRecoveryFlow: async (_error, time) => { context.recoveredTime = time; }
    });
    vm.runInContext(playSong, context);
    return { context, node };
}

test('jumping from A to C clears progress and failed URL resolution recovers C at zero', async () => {
    const { context: c, node } = setup();
    await c.playSong({ id: 'C', source: 'wy' }, 2);
    assert.equal(c.audio.currentTime, 0);
    assert.equal(node('time-current').innerText, '00:00');
    assert.equal(node('progress-bar').style.width, '0%');
    assert.equal(c.recoveredTime, 0);
    assert.equal(c.window._resumeInfo.time, 42);
});

test('failed seeking cannot leak A position into C recovery', async () => {
    const { context: c } = setup({ seekFails: true });
    await c.playSong({ id: 'C', source: 'wy' }, 2);
    assert.equal(c.audio.currentTime, 113);
    assert.equal(c.recoveredTime, 0);
});

test('same-song recovery preserves its saved position across another resolution failure', async () => {
    const { context: c } = setup({ retry: true });
    await c.playSong({ id: 'C', source: 'wy' }, 2, 'flac', false, true);
    assert.equal(c.recoveredTime, 37);
    assert.equal(c.audio.currentTime, 113);
});
