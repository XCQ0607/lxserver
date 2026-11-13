const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/music/app.js', 'utf8');
const slice = (startMarker, endMarker) => {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `missing ${startMarker}`);
    return source.slice(start, source.indexOf(endMarker, start));
};
const code = [
    slice('function playNext() {', '\nfunction playPrev('),
    slice('function cleanSongData(', '\n\n// Modified handler for Grid Buttons'),
    slice('function getNextIndex() {', '\n// 解析并缓存一首歌的播放链接'),
].join('\n');

const song = (id, name = `song${id}`) => ({ id, songmid: id, source: 'tx', name, singer: 'singer' });

function setup({ list, index, similar = [], settings = {}, playMode = 'list', armed = true, fetchImpl }) {
    const context = vm.createContext({
        console: { log() {}, warn() {} },
        window: {},
        URLSearchParams,
        API_BASE: '/api/music',
        settings, playMode,
        currentPlaylist: list, currentIndex: index, preSelectedNextIndex: null,
        searchRadioArmed: armed, searchRadioCache: null, searchRadioSongs: new WeakSet(),
        getUserAuthHeaders: () => ({}),
        localStorage: { setItem() {} },
        showInfo() {},
        fetched: [], played: [], updated: null,
        fetch: fetchImpl || (async url => {
            context.fetched.push(url);
            return { ok: true, json: async () => ({ list: similar, strategy: 'similar' }) };
        }),
        playSong(item, i) { context.played.push(i); context.currentIndex = i; },
        updatePlaylist(newList, startIndex, scope) {
            context.updated = { ids: [...newList].map(s => s.id), startIndex, scope };
            context.currentPlaylist = newList;
            context.currentIndex = startIndex;
        },
    });
    vm.runInContext(code, context);
    return context;
}
const settle = () => new Promise(resolve => setTimeout(resolve, 10));

test('a song picked from search results is followed by similar songs, ahead of the remaining results', async () => {
    const c = setup({ list: [song('a'), song('b'), song('c')], index: 1, similar: [song('a'), song('x'), song('y'), song('x')] });
    c.playNext();
    await settle();
    assert.deepEqual(c.updated, { ids: ['a', 'b', 'x', 'y', 'c'], startIndex: 2, scope: 'network' });
    assert.equal(c.searchRadioArmed, true);
    assert.equal(c.fetched.length, 1);
    assert.match(c.fetched[0], /^\/api\/music\/similar\?source=tx&songId=&songmid=b&name=songb&singer=singer$/);
    assert.deepEqual(c.played, []);
});

test('inserted similar songs play in order, then the last one seeds the next batch', async () => {
    const c = setup({ list: [song('a'), song('b')], index: 0, similar: [song('x'), song('y')] });
    c.playNext();
    await settle();
    assert.deepEqual(c.updated.ids, ['a', 'x', 'y', 'b']);
    c.updated = null;
    c.playNext();
    await settle();
    assert.deepEqual(c.played, [2]);
    assert.equal(c.fetched.length, 1);
    c.playNext();
    await settle();
    assert.equal(c.fetched.length, 2);
    assert.match(c.fetched[1], /songmid=y/);
});

test('the last song of the queue also continues with similar songs', async () => {
    const c = setup({ list: [song('a'), song('b')], index: 1, similar: [song('x')] });
    c.playNext();
    await settle();
    assert.deepEqual(c.updated.ids, ['a', 'b', 'x']);
});

test('a default-list seed sends the numeric QQ id kept in meta', async () => {
    const seed = { id: 'tx_mid1', source: 'tx', name: 'n', singer: 's', meta: { songId: 'mid1', id: 97773 } };
    const c = setup({ list: [seed], index: 0, similar: [song('x')] });
    c.playNext();
    await settle();
    assert.match(c.fetched[0], /songId=97773&songmid=mid1/);
});

test('other play modes, non-search queues and the disabled setting keep normal behaviour', async () => {
    const cases = [
        { index: 1, playMode: 'random' },
        { index: 1, playMode: 'single' },
        { index: 1, armed: false },
        { index: 1, settings: { autoPlaySimilarAfterSearch: false } },
    ];
    for (const options of cases) {
        const c = setup({ list: [song('a'), song('b')], similar: [song('x')], ...options });
        c.playNext();
        await settle();
        assert.equal(c.fetched.length, 0, JSON.stringify(options));
        assert.equal(c.updated, null);
        assert.equal(c.played.length, 1);
    }
});

test('no usable similar songs or a failed request falls back to the play mode', async () => {
    const empty = setup({ list: [song('a'), song('b')], index: 1, similar: [song('a')] });
    empty.playNext();
    await settle();
    assert.deepEqual(empty.played, [0]);

    const failed = setup({
        list: [song('a'), song('b')], index: 1, playMode: 'order',
        fetchImpl: async () => ({ ok: false, status: 500 }),
    });
    failed.playNext();
    await settle();
    assert.deepEqual(failed.played, []);
    assert.equal(failed.updated, null);
    assert.equal(failed.searchRadioCache, null);
});

test('switching songs while the request is pending leaves the new playback alone', async () => {
    let release;
    const c = setup({
        list: [song('a'), song('b')], index: 1,
        fetchImpl: () => new Promise(resolve => {
            release = () => resolve({ ok: true, json: async () => ({ list: [song('x')] }) });
        }),
    });
    c.playNext();
    c.currentIndex = 0;
    release();
    await settle();
    assert.equal(c.updated, null);
    assert.deepEqual(c.played, []);
});

test('disliked songs are skipped and repeated triggers share one request', async () => {
    const c = setup({ list: [song('a')], index: 0, similar: [song('x'), song('y')] });
    c.window = { DislikeManager: { isDisliked: s => s.id === 'x' } };
    c.playNext();
    c.playNext();
    await settle();
    assert.equal(c.fetched.length, 1);
    assert.deepEqual(c.updated.ids, ['a', 'y']);
    assert.equal(c.searchRadioArmed, true);
});

test('a song the user queued as next plays before any similar songs', async () => {
    const c = setup({ list: [song('a'), song('b'), song('c')], index: 0, similar: [song('x')] });
    c.keepAsNextSong(c.currentPlaylist[1]);
    c.playNext();
    await settle();
    assert.equal(c.fetched.length, 0);
    assert.equal(c.updated, null);
    assert.deepEqual(c.played, [1]);
});

test('pausing while similar songs are being fetched cancels the automatic continuation', async () => {
    let release;
    const c = setup({
        list: [song('a'), song('b')], index: 1,
        fetchImpl: () => new Promise(resolve => {
            release = () => resolve({ ok: true, json: async () => ({ list: [song('x')] }) });
        }),
    });
    c.playNext();
    c.cancelSearchRadioContinuation();
    release();
    await settle();
    assert.equal(c.updated, null);
    assert.deepEqual(c.played, []);
});

test('similar songs restored with a saved queue are still recognised after a reload', async () => {
    const restored = { ...song('x'), _searchRadio: true };
    const c = setup({ list: [song('a'), restored, song('b')], index: 0, similar: [song('y')] });
    c.playNext();
    await settle();
    assert.equal(c.fetched.length, 0);
    assert.deepEqual(c.played, [1]);
});
