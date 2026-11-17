const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('public/music/app.js', 'utf8');
const resolveCode = app.slice(app.indexOf('async function resolveSongUrl('), app.indexOf('async function resolveDownloadSongUrl('));
function setup(candidates, failures = []) {
    const tried = [];
    const c = vm.createContext({ console, Date, Set,
        settings: { enableAutoDegradeQuality: false, enableAutoSwitchSource: true },
        window: {
            SongMerge: { candidates: async () => candidates, requestQuality: (_, q) => q, record() {} },
            QualityManager: { getBestQuality: s => s.quality },
        },
        getSourceName: s => s,
        cachedMembersFirst: async c => c,
        findOtherSourceMatches: async s => s._alternates,
        fetchSongUrl: async (s, q) => { tried.push([s.source, q]); if (failures.includes(s.source)) throw new Error('failed'); return { url: '/ok', quality: q }; },
    });
    vm.runInContext(resolveCode, c);
    return { c, tried };
}
test('untried lower-quality alternative remains available with degradation disabled', async () => {
    const alt = { source: 'kw', quality: '320k' };
    const song = { source: 'tx', quality: 'flac', _alternates: [alt] };
    const { c, tried } = setup([song], ['tx']);
    const result = await c.resolveSongUrl(song, 'flac', true);
    assert.equal(result.songInfo, alt);
    assert.deepEqual(tried, [['tx', 'flac'], ['kw', '320k']]);
});
test('failed merged candidates are not retried by the fallback loop', async () => {
    const alt = { source: 'kw', quality: 'flac' };
    const song = { source: 'tx', quality: 'flac', _alternates: [alt] };
    const { c, tried } = setup([song, alt], ['tx', 'kw']);
    await assert.rejects(c.resolveSongUrl(song, 'flac', true), /failed/);
    assert.equal(tried.length, 2);
});
test('formal playback errors carry failed platforms without mutating shared recovery state', async () => {
    const alt = { source: 'kw' }, song = { source: 'tx', _alternates: [alt] };
    const { c } = setup([song, alt], ['tx', 'kw']);
    c.currentRecoveryState = { triedPlatforms: ['tx'] };
    await assert.rejects(c.resolveSongUrl(song, 'flac', false, false, true), error => {
        assert.deepEqual([...error.triedPlatforms], ['tx', 'kw']); return true;
    });
    assert.deepEqual(c.currentRecoveryState.triedPlatforms, ['tx']);
    assert.match(app, /currentRecoveryState.thisRequestId === thisRequestId && !noPlay\) \{\s*for \(const platform of error.triedPlatforms/);
});

test('media failure after alternate-first resolution can recover the untouched primary', async () => {
    const alt = { source: 'kw', quality: 'flac' }, song = { source: 'tx', quality: 'flac', _alternates: [alt] };
    const { c, tried } = setup([alt, song]);
    const result = await c.resolveSongUrl(song, 'flac', false, false, true);
    assert.deepEqual([...result.triedPlatforms], ['kw']);
    vm.runInContext(app.slice(app.indexOf('async function findOtherSourceMatches('), app.indexOf('async function findOtherSourceMatches(') + app.slice(app.indexOf('async function findOtherSourceMatches(')).indexOf('\nasync function ')), c);
    c.restorePlaybackSession = async () => false;
    c.RecoveryToast = { show() {}, markStepFailed() {} };
    c.settings.enableAutoSwitchApiSource = false;
    c.window.QualityManager.getQualityDisplayName = q => q;
    c.currentRecoveryState = { originalSong: song, currentSong: alt, currentIndex: 0,
        currentQuality: 'flac', triedPlatforms: [...result.triedPlatforms],
        steps: ['switch_platform'], currentStepIndex: 0 };
    let recovery;
    c.playSong = member => { recovery = member; };
    vm.runInContext(app.slice(app.indexOf('async function runRecoveryFlow('), app.indexOf('async function playSong(')), c);
    await c.runRecoveryFlow(new Error('Media playback failed'), 0);
    assert.equal(recovery.source, 'tx');
    assert.equal(recovery._alternates, undefined);
    await c.resolveSongUrl(recovery, 'flac', false, true, true);
    assert.deepEqual(tried, [['kw', 'flac'], ['tx', 'flac']]);
    assert.match(app, /triedPlatforms: \[\]/);
});
test('supported platform union excludes per-script disabled platforms but retains other enabled scripts', async () => {
    const c = vm.createContext({ window: { SongMerge: {} }, Date, Set,
        fetchCustomSources: async () => [
            { enabled: true, status: 'success', supportedSources: ['tx', 'kw'], disabledSources: ['tx'] },
            { enabled: true, status: 'success', supportedSources: ['wy'], disabledSources: [] },
        ],
    });
    const code = app.slice(app.indexOf('let supportedPlatformsCache ='), app.indexOf('async function fetchCustomSources('));
    vm.runInContext(code, c);
    assert.deepEqual([...await c.window.SongMerge.getSupportedPlatforms()], ['kw', 'wy']);
    vm.runInContext('supportedPlatformsCache = null', c);
    c.fetchCustomSources = async () => [
        { enabled: true, status: 'success', supportedSources: ['tx'], disabledSources: ['tx'] },
        { enabled: true, status: 'success', supportedSources: ['tx'], disabledSources: [] },
    ];
    assert.deepEqual([...await c.window.SongMerge.getSupportedPlatforms()], ['tx']);
});
test('aggregate search reads the current settings object rather than a stale global snapshot', () => {
    assert.match(app, /merge: source === 'all' && settings.mergeAggregatedSearch !== false/);
});
