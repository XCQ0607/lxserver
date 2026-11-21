const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const html = readFileSync('public/music/index.html', 'utf8');
const css = readFileSync('public/music/css/app.css', 'utf8');
const manager = readFileSync('public/music/js/library/songlist_manager.js', 'utf8');

test('the mobile song list has one scroller around the description and tracks', () => {
    assert.match(html, /id="sl-detail-scroll"[\s\S]+id="sl-detail-header"[\s\S]+id="sl-detail-track-section"[\s\S]+id="sl-detail-list"/);
    assert.match(css, /#sl-detail-scroll\s*\{[^}]*overflow-y:\s*auto/);
    assert.match(css, /#sl-detail-track-section,\s*#sl-detail-list\s*\{[^}]*overflow:\s*visible/);
    assert.match(css, /#songlist-detail-view\s*\{\s*padding-bottom:\s*var\(--player-footer-inset/);
    const start = manager.indexOf('function getSongListDetailScroller()');
    assert.ok(start >= 0);
    const script = manager.slice(start, manager.indexOf('\n}', start) + 2);
    for (const [matches, id] of [[true, 'sl-detail-scroll'], [false, 'sl-detail-list']]) {
        assert.equal(runInNewContext(script + '\ngetSongListDetailScroller()', {
            window: { matchMedia: () => ({ matches }) },
            document: { getElementById: key => key },
        }), id);
    }
});

test('the expanded transport provides desktop-size Play and full-width adjacent tap targets', () => {
    assert.match(css, /#player-footer #player-controls #btn-play\s*\{[^}]*width:\s*48px;\s*height:\s*48px/);
    assert.match(css, /#player-footer #player-controls button:is\(\[onclick="playPrev\(\)"\], \[onclick="playNext\(\)"\]\)\s*\{[^}]*width:\s*44px/);
});

test('narrow wireless transport reserves a second row for the secondary controls', () => {
    assert.match(html, /class="player-secondary-controls flex items-center justify-end/);
    assert.match(css, /@media \(max-width: 375px\)\s*\{\s*#player-footer #player-controls:has\(#btn-airplay:not\(\[hidden\]\), #btn-cast:not\(\[hidden\]\)\) > \.player-secondary-controls\s*\{[^}]*grid-row:\s*2/);
});

test('mobile description expansion does not impose a fixed header cap', () => {
    assert.match(css, /#sl-detail-header:not\(\.sl-hero-collapsed\)\s*\{[^}]*max-height:\s*none/);
    const start = manager.indexOf('function expandSongListDetailHeader()');
    const expand = manager.slice(start, manager.indexOf('\n}', start) + 2);
    assert.match(expand, /header\.style\.maxHeight = ''/);
    assert.doesNotMatch(expand, /1000px/);
});
