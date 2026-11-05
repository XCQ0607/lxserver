const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/music/app.js', 'utf8');
const start = source.indexOf('function enqueueSong(');
const enqueue = source.slice(start, source.indexOf('\n}', start) + 2);
const cleanStart = source.indexOf('function cleanSongData(');
const cleanSong = source.slice(cleanStart, source.indexOf('\n}', cleanStart) + 2);
const song = id => ({ id, source: 'tx' });

function setup(list, index = 0) {
    const context = vm.createContext({
        currentPlaylist: list, currentIndex: index, preSelectedNextIndex: 8,
        renderQueue() {}, savePlaybackState() {}, showInfo() {}, showSuccess() {},
        revealSongInQueue(index) { context.revealedIndex = index; },
    });
    vm.runInContext(cleanSong + '\n' + enqueue, context);
    return context;
}

test('repeated additions use source and normalized ID, preserving different versions', () => {
    const c = setup([song(1)]);
    c.enqueueSong(song('1'));
    assert.equal(c.currentPlaylist.length, 1);
    assert.equal(c.revealedIndex, 0);
    c.enqueueSong({ id: 1, source: 'wy' });
    c.enqueueSong(song(2));
    assert.equal(c.currentPlaylist.length, 3);
});

test('search song matches the real default-list conversion, including QQ numeric ID and songmid', () => {
    const raw = { id: 12345, songId: 12345, songmid: 'mid123', source: 'tx', name: 'track' };
    const c = setup([]);
    const saved = c.cleanSongData(raw);
    assert.equal(saved.id, 'tx_mid123');
    c.currentPlaylist.push(saved);
    c.enqueueSong(raw);
    assert.equal(c.currentPlaylist.length, 1);
    assert.equal(c.revealedIndex, 0);
    c.enqueueSong(raw, true);
    assert.equal(c.currentPlaylist.length, 1);
    assert.equal(c.revealedIndex, 0);
});

test('play next moves a default-list entry instead of inserting the raw search song', () => {
    const raw = { id: 12345, songmid: 'mid123', source: 'tx' };
    const c = setup([song(9)]);
    const saved = c.cleanSongData(raw);
    c.currentPlaylist.push(song(8), saved);
    c.enqueueSong(raw, true);
    assert.equal(c.currentPlaylist.length, 3);
    assert.equal(c.currentPlaylist[1], saved);
    assert.equal(c.currentIndex, 0);
});

test('prefixed IDs from saved lists match unprefixed search IDs for other providers', () => {
    for (const provider of ['wy', 'kw', 'kg', 'mg']) {
        const c = setup([{ id: `${provider}_123`, source: provider, meta: { songId: '123' } }]);
        c.enqueueSong({ id: 123, source: provider });
        assert.equal(c.currentPlaylist.length, 1);
        assert.equal(c.revealedIndex, 0);
    }
});

for (const index of [0, 2]) {
    test(`play next moves existing copies and preserves current song at index ${index}`, () => {
        const playing = song(9);
        const list = [song(1), song(2), song('1'), song(3)];
        list.splice(index, 0, playing);
        const c = setup(list, index);
        c.enqueueSong(song(1), true);
        assert.equal(c.currentPlaylist[c.currentIndex], playing);
        assert.equal(c.currentPlaylist[c.currentIndex + 1].id, 1);
        assert.equal(c.currentPlaylist.filter(s => String(s.id) === '1').length, 1);
        assert.equal(c.preSelectedNextIndex, null);
    });
}

test('currently playing track is not inserted again', () => {
    const c = setup([song(1), song(2)]);
    c.enqueueSong(song(1), true);
    assert.equal(c.currentPlaylist.length, 2);
    assert.equal(c.currentIndex, 0);
    assert.equal(c.revealedIndex, 0);
});

for (const hidden of [true, false]) {
    test(`duplicate reveal opens and locates the target (drawer hidden: ${hidden})`, () => {
        const classes = new Set(hidden ? ['translate-x-full'] : []);
        const timers = [];
        const target = { classList: { add() {}, remove() {} }, scrollIntoView() { scrolled++; } };
        let scrolled = 0;
        let renders = 0;
        const drawer = { classList: {
            contains: name => classes.has(name), remove: name => classes.delete(name),
        } };
        const context = vm.createContext({
            window: { innerWidth: 1200 },
            document: { getElementById: id => id === 'queue-drawer' ? drawer : id === 'queue-list' ? { children: [{}, target] } : null },
            renderQueue() { renders++; },
            scrollToCurrentSongInQueue() { assert.fail('must locate the duplicate, not the playing track'); },
            setTimeout(fn) { timers.push(fn); },
        });
        for (const name of ['toggleQueueDrawer', 'scrollToSongInQueue', 'revealSongInQueue']) {
            const start = source.indexOf(`function ${name}(`);
            vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
        }
        context.revealSongInQueue(1);
        if (hidden) timers.shift()();
        assert.equal(classes.has('translate-x-full'), false);
        assert.equal(scrolled, 1);
        assert.equal(renders, hidden ? 1 : 0);
    });
}

test('full queue allows moves but rejects new additions', () => {
    const c = setup(Array.from({ length: 1000 }, (_, i) => song(i)));
    c.enqueueSong(song(1001));
    assert.equal(c.currentPlaylist.length, 1000);
    c.enqueueSong(song(999), true);
    assert.equal(c.currentPlaylist[1].id, 999);
    assert.equal(c.currentPlaylist.length, 1000);
});

test('empty queue accepts next once; missing IDs do not merge unrelated songs', () => {
    const c = setup([], -1);
    c.enqueueSong(song(1), true);
    c.enqueueSong(song(1), true);
    assert.equal(c.currentPlaylist.length, 1);
    c.enqueueSong({ name: 'a' });
    c.enqueueSong({ name: 'b' });
    assert.equal(c.currentPlaylist.length, 3);
});
