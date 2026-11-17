const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const source = fs.readFileSync('src/server/server.ts', 'utf8');
const code = transformSync(source.slice(source.indexOf('const resolveServerSong ='), source.indexOf('const isPathInside =')) + '\nglobalThis.resolve = resolveServerSong;', { loader: 'ts' }).code;
function setup(resolve, search = async () => [{ source: 'kw' }]) {
    const calls = [];
    const c = vm.createContext({
        normalizeSongInfo: s => s, isSourceSupported: () => true,
        getDownloadQualityCandidates: q => [q, '320k', '128k'],
        findServerSourceMatches: search,
        setTimeout: fn => setTimeout(fn, 20), clearTimeout,
        fileCache: { detectDownloadSource: (_, s) => s },
        callUserApiGetMusicUrl: async (s, song, q) => { calls.push([s, q]); return resolve(s, q); },
    });
    vm.runInContext(code, c); return { resolve: c.resolve, calls };
}
const lossy = { url: '/lossy', type: 'lossy', isLossyDowngrade: true };
test('server compares other platforms instead of accepting a silent lossy downgrade', async () => {
    const c = setup(s => s === 'tx' ? lossy : { url: '/flac', type: 'flac' });
    const result = await c.resolve({ source: 'tx' }, 'flac', 'open', false);
    assert.equal(result.quality, 'flac'); assert.equal(result.songInfo.source, 'kw');
    assert.deepEqual(c.calls, [['tx', 'flac'], ['kw', 'flac']]);
});
test('server continues allowed quality fallback and preserves first lossy URL only as last resort', async () => {
    for (const available of [true, false]) {
        const c = setup((s, q) => q === 'flac' ? { ...lossy, url: `/${s}` }
            : available && q === '320k' ? { url: '/320k', type: '320k' } : (() => { throw new Error('failed'); })());
        const result = await c.resolve({ source: 'tx' }, 'flac', 'open', true);
        assert.equal(result.quality, available ? '320k' : 'lossy');
        assert.equal(result.url, available ? '/320k' : '/tx');
        assert.ok(c.calls.some(([, q]) => q === '320k'));
    }
});

test('retained lossy fallback survives stalled provider search and URL resolution', async () => {
    for (const phase of ['search', 'resolve']) {
        const c = setup(s => s === 'tx' ? lossy : new Promise(() => {}),
            phase === 'search' ? () => new Promise(() => {}) : undefined);
        const result = await Promise.race([c.resolve({ source: 'tx' }, 'flac', 'open', true),
            new Promise(resolve => setTimeout(() => resolve(null), 100))]);
        assert.equal(result?.url, '/lossy');
    }
});
test('a stalled search without a playable fallback rejects instead of hanging', async () => {
    const c = setup(() => { throw new Error('failed'); }, () => new Promise(() => {}));
    await assert.rejects(Promise.race([c.resolve({ source: 'tx' }, 'flac', 'open', false),
        new Promise(resolve => setTimeout(() => resolve(null), 100))]), /No downloadable source/);
});

test('timed-out source-match cache entry is evicted and a subsequent search can succeed', async () => {
    const cache = new Map(); let searches = 0, release;
    const raw = source.slice(source.indexOf('const findServerSourceMatches ='), source.indexOf('interface ServerSongResolveResult'));
    const c = vm.createContext({ sourceMatchCache: cache, Date, console,
        normalizeSongMatchText: s => s, getSongDurationSeconds: () => 180, getSongMatchScore: () => 1,
        AUTO_SOURCE_ORDER: ['tx', 'kw'], SOURCE_MATCH_CACHE_TTL: 60000, isSourceSupported: () => true,
        setTimeout: fn => setTimeout(fn, 20), clearTimeout,
        musicSdk: { kw: { musicSearch: { search: () => {
            searches++; return searches === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ list: [{ id: 'second' }] });
        } } } },
    });
    vm.runInContext(transformSync(raw + '\nglobalThis.find = findServerSourceMatches;', { loader: 'ts' }).code, c);
    const seed = { source: 'tx', name: 'Song', singer: 'Singer' };
    const result = await Promise.race([c.find(seed, 'open'), new Promise(resolve => setTimeout(() => resolve(null), 100))]);
    assert.deepEqual(result && [...result], []);
    assert.equal(cache.size, 0);
    assert.equal((await c.find(seed, 'open'))[0].id, 'second');
    release({ list: [{ id: 'late' }] }); await new Promise(resolve => setImmediate(resolve));
    assert.equal((await c.find(seed, 'open'))[0].id, 'second');
    assert.equal(searches, 2);
});
