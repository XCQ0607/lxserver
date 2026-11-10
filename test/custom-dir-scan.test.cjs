const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

function setup(t, overrides = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-custom-scan-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const reads = [];
    let blocked = null;
    const mockedFs = { ...fs, promises: { ...fs.promises,
        readdir: async (dir, options) => {
            reads.push(dir);
            if (dir === blocked) throw new Error('directory unavailable');
            return fs.promises.readdir(dir, options);
        },
    } };
    const context = vm.createContext({ fs: mockedFs, path, crypto, console, global: {},
        getCustomMusicDir: () => root,
        MusicTagger: class { loadPath() {} dispose() {} },
        detectQualityFromBitrate: () => '128k', formatPlayTime: () => '',
        ...overrides,
    });
    const source = fs.readFileSync('src/server/music/customMusicManager.ts', 'utf8');
    const code = source.slice(source.indexOf('class CustomIndexManager'), source.indexOf('export const getCustomCover')) +
        source.slice(source.indexOf('export const removeCustomFile'), source.indexOf('export const checkCustomLyricCache'));
    vm.runInContext(stripTypeScriptTypes(code.replaceAll('export const', 'const')) +
        '\nglobalThis.api = { syncCustomIndex, getCustomMusicList, customIndexManager, getCustomMusicVersion, removeCustomFile, batchEmbedLyric };', context);
    return { root, reads, api: context.api, mockedFs, block: dir => { blocked = dir; } };
}

test('one traversal discovers nested audio and preserves deeper index association priority', async t => {
    const { root, reads, api } = setup(t);
    const child = path.join(root, 'album');
    fs.mkdirSync(child);
    fs.mkdirSync(path.join(root, '.hidden'));
    fs.writeFileSync(path.join(child, 'song.mp3'), 'test audio');
    fs.writeFileSync(path.join(root, 'cache_index.json'), JSON.stringify({ parent: {
        filename: 'album/song.mp3', id: 'parent', source: 'wy',
    } }));
    fs.writeFileSync(path.join(child, 'music_index.json'), JSON.stringify({ child: {
        filename: 'song.mp3', id: 'child', source: 'tx',
    } }));
    const list = await api.syncCustomIndex('alice');
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'child');
    assert.equal(list[0].filename, 'album/song.mp3');
    assert.deepEqual(reads, [root, child]);
    reads.length = 0;
    const selected = await api.getCustomMusicList('alice', ['album/song.mp3']);
    assert.equal(selected.length, 1);
    assert.equal((await api.getCustomMusicList('alice', ['absent.mp3'])).length, 0);
    assert.equal(reads.length, 0, 'indexed list reads do not traverse directories');
});

test('sync discovers external additions/changes/deletions; failed traversal preserves persisted index', async t => {
    const { root, reads, api, block } = setup(t);
    const child = path.join(root, 'album');
    fs.mkdirSync(child);
    fs.writeFileSync(path.join(child, 'old.mp3'), 'old');
    await api.syncCustomIndex('alice');
    fs.unlinkSync(path.join(child, 'old.mp3'));
    fs.writeFileSync(path.join(child, 'new.mp3'), 'new');
    let list = await api.syncCustomIndex('alice');
    assert.deepEqual(Array.from(list, item => item.filename), ['album/new.mp3']);
    fs.appendFileSync(path.join(child, 'new.mp3'), ' modified');
    list = await api.syncCustomIndex('alice');
    assert.equal(list[0].size, 12);
    const index = path.join(root, 'custom_index.json');
    const before = fs.readFileSync(index, 'utf8');
    block(child);
    await assert.rejects(api.syncCustomIndex('alice'), /directory unavailable/);
    assert.equal(fs.readFileSync(index, 'utf8'), before);
    block(null);
    reads.length = 0;
    await Promise.all([api.syncCustomIndex('alice'), api.syncCustomIndex('alice')]);
    assert.deepEqual(reads, [root, child]);
});

test('version checks do not scan, external index updates reload the live Map, corrupt data preserves it', async t => {
    const { root, reads, api } = setup(t);
    fs.writeFileSync(path.join(root, 'song.mp3'), 'audio');
    await api.syncCustomIndex('alice');
    const live = api.customIndexManager.load('alice');
    const version = api.getCustomMusicVersion('alice');
    reads.length = 0;
    assert.equal(api.getCustomMusicVersion('alice'), version);
    assert.equal(reads.length, 0);
    const indexFile = path.join(root, 'custom_index.json');
    const updated = { ...live.get('song.mp3'), name: 'externally updated song' };
    fs.writeFileSync(indexFile, JSON.stringify({ 'song.mp3': updated }));
    assert.notEqual(api.getCustomMusicVersion('alice'), version);
    assert.equal((await api.getCustomMusicList('alice'))[0].name, updated.name);
    assert.equal(api.customIndexManager.load('alice'), live);
    fs.writeFileSync(indexFile, '{corrupt');
    await assert.rejects(api.getCustomMusicList('alice'));
    assert.equal(live.get('song.mp3').name, updated.name);
    assert.equal(fs.readFileSync(indexFile, 'utf8'), '{corrupt');
});

test('unchanged indexes are not reparsed and partial queries bypass full-library enumeration', async t => {
    const { root, api, mockedFs } = setup(t);
    fs.writeFileSync(path.join(root, 'song.mp3'), 'audio');
    await api.syncCustomIndex('alice');
    let fileReads = 0;
    mockedFs.readFileSync = (...args) => { fileReads++; return fs.readFileSync(...args); };
    api.customIndexManager.load('alice');
    api.customIndexManager.load('alice');
    assert.equal(fileReads, 0);
    api.customIndexManager.getAll = () => assert.fail('partial query enumerated all records');
    assert.equal((await api.getCustomMusicList('alice', ['song.mp3', 'song.mp3'])).length, 1);
});

test('failed atomic replacement retains the old index and cleans temporary files; retry succeeds', async t => {
    const { root, api, mockedFs } = setup(t, { console: { error() {}, warn() {} } });
    fs.writeFileSync(path.join(root, 'song.mp3'), 'audio');
    await api.syncCustomIndex('alice');
    const file = path.join(root, 'custom_index.json');
    const before = fs.readFileSync(file, 'utf8');
    const item = api.customIndexManager.load('alice').get('song.mp3');
    api.customIndexManager.set('alice', item.filename, { ...item, name: 'updated' });
    mockedFs.renameSync = () => { throw new Error('disk busy'); };
    assert.throws(() => api.customIndexManager.save('alice'), /disk busy/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.equal(fs.readdirSync(root).some(name => name.endsWith('.tmp')), false);
    mockedFs.renameSync = fs.renameSync;
    api.customIndexManager.save('alice');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))['song.mp3'].name, 'updated');
});

test('batch removals defer index persistence until one final save', async t => {
    const { root, api, mockedFs } = setup(t);
    for (const name of ['a.mp3', 'b.mp3']) fs.writeFileSync(path.join(root, name), 'audio');
    await api.syncCustomIndex('alice');
    let commits = 0;
    mockedFs.renameSync = (...args) => { commits++; return fs.renameSync(...args); };
    assert.equal(api.removeCustomFile('a.mp3', 'alice', false), true);
    assert.equal(api.removeCustomFile('b.mp3', 'alice', false), true);
    assert.equal(commits, 0);
    api.customIndexManager.save('alice');
    assert.equal(commits, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'custom_index.json'), 'utf8')), {});
});

test('lyric fetch cannot overwrite a concurrent relink or embed lyrics for the old identity', async t => {
    let resolveLyric;
    let embedWrites = 0;
    const { root, api } = setup(t, {
        getLyricFetcher: () => () => new Promise(resolve => { resolveLyric = resolve; }),
        embedLyricsIntoFile: () => { embedWrites++; return { success: true }; },
    });
    fs.writeFileSync(path.join(root, 'song.mp3'), 'audio');
    await api.syncCustomIndex('alice');
    const item = api.customIndexManager.load('alice').get('song.mp3');
    api.customIndexManager.set('alice', item.filename, { ...item, id: 'old', source: 'wy' });
    api.customIndexManager.save('alice');
    const pending = api.batchEmbedLyric(['song.mp3'], 'alice');
    assert.equal(typeof resolveLyric, 'function');
    api.customIndexManager.set('alice', item.filename, { ...item, id: 'new', source: 'tx' });
    api.customIndexManager.save('alice');
    resolveLyric('[00:00]old song lyric');
    const result = await pending;
    assert.equal(result.failCount, 1);
    assert.equal(embedWrites, 0);
    assert.equal(api.customIndexManager.load('alice').get('song.mp3').id, 'new');
});
