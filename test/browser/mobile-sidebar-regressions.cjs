// Optional native-browser regression runner: PLAYWRIGHT_MODULE may point to an installed playwright package.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(process.argv[2] || 'public/music');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = (name, source = app, indent = '') => {
    const i = source.indexOf(indent + 'function ' + name + '(');
    assert.ok(i >= 0, name);
    return source.slice(i, source.indexOf('\n' + indent + '}', i) + indent.length + 2);
};
const sidebar = app.slice(app.indexOf('function toggleSidebar()'), app.indexOf('// 切换详情页封面显示'));
const server = http.createServer((req, res) => {
    const rel = new URL(req.url, 'http://fixture').pathname.replace(/^\/music\//, '');
    if (!rel) { res.setHeader('Content-Type', 'text/html;charset=utf-8'); return res.end(fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')); }
    const f = path.resolve(root, rel);
    if (!f.startsWith(root + '/') || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', ({ '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' })[path.extname(f)] || 'application/octet-stream');
    fs.createReadStream(f).pipe(res);
});
async function setup(page, collapsed) {
    await page.goto('http://127.0.0.1:' + server.address().port + '/music/');
    await page.evaluate(collapsed => {
        localStorage.setItem('desktop_sidebar_collapsed', String(collapsed));
        window.settings = { itemsPerPage: 20 }; window.radioSeeds = []; window.ordinaryPlays = [];
        window.SearchRequests = { cancel() {} }; window.setSearchStatus = () => {};
        const opener = [...document.querySelectorAll('button[onclick="toggleSidebar()"]')].find(el => !el.closest('#main-sidebar')); opener.id = 'test-nav-open';
        window.ListSearch = { state: {}, init() {}, resetState() {}, getDisplayList: xs => xs.map((item, originalIndex) => ({ item, originalIndex })), isMatched: () => false, isCurrentMatch: () => false };
        window.selectedItems = new Set(); window.isUserLoggedIn = () => false;
        window.renderNetworkSearchFooter = window.updatePaginationInfo = window.lazyLoadImages = window.applyMarqueeChecks = () => {};
        window.getThumbnailUrl = window.getImgUrl = () => '/music/assets/logo.svg';
        window.getSongAlbumName = window.getSourceTag = window.getSourceTags = window.getSourceStack = window.getQualityTags = () => '';
        window.escapeHtmlText = window.createMarqueeHtml = String;
        window.startSearchRadio = song => window.radioSeeds.push(song);
        window.playFromView = index => window.ordinaryPlays.push(index);
        window.updatePlaylist = (songs, index) => window.ordinaryPlays.push(songs[index]);
        window.getUserAuthHeaders = () => ({}); window.enqueueSong = () => {};
        window.currentPage = 1; window.currentSearchScope = 'network';
        window.currentPlaylist = []; window.currentIndex = 0;
        window.playSongFromQueue = index => window.ordinaryPlays.push(index);
    }, collapsed);
    await page.addScriptTag({ content: sidebar });
    await page.addScriptTag({ path: path.join(root, 'js/ui/ui_accessibility.js') });
    await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
}
async function radio(page, host, expected, touch) {
    const row = page.locator(host).first();
    const menu = row.locator('details.song-more-menu');
    await row.scrollIntoViewIfNeeded();
    if (touch) await menu.locator('summary').tap(); else await menu.locator('summary').click();
    const button = menu.locator('[data-start-radio]');
    await button.waitFor({ state: 'visible' });
    const before = await page.evaluate(() => window.ordinaryPlays.length);
    if (touch) await button.tap(); else await button.click();
    assert.equal(await page.evaluate(() => window.radioSeeds.at(-1)?.name), expected);
    assert.equal(await page.evaluate(() => window.ordinaryPlays.length), before, 'radio click must not trigger ordinary row Play');
    assert.equal(await menu.evaluate(el => el.open), false);
}
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let navigationCases = 0, songSurfaces = 0;
    for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
        const browser = await launcher.launch();
        try {
            for (const [width, height] of (process.env.SKIP_NAV ? [] : [[320, 568], [390, 844], [768, 620], [844, 390], [951, 584], [1024, 650]])) {
                for (const collapsed of [false, true]) {
                    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
                    const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
                    await setup(page, collapsed);
                    for (let cycle = 0; cycle < 3; cycle++) {
                        await page.locator('#test-nav-open').tap(); await page.waitForTimeout(330);
                        assert.equal(await page.locator('#main-sidebar').evaluate(el => el.inert), false);
                        assert.equal(Math.round((await page.locator('#main-sidebar').boundingBox()).width), 288, 'saved desktop collapse must not hide a mobile menu');
                        assert.equal(await page.locator('#mobile-sidebar-backdrop').evaluate(el => el.inert), false);
                        if (cycle === 0) await page.touchscreen.tap(width - 8, 180);
                        else if (cycle === 1) await page.locator('#main-sidebar button[onclick="toggleSidebar()"]' ).tap();
                        else await page.keyboard.press('Escape');
                        await page.waitForTimeout(330);
                        assert.equal(await page.locator('#main-sidebar').evaluate(el => el.classList.contains('-translate-x-full')), true);
                        assert.equal(await page.locator('#search-input').evaluate(el => !!el.closest('[inert]')), false);
                    }
                    // Return to desktop, then mobile; preserve preference without stale modal isolation.
                    await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(330);
                    assert.equal(await page.locator('#main-sidebar').evaluate(el => el.classList.contains('desktop-collapsed')), collapsed);
                    assert.equal(await page.locator('#search-input').evaluate(el => !!el.closest('[inert]')), false);
                    await page.setViewportSize({ width, height }); await page.waitForTimeout(330);
                    await page.locator('#test-nav-open').tap(); await page.waitForTimeout(330);
                    assert.equal(Math.round((await page.locator('#main-sidebar').boundingBox()).width), 288);
                    await page.touchscreen.tap(width - 8, 180); await page.waitForTimeout(330);
                    assert.deepEqual(errors, []); navigationCases++; await context.close();
                }
            }
        } finally { await browser.close(); }
    }
    console.log(`PASS ${navigationCases} navigation cases (four open/close paths and desktop/mobile round trip each), ${songSurfaces} song-menu surface cases`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
