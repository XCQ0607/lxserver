const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/music/app.js'), 'utf8');
const start = app.indexOf('async function renderCustomSources()');
const end = app.indexOf('// 重新加载源', start);
assert.ok(start >= 0 && end > start, 'shared source renderer must remain extractable');
const renderCode = app.slice(start, end);
const containerIds = ['custom-sources-list', 'settings-custom-sources-list'];

const escapeHtmlText = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
})[ch]);

class Element {
    constructor(id = '') {
        this.id = id;
        this.className = '';
        this.children = [];
        this.parentElement = null;
        this._html = '';
        this.dataset = new Proxy({}, { set(target, key, value) { target[key] = String(value); return true; } });
    }
    get classList() {
        const has = value => this.className.split(/\s+/).includes(value);
        const add = (...values) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...values])].join(' '); };
        const remove = (...values) => { this.className = this.className.split(/\s+/).filter(value => !values.includes(value)).join(' '); };
        return { contains: has, add, remove, toggle(value, force) { const enabled = force ?? !has(value); enabled ? add(value) : remove(value); return enabled; } };
    }
    set innerHTML(value) { this._html = value; this.children = []; }
    get innerHTML() { return this._html; }
    appendChild(child) {
        if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(item => item !== child);
        child.parentElement = this;
        this.children.push(child);
        return child;
    }
    querySelectorAll(selector) { return selector === '.source-item' ? this.children.filter(child => child.classList.contains('source-item')) : []; }
    querySelector(selector) {
        const match = selector.match(/^\.source-item\[data-id="([^"]+)"\]$/);
        return match ? this.children.find(child => child.dataset.id === match[1]) || null : null;
    }
}

function fixture(overrides = {}) {
    return {
        id: 'public-one.js', name: '公开音乐源', owner: 'open', enabled: true,
        status: 'success', author: 'Fixture Author', version: '1.2.3', size: 2048,
        supportedSources: ['wy', 'tx', 'kw', 'kg', 'mg'], disabledSources: ['tx'],
        ...overrides,
    };
}

async function render({ sources = [fixture(), fixture({ id: 'private-two.js', owner: 'alice', enabled: false })],
    admin = true, user = true, restriction = false, batch = null, selected = [], settings = {} } = {}) {
    const nodes = Object.fromEntries([...containerIds, 'custom-source-toolbar'].map(id => [id, new Element(id)]));
    const sortableCalls = [];
    let marqueeChecks = 0;
    const window = { lx_config: { 'user.enablePublicRestriction': restriction }, _sourceBatchMode: batch, _sourceBatchSelected: new Set(selected) };
    const context = vm.createContext({
        window, document: { getElementById: id => nodes[id] || null, createElement: () => new Element() },
        localStorage: { getItem: key => key === 'lx_admin_password' && admin ? 'fixture-only-admin' : null },
        userToken: user ? 'fixture-only-user' : null, settings,
        fetchCustomSources: async () => sources, updateSourceScopeUI() {}, escapeHtmlText,
        createMarqueeHtml: text => `<div class="dynamic-marquee">${escapeHtmlText(text)}</div>`,
        applyMarqueeChecks: () => { marqueeChecks++; },
        Sortable: { get: () => null, create: (container, options) => { sortableCalls.push({ container, options }); } },
        fetch: () => { throw new Error('layout tests must not issue network requests'); },
        console: { error() {}, warn() {}, log() {} }, setTimeout, clearTimeout,
    });
    vm.runInContext(renderCode, context);
    await context.renderCustomSources();
    return { nodes, window, sortableCalls, marqueeChecks };
}

function hasClass(html, name) {
    return new RegExp(`class="[^"]*\\b${name}\\b[^"]*"`).test(html);
}

function buttons(html) { return html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) || []; }

test('both source containers use the same vertical stack and preserve source order and identity', async () => {
    const view = await render();
    for (const id of containerIds) {
        const container = view.nodes[id];
        assert.ok(container.classList.contains('source-list-stack'), id);
        assert.equal(container.children.length, 2);
        assert.deepEqual(container.children.map(card => card.dataset.id), ['public-one.js', 'private-two.js']);
        assert.deepEqual(container.children.map(card => card.dataset.enabled), ['true', 'false']);
        assert.deepEqual(container.children.map(card => card.dataset.index), ['0', '1']);
        assert.ok(container.children.every(card => card.classList.contains('source-item')));
    }
    assert.equal(view.nodes[containerIds[0]].children[0].innerHTML, view.nodes[containerIds[1]].children[0].innerHTML);
});

test('source cards expose shared stacked information and below-information action hooks', async () => {
    const view = await render();
    for (const id of containerIds) {
        const html = view.nodes[id].children[0].innerHTML;
        for (const className of ['source-card-content', 'source-card-info', 'source-card-heading', 'source-card-name',
            'source-card-meta', 'source-card-platforms', 'source-card-actions', 'source-card-toggle', 'source-card-action-buttons']) {
            assert.ok(hasClass(html, className), `${id}: ${className}`);
        }
        assert.ok(html.indexOf('source-card-info') < html.indexOf('source-card-actions'));
        assert.ok(html.indexOf('source-card-platforms') < html.indexOf('source-card-actions'));
    }
});

test('long source names remain escaped wrapping text rather than marquee markup', async () => {
    const name = `墨澜 <img src=x onerror=alert(1)> & "quoted" 'name' ${'长名称'.repeat(60)}`;
    const view = await render({ sources: [fixture({ name })] });
    for (const id of containerIds) {
        const html = view.nodes[id].children[0].innerHTML;
        assert.ok(hasClass(html, 'source-card-name'));
        assert.ok(html.includes(escapeHtmlText(name)));
        assert.doesNotMatch(html, /<img\b|dynamic-marquee|animate-marquee/);
    }
});

test('long update notices are escaped and have separate wrapping message and action hooks', async () => {
    const log = `<img src=x onerror=alert(1)> & "notice" ${'更新说明'.repeat(60)}`;
    const view = await render({ sources: [fixture({ updateAlert: { log, updateUrl: 'https://updates.invalid/source.js' } })] });
    for (const id of containerIds) {
        const html = view.nodes[id].children[0].innerHTML;
        for (const className of ['source-card-notice', 'source-card-notice-message', 'source-card-notice-text', 'source-card-notice-actions']) {
            assert.ok(hasClass(html, className), `${id}: ${className}`);
        }
        assert.ok(html.includes(escapeHtmlText(log)));
        assert.doesNotMatch(html, /<img\b|dynamic-marquee|animate-marquee/);
        assert.match(html, /updateCustomSource\(/);
        assert.match(html, /window\.open\(/);
    }
});

test('failed-source notices remain escaped and retain failure/status presentation', async () => {
    const error = '<img src=x onerror=alert(1)> & upstream unavailable';
    const view = await render({ sources: [fixture({ status: 'failed', error })] });
    for (const id of containerIds) {
        const html = view.nodes[id].children[0].innerHTML;
        assert.ok(hasClass(html, 'source-card-error'));
        assert.ok(html.includes(escapeHtmlText(error)));
        assert.doesNotMatch(html, /<img\b/);
        assert.match(html, /失败/);
    }
});

test('disabled platform badges remain visible and marked disabled', async () => {
    const view = await render();
    for (const id of containerIds) {
        const html = view.nodes[id].children[0].innerHTML;
        assert.match(html, /title="QQ \(在此音源中已关闭\)"/);
        assert.match(html, /line-through/);
        for (const label of ['网易', 'QQ', '酷我', '酷狗', '咪咕']) assert.ok(html.includes(label));
    }
});

test('administrators retain toggle, platform editing, failed-source reload and deletion handlers', async () => {
    const view = await render({ sources: [fixture({ status: 'failed', error: 'fixture failure' })] });
    for (const id of containerIds) {
        const html = view.nodes[id].children[0].innerHTML;
        assert.match(html, /toggleSource\('public-one\.js', true\)/);
        assert.match(html, /openEditSourceModal\(/);
        assert.match(html, /reloadSource\('public-one\.js'\)/);
        assert.match(html, /deleteSource\('public-one\.js'\)/);
    }
});

test('ordinary users cannot delete or reload public sources but retain private-source management', async () => {
    const view = await render({ admin: false, sources: [
        fixture({ status: 'failed', error: 'fixture failure' }),
        fixture({ id: 'private-two.js', owner: 'alice', status: 'failed', error: 'fixture failure' }),
    ] });
    for (const id of containerIds) {
        const [publicCard, privateCard] = view.nodes[id].children;
        assert.doesNotMatch(publicCard.innerHTML, /deleteSource\(|reloadSource\(/);
        assert.match(publicCard.innerHTML, /toggleSource\(/);
        assert.match(publicCard.innerHTML, /openEditSourceModal\(/);
        assert.match(privateCard.innerHTML, /deleteSource\('private-two\.js'\)/);
        assert.match(privateCard.innerHTML, /reloadSource\('private-two\.js'\)/);
    }
});

test('batch mode preserves checkbox identity and selection while disabling ordinary controls', async () => {
    const batch = containerIds[0];
    const view = await render({ batch, selected: ['public-one.js'], sources: [fixture({
        status: 'failed', error: 'fixture failure', updateAlert: { log: 'Fixture update', updateUrl: 'https://updates.invalid/source.js' },
    })] });
    const html = view.nodes[batch].children[0].innerHTML;
    assert.ok(html.includes(`id="source-batch-check-${batch}-public-one.js"`));
    assert.ok(html.includes(`toggleSourceBatchSelect('public-one.js', '${batch}')`));
    assert.match(html, /fa-check/);
    assert.ok(!hasClass(html, 'custom-source-handle'));
    const toggle = buttons(html).find(button => hasClass(button, 'source-card-toggle'));
    assert.ok(toggle, 'batch toggle remains visible');
    assert.doesNotMatch(toggle, /onclick="[^"]*toggleSource\(/);
    assert.ok(/\bdisabled\b/.test(toggle) || hasClass(toggle, 'pointer-events-none'));
    for (const button of buttons(html).filter(button => button !== toggle)) assert.match(button, /\bdisabled\b/);
    assert.deepEqual(view.sortableCalls.map(call => call.container.id), [containerIds[1]]);
});

test('normal mode retains source drag handles and Sortable wiring for both lists', async () => {
    const view = await render();
    assert.deepEqual(view.sortableCalls.map(call => call.container.id), containerIds);
    for (const { container, options } of view.sortableCalls) {
        assert.equal(options.handle, '.custom-source-handle');
        assert.equal(options.delayOnTouchOnly, true);
        assert.equal(typeof options.onEnd, 'function');
        assert.ok(container.children.every(card => hasClass(card.innerHTML, 'custom-source-handle')));
    }
});

test('locked source lists keep the login prompt and hide the management toolbar', async () => {
    for (const options of [{ sources: null }, { admin: false, user: false, restriction: true }]) {
        const view = await render(options);
        for (const id of containerIds) {
            assert.equal(view.nodes[id].children.length, 0);
            assert.match(view.nodes[id].innerHTML, /列表内容已隐藏/);
            assert.match(view.nodes[id].innerHTML, /handleAdminLogin\(/);
        }
        assert.ok(view.nodes['custom-source-toolbar'].classList.contains('hidden'));
        assert.equal(view.sortableCalls.length, 0);
    }
});

test('empty lists keep their empty state and modal-only upload shortcut', async () => {
    const view = await render({ sources: [] });
    for (const id of containerIds) {
        assert.equal(view.nodes[id].children.length, 0);
        assert.match(view.nodes[id].innerHTML, /暂无自定义源/);
    }
    assert.match(view.nodes[containerIds[0]].innerHTML, /script-file/);
    assert.doesNotMatch(view.nodes[containerIds[1]].innerHTML, /script-file/);
    assert.equal(view.sortableCalls.length, 0);
});

test('hiding public sources keeps the same private-source stack in both presentations', async () => {
    const view = await render({ settings: { enablePublicSources: false } });
    for (const id of containerIds) assert.deepEqual(view.nodes[id].children.map(card => card.dataset.id), ['private-two.js']);
});

test('scoped source CSS declares one full-width vertical stack without a fixed action sidebar', () => {
    const css = fs.readFileSync(path.join(root, 'public/music/css/app.css'), 'utf8');
    const block = selector => {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
        assert.ok(match, `missing scoped selector ${selector}`);
        return match[1];
    };
    assert.match(block('.source-list-stack'), /display\s*:\s*flex\b/);
    assert.match(block('.source-list-stack'), /flex-direction\s*:\s*column\b/);
    assert.match(block('.source-card-content'), /flex-direction\s*:\s*column\b/);
    assert.match(block('.source-card-actions'), /flex-wrap\s*:\s*wrap\b/);
    assert.match(block('.source-card-name'), /(?:overflow-wrap\s*:\s*(?:anywhere|break-word)|word-break\s*:\s*break-word)/);
    assert.match(block('.source-item'), /(?:width\s*:\s*100%|align-self\s*:\s*stretch)/);
    assert.doesNotMatch(block('.source-card-actions'), /position\s*:\s*(?:fixed|absolute)|(?:min-)?width\s*:\s*\d+(?:px|rem)/);
});
