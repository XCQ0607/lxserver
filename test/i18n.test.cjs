const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync('public/music/js/ui/i18n.js', 'utf8'), context);
const { createTranslator } = context.window.LXI18n;

const translator = createTranslator({
    '设置': 'Settings',
    '导入': 'Import',
    '已加载 {0} 首 · {1}/{2} 个音源已返回': 'Loaded {0} songs · {1}/{2} sources returned',
    '{0}成功': '{0} succeeded',
    '已将 {0} 添加到 {1}': 'Added {0} to {1}',
    '{0}首': '{0} songs',
    '暂停中': 'Paused', '无损音质': 'Lossless', '缓存': 'Cached',
});

test('whole strings translate exactly; anything else is left alone', () => {
    assert.equal(translator.translate('设置'), 'Settings');
    assert.equal(translator.translate('设置页'), null);
    assert.equal(translator.translate('晴天'), null, 'song names are not in the table');
});

test('template strings fill their placeholders, translating values that are UI words', () => {
    assert.equal(translator.translate('已加载 103 首 · 5/5 个音源已返回'), 'Loaded 103 songs · 5/5 sources returned');
    assert.equal(translator.translate('已将 晴天 添加到 我的喜爱'), 'Added 晴天 to 我的喜爱');
    assert.equal(translator.translate('导入成功'), 'Import succeeded');
});

test('templates with little fixed text do not swallow song titles', () => {
    assert.equal(translator.translate('忘记成功'), null, 'a short template only accepts known words or non-Chinese values');
    assert.equal(translator.translate('3成功'), '3 succeeded');
    assert.equal(translator.translate('最后一首'), null, 'a one-character template only takes numbers');
    assert.equal(translator.translate('100首'), '100 songs');
});

test('text assembled from several UI words is translated piece by piece', () => {
    assert.equal(translator.translate('暂停中 (无损音质) 【缓存】'), 'Paused (Lossless) [Cached]');
    assert.equal(translator.translate('暂停中 (128k)'), 'Paused (128k)');
    assert.equal(translator.translate('晴天 (无损音质)'), null, 'an unknown piece leaves the whole text alone');
});

function domTranslator() {
    const texts = [{ nodeType: 3, nodeValue: '设置' }];
    const option = { get text() { return texts[0].nodeValue; } };
    const select = { options: [option], selectedIndex: 0 };
    const languageSelect = { value: 'zh-CN' }, store = {}, events = [], errors = [], scripts = [];
    let label = '设置', fail = false;
    const document = {
        readyState: 'loading', title: '设置', currentScript: null,
        body: { nodeType: 1, tagName: 'BODY', hasAttribute: () => false }, documentElement: {},
        createElement: () => ({}), addEventListener() {},
        createTreeWalker() { let i = 0; return { nextNode: () => texts[i++] || null }; },
        querySelectorAll: query => query === 'select' ? [select] : query === '[data-language-select]' ? [languageSelect] : [],
        head: { appendChild(script) { scripts.push(script); queueMicrotask(() => fail ? script.onerror() : script.onload()); } },
    };
    const window = { LX_I18N_EN: { '设置': 'Settings' }, OpenCC: { Converter: () => s => s.replace('设', '設') },
        CustomSelectManager: { closeAll() {}, syncUI() { label = option.text; } },
        showError: message => errors.push(message), dispatchEvent: e => events.push(e) };
    const c = vm.createContext({ document, window, console, NodeFilter: { SHOW_TEXT: 4, SHOW_ELEMENT: 1 },
        MutationObserver: class { observe() {} takeRecords() {} }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        localStorage: { getItem: k => store[k], setItem: (k, v) => { store[k] = v; } } });
    vm.runInContext(fs.readFileSync('public/music/js/ui/i18n.js', 'utf8'), c);
    return { api: window.LXI18n, store, events, errors, languageSelect, label: () => label, fail: value => { fail = value; }, scripts };
}
test('custom-select labels resync from translated native options on language round trip', async () => {
    const d = domTranslator();
    await d.api.setLanguage('en'); assert.equal(d.label(), 'Settings');
    await d.api.setLanguage('zh-CN'); assert.equal(d.label(), '设置');
    await d.api.setLanguage('zh-Hant'); assert.equal(d.label(), '設置');
});
test('failed resource load keeps the active language, storage and controls; retry succeeds', async () => {
    const d = domTranslator(); await d.api.setLanguage('en'); d.fail(true);
    await d.api.setLanguage('zh-Hant');
    assert.equal(d.api.getLanguage(), 'en'); assert.equal(d.store.lx_ui_language, 'en');
    assert.equal(d.languageSelect.value, 'en'); assert.equal(d.label(), 'Settings');
    assert.equal(d.events.length, 1); assert.equal(d.errors.length, 1);
    d.fail(false); await d.api.setLanguage('zh-Hant');
    assert.equal(d.api.getLanguage(), 'zh-Hant'); assert.equal(d.events.length, 2);
});
test('a stale asynchronous language load cannot override the latest selection', async () => {
    const d = domTranslator(); const pending = d.api.setLanguage('en'); await d.api.setLanguage('zh-CN'); await pending;
    assert.equal(d.api.getLanguage(), 'zh-CN'); assert.equal(d.label(), '设置');
});
