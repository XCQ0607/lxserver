const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/music/app.js', 'utf8');

function extractBlock(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `Missing start marker: ${startMarker}`);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(end, -1, `Missing end marker: ${endMarker}`);
    return source.slice(start, end);
}

function createPlaybackHarness({ count = 20, mode = 'random' } = {}) {
    const playlist = Array.from({ length: count }, (_, i) => ({
        id: `wy_${i + 1}`,
        songId: String(i + 1),
        source: 'wy',
        name: `Song ${i + 1}`,
        singer: `Artist ${i + 1}`
    }));

    const playedLog = [];
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        Math,
        Set,
        Array,
        String,
        settings: { enablePreloader: false },
        window: {},
        document: { getElementById: () => null },
        localStorage: { setItem() {}, getItem() { return null; } },
        cleanSongData: s => ({ ...s, id: s.id || `${s.source}_${s.songId}` }),
        renderQueue() {},
        savePlaybackState() {},
        updatePlayModeUI() {},
        getPlayModeName: m => m,
        showInfo() {},
        showSuccess() {},
        revealSongInQueue() {},
        prefetchNextSong: null,
        currentPlaylist: playlist,
        currentIndex: 0,
        preSelectedNextIndex: null,
        queuedNextSongs: [],
        randomPlayedSongs: new Set(),
        randomPlayHistory: [],
        playMode: mode,
        playSong(song, index) {
            context.currentIndex = index;
            context.preSelectedNextIndex = null;
            context.recordSongPlayed(song);
            playedLog.push(song);
        }
    });

    const queueHelpers = extractBlock('function syncPlaybackQueueTrackers()', '// Prefetch next song helper');
    const enqueueFn = extractBlock('function enqueueSong(song, next = false)', 'function playFromView(index)');
    const nextPrevFns = extractBlock('function playNext()', '// 音量淡入淡出辅助函数');
    const setModeFn = extractBlock('function setPlayMode(mode)', '// 切换播放模式菜单');

    vm.runInContext(
        `${queueHelpers}\n${enqueueFn}\n${nextPrevFns}\n${setModeFn}`,
        context
    );

    // 初始化当前正在播放第 0 首
    context.playSong(playlist[0], 0);

    return { context, playlist, playedLog };
}

test('random mode plays every song in the playlist once before repeating', () => {
    const { context, playlist, playedLog } = createPlaybackHarness({ count: 20, mode: 'random' });

    for (let step = 1; step < playlist.length; step++) {
        context.playNext();
    }

    assert.equal(playedLog.length, 20);
    const uniqueIds = new Set(playedLog.map(s => s.id));
    assert.equal(uniqueIds.size, 20, 'all 20 songs should be played once in a full cycle');

    // 第 21 次切歌进入新一轮，不应立刻重复第 20 首
    const lastBeforeWrap = playedLog[playedLog.length - 1];
    context.playNext();
    assert.equal(playedLog.length, 21);
    assert.notEqual(playedLog[20].id, lastBeforeWrap.id, 'new cycle must not immediately repeat the last played song');
});

test('random mode playPrev navigates back through played history', () => {
    const { context, playedLog } = createPlaybackHarness({ count: 10, mode: 'random' });
    context.playNext();
    context.playNext();

    const first = playedLog[0];
    const second = playedLog[1];
    const third = playedLog[2];
    assert.notEqual(second.id, first.id);
    assert.notEqual(third.id, second.id);

    context.playPrev();
    assert.equal(playedLog[playedLog.length - 1].id, second.id);
    context.playPrev();
    assert.equal(playedLog[playedLog.length - 1].id, first.id);
});

test('enqueueSong(..., true) plays next in random mode even with preSelectedNextIndex set', () => {
    const { context, playlist, playedLog } = createPlaybackHarness({ count: 15, mode: 'random' });
    // 模拟预读已经随机选了一个索引
    context.preSelectedNextIndex = 7;

    const insertedSong = { id: 'tx_999', songId: '999', source: 'tx', name: 'VIP Next', singer: 'Guest' };
    context.enqueueSong(insertedSong, true);

    context.playNext();
    assert.equal(playedLog[playedLog.length - 1].id, insertedSong.id);

    // 再测试把队列中已有的歌曲移至下一首
    const existing = playlist[10];
    context.enqueueSong(existing, true);
    context.playNext();
    assert.equal(playedLog[playedLog.length - 1].id, existing.id);
});

test('multiple enqueueSong(..., true) calls in random mode preserve LIFO next-up order', () => {
    const { context, playedLog } = createPlaybackHarness({ count: 10, mode: 'random' });
    const songX = { id: 'kw_x', songId: 'x', source: 'kw', name: 'Song X', singer: 'A' };
    const songY = { id: 'kw_y', songId: 'y', source: 'kw', name: 'Song Y', singer: 'B' };

    context.enqueueSong(songX, true);
    context.enqueueSong(songY, true);

    context.playNext();
    assert.equal(playedLog[playedLog.length - 1].id, songY.id);
    context.playNext();
    assert.equal(playedLog[playedLog.length - 1].id, songX.id);
});

test('enqueueSong(..., true) also works in single-loop, list, and order modes', () => {
    for (const mode of ['single', 'list', 'order']) {
        const { context, playedLog } = createPlaybackHarness({ count: 5, mode });
        const insertedSong = { id: 'wy_888', songId: '888', source: 'wy', name: 'Priority', singer: 'Tester' };
        context.enqueueSong(insertedSong, true);
        context.playNext();
        assert.equal(playedLog[playedLog.length - 1].id, insertedSong.id, `mode=${mode} must play queued next song`);

        if (mode === 'single') {
            context.playNext();
            assert.equal(playedLog[playedLog.length - 1].id, insertedSong.id, 'single mode resumes looping current song after priority song');
        }
    }
});

test('all song list renderers expose play-next actions', () => {
    assert.ok(source.includes('function createSongQueueActionsMenu('), 'shared queue actions menu helper should exist');
    const artistBlock = extractBlock('function renderArtistSongsUI(', 'function renderArtistAlbumsLoading(');
    assert.ok(artistBlock.includes('createSongQueueActionsMenu('), 'artist songs UI should attach queue actions menu');
    assert.ok(!artistBlock.includes('data-rating-index='), 'artist songs UI should move rating into three-dot menu');
    const queueBlock = extractBlock('function renderQueue()', 'function playSongFromQueue(');
    assert.ok(queueBlock.includes('title="下一首播放"'), 'queue drawer should expose play-next button');
    const cacheBlock = extractBlock('function renderCacheList()', 'function buildCacheSongObject(');
    assert.ok(cacheBlock.includes('enqueueCacheItem('), 'cache list should expose play-next button');

    const leaderboardSource = fs.readFileSync('public/music/js/library/leaderboard_manager.js', 'utf8');
    assert.ok(leaderboardSource.includes('createSongQueueActionsMenu('), 'leaderboard should attach queue actions menu');
    assert.ok(!leaderboardSource.includes('data-rating-index='), 'leaderboard should move rating into three-dot menu');

    const songlistSource = fs.readFileSync('public/music/js/library/songlist_manager.js', 'utf8');
    assert.ok(songlistSource.includes('createSongQueueActionsMenu('), 'songlist should attach queue actions menu');
    assert.ok(!songlistSource.includes('data-songlist-rating='), 'songlist should move rating into three-dot menu');
});
