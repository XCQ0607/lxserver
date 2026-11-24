// Optional native browser test: npm package playwright or PLAYWRIGHT_MODULE.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(process.argv[2] || 'public/music');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const start = app.indexOf('function attachSongRowPopover(');
const end = app.indexOf('window.createSongAddMenu = createSongAddMenu;', start);
assert.ok(start >= 0 && end > start);
const menu = app.slice(start, end + 'window.createSongAddMenu = createSongAddMenu;'.length);
const server = http.createServer((req, res) => {
    const rel = new URL(req.url, 'http://fixture').pathname.slice('/music/'.length);
    if (!rel) {
        res.setHeader('Content-Type', 'text/html;charset=utf-8');
        return res.end(fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
    }
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + '/') || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.statusCode = 404;
        return res.end();
    }
    res.setHeader('Content-Type', ({ '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
});

async function runPage(page, width, label) {
    await page.goto('http://127.0.0.1:' + server.address().port + '/music/');
    await page.evaluate(() => {
        window.actions = [];
        window.settings = { itemsPerPage: 20 };
        window.updatePlaylist = (_songs, i) => window.actions.push(['play', i]);
        window.downloadSong = song => window.actions.push(['download', song.id]);
        window.enqueueSong = song => window.actions.push(['queue', song.id]);
        window.openPlaylistAddModalForSongObject = song => window.actions.push(['playlist', song.id]);
        window.fetch = async () => ({ json: async () => ({ list: [
            { id: 'lead-one', name: 'Fixture leaderboard song title', singer: 'Fixture singer', source: 'wy', interval: '03:30' },
        ] }) });
        for (const el of document.querySelectorAll('#main-views > [id^="view-"]')) el.classList.add('hidden');
        const view = document.getElementById('view-leaderboard');
        view.classList.remove('hidden', 'opacity-0');
    });
    await page.addScriptTag({ content: menu });
    await page.addScriptTag({ path: path.join(root, 'js/library/leaderboard_manager.js') });
    await page.evaluate(() => window.LeaderboardManager.selectBoard('fixture', 'Fixture chart'));
    const row = page.locator('#lb-row-0');
    const summary = row.locator('details.song-add-menu > summary');
    await summary.waitFor({ state: 'visible' });
    const geometry = await row.evaluate(el => {
        const group = el.querySelector('.song-row-actions');
        const actions = [...group.querySelectorAll(':scope > button, :scope > details > summary')];
        const rect = el.getBoundingClientRect();
        return {
            row: { x: rect.left, right: rect.right },
            track: el.children[1].getBoundingClientRect().toJSON(),
            targets: actions.map(action => action.getBoundingClientRect().toJSON()),
        };
    });
    if (width < 640) {
        assert.equal(geometry.targets.length, 5, label);
        const add = geometry.targets[2];
        assert.ok(add.width >= 44 && add.height >= 44, label + ' Add tap area: ' + add.width + '×' + add.height);
        for (let j = 0; j < geometry.targets.length; j++) {
            const box = geometry.targets[j];
            assert.ok(box.width >= 44 && box.height >= 44, label + ' mobile touch target ' + j);
            assert.ok(box.x >= geometry.row.x && box.right <= geometry.row.right, label + ' stays inside leaderboard row');
            assert.ok(box.y >= geometry.track.bottom, label + ' stays below artwork and title');
            if (j) assert.ok(box.x - geometry.targets[j - 1].right >= 4, label + ' target separation');
        }
        assert.ok(geometry.track.width >= 200, label + ' narrow leaderboard title keeps usable width');
        const box = await summary.boundingBox();
        // A native tap near the add button edge must not play or download the row.
        await page.touchscreen.tap(box.x + 4, box.y + box.height / 2);
        const queue = row.locator('[data-song-add-queue]');
        await queue.tap();
        assert.deepEqual(await page.evaluate(() => window.actions), [['queue', 'lead-one']], label);
        await summary.tap();
        await row.locator('[data-song-add-playlist]').tap();
        assert.deepEqual(await page.evaluate(() => window.actions), [['queue', 'lead-one'], ['playlist', 'lead-one']], label);
    } else {
        assert.ok(geometry.targets[2].width < 44, label + ' desktop/tablet control density unchanged');
        assert.ok(geometry.targets[2].top < geometry.track.bottom, label + ' desktop/tablet retains a single row');
    }
}

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let cases = 0;
    for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
        const browser = await launcher.launch();
        try {
            for (const width of [320, 375, 390, 639, 640, 844, 1440]) {
                const context = await browser.newContext({ viewport: { width, height: 768 }, isMobile: width < 1025, hasTouch: width < 1025 });
                try { await runPage(await context.newPage(), width, engine + ' ' + width); cases++; }
                finally { await context.close(); }
            }
        } finally { await browser.close(); }
    }
    console.log('PASS ' + cases + ' leaderboard touch target and menu cases');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
