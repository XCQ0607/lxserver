const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('public/music/app.js', 'utf8');
function extract(name) {
    const start = app.indexOf('function ' + name + '(');
    assert.ok(start >= 0);
    return app.slice(start, app.indexOf('\n}', start) + 2);
}
function setup() {
    const calls = [];
    const window = { getUserAuthHeaders: () => ({ 'x-user-token': 'fixture-token' }), updatePlaylist: (...args) => calls.push(args) };
    const context = vm.createContext({ window, setTimeout() {}, localStorage: { getItem: () => '' },
        document: { getElementById: () => ({ value: 'browse-only' }) }, encodeURIComponent, URLSearchParams, console });
    for (const file of ['local_music.js', 'customDir.js']) vm.runInContext(fs.readFileSync('public/music/js/local/' + file, 'utf8'), context);
    vm.runInContext(extract('getSearchRadioSeedQuery'), context);
    for (const manager of [window.LocalMusicManager, window.CustomDirManager]) manager.getCurrentUsername = () => 'fixture-user';
    return { context, window, calls };
}
for (const custom of [false, true]) test(`${custom ? 'custom' : 'cache'} radio playback retains the authorized local path and ordinary Play shape`, () => {
    const { context, window, calls } = setup();
    const manager = custom ? window.CustomDirManager : window.LocalMusicManager;
    const item = { filename: 'private/recording.flac', folder: 'music', name: 'Track title', singer: 'Artist', album: 'Album', songInfo: { id: 'private-id', source: 'local', meta: { songId: 'private/path-id' } } };
    const song = manager.buildPlaybackSong(item);
    assert.equal(song.isLocal, true);
    assert.equal(song._localFilename, item.filename);
    assert.equal(song._localUsername, 'fixture-user');
    assert.equal(song.name, item.name);
    if (custom) {
        assert.equal(song._isCustomDir, true);
        assert.equal(new URL(song.url, 'http://fixture').searchParams.get('token'), 'fixture-token');
        assert.equal(new URL(song.url, 'http://fixture').searchParams.get('filename'), item.filename);
    } else {
        assert.equal(song._localLocation, 'browse-only');
        assert.ok(song.url.includes(encodeURIComponent(item.filename)));
        assert.ok(song.url.endsWith('browseLocation=browse-only'));
    }
    const query = new URLSearchParams(context.getSearchRadioSeedQuery(song));
    assert.equal(query.get('source'), 'local');
    assert.equal(query.get('songId'), ''); assert.equal(query.get('songmid'), '');
    assert.equal(query.get('name'), item.name);
    assert.equal(query.get('singer'), item.singer);
    assert.equal(query.get('album'), item.album);
    assert.ok(!query.toString().includes('private'));
    assert.ok(!query.toString().includes('fixture-token'));
    assert.ok(!query.toString().includes('fixture-user'));
    manager.displayData = [item]; manager.playItem(0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0][0].url, song.url);
    assert.equal(calls[0][1], 0);
    assert.equal(calls[0][2], custom ? 'custom_dir_all' : 'local_all');
});
test('provider-linked local songs retain their provider identity in the radio query', () => {
    const { context, window } = setup();
    const song = window.LocalMusicManager.buildPlaybackSong({ filename: 'private/file.flac', songInfo: { source: 'tx', songmid: 'provider-mid', meta: { id: '12345' }, name: 'Title' } });
    const params = new URLSearchParams(context.getSearchRadioSeedQuery(song));
    assert.equal(params.get('source'), 'tx'); assert.equal(params.get('songmid'), 'provider-mid'); assert.equal(params.get('songId'), '12345');
});
