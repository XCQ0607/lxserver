const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadSync(overrides = {}) {
    const sockets = [];
    class FakeWebSocket {
        static OPEN = 1;
        constructor(url) {
            this.url = url;
            this.readyState = FakeWebSocket.OPEN;
            this.closed = false;
            this.sent = [];
            sockets.push(this);
        }
        send(data) { this.sent.push(data); }
        close() { this.closed = true; }
    }
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        URL,
        CryptoJS: {
            enc: { Base64: { parse: s => s }, Utf8: { parse: s => s } },
            mode: { ECB: 'ECB' },
            pad: { Pkcs7: 'Pkcs7' },
            AES: { encrypt: v => ({ toString: () => String(v) }), decrypt: v => ({ toString: () => String(v) }) },
        },
        pako: { gzip: v => v, ungzip: v => v },
        WebSocket: FakeWebSocket,
        setInterval,
        clearInterval,
        getUserAuthHeaders: () => ({}),
        fetch: overrides.fetch || (async () => ({ ok: true, json: async () => ({}) })),
        localStorage: { getItem: () => null, setItem() {} },
        window: {},
    });
    context.window = context;
    const code = fs.readFileSync('public/music/js/sync/user_sync.js', 'utf8');
    vm.runInContext(code + '\nwindow.__SyncTest = { LocalClient, RemoteClient, SyncManager };', context);
    return { ...context.__SyncTest, sockets };
}

test('onListSyncAction serializes concurrent read-modify-write operations', async () => {
    const { RemoteClient } = loadSync();
    const client = new RemoteClient('http://sync.example', '1234');
    client.ws = { readyState: 1, send() {} };

    let db = { defaultList: [], loveList: [], userList: [] };
    client.listHandlers = {
        getData: async () => {
            await new Promise(r => setTimeout(r, 10));
            return JSON.parse(JSON.stringify(db));
        },
        setData: async next => {
            await new Promise(r => setTimeout(r, 10));
            db = JSON.parse(JSON.stringify(next));
        },
    };

    await Promise.all([
        client.handleRPC({ name: 'onListSyncAction', data: [{ action: 'list_music_add', data: { id: 'default', musicInfos: [{ id: 's1', name: 'A' }], addMusicLocationType: 'bottom' } }] }),
        client.handleRPC({ name: 'onListSyncAction', data: [{ action: 'list_music_add', data: { id: 'default', musicInfos: [{ id: 's2', name: 'B' }], addMusicLocationType: 'bottom' } }] }),
    ]);

    assert.deepEqual(db.defaultList.map(s => s.id), ['s1', 's2']);
});

test('connect closes previous ws and handleClose clears heartbeatTimer and 4100 authInfo', async () => {
    const { RemoteClient, sockets } = loadSync();
    const client = new RemoteClient('http://sync.example', '1234');
    client.authInfo = { clientId: 'c1', key: 'k1' };

    await client.connect();
    assert.equal(sockets.length, 1);
    const firstWs = sockets[0];
    firstWs.onopen();
    assert.ok(client.heartbeatTimer);

    await client.connect();
    assert.equal(sockets.length, 2);
    assert.equal(firstWs.closed, true);
    assert.equal(firstWs.onclose, null);

    client.handleClose({ code: 4100 });
    assert.equal(client.isConnected, false);
    assert.equal(client.heartbeatTimer, null);
    assert.equal(client.authInfo, null);
});

test('LocalClient getList and updateList throw on non-OK HTTP responses', async () => {
    const { LocalClient } = loadSync({
        fetch: async () => ({ ok: false, status: 503, json: async () => ({ error: 'down' }) }),
    });
    const local = new LocalClient('alice', 'pass');
    await assert.rejects(local.getList(), /HTTP 503/);
    await assert.rejects(local.updateList({ defaultList: [] }), /HTTP 503/);
});
