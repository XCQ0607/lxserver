const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('public/music/app.js', 'utf8');
const between = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));
const song = { id: 'wy_1', name: 'Song', singer: 'Singer', source: 'wy', interval: '3:00',
    url: 'https://ignored.invalid/private?token=forbidden', filename: 'ignored', meta: { songId: '1' } };
const result = { quality: '320k', verifiedPlaybackCache: true, sourceType: 'server_cache',
    url: '/api/music/cache/file/Singer-Song.mp3?folder=cache' };
const queueTask = status => ({ id: 'lx_upgrade_track1', cacheUpgrade: true, status });
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
};

function fixture(request) {
    let sequence = 0;
    const timers = new Map(), calls = [], replays = [];
    const state = { thisRequestId: 9, currentSong: song, currentIndex: 2 };
    const c = vm.createContext({
        AbortController, AbortSignal, Date, threadCurrent: true, owner: 'alice',
        settings: { enableServerCache: true, preferServerCache: true, preferredQuality: 'flac', enableOnlyDownloadMode: true },
        window: { ServerFileState: { repaintAll() { c.repaints++; } } },
        repaints: 0, audio: { currentTime: 0, readyState: 4, src: result.url },
        currentRecoveryState: state, song, result, API_BASE: '/api/music', cleanSongData: s => s,
        getUserAuthHeaders: () => ({ 'x-user-name': c.owner }),
        fetch: async (url, options) => {
            const body = options.body ? JSON.parse(options.body) : undefined;
            calls.push({ url, body, options });
            return request ? request(url, body, options) : {
                ok: true, json: async () => ({ success: true, data: [queueTask('waiting')] }),
            };
        },
        playSong: (...args) => replays.push(args),
        setTimeout: fn => { timers.set(++sequence, fn); return sequence; },
        clearTimeout: id => timers.delete(id),
    });
    vm.runInContext([
        between("const canonicalPlaybackTier", "const cacheLookupUnavailable"),
        between("let playbackCacheUpgrade", "const watchedCacheSongKeys"),
        between("function canRetryCachedTransport", "async function runRecoveryFlow"),
    ].join('\n'), c);
    const arm = (target = 'flac') => c.armPlaybackCacheUpgrade(song, result, target, 9, false);
    const advance = sequence => { for (const second of sequence) { c.audio.currentTime = second; c.advancePlaybackCacheUpgrade(); } };
    const poll = async () => {
        const [id, fn] = timers.entries().next().value;
        timers.delete(id);
        await fn();
    };
    const retry = error => c.retryCachedTransport(error, 17.5, state, result, () => c.threadCurrent);
    state.cacheMediaOwner = 'alice';
    state.cacheMediaScope = vm.runInContext('cacheUpgradeContext()', c);
    return { c, calls, replays, state, arm, advance, poll, retry };
}

test('queues one exact requested profile only after advancing; completion leaves active media untouched', async () => {
    const f = fixture(async (_url, body) => ({ ok: true,
        json: async () => ({ success: true, data: [queueTask(body ? 'waiting' : 'finished')] }) }));
    f.arm();
    f.advance([0, 0, 0, 40]); // not playing yet or a seek event
    assert.equal(f.calls.length, 0);
    f.advance([40.21, 40.42, 40.65]);
    await tick();
    assert.equal(f.calls.length, 1);
    const [task] = f.calls[0].body.tasks;
    assert.equal(task.cacheUpgrade, true);
    assert.equal(task.quality, 'flac');
    assert.equal(task.songInfo.id, song.id);
    assert.equal(task.songInfo.url, undefined);
    assert.equal(task.songInfo.filename, undefined);
    await f.poll();
    assert.equal(f.c.audio.src, result.url);
    assert.equal(f.c.audio.currentTime, 40.65);
    assert.equal(f.c.repaints, 1);
    f.advance([40.9, 41.2]);
    assert.equal(f.calls.length, 2);
});

test('buffering before enqueue returns pauses only the automatic job and resumes once after stable media', async () => {
    const pending = deferred();
    const f = fixture(async (url, body) => {
        if (body?.tasks) await pending.promise;
        return { ok: true, json: async () => ({ success: true, data: [queueTask('waiting')] }) };
    });
    f.arm();
    f.advance([0, 0.25, 0.5]);
    await f.c.pausePlaybackCacheUpgrade();
    assert.equal(f.calls.length, 1);
    pending.resolve();
    await tick();
    assert.deepEqual(f.calls.map(call => [call.url, call.body.queueId]), [
        ['/api/music/cache/queue', undefined], ['/api/music/cache/stop', 'lx_upgrade_track1'],
    ]);
    f.advance([1, 2, 3, 3.6]);
    await tick();
    assert.deepEqual(f.calls[2].body, { id: 'lx_upgrade_track1' });
    assert.equal(f.calls[2].url, '/api/music/cache/queue/resume');
    await f.c.pausePlaybackCacheUpgrade();
    f.advance([4, 5, 6, 7]);
    await tick();
    assert.equal(f.calls.filter(call => call.url.endsWith('/resume')).length, 1);
    assert.equal(f.c.audio.src, result.url);
});

test('stale account, superseded request, unsupported profile, and disabled writes cannot enqueue', () => {
    for (const options of ['owner', 'request', 'format', 'writes']) {
        const f = fixture();
        f.arm(options === 'format' ? 'atmos' : 'flac');
        if (options === 'owner') f.c.owner = 'bob';
        if (options === 'request') f.state.thisRequestId++;
        if (options === 'writes') f.c.settings.enableServerCache = false;
        f.advance([0, 0.25, 0.5]);
        assert.equal(f.calls.length, 0, options);
    }
});

test('network or stall can resume the verified NAS file at the old position once', async () => {
    const f = fixture(async () => ({ ok: true, status: 206, headers: new Headers({ 'content-type': 'audio/mpeg' }) }));
    assert.equal(await f.retry({ code: 'PLAYBACK_CACHE_STALL' }), true);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].options.headers.Range, 'bytes=0-1');
    assert.equal(f.calls[0].options.redirect, 'error');
    assert.deepEqual({ ...f.c.window._resumeInfo }, { time: 17.5, song });
    assert.equal(f.replays[0][4], 'cache_transport');
    assert.equal(f.replays[0][6].url, result.url);
    assert.equal(await f.retry({ code: 2 }), false);
    assert.equal(f.calls.length, 1);
});

test('same-file recovery rejects auth, known deletion, decode errors and stale account', async () => {
    let f = fixture(async () => ({ ok: false, status: 401 }));
    await assert.rejects(f.retry({ code: 2 }), error => error.status === 401);
    assert.equal(f.replays.length, 0);
    f = fixture(async () => ({ ok: false, status: 404 }));
    assert.equal(await f.retry({ code: 2 }), false);
    assert.equal(f.replays.length, 0);
    f = fixture();
    assert.equal(await f.retry({ code: 3 }), false);
    assert.equal(f.calls.length, 0);
    const pending = deferred();
    f = fixture(() => pending.promise);
    const retry = f.retry({ code: 2 });
    f.c.owner = 'bob';
    pending.resolve({ ok: true, status: 206, headers: new Headers({ 'content-type': 'audio/mpeg' }) });
    await retry;
    assert.equal(f.replays.length, 0);
});
