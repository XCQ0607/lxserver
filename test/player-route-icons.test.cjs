const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const app = fs.readFileSync('public/music/app.js', 'utf8');
const html = fs.readFileSync('public/music/index.html', 'utf8');
const css = fs.readFileSync('public/music/css/app.css', 'utf8');
test('AirPlay and Chromecast retain native button identity, state, availability and distinct route symbols', () => {
    const buttons = ['airplay', 'cast'].map(id => html.match(new RegExp('<button id="btn-' + id + '"[\\s\\S]*?</button>'))[0]);
    for (const button of buttons) {
        assert.match(button, /hidden disabled/); assert.match(button, /aria-pressed="false"/);
        assert.match(button, /class="player-route-button"/); assert.match(button, /<svg[^>]+aria-hidden="true"[^>]+focusable="false"/);
        assert.match(button, /aria-label="(AirPlay|Chromecast)"/);
    }
    assert.notEqual(buttons[0].slice(buttons[0].indexOf('<svg')), buttons[1].slice(buttons[1].indexOf('<svg')));
    assert.match(css, /\.player-route-button\[hidden\]\s*\{\s*display:\s*none !important/);
    assert.match(css, /\.player-route-button\[aria-pressed="true"\]/);
    assert.match(css, /\.player-route-button:focus-visible/);
});
