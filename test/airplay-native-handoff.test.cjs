const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the real routing modules together. Fake Web Audio records capture and
// connections; these tests do not establish physical receiver/audio delivery.
const playerRoot = path.resolve(__dirname, '../public/music/js/player');
const sources = ['visualizer', 'ios-background-audio', 'sound-effects', 'airplay']
    .map(name => [name, readFileSync(path.join(playerRoot, `${name}.js`), 'utf8')]);

class Events {
    constructor() { this.listeners = new Map(); }
    addEventListener(name, listener) {
        if (!this.listeners.has(name)) this.listeners.set(name, new Set());
        this.listeners.get(name).add(listener);
    }
    removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
    dispatch(name, event = {}) {
        for (const listener of this.listeners.get(name) || []) listener(event);
    }
}

function classes(initial = []) {
    const values = new Set(initial);
    return {
        add: (...names) => names.forEach(name => values.add(name)),
        remove: (...names) => names.forEach(name => values.delete(name)),
        contains: name => values.has(name),
        toggle(name, enabled) {
            if (enabled === undefined) enabled = !values.has(name);
            if (enabled) values.add(name); else values.delete(name);
        }
    };
}

function mediaElement() {
    return Object.assign(new Events(), {
        paused: true, style: {}, attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        play() { this.paused = false; return Promise.resolve(); },
        pause() { this.paused = true; }, remove() {}
    });
}

function fixture({ device = 'iphone', adaptive = true, nativeMode = false,
    wireless = false, cast = false, failSessionWrites = false,
    local = new Map(), session = new Map(), sliders = false } = {}) {
    let frames = [];
    const observations = { captures: 0, picked: 0, reloads: 0, saves: 0,
        errors: [], info: [], userErrors: [], waveAnalysers: [] };
    if (nativeMode) session.set('lx_native_audio_mode', '1');
    const storage = map => ({
        getItem: key => map.get(key) ?? null,
        setItem(key, value) {
            if (map === session && (failSessionWrites === true || failSessionWrites === key)) throw new Error('Storage unavailable');
            map.set(key, String(value));
        },
        removeItem: key => map.delete(key)
    });
    const audio = Object.assign(mediaElement(), {
        paused: false, webkitCurrentPlaybackTargetIsWireless: wireless,
        webkitShowPlaybackTargetPicker() { observations.picked++; }
    });
    const button = Object.assign(mediaElement(), { hidden: true, disabled: true, classList: classes() });
    const modal = { classList: classes(['hidden']) };
    const nativeButton = { hidden: true };
    const elements = {
        'audio-player': audio, 'btn-airplay': button,
        'sound-effects-modal': modal, 'sound-effects-native': nativeButton,
        'sound-effects-status': {}, 'sound-effects-state': {},
        'sound-effects-enable': {}, 'sound-effects-switch-label': {},
        'sound-effects-mode': {}, 'sound-effects-controls': {}
    };
    if (sliders) {
        for (const type of ['main', 'send']) {
            elements[`reverb-${type}-gain`] = { value: type === 'main' ? 100 : 0, style: {} };
            elements[`reverb-${type}-gain-val`] = {};
        }
    }
    const document = Object.assign(new Events(), {
        readyState: 'loading', visibilityState: 'visible',
        getElementById: id => elements[id] || null,
        createElement: () => mediaElement(),
        body: { appendChild() {} }, documentElement: { classList: classes() },
        querySelectorAll: () => [], querySelector: () => null
    });
    const parameter = () => ({
        value: 0,
        cancelScheduledValues() { return this; },
        setValueAtTime(value) { this.value = value; return this; },
        linearRampToValueAtTime(value) { this.value = value; return this; },
        setTargetAtTime(value) { this.value = value; return this; }
    });
    const node = () => ({
        connections: new Set(),
        connect(target) { this.connections.add(target); },
        disconnect(target) { if (target) this.connections.delete(target); else this.connections.clear(); },
        gain: parameter(), frequency: parameter(), Q: parameter(),
        positionX: parameter(), positionY: parameter(), positionZ: parameter()
    });
    class Context extends Events {
        constructor() {
            super(); this.state = 'running'; this.currentTime = 0; this.destination = node();
            // Loading DSP code is outside the native-routing seam under test.
            this.audioWorklet = { addModule: () => new Promise(() => {}) };
        }
        createMediaElementSource(media) {
            assert.equal(media, audio, 'capture must use the actual player media element');
            observations.captures++; return node();
        }
        createAnalyser() { return node(); }
        createChannelSplitter() { return node(); }
        createBiquadFilter() { return node(); }
        createConvolver() { return node(); }
        createGain() { return node(); }
        createPanner() { return node(); }
        createMediaStreamDestination() { return Object.assign(node(), { stream: {} }); }
        resume() { this.state = 'running'; return Promise.resolve(); }
    }
    class Wave {
        constructor(analyser) { observations.waveAnalysers.push(analyser); }
        clearAnimations() {} addAnimation() {}
    }
    const mobile = device !== 'desktop';
    const window = Object.assign(new Events(), {
        innerWidth: mobile ? 390 : 1440, innerHeight: 900,
        settings: { showFooterVisualizer: true, iosAdaptiveVisualizer: adaptive },
        AudioContext: Context, Wave, LXPlayback: { isRemote: cast },
        savePlaybackState: () => { observations.saves++; return true; },
        showInfo: message => observations.info.push(message),
        showError: message => observations.userErrors.push(message),
        location: { reload: () => observations.reloads++ }
    });
    const userAgent = { iphone: 'iPhone Safari', android: 'Android Chrome', desktop: 'Macintosh Safari' }[device];
    const quiet = { log() {}, info() {},
        warn: (...args) => observations.errors.push(args.join(' ')),
        error: (...args) => observations.errors.push(args.join(' ')) };
    const context = vm.createContext({
        window, document, navigator: { userAgent, platform: device === 'iphone' ? 'iPhone' : 'MacIntel', maxTouchPoints: mobile ? 5 : 0 },
        console: quiet, Wave, localStorage: storage(local), sessionStorage: storage(session),
        fetch: () => new Promise(() => {}),
        performance: { now: () => 0 },
        requestAnimationFrame: callback => { frames.push(callback); return frames.length; }, cancelAnimationFrame() {},
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
        setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}
    });
    for (const [name, source] of sources) {
        vm.runInContext(source, context, { filename: path.join(playerRoot, `${name}.js`) });
    }
    document.dispatch('DOMContentLoaded');
    return {
        audio, button, modal, nativeButton, window, elements, effects: window.soundEffects,
        observations, local, session,
        flushFrames() {
            const pending = frames; frames = [];
            for (const callback of pending) callback(400);
        },
        play() { audio.dispatch('play'); audio.dispatch('playing'); audio.dispatch('timeupdate'); },
        clickAirPlay() {
            audio.dispatch('webkitplaybacktargetavailabilitychanged', { availability: 'available' });
            assert.equal(button.disabled, false, 'available picker must be reachable');
            button.dispatch('click');
        },
        healthy() { assert.deepEqual(observations.errors, [], 'actual modules must initialize without fixture failures'); }
    };
}

function savedEffects() {
    return JSON.stringify({ settings: {
        eq: [5, 0, 0, 0, 0, 0, 0, 0, 0, 0], pitch: 1,
        panner: { enable: false, speed: 25, distance: 5 },
        reverb: { id: 'none', mainGain: 1, sendGain: 0 }
    }, customPresets: [{ name: 'Retained preset', values: Array(10).fill(0) }] });
}

for (const device of ['iphone', 'desktop']) {
    test(`${device} native mode previews saved effects until master explicitly enables them`, () => {
        const f = fixture({ device, nativeMode: true, local: new Map([['lx_sound_effects', savedEffects()]]) });
        f.effects.open();
        assert.equal(f.elements['sound-effects-enable'].checked, false);
        assert.equal(f.elements['sound-effects-controls'].disabled, true);
        assert.equal(f.elements['sound-effects-mode'].hidden, false);
        assert.match(f.elements['sound-effects-mode'].textContent, /原生播放/);
        assert.equal(f.observations.captures, 0);
        assert.equal(JSON.parse(f.local.get('lx_sound_effects')).settings.eq[0], 5);
        f.effects.setEnabled(true);
        assert.equal(f.elements['sound-effects-enable'].checked, true);
        assert.equal(f.elements['sound-effects-controls'].disabled, false);
        assert.equal(f.elements['sound-effects-mode'].hidden, true);
        assert.equal(f.observations.captures, 1);
        f.effects.setEnabled(false);
        assert.equal(f.elements['sound-effects-controls'].disabled, true);
        assert.match(f.elements['sound-effects-mode'].textContent, /旁路/);
        assert.equal(JSON.parse(f.local.get('lx_sound_effects')).settings.eq[0], 5);
        f.healthy();
    });

    test(`${device} explicit master enable exits native mode even with neutral settings`, () => {
        const f = fixture({ device, nativeMode: true });
        f.effects.open(); f.effects.setEnabled(true);
        assert.equal(f.effects.isNativePlaybackPreferred(), false);
        assert.equal(f.elements['sound-effects-enable'].checked, true);
        assert.equal(f.elements['sound-effects-controls'].disabled, false);
        assert.equal(f.observations.captures, 1);
        f.healthy();
    });
}

test('default mobile native playback presents a read-only preview with master off', () => {
    const f = fixture(); f.effects.open();
    assert.equal(f.elements['sound-effects-enable'].checked, false);
    assert.equal(f.elements['sound-effects-controls'].disabled, true);
    assert.match(f.elements['sound-effects-mode'].textContent, /原生播放/);
    assert.equal(f.observations.captures, 0);
    f.healthy();
});

test('wireless playback locks local effect controls and master switch', () => {
    const f = fixture({ wireless: true }); f.effects.open();
    assert.equal(f.elements['sound-effects-enable'].checked, false);
    assert.equal(f.elements['sound-effects-enable'].disabled, true);
    assert.equal(f.elements['sound-effects-controls'].disabled, true);
    assert.match(f.elements['sound-effects-mode'].textContent, /无线投播/);
    f.audio.webkitCurrentPlaybackTargetIsWireless = false;
    f.audio.dispatch('webkitcurrentplaybacktargetiswirelesschanged');
    assert.equal(f.elements['sound-effects-enable'].disabled, false);
    assert.equal(f.elements['sound-effects-controls'].disabled, true);
    f.healthy();
});

test('resetting reverb with saved EQ retains native output, including slider callbacks', () => {
    const f = fixture({ device: 'desktop', nativeMode: true, sliders: true,
        local: new Map([['lx_sound_effects', savedEffects()]]) });
    f.effects.resetReverb();
    f.flushFrames();
    assert.equal(f.effects.isNativePlaybackPreferred(), true);
    assert.equal(f.observations.captures, 0);
    assert.equal(JSON.parse(f.local.get('lx_sound_effects')).settings.reverb.id, 'none');
    f.healthy();
});

for (const route of ['AirPlay', 'Cast']) {
    test(`${route} reverb animation cannot enable DSP after returning local`, () => {
        const f = fixture({ device: 'desktop', nativeMode: true, sliders: true,
            wireless: route === 'AirPlay', cast: route === 'Cast' });
        f.effects.setReverb('hall');
        f.audio.webkitCurrentPlaybackTargetIsWireless = false;
        f.window.LXPlayback.isRemote = false;
        f.flushFrames();
        assert.equal(f.effects.isNativePlaybackPreferred(), true);
        assert.equal(f.observations.captures, 0);
        assert.equal(JSON.parse(f.local.get('lx_sound_effects')).settings.reverb.id, 'hall');
        f.healthy();
    });
}

test('failed playback save prevents native reload and session flags', () => {
    const f = fixture({ device: 'desktop' }); f.play();
    f.window.savePlaybackState = () => false;
    f.effects.restoreNativePlayback();
    assert.equal(f.observations.reloads, 0);
    assert.equal(f.session.size, 0);
    assert.equal(f.effects.isNativePlaybackPreferred(), false);
    assert.equal(f.observations.userErrors.length, 1);
});

test('empty playback state allows native reload without forcing old playback restoration', () => {
    const f = fixture({ device: 'desktop' }); f.play();
    f.window.savePlaybackState = () => null;
    f.effects.restoreNativePlayback();
    assert.equal(f.observations.reloads, 1);
    assert.equal(f.session.get('lx_native_audio_mode'), '1');
    assert.equal(f.session.has('lx_native_audio_restore'), false);
});

test('partial session write is rolled back without reloading or enabling native mode', () => {
    const f = fixture({ device: 'desktop', failSessionWrites: 'lx_native_audio_restore' }); f.play();
    f.effects.restoreNativePlayback();
    assert.equal(f.observations.reloads, 0);
    assert.equal(f.session.size, 0);
    assert.equal(f.effects.isNativePlaybackPreferred(), false);
    assert.equal(f.observations.userErrors.length, 1);
    f.healthy();
});

test('reverb presets and reset update sliders without overwriting later local edits', () => {
    const f = fixture({ device: 'desktop', sliders: true });
    f.effects.setReverb('hall');
    assert.equal(f.effects.isGraphBuilt(), true);
    assert.equal(f.observations.captures, 1);
    assert.equal(f.elements['reverb-main-gain'].value, 80);
    assert.equal(f.elements['reverb-send-gain'].value, 240);
    f.effects.setReverbGain('send', 0.25);
    f.flushFrames();
    assert.equal(JSON.parse(f.local.get('lx_sound_effects')).settings.reverb.sendGain, 0.25);
    f.effects.resetReverb(); f.flushFrames();
    const reverb = JSON.parse(f.local.get('lx_sound_effects')).settings.reverb;
    assert.deepEqual(reverb, { id: 'none', mainGain: 1, sendGain: 0 });
    assert.equal(f.elements['reverb-main-gain'].value, 100);
    assert.equal(f.elements['reverb-send-gain'].value, 0);
    assert.equal(f.observations.captures, 1, 'existing local graph is reused');
    f.healthy();
});

function appFunction(declaration) {
    const source = readFileSync(path.join(playerRoot, '../../app.js'), 'utf8');
    const start = source.indexOf(declaration);
    const end = source.indexOf('\n}', start);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end + 2);
}

test('actual playback saver reports write failure, success and empty state separately', () => {
    const context = {
        currentPlayingSong: { id: 'current' }, currentPlaylist: [{ id: 'current' }],
        currentIndex: 0, audio: { currentTime: 37 }, currentPlayingScope: 'network',
        window: {}, playMode: 'list', currentQuality: '128k',
        console: { error() {} }, localStorage: { setItem() { throw new Error('Quota exceeded'); } }
    };
    vm.runInNewContext(appFunction('function savePlaybackState()'), context);
    assert.equal(context.savePlaybackState(), false);
    let state;
    context.localStorage.setItem = (_key, value) => { state = JSON.parse(value); };
    assert.equal(context.savePlaybackState(), true);
    assert.equal(state.time, 37);
    assert.equal(state.song.id, 'current');
    context.currentPlayingSong = null; context.currentPlaylist = [];
    assert.equal(context.savePlaybackState(), null);
});

test('actual info toast honors AirPlay duration and keeps its default', () => {
    const calls = [];
    const source = readFileSync(path.join(playerRoot, '../../app.js'), 'utf8');
    const definition = source.match(/^function showInfo\([^\n]+/m)[0];
    const context = { showToast: (...args) => calls.push(args) };
    vm.runInNewContext(definition, context);
    context.showInfo('AirPlay', 6500); context.showInfo('normal');
    assert.deepEqual(calls, [['info', 'AirPlay', 6500], ['info', 'normal', 2000]]);
});

test('default iPhone visualization preserves native AirPlay playback', () => {
    const f = fixture(); f.play(); f.effects.init(true); f.clickAirPlay();
    assert.equal(f.observations.captures, 0);
    assert.equal(f.observations.picked, 1);
    f.healthy();
});

for (const device of ['iphone', 'android', 'desktop']) {
    test(`${device} visualizer-only capture gates AirPlay behind native restoration`, () => {
        const f = fixture({ device, adaptive: false }); f.play();
        assert.equal(f.observations.captures, 1);
        assert.equal(f.effects.isGraphBuilt(), false);
        assert.equal(f.effects.needsNativeReload(), true);
        f.clickAirPlay();
        assert.equal(f.observations.picked, 0);
        assert.equal(f.modal.classList.contains('hidden'), false);
        assert.equal(f.nativeButton.hidden, false);
        assert.equal(f.observations.reloads, 0, 'opening the picker must never reload automatically');
        f.healthy();
    });

    test(`${device} native restoration preserves settings and prevents recapture after reload`, () => {
        const local = new Map([
            ['lx_sound_effects', savedEffects()],
            ['lx_playback_state', JSON.stringify({ song: { id: 'fixture-song' }, time: 37, playlist: [{ id: 'fixture-song' }] })]
        ]);
        const before = [...local.entries()];
        const f = fixture({ device, adaptive: false, local }); f.play();
        f.effects.restoreNativePlayback();
        assert.equal(f.observations.saves, 1, 'save the current queue before reloading');
        assert.equal(f.observations.reloads, 1);
        assert.equal(f.session.get('lx_native_audio_mode'), '1');
        assert.equal(f.session.get('lx_native_audio_restore'), '1');
        assert.deepEqual([...local.entries()], before, 'retained effects and queue must not be cleared');
        f.healthy();

        const restored = fixture({ device, adaptive: false, local, session: f.session });
        restored.effects.init(true); restored.play(); restored.window.dispatch('resize');
        assert.equal(restored.effects.isNativePlaybackPreferred(), true);
        assert.equal(restored.observations.captures, 0, 'saved EQ and visualization must not recapture native media');
        assert.equal(restored.effects.isGraphBuilt(), false);
        restored.clickAirPlay();
        assert.equal(restored.observations.picked, 1);
        assert.equal(restored.observations.reloads, 0);
        restored.healthy();
    });

    test(`${device} explicit local effect edit opts out of native mode and captures once`, () => {
        const f = fixture({ device, adaptive: false, nativeMode: true });
        f.play(); f.effects.init(true);
        assert.equal(f.observations.captures, 0);
        f.effects.setEQ(0, 7);
        assert.equal(f.effects.isNativePlaybackPreferred(), false);
        assert.notEqual(f.session.get('lx_native_audio_mode'), '1');
        assert.equal(f.effects.isGraphBuilt(), true);
        assert.equal(f.observations.captures, 1);
        assert.equal(JSON.parse(f.local.get('lx_sound_effects')).settings.eq[0], 7);
        f.effects.setEQ(0, 8); f.play();
        assert.equal(f.observations.captures, 1, 'later edits reuse the media source');
        f.healthy();
    });
}

for (const device of ['android', 'desktop']) {
    test(`${device} normal visualization continues to capture without native preference`, () => {
        const f = fixture({ device }); f.play();
        assert.equal(f.observations.captures, 1);
        assert.equal(f.effects.isGraphBuilt(), false);
        f.healthy();
    });
}

for (const route of ['AirPlay', 'Cast']) {
    test(`${route} effect edits remain saved-only and retain native preference`, () => {
        const f = fixture({ device: 'desktop', nativeMode: true,
            wireless: route === 'AirPlay', cast: route === 'Cast' });
        f.play(); f.effects.init(true);
        f.effects.setEQ(0, 9); f.effects.setPitch(1.2);
        f.effects.setPanner('enable', true); f.effects.setReverbGain('send', 0.6);
        assert.equal(f.observations.captures, 0);
        assert.equal(f.effects.isGraphBuilt(), false);
        assert.equal(f.effects.isNativePlaybackPreferred(), true);
        assert.equal(f.session.get('lx_native_audio_mode'), '1');
        const settings = JSON.parse(f.local.get('lx_sound_effects')).settings;
        assert.equal(settings.eq[0], 9); assert.equal(settings.pitch, 1.2);
        assert.equal(settings.panner.enable, true); assert.equal(settings.reverb.sendGain, 0.6);
        assert.equal(f.observations.reloads, 0);
        f.healthy();
    });
}

test('wireless route changes never trigger automatic reload or another media capture', () => {
    const f = fixture({ adaptive: false }); f.play();
    f.audio.webkitCurrentPlaybackTargetIsWireless = true;
    f.audio.dispatch('webkitcurrentplaybacktargetiswirelesschanged');
    f.audio.webkitCurrentPlaybackTargetIsWireless = false;
    f.audio.dispatch('webkitcurrentplaybacktargetiswirelesschanged');
    assert.equal(f.observations.captures, 1);
    assert.equal(f.observations.reloads, 0);
    f.healthy();
});

test('Control Center handoff after capture opens an actionable restore prompt only once', () => {
    const f = fixture({ adaptive: false }); f.play();
    let opened = 0;
    const open = f.effects.open;
    f.effects.open = function () { opened++; return open.call(this); };
    f.audio.webkitCurrentPlaybackTargetIsWireless = true;
    f.audio.dispatch('webkitcurrentplaybacktargetiswirelesschanged');
    f.audio.dispatch('webkitcurrentplaybacktargetiswirelesschanged');
    assert.equal(opened, 1, 'repeated route events must not reopen the prompt');
    assert.equal(f.modal.classList.contains('hidden'), false);
    assert.equal(f.nativeButton.hidden, false);
    assert.equal(f.observations.info.length, 1);
    assert.match(f.observations.info[0], /刷新|恢复原生/);
    assert.match(f.observations.info[0], /AirPlay/);
    assert.equal(f.observations.reloads, 0);
    assert.equal(f.observations.picked, 0);
    f.healthy();
});

test('native restore reports unavailable storage and does not reload', () => {
    const f = fixture({ device: 'desktop', failSessionWrites: true }); f.play();
    f.effects.restoreNativePlayback();
    assert.equal(f.observations.reloads, 0);
    assert.equal(f.observations.userErrors.length, 1);
    assert.match(f.observations.userErrors[0], /存储|storage/i);
    assert.equal(f.effects.isNativePlaybackPreferred(), false);
    assert.equal(f.session.has('lx_native_audio_mode'), false);
    f.healthy();
});

test('explicit iPhone EQ supplies the adaptive visualizer with its existing analyser', () => {
    const f = fixture({ nativeMode: true }); f.play();
    assert.equal(f.observations.captures, 0);
    f.effects.setEQ(0, 6);
    assert.equal(f.effects.isNativePlaybackPreferred(), false);
    assert.equal(f.effects.isGraphBuilt(), true);
    assert.equal(f.observations.captures, 1);
    assert.equal(f.observations.waveAnalysers.length, 2, 'both visualizers must initialize');
    for (const analyser of f.observations.waveAnalysers) {
        assert.equal(analyser, f.effects.getAnalyser(), 'visualizer must reuse the DSP analyser');
    }
    f.play(); f.window.musicVisualizer.init();
    assert.equal(f.observations.captures, 1);
    f.healthy();
});

test('native preference survives consumption of the one-time playback restore flag', () => {
    const local = new Map([['lx_sound_effects', savedEffects()]]);
    const f = fixture({ device: 'desktop', local }); f.play();
    f.effects.restoreNativePlayback();
    assert.equal(f.session.get('lx_native_audio_restore'), '1');
    // restorePlaybackState consumes this one-time queue/resume signal.
    f.session.delete('lx_native_audio_restore');
    assert.deepEqual([...f.session.entries()], [['lx_native_audio_mode', '1']]);
    const restored = fixture({ device: 'desktop', local, session: f.session });
    restored.effects.init(true); restored.play(); restored.window.dispatch('resize');
    assert.equal(restored.effects.isNativePlaybackPreferred(), true);
    assert.equal(restored.observations.captures, 0);
    assert.equal(restored.effects.isGraphBuilt(), false);
    restored.clickAirPlay();
    assert.equal(restored.observations.picked, 1);
    assert.equal(restored.observations.reloads, 0);
    restored.healthy();
});

test('actual playback restoration honors one-time native return without enabling auto-resume', async () => {
    const source = readFileSync(path.join(playerRoot, '../../app.js'), 'utf8');
    const start = source.indexOf('async function restorePlaybackState()');
    const end = source.indexOf('\n}', start);
    assert.ok(start >= 0 && end > start, 'the actual playback restoration function must exist');
    const session = new Map([['lx_native_audio_restore', '1'], ['lx_native_audio_mode', '1']]);
    const lookups = [];
    const settings = { autoResume: false };
    const context = {
        audio: { isRemote: false }, settings,
        sessionStorage: {
            getItem: key => session.get(key) ?? null,
            removeItem: key => session.delete(key)
        },
        localStorage: { getItem: key => { lookups.push(key); return null; } }
    };
    vm.runInNewContext(source.slice(start, end + 2), context);
    await context.restorePlaybackState();
    assert.deepEqual(lookups, ['lx_playback_state'], 'native return must reach saved-state lookup');
    assert.deepEqual([...session.entries()], [['lx_native_audio_mode', '1']]);
    assert.equal(settings.autoResume, false, 'native return must preserve the user preference');

    await context.restorePlaybackState();
    assert.equal(lookups.length, 1, 'the consumed signal must not force another automatic restore');
    settings.autoResume = true;
    await context.restorePlaybackState();
    assert.deepEqual(lookups, ['lx_playback_state', 'lx_playback_state'], 'ordinary auto-resume must still work');
    assert.equal(session.get('lx_native_audio_mode'), '1');
});

for (const device of ['iphone', 'desktop']) {
    test(`${device} master-off edits and reset retain native playback without capturing`, () => {
        const saved = JSON.parse(savedEffects());
        saved.settings.enabled = false;
        const local = new Map([['lx_sound_effects', JSON.stringify(saved)]]);
        const f = fixture({ device, nativeMode: true, local }); f.play();
        f.effects.setEQ(0, 8); f.effects.setPitch(1.2);
        f.effects.setPanner('enable', true); f.effects.setReverbGain('send', 0.6);
        let settings = JSON.parse(local.get('lx_sound_effects')).settings;
        assert.equal(settings.enabled, false);
        assert.equal(settings.eq[0], 8); assert.equal(settings.pitch, 1.2);
        assert.equal(settings.panner.enable, true); assert.equal(settings.reverb.sendGain, 0.6);
        assert.equal(f.observations.captures, 0);
        assert.equal(f.effects.isNativePlaybackPreferred(), true);

        f.effects.resetAll();
        settings = JSON.parse(local.get('lx_sound_effects')).settings;
        assert.equal(settings.enabled, false);
        assert.deepEqual(settings.eq, Array(10).fill(0));
        assert.equal(settings.pitch, 1); assert.equal(settings.panner.enable, false);
        assert.equal(settings.reverb.id, 'none');
        assert.equal(f.observations.captures, 0);
        assert.equal(f.effects.isGraphBuilt(), false);
        assert.equal(f.effects.isNativePlaybackPreferred(), true);
        assert.equal(f.session.get('lx_native_audio_mode'), '1');
        f.healthy();
    });

    test(`${device} enabling saved active EQ explicitly leaves native mode and captures once`, () => {
        const saved = JSON.parse(savedEffects());
        saved.settings.enabled = false;
        const local = new Map([['lx_sound_effects', JSON.stringify(saved)]]);
        const f = fixture({ device, nativeMode: true, local }); f.play();
        assert.equal(f.observations.captures, 0);
        f.effects.setEnabled(true);
        assert.equal(f.effects.isNativePlaybackPreferred(), false);
        assert.notEqual(f.session.get('lx_native_audio_mode'), '1');
        assert.equal(f.effects.isGraphBuilt(), true);
        assert.equal(f.observations.captures, 1);
        const settings = JSON.parse(local.get('lx_sound_effects')).settings;
        assert.equal(settings.enabled, true); assert.equal(settings.eq[0], 5);
        f.effects.setEnabled(true); f.play();
        assert.equal(f.observations.captures, 1, 'repeated master enable must reuse the captured source');
        f.healthy();
    });
}

for (const route of ['AirPlay', 'Cast']) {
    test(`${route} master enable saves active EQ without leaving native playback`, () => {
        const saved = JSON.parse(savedEffects());
        saved.settings.enabled = false;
        const local = new Map([['lx_sound_effects', JSON.stringify(saved)]]);
        const f = fixture({ device: 'desktop', nativeMode: true, local,
            wireless: route === 'AirPlay', cast: route === 'Cast' }); f.play();
        f.effects.setEnabled(true);
        const settings = JSON.parse(local.get('lx_sound_effects')).settings;
        assert.equal(settings.enabled, true); assert.equal(settings.eq[0], 5);
        assert.equal(f.observations.captures, 0);
        assert.equal(f.effects.isGraphBuilt(), false);
        assert.equal(f.effects.isNativePlaybackPreferred(), true);
        assert.equal(f.session.get('lx_native_audio_mode'), '1');
        assert.equal(f.observations.reloads, 0);
        f.healthy();
    });
}
