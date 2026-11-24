const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const postcss = require('postcss');

const css = postcss.parse(fs.readFileSync('public/music/css/app.css', 'utf8'));

function compactMedia() {
    const matches = [];
    css.walkAtRules('media', media => {
        let grid = false;
        media.walkRules(rule => {
            if (rule.selector !== '#player-footer') return;
            rule.walkDecls('display', decl => { if (decl.value === 'grid') grid = true; });
        });
        if (grid) matches.push(media);
    });
    assert.equal(matches.length, 1, 'one scoped compact landscape player layout');
    return matches[0];
}

test('compact player is limited to wide, short, coarse-pointer landscape viewports', () => {
    const media = compactMedia();
    for (const condition of ['min-width: 640px', 'max-width: 1024px', 'max-height: 650px', 'orientation: landscape', 'pointer: coarse']) {
        assert.ok(media.params.includes(condition), `missing ${condition}`);
    }
});

test('landscape metadata and transport share columns without hiding controls or the visualizer', () => {
    const media = compactMedia();
    const declarations = (selector, property) => {
        const values = [];
        media.walkRules(rule => { if (rule.selector === selector) rule.walkDecls(property, d => values.push(d.value)); });
        return values;
    };
    assert.deepEqual(declarations('#player-footer', 'grid-template-columns'), ['minmax(0, 1fr) minmax(0, 1.25fr)']);
    assert.deepEqual(declarations('#player-mobile-actions', 'grid-column'), ['1 / -1']);
    assert.deepEqual(declarations('#player-transport', 'min-width'), ['0']);
    media.walkDecls('display', d => assert.notEqual(d.value, 'none', 'do not reclaim height by removing player capabilities'));
    media.walkDecls('height', d => assert.notEqual(d.value, '0', 'do not clip a player surface'));
});

test('compact layout retains an automatic footer height measured by the existing observer', () => {
    const media = compactMedia();
    media.walkDecls('height', d => assert.equal(d.value, '44px', 'only the cover hit target may have a fixed compact height'));
    const source = fs.readFileSync('public/music/js/ui/ui_accessibility.js', 'utf8');
    assert.match(source, /Math\.ceil\(footer\.getBoundingClientRect\(\)\.height\)/);
    assert.match(source, /new ResizeObserver\(scheduleMeasure\)\.observe\(footer\)/);
});

// Inspect the real capability-scoped rules as well as the renderer opacity tests.
test('touch capability, not viewport width, makes song actions discoverable', () => {
    const media = css.nodes.find(node => node.type === 'atrule' && node.name === 'media' && node.params === '(hover: none), (pointer: coarse)');
    assert.ok(media, 'include both hoverless and coarse-pointer devices');
    const selectors = new Set();
    media.walkRules(rule => {
        rule.walkDecls('opacity', declaration => {
            if (declaration.value === '1') rule.selectors.forEach(selector => selectors.add(selector));
        });
    });
    assert.ok(selectors.has('#search-results .song-row-actions'));
    assert.ok(selectors.has('#lb-songs-list .song-row-actions'));
    assert.doesNotMatch(media.params, /(?:min|max)-width/, 'unfolded touch screens also need actions');
});
