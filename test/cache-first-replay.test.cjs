const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('public/music/app.js', 'utf8');
const between = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));
const song = (source, quality = 'flac') => ({ source, id: source + '_1', songmid: '1', name: 'Song', singer: 'Singer', interval: '04:00', types: [{ type: quality }] });
const cache = (quality = 'flac') => ({ exists: true, url: '/api/music/cache/file/alice/song.' + quality + '?folder=music', quality, folder: 'music' });
function setup({ hits = {}, supported, online, settings = {}, timer = setTimeout } = {}) {
    const events = [];
    const storage = new Map();
    const c = vm.createContext({ console: { log() {}, warn() {}, error() {} }, Date, AbortSignal, URLSearchParams,
        setTimeout: timer, clearTimeout, settings: { preferServerCache: true, enableServerCache: false, ...settings },
        API_BASE: '/api/music', window: {}, currentRecoveryState: null,
        localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
        cleanSongData: s => s, getUserAuthHeaders: () => ({}),
        applyAutoProxy: async url => url, checkAndTriggerBackgroundCacheUpgrade() {},
        EventSource: class { close() {} },
        checkServerCache: async (s, quality, exact, cloud) => {
            events.push({ kind: 'cache', source: s.source, quality, exact, cloud });
            const hit = hits[s.source];
            if (hit && (!exact || hit.quality === quality || ['hires', 'flac24bit'].includes(hit.quality) && ['hires', 'flac24bit'].includes(quality))) return hit;
            return { exists: false };
        },
        fetch: async () => { events.push({ kind: 'provider' }); return online ? online() : new Promise(() => {}); },
        updateStorageStatsUI() {},
    });
    vm.runInContext(fs.readFileSync('public/music/js/player/quality.js', 'utf8'), c);
    vm.runInContext(fs.readFileSync('public/music/js/library/song_merge.js', 'utf8'), c);
    c.window.SongMerge.getSupportedPlatforms = () => { events.push({ kind: 'support' }); return supported ? supported() : Promise.resolve(null); };
    vm.runInContext([
        between('function isUsableServerCache(', 'async function refreshPrefetchedCache('),
        between('async function resolveSongUrl(', 'async function resolveDownloadSongUrl('),
        between('async function fetchSongUrl(', 'function getNextIndex()'),
        between('async function refreshPrefetchedCache(', '\n/**'),
    ].join('\n'), c);
    return { c, events };
}
const timely = async promise => {
    let timer;
    try {
        return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Cached playback waited for a provider')), 180); })]);
    } finally { clearTimeout(timer); }
};

test('a merged local file plays without even starting a stalled source-support lookup', async () => {
    const { c, events } = setup({ hits: { kw: cache() }, supported: () => new Promise(() => {}) });
    const primary = { ...song('tx'), _alternates: [song('kw')] };
    const result = await timely(c.resolveSongUrl(primary, 'flac', false, false, true));
    assert.equal(result.url, cache().url);
    assert.equal(result.sourceType, 'server_cache');
    assert.equal(result.songInfo.source, 'kw');
    assert.equal(events.some(e => e.kind === 'support' || e.kind === 'provider'), false);
    assert.ok(events.every(e => !e.cloud));
});

test('master request can replay a cached lower-quality alternate absent from online quality candidates', async () => {
    const { c, events } = setup({ hits: { kw: cache('320k') } });
    const primary = { ...song('tx', 'master'), _alternates: [song('kw', '320k')] };
    const result = await timely(c.resolveSongUrl(primary, 'master', false, false, true));
    assert.equal(result.quality, '320k');
    assert.equal(result.songInfo.source, 'kw');
    assert.equal(events.some(e => e.kind === 'provider' || e.kind === 'support'), false);
});

test('exact quality on an alternate wins over a lower-quality primary cache', async () => {
    const { c, events } = setup({ hits: { tx: cache('320k'), kg: cache('flac24bit') } });
    const primary = { ...song('tx', 'hires'), _alternates: [song('kg', 'flac24bit')] };
    const result = await timely(c.resolveSongUrl(primary, 'hires', false, false, true));
    assert.equal(result.quality, 'flac24bit');
    assert.equal(result.songInfo.source, 'kg');
    assert.equal(events.some(e => e.kind === 'support'), false);
});

test('an ordinary single-platform replay also avoids support and online resolution', async () => {
    const { c, events } = setup({ hits: { tx: cache('320k') } });
    const result = await timely(c.resolveSongUrl(song('tx', 'master'), 'master', false, false, true));
    assert.equal(result.quality, '320k');
    assert.equal(events.some(e => e.kind === 'provider' || e.kind === 'support'), false);
});

test('a remote prefetch is replaced by another merged member cached since prefetch', async () => {
    const { c, events } = setup({ hits: { kw: cache('320k') } });
    const primary = { ...song('tx', 'master'), _alternates: [song('kw', '320k')] };
    const result = await timely(c.refreshPrefetchedCache(primary, { url: 'https://provider.invalid/audio', sourceType: 'normal', quality: 'master', isPrefetch: true, triedPlatforms: ['tx', 'kg'] }));
    assert.equal(result.sourceType, 'server_cache');
    assert.equal(result.songInfo.source, 'kw');
    assert.equal(result.isPrefetch, true);
    assert.equal(result.triedPlatforms, undefined, 'old online prefetch attempts must not exclude recovery platforms');
    assert.equal(events.some(e => e.kind === 'support' || e.kind === 'provider'), false);
});

test('all local members are checked before source sorting, cloud cache, or online resolution', async () => {
    const { c, events } = setup({ online: async () => ({ ok: true, json: async () => ({ url: '/online', type: 'flac' }) }) });
    const primary = { ...song('tx'), _alternates: [song('kw')] };
    const result = await c.resolveSongUrl(primary, 'flac', false, false, true);
    assert.equal(result.sourceType, 'normal');
    const beforeSupport = events.slice(0, events.findIndex(e => e.kind === 'support'));
    assert.deepEqual([...new Set(beforeSupport.map(e => e.source))].sort(), ['kw', 'tx']);
    assert.ok(beforeSupport.every(e => e.kind === 'cache' && !e.cloud));
});

test('cache preference off and explicit cache-bypass retries still resolve online', async () => {
    for (const [settings, retry] of [[{ preferServerCache: false }, false], [{}, 'local_retry'], [{}, 'download']]) {
        const { c, events } = setup({ settings, hits: { tx: cache() }, online: async () => ({ ok: true, json: async () => ({ url: '/online' }) }) });
        const result = await c.resolveSongUrl(song('tx'), 'flac', false, retry, true);
        assert.equal(result.sourceType, 'normal');
        assert.equal(events.some(e => e.kind === 'cache'), false);
    }
});

test('different-version collision never becomes an early cached playback hit', async () => {
    const { c, events } = setup({ hits: { tx: { ...cache(), isCollision: true, interval: '09:00' } },
        online: async () => ({ ok: true, json: async () => ({ url: '/online' }) }) });
    const result = await c.resolveSongUrl(song('tx'), 'flac', false, false, true);
    assert.equal(result.sourceType, 'normal');
    assert.ok(events.some(e => e.kind === 'provider'));
});

test('fallback prefers the highest already-cached quality, not the fastest online provider', async () => {
    const { c } = setup({ hits: { tx: cache('320k'), kw: cache('flac') } });
    const primary = { ...song('tx', 'master'), _alternates: [song('kw', 'flac')] };
    const result = await timely(c.resolveSongUrl(primary, 'master', false, false, true));
    assert.equal(result.quality, 'flac');
    assert.equal(result.songInfo.source, 'kw');
});

test('explicit local files bypass source metadata even when general cache preference is off', async () => {
    const { c, events } = setup({ settings: { preferServerCache: false }, supported: () => new Promise(() => {}) });
    const primary = { ...song('tx'), isLocal: true, url: cache().url, _alternates: [song('kw')] };
    const result = await timely(c.resolveSongUrl(primary, 'flac', false, false, true));
    assert.equal(result.url, primary.url);
    assert.equal(events.length, 0);
});

test('exact retries do not silently reuse a lower cached tier', async () => {
    const { c, events } = setup({ hits: { tx: cache('320k'), kw: cache('320k') },
        online: async () => ({ ok: true, json: async () => ({ url: '/online', type: 'flac' }) }) });
    const primary = { ...song('tx'), _alternates: [song('kw')] };
    const result = await c.resolveSongUrl(primary, 'flac', false, true, true);
    assert.equal(result.sourceType, 'normal');
    assert.ok(events.filter(e => e.kind === 'cache').every(e => e.exact));
});

test('an uncached song still proceeds when the source-support request never completes', async () => {
    const { c } = setup({ supported: () => new Promise(() => {}),
        timer: (fn, ms) => setTimeout(fn, ms === 3000 ? 20 : ms),
        online: async () => ({ ok: true, json: async () => ({ url: '/online', type: 'flac' }) }) });
    const primary = { ...song('tx'), _alternates: [song('kw')] };
    const result = await timely(c.resolveSongUrl(primary, 'flac', false, false, true));
    assert.equal(result.sourceType, 'normal');
});

test('higher-quality background upgrade never gates cached playback', async () => {
    const tasks = [];
    const { c, events } = setup({ hits: { tx: cache('320k') }, settings: { enableServerCache: true },
        timer: (fn, ms) => ms === 2000 ? (tasks.push(fn), tasks.length) : setTimeout(fn, ms) });
    c.window.resolveDownloadSongUrl = () => { events.push({ kind: 'upgrade' }); return new Promise(() => {}); };
    vm.runInContext(between('const cacheUpgradeCooldown =', 'async function fetchSongUrl('), c);
    const result = await timely(c.resolveSongUrl(song('tx', 'master'), 'master', false, false, true));
    assert.equal(result.sourceType, 'server_cache');
    assert.equal(events.some(e => e.kind === 'upgrade'), false);
    assert.equal(tasks.length, 1);
    tasks[0]();
    assert.ok(events.some(e => e.kind === 'upgrade'));
    assert.equal(result.quality, '320k');
});

test('hires and flac24bit cache hits do not trigger a redundant provider upgrade', async () => {
    const tasks = [];
    const { c } = setup({ hits: { tx: cache('flac24bit') }, settings: { enableServerCache: true },
        timer: (fn, ms) => ms === 2000 ? (tasks.push(fn), tasks.length) : setTimeout(fn, ms) });
    vm.runInContext(between('const cacheUpgradeCooldown =', 'async function fetchSongUrl('), c);
    const result = await timely(c.resolveSongUrl(song('tx', 'hires'), 'hires', false, false, true));
    assert.equal(result.quality, 'flac24bit');
    assert.equal(tasks.length, 0);
});

test('cached enriched songs remain playable without the optional merge module', async () => {
    const { c, events } = setup({ hits: { kw: cache() } });
    delete c.window.SongMerge;
    const primary = { ...song('tx'), _alternates: [song('kw')] };
    const result = await timely(c.resolveSongUrl(primary, 'flac', false, false, true));
    assert.equal(result.songInfo.source, 'kw');
    assert.equal(events.some(e => e.kind === 'provider'), false);
});
