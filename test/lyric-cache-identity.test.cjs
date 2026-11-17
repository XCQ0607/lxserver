const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');

test('strict download lyric caches never match a different platform by name or bare ID', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-lyric-identity-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const wrong = 'Song_-_Singer_-_wy_-_321_-_flac.lrc';
    fs.writeFileSync(path.join(dir, wrong), '[00:01.00]wrong platform');
    const source = fs.readFileSync('src/server/music/fileCache.ts', 'utf8');
    const start = source.indexOf('export const checkLyricCache =');
    const end = source.indexOf('export const saveLyricCache =', start);
    const context = vm.createContext({ fs, path, console, normalizeSongId: song => `${song.source}_${song.songmid}`, parseLyrics: lyric => ({ lyric }),
        getCacheDir: () => dir, indexManager: { get: () => null, getAll: () => [{ name: 'Song', singer: 'Singer', source: 'wy', hasLyric: true, lyricFilename: wrong }] } });
    vm.runInContext(transformSync(source.slice(start, end).replace('export const', 'const') + '\nthis.check = checkLyricCache;', { loader: 'ts' }).code, context);
    const song = { source: 'tx', songmid: '321', name: 'Song', singer: 'Singer' };
    assert.equal(context.check(song, 'alice').exists, true, 'playback keeps its existing name fallback');
    assert.equal(context.check({ ...song, strictIdentity: true }, 'alice').exists, false);
    fs.writeFileSync(path.join(dir, 'Song_-_Singer_-_tx_-_321_-_flac.lrc'), '[00:01.00]correct platform');
    assert.equal(context.check({ ...song, strictIdentity: true }, 'alice').content.lyric, '[00:01.00]correct platform');
});
