const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function api() {
    const context = vm.createContext({ window: {} });
    vm.runInContext(fs.readFileSync('public/music/js/library/paged_music_search.js', 'utf8'), context);
    return context.window.PagedMusicSearch;
}
const song = (id, source, singer = '周杰伦', name = '发如雪') => ({ songmid: id, source, singer, name });
const plain = value => JSON.parse(JSON.stringify(value));

test('title relevance keeps platform rank and alternates sources without a short-singer bonus', () => {
    const search = api();
    const result = search.rankBatch([
        [song(1, 'kw'), song(2, 'kw', '舟')],
        [song(1, 'kg'), song(2, 'kg')],
        [song(1, 'tx'), song(2, 'tx', '甲', '别的歌')],
    ], '发如雪');
    assert.deepEqual(plain(result.map(s => [s.source, s.songmid])), [['kw', 1], ['kg', 1], ['tx', 1], ['kw', 2], ['kg', 2], ['tx', 2]]);
    assert.equal(search.relevance(song(1, 'kw', '舟'), '发如雪'), search.relevance(song(1, 'tx'), '发如雪'));
    assert.ok(search.relevance(song(1, 'tx'), '发如雪 周杰伦') > search.relevance(song(2, 'kw', '舟'), '发如雪 周杰伦'));
});

test('one concurrent request per source, source-qualified identity, stable append and exhausted sources', async () => {
    const search = api().create({ keyword: '发如雪', sources: ['kw', 'kg'] });
    const calls = [], resolvers = [];
    const first = search.load({ fetchPage: (source, page, limit) => {
        calls.push([source, page, limit]);
        return new Promise(resolve => resolvers.push(() => resolve({ list: [song(1, source)], hasMore: source === 'kw' })));
    } });
    assert.deepEqual(calls, [['kw', 1, 30], ['kg', 1, 30]]);
    resolvers.forEach(resolve => resolve());
    await first;
    assert.deepEqual(plain(search.state.list.map(s => s.id)), ['kw_1', 'kg_1']);
    const original = search.state.list.slice();
    await search.load({ fetchPage: async (source, page) => {
        assert.equal(source, 'kw'); assert.equal(page, 2);
        return { list: [song(1, source), song(2, source)], hasMore: true };
    } });
    assert.equal(search.state.list[0], original[0]);
    assert.equal(search.state.list[1], original[1]);
    assert.equal(search.state.list.length, 3);
    await search.load({ fetchPage: async source => ({ list: [song(1, source)], hasMore: true }) });
    assert.equal(search.state.providers[0].done, true);
});

test('failed sources retry their own page while successful sources advance', async () => {
    const search = api().create({ keyword: '发如雪', sources: ['kw', 'tx'] });
    await search.load({ fetchPage: async source => {
        if (source === 'tx') throw new Error('timeout');
        return { list: [song(1, source)], hasMore: true };
    } });
    assert.equal(search.state.providers[1].page, 0);
    const calls = [];
    await search.load({ fetchPage: async (source, page) => {
        calls.push([source, page]);
        return { list: [song(page, source)], hasMore: false };
    } });
    assert.deepEqual(calls, [['kw', 2], ['tx', 1]]);
    assert.equal(search.state.providers[1].error, '');
    assert.equal(search.state.list.length, 3);
});

test('cancelled or replaced rounds commit no rows or page advances, and can resume', async () => {
    const search = api().create({ keyword: 'old', sources: ['kw'] });
    let current = true, resolve;
    const pending = search.load({ current: () => current, fetchPage: () => new Promise(r => { resolve = r; }) });
    // Double clicks do not send another request.
    const second = search.load({ fetchPage: () => { throw new Error('duplicate request'); } });
    current = false;
    resolve({ list: [song(1, 'kw')], hasMore: true });
    await Promise.all([pending, second]);
    assert.equal(search.state.list.length, 0);
    assert.equal(search.state.providers[0].page, 0);
    assert.equal(search.state.loading, false);
    await search.load({ fetchPage: async (_, page) => { assert.equal(page, 1); return { list: [song(2, 'kw')], hasMore: false }; } });
    assert.equal(search.state.list.length, 1);
});

test('malformed responses can retry; an empty valid page ends the source', async () => {
    const search = api().create({ keyword: 'x', sources: ['kw'] });
    await search.load({ fetchPage: async () => ({ error: 'failed' }) });
    assert.equal(search.state.providers[0].page, 0);
    assert.ok(search.state.providers[0].error);
    await search.load({ fetchPage: async () => ({ list: [], hasMore: true }) });
    assert.equal(search.state.providers[0].done, true);
});

test('song sorter retains equal numeric IDs from different sources', () => {
    const context = vm.createContext({ window: {} });
    vm.runInContext(fs.readFileSync('public/music/js/library/paged_music_search.js', 'utf8'), context);
    const common = fs.readFileSync('public/music/js/ui/common_ui.js', 'utf8');
    vm.runInContext(common.slice(common.indexOf('function calcSimilar(')), context);
    assert.equal(context.window.sortSearchResults([song(42, 'kw'), song(42, 'kg')], '发如雪').length, 2);
});

test('adapter requests explicit pages, saves state and preserves scroll after append', async () => {
    const source = fs.readFileSync('public/music/app.js', 'utf8');
    const extract = name => { const start = source.indexOf(`function ${name}(`); return source.slice(start, source.indexOf('\n}', start) + 2); };
    const nodes = { 'search-results': { scrollTop: 234 } };
    const context = vm.createContext({ window: { currentSearchScope: 'network' }, document: { getElementById: id => nodes[id] }, API_BASE: '/api/music', SOURCES: ['kw', 'kg'], currentPage: 1,
        getSourceName: s => s, renderResults: list => { context.window.viewingPlaylist = list; nodes['search-results'].scrollTop = 0; }, renderNetworkSearchFooter() {},
    });
    vm.runInContext(fs.readFileSync('public/music/js/library/paged_music_search.js', 'utf8'), context);
    context.window.setSearchStatus = () => {};
    vm.runInContext(extract('isPagedNetworkResult') + '\nasync ' + extract('searchNetworkSongs'), context);
    const urls = [];
    const request = { current: () => true, json: async url => { urls.push(url); const u = new URL(url, 'http://test'); return { list: [song(Number(u.searchParams.get('page')), u.searchParams.get('source'))], hasMore: true }; } };
    await context.searchNetworkSongs('发如雪', 'all', {}, request);
    assert.equal(urls.length, 2);
    assert.ok(urls.every(url => url.includes('limit=30') && url.includes('page=1')));
    nodes['search-results'].scrollTop = 234;
    context.currentPage = 2;
    await context.searchNetworkSongs('发如雪', 'all', {}, request, true);
    assert.equal(nodes['search-results'].scrollTop, 234);
    assert.equal(context.window.viewingPlaylist.length, 4);
    assert.equal(context.window.savedNetworkSearchState.list, context.window.networkSongSearch.state.list);
    assert.equal(context.currentPage, 2);
    assert.equal(context.window.savedNetworkSearchState.page, 2);
});

function navigationContext({ count = 150, page = 7, more = true, size = 20 } = {}) {
    const app = fs.readFileSync('public/music/app.js', 'utf8');
    const start = app.indexOf('window.goToNetworkResultPage = async function');
    const search = { state: { list: Array.from({ length: count }, (_, i) => song(i, 'kw')), loading: false, providers: [{ done: !more, error: '' }] } };
    const context = vm.createContext({ window: { networkSongSearch: search }, settings: { itemsPerPage: size }, currentPage: page,
        isPagedNetworkResult: () => true, renderResults() {}, renderNetworkSearchFooter() {},
        goToResultPage: page => { context.currentPage = page; },
    });
    vm.runInContext(app.slice(start, app.indexOf('\n};', start) + 3), context);
    return { context, search };
}

test('local pages use the display-size setting; a partial target page fetches enough rows before navigation', async () => {
    const { context, search } = navigationContext();
    let loads = 0;
    context.window.loadMoreNetworkSongs = async () => {
        loads++;
        search.state.list = search.state.list.concat(Array.from({ length: 15 }, (_, i) => song(i + 150, 'kw')));
        search.state.providers[0].done = true;
        return true;
    };
    await context.window.goToNetworkResultPage(2);
    assert.equal(loads, 0);
    assert.equal(context.currentPage, 2);
    await context.window.goToNetworkResultPage(8);
    assert.equal(loads, 1);
    assert.equal(context.currentPage, 8);
    assert.equal(search.state.list.slice((8 - 1) * 20, 8 * 20).length, 20);
    await context.window.goToNetworkResultPage(9);
    assert.equal(loads, 1);
    assert.equal(context.currentPage, 9);
    assert.equal(search.navigating, false);
});

test('larger configured pages fetch multiple batches, while all mode loads once and stays on page one', async () => {
    const { context, search } = navigationContext({ count: 30, page: 1, size: 50 });
    let loads = 0;
    context.window.loadMoreNetworkSongs = async () => { loads++; search.state.list = search.state.list.concat(Array.from({ length: 30 }, (_, i) => song(i, 'kw'))); return true; };
    await context.window.goToNetworkResultPage(2);
    assert.equal(loads, 3);
    assert.equal(context.currentPage, 2);
    context.settings.itemsPerPage = 'all';
    await context.window.goToNetworkResultPage(3);
    assert.equal(loads, 4);
    assert.equal(context.currentPage, 1);
});

test('cancelled page loading leaves the current page unchanged', async () => {
    const { context, search } = navigationContext({ count: 20, page: 1 });
    context.window.loadMoreNetworkSongs = async () => false;
    await context.window.goToNetworkResultPage(2);
    assert.equal(context.currentPage, 1);
    assert.equal(search.navigating, false);
});

test('pagination next button stays available at the loaded boundary and delegates to lazy page loading', async () => {
    const source = fs.readFileSync('public/music/js/ui/batch_pagination.js', 'utf8');
    const extract = name => {
        const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
        return source.slice(match.index, source.indexOf('\n}', match.index) + 2);
    };
    const nodes = Object.fromEntries(['pagination-info', 'jump-page-input', 'search-btn-first', 'search-btn-prev', 'search-btn-next', 'search-btn-last'].map(id => [id, {}]));
    const called = [];
    const context = vm.createContext({ window: { viewingPlaylist: [], currentSearchScope: 'network', serverPagedSearch: false,
        networkSongSearch: { state: { loading: false, providers: [{ done: false }] } }, goToNetworkResultPage: async page => called.push(page),
    }, currentPage: 3, isPagedNetworkResult: () => true, document: { getElementById: id => nodes[id] } });
    vm.runInContext(extract('updatePaginationInfo') + '\n' + extract('nextPage'), context);
    context.updatePaginationInfo(41, 60, 60, 3, 3);
    assert.equal(nodes['search-btn-next'].disabled, false);
    assert.match(nodes['pagination-info'].textContent, /已加载 3 页/);
    await context.nextPage();
    assert.deepEqual(called, [4]);
    context.window.networkSongSearch.state.loading = true;
    context.updatePaginationInfo(41, 60, 60, 3, 3);
    assert.equal(nodes['search-btn-next'].disabled, true);
    context.window.networkSongSearch.state.loading = false;
    context.window.networkSongSearch.state.providers[0].done = true;
    context.updatePaginationInfo(41, 60, 60, 3, 3);
    assert.equal(nodes['search-btn-next'].disabled, true);
});

test('cancelled loading cannot show the load-more footer over an opened detail view', async () => {
    const source = fs.readFileSync('public/music/app.js', 'utf8');
    const extract = name => { const start = source.indexOf(`function ${name}(`); return source.slice(start, source.indexOf('\n}', start) + 2); };
    let detailVisible = false, resolve, current = true;
    const footerChanges = [];
    const context = vm.createContext({ window: { currentSearchScope: 'network' }, API_BASE: '/api/music', SOURCES: ['kw'], currentPage: 1,
        document: { getElementById: id => id === 'album-detail-header' ? { classList: { contains: () => !detailVisible } } : null },
        renderNetworkSearchFooter: visible => footerChanges.push(visible), renderResults() { throw new Error('stale render'); }, getSourceName: s => s,
    });
    vm.runInContext(fs.readFileSync('public/music/js/library/paged_music_search.js', 'utf8'), context);
    context.window.setSearchStatus = () => {};
    vm.runInContext(extract('isPagedNetworkResult') + '\nasync ' + extract('searchNetworkSongs'), context);
    const loading = context.searchNetworkSongs('发如雪', 'kw', {}, { current: () => current, json: () => new Promise(r => { resolve = r; }) });
    context.window.viewingPlaylist = context.window.networkSongSearch.state.list;
    current = false;
    detailVisible = true;
    resolve({ list: [song(1, 'kw')], hasMore: true });
    await loading;
    assert.deepEqual(footerChanges, [false]);
    assert.equal(context.isPagedNetworkResult(context.window.viewingPlaylist), false);
    assert.equal(context.window.networkSongSearch.state.providers[0].page, 0);
});
