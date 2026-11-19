const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const postcss = require('postcss');

const app = fs.readFileSync('public/music/app.js', 'utf8');
const extract = name => {
    const start = app.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    return app.slice(start, app.indexOf('\n}', start) + 2);
};
const styles = ['public/music/css/utilities.css', 'public/music/css/app.css'].map(file => postcss.parse(fs.readFileSync(file, 'utf8')));
const sharedHelpers = ['attachSongRowPopover', 'createSongAddMenu'].filter(name => app.includes(`function ${name}(`)).map(extract).join('\n');

// A minimal DOM for the real row renderer/menu wiring, not a browser layout engine.
class Element {
    constructor(tagName = 'div') { this.tagName = tagName; this.className = ''; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.style = {}; this.open = false; }
    get classList() {
        return { contains: name => this.className.split(/\s+/).includes(name),
            add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
            remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); } };
    }
    setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'class') this.className = value; if (name === 'id') this.id = value; if (name === 'title') this.title = value; if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value); }
    getAttribute(name) { return name === 'class' ? this.className : this.attributes[name] ?? null; }
    appendChild(child) {
        if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(item => item !== child);
        child.parentElement = this; this.children.push(child); return child;
    }
    replaceWith(child) { const parent = this.parentElement; const index = parent.children.indexOf(this); parent.children[index] = child; child.parentElement = parent; this.parentElement = null; }
    contains(target) { for (let node = target; node; node = node.parentElement) if (node === this) return true; return false; }
    get isConnected() { let root = this; while (root.parentElement) root = root.parentElement; return ['search-results', 'lb-songs-list'].includes(root.id); }
    focus() { this.focused = true; }
    matches(selector) { return selector === ':popover-open' && !!this.popoverOpen; }
    getBoundingClientRect() { return { right: 500, bottom: 150, top: 100, width: 176, height: 88 }; }
    set innerHTML(html) {
        this.children = [];
        const stack = [this];
        for (const match of html.matchAll(/<!--[\s\S]*?-->|<\/?([a-z][a-z0-9-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)) {
            if (!match[1]) continue;
            if (match[0].startsWith('</')) { stack.pop(); continue; }
            const node = new Element(match[1]);
            for (const attr of match[2].matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g)) node.setAttribute(attr[1], attr[2] ?? attr[3] ?? attr[4] ?? '');
            stack.at(-1).appendChild(node);
            if (!['img', 'input', 'br', 'hr', 'meta', 'link'].includes(node.tagName)) stack.push(node);
        }
    }
    querySelectorAll(selector) {
        const matches = node => selector === 'button' ? node.tagName === 'button' : selector.startsWith('.') ? node.classList.contains(selector.slice(1)) : selector.startsWith('[') ? node.getAttribute(selector.slice(1, -1)) !== null : node.tagName === selector;
        return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    click() {
        const event = { stopped: false, stopPropagation() { this.stopped = true; } };
        for (let node = this; node; node = node.parentElement) {
            node.onclick?.(event);
            for (const fn of node.listeners.click || []) fn(event);
            if (event.stopped) break;
        }
    }
}

function setup({ width = 1440, scope = 'network', detail = false } = {}) {
    const track = { id: 'track-a', songmid: 'track-a', source: 'tx', name: 'Fixture song', singer: 'Fixture artist', interval: '03:00' };
    const list = [track];
    const nodes = Object.fromEntries(['search-results', 'search-results-header', 'search-pagination-bar', 'artist-detail-header', 'album-detail-header'].map(id => { const node = new Element(); node.id = id; return [id, node]; }));
    nodes['artist-detail-header'].className = detail ? '' : 'hidden'; nodes['album-detail-header'].className = 'hidden';
    const calls = [], played = [], playlistCalls = [];
    const window = { innerWidth: width, innerHeight: 900, currentSearchScope: scope, networkSongSearch: { state: { list } }, glSortMode: false };
    const context = vm.createContext({ window, document: { getElementById: id => nodes[id] || null, createElement: tag => new Element(tag) },
        settings: { itemsPerPage: 20 }, currentPage: 1, currentSearchScope: scope,
        renderNetworkSearchFooter() {}, updatePaginationInfo() {}, lazyLoadImages() {}, applyMarqueeChecks() {},
        getThumbnailUrl: () => '', getImgUrl: () => '', getSongAlbumName: () => '', getSourceTags: () => '', getSourceStack: () => '', getQualityTags: () => '',
        escapeHtmlText: value => String(value ?? ''), createMarqueeHtml: text => String(text || ''),
        enqueueSong: (...args) => calls.push(args), playFromView: index => played.push(index), openPlaylistAddModalForSong: index => playlistCalls.push(index), openPlaylistAddModalForSongObject: song => playlistCalls.push(song),
    });
    vm.runInContext(sharedHelpers + '\n' + extract('isPagedNetworkResult') + '\n' + extract('renderResults'), context);
    context.renderResults(list);
    const row = nodes['search-results'].children[0];
    return { track, row, actions: row.querySelector('.song-row-actions'), menu: row.querySelector('.song-more-menu') || row.querySelector('.queue-actions'), addMenu: row.querySelector('.song-add-menu'), calls, played, playlistCalls, context, width };
}

function setupRanking({ width = 1440, filtered = false } = {}) {
    const source = fs.readFileSync('public/music/js/library/leaderboard_manager.js', 'utf8');
    const take = name => { const start = source.indexOf(`    function ${name}(`); assert.ok(start >= 0); return source.slice(start, source.indexOf('\n    }', start) + '\n    }'.length); };
    const songs = [{ id: 'rank-a', name: 'First ranking song', singer: 'Artist' }, { id: 'rank-b', name: 'Filtered ranking song', singer: 'Artist' }];
    const container = new Element(); container.id = 'lb-songs-list';
    const calls = [], playlistCalls = [];
    const window = { innerWidth: width, innerHeight: 900 };
    if (filtered) window.ListSearch = { state: { active: true, id: 'leaderboard' }, getDisplayList: () => [{ item: songs[1], originalIndex: 1 }], isMatched: () => false, isCurrentMatch: () => false };
    const context = vm.createContext({ window, state: { songs, source: 'wy', localPage: 1 }, settings: { itemsPerPage: 20 },
        document: { getElementById: id => id === 'lb-songs-list' ? container : null, createElement: tag => new Element(tag) },
        enqueueSong: (...args) => calls.push(args),
    });
    window.openPlaylistAddModalForSongObject = song => playlistCalls.push(song);
    vm.runInContext(sharedHelpers, context);
    if (context.createSongAddMenu) window.createSongAddMenu = context.createSongAddMenu;
    vm.runInContext(take('addSongToPlaylist') + '\n' + take('renderSongs'), context);
    context.renderSongs(songs);
    const row = container.children[0];
    return { row, actions: row.querySelector('.song-row-actions'), addMenu: row.querySelector('.song-add-menu'), calls, playlistCalls, songs, context, width };
}

// Resolve only opacity from actual CSS at this seam, including the existing
// row-group hover and focus-within rules; this does not model browser layout.
function opacityForState(element, width, { hoveredRow = false, focusWithin = false } = {}) {
    function simpleMatches(token, node) {
        if (!node || !/^(?:[.#](?:\\.|[\w-])+)+$/.test(token)) return false;
        return [...token.matchAll(/([.#])((?:\\.|[\w-])+)/g)].every(([, kind, value]) => kind === '#' ? node.id === value : node.classList.contains(value.replace(/\\(.)/g, '$1')));
    }
    function matches(selector) {
        if (selector.startsWith('.group-hover\\:opacity-100')) {
            return hoveredRow && element.classList.contains('group-hover:opacity-100') && element.parentElement.classList.contains('group');
        }
        if (selector.endsWith(':focus-within')) {
            if (!focusWithin) return false;
            selector = selector.slice(0, -':focus-within'.length);
        }
        if (/(^|[^\\]):/.test(selector)) return false;
        const tokens = selector.trim().split(/\s+/); let node = element;
        if (!simpleMatches(tokens.pop(), node)) return false;
        while (tokens.length) {
            const token = tokens.pop();
            if (token === '>') { node = node.parentElement; if (!simpleMatches(tokens.pop(), node)) return false; }
            else { do { node = node.parentElement; } while (node && !simpleMatches(token, node)); if (!node) return false; }
        }
        return true;
    }
    let opacity = 1;
    let winning = [-1, -1, -1, -1];
    for (const root of styles) root.walkRules(rule => {
        let layered = false;
        for (let parent = rule.parent; parent; parent = parent.parent) {
            if (parent.type !== 'atrule') continue;
            if (parent.name === 'layer') layered = true;
            if (/keyframes/.test(parent.name)) return;
            if (parent.name !== 'media') continue;
            if (/hover:/.test(parent.params) && !hoveredRow) return;
            if (/pointer:|prefers-/.test(parent.params)) return;
            for (const [, bound, value] of parent.params.matchAll(/(min|max)-width\s*:\s*(\d+)px/g)) if (bound === 'min' ? width < Number(value) : width > Number(value)) return;
        }
        for (const selector of rule.selectors.filter(matches)) {
            const simple = [...selector.matchAll(/([.#])(?:\\.|[\w-])+/g)];
            const ids = simple.filter(match => match[1] === '#').length;
            const classes = selector.startsWith('.group-hover\\:opacity-100') ? 2 : simple.filter(match => match[1] === '.').length + Number(selector.endsWith(':focus-within'));
            for (const decl of rule.nodes) {
                if (decl.type !== 'decl' || decl.prop !== 'opacity') continue;
                const priority = [Number(!!decl.important), Number(!layered), ids, classes];
                const firstDifference = priority.findIndex((value, index) => value !== winning[index]);
                if (firstDifference !== -1 && priority[firstDifference] < winning[firstDifference]) continue;
                winning = priority;
                opacity = Number(decl.value);
            }
        }
    });
    return opacity;
}

for (const width of [1025, 1440, 1920]) test(`desktop search exposes its queue menu without hover at ${width}px`, () => {
    const view = setup({ width });
    assert.ok(view.actions && view.menu, 'real renderer must create the existing queue menu');
    assert.ok(view.addMenu?.querySelector('[data-song-add-queue]') || view.menu.querySelector('[data-queue-add]'), 'Add to queue remains available');
    assert.equal(opacityForState(view.actions, width), 1, 'desktop queue affordance must not be transparent until hover');
    assert.equal(view.menu.tagName, 'details');
    assert.ok(view.menu.querySelector('summary').getAttribute('aria-label'), 'native keyboard-operable summary retains an accessible name');
});

test('rendered Add to queue uses the existing item and stops propagation instead of starting playback', () => {
    const view = setup(); const menu = view.addMenu || view.menu; menu.open = true;
    (menu.querySelector('[data-song-add-queue]') || menu.querySelector('[data-queue-add]')).click();
    assert.deepEqual(view.calls, [[view.track]]);
    assert.equal(menu.open, false);
    assert.deepEqual(view.played, []);
});

test('rendered Play next keeps its existing queue insertion semantics', () => {
    const view = setup(); view.menu.open = true;
    view.menu.querySelector('[data-queue-next]').click();
    assert.deepEqual(view.calls, [[view.track, true]]);
    assert.equal(view.menu.open, false);
    assert.deepEqual(view.played, []);
});

for (const width of [375, 768, 1024]) test(`mobile/tablet search exposes the same Add chooser at ${width}px`, () => {
    const view = setup({ width });
    assert.ok(view.addMenu?.querySelector('[data-song-add-queue]'));
    assert.equal(opacityForState(view.actions, width), 1);
});

for (const options of [{ scope: 'local_list' }, { detail: true }]) test(`non-search/detail rows retain existing desktop hover behavior (${JSON.stringify(options)})`, () => {
    const view = setup(options);
    assert.ok(view.menu.querySelector('[data-queue-add]'));
    assert.equal(opacityForState(view.actions, 1440), 0);
});

test('existing row-group hover and keyboard focus still reveal list actions', () => {
    const view = setup({ scope: 'local_list' });
    assert.equal(opacityForState(view.actions, 1440), 0);
    assert.equal(opacityForState(view.actions, 1440, { hoveredRow: true }), 1);
    assert.equal(opacityForState(view.actions, 1440, { focusWithin: true }), 1);
});

test('opening the search queue menu preserves visibility and existing close-after-action behavior', () => {
    const view = setup(); const menu = view.addMenu || view.menu;
    menu.open = true;
    assert.equal(opacityForState(view.actions, 1440, { focusWithin: true }), 1);
    (menu.querySelector('[data-song-add-queue]') || menu.querySelector('[data-queue-add]')).click();
    assert.equal(menu.open, false);
    assert.equal(opacityForState(view.actions, 1440), 1);
    assert.deepEqual(view.played, []);
});

for (const [name, create] of [['search', setup], ['ranking', setupRanking]]) {
    for (const width of [375, 1025, 1440]) test(`${name} has one discoverable Add chooser with queue and playlist at ${width}px`, () => {
        const view = create({ width });
        assert.ok(view.addMenu, 'existing direct playlist Add must become the shared chooser');
        assert.equal(view.row.querySelectorAll('.song-add-menu').length, 1);
        assert.ok(view.addMenu.querySelector('[data-song-add-queue]'));
        assert.ok(view.addMenu.querySelector('[data-song-add-playlist]'));
        assert.ok(view.addMenu.querySelector('summary').getAttribute('aria-label'));
        assert.equal(opacityForState(view.actions, width), 1);
        assert.equal(view.row.querySelectorAll('[data-queue-add]').length, 0, 'More must not duplicate the Add-to-queue choice');
    });
    test(`${name} closes its chooser before opening the existing playlist workflow`, () => {
        const view = create(); assert.ok(view.addMenu);
        view.addMenu.open = true;
        view.addMenu.querySelector('[data-song-add-playlist]').click();
        assert.equal(view.addMenu.open, false);
        assert.equal(view.playlistCalls.length, 1);
        assert.equal(view.calls.length, 0);
    });
    test(`${name} Escape closes Add and returns keyboard focus to its native summary`, () => {
        const view = create(); assert.ok(view.addMenu);
        view.addMenu.open = true;
        let prevented = false;
        for (const fn of view.addMenu.listeners.keydown || []) fn({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() {} });
        assert.equal(view.addMenu.open, false);
        assert.equal(view.addMenu.querySelector('summary').focused, true);
        assert.equal(prevented, true);
    });
}

test('filtered ranking Add resolves original state index and platform fallback for both choices', () => {
    const view = setupRanking({ filtered: true }); assert.ok(view.addMenu);
    view.addMenu.querySelector('[data-song-add-queue]').click();
    assert.equal(view.calls[0][0].id, 'rank-b');
    assert.equal(view.calls[0][0].source, 'wy');
    view.addMenu.querySelector('[data-song-add-playlist]').click();
    assert.equal(view.playlistCalls[0].id, 'rank-b');
    assert.equal(view.playlistCalls[0].source, 'wy');
});

for (const [name, create] of [['search', setup], ['ranking', setupRanking]]) test(`${name} chooser keeps the displayed song after the underlying view changes`, () => {
    const view = create(); assert.ok(view.addMenu);
    const expected = name === 'search' ? view.track.id : view.songs[0].id;
    if (name === 'search') view.context.window.viewingPlaylist = [{ id: 'wrong-later-view' }];
    else { view.context.state.songs = [{ id: 'wrong-later-view' }]; view.context.state.source = 'tx'; }
    view.addMenu.querySelector('[data-song-add-playlist]').click();
    assert.equal(view.playlistCalls[0].id, expected);
    view.addMenu.querySelector('[data-song-add-queue]').click();
    assert.equal(view.calls[0][0].id, expected);
});

for (const [name, create] of [['search', setup], ['ranking', setupRanking]]) test(`${name} top-layer Add popup positions without a footer and hides before the playlist modal`, () => {
    Element.prototype.showPopover = function () { this.popoverOpen = true; };
    Element.prototype.hidePopover = function () { this.popoverOpen = false; };
    try {
        const view = create(); const menu = view.addMenu; const popup = menu.querySelector('.queue-actions-menu');
        assert.equal(popup.getAttribute('popover'), 'auto');
        menu.open = true;
        for (const fn of menu.listeners.toggle || []) fn();
        assert.equal(popup.popoverOpen, true);
        assert.ok(Number.parseFloat(popup.style.left) >= 8);
        assert.ok(Number.parseFloat(popup.style.top) >= 8);
        let opened = false;
        const openModal = () => { assert.equal(menu.open, false); assert.equal(popup.popoverOpen, false); opened = true; };
        if (name === 'search') view.context.openPlaylistAddModalForSongObject = openModal;
        else view.context.window.openPlaylistAddModalForSongObject = openModal;
        menu.querySelector('[data-song-add-playlist]').click();
        assert.equal(opened, true);
        menu.open = true;
        popup.popoverOpen = false;
        for (const fn of popup.listeners.toggle || []) fn();
        assert.equal(menu.open, false, 'native light dismissal also closes details');
    } finally {
        delete Element.prototype.showPopover;
        delete Element.prototype.hidePopover;
    }
});

for (const [name, create] of [['search', setup], ['ranking', setupRanking]]) test(`${name} fallback listens only while open, dismisses outside without stealing focus, and cleans up detached rows`, () => {
    const view = create(); const menu = view.addMenu; const document = view.context.document;
    const listeners = new Set(); const observers = new Set();
    document.body = new Element('body');
    document.addEventListener = (type, fn, capture) => { assert.equal(type, 'click'); assert.equal(capture, true); listeners.add(fn); };
    document.removeEventListener = (type, fn, capture) => { assert.equal(type, 'click'); assert.equal(capture, true); listeners.delete(fn); };
    view.context.MutationObserver = class {
        constructor(fn) { this.fn = fn; }
        observe(target) { assert.equal(target, document.body); observers.add(this); }
        disconnect() { observers.delete(this); }
    };
    const toggle = open => { menu.open = open; for (const fn of menu.listeners.toggle || []) fn(); };
    assert.equal(listeners.size, 0);
    toggle(true); toggle(true);
    assert.equal(listeners.size, 1, 'one temporary listener despite repeated toggle events');
    assert.equal(observers.size, 1);
    for (const fn of listeners) fn({ target: menu.querySelector('summary') });
    assert.equal(menu.open, true, 'inside clicks do not dismiss before choosing');
    const outside = new Element('button');
    for (const fn of [...listeners]) fn({ target: outside, preventDefault() { assert.fail('outside click must keep its normal behavior'); } });
    assert.equal(menu.open, false);
    assert.equal(menu.querySelector('summary').focused, undefined, 'outside dismissal must not move focus');
    assert.equal(listeners.size, 0);
    assert.equal(observers.size, 0);
    toggle(true);
    menu.querySelector('[data-song-add-queue]').click();
    assert.equal(listeners.size, 0, 'queue choice removes temporary document listener');
    toggle(true);
    for (const fn of menu.listeners.keydown || []) fn({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    assert.equal(listeners.size, 0, 'Escape removes temporary listener');
    toggle(true);
    view.row.parentElement.children = [];
    view.row.parentElement = null;
    for (const observer of [...observers]) observer.fn();
    assert.equal(menu.open, false);
    assert.equal(listeners.size, 0, 'row rerender/removal releases the listener');
    assert.equal(observers.size, 0);
});

test('queued modern Popover toggles safely close after a search or ranking row is detached', () => {
    Element.prototype.showPopover = function () {
        if (!this.isConnected) throw new Error('Popover target is disconnected');
        this.popoverOpen = true;
    };
    Element.prototype.hidePopover = function () { this.popoverOpen = false; };
    try {
        for (const create of [setup, setupRanking]) {
            const view = create(); const menu = view.addMenu;
            menu.open = true; // The browser queues details' toggle event.
            view.row.parentElement.children = [];
            view.row.parentElement = null; // A rerender removes it before dispatch.
            assert.doesNotThrow(() => {
                for (const fn of menu.listeners.toggle || []) fn();
            });
            assert.equal(menu.open, false);
            assert.equal(menu.querySelector('.queue-actions-menu').popoverOpen, undefined);
        }
    } finally {
        delete Element.prototype.showPopover;
        delete Element.prototype.hidePopover;
    }
});
