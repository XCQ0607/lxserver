const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('public/music/app.js', 'utf8');
const ui = fs.readFileSync('public/music/js/ui/ui_accessibility.js', 'utf8');
const queueCode = app.slice(app.indexOf('let isQueueRendered = false;'), app.indexOf('function scrollToSongInQueue('));
// Actual surface refresh/observer/Escape/focus handlers, omitting unrelated footer/history setup.
const a11yCode = ui.slice(ui.indexOf('    const surfaces ='), ui.indexOf('    function observePlayerFooter()'));

function setup(width = 1440) {
    const handlers = [], observers = [], microtasks = [], nodes = new Map();
    let document;
    class Node {
        constructor(id = '', tag = 'div') { this.id = id; this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.dataset = {}; this.classes = new Set(); this.style = {}; this.inert = false; this.isConnected = true; }
        get classList() { return { contains: name => this.classes.has(name), add: (...names) => { names.forEach(name => this.classes.add(name)); notify(this); }, remove: (...names) => { names.forEach(name => this.classes.delete(name)); notify(this); } }; }
        set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
        get className() { return [...this.classes].join(' '); }
        appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
        replaceChildren(...children) { this.children = []; children.forEach(child => this.appendChild(child)); }
        set innerHTML(value) { this.html = value; this.children = []; }
        setAttribute(key, value) { this.attrs[key] = String(value); if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value); }
        getAttribute(key) { return key === 'onclick' ? this.attrs.onclick || null : this.attrs[key] ?? null; }
        removeAttribute(key) { delete this.attrs[key]; }
        contains(target) { for (let node = target; node; node = node.parentElement) if (node === this) return true; return false; }
        matches(selector) {
            return selector.split(',').some(part => {
                part = part.trim();
                if (part === '[inert]') return this.inert;
                if (part.startsWith('#')) return this.id === part.slice(1);
                if (part.startsWith('.')) return this.classes.has(part.slice(1));
                const attr = part.match(/^(?:([\w-]+))?\[([\w-]+)(?:([*]?=)"([^"]*)")?\]$/);
                if (attr) return (!attr[1] || this.tagName === attr[1].toUpperCase()) && this.getAttribute(attr[2]) !== null && (!attr[3] || (attr[3] === '*=' ? this.getAttribute(attr[2]).includes(attr[4]) : this.getAttribute(attr[2]) === attr[4]));
                return this.tagName === part.toUpperCase();
            });
        }
        closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
        querySelectorAll(selector) {
            const focusable = selector.includes('button:not(');
            const matches = node => focusable ? ['BUTTON', 'INPUT', 'SUMMARY'].includes(node.tagName) : node.matches(selector);
            return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
        }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        getClientRects() { return [{}]; }
        focus() { document.activeElement = this; }
        click() { return dispatch('click', this); }
    }
    function notify(node) { for (const observer of observers) if (observer.targets.has(node)) observer.fn([]); }
    const add = (id, tag = 'div', parent) => { const node = new Node(id, tag); if (id) nodes.set(id, node); parent?.appendChild(node); return node; };
    const html = add('html'), body = add('body', 'body', html), outsideBranch = add('outside', 'div', body);
    const opener = add('queue-opener', 'button', outsideBranch); opener.setAttribute('onclick', 'toggleQueueDrawer()');
    const icon = add('opener-icon', 'i', opener);
    const mobile = add('mobile-queue', 'button', outsideBranch); mobile.setAttribute('data-mobile-btn', 'queue');
    const mobileIcon = add('mobile-icon', 'i', mobile);
    const overflow = add('overflow-queue', 'button', outsideBranch); overflow.setAttribute('data-queue-toggle', '');
    const outside = add('outside-control', 'input', outsideBranch);
    const drawer = add('queue-drawer', 'div', body); drawer.className = 'fixed translate-x-full'; drawer.inert = true; drawer.setAttribute('aria-hidden', 'true');
    const close = add('queue-close', 'button', drawer); close.title = '关闭'; close.setAttribute('onclick', 'toggleQueueDrawer()');
    const inside = add('queue-inside', 'button', drawer);
    const queueList = add('queue-list', 'div', drawer);
    const state = { playlist: [{ id: 'one', source: 'tx' }], audio: { paused: false, currentTime: 42 }, rendered: 0 };
    function dispatch(type, target, properties = {}) {
        const event = { type, target, prevented: false, stopped: false, immediate: false,
            preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.stopped = this.immediate = true; },
            composedPath() { const path = []; for (let node = target; node; node = node.parentElement) path.push(node); return path; }, ...properties };
        for (const record of handlers.filter(record => record.type === type && record.capture)) { record.fn(event); if (event.immediate) break; }
        if (!event.stopped) {
            if (type === 'click') for (let node = target; node; node = node.parentElement) { node.onclick?.(event); if (event.stopped) break; }
            if (!event.stopped) for (const record of handlers.filter(record => record.type === type && !record.capture)) { record.fn(event); if (event.immediate) break; }
        }
        return event;
    }
    document = { documentElement: html, body, activeElement: opener,
        getElementById: id => nodes.get(id) || null, createElement: tag => new Node('', tag),
        querySelectorAll: selector => selector.includes('[data-player-dialog]') ? [...nodes.values()].filter(node => node.classList.contains('fixed')) : body.querySelectorAll(selector),
        addEventListener(type, fn, options) { handlers.push({ type, fn, capture: options === true || !!options?.capture }); } };
    const window = { innerWidth: width };
    const context = vm.createContext({ window, document, innerWidth: width,
        getComputedStyle: node => ({ visibility: 'visible', zIndex: node === drawer ? '60' : '0' }),
        queueMicrotask: fn => microtasks.push(fn),
        MutationObserver: class { constructor(fn) { this.fn = fn; this.targets = new Set(); observers.push(this); } observe(node) { this.targets.add(node); } },
        setTimeout() {}, renderQueue() { state.rendered++; queueList.replaceChildren(new Node('queued-track')); },
        scrollToCurrentSongInQueue() {}, toggleSidebar() {},
        currentPlaylist: state.playlist, currentIndex: 0, audio: state.audio,
    });
    vm.runInContext(queueCode, context);
    vm.runInContext(`(function () { ${a11yCode}\nwindow.queueSurfaceTest = { discover, refresh }; })()`, context);
    for (const button of [opener, mobile, overflow, close]) button.onclick = event => { event.stopPropagation(); window.toggleQueueDrawer(); };
    window.queueSurfaceTest.discover(document);
    const flush = () => { while (microtasks.length) microtasks.shift()(); };
    window.queueSurfaceTest.refresh(); flush();
    return { context, window, document, drawer, queueList, opener, icon, mobile, mobileIcon, overflow, outside, inside, close, state, handlers, dispatch, flush, nodes, add };
}

for (const width of [375, 1440]) test(`outside click closes queue through its normal close/a11y path at ${width}px`, () => {
    const view = setup(width); const original = JSON.stringify(view.state);
    view.opener.click(); view.flush();
    assert.equal(view.drawer.classList.contains('translate-x-full'), false);
    assert.equal(view.drawer.inert, false);
    let acted = 0;
    view.outside.onclick = event => { acted++; event.stopPropagation(); view.outside.focus(); };
    const event = view.outside.click(); view.flush();
    assert.equal(view.drawer.classList.contains('translate-x-full'), true, 'capture dismissal must beat outside stopPropagation');
    assert.equal(acted, 1);
    assert.equal(event.prevented, false);
    assert.equal(view.queueList.children.length, 0, 'existing toggle close clears rendered rows');
    assert.equal(view.drawer.inert, true);
    assert.equal(view.drawer.getAttribute('aria-hidden'), 'true');
    assert.equal(view.document.activeElement, view.outside, 'a11y refresh must not steal the outside control focus');
    assert.equal(JSON.stringify({ ...view.state, rendered: 0 }), original);
});

test('inside queue controls do not dismiss the drawer or suppress their action', () => {
    const view = setup(); view.opener.click(); view.flush();
    let acted = 0;
    view.inside.onclick = event => { acted++; event.stopPropagation(); };
    view.inside.click(); view.flush();
    assert.equal(acted, 1);
    assert.equal(view.drawer.classList.contains('translate-x-full'), false);
    assert.equal(view.state.rendered, 1);
});

for (const key of ['icon', 'mobileIcon', 'overflow']) test(`${key} queue toggle closes once rather than capture-close then reopening`, () => {
    const view = setup(375); view.opener.click(); view.flush();
    view[key].click(); view.flush();
    assert.equal(view.drawer.classList.contains('translate-x-full'), true);
    assert.equal(view.state.rendered, 1, 'outside capture must not cause a second open/render');
    view[key].click(); view.flush();
    assert.equal(view.drawer.classList.contains('translate-x-full'), false);
    assert.equal(view.state.rendered, 2);
});

for (const useEscape of [false, true]) test(`normal ${useEscape ? 'Escape' : 'close button'} still restores opener focus and inert state`, () => {
    const view = setup(); view.opener.click(); view.flush();
    if (useEscape) view.dispatch('keydown', view.inside, { key: 'Escape' });
    else view.close.click();
    view.flush();
    assert.equal(view.drawer.classList.contains('translate-x-full'), true);
    assert.equal(view.document.activeElement, view.opener);
    assert.equal(view.drawer.inert, true);
});

test('a stale outside-dismiss marker is cleared on reopen and closed queue ignores outside clicks', () => {
    const view = setup(); view.opener.click(); view.flush(); view.outside.click(); view.flush();
    view.opener.focus(); view.opener.click(); view.flush(); view.close.click(); view.flush();
    assert.equal(view.document.activeElement, view.opener);
    const count = view.state.rendered; view.outside.click(); view.flush();
    assert.equal(view.state.rendered, count);
    assert.equal(view.drawer.classList.contains('translate-x-full'), true);
});

test('focusin during outside close does not trap focus into an already closed drawer', () => {
    const view = setup(); view.opener.click(); view.flush();
    view.outside.onclick = () => { view.outside.focus(); view.dispatch('focusin', view.outside); };
    view.outside.click();
    assert.equal(view.document.activeElement, view.outside);
    view.flush(); assert.equal(view.document.activeElement, view.outside);
});

test('dynamically generated mobile overflow queue button exposes a stable toggle hook', () => {
    const view = setup(375);
    const info = view.add('player-song-info'); info.clientWidth = 40;
    view.add('player-mobile-actions');
    view.add('player-mobile-overflow-menu');
    const content = view.add('player-mobile-overflow-content');
    view.window.adjustMobilePlayerActions();
    assert.ok(content.children.length > 0);
    assert.equal(content.children[0].getAttribute('data-queue-toggle'), '');
    view.opener.click(); view.flush();
    content.children[0].click(); view.flush();
    assert.equal(view.drawer.classList.contains('translate-x-full'), true);
    assert.equal(view.state.rendered, 1, 'actual generated overflow handler must close, not reopen');
});

test('normal non-queue surface close retains its original focus restoration', () => {
    const view = setup();
    const modal = view.add('settings-modal', 'div', view.document.body); modal.className = 'fixed hidden';
    view.add('modal-control', 'button', modal);
    view.window.queueSurfaceTest.discover(view.document);
    view.outside.focus(); modal.classList.remove('hidden'); view.flush();
    assert.notEqual(view.document.activeElement, view.outside);
    modal.classList.add('hidden'); view.flush();
    assert.equal(view.document.activeElement, view.outside);
    assert.equal(modal.inert, true);
});

test('repeated queue opens and closes do not accumulate document click listeners', () => {
    const view = setup();
    const count = () => view.handlers.filter(record => record.type === 'click' && record.capture).length;
    const initial = count(); assert.equal(initial, 1);
    for (let i = 0; i < 5; i++) { view.opener.click(); view.flush(); view.outside.click(); view.flush(); }
    assert.equal(count(), initial);
});
