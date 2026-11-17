const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('public/music/app.js', 'utf8');
const start = app.indexOf('async function restorePlaybackSession(');
const end = app.indexOf('/**', start);

function session(responses, account = 'alice') {
    const values = new Map([['lx_sync_user', account], ['lx_user_token', 'valid-token']]);
    const calls = [];
    const context = vm.createContext({ AbortSignal, userToken: 'valid-token', window: {},
        localStorage: { getItem: key => values.get(key) || null },
        isUserLoggedIn: () => !!values.get('lx_sync_user'),
        ensureUserAuthToken: async () => false,
        fetch: async (url, options) => {
            calls.push({ url, options });
            const next = responses.shift();
            if (typeof next === 'function') return next(values);
            if (next instanceof Error) throw next;
            assert.ok(next, 'unexpected extra authentication request');
            return { ok: true, json: async () => next };
        }
    });
    vm.runInContext(app.slice(start, end), context);
    return { ensure: context.window.ensureDownloadSession, values, calls };
}

test('missing or expired cookie is restored with API token and verified without token', async () => {
    const value = session([{ valid: false }, { valid: true, user: 'alice' }, { valid: true, user: 'alice' }]);
    await value.ensure();
    assert.equal(value.calls.length, 3);
    assert.equal(value.calls[0].options.headers, undefined);
    assert.equal(value.calls[1].options.headers['x-user-token'], 'valid-token');
    assert.equal(value.calls[2].options.headers, undefined);
});

test('a valid cookie needs no refresh, including anonymous player sessions', async () => {
    for (const account of ['alice', '']) {
        const value = session([{ valid: true, user: account || null }], account);
        await value.ensure();
        assert.equal(value.calls.length, 1);
    }
});

test('invalid token or rejected replacement cookie fails before download', async () => {
    await assert.rejects(session([{ valid: false }, { valid: false }]).ensure(), /登录已失效/);
    await assert.rejects(session([{ valid: false }, { valid: true, user: 'alice' }, { valid: false }]).ensure(), /登录已失效/);
});

test('account switch and unreachable verification endpoint cannot authorize downloads', async () => {
    const value = session([values => { values.set('lx_sync_user', 'bob'); return { ok: true, json: async () => ({ valid: true, user: 'alice' }) }; }]);
    await assert.rejects(value.ensure(), /账号已切换/);
    await assert.rejects(session([new Error('network unavailable')]).ensure(), /network unavailable/);
});

function downloadManager(window, fetch) {
    const source = fs.readFileSync('public/music/js/download/download_manager.js', 'utf8');
    const context = vm.createContext({ window, fetch, console: { log() {}, error() {} }, AbortController, URL, DOMException });
    vm.runInContext(source.slice(0, source.indexOf('// Global UI Toggles')) + '\nthis.Manager = DownloadManager;', context);
    const manager = Object.create(context.Manager.prototype);
    Object.assign(manager, { activeCount: 1, renderTask() {}, saveTasks() {}, processQueue() {} });
    return manager;
}

test('native authentication failure does not dispatch or schedule repeated downloads', async () => {
    let dispatched = 0;
    const manager = downloadManager({ ensureDownloadSession: async () => { throw Object.assign(new Error('登录已失效，请重新登录'), { status: 401 }); } });
    manager.triggerNativeDownload = () => dispatched++;
    const task = { song: { name: 'Song', singer: 'Artist' }, quality: 'flac', cacheUrl: '/api/music/cache/file/alice/song.flac', useNativeDownload: true, retryCount: 0, maxRetries: 2 };
    await manager.startDownload(task);
    assert.equal(dispatched, 0);
    assert.equal(task.status, 'error');
    assert.equal(task.retryCount, 0);
    assert.match(task.errorMsg, /登录已失效/);
});

test('native downloads wait for authentication, and cancellation during verification prevents dispatch', async () => {
    for (const cancel of [false, true]) {
        const order = [];
        let task;
        const manager = downloadManager({ ensureDownloadSession: async () => {
            order.push('verified');
            if (cancel) task.controller.abort();
        } });
        manager.triggerNativeDownload = () => order.push('download');
        task = { song: { name: 'Song', singer: 'Artist' }, quality: 'flac', cacheUrl: '/api/music/cache/file/alice/song.flac', useNativeDownload: true };
        await manager.startDownload(task);
        assert.deepEqual(order, cancel ? ['verified'] : ['verified', 'download']);
        assert.equal(task.status, cancel ? 'paused' : 'handedoff');
    }
});

test('fetch downloads send auth headers only to same-origin media and report 401 clearly', async () => {
    let requested;
    const manager = downloadManager({ getUserAuthHeaders: () => ({ 'x-user-token': 'token' }) }, async (url, options) => {
        requested = options;
        return { ok: false, status: 401 };
    });
    const task = { song: { name: 'Song', singer: 'Artist' }, quality: '320k', cacheUrl: '/api/music/cache/file/alice/song.mp3', useNativeDownload: false, retryCount: 0, maxRetries: 2 };
    await manager.startDownload(task);
    assert.equal(requested.headers['x-user-token'], 'token');
    assert.equal(task.status, 'error');
    assert.equal(task.retryCount, 0);
    assert.match(task.errorMsg, /登录已失效/);
});

test('external URLs never receive user credentials', async () => {
    let options;
    const manager = downloadManager({
        location: { href: 'https://music.example/music/', origin: 'https://music.example' },
        authorizeMediaUrl: () => 'https://cdn.example/audio.mp3',
        getUserAuthHeaders: () => ({ 'x-user-token': 'must-not-leak' })
    }, async (_url, request) => { options = request; return { ok: false, status: 403 }; });
    const task = { song: { name: 'Song', singer: 'Artist' }, quality: '320k', cacheUrl: '/api/music/cache/file/alice/song.mp3', retryCount: 0, maxRetries: 2 };
    await manager.startDownload(task);
    assert.equal(options.headers, undefined);
});
