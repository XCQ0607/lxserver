const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('the worker precaches the bundled player scripts and styles before replacing its old cache', async () => {
    const root = path.resolve(__dirname, '../public/music');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
    const events = {}, assets = new Set();
    vm.runInNewContext(worker, {
        self: { addEventListener: (event, fn) => { events[event] = fn; }, skipWaiting() {} },
        caches: { open: async () => ({ addAll: async urls => urls.forEach(url => assets.add(url)) }) },
    });
    let installed;
    events.install({ waitUntil: task => { installed = task; } });
    await installed;
    for (const tag of html.match(/<(?:script|link)\b[^>]+>/gi) || []) {
        if (tag.startsWith('<link') && !/rel=["']stylesheet["']/i.test(tag)) continue;
        const url = tag.match(/(?:src|href)=["']([^"']+)["']/i)?.[1];
        // The shared runtime configuration and remote resources are not part of the static player bundle.
        if (!url || /^(?:[a-z]+:|[/#])/i.test(url)) continue;
        const relative = url.replace(/^\.\//, '');
        assert.ok(fs.existsSync(path.join(root, relative)), relative);
        assert.ok(assets.has('./' + relative), 'missing offline asset: ' + relative);
    }
});
