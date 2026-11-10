const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/app.js', 'utf8');

function harness() {
    const nodes = new Map();
    function node() {
        const classes = new Set();
        return { classList: { add: v => classes.add(v), remove: v => classes.delete(v), contains: v => classes.has(v) }, style: { removeProperty() {} }, querySelector: () => ({}), classes };
    }
    for (const id of ['app','login-overlay','admin-login-card','login-btn','login-btn-text']) nodes.set(id,node());
    nodes.get('login-overlay').classList.add('hidden');
    const pending = [], cleared = [], storage = new Map([['lx_auth','expired']]);
    const context = vm.createContext({ API_BASE: '', document: { getElementById: id => nodes.get(id) }, localStorage: { removeItem: key => storage.delete(key) }, clearInterval: id => cleared.push(id), fetch: () => new Promise(resolve => pending.push(resolve)), location: { reload() { throw Error('Unexpected page reload'); } } });
    const logout = source.slice(source.indexOf('    logout() {'), source.indexOf('    showApp() {'));
    const request = source.slice(source.indexOf('    async request('), source.indexOf('    formatUptime('));
    vm.runInContext(`class Harness { ${logout} ${request} }; globalThis.app = new Harness()`,context);
    const app = context.app;
    app.password = 'expired';
    app.monitorTimer = 11;
    app.logsRefreshTimer = 12;
    app.initLoginScreenEffects = () => { app._loginEffectsInited = true; };
    let logouts = 0;
    const logoutImpl = app.logout.bind(app);
    app.logout = () => { logouts++; logoutImpl(); };
    return { app, pending, nodes, cleared, storage, logouts: () => logouts };
}

test('concurrent unauthorized requests return to login once without refreshing and stop polling', async () => {
    const h = harness();
    const requests = [h.app.request('/api/status'),h.app.request('/api/config')];
    const settled = Promise.allSettled(requests);
    h.pending.forEach(resolve => resolve({status:401}));
    const results = await settled;
    assert.ok(results.every(r => r.status === 'rejected'));
    assert.equal(h.logouts(),1);
    assert.equal(h.app.password,null);
    assert.equal(h.storage.has('lx_auth'),false);
    assert.ok(h.nodes.get('app').classes.has('hidden'));
    assert.ok(!h.nodes.get('login-overlay').classes.has('hidden'));
    assert.equal(h.nodes.get('login-btn').disabled,false);
    assert.ok(h.cleared.includes(11) && h.cleared.includes(12));
    await assert.rejects(h.app.request('/api/status'),/Unauthorized/);
    assert.equal(h.pending.length,2);
});

test('wrong login password reports failure without logging out or refreshing', async () => {
    const h = harness();
    h.app.password = null;
    const request = h.app.request('/api/login',{method:'POST'});
    h.pending[0]({status:401});
    assert.equal((await request).success,false);
    assert.equal(h.logouts(),0);
});

test('late unauthorized response from an older session cannot sign out the new session', async () => {
    const h = harness();
    const request = h.app.request('/api/status');
    h.app.password = 'new-session';
    h.pending[0]({status:401});
    await assert.rejects(request,/Unauthorized/);
    assert.equal(h.logouts(),0);
    assert.equal(h.app.password,'new-session');
});
