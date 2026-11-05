const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/music/app.js', 'utf8');
function extract(name) {
    const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
    return source.slice(match.index, source.indexOf('\n}', match.index) + 2);
}

for (const initiallyVisible of [false, true]) {
    test(`album then artist preserves the artist container (initially visible: ${initiallyVisible})`, async () => {
        const nodes = new Map();
        for (const id of ['artist-detail-header', 'search-results', 'search-results-header', 'search-back-btn', 'search-type']) {
            const classes = new Set(initiallyVisible ? [] : ['hidden']);
            nodes.set(id, {
                innerHTML: '', style: {}, value: 'album',
                classList: {
                    add(...values) { values.forEach(v => classes.add(v)); },
                    remove(...values) { values.forEach(v => classes.delete(v)); },
                    contains(value) { return classes.has(value); },
                },
                remove() { nodes.delete(id); },
                removeEventListener() {},
            });
        }
        const originalHeader = nodes.get('artist-detail-header');
        const artist = { id: 'artist', source: 'tx', name: '测试歌手', musicSize: 21, albumSize: 3 };
        let songsLoaded = false;
        const context = vm.createContext({
            document: { getElementById: id => nodes.get(id) || null },
            window: { currentArtistId: 'previous', currentArtistSource: 'tx', viewingPlaylist: [], history: { pushState() {} } },
            API_BASE: '/api', currentSearchScope: 'lib_albums', currentArtistId: null, currentArtistSource: 'wy', currentArtistInfo: null,
            lastSearchType: null, lastSearchResultList: [], artistMiniBarHideTimeout: null,
            handleArtistScrollEvent() {},
            fetch: async url => ({ ok: true, json: async () => url.includes('artistDetail') ? artist : { list: [] } }),
            hideAlbumDetailHeader() {}, renderAlbumDetailHeader() {}, renderResults() {}, getImgUrl: () => '',
            isAlbumFavorited: () => false, isArtistFavorited: () => false, isArtistDisliked: () => false,
            renderArtistMiniBar() {}, initArtistScrollListener() {},
            loadArtistSongs: async () => { songsLoaded = true; },
            showError(message) { assert.fail(message); }, goBackToSearch() { assert.fail('unexpected back navigation'); },
        });
        vm.runInContext(['rememberSearchDetailOrigin', 'hideArtistDetailHeader', 'enterAlbum', 'enterArtist', 'renderArtistHeader'].map(extract).join('\n'), context);
        await context.enterAlbum('album', 'tx');
        assert.equal(nodes.get('artist-detail-header'), originalHeader);
        assert.ok(originalHeader.classList.contains('hidden'));
        assert.equal(context.window.tempArtistContext?.id || null, initiallyVisible ? 'previous' : null);
        await context.enterArtist('artist', 'tx');
        assert.ok(!originalHeader.classList.contains('hidden'));
        assert.match(originalHeader.innerHTML, /测试歌手/);
        assert.match(nodes.get('search-results').innerHTML, /artist-detail-content/);
        assert.ok(songsLoaded);
    });
}

for (const [scope, handler] of [['lib_artists', 'handleArtistLibraryClick'], ['lib_albums', 'handleAlbumLibraryClick']]) {
    test(`detail back restores ${scope} once, including an empty library`, () => {
        let restored = 0;
        let historyBacks = 0;
        const context = vm.createContext({
            window: { history: { state: { page: 'search-detail' }, back() { historyBacks++; } },
                searchDetailOrigin: { scope, list: [], type: 'song' } },
            document: { getElementById: () => null },
            hideAlbumDetailHeader() {}, hideArtistDetailHeader() {},
            [handler]() { restored++; },
            currentSearchScope: 'local_list', lastSearchResultList: ['stale song'], lastSearchType: 'song', currentArtistId: 'artist',
        });
        vm.runInContext(extract('goBackToSearch'), context);
        context.goBackToSearch();
        assert.equal(historyBacks, 1);
        assert.equal(restored, 0);
        context.goBackToSearch(true);
        assert.equal(restored, 1);
        assert.equal(context.currentSearchScope, scope);
        assert.equal(context.window.searchDetailOrigin, null);
    });
}

test('main navigation does not overwrite a detail back handled later in the same event', () => {
    const ui = fs.readFileSync('public/music/js/ui/ui_accessibility.js', 'utf8');
    const start = ui.indexOf("    window.addEventListener('popstate', event => {");
    const listener = ui.slice(start, ui.indexOf('\n    });', start) + '\n    });'.length);
    let onPopState;
    let queued;
    let overwritten = false;
    const context = vm.createContext({
        window: { addEventListener(_, fn) { onPopState = fn; }, handleListClick() { overwritten = true; } },
        setTimeout(fn) { queued = fn; }, restoring: false, current: null,
    });
    vm.runInContext(listener, context);
    const event = { state: { lxMain: { tab: 'search', listId: 'love' } } };
    onPopState(event);
    event.searchDetailHandled = true;
    queued();
    assert.equal(overwritten, false);
});
