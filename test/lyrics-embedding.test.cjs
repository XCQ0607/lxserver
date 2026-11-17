const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { MusicTagger } = require('music-tag-native');
require('tsx/cjs');
const { resolveDownloadLyrics } = require('../src/server/music/downloadLyrics.ts');

const server = fs.readFileSync('src/server/server.ts', 'utf8');
const start = server.indexOf("let expectedLyrics = ''");
const end = server.indexOf('tagger.save()', start);
const embedBlock = server.slice(start, end).replace(/catch \(e: any\)/g, 'catch (e)');
assert.ok(start > 0 && end > start);

test('real MP3 and FLAC lyrics roundtrip and download proxy field selection', async t => {
    try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); }
    catch { t.skip('ffmpeg is required for real audio fixtures'); return; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-lyrics-test-'));
    // Only temporary generated audio is touched; retain it for independent inspection.
    console.log('Temporary audio evidence:', dir);
    const original = '[00:01.00]原文テスト\n[00:02.00]次の行';
    const translation = '[00:01.00]中文翻译';
    const romanization = '[00:01.00]genbun tesuto';
    for (const ext of ['mp3', 'flac']) {
        await t.test(`${ext}: proxy normalizes prefixed IDs and embeds original, translation and romanization`, async () => {
            const file = path.join(dir, `proxy.${ext}`);
            execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-y', file]);
            const tagger = new MusicTagger();
            try {
                tagger.loadPath(file);
                const context = vm.createContext({ urlObj: new URL('http://localhost'), embedLyric: true, lyricSource: 'wy', lyricSongmid: 'wy_test', songName: 'Test', artist: 'Test', lyricHash: '', lyricInterval: '', tagger, resolveDownloadLyrics, proxyUser: 'alice', lookupLocalLyrics: () => ({ exists: false }), console,
                    musicSdk: { wy: { getLyric: song => { assert.equal(song.songmid, 'test'); return { promise: Promise.resolve({ lyric: original, tlyric: translation, rlyric: romanization }) }; } } } });
                await vm.runInContext(`(async () => { ${embedBlock} })()`, context);
                tagger.save();
            } finally { tagger.dispose(); }
            const reader = new MusicTagger();
            try {
                reader.loadPath(file);
                assert.ok(reader.lyrics.includes(original));
                assert.ok(reader.lyrics.includes('中文翻译'));
                assert.ok(reader.lyrics.includes('genbun'));
            } finally { reader.dispose(); }
            const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { encoding: 'utf8' }));
            const tags = JSON.stringify([probe.format?.tags, ...probe.streams.map(s => s.tags)]);
            assert.ok(tags.includes('原文テスト'), 'independent ffprobe reader must also find embedded lyrics');
            console.log(ext, 'MusicTagger and ffprobe both read original lyrics');
        });
    }
    await t.test('lyric request failure is swallowed and leaves a valid FLAC without lyrics', async () => {
        const file = path.join(dir, 'failed-lyric.flac');
        execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-y', file]);
        const tagger = new MusicTagger();
        try {
            tagger.loadPath(file);
            let warnings = 0;
            const context = vm.createContext({ urlObj: new URL('http://localhost'), embedLyric: true, lyricSource: 'wy', lyricSongmid: 'test', songName: 'Test', artist: 'Test', lyricHash: '', lyricInterval: '', tagger, resolveDownloadLyrics, proxyUser: 'alice', lookupLocalLyrics: () => ({ exists: false }), console: { warn() { warnings++; } },
                musicSdk: { wy: { getLyric: () => ({ promise: Promise.reject(new Error('fixture lyric failure')) }) } } });
            await vm.runInContext(`(async () => { ${embedBlock} })()`, context);
            assert.equal(warnings, 1, 'lyric errors must be logged');
            tagger.save();
        } finally { tagger.dispose(); }
        const reader = new MusicTagger();
        try {
            reader.loadPath(file);
            assert.ok(!reader.lyrics);
        } finally { reader.dispose(); }
    });
});

test('cached lyrics stay owner-scoped and work without contacting the source', async () => {
    const text = await resolveDownloadLyrics({ source: 'wy', id: 'wy_509106775' }, 'alice', (song, owner) => {
        assert.equal(owner, 'alice');
        assert.equal(song.songmid, '509106775');
        return { exists: true, content: { lyric: '[00:01.00]original', tlyric: '[00:01.00]translated' } };
    }, { wy: { getLyric() { throw new Error('must not request source'); } } });
    assert.ok(text.includes('translated'));
});
