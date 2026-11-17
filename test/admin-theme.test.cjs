const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const base = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(base, name), 'utf8');
const tokenSource = read('public/css/tokens.css');
const themes = [...tokenSource.matchAll(/(?:^|\n)(:root|\[data-theme="dark"\])\s*\{([^}]+)\}/g)].map(m => Object.fromEntries([...m[2].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(x => [x[1], x[2].trim()])));

function harness({ saved = null, dark = false, storageThrows = false } = {}) {
    const listeners = {}, systemListeners = {};
    const root = { dataset: {} };
    const toggle = { attributes: {}, setAttribute(k, v) { this.attributes[k] = v; } };
    const loginToggle = { attributes: {}, setAttribute(k, v) { this.attributes[k] = v; } };
    const storage = new Map(saved === null ? [] : [['lx-theme', saved]]);
    const system = { matches: dark, addEventListener(k, fn) { systemListeners[k] = fn; } };
    const chart = { data: { datasets: [{ themeSeries: 2 }, { themeSeries: 1 }] }, options: { scales: { x: { grid: {}, ticks: {} }, y: { grid: {}, ticks: {} } }, plugins: { tooltip: {} } }, updates: 0, update(mode) { assert.equal(mode, 'none'); this.updates++; } };
    const window = { matchMedia: () => system, addEventListener(k, fn) { listeners[k] = fn; }, Chart: { instances: { chart } } };
    const document = { documentElement: root, querySelectorAll: () => [toggle, loginToggle], addEventListener(k, fn) { listeners[k] = fn; } };
    const context = vm.createContext({ window, document, localStorage: { getItem: k => { if (storageThrows) throw Error('blocked'); return storage.get(k) ?? null; }, setItem: (k,v) => { if (storageThrows) throw Error('blocked'); storage.set(k,v); } }, getComputedStyle: () => ({ getPropertyValue: k => themes[root.dataset.theme === 'dark' ? 1 : 0][k] || '' }) });
    Object.defineProperty(context, 'themeColors', { get: () => window.themeColors });
    vm.runInContext(read('public/theme.js'), context);
    return { root, chart, storage, toggle, loginToggle, system, listeners, systemListeners };
}

test('theme initializes before content, follows system until a choice is saved, and recolors every series', () => {
    const h = harness();
    assert.equal(h.root.dataset.theme, 'light');
    h.system.matches = true;
    h.systemListeners.change();
    assert.equal(h.root.dataset.theme, 'dark');
    assert.equal(h.chart.data.datasets[0].borderColor, themes[1]['--chart-3']);
    assert.equal(h.chart.data.datasets[1].backgroundColor, themes[1]['--chart-2']);
    assert.equal(h.chart.options.scales.x.grid.color, themes[1]['--chart-grid']);
    assert.equal(h.chart.options.plugins.tooltip.titleColor, themes[1]['--text']);
    h.listeners.click({ target: { closest: () => h.toggle } });
    assert.equal(h.storage.get('lx-theme'), 'light');
    assert.equal(h.toggle.attributes['aria-pressed'], 'false');
    h.systemListeners.change();
    assert.equal(h.root.dataset.theme, 'light');
    assert.equal(harness({ saved: h.storage.get('lx-theme'), dark: true }).root.dataset.theme, 'light');
});

test('invalid preferences and inaccessible storage do not break initialization or switching', () => {
    assert.equal(harness({ saved: 'invalid', dark: true }).root.dataset.theme, 'dark');
    const h = harness({ storageThrows: true });
    h.listeners.click({ target: { closest: () => h.toggle } });
    assert.equal(h.root.dataset.theme, 'dark');
    h.systemListeners.change();
    assert.equal(h.root.dataset.theme, 'dark');
});

test('clearing a choice in another tab restores system following', () => {
    const h = harness({ saved: 'light', dark: true });
    h.storage.delete('lx-theme');
    h.listeners.storage({ key: 'lx-theme' });
    assert.equal(h.root.dataset.theme, 'dark');
    h.system.matches = false;
    h.systemListeners.change();
    assert.equal(h.root.dataset.theme, 'light');
});

function luminance(hex) {
    const rgb = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function resolve(theme, name) {
    const value = theme[name];
    const reference = value.match(/^var\((--[\w-]+)\)$/);
    return reference ? resolve(theme, reference[1]) : value;
}
test('both palettes provide at least 4.5:1 for text on base surfaces, status pills and filled buttons', () => {
    assert.equal(themes.length, 2);
    for (const theme of themes) {
        const pairs = [];
        for (const text of ['--text', '--text-2', '--text-3']) for (const bg of ['--bg', '--surface', '--surface-2']) pairs.push([text,bg]);
        pairs.push(['--text-on-accent','--accent'], ['--text-on-accent','--accent-hover'], ['--accent-text','--accent-soft']);
        for (const family of ['success', 'warning', 'danger', 'info']) pairs.push([`--${family}-text`, `--${family}-soft`], [`--on-${family}`, `--${family}`]);
        for (const [fg,bg] of pairs) {
            const a = luminance(resolve(theme, fg)), b = luminance(resolve(theme, bg));
            const ratio = (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
            assert.ok(ratio >= 4.5, `${fg} on ${bg}: ${ratio.toFixed(2)}`);
        }
    }
});

test('admin assets use tokens and ship no contrast patch or color gradients', () => {
    for (const file of ['public/style.css','public/css/dashboard.css','public/app.js','public/index.html','public/theme.js','public/js/ui-utils.js']) {
        const source = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
        assert.doesNotMatch(source, /#[\da-f]{3,8}\b|rgba?\(|hsla?\(|(?:linear|radial|conic)-gradient\(|data-cf|\[class\*=/i, file);
    }
    assert.doesNotMatch(read('public/theme.js'), /MutationObserver|setProperty/);
    const html = read('public/index.html');
    assert.ok(html.indexOf('src="theme.js"') < html.indexOf('href="css/tokens.css"'));
    for (const name of ['theme.css','theme-light.css','gen-light.js']) {
        assert.equal(fs.existsSync(path.join(base,'public',name)), false, name);
        assert.ok(!html.includes(name));
    }
});

test('login and console toggles share selection and accessible state', () => {
    const h = harness();
    h.listeners.click({ target: { closest: () => h.loginToggle } });
    assert.equal(h.storage.get('lx-theme'), 'dark');
    assert.equal(h.toggle.attributes['aria-pressed'], 'true');
    assert.equal(h.loginToggle.attributes['aria-pressed'], 'true');
    h.listeners.click({ target: { closest: () => h.toggle } });
    assert.equal(h.loginToggle.attributes['aria-pressed'], 'false');
    assert.match(read('public/index.html'), /id="login-theme-toggle" data-theme-toggle type="button"/);
});

test('announcement panels and buttons resolve matching backgrounds and foregrounds in both themes', () => {
    for (const theme of themes) {
        assert.equal(resolve(theme, '--bg-panel'), resolve(theme, '--surface'));
        assert.equal(resolve(theme, '--notification-button-bg'), resolve(theme, '--accent'));
        assert.equal(resolve(theme, '--notification-button-text'), resolve(theme, '--text-on-accent'));
    }
    const engine = read('public/js/notification-engine.js');
    assert.ok(engine.includes('background:var(--notification-button-bg, ${styleConfig.color})'));
    assert.ok(engine.includes('color:var(--notification-button-text, #ffffff)'));
});

test('fields use clean surfaces while the login retains its original dark palette', () => {
    const css = read('public/style.css');
    const trigger = css.match(/\n\.lx-select-trigger\s*\{([^}]+)\}/)[1];
    assert.match(trigger, /background: var\(--field-bg\)/);
    assert.match(trigger, /box-shadow: none/);
    assert.equal(resolve(themes[0], '--field-bg'), '#ffffff');
    assert.equal(themes[1]['--login-scene-background'], '#090d1a');
    assert.equal(themes[1]['--login-card-background'], 'rgba(15, 22, 38, 0.8)');
    assert.equal(themes[0]['--login-field-color'], '#1f2430');
    assert.match(css, /#login-overlay\s*\{[^}]*background: var\(--login-scene-background\)/);
    assert.match(css, /\.admin-login-card\s*\{[^}]*backdrop-filter: blur\(28px\) saturate\(190%\)/);
});
