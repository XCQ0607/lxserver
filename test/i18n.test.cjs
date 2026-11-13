const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync('public/music/js/ui/i18n.js', 'utf8'), context);
const { createTranslator } = context.window.LXI18n;

const translator = createTranslator({
    '设置': 'Settings',
    '导入': 'Import',
    '已加载 {0} 首 · {1}/{2} 个音源已返回': 'Loaded {0} songs · {1}/{2} sources returned',
    '{0}成功': '{0} succeeded',
    '已将 {0} 添加到 {1}': 'Added {0} to {1}',
    '{0}首': '{0} songs',
    '暂停中': 'Paused', '无损音质': 'Lossless', '缓存': 'Cached',
});

test('whole strings translate exactly; anything else is left alone', () => {
    assert.equal(translator.translate('设置'), 'Settings');
    assert.equal(translator.translate('设置页'), null);
    assert.equal(translator.translate('晴天'), null, 'song names are not in the table');
});

test('template strings fill their placeholders, translating values that are UI words', () => {
    assert.equal(translator.translate('已加载 103 首 · 5/5 个音源已返回'), 'Loaded 103 songs · 5/5 sources returned');
    assert.equal(translator.translate('已将 晴天 添加到 我的喜爱'), 'Added 晴天 to 我的喜爱');
    assert.equal(translator.translate('导入成功'), 'Import succeeded');
});

test('templates with little fixed text do not swallow song titles', () => {
    assert.equal(translator.translate('忘记成功'), null, 'a short template only accepts known words or non-Chinese values');
    assert.equal(translator.translate('3成功'), '3 succeeded');
    assert.equal(translator.translate('最后一首'), null, 'a one-character template only takes numbers');
    assert.equal(translator.translate('100首'), '100 songs');
});

test('text assembled from several UI words is translated piece by piece', () => {
    assert.equal(translator.translate('暂停中 (无损音质) 【缓存】'), 'Paused (Lossless) [Cached]');
    assert.equal(translator.translate('暂停中 (128k)'), 'Paused (128k)');
    assert.equal(translator.translate('晴天 (无损音质)'), null, 'an unknown piece leaves the whole text alone');
});
