const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(confirm) {
    const source = fs.readFileSync('public/app.js', 'utf8');
    const start = source.indexOf('    async executeWebdavRestore(options) {');
    const method = source.slice(start, source.indexOf('\n    async loadWebdavRestoreTasks()', start));
    const status = {}, calls = [], errors = [];
    const app = vm.runInNewContext(`({${method}})`, {
        document: { getElementById: id => id === 'sync-status-content' ? status : id === 'webdav-restore-strategy' ? { value: 'missing' } : { checked: true } },
        showSelect: confirm, showSuccess() {}, showError: message => errors.push(message),
    });
    app.closeRestoreModal = () => {};
    app.request = async (_, options) => {
        const payload = JSON.parse(options.body); calls.push(payload);
        return payload.preview ? { success: true, token: 'confirmed-plan', added: 1, overwritten: 0, merged: 0, skipped: 1, warnings: [], files: [{ path: 'users/alice/data.json', action: 'add' }] } : { success: true };
    };
    return { app, calls, status, errors };
}

test('WebDAV restore previews missing-only scope and executes only the confirmed token', async () => {
    const { app, calls, status } = fixture(async (_, message) => { assert.match(message, /新增 1/); assert.match(message, /users\/alice\/data.json/); return true; });
    await app.executeWebdavRestore({ mode: 'files' });
    assert.equal(calls[0].preview, true); assert.equal(calls[0].strategy, 'missing'); assert.equal(calls[0].keepCopies, true);
    assert.deepEqual(calls[1], { token: 'confirmed-plan' });
    assert.match(status.textContent, /重启/); assert.equal(app._webdavRestoreBusy, false);
});

test('cancelled WebDAV preview never starts a restore and suppresses duplicate clicks', async () => {
    let finish;
    const { app, calls } = fixture(() => new Promise(resolve => { finish = resolve; }));
    const pending = app.executeWebdavRestore({ mode: 'zip' });
    await new Promise(resolve => setImmediate(resolve));
    await app.executeWebdavRestore({ mode: 'zip' });
    assert.equal(calls.length, 1);
    finish(false); await pending;
    assert.equal(calls.length, 2); assert.deepEqual(calls[1], { cancel: true, token: 'confirmed-plan' }); assert.equal(app._webdavRestoreBusy, false);
});
