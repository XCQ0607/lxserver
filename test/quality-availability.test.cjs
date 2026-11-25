const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
require('tsx/cjs');
const { getVerifiedAudioSize } = require('../src/server/music/audioProbe.ts');

test('audio probes reject error pages, tiny placeholders and incomplete ranges', () => {
    const headers = { 'content-type': 'audio/flac', 'content-length': '1000000' };
    assert.equal(getVerifiedAudioSize(200, headers), 1000000);
    assert.equal(getVerifiedAudioSize(403, headers), null);
    assert.equal(getVerifiedAudioSize(200, { ...headers, 'content-type': 'application/json' }), null);
    assert.equal(getVerifiedAudioSize(200, { ...headers, 'content-length': '64' }), null);
    assert.equal(getVerifiedAudioSize(206, { ...headers, 'content-length': '1' }), null);
    assert.equal(getVerifiedAudioSize(206, { ...headers, 'content-length': '1', 'content-range': 'bytes 0-0/5000000' }), 5000000);
});

function setup(responses, folders = {}) {
    const context = vm.createContext({ console: { warn() {} }, getUserAuthHeaders: () => ({}), fetch: async (_url, options) => {
        const quality = JSON.parse(options.body).quality;
        const data = responses[quality];
        return { ok: !!data, json: async () => data, text: async () => 'unavailable' };
    }, window: { QualityManager: { getQualityDisplayName: q => q }, ServerFileState: {
        ensure: async () => {}, foldersFor: () => folders, stateText: () => '服务器已下载'
    } } });
    vm.runInContext(fs.readFileSync('public/music/js/library/single_song_ops.js', 'utf8'), context);
    return context;
}

test('single song menu keeps only verified exact qualities and preserves quality identity after filtering', async () => {
    const value = setup({
        '128k': { success: true, type: '128k', bytes: 1000000, size: '1 MB', source: 'tx' },
        hires: { success: true, type: 'hires', bytes: 64, size: '64 B', source: 'tx' },
        master: { success: true, type: '320k', bytes: 1000000, size: '1 MB', source: 'tx' },
        flac: { success: true, type: 'flac', bytes: 5000000, size: '5 MB', source: 'tx' }
    });
    const options = await value.buildQualityOptions({ id: 'test', source: 'tx' }, ['128k', '320k', 'hires', 'master', 'flac'], false);
    assert.deepEqual(Array.from(options, o => o.quality), ['128k', 'flac']);
    assert.equal(options[1].quality, 'flac');
});

test('locally available qualities remain selectable even when source probes fail; otherwise menu is empty', async () => {
    const value = setup({}, { flac: 'music' });
    const options = await value.buildQualityOptions({}, ['128k', 'flac'], true);
    assert.deepEqual(Array.from(options, o => o.quality), ['flac']);
    assert.equal((await setup({}).buildQualityOptions({}, ['128k', 'flac'], false)).length, 0);
});

test('buildQualityOptions deduplicates higher qualities with identical file size to lower tiers', async () => {
    const value = setup({
        '128k': { success: true, type: '128k', bytes: 3530000, size: '3.37 MB', source: 'wy' },
        '320k': { success: true, type: '320k', bytes: 8820000, size: '8.41 MB', source: 'wy' },
        flac24bit: { success: true, type: 'flac24bit', bytes: 47700000, size: '45.49 MB', source: 'wy' },
        hires: { success: true, type: 'hires', bytes: 47700000, size: '45.49 MB', source: 'wy' },
        atmos: { success: true, type: 'atmos', bytes: 26500000, size: '25.27 MB', source: 'wy' },
        master: { success: true, type: 'master', bytes: 26500000, size: '25.27 MB', source: 'wy' }
    }, { flac: 'music' });
    const song = { id: 'test', source: 'wy', types: [{ type: 'flac', size: '25.27 MB' }] };
    const options = await value.buildQualityOptions(song, ['128k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'master'], false);
    assert.deepEqual(Array.from(options, o => o.quality), ['128k', '320k', 'flac', 'flac24bit']);
});

test('getSelectableQualities prefers song own qualities when present and falls back to platform list when empty', () => {
    const context = vm.createContext({ console: { log() {}, warn() {} }, window: {} });
    vm.runInContext(fs.readFileSync('public/music/js/player/quality.js', 'utf8'), context);
    const { getSelectableQualities } = context.window.QualityManager;

    assert.deepEqual(
        Array.from(getSelectableQualities({ source: 'tx', types: [{ type: '128k' }, { type: '320k' }, { type: 'flac' }] })),
        ['128k', '320k', 'flac']
    );
    assert.deepEqual(
        Array.from(getSelectableQualities({ source: 'wy', types: [] })),
        ['128k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'master']
    );
});

test('buildInitialQualityOptions opens immediately from song metadata without remote probing', async () => {
    let fetchCalls = 0;
    const context = vm.createContext({
        console: { warn() {} },
        getUserAuthHeaders: () => ({}),
        fetch: async () => {
            fetchCalls++;
            throw new Error('should not probe remotely on initial open');
        },
        window: {
            QualityManager: { getQualityDisplayName: q => ({ '320k': '高音质', flac: '无损音质' }[q] || q) },
            ServerFileState: {
                ensure: async () => {},
                foldersFor: () => ({ flac: 'cache' }),
                stateText: folder => folder === 'cache' ? '服务器已缓存' : '服务器已下载'
            }
        }
    });
    vm.runInContext(fs.readFileSync('public/music/js/library/single_song_ops.js', 'utf8'), context);

    const song = {
        id: 'test',
        source: 'tx',
        types: [
            { type: '320k', size: '8.5 MB' },
            { type: 'flac', size: '32.1 MB' }
        ]
    };
    const { options } = await context.buildInitialQualityOptions(song, ['320k', 'flac'], true);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(Array.from(options, o => o.label), [
        '高音质 [8.5 MB]',
        '无损音质 [32.1 MB] · 服务器已缓存'
    ]);
    assert.deepEqual(Array.from(options, o => o.disabled), [false, false]);
});
