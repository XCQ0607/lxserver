// Native DOM smoke of the actual public queue markup and player handlers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(process.argv[2] || 'public/music');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
    const at = app.indexOf('function ' + name + '(');
    assert.ok(at >= 0, name);
    return app.slice(app.slice(at - 6, at) === 'async ' ? at - 6 : at, app.indexOf('\n}', at) + 2);
};
const section = (start, end) => {
    const i = app.indexOf(start);
    const j = app.indexOf(end, i + 1);
    assert.ok(i >= 0 && j > i, start);
    return app.slice(i, j);
};
const helpers = [
    ...['toggleQueueDrawer', 'renderQueue', 'scrollToCurrentSongInQueue', 'scrollToSongInQueue',
        'setSearchRadioArmed', 'getNextIndex', 'playNextInQueue', 'playNext'].map(extract),
    section('let pendingExplicitRadio', 'function isSearchRadioDue('),
    section('let searchRadioEpoch', '// The radio mode belongs'),
    section('const SEARCH_RADIO_TIMEOUT_MS', '// 队列将尽时'),
].join('\n');
const template = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://fixture').pathname;
    if (pathname === '/music/') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(template);
    }
    const file = path.resolve(root, pathname.replace(/^\/music\//, ''));
    if (!file.startsWith(root + '/') || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
        res.writeHead(404);
        return res.end();
    }
    const mime = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    fs.createReadStream(file).pipe(res);
});
const fixture = `
    const song = (id, flags = {}) => ({id, source: 'wy', name: id, singer: 'Fixture', ...flags});
    const API_BASE = '/api/music';
    const settings = {}, audio = {paused: true};
    let searchRadioCache = null, searchRadioArmed = false;
    let currentPlayingScope = 'local_list', currentLoadingSongId = null, loadingRequestCounter = 0, preSelectedNextIndex = null;
    let currentPlaylist = [song('recent'), song('manual-next', {_playNextRequested: true}),
        song('stale-station', {_explicitRadio: true}), song('ordinary-queue')];
    let currentIndex = 0, playMode = 'single';
    const played = [];
    const getUserAuthHeaders = () => ({}), cleanSongData = track => track;
    const getThumbnailUrl = () => './assets/logo.svg';
    const getSourceTag = () => '', getQualityTags = () => '', applyMarqueeChecks = () => {};
    const createMarqueeHtml = (text, cls) => '<div class="' + cls + '">' + text + '</div>';
    const savedQueue = [];
    const showInfo = () => {}, savePlaybackState = () => { savedQueue.push(currentPlaylist.map(t => t.id)); };
    const createSongMoreMenu = () => document.createElement('span');
    const toggleSidebar = () => {};
    const playSong = (track, index) => { currentIndex = index; loadingRequestCounter++; played.push(track.id); return new Promise(() => {}); };
    ${helpers}
    window.toggleQueueDrawer = toggleQueueDrawer;
    window.scrollToCurrentSongInQueue = scrollToCurrentSongInQueue;
    window.fixture = {
        current: () => currentPlaylist[currentIndex]?.id,
        upcoming: () => currentPlaylist.slice(currentIndex + 1).map(t => t.id),
        next: () => currentPlaylist[getNextIndex()]?.id,
        lastSaved: () => savedQueue.at(-1),
        advance: () => { playNextInQueue(); return played.at(-1); },
    };
    const starter = Object.assign(document.createElement('button'), {id: 'fixture-radio', textContent: 'Start Radio'});
    starter.style.cssText = 'position:fixed;top:4px;left:4px;z-index:9999';
    starter.onclick = () => { window.pendingRadioFixture = startSearchRadio(song('seed')); };
    document.body.append(starter);
`;
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let cases = 0, bufferedRefills = 0;
    for (const launcher of [chromium, webkit]) {
        const browser = await launcher.launch();
        try {
            for (const [width, height, touch] of [[320, 700, true], [1440, 900, false]]) {
                for (const drawerMode of ['closed', 'open', 'dismiss']) {
                    const context = await browser.newContext({ viewport: {width, height}, isMobile: touch, hasTouch: touch });
                    const page = await context.newPage();
                    const errors = [];
                    const requests = [];
                    page.on('pageerror', e => errors.push(e.message));
                    await page.route('**/api/music/similar?**', async route => {
                        const query = Object.fromEntries(new URL(route.request().url()).searchParams);
                        const request = { query };
                        requests.push(request);
                        const list = await new Promise(resolve => { request.resolve = resolve; });
                        await route.fulfill({ json: { strategy: 'radio', list } });
                    });
                    await page.goto('http://127.0.0.1:' + server.address().port + '/music/');
                    await page.addScriptTag({ content: fixture });
                    await page.addScriptTag({ path: path.join(root, 'js/ui/ui_accessibility.js') });
                    await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
                    const drawer = page.locator('#queue-drawer');
                    const closed = async () => (await drawer.getAttribute('class')).split(' ').includes('translate-x-full');
                    const rows = page.locator('#queue-list > div');
                    const status = page.locator('#queue-radio-status');
                    assert.equal(await status.count(), 1, 'drawer has a dedicated live recommendation status');
                    assert.equal(await status.getAttribute('role'), 'status');
                    assert.equal(await status.evaluate(el => !!el.closest('#queue-list')), false);
                    async function waitRequest(count) {
                        const deadline = Date.now() + 6000;
                        while (requests.length < count && Date.now() < deadline) {
                            await new Promise(resolve => setTimeout(resolve, 20));
                        }
                        assert.equal(requests.length, count, 'one request at a time');
                    }
                    const related = (index, source='tx') => ({ id: source + '_' + index, source,
                        name: 'related-' + index, singer: 'Fixture', interval: '3:00' });
                    if (drawerMode !== 'closed') {
                        await page.evaluate(() => {
                            // An open mobile drawer is modal. Start from its own
                            // song-action area, not from its inert background.
                            const starter = document.getElementById('fixture-radio');
                            document.getElementById('queue-drawer').append(starter);
                            starter.style.cssText = 'position:absolute;top:112px;left:8px;z-index:99';
                            window.toggleQueueDrawer();
                        });
                    }
                    const start = page.locator('#fixture-radio');
                    if (touch) await start.tap(); else await start.click();
                    await waitRequest(1);
                    assert.equal(await closed(), drawerMode === 'closed', 'Start Radio never changes drawer visibility');
                    assert.equal(requests[0].query.target, '24');
                    assert.equal(requests[0].query.limit, '48');
                    assert.match(await status.textContent(), /正在加载电台推荐/);
                    assert.deepEqual(await page.evaluate(() => window.fixture.upcoming()), ['manual-next', 'ordinary-queue']);
                    if (drawerMode==='dismiss') {
                        const close = drawer.locator('button[title="关闭"]');
                        if (touch) await close.tap(); else await close.click();
                    }
                    requests[0].resolve([1,2,3,4,5,6,7].map(i => related(i)));
                    await waitRequest(2);
                    assert.match(requests[1].query.name, /^related-[1-7]$/);
                    const firstBatch = Array.from({length:7},(_,i)=>'tx_'+(i+1));
                    assert.deepEqual(await page.evaluate(() => window.fixture.upcoming()), ['manual-next', ...firstBatch, 'ordinary-queue']);
                    if (drawerMode !== 'open') assert.equal(await rows.count(), 0, 'closed queue need not render hidden rows');
                    else assert.match(await rows.nth(3).textContent(), /related-1(?!\d)/);
                    requests[1].resolve([related(1,'kw'), ...Array.from({length:30},(_,i)=>related(i+8))]);
                    await page.waitForFunction(() => window.fixture.upcoming().length === 26);
                    assert.match(await status.textContent(), /24 \/ 24/);
                    const expected = ['manual-next', ...Array.from({length:24},(_,i)=>'tx_'+(i+1)), 'ordinary-queue'];
                    assert.deepEqual(await page.evaluate(() => window.fixture.upcoming()), expected);
                    assert.deepEqual(await page.evaluate(() => window.fixture.lastSaved()?.slice(2)), expected);
                    assert.equal(await closed(), drawerMode !== 'open', 'recommendation completion never opens a closed drawer');
                    if (drawerMode !== 'open') await page.evaluate(() => window.toggleQueueDrawer());
                    const published = await rows.allTextContents();
                    assert.equal(published.length, 28, 'real rows only, including history, seed, pin and ordinary track');
                    assert.match(published[2], /manual-next/);
                    assert.match(published[3], /related-1(?!\d)/);
                    assert.match(published[26], /related-24/);
                    assert.match(published[27], /ordinary-queue/);
                    assert.equal(await page.evaluate(() => window.fixture.next()), 'manual-next');
                    assert.equal(await page.evaluate(() => window.fixture.advance()), 'manual-next');
                    assert.equal(await page.evaluate(() => window.fixture.next()), 'tx_1');
                    assert.equal(requests.length, 2, 'reaching the floor does not issue a third request');
                    if (!touch && drawerMode === 'open') {
                        await drawer.locator('button[title="关闭"]').click();
                        assert.equal(await closed(), true);
                        await page.getByRole('button', { name: '下一首', exact: true }).click();
                        const replenished = [...Array.from({length:24}, (_, i) => 'tx_' + (i + 2)), 'ordinary-queue'];
                        assert.equal(await page.evaluate(() => window.fixture.current()), 'tx_1');
                        assert.deepEqual(await page.evaluate(() => window.fixture.upcoming()), replenished,
                            'advancing uses the first buffered recommendation before querying again');
                        assert.equal(requests.length, 2, 'buffered refill does not use the network');
                        assert.equal(await closed(), true, 'advancing does not reopen the drawer');
                        await page.locator('button[title="当前播放队列"]').click();
                        assert.match(await status.textContent(), /24 \/ 24/);
                        assert.match(await rows.nth(3).textContent(), /related-1(?!\d)/);
                        assert.match(await rows.nth(27).textContent(), /related-25/);
                        bufferedRefills++;
                    }
                    assert.deepEqual(errors, []);
                    await context.close();
                    cases++;
                }
            }
        } finally { await browser.close(); }
    }
    console.log(`PASS ${cases} native Start Radio queue cases (Chromium/WebKit, desktop/mobile, 24 exact and drawer visibility; ${bufferedRefills} buffered refill checks)`);
})().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => server.close());
