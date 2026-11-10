const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function manager(fetch) {
    const source = fs.readFileSync('public/music/js/download/download_manager.js', 'utf8');
    const context = vm.createContext({ window: { getUserAuthHeaders: () => ({ 'x-user-token': 'test-token' }) }, fetch, console, AbortController, URL });
    vm.runInContext(source.slice(0, source.indexOf('// Global UI Toggles')) + '\nthis.Manager = DownloadManager;', context);
    const value = Object.create(context.Manager.prototype);
    Object.assign(value, { tasks: [{ id: 'dl_test', isServer: false, status: 'downloading', nativeDownloadDispatched: true, progress: 0 }], renderTask() {}, saveTasks() {}, processQueue() {} });
    return value;
}

test('missing native progress does not report download failure', async () => {
    const value = manager(async (url, options) => {
        assert.equal(options.headers['x-user-token'], 'test-token');
        return { ok: true, json: async () => ({ success: true, data: {} }) };
    });
    for (let i = 0; i < 6; i++) await value.pollServerProgress();
    assert.equal(value.tasks[0].status, 'handedoff');
    assert.equal(value.tasks[0].errorMsg, '');
});

test('failed progress queries do not count as missing progress', async () => {
    const value = manager(async () => ({ ok: false }));
    for (let i = 0; i < 8; i++) await value.pollServerProgress();
    assert.equal(value.tasks[0].status, 'downloading');
    assert.equal(value.tasks[0].missingProgressCount, undefined);
});

test('native proxy progress updates percentage and preserves explicit errors', async () => {
    let info = { status: 'downloading', progress: 45, received: 45, total: 100, speed: 10 };
    const value = manager(async () => ({ ok: true, json: async () => ({ success: true, data: { dl_test: info } }) }));
    await value.pollServerProgress();
    assert.equal(value.tasks[0].progress, 45);
    assert.equal(value.tasks[0].downloadedBytes, 45);
    info = { status: 'error', errorMsg: 'upstream failed' };
    await value.pollServerProgress();
    assert.equal(value.tasks[0].status, 'error');
    assert.equal(value.tasks[0].errorMsg, 'upstream failed');
});

test('cached native downloads are handed off without waiting for nonexistent proxy progress', async () => {
    const value = manager(async () => { throw new Error('unexpected fetch'); });
    const task = value.tasks[0];
    Object.assign(task, { song: { name: 'Song', singer: 'Artist' }, quality: 'flac', cacheUrl: '/api/music/cache/file?filename=song.flac', useNativeDownload: true });
    let dispatched = 0;
    let scheduled = 0;
    value.triggerNativeDownload = (url, filename) => {
        assert.match(url, /^\/api\/music\/cache\/file/);
        assert.equal(filename, 'Artist - Song.flac');
        dispatched++;
    };
    value.processQueue = () => scheduled++;
    await value.startDownload(task);
    assert.equal(dispatched, 1);
    assert.equal(scheduled, 1);
    assert.equal(task.status, 'handedoff');
});
