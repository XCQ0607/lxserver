const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const app = fs.readFileSync('public/music/app.js', 'utf8');
const fn = name => {
    const mark = app.indexOf('function ' + name + '(');
    assert.ok(mark >= 0, name);
    const start = app.slice(mark - 6, mark) === 'async ' ? mark - 6 : mark;
    return app.slice(start, app.indexOf('\n}', mark) + 2);
};
const song = (id, flags = {}) => ({ id, songmid: id, name: id, source: 'wy', ...flags });
const constants = app.match(/^const SONG_RADIO_.+;$/gm).join('\n');

function fixture(overrides = {}) {
    const prior = song('playing'), playNext = song('pinned', { _searchRadio: true, _playNextRequested: true }), manual = song('manual');
    let now = 100000;
    const c = vm.createContext({
        document: { getElementById(id) { return id === 'queue-radio-status' ? c.statusNode : null; } },
        statusNode: { textContent: '' }, drawerOpen: false, opens: 0, drawnTracks: [], scrolls: [],
        window: {}, settings: { autoPlaySimilarAfterSearch: false, switchPlaylistOnSearchPlay: false },
        searchRadioSongs: new WeakSet(),
        audio: { paused: true, addEventListener(name, callback) { c[name] = callback; } },
        shouldAutoRecoverPlayback: true, console: { log() {} },
        currentPlaylist: [prior, playNext, manual], currentIndex: 0, currentPlayingSong: prior,
        currentPlayingScope: 'network', searchRadioEpoch: 0, loadingRequestCounter: 0,
        pendingExplicitRadio: null, songRadioSession: null,
        currentLoadingSongId: null, searchRadioArmed: true, playMode: 'single', preSelectedNextIndex: 2,
        cleanSongData: track => ({ id: track.source + '_' + track.id }),
        setTimeout, clearTimeout, AbortController, Date: { now: () => now },
        advanceClock(ms) { now += ms; },
        playSong(...args) { c.currentIndex = args[1]; c.currentPlayingSong = args[0]; c.loadingRequestCounter++; c.plays.push(args); },
        loadSearchRadioSongs(seed, options) {
            return new Promise(resolve => {
                c.resolveLookup = (list, strategy, incomplete) => resolve({ list, strategy, incomplete });
                c.lookups.push(seed);
                c.lookupOptions.push(options);
            });
        },
        setSearchRadioArmed(value) { c.searchRadioArmed = value; },
        toggleQueueDrawer() { c.drawerOpen = !c.drawerOpen; c.opens++; c.renderQueue(); },
        scrollToCurrentSongInQueue(flash, block) { c.scrolls.push([flash, block]); },
        renderQueue() { c.renders++; c.updateSongRadioCount(); c.drawnTracks = c.drawerOpen ? ids(c) : []; },
        savePlaybackState() { c.saves++; },
        showInfo(message) { c.messages.push(message); },
        prefetchNextSong() { c.prefetches++; },
        plays: [], lookups: [], lookupOptions: [], messages: [], saves: 0, renders: 0, prefetches: 0,
        ...overrides,
    });
    const helpers = ['setQueueRadioStatus', 'startSearchRadio', 'cancelSearchRadioContinuation', 'pickSearchRadioSongs', 'getNextIndex',
        'keepAsNextSong', 'playNext', 'playNextInQueue', 'isSearchRadioDue',
        'isSongRadioActive', 'radioSongsRemaining', 'pruneSongRadioHistory', 'replenishSongRadio', 'advanceSongRadio',
        'stationRecordingKey', 'updateSongRadioCount', 'stationSeedKey', 'storeStationSeedResult', 'pickStationRadioSongs', 'commitStationRadioSongs'];
    for (const name of ['isExplicitRadioCurrent', 'playAfterNaturalEnd', 'describeEmptyExplicitRadio']) {
        if (app.includes('function ' + name + '(')) helpers.push(name);
    }
    const endedHandler = app.match(/audio\.addEventListener\('ended', \(\) => \{[\s\S]*?\n\}\);/)[0];
    vm.runInContext(constants + '\n' + helpers.map(fn).join('\n') + '\n' + endedHandler, c);
    return c;
}

const ids = c => Array.from(c.currentPlaylist, track => track.id);

test('explicit radio starts the captured result immediately and keeps pinned/manual queue ordering', async () => {
    const c = fixture();
    const seed = song('seed', { _alternatives: [{ source: 'kw' }] });
    const pending = c.startSearchRadio(seed);
    assert.deepEqual(ids(c), ['playing', 'seed', 'pinned', 'manual']);
    assert.equal(c.plays[0][0], seed);
    assert.equal(c.plays[0][5], false, 'do not mutate default list or switch to it');
    assert.equal(c.lookups[0], seed);
    assert.equal(c.drawerOpen, false, 'Start Radio does not open the queue');
    assert.deepEqual(c.drawnTracks, []);
    assert.equal(c.lookupOptions[0].station, true);
    assert.equal(c.statusNode.textContent, '正在加载电台推荐');
    assert.equal(c.currentPlayingScope, 'search_radio');
    assert.equal(c.searchRadioArmed, false, 'independent of automatic radio');
    const recommendation = song('similar');
    c.resolveLookup([song('seed'), song('manual'), recommendation, song('similar')]);
    await pending;
    assert.deepEqual(ids(c), ['playing', 'seed', 'pinned', 'similar', 'manual']);
    assert.equal(c.currentPlaylist[3]._explicitRadio, true);
    assert.equal(recommendation._explicitRadio, undefined, 'cache not mutated');
    assert.equal(c.getNextIndex(), 2, 'do not repeat the seed over Play Next');
    c.currentIndex = 2;
    assert.equal(c.getNextIndex(), 3, 'play the radio batch sequentially');
    c.currentIndex = 3;
    assert.equal(c.getNextIndex(), 3, 'resume the saved repeat-one mode after the batch');
    assert.equal(c.playMode, 'single');
    assert.equal(c.renders, 2);
    assert.equal(c.statusNode.textContent, '电台待播：1 / 24 首 · 暂无更多推荐');
    assert.deepEqual(c.drawnTracks, []);
    assert.deepEqual(c.scrolls, []);
    assert.equal(c.saves, 1);
});

test('a selection already in the queue is moved once without reordering other tracks', async () => {
    const c = fixture();
    const pending = c.startSearchRadio(song('manual'));
    c.resolveLookup([song('radio')]);
    await pending;
    assert.deepEqual(ids(c), ['playing', 'manual', 'pinned', 'radio']);
});

test('eligibility is recalculated when recommendations arrive, including recent Play Next and dislikes', async () => {
    const c = fixture({ window: { DislikeManager: { isDisliked: track => track.id === 'disliked' } } });
    const pending = c.startSearchRadio(song('seed'));
    const latePin = song('late-pin', { _explicitRadio: true });
    c.keepAsNextSong(latePin);
    c.currentPlaylist.splice(c.currentIndex + 1, 0, latePin);
    c.audio.paused = false;
    c.resolveLookup([song('late-pin'), song('new'), song('disliked')]);
    await pending;
    assert.deepEqual(ids(c), ['playing', 'seed', 'late-pin', 'pinned', 'new', 'manual']);
    assert.equal(c.prefetches, 1);
});

test('empty recommendations leave the seed and remaining queue playable', async () => {
    const c = fixture();
    const pending = c.startSearchRadio(song('seed'));
    c.resolveLookup([]);
    await pending;
    assert.deepEqual(ids(c), ['playing', 'seed', 'pinned', 'manual']);
    assert.equal(c.plays.length, 1);
    assert.equal(c.saves, 0);
    assert.equal(c.statusNode.textContent, '暂未找到可播放的相似歌曲');
    assert.equal(c.messages.at(-1), '暂未找到可播放的相似歌曲');
});

for (const change of ['stop', 'new song', 'exit radio', 'remove seed']) {
    test('pending radio results cannot change the queue after ' + change, async () => {
        const c = fixture();
        const pending = c.startSearchRadio(song('seed'));
        if (change === 'stop') {
            c.cancelSearchRadioContinuation();
            assert.equal(c.statusNode.textContent, '', 'pause clears the pending UI immediately');
        }
        if (change === 'new song') c.loadingRequestCounter++;
        if (change === 'exit radio') c.currentPlayingScope = 'local_list';
        if (change === 'remove seed') c.currentPlaylist.splice(c.currentIndex, 1);
        const before = ids(c);
        c.resolveLookup([song('late')]);
        await pending;
        assert.deepEqual(ids(c), before);
        assert.equal(c.statusNode.textContent, '');
        assert.equal(c.saves, 0);
    });
}

test('starting another radio drops a late response from the first seed', async () => {
    const c = fixture();
    const first = c.startSearchRadio(song('first'));
    const finishFirst = c.resolveLookup;
    const second = c.startSearchRadio(song('second'));
    c.resolveLookup([song('new')]);
    await second;
    finishFirst([song('stale')]);
    await first;
    assert.deepEqual(ids(c), ['playing', 'first', 'second', 'pinned', 'new', 'manual']);
});

test('a naturally ended short seed waits for and advances to delayed recommendations', async () => {
    const c = fixture({ currentPlaylist: [song('previous'), song('manual')], playMode: 'order' });
    const pending = c.startSearchRadio(song('seed'));
    c.ended();
    c.ended();
    assert.equal(c.plays.length, 1, 'do not start an ordinary queued song while waiting');
    c.resolveLookup([song('similar')]);
    await pending;
    assert.deepEqual(c.plays.map(x => x[0].id), ['seed', 'similar']);
    assert.deepEqual(ids(c), ['previous', 'seed', 'similar', 'manual']);
});

test('when nothing returns on natural end, continue the regular queue exactly once', async () => {
    const c = fixture({ currentPlaylist: [song('previous'), song('manual')], playMode: 'order' });
    const pending = c.startSearchRadio(song('seed'));
    c.ended();
    assert.equal(c.plays.length, 1);
    c.resolveLookup([]);
    await pending;
    assert.deepEqual(c.plays.map(x => x[0].id), ['seed', 'manual']);
});

test('a natural Play Next handoff is immediate and retains the pending radio batch', async () => {
    const c = fixture({ playMode: 'order' });
    const pending = c.startSearchRadio(song('seed'));
    c.ended();
    assert.deepEqual(c.plays.map(x => x[0].id), ['seed', 'pinned']);
    c.resolveLookup([song('similar')]);
    await pending;
    assert.deepEqual(ids(c), ['playing', 'seed', 'pinned', 'similar', 'manual']);
    assert.equal(c.currentPlaylist[c.getNextIndex()].id, 'similar');
});

test('manual Next never waits for or inserts the stale explicit radio response', async () => {
    const c = fixture({ currentPlaylist: [song('previous'), song('manual')], playMode: 'order' });
    const pending = c.startSearchRadio(song('seed'));
    c.ended();
    c.playNext();
    c.resolveLookup([song('late')]);
    await pending;
    assert.deepEqual(c.plays.map(x => x[0].id), ['seed', 'manual']);
    assert.deepEqual(ids(c), ['previous', 'seed', 'manual']);
});

test('a previous automatic batch cannot outrank new recommendations; a manual pin still can', async () => {
    const c = fixture({ currentPlaylist: [
        song('previous'), song('pinned', { _searchRadio: true, _playNextRequested: true }),
        song('old-auto', { _searchRadio: true }), song('manual'),
    ] });
    const pending = c.startSearchRadio(song('fresh-seed'));
    c.resolveLookup([song('fresh-similar')]);
    await pending;
    assert.deepEqual(ids(c), ['previous', 'fresh-seed', 'pinned', 'fresh-similar', 'old-auto', 'manual']);
});

test('Start Radio can attach to ordinary Play of the same song without restarting it', async () => {
    const playing = song('seed');
    const c = fixture({ currentPlaylist: [playing, song('manual')], currentPlayingSong: playing, currentLoadingSongId: playing.id });
    const pending = c.startSearchRadio({ ...playing });
    assert.equal(c.plays.length, 0);
    assert.equal(c.lookups.length, 1);
    c.resolveLookup([song('similar')]);
    await pending;
    assert.equal(c.currentPlaylist[0], playing);
    assert.deepEqual(ids(c), ['seed', 'similar', 'manual']);
});

test('an in-flight ID collision across sources gets feedback and cannot adopt the wrong playback', async () => {
    const playing = song('seed');
    const c = fixture({ currentPlaylist: [playing], currentPlayingSong: playing, currentLoadingSongId: playing.id });
    await c.startSearchRadio(song('seed', { source: 'tx' }));
    assert.equal(c.lookups.length, 0);
    assert.equal(c.plays.length, 0);
    assert.equal(c.currentPlayingScope, 'network');
    assert.ok(c.messages.includes('歌曲正在加载，请稍后再试'));
});

test('an already-queued playable recommendation is reported distinctly from an empty result', async () => {
    const c = fixture();
    const pending = c.startSearchRadio(song('seed'));
    c.resolveLookup([song('manual')]);
    await pending;
    assert.ok(c.messages.includes('相似歌曲已在播放队列中'));
    assert.ok(!c.messages.includes('暂未找到可播放的相似歌曲'));
});

test('pausing while an ended seed is waiting prevents delayed playback', async () => {
    const c = fixture({ currentPlaylist: [song('previous'), song('manual')], playMode: 'order' });
    const pending = c.startSearchRadio(song('seed'));
    c.ended();
    c.cancelSearchRadioContinuation();
    c.resolveLookup([song('late')]);
    await pending;
    assert.deepEqual(c.plays.map(x => x[0].id), ['seed']);
    assert.deepEqual(ids(c), ['previous', 'seed', 'manual']);
});

test('the production lookup deadline unblocks an ended seed and falls back to the queue', async () => {
    let fireDeadline;
    const c = fixture({
        currentPlaylist: [song('previous'), song('manual')], playMode: 'order',
        API_BASE: '/fixture', URLSearchParams, AbortController, performance, searchRadioCache: null,
        getUserAuthHeaders: () => ({}), console: { log() {}, warn() {} },
        setTimeout(fn, delay) { assert.equal(delay, 9000); fireDeadline = fn; return 1; },
        clearTimeout() {},
        fetch: () => new Promise(() => {}),
    });
    const lookup = 'const SEARCH_RADIO_TIMEOUT_MS = 9000;\n' + fn('getSearchRadioSeedQuery') + '\n' + fn('loadSearchRadioSongs');
    vm.runInContext(lookup, c);
    const pending = c.startSearchRadio(song('seed'));
    c.ended();
    assert.equal(c.plays.length, 1);
    assert.ok(fireDeadline);
    fireDeadline();
    await pending;
    assert.deepEqual(c.plays.map(x => x[0].id), ['seed', 'manual']);
    assert.equal(c.pendingExplicitRadio, null);
});

test('song radio replenishes through multiple batches without replaying seen songs or changing saved mode', async () => {
    const c = fixture();
    const initial = c.startSearchRadio(song('seed'));
    c.resolveLookup([song('a'), song('b'), song('c'), song('d')]); await initial;
    c.currentIndex = c.currentPlaylist.findIndex(s => s.id === 'd');
    c.currentPlayingSong = c.currentPlaylist[c.currentIndex];
    c.ended();
    const handoff = c.songRadioSession.handoff.promise;
    assert.equal(c.lookups.length, 2);
    c.resolveLookup([song('seed'), song('a'), song('e'), song('f'), song('g')]); await handoff;
    assert.equal(c.currentPlaylist[c.currentIndex].id, 'e');
    assert.equal(ids(c).filter(id => id === 'a').length, 1);
    assert.equal(c.playMode, 'single');
    assert.ok(ids(c).includes('manual'));
    c.currentIndex = c.currentPlaylist.findIndex(s => s.id === 'g'); c.currentPlayingSong = c.currentPlaylist[c.currentIndex];
    c.advanceClock(30001);
    c.ended(); const second = c.songRadioSession.handoff.promise;
    c.resolveLookup([song('h')]); await second;
    assert.equal(c.currentPlaylist[c.currentIndex].id, 'h');
    assert.equal(c.lookups.length, 3);
});

test('a pending continuous refill survives automatic transitions but not pause/stop or a new view', async () => {
    for (const action of ['pause', 'view']) {
        const c = fixture(); const initial = c.startSearchRadio(song('seed'));
        c.resolveLookup([song('a')]); await initial;
        c.currentIndex = c.currentPlaylist.findIndex(s => s.id === 'a'); c.currentPlayingSong = c.currentPlaylist[c.currentIndex];
        c.ended(); const handoff = c.songRadioSession.handoff.promise;
        const plays = c.plays.length;
        if (action === 'pause') c.cancelSearchRadioContinuation(); else c.currentPlayingScope = 'local_list';
        c.resolveLookup([song('late')]); await handoff;
        assert.equal(c.plays.length, plays); assert.ok(!ids(c).includes('late'));
    }
});

test('manual Play Next remains immediate while the continuous radio refill is pending', async () => {
    const c = fixture(); const initial = c.startSearchRadio(song('seed'));
    c.resolveLookup([song('a')]); await initial;
    c.currentIndex = c.currentPlaylist.findIndex(s => s.id === 'a'); c.currentPlayingSong = c.currentPlaylist[c.currentIndex];
    c.ended(); const oldHandoff = c.songRadioSession.handoff.promise;
    const pin = song('new-pin'); c.keepAsNextSong(pin); c.currentPlaylist.splice(c.currentIndex + 1, 0, pin);
    c.playNext(); assert.equal(c.currentPlaylist[c.currentIndex].id, 'new-pin');
    c.resolveLookup([song('b'), song('c')]); await oldHandoff;
    assert.equal(c.currentPlaylist[c.currentIndex].id, 'new-pin');
    assert.deepEqual(ids(c).slice(c.currentIndex + 1, c.currentIndex + 3), ['b', 'c']);
    assert.equal(c.isSongRadioActive(), true);
});

test('continuous radio releases only its played history at the queue cap and still rejects seen recordings', async () => {
    const c = fixture(); const initial = c.startSearchRadio(song('seed'));
    c.resolveLookup([song('a')]); await initial;
    const session = c.songRadioSession;
    const played = Array.from({ length: 960 }, (_, i) => song('old-' + i, { _explicitRadio: true }));
    played.forEach(s => { session.members.add(s); session.seen.add(c.cleanSongData(s).id); });
    const active = c.currentPlaylist.find(s => s.id === 'a');
    c.currentPlaylist = [song('keep-manual'), ...played, active, song('tail-manual')]; c.currentIndex = 961; c.currentPlayingSong = active;
    const task = c.replenishSongRadio(); c.resolveLookup([song('old-1'), song('new')]); await task;
    assert.deepEqual(ids(c), ['keep-manual', 'a', 'new', 'tail-manual']);
    assert.equal(c.currentIndex, 1); assert.equal(session.seen.has('wy_old-1'), true);
});

test('duplicate ended callbacks share one bounded refill and advance at most once', async () => {
    const c = fixture(); const initial = c.startSearchRadio(song('seed'));
    c.resolveLookup([song('a')]); await initial;
    c.currentIndex = c.currentPlaylist.findIndex(s => s.id === 'a'); c.currentPlayingSong = c.currentPlaylist[c.currentIndex];
    c.ended(); const pending = c.songRadioSession.handoff.promise; c.ended();
    assert.equal(c.lookups.length, 2);
    c.resolveLookup([song('b'), song('c')]); await pending;
    assert.equal(c.currentPlaylist[c.currentIndex].id, 'b');
});


test('an exhausted continuous station falls back to the untouched manual queue without looping in repeat-one', async () => {
    const c = fixture(); const initial = c.startSearchRadio(song('seed'));
    c.resolveLookup([song('a')]); await initial;
    c.currentIndex = c.currentPlaylist.findIndex(s => s.id === 'a'); c.currentPlayingSong = c.currentPlaylist[c.currentIndex];
    c.ended(); const pending = c.songRadioSession.handoff.promise;
    c.resolveLookup([]); await pending;
    assert.equal(c.songRadioSession, null);
    assert.equal(c.currentPlaylist[c.currentIndex].id, 'manual');
    assert.equal(c.playMode, 'single');
});

test('missing metadata produces feedback instead of a silent radio action or provider request', async () => {
    const c = fixture(); await c.startSearchRadio({ source: 'local', name: '' });
    assert.equal(c.lookups.length, 0); assert.equal(c.plays.length, 0);
    assert.ok(c.messages.some(message => message.includes('缺少歌曲信息')));
});

test('an already-open drawer stays open and late results never reopen a dismissed drawer', async () => {
    const c = fixture({ drawerOpen: true });
    const pending = c.startSearchRadio(song('seed'));
    assert.equal(c.opens, 0);
    assert.deepEqual(c.scrolls, []);
    assert.deepEqual(c.drawnTracks, ['playing', 'seed', 'pinned', 'manual']);
    c.drawerOpen = false;
    c.resolveLookup([song('similar')]);
    await pending;
    assert.equal(c.opens, 0);
    assert.equal(c.drawerOpen, false);
    assert.equal(c.statusNode.textContent, '电台待播：1 / 24 首 · 暂无更多推荐');
    assert.deepEqual(c.drawnTracks, []);
    assert.equal(c.currentPlaylist[c.getNextIndex()].id, 'pinned');
    assert.deepEqual(ids(c), ['playing', 'seed', 'pinned', 'similar', 'manual']);
});

test('a failed replacement station removes only old generated upcoming rows', async () => {
    const played = song('played-by-old-station', { _explicitRadio: true });
    const current = song('playing');
    const oldGenerated = song('superseded', { _explicitRadio: true });
    const pin = song('promoted', { _explicitRadio: true, _playNextRequested: true });
    const manual = song('manual');
    const c = fixture({ currentPlaylist: [played, current, oldGenerated, pin, manual], currentIndex: 1, currentPlayingSong: current, drawerOpen: true });
    const pending = c.startSearchRadio(song('new-station'));
    assert.deepEqual(c.drawnTracks, [played.id, current.id, 'new-station', pin.id, manual.id]);
    c.resolveLookup([]);
    await pending;
    assert.equal(c.currentPlaylist[c.getNextIndex()].id, pin.id);
    assert.equal(c.statusNode.textContent, '暂未找到可播放的相似歌曲');
    assert.equal(c.saves, 1, 'persist removal without mutating saved playlists');
});

test('a stale result arriving while a new station is pending leaves its loading announcement alone', async () => {
    const c = fixture();
    const first = c.startSearchRadio(song('first'));
    const resolveFirst = c.resolveLookup;
    const second = c.startSearchRadio(song('second'));
    resolveFirst([song('never')]);
    await first;
    assert.equal(c.statusNode.textContent, '正在加载电台推荐');
    assert.equal(c.opens, 0);
    c.resolveLookup([song('next')]);
    await second;
    assert.equal(c.statusNode.textContent, '电台待播：1 / 24 首 · 暂无更多推荐');
    assert.deepEqual(c.drawnTracks, []);
    assert.ok(ids(c).includes('next'));
    assert.ok(!ids(c).includes('never'));
});

test('a rejected recommendation request clears loading and retains the real ordinary queue', async () => {
    const c = fixture({ drawerOpen: true, async loadSearchRadioSongs() { throw Error('offline'); } });
    await c.startSearchRadio(song('seed'));
    assert.equal(c.statusNode.textContent, '暂未找到可播放的相似歌曲');
    assert.deepEqual(c.drawnTracks, ['playing', 'seed', 'pinned', 'manual']);
});

test('the initial target counts only 24 distinct upcoming recordings, not history or pins', async () => {
    const prior = song('played-original', { name: 'Old Take', singer: 'Artist' });
    const pin = song('pinned-original', { name: 'Pinned', singer: 'Band', _playNextRequested: true });
    const seed = song('seed', { name: 'Seed', singer: 'Singer' });
    const c = fixture({ currentPlaylist: [prior, pin, song('manual')], currentPlayingSong: prior, drawerOpen: true });
    const pending = c.startSearchRadio(seed);
    const first = song('one', { name: 'Night-Sky', singer: 'Band ＆ Artist', interval: '03:00' });
    const candidates = Array.from({ length: 32 }, (_, i) => song('rec-' + i));
    c.resolveLookup([
        song('seed-version', { source: 'tx', name: seed.name, singer: seed.singer }),
        song('played-cross-catalog', { source: 'tx', name: prior.name, singer: prior.singer }),
        song('pin-cross-catalog', { source: 'tx', name: pin.name, singer: pin.singer }),
        first, song('other', { source: 'tx', name: 'Night Sky', singer: 'Artist、Band' }),
        song('missing-name', { name: '' }), ...candidates,
    ], 'radio');
    await pending;
    assert.equal(c.radioSongsRemaining(), 24);
    assert.equal(c.currentPlaylist[c.getNextIndex()], pin);
    assert.deepEqual(ids(c), [prior.id, seed.id, pin.id, first.id, ...candidates.slice(0, 23).map(s => s.id), 'manual']);
    assert.equal(c.statusNode.textContent, '电台待播：24 / 24 首');
    assert.deepEqual(c.drawnTracks, ids(c));
    assert.equal(c.lookups.length, 1);
    assert.deepEqual(c.scrolls, []);
});

test('initial thin recommendations publish immediately and subsequent related seeds fill the exact deficit', async () => {
    const c = fixture({ drawerOpen: true });
    const pending = c.startSearchRadio(song('seed'));
    c.resolveLookup([song('a'), song('b')], 'radio', true);
    await pending;
    assert.equal(c.radioSongsRemaining(), 2);
    assert.deepEqual(c.drawnTracks, ['playing', 'seed', 'pinned', 'a', 'b', 'manual']);
    assert.equal(c.statusNode.textContent, '电台待播：2 / 24 首 · 正在补充');
    assert.deepEqual(c.lookups.map(s => s.id), ['seed', 'a']);
    const refill = c.songRadioSession.pending.promise;
    assert.equal(c.replenishSongRadio(), refill, 'simultaneous events share the same refill');
    c.resolveLookup([song('not-song-level')], 'artist');
    for (let i = 0; i < 4; i++) await Promise.resolve();
    assert.deepEqual(c.lookups.map(s => s.id), ['seed', 'a', 'b']);
    const fresh = Array.from({ length: 24 }, (_, i) => song('extra-' + i));
    c.resolveLookup([song('a'), song('b'), ...fresh], 'similar');
    await refill;
    assert.equal(c.radioSongsRemaining(), 24);
    assert.equal(c.statusNode.textContent, '电台待播：24 / 24 首');
    assert.deepEqual(c.drawnTracks, ['playing', 'seed', 'pinned', 'a', 'b', ...fresh.slice(0, 22).map(s => s.id), 'manual']);
    assert.equal(c.currentPlaylist[c.getNextIndex()].id, 'pinned');
    assert.deepEqual(c.scrolls, []);
});

test('a provider shortfall is shown honestly, and state changes do not hammer candidates during cooldown', async () => {
    const c = fixture();
    const pending = c.startSearchRadio(song('seed'));
    c.resolveLookup([song('a'), song('b')], 'radio');
    await pending;
    const refill = c.songRadioSession.pending.promise;
    c.resolveLookup([song('a')], 'similar');
    for (let i = 0; i < 4; i++) await Promise.resolve();
    c.resolveLookup([], 'none');
    await refill;
    assert.equal(c.radioSongsRemaining(), 2);
    assert.equal(c.statusNode.textContent, '电台待播：2 / 24 首 · 暂无更多推荐');
    await c.replenishSongRadio();
    c.advanceClock(31000);
    await c.replenishSongRadio();
    assert.deepEqual(c.lookups.map(s => s.id), ['seed', 'a', 'b'], 'do not immediately retry seeds that did not fill the floor');
    c.advanceClock(30000);
    const retry = c.replenishSongRadio();
    assert.deepEqual(c.lookups.map(s => s.id), ['seed', 'a', 'b', 'seed']);
    c.resolveLookup(Array.from({ length: 24 }, (_, i) => song('later-' + i)), 'radio');
    await retry;
    assert.equal(c.radioSongsRemaining(), 24);
});

test('a small initial artist-only fallback is not expanded into a full station', async () => {
    const c = fixture();
    const pending = c.startSearchRadio(song('seed'));
    c.resolveLookup([song('a'), song('b'), song('c')], 'artist');
    await pending;
    await c.replenishSongRadio();
    assert.equal(c.radioSongsRemaining(), 3);
    assert.equal(c.statusNode.textContent, '电台待播：3 / 24 首 · 暂无更多推荐');
    assert.deepEqual(c.lookups.map(s => s.id), ['seed']);
});

test('available queue capacity is spent on distinct tracks rather than cross-catalog repeats', async () => {
    const filler = Array.from({ length: 997 }, (_, i) => song('filler-' + i));
    const c = fixture({ currentPlaylist: filler, currentPlayingSong: filler[0] });
    const pending = c.startSearchRadio(song('seed'));
    c.resolveLookup([
        song('a', { name: 'Recording', singer: 'Artist' }),
        song('same-a', { name: 'Recording', singer: 'Artist', source: 'tx' }),
        song('b', { name: 'Another Recording', singer: 'Artist' }),
        song('overflow', { name: 'Another Unqueued Recording', singer: 'Artist' }),
    ], 'radio');
    await pending;
    assert.equal(c.currentPlaylist.length, 1000);
    assert.equal(c.lookups.length, 1, 'do not query providers when all queue slots are full');
    assert.equal(c.radioSongsRemaining(), 2);
    assert.deepEqual(ids(c).slice(0, 5), ['filler-0', 'seed', 'a', 'b', 'filler-1']);
});

test('a station lookup uses an independent cache key and cancellation settles a stalled fetch', async () => {
    const calls = [];
    const c = fixture({
        API_BASE: '/fixture', URLSearchParams, AbortController, performance, searchRadioCache: null,
        getUserAuthHeaders: () => ({}), console: { log() {}, warn() {} },
        fetch(url, options) { calls.push({ url, signal: options.signal }); return new Promise(() => {}); },
    });
    vm.runInContext('const SEARCH_RADIO_TIMEOUT_MS = 9000;\n' + fn('getSearchRadioSeedQuery') + '\n' + fn('loadSearchRadioSongs'), c);
    const seed = song('seed');
    const stationSignal = new AbortController();
    const station = c.loadSearchRadioSongs(seed, { station: true, signal: stationSignal.signal });
    const automaticSignal = new AbortController();
    const automatic = c.loadSearchRadioSongs(seed, { signal: automaticSignal.signal });
    stationSignal.abort();
    assert.equal((await station).list.length, 0);
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(calls[1].signal.aborted, false);
    const stationParams = new URL(calls[0].url, 'https://fixture.example').searchParams;
    const automaticParams = new URL(calls[1].url, 'https://fixture.example').searchParams;
    assert.equal(stationParams.get('target'), '24');
    assert.equal(stationParams.get('limit'), '48');
    assert.equal(automaticParams.has('target'), false);
    automaticSignal.abort();
    await automatic;
});

test('unpublished same-seed overflow fills later slots even offline, rechecking manual rows and dislikes', async () => {
    const disliked = new Set();
    const c = fixture({ drawerOpen: true, window: { DislikeManager: { isDisliked: track => disliked.has(track.id) } } });
    const pending = c.startSearchRadio(song('seed'));
    const overflow = [song('later-disliked'), song('manual-later'), song('use-overflow'), song('another-overflow')];
    c.resolveLookup([...Array.from({ length: 24 }, (_, i) => song('first-' + i)), ...overflow], 'radio');
    await pending;
    assert.equal(c.radioSongsRemaining(), 24);
    assert.equal(c.lookups.length, 1);
    assert.ok(!overflow.some(s => ids(c).includes(s.id)), 'the reserve is not shown or saved as queued');

    c.currentPlaylist.push(overflow[1]); // explicit user addition while the provider is unavailable
    disliked.add(overflow[0].id);
    c.currentIndex = c.currentPlaylist.findIndex(s => s.id === 'first-0');
    c.currentPlayingSong = c.currentPlaylist[c.currentIndex];
    await c.replenishSongRadio();
    assert.equal(c.lookups.length, 1, 'the queue uses buffered results without another provider lookup');
    assert.equal(c.radioSongsRemaining(), 24);
    assert.deepEqual(c.drawnTracks.slice(-5), ['first-22', 'first-23', 'use-overflow', 'manual', 'manual-later']);
    assert.ok(!ids(c).includes('another-overflow'));
    assert.ok(!ids(c).includes('later-disliked'));
    assert.equal(ids(c).filter(id => id === 'manual-later').length, 1);
});
