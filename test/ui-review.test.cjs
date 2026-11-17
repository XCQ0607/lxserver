const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('public/music/app.js', 'utf8');
test('non-loading player errors remain visible; idle status stays empty', () => {
    const status = {};
    const c = vm.createContext({ document: { getElementById: () => status }, audio: { paused: true } });
    vm.runInContext(app.slice(app.indexOf('function setPlayerStatus('), app.indexOf('// 保存播放历史')), c);
    for (const message of ['重连超时', '请重新登录', '暂无可用音源，请在设置中添加或启用', '']) {
        c.setPlayerStatus(message); assert.equal(status.innerText, message);
    }
});
test('mini-player keyboard handler leaves child button activation alone', () => {
    const html = fs.readFileSync('public/music/index.html', 'utf8');
    const handler = html.slice(html.indexOf('<div role="button"')).match(/onkeydown="([^"]+)"/)[1];
    const parent = {}, child = {};
    for (const target of [parent, child]) {
        let prevented = 0, expanded = 0;
        vm.runInNewContext(handler, { event: { key: ' ', target, currentTarget: parent, preventDefault() { prevented++; } }, togglePlayerPanel() { expanded++; } });
        assert.equal(expanded, target === parent ? 1 : 0); assert.equal(prevented, expanded);
    }
});
test('three-column search rows stop before the sm singer column appears', () => {
    const css = fs.readFileSync('public/music/css/app.css', 'utf8');
    assert.match(css, /@media \(max-width: 639px\) \{\s*#search-results > \.grid\.grid-cols-12:has\(\[data-rating-badges\]\)/);
});
function suggestions() {
    const elements = new Map(), handlers = {};
    function element() {
        const classes = new Set();
        return { nodeType: 1, dataset: {}, children: [], handlers: {},
            classList: { contains: x => classes.has(x), add: x => classes.add(x), toggle(x, on) { on ? classes.add(x) : classes.delete(x); } },
            setAttribute() {}, removeAttribute() {}, addEventListener(k, fn) { this.handlers[k] = fn; },
            replaceChildren() { this.children = []; }, append(...items) { this.children.push(...items); }, appendChild(item) { this.children.push(item); },
            querySelectorAll() { return this.children; }, closest() { return this.dataset.tip ? this : null; },
            contains(item) { return this === item || this.children.some(x => x.contains(item)); },
        };
    }
    for (const id of ['search-input', 'search-suggestions', 'search-suggestions-list', 'search-source', 'search-type']) elements.set(id, element());
    const field = elements.get('search-input'), box = elements.get('search-suggestions'), list = elements.get('search-suggestions-list');
    field.value = 'query'; box.children = [list];
    let hit, searches = 0;
    const document = { readyState: 'complete', activeElement: field, getElementById: id => elements.get(id), createElement: element,
        addEventListener: (k, fn) => { handlers[k] = fn; }, elementFromPoint: () => hit };
    const c = vm.createContext({ document, window: { doSearch() { searches++; } }, Date, clearTimeout, setTimeout });
    let code = fs.readFileSync('public/music/js/library/search_suggestions.js', 'utf8');
    code = code.replace('window.SearchSuggestions = { hide,', 'window.SearchSuggestions = { render, hide,');
    vm.runInContext(code, c);
    const render = tips => c.window.SearchSuggestions.render(tips);
    render(['A', 'B']);
    function down(index = 0, extra = {}) { const item = list.children[index]; hit = item; box.handlers.pointerdown({ button: 0, pointerId: 1, clientX: 10, clientY: 10, target: item, ...extra }); }
    function up(index = 0, extra = {}) { hit = list.children[index]; handlers.pointerup({ type: 'pointerup', pointerId: 1, clientX: 10, clientY: 10, ...extra }); }
    const click = () => list.children[0].onclick({ button: 0, stopPropagation() {} });
    return { down, up, click, render, count: () => searches, field };
}
test('drag release followed by compatibility click does not choose a suggestion', () => {
    const s = suggestions(); s.down(); s.up(0, { clientX: 40 }); s.click(); assert.equal(s.count(), 0);
});
test('only a matching primary pointer can choose a suggestion', () => {
    for (const button of [1, 2]) { const s = suggestions(); s.down(0, { button }); s.up(); assert.equal(s.count(), 0); }
    const s = suggestions(); s.down(); s.up(0, { pointerId: 2 }); assert.equal(s.count(), 0); s.up(); assert.equal(s.count(), 1);
});
test('provider reordering during a press cannot choose the replacement suggestion', () => {
    const s = suggestions(); s.down(); s.render(['B', 'A']); s.up(); s.click(); assert.equal(s.count(), 0);
});
test('normal pointer selection still searches once, not twice', () => {
    const s = suggestions(); s.down(); s.up(); s.click(); assert.equal(s.count(), 1); assert.equal(s.field.value, 'A');
});
