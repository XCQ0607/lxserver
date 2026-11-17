const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('public/index.html', 'utf8');
const appSource = fs.readFileSync('public/app.js', 'utf8');
const serverSource = fs.readFileSync('src/server/server.ts', 'utf8');

// Track actual div ancestry, not just the presence of tab IDs. A missing closing
// tag can hide an active tab inside a different, inactive tab.
function divTree() {
    const stack = [], nodes = new Map();
    const markup = html.replace(/<!--[\s\S]*?-->/g, '');
    const tags = /<(\/?div)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
    for (const match of markup.matchAll(tags)) {
        if (match[1].startsWith('/')) { stack.pop(); continue; }
        const id = match[0].match(/\bid="([^"]+)"/)?.[1];
        const node = { id, parent: stack.at(-1), classList: new Set((match[0].match(/\bclass="([^"]+)"/)?.[1] || '').split(/\s+/)) };
        stack.push(node);
        if (id) nodes.set(id, node);
    }
    return nodes;
}

test('every backup tab is a sibling and activating it has no hidden tab ancestor', () => {
    const nodes = divTree();
    const tabs = ['overview', 'local', 'cloud', 'restore', 'records'];
    const parent = nodes.get('bm-pane-overview').parent;
    const method = extractMethod("switchBackupCenterTab(tab = 'overview', sub = '') {", 'scrollBackupCenter(elementId)');
    const app = vm.runInNewContext(`({${method}})`, {
        document: { getElementById: id => {
            const node = nodes.get(id);
            return node && { classList: { toggle(name, on) { on ? node.classList.add(name) : node.classList.delete(name); } } };
        } },
        setTimeout() {},
    });
    Object.assign(app, { loadBackupOverview() {}, switchBackupTab() {}, selectRestoreSource() {}, selectRecordsSource() {}, syncCustomSelects() {} });
    for (const tab of tabs) {
        const pane = nodes.get(`bm-pane-${tab}`);
        assert.equal(pane.parent, parent, `${tab} is nested in another tab/card`);
        app.switchBackupCenterTab(tab);
        for (let ancestor = pane; ancestor; ancestor = ancestor.parent) {
            if (ancestor.classList.has('bm-pane')) assert.ok(ancestor.classList.has('active'), `${tab} has an inactive tab ancestor`);
        }
    }
    assert.equal(nodes.get('view-about').parent, nodes.get('view-backups').parent);
});

test('snapshot kind selector is inserted in the toolbar, not between table header and rows', () => {
    const method = extractMethod('ensureSnapshotKindTabs() {', 'triggerUploadSnapshot()');
    let inserted;
    const toolbar = { firstChild: {}, insertBefore(node) { inserted = node; } };
    const app = vm.runInNewContext(`({${method}})`, {
        document: {
            getElementById: id => id === 'snapshot-toolbar-actions' ? toolbar : id === 'snapshots-list' ? {} : null,
            createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {} }),
        },
    });
    let enhanced = 0;
    app.initCustomSelects = () => { enhanced++; };
    app.ensureSnapshotKindTabs();
    assert.equal(enhanced, 1);
    assert.equal(inserted.id, 'snapshot-kind-filter');
    const nodes = divTree();
    assert.equal(nodes.get('snapshot-toolbar-actions').parent.parent.id, 'backup-pane-snapshot');
});

function extractMethod(name, nextMarker) {
    const start = appSource.indexOf(`    ${name}`);
    assert.ok(start >= 0, `Method ${name} not found`);
    const end = nextMarker ? appSource.indexOf(`\n    ${nextMarker}`, start + 4) : -1;
    assert.ok(end > start, `End marker ${nextMarker} for ${name} not found`);
    return appSource.slice(start, end);
}

test('Sidebar and HTML structure unify Backup Management into 5 tabs with unique field names', () => {
    // Sidebar only keeps backups entry, removes standalone webdav / openlist entries
    assert.match(html, /class="nav-item"[^>]*data-view="backups"/);
    assert.doesNotMatch(html, /class="nav-item"[^>]*data-view="webdav"/);
    assert.doesNotMatch(html, /class="nav-item"[^>]*data-view="openlist"/);
    assert.ok(!html.includes('id="view-webdav"'));
    assert.ok(!html.includes('id="view-openlist"'));

    // 5 tabs exist in view-backups
    for (const tab of ['overview', 'local', 'cloud', 'restore', 'records']) {
        assert.ok(html.includes(`id="bm-tab-btn-${tab}"`), `Missing tab button ${tab}`);
        assert.ok(html.includes(`id="bm-pane-${tab}"`), `Missing tab pane ${tab}`);
    }

    // Every single-value migrated field name appears exactly once in index.html
    const singleFields = [
        'maxSnapshotNum',
        'configBackup.enable',
        'configBackup.retentionDays',
        'configBackup.dir',
        'configBackup.intervalHours',
        'configBackup.scheduleTime',
        'snapshot.backupPath',
        'webdav.enable',
        'webdav.url',
        'webdav.username',
        'webdav.password',
        'webdav.syncPath',
        'webdav.backupPath',
        'sync.interval',
        'sync.backupInterval',
        'webdav.retentionCount',
        'webdav.retentionDays',
        'backup.webdav.mirrorDeletes',
        'backup.webdav.restoreOnStartup',
        'openlist.enable',
        'openlist.endpoint',
        'openlist.token',
        'openlist.externalUrl',
        'openlist.root',
        'openlist.syncInterval',
        'openlist.verifyInterval',
        'openlist.historyRetentionDays',
        'openlist.playback.enable',
        'openlist.includeNonAudio',
        'openlist.userBackupUsers',
    ];
    for (const name of singleFields) {
        const escaped = name.replace(/\./g, '\\.');
        const matches = html.match(new RegExp(`name="${escaped}"`, 'g')) || [];
        assert.equal(matches.length, 1, `Expected field name="${name}" to appear once, found ${matches.length}`);
    }

    // None of the migrated fields remain inside #config-form
    const configFormHtml = html.slice(html.indexOf('<form id="config-form"'), html.indexOf('</form>', html.indexOf('<form id="config-form"')));
    for (const name of singleFields) {
        assert.ok(!configFormHtml.includes(`name="${name}"`), `Field ${name} should not remain inside #config-form`);
    }
});

test('saveConfig only submits system config fields and never resets migrated backup settings', async () => {
    const method = extractMethod('async saveConfig(silent = false) {', 'async loadSubsonicConfig()');
    const posted = [];
    const formValues = new Map([
        ['admin.path', '/admin'],
        ['player.path', '/'],
        ['serverName', 'LX Server'],
        ['debug.enabled', 'on'],
        ['list.addMusicLocationType', 'top'],
        ['user.enablePath', 'on'],
        ['user.cacheSizeLimit', '2000'],
        ['cache.maxAgeDays', '14'],
        ['admin.password', '123456'],
        ['player.name', 'LX Music Web'],
    ]);
    const app = vm.runInNewContext(`({${method}})`, {
        document: { getElementById: () => ({ style: {} }) },
        FormData: class {
            get(k) { return formValues.has(k) ? formValues.get(k) : null; }
        },
        localStorage: { setItem() {} },
        showSuccess() {},
        showInfo() {},
        showError(msg) { throw new Error(msg); },
    });
    app.configLoaded = true;
    app.loadedConfig = {};
    app.password = '123456';
    app.updatePlayerLinks = () => {};
    app.request = async (_url, opts) => {
        posted.push(JSON.parse(opts.body));
        return { success: true };
    };

    await app.saveConfig(true);
    assert.equal(posted.length, 1);
    const payload = posted[0];
    assert.equal(payload.serverName, 'LX Server');
    assert.equal(payload['cache.maxAgeDays'], 14);
    for (const forbidden of [
        'maxSnapshotNum',
        'configBackup.enable',
        'configBackup.retentionDays',
        'configBackup.dir',
        'configBackup.intervalHours',
        'configBackup.scheduleTime',
        'snapshot.backupPath',
        'webdav.enable',
        'webdav.url',
        'webdav.retentionCount',
        'webdav.retentionDays',
        'sync.interval',
        'sync.backupInterval',
        'backup.webdav.types',
        'backup.openlist.types',
        'backup.webdav.mirrorDeletes',
        'backup.webdav.restoreOnStartup',
        'openlist.enable',
        'openlist.playback.enable',
    ]) {
        assert.equal(
            Object.prototype.hasOwnProperty.call(payload, forbidden),
            false,
            `saveConfig must not submit migrated field ${forbidden}`,
        );
    }
});

test('Local, Policy, WebDAV, OpenList Connection, and OpenList Playcache save independently without overwriting each other', async () => {
    const methods = [
        extractMethod('collectBackupPolicy() {', 'async restoreOpenlistBackup()'),
        extractMethod('async saveLocalBackupSettings() {', 'async loadBackupOverview()'),
    ].join('\n');

    const forms = {
        'backup-policy-form': {
            all: {
                'backup.webdav.types': ['music', 'system'],
                'backup.openlist.types': ['snapshots', 'userData'],
            },
        },
        'local-backup-form': {
            maxSnapshotNum: '15',
            'configBackup.enable': 'on',
            'configBackup.retentionDays': '14',
            'configBackup.dir': 'custom_backups',
            'configBackup.intervalHours': '12',
            'configBackup.scheduleTime': '03:30',
            'snapshot.backupPath': 'custom_snaps',
        },
        'webdav-form': {
            'webdav.enable': 'on',
            'webdav.url': 'https://dav.example.com/dav',
            'webdav.username': 'alice',
            'webdav.password': 'secret',
            'webdav.syncPath': '/sync-custom',
            'webdav.backupPath': '/zip-custom',
            'sync.interval': '30',
            'sync.backupInterval': '12',
            'webdav.retentionCount': '8',
            'webdav.retentionDays': '30',
            'backup.webdav.mirrorDeletes': 'on',
            'backup.webdav.restoreOnStartup': null,
        },
        'openlist-form': {
            'openlist.enable': 'on',
            'openlist.endpoint': 'http://127.0.0.1:5244',
            'openlist.token': 'ol-token',
            'openlist.externalUrl': 'https://ol.example.com',
            'openlist.root': '/lx_cloud',
            'openlist.syncInterval': '45',
            'openlist.verifyInterval': '10',
            'openlist.historyRetentionDays': '14',
        },
        'openlist-cache-form': {
            'openlist.playback.enable': 'on',
            'openlist.includeNonAudio': 'on',
        },
    };

    const calls = [];
    const app = vm.runInNewContext(`(new (class {\n${methods}\n})())`, {
        document: {
            getElementById: id => forms[id] ? { id, _data: forms[id] } : { classList: { remove() {}, add() {} }, textContent: '' },
        },
        FormData: class {
            constructor(form) { this.d = form._data || {}; }
            get(k) { return this.d[k] ?? null; }
            getAll(k) { return (this.d.all && this.d.all[k]) || []; }
        },
        window: { showSuccess() {}, showError() {}, showInfo() {} },
        showSuccess() {},
        showInfo() {},
        showError(msg) { throw new Error(msg); },
    });
    app._backupTypesLoaded = true;
    app._olbUsersLoaded = true;
    app.loadedConfig = {};
    app.markBackupDirty = () => {};
    app.toggleWebdavVisibility = () => {};
    app.toggleOpenlistVisibility = () => {};
    app.loadConfigBackups = () => {};
    app.initOpenlistRestore = () => {};
    app.collectOpenlistUserBackups = () => JSON.stringify([{ user: 'u1', enabled: true, backupCache: true, mode: 'upload' }]);
    app.request = async (_url, opts) => {
        calls.push(JSON.parse(opts.body));
        return { success: true };
    };

    await app.saveBackupPolicy();
    await app.saveLocalBackupSettings();
    await app.saveWebdavSettings();
    await app.saveOpenlistConnection();
    await app.saveOpenlistPlaycache();

    assert.deepEqual(calls[0], {
        'backup.webdav.types': ['music', 'system'],
        'backup.openlist.types': ['snapshots', 'userData'],
    });
    assert.deepEqual(calls[1], {
        maxSnapshotNum: 15,
        'configBackup.enable': true,
        'configBackup.retentionDays': 14,
        'configBackup.dir': 'custom_backups',
        'configBackup.intervalHours': 12,
        'configBackup.scheduleTime': '03:30',
        'snapshot.backupPath': 'custom_snaps',
    });
    assert.equal(calls[2]['webdav.enable'], true);
    assert.equal(calls[2]['webdav.retentionCount'], 8);
    assert.equal(calls[2]['webdav.retentionDays'], 30);
    assert.equal(calls[2]['backup.webdav.mirrorDeletes'], true);
    assert.equal(calls[2]['backup.webdav.restoreOnStartup'], false);
    assert.equal(calls[2]['openlist.enable'], undefined);

    assert.equal(calls[3]['openlist.enable'], true);
    assert.equal(calls[3]['openlist.historyRetentionDays'], 14);
    assert.equal(calls[3]['openlist.playback.enable'], undefined);
    assert.equal(calls[3]['openlist.userBackups'], undefined);
    assert.equal(calls[3]['webdav.enable'], undefined);

    assert.equal(calls[4]['openlist.playback.enable'], true);
    assert.equal(calls[4]['openlist.includeNonAudio'], true);
    assert.match(calls[4]['openlist.userBackups'], /"user":"u1"/);
    assert.equal(calls[4]['openlist.endpoint'], undefined);

    // Server GET & POST /api/config support webdav.retentionCount & webdav.retentionDays
    assert.match(serverSource, /'webdav\.retentionCount':\s*global\.lx\.config\['webdav\.retentionCount'\]/);
    assert.match(serverSource, /'webdav\.retentionDays':\s*global\.lx\.config\['webdav\.retentionDays'\]/);
    assert.match(serverSource, /if \(newConfig\['webdav\.retentionCount'\] !== undefined\)/);
    assert.match(serverSource, /if \(newConfig\['webdav\.retentionDays'\] !== undefined\)/);
});

test('Legacy view navigation, OpenList tab redirection, and dirty form protection work as expected', async () => {
    const methods = [
        extractMethod('switchOpenlistTab(name) {', 'scheduleOpenlistReload()'),
        extractMethod('jumpToWebDAVConfig() {', 'async openBackupCenter('),
    ].join('\n');

    const redirected = [];
    const app = vm.runInNewContext(`(new (class {\n${methods}\n})())`, {
        document: {
            getElementById: () => ({ classList: { toggle() {}, remove() {}, add() {} }, value: '', style: {} }),
            querySelectorAll: () => [],
        },
        setTimeout: fn => fn(),
    });
    app.openBackupCenter = async (tab, sub) => { redirected.push([tab, sub]); };

    app.jumpToWebDAVConfig();
    app.switchOpenlistTab('config');
    app.switchOpenlistTab('restore');
    app.switchOpenlistTab('integrity');
    app.switchOpenlistTab('snapshot');

    assert.deepEqual(redirected, [
        ['cloud', 'webdav'],
        ['cloud', 'openlist'],
        ['restore', 'openlist'],
        ['records', 'openlist-integrity'],
        ['records', 'openlist-records:snapshot'],
    ]);
});


test('WebDAV operations stay hidden until enabled settings are saved', () => {
    const method = extractMethod('toggleWebdavVisibility() {', 'toggleSubsonicCustomPlaylistVisibility()');
    const checkbox = { checked: false };
    const nodes = Object.fromEntries(['webdav-options', 'webdav-disabled-hint', 'webdav-operation-panel'].map(id => [id, { style: {} }]));
    const app = vm.runInNewContext(`({${method}})`, {
        document: { querySelector: () => checkbox, getElementById: id => nodes[id] },
    });
    app.loadedConfig = { 'webdav.enable': false };
    app.toggleWebdavVisibility();
    assert.equal(nodes['webdav-operation-panel'].style.display, 'none');
    checkbox.checked = true;
    app.toggleWebdavVisibility();
    assert.equal(nodes['webdav-options'].style.display, 'block');
    assert.equal(nodes['webdav-operation-panel'].style.display, 'none');
    app.loadedConfig['webdav.enable'] = true;
    app.toggleWebdavVisibility();
    assert.equal(nodes['webdav-operation-panel'].style.display, '');
    checkbox.checked = false;
    app.toggleWebdavVisibility();
    assert.equal(nodes['webdav-operation-panel'].style.display, 'none');
});


test('OpenList playback cache lives in cloud backups and legacy shortcuts still reach it', () => {
    const nodes = divTree();
    assert.ok(!html.includes('id="bm-tab-btn-playcache"'));
    assert.ok(!nodes.has('bm-pane-playcache'));
    const cloudStart = html.indexOf('id="bm-pane-cloud"');
    const cacheStart = html.indexOf('id="openlist-cache-form"');
    const restoreStart = html.indexOf('id="bm-pane-restore"');
    assert.ok(cloudStart < cacheStart && cacheStart < restoreStart);
    const method = extractMethod("switchBackupCenterTab(tab = 'overview', sub = '') {", 'scrollBackupCenter(elementId)');
    const app = vm.runInNewContext(`({${method}})`, { document: { getElementById: () => null }, setTimeout() {} });
    let destination;
    app.scrollBackupCenter = id => { destination = id; };
    app.switchBackupCenterTab('playcache');
    assert.equal(app.currentBackupCenterTab, 'cloud');
    assert.equal(destination, 'openlist-cache-form');
});


test('OpenList hides operations and the entire cache card when disabled without clearing settings', () => {
    const method = extractMethod('toggleOpenlistVisibility() {', 'renderOpenlistUserConfig(users, userBackupsRaw)');
    const checkbox = { checked: false };
    const form = { elements: { 'openlist.enable': checkbox } };
    const ids = ['openlist-options', 'openlist-disabled-hint', 'openlist-cache-disabled-hint', 'openlist-operation-panel', 'openlist-cache-form', 'openlist-cache-shortcut'];
    const nodes = Object.fromEntries(ids.map(id => [id, { style: {} }]));
    const app = vm.runInNewContext(`({${method}})`, { document: { getElementById: id => id === 'openlist-form' ? form : nodes[id] } });
    app.loadedConfig = { 'openlist.enable': true, 'openlist.userBackups': '[{"user":"admin"}]' };
    app.toggleOpenlistVisibility();
    assert.match(nodes['openlist-disabled-hint'].textContent, /尚未保存/);
    for (const id of ids.slice(3)) assert.equal(nodes[id].style.display, 'none');
    app.loadedConfig['openlist.enable'] = false;
    app.toggleOpenlistVisibility();
    assert.match(nodes['openlist-disabled-hint'].textContent, /已关闭/);
    checkbox.checked = true;
    app.toggleOpenlistVisibility();
    assert.equal(nodes['openlist-options'].style.display, 'block');
    for (const id of ids.slice(3)) assert.equal(nodes[id].style.display, 'none');
    app.loadedConfig['openlist.enable'] = true;
    app.toggleOpenlistVisibility();
    for (const id of ids.slice(3)) assert.equal(nodes[id].style.display, '');
    assert.equal(app.loadedConfig['openlist.userBackups'], '[{"user":"admin"}]');
});


test('OpenList usage guide opens without enabling service and Escape closes it with focus restored', () => {
    const methods = extractMethod('openOpenlistUsageModal() {', 'openWebdavUsageModal()');
    const classes = new Set(['hidden']);
    let closeFocus = 0, originFocus = 0;
    const origin = { focus() { originFocus++; } };
    const modal = { classList: { add: name => classes.add(name), remove: name => classes.delete(name) } };
    const listeners = new Map();
    const app = vm.runInNewContext(`new (class {${methods}})()`, {
        document: {
            activeElement: origin,
            getElementById: id => id === 'openlist-usage-modal' ? modal : { focus() { closeFocus++; } },
            addEventListener: (type, callback) => listeners.set(type, callback),
            removeEventListener: type => listeners.delete(type),
        },
    });
    app.openOpenlistUsageModal();
    assert.equal(classes.has('hidden'), false);
    assert.equal(closeFocus, 1);
    listeners.get('keydown')({ key: 'Escape' });
    assert.equal(classes.has('hidden'), true);
    assert.equal(originFocus, 1);
    assert.equal(listeners.size, 0);
    const start = html.indexOf('<form id="openlist-form"');
    const actions = html.indexOf('id="openlist-operation-panel"', start);
    assert.ok(html.slice(start, actions).includes('app.openOpenlistUsageModal()'));
});


function overviewFixture(enabled) {
    const cards = new Map();
    for (const key of ['local', 'webdav', 'openlist']) {
        const roles = Object.fromEntries(['badge', 'last', 'next', 'scope', 'error'].map(role => [role, {}]));
        const list = { hidden: false, querySelectorAll: () => [], appendChild() {} };
        const buttons = [{}, {}, {}];
        cards.set('bm-ov-' + key, { roles, list, buttons,
            querySelector(selector) { return selector === '.bm-ov-list' ? list : roles[selector.match(/data-role="(.*?)"/)?.[1]]; },
            querySelectorAll: () => buttons,
        });
    }
    const app = vm.runInNewContext(`({${extractMethod('async loadBackupOverview() {', 'openOpenlistUsageModal()')}})`, {
        document: { getElementById: id => cards.get(id), createElement: () => ({ dataset: {}, append() {} }) },
    });
    app.loadedConfig = { 'configBackup.enable': false, 'webdav.enable': enabled, 'openlist.enable': enabled, 'webdav.url': 'http://fixture', 'openlist.endpoint': 'http://fixture', 'backup.webdav.types': ['music'], 'backup.openlist.types': ['music'] };
    const calls = [];
    app.formatTime = value => String(value); app.getLogTypeText = () => '文件上传';
    app.request = async route => {
        calls.push(route);
        if (route === '/api/config/backups') return { autoBackupEnabled: false, list: [] };
        if (route === '/api/backup/status') return { success: true, webdav: { nextSyncAt: 1800000000000, nextZipAt: 1800003600000 }, openlist: { nextSyncAt: 1800000000000, nextCheckAt: 1800000300000, counts: { pending: 0, uploading: 0, completed: 1, failed: 0 } } };
        if (route === '/api/webdav/logs') return { logs: [] };
        return { list: [{ status: 'verified', updated_at: 1700000000000 }] };
    };
    return { app, cards, calls };
}

test('disabled overview services hide details and execution buttons without querying cloud records', async () => {
    const { app, cards, calls } = overviewFixture(false);
    await app.loadBackupOverview();
    for (const card of cards.values()) {
        assert.equal(card.list.hidden, true);
        assert.equal(card.buttons[0].hidden, true);
        assert.equal(card.buttons[2].hidden, true);
        assert.notEqual(card.buttons[1].hidden, true);
    }
    assert.deepEqual(calls, ['/api/config/backups']);
});

test('enabled overview uses scheduler timestamps and counts legacy verified records as uploaded', async () => {
    const { app, cards } = overviewFixture(true);
    await app.loadBackupOverview();
    for (const key of ['webdav', 'openlist']) {
        const card = cards.get('bm-ov-' + key);
        assert.equal(card.list.hidden, false);
        assert.match(card.roles.next.textContent, /调度检查/);
        assert.doesNotMatch(card.roles.next.textContent, /暂无记录/);
    }
    assert.match(cards.get('bm-ov-openlist').roles.last.textContent, /上传完成 1 项/);
});

test('record state filters combine local, cloud and historical integrity without treating stale matches as valid', () => {
    const values = {};
    const method = extractMethod('filterOpenlistRecords(records, ignoreStatus = false) {', 'sortOpenlistColumn(field)');
    const app = vm.runInNewContext(`({${method}})`, { document: { getElementById: id => ({ value: values[id] || '' }) } });
    const records = [
        { id: 1, local_state: 'changed', remote_state: 'same', content_verification: 'matched' },
        { id: 2, local_state: 'same', remote_state: 'changed', content_verification: 'matched', verification_stale: true },
        { id: 3, local_state: 'same', remote_state: 'unchecked' },
    ];
    values['olb-filter-local-state'] = 'changed';
    assert.equal(app.filterOpenlistRecords(records)[0].id, 1);
    values['olb-filter-integrity'] = 'stale';
    assert.equal(app.filterOpenlistRecords(records).length, 0);
    values['olb-filter-local-state'] = '';
    assert.equal(app.filterOpenlistRecords(records)[0].id, 2);
    values['olb-filter-integrity'] = 'matched';
    assert.equal(app.filterOpenlistRecords(records)[0].id, 1);
    values['olb-filter-integrity'] = '';
    values['olb-filter-remote-state'] = 'unchecked';
    assert.equal(app.filterOpenlistRecords(records)[0].id, 3);
});

test('record column sorting toggles direction and single delete cancellation never submits or changes selection', async () => {
    const select = { value: 'name-asc' };
    const sortMethod = extractMethod('sortOpenlistColumn(field) {', 'renderOpenlistFilterFeedback(count)');
    const deletion = extractMethod('async deleteSelectedOpenlist(singleId) {', 'invalidateOpenlistIntegrity()');
    const app = vm.runInNewContext(`new (class {${sortMethod}${deletion}})()`, {
        document: { getElementById: () => select }, showSelect: async () => false,
    });
    let applied = 0, requests = 0;
    app.syncCustomSelects = () => {}; app.applyOpenlistFilter = () => applied++;
    app.sortOpenlistColumn('name'); assert.equal(select.value, 'name-desc');
    app.sortOpenlistColumn('name'); assert.equal(select.value, 'name-asc');
    app.sortOpenlistColumn('size'); assert.equal(select.value, 'size-asc');
    assert.equal(applied, 3);
    app._olbSelected = new Set([8]); app.request = async () => { requests++; };
    await app.deleteSelectedOpenlist(2);
    assert.equal(requests, 0); assert.deepEqual([...app._olbSelected], [8]);
});

test('record checks show distinct local/cloud icons and severity without hiding observations during pending uploads', () => {
    const method = extractMethod('openlistStateTags(file) {', 'async loadOpenlistBackups');
    const app = vm.runInNewContext(`({${method}})`);
    const tags = app.openlistStateTags({ local_state: 'changed', remote_state: 'missing', status: 'pending', content_verification: 'matched' });
    assert.match(tags, /is-local/); assert.match(tags, /is-remote/);
    assert.match(tags, /is-warning/); assert.match(tags, /is-danger/);
    assert.match(tags, /本地：有变化/); assert.match(tags, /云端：缺失/);
    assert.doesNotMatch(tags, /曾校验通过/);
    const checked = app.openlistStateTags({ local_state: 'same', remote_state: 'same', status: 'completed', content_verification: 'matched' });
    assert.match(checked, /曾校验通过/);
    assert.match(app.openlistStateTags({}), /未检查/);
});

test('overview uses escaped tags and separates extra configuration into disclosure panels', async () => {
    const { app, cards } = overviewFixture(true);
    const request = app.request;
    app.request = async route => route === '/api/webdav/logs' ? { logs: [{ timestamp: 1000, type: 'upload', status: 'success' }] } : request(route);
    app.getLogTypeText = () => '<img src=x onerror=alert(1)>';
    await app.loadBackupOverview();
    const card = cards.get('bm-ov-webdav');
    assert.match(card.roles.scope.innerHTML, /bm-ov-tag/);
    assert.match(card.roles.last.innerHTML, /&lt;img/);
    assert.doesNotMatch(card.roles.last.innerHTML, /<img/);
});

test('bulk retry waits for the custom dialog, cancels safely and prevents duplicate submissions', async () => {
    const source = fs.readFileSync('public/app.js', 'utf8');
    const start = source.indexOf('    async retrySelectedOpenlist() {');
    const method = source.slice(start, source.indexOf('    async showOpenlistDetail', start));
    let decide, dialogs = 0, requests = 0;
    const app = vm.runInNewContext(`new (class {${method}})()`, {
        showSelect: () => { dialogs++; return new Promise(resolve => { decide = resolve; }); },
        window: { showInfo() {}, showError() {} }, console,
    });
    app._olbSelected = new Set([1, 3]);
    app.updateOlbSelCount = () => {};
    app.loadOpenlistBackups = () => {};
    app.request = async (_url, options) => {
        requests++;
        assert.deepEqual(JSON.parse(options.body).ids, [1, 3]);
        return { success: true, retried: 2 };
    };
    const cancelled = app.retrySelectedOpenlist();
    await app.retrySelectedOpenlist();
    assert.equal(dialogs, 1);
    assert.equal(requests, 0);
    decide(false); await cancelled;
    assert.equal(requests, 0);
    assert.equal(app._olbRetryBusy, false);
    const confirmed = app.retrySelectedOpenlist();
    app._olbSelected.add(7); // The pending dialog owns the selection captured at opening.
    decide(true); await confirmed;
    assert.equal(requests, 1);
    assert.equal(app._olbRetryBusy, false);
});
