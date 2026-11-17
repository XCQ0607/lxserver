const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const source = fs.readFileSync('src/server/server.ts', 'utf8');
const code = transformSync(source.slice(source.indexOf('const resolveServerSong ='), source.indexOf('const isPathInside =')) + '\nglobalThis.resolve = resolveServerSong;', { loader: 'ts' }).code;
function setup(resolve) {
    const calls = [];
    const c = vm.createContext({
        normalizeSongInfo: s => s, isSourceSupported: () => true,
        getDownloadQualityCandidates: q => [q, '320k', '128k'],
        findServerSourceMatches: async () => [{ source: 'kw' }],
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
