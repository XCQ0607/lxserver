const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load(stats = {}) {
    const store = { lx_source_stats: JSON.stringify(stats) };
    const context = vm.createContext({
        console, setTimeout: fn => setTimeout(fn, 20), clearTimeout,
        localStorage: { getItem: key => store[key] ?? null, setItem: (key, value) => { store[key] = value; } },
    });
    context.window = context;
    vm.runInContext(fs.readFileSync('public/music/js/player/quality.js', 'utf8'), context);
    vm.runInContext(fs.readFileSync('public/music/js/library/song_merge.js', 'utf8'), context);
    vm.runInContext(fs.readFileSync('public/music/js/library/paged_music_search.js', 'utf8'), context);
    return { merge: context.SongMerge, quality: context.QualityManager, search: context.PagedMusicSearch, store };
}
const song = (source, id, name, singer, interval, types = ['128k', '320k']) => ({
    source, id: `${source}_${id}`, songmid: id, name, singer, interval, types: types.map(type => ({ type })),
});
const ids = list => [...list].map(item => item.id);

test('the same song on several platforms becomes one entry; different versions stay apart', () => {
    const { merge } = load();
    const list = merge.mergeInto([], [
        song('tx', 1, '晴天', '周杰伦', '04:29'),
        song('kw', 2, '晴天', '周杰伦', '04:30'),
        song('wy', 3, '晴天', '周杰伦、杨瑞代', '04:29'),
        song('kw', 4, '晴天 (Live)', '周杰伦', '04:29'),
        song('kg', 5, '晴天', '周杰伦', '05:10'),
        song('mg', 6, '晴天', '翻唱歌手', '04:29'),
        song('tx', 7, '晴天', '周杰伦', '04:29'),
    ]);
    assert.deepEqual(ids(list), ['tx_1', 'wy_3', 'kw_4', 'kg_5', 'mg_6', 'tx_7']);
    assert.deepEqual(ids(list[0]._alternates), ['kw_2']);
    assert.equal(list[1]._alternates, undefined);
});

test('a later round attaches to rows already shown without moving them', () => {
    const { merge } = load();
    const first = merge.mergeInto([], [song('tx', 1, '稻香', '周杰伦', '03:43'), song('tx', 2, '夜曲', '周杰伦', '03:46')]);
    const second = merge.mergeInto(first, [song('kw', 3, '夜曲', '周杰伦', '03:47'), song('kw', 4, '搁浅', '周杰伦', '03:58')]);
    assert.deepEqual(ids(second), ['tx_1', 'tx_2', 'kw_4']);
    assert.equal(second[1], first[1]);
    assert.deepEqual(ids(second[1]._alternates), ['kw_3']);
});

test('a merged entry offers the union of qualities, each platform keeps its own', () => {
    const { merge, quality } = load();
    const [entry] = merge.mergeInto([], [
        song('tx', 1, '晴天', '周杰伦', '04:29', ['128k', '320k']),
        song('kw', 2, '晴天', '周杰伦', '04:29', ['128k', 'flac', 'hires']),
    ]);
    assert.deepEqual([...quality.getAvailableQualities(entry)], ['128k', '320k', 'flac', 'hires']);
    assert.deepEqual([...quality.getOwnQualities(entry)], ['128k', '320k']);
    assert.equal(quality.getBestQuality(entry, 'hires'), 'hires');
    assert.equal(quality.getBestQuality(entry._alternates[0], '320k'), '128k');
});

test('candidates keep only platforms with the chosen quality, supported and fastest first', async () => {
    const { merge } = load({
        kw: { rate: 1, ms: 900, count: 5 },
        wy: { rate: 1, ms: 300, count: 5 },
        kg: { rate: 0.2, ms: 100, count: 5 },
    });
    const [entry] = merge.mergeInto([], [
        song('tx', 1, '晴天', '周杰伦', '04:29', ['128k', '320k']),
        song('kw', 2, '晴天', '周杰伦', '04:29', ['128k', 'flac']),
        song('wy', 3, '晴天', '周杰伦', '04:29', ['128k', 'flac']),
        song('kg', 4, '晴天', '周杰伦', '04:29', ['128k', 'flac']),
        song('mg', 5, '晴天', '周杰伦', '04:29', ['128k', 'flac']),
    ]);
    merge.getSupportedPlatforms = async () => new Set(['tx', 'kw', 'wy', 'kg']);
    assert.deepEqual(ids(await merge.candidates(entry, 'flac')), ['wy_3', 'kw_2', 'kg_4', 'mg_5']);
    assert.deepEqual(ids(await merge.candidates(entry, '320k')), ['tx_1']);
    assert.deepEqual(ids(await merge.candidates(entry, 'master')).length, 5, 'nobody has it: all are kept');
    merge.getSupportedPlatforms = async () => { throw new Error('denied'); };
    assert.deepEqual(ids(await merge.candidates(entry, 'flac')), ['mg_5', 'wy_3', 'kw_2', 'kg_4'], 'an untried platform gets its first chance ahead of measured ones');
});

test('the 24-bit tier is one quality whatever each platform calls it', async () => {
    const { merge, quality } = load();
    const [entry] = merge.mergeInto([], [
        song('mg', 1, '晴天', '周杰伦', '04:29', ['128k', 'flac']),
        song('kw', 2, '晴天', '周杰伦', '04:29', ['128k', 'flac', 'flac24bit']),
        song('tx', 3, '晴天', '周杰伦', '04:29', ['128k', 'flac', 'flac24bit', 'hires']),
    ]);
    assert.deepEqual(ids(await merge.candidates(entry, 'hires')), ['kw_2', 'tx_3'], 'kw only calls it flac24bit but still qualifies');
    const [mg, kw, tx] = merge.sources(entry);
    assert.equal(merge.requestQuality(kw, 'hires'), 'flac24bit');
    assert.equal(merge.requestQuality(tx, 'hires'), 'hires');
    assert.equal(merge.requestQuality(tx, 'flac24bit'), 'flac24bit');
    assert.equal(merge.requestQuality(mg, 'hires'), 'hires', 'no such tier: the request is left as chosen');
    assert.equal(merge.requestQuality(kw, 'flac'), 'flac');
    assert.equal(quality.getBestQuality(entry, 'hires'), 'hires');
});

test('only a fully identical artist name and two known durations make two entries the same song', () => {
    const { merge } = load();
    const base = song('tx', 1, '晴天', '周杰伦', '04:29', ['flac']);
    assert.equal(merge.sameSong(base, song('kw', 2, '晴天', '周杰伦 (Jay Chou)', '04:30', ['flac'])), true, 'a bracketed alias is ignored');
    assert.equal(merge.sameSong(base, song('kw', 3, '晴天', '周杰伦、杨瑞代', '04:29', ['flac'])), false, 'a duet is not the solo recording');
    assert.equal(merge.sameSong(base, song('kw', 4, '晴天', '周杰', '04:29', ['flac'])), false, 'a name contained in another is a different artist');
    assert.equal(merge.sameSong(base, song('kw', 5, '晴天', '周杰伦', '', ['flac'])), false, 'unknown duration: cannot tell the version');
    assert.equal(merge.sameSong(base, song('kw', 6, '晴天', '周杰伦', '--:--', ['flac'])), false);
});

test('recorded results move a failing platform behind a working one', async () => {
    const { merge } = load();
    const [entry] = merge.mergeInto([], [
        song('tx', 1, '晴天', '周杰伦', '04:29', ['flac']),
        song('kw', 2, '晴天', '周杰伦', '04:29', ['flac']),
    ]);
    assert.deepEqual(ids(await merge.candidates(entry, 'flac')), ['tx_1', 'kw_2']);
    merge.record('tx', false, 0);
    merge.record('tx', false, 0);
    merge.record('kw', true, 400);
    assert.deepEqual(ids(await merge.candidates(entry, 'flac')), ['kw_2', 'tx_1']);
});

test('aggregated paged search merges across providers only when asked to', async () => {
    const pages = {
        tx: [song('tx', 1, '晴天', '周杰伦', '04:29'), song('tx', 2, '稻香', '周杰伦', '03:43')],
        kw: [song('kw', 3, '晴天', '周杰伦', '04:29')],
    };
    const fetchPage = async provider => ({ list: pages[provider], hasMore: false });
    for (const [merge, expected] of [[true, 2], [false, 3]]) {
        const search = load().search.create({ keyword: '晴天', sources: ['tx', 'kw'], merge });
        await search.load({ fetchPage });
        assert.equal(search.state.list.length, expected);
    }
});

test('default quality honours both directions of the 24-bit alias', () => {
    const { quality } = load();
    for (const [preferred, actual] of [['flac24bit', 'hires'], ['hires', 'flac24bit']]) {
        const entry = song('kw', 1, 'Song', 'Singer', '04:00', ['flac']);
        entry._alternates = [song('tx', 2, 'Song', 'Singer', '04:00', [actual])];
        assert.equal(quality.getBestQuality(entry, preferred), actual);
    }
});

test('artist sets are order-independent but solo, duet and substring names stay separate', () => {
    const { merge } = load();
    const a = song('tx', 1, 'Song', '张杰、张靓颖', '04:00');
    assert.equal(merge.sameSong(a, song('kw', 2, 'Song', '张靓颖 / 张杰', '04:00')), true);
    assert.equal(merge.sameSong(a, song('kw', 3, 'Song', '张杰', '04:00')), false);
    assert.equal(merge.sameSong(a, song('kw', 4, 'Song', '张杰伦、张靓颖', '04:00')), false);
});

test('stalled supported-platform query falls back to unknown support', async () => {
    const { merge } = load();
    merge.getSupportedPlatforms = () => new Promise(() => {});
    const original = song('tx', 1, 'Song', 'Singer', '03:00');
    const result = await Promise.race([merge.candidates(original, '320k'), new Promise(resolve => setTimeout(() => resolve(null), 100))]);
    assert.equal(result?.[0], original);
});

test('preferredSources promotes the highest-priority platform to host without moving row position', () => {
    const { merge } = load();
    const first = merge.mergeInto([], [
        song('kw', 1, '稻香', '周杰伦', '03:43'),
        song('kw', 2, '晴天', '周杰伦', '04:29'),
        song('tx', 3, '晴天', '周杰伦', '04:29'),
    ], { preferredSources: ['wy', 'tx', 'kw', 'kg', 'mg'] });
    assert.deepEqual(ids(first), ['kw_1', 'tx_3']);
    assert.deepEqual(ids(first[1]._alternates), ['kw_2']);

    const second = merge.mergeInto(first, [
        song('wy', 4, '晴天', '周杰伦', '04:30'),
        song('kg', 5, '晴天', '周杰伦', '04:29'),
    ], { preferredSources: ['wy', 'tx', 'kw', 'kg', 'mg'] });
    assert.deepEqual(ids(second), ['kw_1', 'wy_4']);
    assert.deepEqual(ids(second[1]._alternates), ['tx_3', 'kw_2', 'kg_5']);
    assert.equal(second[1]._alternates.every(m => m._alternates === undefined), true);
});

test('entries without source stay separate and untyped members are not dropped by candidates()', async () => {
    const { merge } = load();
    const online = song('tx', 1, '晴天', '周杰伦', '04:29', ['flac']);
    const untyped = { id: 'local_1', name: '晴天', singer: '周杰伦', interval: '04:29' };
    const merged = merge.mergeInto([online], [untyped]);
    assert.equal(merged.length, 2);

    const localTyped = { source: 'local', id: 'local_2', name: '晴天', singer: '周杰伦', interval: '04:29' };
    const combined = merge.mergeInto([localTyped], [online]);
    const list = await merge.candidates(combined[0], 'flac');
    assert.deepEqual(ids(list), ['local_2', 'tx_1']);
});
