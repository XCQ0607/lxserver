const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');

const root = join(__dirname, '../public/music');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'css/app.css'), 'utf8');
const app = readFileSync(join(root, 'app.js'), 'utf8');
const localToolbar = html.slice(html.indexOf('<!-- Mobile Toggle Buttons -->'), html.indexOf('<!-- 高级筛选面板'));
const tags = [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]);

test('each responsive local-library action has the same name and handler', () => {
    for (const [handler, label] of [
        ['toggleFilterPanel', '高级筛选'], ['refresh', '刷新'], ['toggleBatchMode', '批量操作'],
    ]) {
        const matches = [...localToolbar.matchAll(/<button\b[^>]*>/g)].map(match => match[0]).filter(tag => tag.includes(`onclick="window.LocalMusicManager.${handler}()"`));
        assert.equal(matches.length, 2);
        assert.ok(matches.every(tag => tag.includes(`aria-label="${label}"`) && tag.includes(`title="${label}"`)));
    }
});

test('lyrics entry points are native buttons with a name and initial collapsed state', () => {
    for (const id of ['player-lyrics-cover', 'player-lyrics-button']) {
        const tag = tags.find(button => button.includes(`id="${id}"`));
        assert.ok(tag, id);
        assert.match(tag, /aria-label="歌词"/);
        assert.match(tag, /aria-controls="view-player-detail"/);
        assert.match(tag, /aria-expanded="false"/);
        assert.match(tag, /onclick="toggleLyrics\(false, this\)"/);
    }
});

test('VU settings explain the narrow-screen limitation without disabling the synced preference', () => {
    assert.match(html, /<option value="vumeter">双表头<\/option>/);
    assert.match(html, /aria-describedby="footer-vu-narrow-notice"/);
    assert.match(html, /id="footer-vu-narrow-notice"[^>]*>[^<]*条形阵列[^<]*平滑波浪/);
    assert.match(css, /@media\s*\(min-width: 768px\)\s*\{\s*#footer-vu-narrow-notice\s*\{\s*display: none;/);
});

function setup({ song = { name: 'A Song', singer: 'First / A & B', source: 'tx' }, picker, open = true } = {}) {
    const calls = [];
    const start = app.indexOf('async function searchLyricsMetadata(');
    assert.ok(start >= 0, 'shared detail-search handler');
    const source = app.slice(start, app.indexOf('\n}', start) + 2);
    const ctx = {
        currentPlayingSong: song, isLyricViewOpen: open, loadingRequestCounter: 1,
        escapeHtmlText: value => value.replace(/</g, '&lt;'),
        async showOptions(_title, _message, options) {
            calls.push(['pick', options]);
            return picker?.(options, ctx);
        },
        toggleLyrics() { ctx.isLyricViewOpen = false; calls.push(['close']); },
        performSearch(...args) { calls.push(['search', ...args]); },
    };
    const search = runInNewContext(source + '\nsearchLyricsMetadata', ctx);
    return { search, calls };
}

test('detail song search closes the lyrics view and uses the shared query and source', async () => {
    const { search, calls } = setup();
    await search('song');
    assert.deepEqual(calls, [['close'], ['search', 'A Song', 'tx']]);
});

test('detail artist search uses plain safe labels, supports multiple artists and keeps source', async () => {
    const { search, calls } = setup({
        song: { name: 'Song', singer: 'A / <B>', source: 'wy' },
        picker: () => '<B>',
    });
    await search('artist');
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['pick', ['A', '&lt;B>']], ['close'], ['search', '<B>', 'wy']]);
});

test('artist cancellation, a stale choice and an absent track do not navigate', async () => {
    for (const fixture of [
        setup({ picker: () => null }),
        setup({ picker: (_, ctx) => { ctx.currentPlayingSong = { name: 'Next' }; return 'First'; } }),
        setup({ picker: (_, ctx) => { ctx.isLyricViewOpen = false; return 'First'; } }),
        setup({ song: null }),
        setup({ open: false }),
    ]) {
        await fixture.search('artist');
        assert.ok(fixture.calls.every(([verb]) => verb === 'pick'));
    }
});

test('an artist picker cannot navigate after playback returns to the same song object', async () => {
    const { search, calls } = setup({
        picker: async (_, ctx) => {
            const original = ctx.currentPlayingSong;
            ctx.currentPlayingSong = { name: 'Other Song' };
            ctx.loadingRequestCounter++;
            await Promise.resolve();
            ctx.currentPlayingSong = original;
            ctx.loadingRequestCounter++;
            return 'First';
        },
    });
    await search('artist');
    assert.deepEqual(calls.map(([verb]) => verb), ['pick']);
});

test('single-artist and invalid actions never open an unnecessary picker', async () => {
    const { search, calls } = setup({ song: { name: 'Song', singer: 'Solo', source: 'kw' } });
    await search('invalid');
    assert.deepEqual(calls, []);
    await search('artist');
    assert.deepEqual(calls, [['close'], ['search', 'Solo', 'kw']]);
});

test('Space preserves focused control activation and remains a shortcut outside controls', () => {
    const start = app.indexOf("// 注册全局键盘监听");
    assert.ok(start >= 0, 'global keyboard shortcut handler');
    const source = app.slice(start, app.indexOf("\ndocument.addEventListener('keyup'", start));
    const calls = [];
    let keydown;
    runInNewContext(source, {
        settings: { enableKeyboardShortcuts: true },
        document: { addEventListener(name, listener) { if (name === 'keydown') keydown = listener; } },
        togglePlay() { calls.push('toggle-play'); },
    });
    const press = (tagName, matches, defaultPrevented = false) => keydown({
        code: 'Space', defaultPrevented, target: {
            tagName,
            closest(selector) {
                return selector.split(',').some(value => matches.includes(value.trim())) ? this : null;
            },
        },
        preventDefault() { calls.push('prevent-default'); },
    });
    press('BUTTON', ['button']); // opening/collapse/search buttons
    press('I', ['button']); // a descendant of a focused button
    press('SUMMARY', ['summary']);
    press('SPAN', ['[role="button"]']);
    press('DIV', [], true);
    assert.deepEqual(calls, []);
    press('BODY', []);
    assert.deepEqual(calls, ['prevent-default', 'toggle-play']);
});

test('lyrics history is marked so underlying navigation does not undo a detail search', () => {
    const start = app.indexOf("window.addEventListener('popstate', (e) => {", app.indexOf('function toggleLyrics('));
    const source = app.slice(start, app.indexOf('\nfunction updateDetailInfo(', start));
    for (const [open, closing] of [[true, false], [false, true], [false, false]]) {
        let listener;
        const ctx = {
            isLyricViewOpen: open, lyricHistoryClosing: closing,
            window: { addEventListener(_name, fn) { listener = fn; } },
            document: { getElementById() { return null; } },
            toggleLyrics(fromHistory) { assert.equal(fromHistory, true); },
        };
        runInNewContext(source, ctx);
        const event = {};
        listener(event);
        assert.equal(event.playerDetailHandled === true, open || closing);
        if (open || closing) assert.equal(ctx.lyricHistoryClosing, false);
    }
    const lifecycle = readFileSync(join(root, 'js/ui/ui_accessibility.js'), 'utf8');
    assert.match(lifecycle, /if \(event\.(?:searchDetailHandled \|\| event\.)?playerDetailHandled\) return;/);
});
