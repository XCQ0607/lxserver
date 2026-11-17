const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

function setup(fetch) {
    const window = { currentListData: { username: 'alice' } };
    const context = vm.createContext({ window, fetch, console,
        localStorage: { getItem: () => null }, document: { getElementById: () => null } });
    vm.runInContext(fs.readFileSync('public/music/js/local/customDir.js', 'utf8'), context);
    const manager = window.CustomDirManager;
    manager.isActive = true;
    manager.syncBatchButtonsVisibility = () => {};
    manager.applyFilters = () => { manager.currentPage = 1; };
    manager.render = () => {};
    return { window, manager };
}
const response = data => ({ ok: true, json: async () => ({ success: true, data }) });

test('concurrent loads share one request; returning preserves page without requesting', async () => {
    let count = 0;
    const { manager } = setup(async () => { count++; return response([{ filename: 'a.mp3' }]); });
    await Promise.all([manager.ensureLoaded(), manager.ensureLoaded()]);
    assert.equal(count, 1);
    manager.currentPage = 4;
    await manager.ensureLoaded();
    assert.equal(manager.currentPage, 4);
    assert.equal(count, 1);
});

test('old-account response cannot overwrite current account data', async () => {
    const resolvers = [];
    const { manager, window } = setup(() => new Promise(resolve => resolvers.push(resolve)));
    const first = manager.ensureLoaded();
    await Promise.resolve();
    window.currentListData.username = 'bob';
    const second = manager.ensureLoaded();
    await Promise.resolve();
    resolvers[1](response([{ filename: 'bob.mp3' }]));
    await second;
    resolvers[0](response([{ filename: 'alice.mp3' }]));
    await first;
    assert.equal(manager.originalData[0].filename, 'bob.mp3');
});

test('failed load can retry and inactive responses do not repaint local music', async () => {
    let count = 0;
    const { manager } = setup(async () => {
        if (++count === 1) throw new Error('offline');
        return response([]);
    });
    manager.isActive = false;
    manager.applyFilters = () => assert.fail('inactive custom view repainted');
    await manager.ensureLoaded();
    assert.equal(manager.loadedContext, null);
    await manager.ensureLoaded();
    assert.equal(count, 2);
    assert.equal(manager.loadedContext, manager.getDataContext());
});

test('backend shares a scan per user/root and permits retry after failure', async () => {
    const source = fs.readFileSync('src/server/music/customMusicManager.ts', 'utf8');
    const wrapper = source.slice(source.indexOf('const pendingCustomScans'), source.indexOf('const scanCustomIndex ='));
    let count = 0;
    let finish;
    const context = vm.createContext({
        getCustomMusicDir: user => '/' + user,
        scanCustomIndex: () => { count++; return new Promise((resolve, reject) => { finish = { resolve, reject }; }); },
    });
    vm.runInContext(stripTypeScriptTypes(wrapper.replace('export const', 'const')) + '\nglobalThis.sync = syncCustomIndex;', context);
    const first = context.sync('alice');
    const second = context.sync('alice');
    assert.equal(first, second);
    await Promise.resolve();
    assert.equal(count, 1);
    finish.reject(new Error('unavailable'));
    await assert.rejects(first, /unavailable/);
    const retry = context.sync('alice');
    await Promise.resolve();
    finish.resolve([]);
    await retry;
    assert.equal(count, 2);
});

test('partial reload merges changed/deleted entries and keeps unrelated selections and page', async () => {
    const { manager } = setup(async (url, options) => {
        assert.equal(url, '/api/music/custom/list');
        assert.equal(options.method, 'POST');
        assert.deepEqual(JSON.parse(options.body).filenames, ['removed.mp3', 'changed.mp3']);
        return response([{ filename: 'changed.mp3', name: 'updated' }]);
    });
    manager.originalData = [{ filename: 'removed.mp3' }, { filename: 'changed.mp3' }, { filename: 'keep.mp3' }];
    manager.selectedItems = new Set(['removed.mp3', 'keep.mp3']);
    manager.currentPage = 3;
    manager.applyFilters = reset => assert.equal(reset, false);
    await manager.reloadItems(['removed.mp3', 'changed.mp3']);
    assert.equal(manager.currentPage, 3);
    assert.equal(manager.originalData.find(item => item.filename === 'changed.mp3').name, 'updated');
    assert.equal(manager.originalData.some(item => item.filename === 'removed.mp3'), false);
    assert.deepEqual([...manager.selectedItems], ['keep.mp3']);
});

test('partial reload response is ignored after an account change', async () => {
    let resolve;
    const { manager, window } = setup(() => new Promise(done => { resolve = done; }));
    manager.originalData = [{ filename: 'keep.mp3' }];
    const pending = manager.reloadItems(['keep.mp3']);
    window.currentListData.username = 'bob';
    resolve(response([]));
    await pending;
    assert.equal(manager.originalData.length, 1);
});

test('unchanged version does not reload; changed version reloads once and preserves page', async () => {
    let version = 'v1';
    let lists = 0;
    let checks = 0;
    const { manager } = setup(async url => {
        const versionOnly = url.includes('versionOnly');
        if (versionOnly) checks++; else lists++;
        return { ok: true, json: async () => ({ success: true, version,
            data: versionOnly ? undefined : [{ filename: 'a.mp3' }] }) };
    });
    await manager.ensureLoaded();
    manager.currentPage = 3;
    await Promise.all([manager.ensureLoaded(), manager.ensureLoaded()]);
    assert.equal(checks, 1);
    assert.equal(lists, 1);
    version = 'v2';
    manager.applyFilters = reset => { if (reset) manager.currentPage = 1; };
    await Promise.all([manager.ensureLoaded(), manager.ensureLoaded()]);
    assert.equal(checks, 2);
    assert.equal(lists, 2);
    assert.equal(manager.currentPage, 3);
    assert.equal(manager.loadedVersion, 'v2');
});
