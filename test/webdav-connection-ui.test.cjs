const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('WebDAV report persists details as text and restores the button after success or failure', async () => {
    const source = fs.readFileSync('public/app.js', 'utf8');
    const start = source.indexOf('    async testWebDAV() {');
    const method = source.slice(start, source.indexOf('\n    // ', start));
    let report;
    const button = { disabled: false, setAttribute() {}, removeAttribute() {}, parentElement: { appendChild(el) { report = el; } } };
    const notices = [];
    const context = vm.createContext({
        document: {
            getElementById: id => id === 'test-webdav-btn' ? button : report,
            createElement: () => ({ style: {}, setAttribute() {} }),
        },
        showSuccess: text => notices.push(text), showError: text => notices.push(text),
    });
    const app = vm.runInContext(`({${method}})`, context);
    let finish;
    app.request = () => new Promise(resolve => { finish = resolve; });
    const pending = app.testWebDAV();
    assert.equal(button.disabled, true);
    await app.testWebDAV(); // No duplicate request while busy.
    finish({ success: false, message: '部分目录检查未通过', checks: [{ name: '备份目录', path: '/<img>', success: false, message: 'HTTP 502：网关异常' }] });
    await pending;
    assert.equal(button.disabled, false);
    assert.match(report.textContent, /备份目录 \/<img>：未通过，HTTP 502/);
    assert.equal(report.innerHTML, undefined);
    app.request = async () => ({ success: true, message: '目录均可读取' });
    await app.testWebDAV();
    assert.equal(report.textContent, '目录均可读取');
    app.request = async () => { throw new Error('network unavailable'); };
    await app.testWebDAV();
    assert.equal(button.disabled, false);
    assert.match(report.textContent, /network unavailable/);
    assert.equal(notices.length, 3);
});
