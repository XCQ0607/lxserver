const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/music/js/library/search_suggestions.js', 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function api() {
    const context = vm.createContext({ window: {}, AbortController, setTimeout, clearTimeout });
    vm.runInContext(source, context);
    return context.window.MusicSuggestions;
}

test('aggregation normalizes duplicate words, counts each source once and limits results', () => {
    const suggestions = api();
    const tips = suggestions.merge([['第三代', 'ＡＢＣ', '第三代', '周杰伦-发如雪'], ['abc', '周杰伦 — 发如雪', '第三代'], ['第三代']], '第三');
    assert.equal(tips[0], '第三代');
    assert.equal(tips.length, 3);
    assert.equal(suggestions.merge([Array.from({ length: 40 }, (_, i) => `词${i}`)], '词').length, 10);
});

test('fast sources publish before a slow source; a timeout does not clear successful tips', async () => {
    const updates = [];
    const engine = api().create({ sources: ['kw', 'tx'], timeout: 15, fetchTips: source => source === 'kw' ? Promise.resolve(['第三代']) : new Promise(() => {}) });
    const pending = engine.search('第三', 'all', tips => updates.push([...tips]));
    await tick();
    assert.deepEqual(updates.at(-1), ['第三代']);
    assert.deepEqual([...await pending], ['第三代']);
});

test('replaced and cancelled searches cannot publish even if fetch ignores AbortSignal', async () => {
    const pending = [], updates = [];
    const engine = api().create({ sources: ['kw'], fetchTips: (_, query) => new Promise(resolve => pending.push({ query, resolve })) });
    const old = engine.search('旧', 'all', tips => updates.push(['old', ...tips]));
    await tick();
    const fresh = engine.search('新', 'kw', tips => updates.push(['new', ...tips]));
    await tick();
    pending[0].resolve(['旧结果']);
    pending[1].resolve(['新结果']);
    await Promise.all([old, fresh]);
    assert.equal(updates.some(row => row.includes('旧结果')), false);
    assert.deepEqual(updates.at(-1), ['new', '新结果']);
    const cancel = engine.search('取消', 'kw', tips => updates.push(['cancel', ...tips]));
    await tick(); engine.cancel(); pending[2].resolve(['不能显示']); await cancel;
    assert.equal(updates.some(row => row.includes('不能显示')), false);
});

test('cache is shared between aggregate and single-source requests, expires and stays bounded', async () => {
    let calls = 0, time = 0;
    const engine = api().create({ sources: ['kw'], ttl: 10, capacity: 2, now: () => time, fetchTips: async (_, query) => { calls++; return [query]; } });
    await engine.search('a', 'all', () => {});
    await engine.search('a', 'kw', () => {});
    assert.equal(calls, 1);
    time = 11;
    await engine.search('a', 'kw', () => {});
    assert.equal(calls, 2);
    await engine.search('b', 'kw', () => {});
    await engine.search('c', 'kw', () => {});
    await engine.search('a', 'kw', () => {});
    assert.equal(calls, 5);
});

test('an unavailable source is retried rather than caching an empty or malformed response', async () => {
    let calls = 0;
    const engine = api().create({ sources: ['kw'], fetchTips: async () => { calls++; return calls === 1 ? { error: 'failed' } : calls === 2 ? [] : ['第三代']; } });
    for (let i = 0; i < 3; i++) await engine.search('第三', 'kw', () => {});
    assert.equal(calls, 3);
});

function fixture() {
    class Node {
        constructor(id = '') { this.id = id; this.value = ''; this.children = []; this.dataset = {}; this.events = {}; this.attributes = {}; this.classes = new Set();
            this.classList = { add: value => this.classes.add(value), remove: value => this.classes.delete(value), contains: value => this.classes.has(value), toggle: (value, active) => active ? this.classes.add(value) : this.classes.delete(value) };
        }
        addEventListener(name, fn) { this.events[name] = fn; }
        emit(name, event = {}) { return this.events[name]?.({ target: this, preventDefault() {}, stopPropagation() {}, ...event }); }
        setAttribute(name, value) { this.attributes[name] = value; }
        removeAttribute(name) { delete this.attributes[name]; }
        append(...nodes) { this.children.push(...nodes); }
        appendChild(node) { this.children.push(node); }
        replaceChildren() { this.children = []; }
        querySelectorAll() { return this.children; }
        contains(node) { return this === node || this.children.some(child => child.contains(node)); }
        scrollIntoView() {}
    }
    const nodes = Object.fromEntries(['search-input', 'search-source', 'search-type', 'search-suggestions', 'search-suggestions-list'].map(id => [id, new Node(id)]));
    nodes['search-source'].value = 'all'; nodes['search-type'].value = 'song'; nodes['search-suggestions'].classes.add('hidden');
    const events = {}, timers = new Map(), requests = [];
    let sequence = 0, searches = 0;
    const document = { readyState: 'loading', activeElement: nodes['search-input'], getElementById: id => nodes[id], createElement: () => new Node(), addEventListener: (name, fn) => { events[name] = fn; } };
    const context = vm.createContext({ window: { currentSearchScope: 'network', doSearch: () => searches++ }, document, AbortController,
        setTimeout: (fn, ms) => { const id = ++sequence; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
        fetch: (url, options) => new Promise(resolve => requests.push({ url, signal: options.signal, resolve: tips => resolve({ ok: true, json: async () => tips }) })),
    });
    vm.runInContext(source, context); events.DOMContentLoaded();
    const runDebounce = () => { for (const [id, { fn, ms }] of [...timers]) if (ms === 300) { timers.delete(id); fn(); } };
    return { nodes, context, requests, runDebounce, searches: () => searches };
}

test('IME sends no request until composition ends, and selecting a word searches once in aggregate mode', async () => {
    const f = fixture(), field = f.nodes['search-input'];
    field.value = 'di san'; field.emit('compositionstart'); field.emit('input', { isComposing: true }); f.runDebounce();
    let prevented = 0;
    f.context.window.SearchSuggestions.submit({ preventDefault: () => prevented++ });
    await tick(); assert.equal(f.requests.length, 0); assert.equal(f.searches(), 0);
    field.value = '第三'; field.emit('compositionend'); field.emit('input'); f.runDebounce(); await tick();
    assert.equal(f.requests.length, 5);
    assert.ok(f.requests.every(request => !request.url.includes('source=all')));
    f.requests.forEach(request => request.resolve(['第三代', '第三人称'])); await tick();
    field.emit('keydown', { key: 'ArrowDown' });
    field.emit('keydown', { key: 'Enter', preventDefault: () => prevented++ });
    assert.equal(field.value, '第三代'); assert.equal(f.searches(), 1); assert.equal(prevented, 2);
    assert.equal(f.nodes['search-source'].value, 'all'); assert.equal(field.attributes['aria-expanded'], 'false');
});

test('input changes abort immediately, not after debounce; Escape and formal search prevent reopening', async () => {
    const f = fixture(), field = f.nodes['search-input'];
    field.value = '旧'; field.emit('input'); f.runDebounce(); await tick();
    field.value = '新'; field.emit('input');
    assert.ok(f.requests.every(request => request.signal.aborted));
    f.requests.forEach(request => request.resolve(['旧词'])); await tick();
    assert.equal(f.nodes['search-suggestions'].classList.contains('hidden'), true);
    f.runDebounce(); await tick();
    f.requests[5].resolve(['新词']); await tick();
    assert.equal(field.attributes['aria-expanded'], 'true');
    field.emit('keydown', { key: 'Escape' });
    f.requests.slice(6).forEach(request => request.resolve(['不能重新弹出'])); await tick();
    assert.equal(field.attributes['aria-expanded'], 'false');
    f.context.window.SearchSuggestions.submit({ preventDefault() {} });
    assert.equal(f.searches(), 1);
});

test('progressive reordering preserves the keyboard-selected word; platform text never becomes HTML', async () => {
    const f = fixture(), field = f.nodes['search-input'];
    field.value = '第'; field.emit('input'); f.runDebounce(); await tick();
    f.requests[0].resolve(['第二', '<img src=x onerror=alert(1)>']); await tick();
    field.emit('keydown', { key: 'ArrowDown' });
    f.requests[1].resolve(['第一', '第一', '第二']); f.requests[2].resolve(['第一']); await tick();
    const list = f.nodes['search-suggestions-list'];
    const active = list.children.find(child => child.attributes['aria-selected'] === 'true');
    assert.equal(active.dataset.tip, '第二');
    const htmlText = list.children.find(child => child.dataset.tip.startsWith('<img'));
    assert.equal(htmlText.children[1].textContent, '<img src=x onerror=alert(1)>');
    assert.equal(htmlText.children[1].innerHTML, undefined);
    f.context.window.SearchSuggestions.hide();
});

test('changing source or leaving the input prevents a late response from rendering', async () => {
    const f = fixture(), field = f.nodes['search-input'];
    field.value = '第三'; field.emit('input'); f.runDebounce(); await tick();
    f.nodes['search-source'].value = 'tx'; f.nodes['search-source'].emit('change');
    f.requests.forEach(request => request.resolve(['第三代'])); await tick();
    assert.equal(field.attributes['aria-expanded'], 'false');
    field.emit('focus'); await tick();
    assert.equal(f.requests.length, 6);
    field.emit('blur'); f.context.document.activeElement = null;
    f.requests[5].resolve(['第三代']); await tick();
    assert.equal(field.attributes['aria-expanded'], 'false');
});

test('backend isolates each request from SDK singleton cancellation state', async () => {
    const server = fs.readFileSync('src/server/server.ts', 'utf8');
    const start = server.indexOf("if (pathname === '/api/music/tipSearch'");
    const end = server.indexOf('// [新增] 获取歌手详情 API', start);
    const body = server.slice(start, end).replace('catch (err: any)', 'catch (err)');
    let cancelled = 0;
    const sdk = { kw: { tipSearch: { requestObj: { cancelHttp: () => cancelled++ }, async search(name) { this.requestObj?.cancelHttp(); this.requestObj = { cancelHttp: () => cancelled++ }; await tick(); return [name]; } } } };
    const invoke = new Function('musicSdk', 'urlObj', 'res', `return (async () => { const pathname='/api/music/tipSearch', req={method:'GET'}; ${body} })()`);
    const results = [];
    await Promise.all(['一', '二'].map(name => invoke(sdk, new URL(`https://example.test/api/music/tipSearch?source=kw&name=${name}`), { writeHead() {}, end(text) { results.push(JSON.parse(text)[0]); } })));
    assert.equal(cancelled, 0); assert.deepEqual(results.sort(), ['一', '二']);
});
