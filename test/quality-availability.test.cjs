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
