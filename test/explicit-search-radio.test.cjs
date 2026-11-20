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
const legacyLoader = app.includes('return list.filter(item => item.id && item.source)');

function fixture(overrides = {}) {
    const prior = song('playing'), playNext = song('pinned', { _searchRadio: true, _playNextRequested: true }), manual = song('manual');
    const c = vm.createContext({
        window: {}, settings: { autoPlaySimilarAfterSearch: false, switchPlaylistOnSearchPlay: false },
        searchRadioSongs: new WeakSet(),
        audio: { paused: true, addEventListener(name, callback) { c[name] = callback; } },
        shouldAutoRecoverPlayback: true, console: { log() {} },
        currentPlaylist: [prior, playNext, manual], currentIndex: 0, currentPlayingSong: prior,
        currentPlayingScope: 'network', searchRadioEpoch: 0, loadingRequestCounter: 0,
        pendingExplicitRadio: null, songRadioSession: null,
        currentLoadingSongId: null, searchRadioArmed: true, playMode: 'single', preSelectedNextIndex: 2,
        cleanSongData: track => ({ id: track.source + '_' + track.id }),
        setTimeout, clearTimeout,
        playSong(...args) { c.currentIndex = args[1]; c.currentPlayingSong = args[0]; c.loadingRequestCounter++; c.plays.push(args); },
        loadSearchRadioSongs(seed) {
            return new Promise(resolve => { c.resolveLookup = list => resolve(legacyLoader ? list : { list }); c.lookups.push(seed); });
        },
        setSearchRadioArmed(value) { c.searchRadioArmed = value; },
        renderQueue() { c.renders++; }, savePlaybackState() { c.saves++; },
        showInfo(message) { c.messages.push(message); },
        prefetchNextSong() { c.prefetches++; },
        plays: [], lookups: [], messages: [], saves: 0, renders: 0, prefetches: 0,
        ...overrides,
    });
    const helpers = ['startSearchRadio', 'cancelSearchRadioContinuation', 'pickSearchRadioSongs', 'getNextIndex',
        'keepAsNextSong', 'playNext', 'playNextInQueue', 'isSearchRadioDue',
        'isSongRadioActive', 'radioSongsRemaining', 'pruneSongRadioHistory', 'replenishSongRadio', 'advanceSongRadio'];
    for (const name of ['isExplicitRadioCurrent', 'playAfterNaturalEnd', 'describeEmptyExplicitRadio']) {
        if (app.includes('function ' + name + '(')) helpers.push(name);
    }
    const endedHandler = app.match(/audio\.addEventListener\('ended', \(\) => \{[\s\S]*?\n\}\);/)[0];
    vm.runInContext(helpers.map(fn).join('\n') + '\n' + endedHandler, c);
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
    assert.equal(c.renders, 1);
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
    assert.equal(c.messages.at(-1), '暂未找到可播放的相似歌曲');
});

for (const change of ['stop', 'new song', 'exit radio', 'remove seed']) {
    test('pending radio results cannot change the queue after ' + change, async () => {
        const c = fixture();
        const pending = c.startSearchRadio(song('seed'));
        if (change === 'stop') c.cancelSearchRadioContinuation();
        if (change === 'new song') c.loadingRequestCounter++;
        if (change === 'exit radio') c.currentPlayingScope = 'local_list';
        if (change === 'remove seed') c.currentPlaylist.splice(c.currentIndex, 1);
        const before = ids(c);
        c.resolveLookup([song('late')]);
        await pending;
        assert.deepEqual(ids(c), before);
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
    const lookup = (legacyLoader ? '' : 'const SEARCH_RADIO_TIMEOUT_MS = 9000;\n' + fn('getSearchRadioSeedQuery') + '\n') +
        fn('loadSearchRadioSongs');
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
