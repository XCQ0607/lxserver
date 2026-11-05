const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/music/js/ui/batch_pagination.js', 'utf8');

function setup(activeView) {
    const songs = [{ id: 1 }, { id: '2' }, { id: '3' }];
    const rows = songs.map(song => ({ id: String(song.id), selected: false }));
    const nodes = {};
    for (const id of ['songlist-detail-view', 'artist-detail-header', 'view-leaderboard']) {
        nodes[id] = { classList: { contains: name => name === 'hidden' && id !== activeView } };
    }
    const calls = [];
    let context;
    function render(view) {
        calls.push(view);
        for (const row of rows) row.selected = context.selectedItems.has(row.id);
    }
    context = vm.createContext({
        selectedItems: new Set(), selectedSongObjects: new Map(), viewingPlaylist: songs,
        batchMode: true, currentSearchScope: 'network', currentArtistSongsCache: songs,
        document: { getElementById: id => nodes[id] || null },
        renderResults: () => render('main'),
        renderArtistSongsUI: () => render('artist'),
        SongListManager: { renderDetail: () => render('songlist') },
        LeaderboardManager: { renderSongs: () => render('leaderboard') },
    });
    context.window = context;
    vm.runInContext(source, context);
    return { context, rows, calls };
}

for (const [activeView, renderer] of [
    [null, 'main'],
    ['songlist-detail-view', 'songlist'],
    ['artist-detail-header', 'artist'],
    ['view-leaderboard', 'leaderboard'],
]) {
    test(`batch selection refreshes ${renderer} with permanent hidden detail nodes`, () => {
        const { context, rows, calls } = setup(activeView);
        context.selectAllVisible();
        assert.equal(context.selectedItems.size, 3);
        assert.equal(context.selectedSongObjects.size, 3);
        assert.ok(rows.every(row => row.selected));
        context.clearSelection();
        assert.equal(context.selectedItems.size, 0);
        assert.ok(rows.every(row => !row.selected));
        context.selectAllVisible();
        context.exitBatchMode();
        assert.equal(context.batchMode, false);
        assert.ok(rows.every(row => !row.selected));
        assert.deepEqual(calls, Array(4).fill(renderer));
    });
}

test('select all respects filtered matches when refreshing main list', () => {
    const { context, rows } = setup(null);
    context.ListSearch = {
        state: { active: true, onlyShowMatches: true },
        getDisplayList: list => [{ item: list[1] }],
    };
    context.selectAllVisible();
    assert.deepEqual([...context.selectedItems], ['2']);
    assert.deepEqual(rows.map(row => row.selected), [false, true, false]);
});
