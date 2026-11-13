const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/music/app.js', 'utf8');
const start = source.indexOf('function isUsableServerCache(');
const code = source.slice(start, source.indexOf('\nasync function refreshPrefetchedCache(', start));
const context = vm.createContext({});
vm.runInContext(code, context);
const usable = context.isUsableServerCache;

const url = '/api/music/cache/file/alice/song.flac?folder=music';

test('a file cached from this platform is always usable', () => {
    assert.equal(usable({ interval: '04:16' }, { exists: true, url }), true);
    assert.equal(usable({}, { exists: true, url }), true);
    assert.equal(usable({ interval: '04:16' }, { exists: false }), false);
});

test('a file another platform cached for the same song plays without reaching the source', () => {
    assert.equal(usable({ interval: '04:16' }, { exists: true, isCollision: true, url, interval: '04:17' }), true);
});

test('a same-named file of a different length, or of unknown length, is not used', () => {
    assert.equal(usable({ interval: '04:16' }, { exists: true, isCollision: true, url, interval: '05:40' }), false);
    assert.equal(usable({ interval: '04:16' }, { exists: true, isCollision: true, url }), false);
    assert.equal(usable({}, { exists: true, isCollision: true, url, interval: '04:16' }), false);
    assert.equal(usable({ interval: '04:16' }, { exists: true, isCollision: true, interval: '04:16' }), false, 'file missing on disk');
});
