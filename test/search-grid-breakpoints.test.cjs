const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const postcss = require('postcss');

const app = postcss.parse(fs.readFileSync('public/music/css/app.css', 'utf8'));
const utilities = postcss.parse(fs.readFileSync('public/music/css/utilities.css', 'utf8'));

function widthLimit(rule, kind) {
    for (let parent = rule.parent; parent; parent = parent.parent) {
        if (parent.type !== 'atrule' || parent.name !== 'media') continue;
        const operator = kind === 'min' ? '>=' : '<=';
        const pattern = new RegExp(`(?:${kind}-width\\s*:\\s*|width\\s*${operator}\\s*)([\\d.]+)(px|rem)`);
        const match = parent.params.match(pattern);
        if (match) return Number(match[1]) * (match[2] === 'rem' ? 16 : 1);
    }
    return undefined;
}

function layoutBreakpoints() {
    const compact = [];
    app.walkRules(rule => {
        if (!rule.selector.includes('#search-results > .grid.grid-cols-12:has([data-rating-badges])')) return;
        rule.walkDecls('grid-template-columns', declaration => {
            if (declaration.value === '18px minmax(0, 1fr) auto') compact.push(widthLimit(rule, 'max'));
        });
    });
    const artists = [];
    utilities.walkRules(rule => {
        if (rule.selector !== '.sm\\:flex') return;
        rule.walkDecls('display', declaration => {
            if (declaration.value === 'flex') artists.push(widthLimit(rule, 'min'));
        });
    });
    assert.equal(compact.length, 1, 'exactly one three-cell search layout');
    assert.ok(artists.length > 0, 'read the actual generated artist visibility breakpoint');
    assert.ok(artists.every(value => value === artists[0]));
    return { compactMax: compact[0], artistMin: artists[0] };
}

test('three-cell search layout ends before the separate artist cell becomes visible', () => {
    const { compactMax, artistMin } = layoutBreakpoints();
    assert.ok(compactMax < artistMin, `${compactMax}px compact layout overlaps the ${artistMin}px artist column`);
});

test('Duo portrait and responsive boundaries never put four visible cells into three columns', () => {
    const { compactMax, artistMin } = layoutBreakpoints();
    for (const width of [382, 594, 639, 640, 669, 767, 768, 951, 1440]) {
        const visibleCells = width >= artistMin ? 4 : 3;
        if (width <= compactMax) assert.ok(visibleCells <= 3, `${width}px: actions would wrap to a second row`);
    }
});
