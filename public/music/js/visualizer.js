/**
 * Music Visualizer Integration using Wave.js & LX Studio Reference Dual VU Meter
 * Manages independent footer and detail view canvases and syncs with theme color.
 */

/**
 * LX Studio Reference Dual VU Meter Animation
 * Bespoke audiophile stereo VU meter console designed for LX Music.
 * Features brushed dark titanium faceplate, ambient incandescent lamp glow,
 * high-precision dB scales, dynamic peak overload LEDs, and IEC ballistic needles.
 * Fully stretchable and responsive for mobile and desktop window resizing with zero clipping.
 */
/**
 * LX Studio Reference Dual VU Meter Animation
 * Restrained modern audiophile stereo VU meter console designed for LX Music.
 * Features a broad shallow sweeping arc, hidden pivot below bezel, high-contrast ivory needle,
 * calibrated 0 VU = -18 dBFS ANSI C16.5 300ms ballistics, dedicated digital clip indicators,
 * and WCAG-compliant legible typography with zero channel/needle collisions.
 */
/**
 * Per-profile dial & pointer designs.
 * Every colour profile (vuMeterTheme) owns a complete design: dial geometry,
 * scale style, tick style, typography, decorations, pointer shape and pivot cap.
 * Add a new profile with LXStudioVUMeterAnimation.registerDesign(id, design).
 * The measurement scale (norm positions of every tick) is shared by all designs.
 */
const VU_NORM_ZERO = 0.86;
const VU_TICKS_COMPACT = [
    { label: '-20', norm: 0.08, major: true },
    { norm: 0.20, type: 'min' },
    { label: '-10', norm: 0.32, major: true },
    { norm: 0.46, type: 'med' },
    { label: '-5', norm: 0.60, major: true },
    { norm: 0.73, type: 'med' },
    { label: '0', norm: 0.86, major: true, isRed: true },
    { norm: 0.93, type: 'min', isRed: true },
    { label: '+3', norm: 1.00, major: true, isRed: true }
];
const VU_TICKS_FULL = [
    { label: '-20', norm: 0.08, major: true },
    { norm: 0.16, type: 'min' },
    { norm: 0.24, type: 'min' },
    { label: '-10', norm: 0.32, major: true },
    { norm: 0.40, type: 'min' },
    { label: '-7', norm: 0.48, major: false, type: 'med' },
    { label: '-5', norm: 0.60, major: true },
    { norm: 0.67, type: 'min' },
    { label: '-3', norm: 0.73, major: false, type: 'med' },
    { norm: 0.80, type: 'min' },
    { label: '0', norm: 0.86, major: true, isRed: true },
    { label: '+1', norm: 0.91, major: false, type: 'med', isRed: true },
    { label: '+2', norm: 0.95, major: false, type: 'min', isRed: true },
    { label: '+3', norm: 1.00, major: true, isRed: true }
];

const LX_VU_DIAL_DESIGNS = {
    // Classic broadcast meter: warm lamp-lit plate, serif numerals, double scale rail,
    // tapered black blade with a red painted tip, brass corner screws, domed pivot hub.
    'vintage-amber': {
        name: 'Vintage Amber',
        geom: { span: 0.07, baseY: { c: 0.66, f: 0.61 }, sag: { c: 0.07, f: 0.08 }, curve: 2, pivot: { c: 1.95, f: 2.25 } },
        font: { family: 'Georgia, "Times New Roman", serif', weight: '700', style: 'normal', scale: 1.0 },
        tag: ch => ch === 'L' ? 'LEFT' : 'RIGHT', tagAlign: 'center', mark: 'VU', markStyle: 'italic',
        face: {
            kind: 'radial', cy: 0.45,
            light: [[0, '#fffdfa'], [0.40, '#fef8ea'], [0.80, '#fdecc4'], [1, '#fbd38d']],
            dark: [[0, '#ffe8a3'], [0.35, '#f6c343'], [0.75, '#d99b1a'], [1, '#9c6600']],
            vig: { light: ['rgba(180, 120, 20, 0.08)', 'rgba(160, 100, 10, 0.16)'], dark: ['rgba(80, 40, 10, 0.25)', 'rgba(60, 30, 5, 0.38)'], clear: 'rgba(80, 40, 10, 0)' }
        },
        arc: 'double', tick: { style: 'bar', len: 1, lwMajor: 1.3, lwMinor: 0.8 },
        needle: { type: 'blade', reach: 1.2, width: 1 }, cap: 'screw', peak: null, sheen: false, deco: 'vintage',
        light: { ink: '#2b2118', muted: 'rgba(60, 45, 25, 0.7)', arc: '#3a2d1e', red: '#c81e3a', needle: '#16120d', tip: '#c81e3a', glow: 'rgba(255, 200, 90, 0.5)', frame: 'rgba(90, 60, 20, 0.35)', rim: 'rgba(148, 163, 184, 0.55)' },
        dark: { ink: '#2b2118', muted: 'rgba(60, 45, 25, 0.7)', arc: '#3a2d1e', red: '#c81e3a', needle: '#16120d', tip: '#c81e3a', glow: 'rgba(255, 200, 90, 0.5)', frame: 'rgba(90, 60, 20, 0.45)', rim: '#bfa15f' }
    },
    // Marine instrument: deep smiling ellipse-like arc, translucent water band,
    // round dot ticks, drifting wave lines and a luminous pointer ending in a glowing bead.
    'ocean-blue': {
        name: 'Ocean Blue',
        geom: { span: 0.055, baseY: { c: 0.60, f: 0.57 }, sag: { c: 0.12, f: 0.14 }, curve: 1.6, pivot: { c: 1.75, f: 2.0 } },
        font: { family: '"Avenir Next", "Inter", "Segoe UI", Roboto, sans-serif', weight: '600', style: 'normal', scale: 1.0 },
        tag: ch => 'CH · ' + ch, tagAlign: 'center', mark: 'VU', markStyle: 'normal',
        face: {
            kind: 'radial', cy: 0.40,
            light: [[0, '#f8fafc'], [0.45, '#e0f2fe'], [0.85, '#bae6fd'], [1, '#7dd3fc']],
            dark: [[0, '#42d2ff'], [0.35, '#12a4df'], [0.75, '#0369a1'], [1, '#073b64']],
            vig: { light: ['rgba(3, 105, 161, 0.08)', 'rgba(2, 132, 199, 0.15)'], dark: ['rgba(0, 30, 65, 0.30)', 'rgba(0, 20, 50, 0.45)'], clear: 'rgba(0, 30, 65, 0)' }
        },
        arc: 'band', arcBand: 3.6, tick: { style: 'dots', len: 1, lwMajor: 1.5, lwMinor: 0.8 },
        needle: { type: 'lumen', reach: 1.0, width: 1 }, cap: 'jewel', peak: null, sheen: true, deco: 'ocean',
        light: { ink: '#0c4a6e', muted: 'rgba(12, 74, 110, 0.65)', arc: '#0369a1', red: '#e11d48', needle: '#075985', tip: '#0ea5e9', glow: 'rgba(14, 165, 233, 0.55)', wave: 'rgba(3, 105, 161, 0.35)', rim: 'rgba(148, 163, 184, 0.55)' },
        dark: { ink: '#f0f9ff', muted: 'rgba(224, 242, 254, 0.75)', arc: 'rgba(240, 249, 255, 0.9)', red: '#ff7a93', needle: '#f0f9ff', tip: '#ffffff', glow: 'rgba(186, 230, 253, 0.95)', wave: 'rgba(255, 255, 255, 0.45)', rim: '#0e5c8f' }
    },
    // HUD / sci-fi readout: flat wide arc, segmented bar-graph rail that lights with the level,
    // monospace type, corner brackets, scan line and a neon hairline pointer with a diamond head.
    'cyber-cyan': {
        name: 'Cyber Cyan',
        geom: { span: 0.045, baseY: { c: 0.68, f: 0.64 }, sag: { c: 0.05, f: 0.06 }, curve: 4, pivot: { c: 2.2, f: 2.6 } },
        font: { family: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', weight: '700', style: 'normal', scale: 0.95 },
        tag: ch => 'CH_' + ch, tagAlign: 'left', mark: 'VU/dB', markStyle: 'normal',
        face: {
            kind: 'linear',
            light: [[0, '#ffffff'], [0.60, '#f0fdfa'], [1, '#ccfbf1']],
            dark: [[0, '#0c1015'], [0.5, '#070a0e'], [1, '#030508']],
            glow: { color: '6, 182, 212', a0: 0.14, a1: 0.03 }
        },
        arc: 'segments', tick: { style: 'bar', len: 0.85, lwMajor: 1.8, lwMinor: 0.9 },
        needle: { type: 'neon', reach: 1.0, width: 1 }, cap: 'ring', peak: 'segment', sheen: false, deco: 'cyber',
        light: { ink: '#115e59', muted: 'rgba(17, 94, 89, 0.65)', arc: '#0f766e', red: '#e11d48', needle: '#0f766e', tip: '#06b6d4', glow: 'rgba(6, 182, 212, 0.5)', grid: 'rgba(15, 118, 110, 0.35)', rim: 'rgba(148, 163, 184, 0.55)' },
        dark: { ink: '#22d3ee', muted: 'rgba(34, 211, 238, 0.6)', arc: 'rgba(34, 211, 238, 0.9)', red: '#ff2d6f', needle: '#7df9ff', tip: '#00f5ff', glow: '#00f5ff', grid: 'rgba(34, 211, 238, 0.5)', rim: '#1e3040' }
    },
    // Art-deco luxury: sunburst rays radiating from the pivot, double gold frame with corner lozenges,
    // fine wedge ticks capped with pearls, radial serif numerals and a spear pointer with a lozenge.
    'champagne-gold': {
        name: 'Champagne Gold',
        geom: { span: 0.09, baseY: { c: 0.64, f: 0.60 }, sag: { c: 0.10, f: 0.11 }, curve: 2.6, pivot: { c: 1.9, f: 2.2 } },
        font: { family: '"Didot", "Bodoni 72", "Playfair Display", Georgia, serif', weight: '700', style: 'normal', scale: 1.0 },
        tag: ch => '— ' + ch + ' —', tagAlign: 'center', mark: 'VU', markStyle: 'italic', rotateLabels: true,
        face: {
            kind: 'radial', cy: 0.45,
            light: [[0, '#ffffff'], [0.40, '#fefce8'], [0.80, '#fef08a'], [1, '#fde047']],
            dark: [[0, '#fff4cc'], [0.35, '#fae39b'], [0.70, '#dfba63'], [1, '#9b7625']],
            vig: { light: ['rgba(113, 63, 18, 0.06)', 'rgba(113, 63, 18, 0.14)'], dark: ['rgba(60, 45, 20, 0.25)', 'rgba(50, 35, 10, 0.38)'], clear: 'rgba(60, 45, 20, 0)' }
        },
        arc: 'double', arcInset: 2.4, tick: { style: 'wedge', len: 1, lwMajor: 1.6, lwMinor: 0.9 },
        needle: { type: 'deco', reach: 1.0, width: 1 }, cap: 'rosette', peak: null, sheen: true, deco: 'champagne',
        light: { ink: '#3b2a0c', muted: 'rgba(80, 58, 20, 0.7)', arc: '#5a4214', red: '#a61b1b', needle: '#2a1d06', tip: '#b8860b', edge: '#7a5a12', glow: 'rgba(255, 240, 180, 0.6)', ray: 'rgba(255, 230, 150, 0.22)', frame: '#9c7a2a', rim: 'rgba(180, 140, 60, 0.6)' },
        dark: { ink: '#3b2a0c', muted: 'rgba(80, 58, 20, 0.7)', arc: '#5a4214', red: '#a61b1b', needle: '#2a1d06', tip: '#b8860b', edge: '#7a5a12', glow: 'rgba(255, 240, 180, 0.6)', ray: 'rgba(255, 255, 255, 0.16)', frame: '#8a6a1f', rim: '#dab978' }
    },
    // Bauhaus mastering meter: no scale rail, left-aligned channel letter, hairline rule,
    // oversize watermark letter, long thin ticks and a spear-tipped hairline pointer with peak marker.
    'studio-monochrome': {
        name: 'Studio Monochrome',
        geom: { span: 0.10, baseY: { c: 0.67, f: 0.63 }, sag: { c: 0.035, f: 0.04 }, curve: 2, pivot: { c: 2.1, f: 2.4 } },
        font: { family: '"Helvetica Neue", "Inter", Arial, sans-serif', weight: '600', style: 'normal', scale: 1.05 },
        tag: ch => ch, tagAlign: 'left', mark: 'VU', markStyle: 'normal',
        face: {
            kind: 'radial', cy: 0.38,
            light: [[0, '#ffffff'], [0.65, '#f8fafc'], [1, '#edf2f7']],
            dark: [[0, '#191b22'], [0.60, '#101217'], [1, '#08090d']],
            vig: { light: ['rgba(0, 0, 0, 0.03)', 'rgba(0, 0, 0, 0.08)'], dark: ['rgba(0, 0, 0, 0.35)', 'rgba(0, 0, 0, 0.50)'], clear: 'rgba(0, 0, 0, 0)' }
        },
        arc: 'none', tick: { style: 'bar', len: 1.15, lwMajor: 1.1, lwMinor: 0.7 },
        needle: { type: 'hair', reach: 1.0, width: 1 }, cap: 'dot', peak: 'tick', sheen: false, deco: 'mono',
        light: { ink: '#0f172a', muted: 'rgba(15, 23, 42, 0.55)', arc: '#334155', red: '#f43f5e', needle: '#0f172a', tip: '#f43f5e', rule: 'rgba(15, 23, 42, 0.25)', rim: 'rgba(148, 163, 184, 0.55)' },
        dark: { ink: '#f8fafc', muted: 'rgba(226, 232, 240, 0.6)', arc: 'rgba(241, 245, 249, 0.85)', red: '#f43f5e', needle: '#e2e8f0', tip: '#f43f5e', rule: 'rgba(226, 232, 240, 0.25)', rim: '#334155' }
    }
};


class LXStudioVUMeterAnimation {
    constructor(options = {}) {
        this.options = options;
        this.isCompact = !!options.isCompact;
        this.needleNormL = 0.0;
        this.needleNormR = 0.0;
        this.rollingPeakRMS = -8.0;
        this.lastTime = performance.now();
        this.timeBufL = null;
        this.timeBufR = null;
    }

    isLightMode() {
        if (typeof document === 'undefined' || !document.documentElement) return false;
        const el = document.documentElement;
        if (el.classList && el.classList.contains('theme-light')) return true;
        if (el.getAttribute && el.getAttribute('data-appearance') === 'light') return true;
        if (el.classList && el.classList.contains('dark')) return false;
        if (el.getAttribute && el.getAttribute('data-appearance') === 'dark') return false;
        return true;
    }

    roundRect(ctx, x, y, w, h, r) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    vuToNorm(vu) {
        if (vu <= -30) return 0.0;
        if (vu >= 3.0) {
            return Math.min(1.02, 1.0 + (vu - 3.0) * 0.01);
        }
        const table = [
            { vu: -30, norm: 0.00 },
            { vu: -20, norm: 0.08 },
            { vu: -15, norm: 0.18 },
            { vu: -10, norm: 0.32 },
            { vu:  -7, norm: 0.48 },
            { vu:  -5, norm: 0.60 },
            { vu:  -3, norm: 0.73 },
            { vu:  -1, norm: 0.82 },
            { vu:   0, norm: 0.86 },
            { vu:   1, norm: 0.91 },
            { vu:   2, norm: 0.95 },
            { vu:   3, norm: 1.00 }
        ];
        for (let i = 0; i < table.length - 1; i++) {
            if (vu >= table[i].vu && vu <= table[i + 1].vu) {
                const frac = (vu - table[i].vu) / (table[i + 1].vu - table[i].vu);
                return table[i].norm + frac * (table[i + 1].norm - table[i].norm);
            }
        }
        return vu < -30 ? 0.0 : 1.0;
    }

    draw(data, ctx) {
        if (!ctx || !ctx.canvas) return;
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        if (width <= 0 || height <= 0) return;

        const now = performance.now();
        const dt = Math.min((now - this.lastTime) / 1000, 0.1);
        this.lastTime = now;

        const audio = document.getElementById('audio-player');
        const isMutedOrZero = audio && (audio.muted || audio.volume === 0);
        const isPlaying = audio && !audio.paused && !isMutedOrZero && (audio.currentTime > 0 || audio.readyState > 1);

        let targetNormL = 0.0;
        let targetNormR = 0.0;

        if (isPlaying) {
            let rmsL = 0, rmsR = 0;

            // 1. Precise Stereo Time-Domain Waveform Analysis (True RMS)
            const aL = this.options.analyserL || window._sharedAnalyserL;
            const aR = this.options.analyserR || window._sharedAnalyserR;
            if (aL && aR) {
                const sizeL = aL.fftSize || 512;
                const sizeR = aR.fftSize || 512;
                if (!this.timeBufL || this.timeBufL.length !== sizeL) this.timeBufL = new Uint8Array(sizeL);
                if (!this.timeBufR || this.timeBufR.length !== sizeR) this.timeBufR = new Uint8Array(sizeR);
                try {
                    aL.getByteTimeDomainData(this.timeBufL);
                    aR.getByteTimeDomainData(this.timeBufR);

                    let sumSqL = 0, sumSqR = 0;
                    for (let i = 0; i < sizeL; i++) {
                        const vL = (this.timeBufL[i] - 128) / 128;
                        sumSqL += vL * vL;
                    }
                    for (let i = 0; i < sizeR; i++) {
                        const vR = (this.timeBufR[i] - 128) / 128;
                        sumSqR += vR * vR;
                    }
                    rmsL = Math.sqrt(sumSqL / sizeL);
                    rmsR = Math.sqrt(sumSqR / sizeR);
                } catch (_) {}
            }

            // Fallback to frequency data if time domain is flat
            if (rmsL < 1e-4 && rmsR < 1e-4 && data && data.length > 0) {
                let sumEnergy = 0;
                let count = 0;
                for (let i = 0; i < data.length; i++) {
                    const byteVal = data[i];
                    if (byteVal > 0) {
                        const db = -100 + (byteVal / 255) * 70;
                        const lin = Math.pow(10, db / 20);
                        sumEnergy += lin * lin;
                        count++;
                    }
                }
                if (count > 0) {
                    const rms = Math.sqrt(sumEnergy);
                    rmsL = rms;
                    rmsR = rms;
                }
            }

            // 2. Calibrated Master Reference with Dynamic Headroom Tracking
            if (rmsL > 1e-4 || rmsR > 1e-4) {
                const dBFS_L = rmsL > 1e-5 ? 20 * Math.log10(rmsL) : -100;
                const dBFS_R = rmsR > 1e-5 ? 20 * Math.log10(rmsR) : -100;
                const maxDbfs = Math.max(dBFS_L, dBFS_R);

                // Dynamically track the material's peak loudness (mastered music vs dialogue/video)
                // so the VU needle always dances in its expressive sweet spot (-10 VU to 0 VU / +1 VU)
                // without getting stuck at +3 max or pinned at 0.
                if (maxDbfs > -45) {
                    if (maxDbfs > this.rollingPeakRMS) {
                        this.rollingPeakRMS += (maxDbfs - this.rollingPeakRMS) * Math.min(1.0, dt * 4.0);
                    } else {
                        this.rollingPeakRMS += (maxDbfs - this.rollingPeakRMS) * Math.min(1.0, dt * 0.25);
                    }
                }
                const effectiveRef = Math.max(-18.0, Math.min(-5.5, this.rollingPeakRMS + 0.5));

                const vuL = dBFS_L - effectiveRef;
                const vuR = dBFS_R - effectiveRef;

                targetNormL = this.vuToNorm(vuL);
                targetNormR = this.vuToNorm(vuR);
            } else {
                // 3. Intelligent Groove Dynamics Engine (CORS cross-origin or standalone fallback)
                // When audio is actively playing but PCM data is restricted by browser security policies
                const t = now / 1000;
                const vol = typeof audio.volume === 'number' ? audio.volume : 1.0;
                // Typical musical rhythm harmonics (~126 BPM)
                const beat1 = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2.1)), 2.6);
                const beat2 = Math.pow(Math.max(0, Math.sin((t + 0.22) * Math.PI * 1.05)), 2.0) * 0.45;
                const swingL = Math.sin(t * 3.4) * 0.05 + Math.cos(t * 1.1) * 0.07;
                const swingR = Math.cos(t * 3.4 + 0.4) * 0.05 + Math.sin(t * 1.1 + 0.45) * 0.07;
                const microJitter = (Math.sin(t * 16.7) + Math.cos(t * 28.3)) * 0.02;

                // Base level around -10VU ~ -5VU (norm 0.35 ~ 0.55), rhythmic punch up to 0VU (norm 0.86)
                const dynamicBase = 0.42 + beat1 * 0.35 + beat2 * 0.15;
                targetNormL = Math.max(0.08, Math.min(0.92, (dynamicBase + swingL + microJitter) * (0.4 + 0.6 * vol)));
                targetNormR = Math.max(0.08, Math.min(0.92, (dynamicBase + swingR - microJitter) * (0.4 + 0.6 * vol)));
            }
        }

        // 3. ANSI C16.5 Standard VU Ballistics (~300 ms rise and fall integration with responsive attack)
        // Moving-coil movement modelled as a damped spring (slight overshoot like a real VU movement),
        // with hard mechanical stops at both ends of travel.
        const omega = 21.0;
        const zeta = 0.78;
        this.velL = this.velL || 0;
        this.velR = this.velR || 0;
        const steps = Math.max(1, Math.ceil(dt / 0.008));
        const h = dt / steps;
        for (let s = 0; s < steps; s++) {
            this.velL += (omega * omega * (targetNormL - this.needleNormL) - 2 * zeta * omega * this.velL) * h;
            this.velR += (omega * omega * (targetNormR - this.needleNormR) - 2 * zeta * omega * this.velR) * h;
            this.needleNormL += this.velL * h;
            this.needleNormR += this.velR * h;
        }
        const stop = (n, v) => {
            if (n < 0) return [0, Math.abs(v) * 0.25];
            if (n > 1.03) return [1.03, -Math.abs(v) * 0.3];
            return [n, v];
        };
        [this.needleNormL, this.velL] = stop(this.needleNormL, this.velL);
        [this.needleNormR, this.velR] = stop(this.needleNormR, this.velR);

        this.renderConsole(ctx, width, height, this.needleNormL, this.needleNormR, this.isCompact);
    }

    renderConsole(ctx, width, height, levelL, levelR, isCompact) {
        ctx.save();

        // 1. 彻底清空并绘制 100% 实体防透光底板 (Solid Anti-bleed Baseplate)
        ctx.clearRect(0, 0, width, height);

        const theme = (window.settings && window.settings.vuMeterTheme) || this.options.theme || 'vintage-amber';
        const isLight = this.isLightMode();

        const marginX = isCompact ? 3 : 6;
        const marginY = isCompact ? 2 : 5;
        const panelW = width - marginX * 2;
        const panelH = height - marginY * 2;
        const panelX = marginX;
        const panelY = marginY;

        const isMobilePod = isCompact && (panelW < 440 || (typeof window !== 'undefined' && window.innerWidth < 768));
        const scale = isMobilePod
            ? Math.min(panelW / 320, panelH / 40)
            : Math.min(panelW / (isCompact ? 500 : 840), panelH / (isCompact ? 68 : 210));
        const cornerR = (isCompact ? 10 : 12) * scale;

        if (isCompact) {
            // 播放栏紧凑模式：柔和磨砂卡片，与播放栏融为一体，避免硬件外壳的突兀感
            ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(17, 20, 26, 0.96)';
            this.roundRect(ctx, panelX, panelY, panelW, panelH, cornerR);
            ctx.fill();
            ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.07)' : 'rgba(255, 255, 255, 0.07)';
            ctx.lineWidth = 1;
            this.roundRect(ctx, panelX + 0.5, panelY + 0.5, panelW - 1, panelH - 1, cornerR);
            ctx.stroke();
        } else {
        // 100% 实体防穿透遮蔽基底
        ctx.fillStyle = isLight ? '#f8fafc' : '#080a0f';
        this.roundRect(ctx, panelX - 1, panelY - 1, panelW + 2, panelH + 2, cornerR);
        ctx.fill();

        // 2. 现代机架母带硬件外壳 (Precision Aircraft Aluminum / Obsidian Chassis)
        if (isLight) {
            ctx.shadowColor = 'rgba(0, 0, 0, 0.08)';
            ctx.shadowBlur = 8 * scale;
            ctx.shadowOffsetY = 2 * scale;
            const faceGrad = ctx.createLinearGradient(panelX, panelY, panelX, panelY + panelH);
            faceGrad.addColorStop(0, '#ffffff');
            faceGrad.addColorStop(0.35, '#f8fafc');
            faceGrad.addColorStop(0.75, '#f1f5f9');
            faceGrad.addColorStop(1, '#e2e8f0');
            ctx.fillStyle = faceGrad;
            this.roundRect(ctx, panelX, panelY, panelW, panelH, cornerR);
            ctx.fill();
            ctx.shadowColor = 'transparent';

            // Chamfer Inset Highlight
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
            ctx.lineWidth = 1 * scale;
            this.roundRect(ctx, panelX + 0.5, panelY + 0.5, panelW - 1, panelH - 1, cornerR);
            ctx.stroke();

            // Precision Hairline Contour
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.40)';
            ctx.lineWidth = 0.8 * scale;
            this.roundRect(ctx, panelX, panelY, panelW, panelH, cornerR);
            ctx.stroke();
        } else {
            const faceGrad = ctx.createLinearGradient(panelX, panelY, panelX, panelY + panelH);
            if (theme === 'champagne-gold') {
                faceGrad.addColorStop(0, '#2b251d');
                faceGrad.addColorStop(0.5, '#1e1a14');
                faceGrad.addColorStop(1, '#14110d');
            } else {
                faceGrad.addColorStop(0, '#1a1d24');
                faceGrad.addColorStop(0.5, '#121419');
                faceGrad.addColorStop(1, '#090a0d');
            }
            ctx.fillStyle = faceGrad;
            this.roundRect(ctx, panelX, panelY, panelW, panelH, cornerR);
            ctx.fill();

            // Chamfer Edge
            ctx.strokeStyle = theme === 'champagne-gold' ? 'rgba(218, 185, 120, 0.25)' : 'rgba(255, 255, 255, 0.09)';
            ctx.lineWidth = 1 * scale;
            this.roundRect(ctx, panelX + 0.5, panelY + 0.5, panelW - 1, panelH - 1, cornerR);
            ctx.stroke();

            // Outer Rim
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
            ctx.lineWidth = 0.8 * scale;
            this.roundRect(ctx, panelX, panelY, panelW, panelH, cornerR);
            ctx.stroke();
        }
        }

        // 3. 黄金比例空间排版
        const padX = (isCompact ? (isMobilePod ? 4 : 6) : 12) * scale;
        const padY = (isCompact ? (isMobilePod ? 3 : 5) : 8) * scale;
        const innerX = panelX + padX;
        const innerY = panelY + padY;
        const innerW = panelW - padX * 2;
        const innerH = panelH - padY * 2;

        if (isMobilePod) {
            // 手机移动端：自适应单表盘·同轴双指针 (Dual-Needle Studio VU)
            this.drawSingleStereoPod(ctx, innerX, innerY, innerW, innerH, levelL, levelR, scale, theme, isLight);
        } else {
            // PC 紧凑端与详情页：双表头与中桥
            const centerW = (isCompact ? 26 : 72) * scale;
            const gap = (isCompact ? 3 : 10) * scale;
            const meterW = (innerW - centerW - gap * 2) / 2;
            const meterH = innerH;

            const leftX = innerX;
            const centerX = leftX + meterW + gap;
            const rightX = centerX + centerW + gap;

            this.drawMeterPod(ctx, leftX, innerY, meterW, meterH, levelL, scale, 'L', isCompact, theme, isLight);
            this.drawCenterConsole(ctx, centerX, innerY, centerW, meterH, scale, isCompact, theme, isLight, levelL, levelR);
            this.drawMeterPod(ctx, rightX, innerY, meterW, meterH, levelR, scale, 'R', isCompact, theme, isLight);
        }

        ctx.restore();
    }

    getDesign(theme) {
        return LX_VU_DIAL_DESIGNS[theme] || LX_VU_DIAL_DESIGNS['vintage-amber'];
    }

    // Cached paper-grain pattern for printed dial cards (null when no offscreen canvas is available)
    getGrain(ctx) {
        if (this._grain !== undefined) return this._grain;
        this._grain = null;
        try {
            if (typeof document === 'undefined' || typeof document.createElement !== 'function' || typeof ctx.createPattern !== 'function') return null;
            const c = document.createElement('canvas');
            c.width = c.height = 64;
            const g = c.getContext && c.getContext('2d');
            if (!g || typeof g.createImageData !== 'function') return null;
            const img = g.createImageData(64, 64);
            let seed = 1337;
            for (let i = 0; i < img.data.length; i += 4) {
                seed = (seed * 1664525 + 1013904223) >>> 0;
                const v = (seed >>> 24) & 0xff;
                img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
                img.data[i + 3] = 255;
            }
            g.putImageData(img, 0, 0);
            this._grain = ctx.createPattern(c, 'repeat') || null;
        } catch (_) {
            this._grain = null;
        }
        return this._grain;
    }

    static registerDesign(id, design) {
        if (id && design) LX_VU_DIAL_DESIGNS[id] = design;
    }

    // Single-channel pod (desktop / detail view)
    drawMeterPod(ctx, x, y, w, h, level, scale, channelTitle, isCompact, theme, isLight) {
        this.drawDialPod(ctx, x, y, w, h, {
            needles: [{ level, key: channelTitle }],
            scale, isCompact, theme, isLight, title: channelTitle, stereo: false
        });
    }

    // Mobile single dial with coaxial L/R needles
    drawSingleStereoPod(ctx, x, y, w, h, levelL, levelR, scale, theme, isLight) {
        this.drawDialPod(ctx, x, y, w, h, {
            needles: [{ level: levelL, key: 'L', channel: 'L' }, { level: levelR, key: 'R', channel: 'R' }],
            scale, isCompact: true, theme, isLight, title: '', stereo: true
        });
    }

    // Shared dial renderer: geometry, scale, ticks, pointer and decorations all come from the profile's design
    drawDialPod(ctx, x, y, w, h, o) {
        const D = this.getDesign(o.theme);
        const P = o.isLight ? D.light : D.dark;
        const { scale, isCompact, isLight, stereo } = o;
        const compactLike = isCompact || stereo;
        const k = compactLike ? 'c' : 'f';
        const G = D.geom;
        const podR = 8 * scale;
        const nowMs = performance.now();
        const t = nowMs / 1000;
        const sz = stereo ? { maj: 5.5, med: 3.8, min: 2.2, font: 9.2, gap: 4.5, cap: 3.6, tag: 8.5, mark: 10 }
            : isCompact ? { maj: 6, med: 4, min: 2.5, font: 9.8, gap: 5, cap: 3, tag: 8.5, mark: 10.5 }
                : { maj: 11, med: 7, min: 4.5, font: 13, gap: 8, cap: 5, tag: 11, mark: 18.5 };
        const tl = D.tick.len;
        const majLen = sz.maj * scale * tl;
        const medLen = sz.med * scale * tl;
        const minLen = sz.min * scale * tl;
        const fam = D.font.family;

        // Scale geometry (arc shape differs per design)
        const spanX = w * G.span;
        const sx = x + spanX;
        const ex = x + w - spanX;
        const sw = ex - sx;
        const baseY = y + h * G.baseY[k];
        const sag = h * G.sag[k];
        const pivotX = x + w / 2;
        const pivotY = y + h * G.pivot[k];
        const getScalePoint = (norm, off = 0) => {
            const bx = sx + norm * sw;
            const u = Math.abs((norm - 0.5) * 2);
            const by = baseY + Math.pow(u, G.curve) * sag;
            const dx = bx - pivotX;
            const dy = by - pivotY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const ux = dx / dist;
            const uy = dy / dist;
            return { bx: bx + ux * off, by: by + uy * off, ux, uy };
        };

        ctx.save();
        ctx.save();
        this.roundRect(ctx, x, y, w, h, podR);
        ctx.clip();

        // 1. Dial face
        const stops = isLight ? D.face.light : D.face.dark;
        let faceFill;
        if (D.face.kind === 'radial') {
            const cy = y + h * D.face.cy;
            faceFill = ctx.createRadialGradient(x + w / 2, cy, 12 * scale, x + w / 2, cy, Math.max(w * 0.65, h * 1.1));
        } else {
            faceFill = ctx.createLinearGradient(x, y, x, y + h);
        }
        stops.forEach(s => faceFill.addColorStop(s[0], s[1]));
        ctx.fillStyle = faceFill;
        ctx.fillRect(x, y, w, h);

        if (D.face.vig) {
            const v = isLight ? D.face.vig.light : D.face.vig.dark;
            const vg = ctx.createLinearGradient(x, y, x, y + h);
            vg.addColorStop(0, v[0]);
            vg.addColorStop(0.3, D.face.vig.clear);
            vg.addColorStop(0.7, D.face.vig.clear);
            vg.addColorStop(1, v[1]);
            ctx.fillStyle = vg;
            ctx.fillRect(x, y, w, h);
        }
        if (D.face.glow && !isLight) {
            const gl = ctx.createRadialGradient(x + w / 2, y + h * 0.5, 10 * scale, x + w / 2, y + h * 0.5, w * 0.65);
            gl.addColorStop(0, `rgba(${D.face.glow.color}, ${D.face.glow.a0})`);
            gl.addColorStop(0.6, `rgba(${D.face.glow.color}, ${D.face.glow.a1})`);
            gl.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gl;
            ctx.fillRect(x, y, w, h);
        }

        // 1b. Printed-card realism: paper grain, aged edges and a recessed window
        const grain = this.getGrain(ctx);
        if (grain) {
            ctx.save();
            ctx.globalAlpha = isLight ? 0.10 : 0.07;
            ctx.fillStyle = grain;
            ctx.fillRect(x, y, w, h);
            ctx.restore();
        }
        const warm = D.deco === 'vintage' || D.deco === 'champagne';
        const age = ctx.createRadialGradient(x + w / 2, y + h * 0.5, Math.min(w, h) * 0.2, x + w / 2, y + h * 0.5, Math.max(w * 0.62, h * 1.1));
        age.addColorStop(0, 'rgba(0, 0, 0, 0)');
        age.addColorStop(1, warm ? 'rgba(90, 50, 10, 0.28)' : (isLight ? 'rgba(0, 0, 0, 0.10)' : 'rgba(0, 0, 0, 0.30)'));
        ctx.fillStyle = age;
        ctx.fillRect(x, y, w, h);
        const rec = Math.min(10 * scale, h * 0.2);
        const recTop = ctx.createLinearGradient(x, y, x, y + rec);
        recTop.addColorStop(0, 'rgba(0, 0, 0, 0.38)');
        recTop.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = recTop;
        ctx.fillRect(x, y, w, rec);
        const recLeft = ctx.createLinearGradient(x, y, x + rec, y);
        recLeft.addColorStop(0, 'rgba(0, 0, 0, 0.28)');
        recLeft.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = recLeft;
        ctx.fillRect(x, y, rec, h);
        const recRight = ctx.createLinearGradient(x + w, y, x + w - rec * 0.6, y);
        recRight.addColorStop(0, 'rgba(0, 0, 0, 0.14)');
        recRight.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = recRight;
        ctx.fillRect(x + w - rec * 0.6, y, rec * 0.6, h);

        this.drawDialFace(ctx, D, P, { x, y, w, h, scale, isLight, compactLike, gsp: getScalePoint, majLen, gap: sz.gap * scale, fontPx: Math.max(stereo ? 8.0 : 8.5, Math.round(sz.font * scale * D.font.scale)), baseY, pivotX, pivotY });

        // 2. Profile-specific decorations
        this.drawDialDeco(ctx, D, P, { x, y, w, h, scale, t, isLight, isCompact, stereo, pivotX, pivotY, sx, ex, o });

        // 3. Channel tag / stereo legend
        ctx.save();
        const tagSize = Math.max(7.5, Math.round(sz.tag * scale * D.font.scale));
        const tagY = y + (stereo ? 4.5 : (isCompact ? 4.5 : 7.5)) * scale;
        ctx.font = `700 ${tagSize}px ${fam}`;
        ctx.fillStyle = P.muted;
        ctx.textBaseline = 'top';
        ctx.letterSpacing = '1px';
        if (stereo) {
            ctx.textAlign = 'center';
            ctx.fillText('DUAL VU · STEREO', x + w / 2, tagY);
            ctx.textAlign = 'left';
            ctx.fillStyle = '#10b981';
            ctx.beginPath();
            ctx.arc(sx, tagY + 4 * scale, 2 * scale, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = P.muted;
            ctx.fillText('L', sx + 5 * scale, tagY);
            ctx.textAlign = 'right';
            ctx.fillText('R', ex - 5 * scale, tagY);
            ctx.fillStyle = P.red;
            ctx.beginPath();
            ctx.arc(ex, tagY + 4 * scale, 2 * scale, 0, Math.PI * 2);
            ctx.fill();
        } else if (D.tagAlign === 'left') {
            ctx.textAlign = 'left';
            ctx.fillText(D.tag(o.title), sx, tagY);
        } else {
            ctx.textAlign = 'center';
            ctx.fillText(D.tag(o.title), x + w / 2, tagY);
        }
        ctx.restore();

        // 4. Scale rail
        const normZero = VU_NORM_ZERO;
        const maxLevel = Math.max(0, ...o.needles.map(n => Math.min(1, n.level || 0)));
        const strokeRail = (n0, n1, off, color, lw, steps) => {
            ctx.beginPath();
            for (let i = 0; i <= steps; i++) {
                const p = getScalePoint(n0 + (n1 - n0) * (i / steps), off);
                if (i === 0) ctx.moveTo(p.bx, p.by);
                else ctx.lineTo(p.bx, p.by);
            }
            ctx.strokeStyle = color;
            ctx.lineWidth = lw;
            ctx.stroke();
        };
        const railW = (compactLike ? 1.0 : 1.4) * scale;
        const redW = (compactLike ? 1.6 : 2.2) * scale;
        const peaks = this.peaks || (this.peaks = {});
        const peakInfo = o.needles.map(n => {
            const key = (stereo ? 'S' : 'P') + n.key + (compactLike ? 'c' : 'f');
            const pk = peaks[key] || (peaks[key] = { v: 0, t: nowMs, last: nowMs });
            const norm = Math.max(0, Math.min(1, n.level || 0));
            const dt = Math.min(0.1, (nowMs - pk.last) / 1000);
            pk.last = nowMs;
            if (norm >= pk.v) { pk.v = norm; pk.t = nowMs; }
            else if (nowMs - pk.t > 700) pk.v = Math.max(norm, pk.v - dt * 0.5);
            return pk.v;
        });

        if (D.arc === 'double') {
            const off = (D.arcInset || 2.0) * scale;
            strokeRail(0, normZero, 0, P.arc, railW, 40);
            strokeRail(0, normZero, -off, P.arc, railW * 0.55, 40);
            strokeRail(normZero, 1, 0, P.red, redW, 15);
            strokeRail(normZero, 1, -off, P.red, railW * 0.55, 15);
        } else if (D.arc === 'band') {
            const bw = D.arcBand * scale;
            const band = (n0, n1, color, alpha, steps) => {
                ctx.beginPath();
                for (let i = 0; i <= steps; i++) {
                    const p = getScalePoint(n0 + (n1 - n0) * (i / steps), 0);
                    if (i === 0) ctx.moveTo(p.bx, p.by); else ctx.lineTo(p.bx, p.by);
                }
                for (let i = steps; i >= 0; i--) {
                    const p = getScalePoint(n0 + (n1 - n0) * (i / steps), -bw);
                    ctx.lineTo(p.bx, p.by);
                }
                ctx.closePath();
                ctx.globalAlpha = alpha;
                ctx.fillStyle = color;
                ctx.fill();
                ctx.globalAlpha = 1;
            };
            band(0, normZero, P.arc, isLight ? 0.22 : 0.20, 40);
            band(normZero, 1, P.red, 0.5, 15);
            strokeRail(0, normZero, 0, P.arc, railW * 0.8, 40);
            strokeRail(normZero, 1, 0, P.red, redW * 0.8, 15);
        } else if (D.arc === 'segments') {
            const N = compactLike ? 24 : 32;
            const segW = (compactLike ? 1.9 : 2.6) * scale;
            const peakSeg = Math.min(N - 1, Math.floor(Math.max(...peakInfo) * N));
            ctx.lineCap = 'butt';
            for (let i = 0; i < N; i++) {
                const c = (i + 0.5) / N;
                const lit = c <= maxLevel + 0.5 / N;
                const hot = c > normZero;
                ctx.save();
                if (lit || i === peakSeg) {
                    ctx.globalAlpha = 1;
                    if (!isLight) { ctx.shadowColor = hot ? P.red : P.glow; ctx.shadowBlur = 4 * scale; }
                } else {
                    ctx.globalAlpha = 0.2;
                }
                const col = (i === peakSeg && maxLevel < c) ? P.needle : (hot ? P.red : P.tip);
                strokeRail(i / N + 0.004, (i + 0.66) / N, 0, col, segW, 3);
                ctx.restore();
            }
        } else if (D.arc === 'none') {
            strokeRail(normZero, 1, 0, P.red, redW, 15);
        }

        // 5. Ticks
        const ticks = compactLike ? VU_TICKS_COMPACT : VU_TICKS_FULL;
        ticks.forEach(tk => {
            const p = getScalePoint(tk.norm);
            const len = tk.major ? majLen : (tk.type === 'med' ? medLen : minLen);
            const col = tk.isRed ? P.red : P.arc;
            const lw = (tk.major ? (tk.isRed ? D.tick.lwMajor * 1.15 : D.tick.lwMajor) : D.tick.lwMinor) * scale;
            ctx.fillStyle = col;
            ctx.strokeStyle = col;
            if (D.tick.style === 'dots') {
                const r = (tk.major ? 1.5 : 0.85) * scale * (compactLike ? 0.85 : 1);
                const d = tk.major ? len : len * 0.6;
                ctx.beginPath();
                ctx.arc(p.bx + p.ux * d, p.by + p.uy * d, r, 0, Math.PI * 2);
                ctx.fill();
            } else if (D.tick.style === 'wedge') {
                const hw = lw * (tk.major ? 0.9 : 0.6);
                ctx.beginPath();
                ctx.moveTo(p.bx - p.uy * hw, p.by + p.ux * hw);
                ctx.lineTo(p.bx + p.uy * hw, p.by - p.ux * hw);
                ctx.lineTo(p.bx + p.ux * len, p.by + p.uy * len);
                ctx.closePath();
                ctx.fill();
                if (tk.major) {
                    ctx.beginPath();
                    ctx.arc(p.bx + p.ux * (len + 1.6 * scale), p.by + p.uy * (len + 1.6 * scale), 0.9 * scale, 0, Math.PI * 2);
                    ctx.fill();
                }
            } else {
                ctx.lineWidth = lw;
                ctx.beginPath();
                ctx.moveTo(p.bx, p.by);
                ctx.lineTo(p.bx + p.ux * len, p.by + p.uy * len);
                ctx.stroke();
            }
        });

        // 6. Scale labels
        const fontSize = Math.max(stereo ? 8.0 : 8.5, Math.round(sz.font * scale * D.font.scale));
        ctx.font = `${D.font.style === 'italic' ? 'italic ' : ''}${D.font.weight} ${fontSize}px ${fam}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const labelGap = sz.gap * scale + (D.tick.style === 'wedge' ? 2 * scale : 0);
        ticks.forEach(tk => {
            if (!tk.label) return;
            const p = getScalePoint(tk.norm);
            const lx = p.bx + p.ux * (majLen + labelGap);
            const ly = p.by + p.uy * (majLen + labelGap);
            ctx.fillStyle = tk.isRed ? P.red : P.ink;
            if (D.rotateLabels) {
                ctx.save();
                ctx.translate(lx, ly);
                ctx.rotate(Math.atan2(p.uy, p.ux) + Math.PI / 2);
                ctx.fillText(tk.label, 0, 0);
                ctx.restore();
            } else {
                ctx.fillText(tk.label, lx, ly);
            }
        });

        // 7. Centre mark
        ctx.save();
        const markSize = Math.max(7.5, Math.round((compactLike ? 9.2 : 13.0) * scale * D.font.scale));
        ctx.font = `${D.markStyle === 'italic' ? 'italic ' : ''}800 ${markSize}px ${fam}`;
        ctx.fillStyle = P.muted;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.letterSpacing = '2px';
        ctx.fillText(D.mark, x + w / 2, baseY + sz.mark * scale);
        ctx.restore();

        // 8. Peak-hold markers (designs that opt in)
        if (D.peak === 'tick') {
            o.needles.forEach((n, i) => {
                const norm = Math.max(0, Math.min(1, n.level || 0));
                if (peakInfo[i] <= norm + 0.02) return;
                const p = getScalePoint(Math.min(1, peakInfo[i]));
                ctx.strokeStyle = P.tip;
                ctx.lineWidth = 1.8 * scale;
                ctx.beginPath();
                ctx.moveTo(p.bx - p.ux * 1.5 * scale, p.by - p.uy * 1.5 * scale);
                ctx.lineTo(p.bx + p.ux * (majLen + 2 * scale), p.by + p.uy * (majLen + 2 * scale));
                ctx.stroke();
            });
        }

        // 9. Pointers
        const baseNY = y + h + 2 * scale;
        const drawNeedle = (norm, tipColor, shadowSide) => {
            const tp = getScalePoint(norm);
            const dx = tp.bx - pivotX;
            const dy = tp.by - pivotY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const nux = dx / dist;
            const nuy = dy / dist;
            const npX = -nuy;
            const npY = nux;
            const reach = majLen + 1.2 * scale * D.needle.reach;
            const tx = tp.bx + nux * reach;
            const ty = tp.by + nuy * reach;
            const tB = (baseNY - pivotY) / nuy;
            const bx = pivotX + tB * nux;
            const by = baseNY;
            const pt = (r) => ({ x: bx + (tx - bx) * r, y: by + (ty - by) * r });
            const poly = (r0, w0, r1, w1, fill) => {
                const a = pt(r0);
                const b = pt(r1);
                ctx.beginPath();
                ctx.moveTo(a.x - npX * w0, a.y - npY * w0);
                ctx.lineTo(a.x + npX * w0, a.y + npY * w0);
                ctx.lineTo(b.x + npX * w1, b.y + npY * w1);
                ctx.lineTo(b.x - npX * w1, b.y - npY * w1);
                ctx.closePath();
                ctx.fillStyle = fill;
                ctx.fill();
            };
            const bw = (compactLike ? 0.9 : 1.3) * scale * D.needle.width;
            const tw = (compactLike ? 0.25 : 0.35) * scale;
            const wAt = (r, b0, t0) => b0 + (t0 - b0) * r;
            const type = D.needle.type;

            ctx.save();
            if (type === 'lumen' || type === 'neon') {
                ctx.shadowColor = P.glow;
                ctx.shadowBlur = (type === 'neon' ? 8 : 6) * scale;
            } else {
                // Pointer floats above the card: a crisp, offset cast shadow (lit from the upper left)
                ctx.shadowColor = isLight ? 'rgba(30, 20, 10, 0.38)' : 'rgba(0, 0, 0, 0.60)';
                ctx.shadowBlur = (compactLike ? 1.2 : 1.8) * scale;
                ctx.shadowOffsetX = (stereo ? 1.6 + shadowSide * 0.6 : 2.2) * scale;
                ctx.shadowOffsetY = (compactLike ? 1.8 : 2.6) * scale;
            }

            if (type === 'blade') {
                const b0 = bw * 1.15;
                poly(0, b0, 0.68, wAt(0.68, b0, tw), P.needle);
                poly(0.68, wAt(0.68, b0, tw), 1, tw, tipColor);
            } else if (type === 'lumen') {
                const a = pt(0);
                const b = pt(0.94);
                ctx.lineCap = 'round';
                ctx.strokeStyle = P.needle;
                ctx.lineWidth = (compactLike ? 1.3 : 1.9) * scale;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
                ctx.shadowBlur = 0;
                ctx.strokeStyle = isLight ? 'rgba(255,255,255,0.75)' : 'rgba(14,116,144,0.55)';
                ctx.lineWidth = 0.5 * scale;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
                ctx.shadowColor = P.glow;
                ctx.shadowBlur = 7 * scale;
                ctx.fillStyle = tipColor;
                ctx.beginPath();
                ctx.arc(b.x, b.y, (compactLike ? 1.9 : 2.8) * scale, 0, Math.PI * 2);
                ctx.fill();
            } else if (type === 'neon') {
                const a = pt(0);
                const b = pt(0.92);
                ctx.lineCap = 'butt';
                ctx.strokeStyle = P.needle;
                ctx.lineWidth = (compactLike ? 0.9 : 1.2) * scale;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
                const dz = (compactLike ? 2.4 : 3.4) * scale;
                const c = pt(0.96);
                ctx.fillStyle = tipColor;
                ctx.beginPath();
                ctx.moveTo(c.x + nux * dz, c.y + nuy * dz);
                ctx.lineTo(c.x + npX * dz * 0.55, c.y + npY * dz * 0.55);
                ctx.lineTo(c.x - nux * dz, c.y - nuy * dz);
                ctx.lineTo(c.x - npX * dz * 0.55, c.y - npY * dz * 0.55);
                ctx.closePath();
                ctx.fill();
            } else if (type === 'deco') {
                const b0 = bw * 1.5;
                poly(0, b0, 0.8, b0 * 0.32, P.needle);
                poly(0.8, b0 * 0.32, 1, tw * 0.6, P.needle);
                const c = pt(0.8);
                const L = (compactLike ? 3.0 : 4.4) * scale;
                const W = (compactLike ? 1.5 : 2.1) * scale;
                ctx.beginPath();
                ctx.moveTo(c.x + nux * L, c.y + nuy * L);
                ctx.lineTo(c.x + npX * W, c.y + npY * W);
                ctx.lineTo(c.x - nux * L, c.y - nuy * L);
                ctx.lineTo(c.x - npX * W, c.y - npY * W);
                ctx.closePath();
                ctx.fillStyle = tipColor;
                ctx.fill();
                ctx.strokeStyle = P.edge;
                ctx.lineWidth = 0.6 * scale;
                ctx.stroke();
            } else {
                const hw = (compactLike ? 0.5 : 0.7) * scale;
                poly(0, hw, 0.78, hw * 0.75, P.needle);
                poly(0.78, (compactLike ? 1.0 : 1.4) * scale, 1, tw * 0.7, tipColor);
            }
            ctx.restore();
            return { bx, by };
        };

        let lastBase = { bx: pivotX, by: baseNY };
        o.needles.forEach((n) => {
            const norm = Math.max(0, Math.min(1.0, n.level || 0));
            const color = stereo ? (n.channel === 'L' ? '#10b981' : P.red) : P.tip;
            lastBase = drawNeedle(norm, color, n.channel === 'L' ? -1 : 1);
        });

        // 10. Pivot cap
        const capX = stereo ? pivotX : lastBase.bx;
        const capY = baseNY;
        const capR = sz.cap * scale;
        ctx.save();
        const disc = (r) => { ctx.beginPath(); ctx.arc(capX, capY, r, 0, Math.PI * 2); };
        if (D.cap === 'screw' || D.cap === 'rosette' || D.cap === 'jewel') {
            const cg = ctx.createRadialGradient(capX - 0.5, capY - 0.5, 0.5, capX, capY, capR);
            if (D.cap === 'rosette') {
                cg.addColorStop(0, '#fff3c4'); cg.addColorStop(0.5, '#d4a93c'); cg.addColorStop(1, '#6b4a0c');
            } else if (D.cap === 'jewel') {
                cg.addColorStop(0, '#e0f7ff'); cg.addColorStop(0.45, isLight ? '#38bdf8' : '#7dd3fc'); cg.addColorStop(1, '#075985');
            } else if (isLight) {
                cg.addColorStop(0, '#ffffff'); cg.addColorStop(0.5, '#cbd5e1'); cg.addColorStop(1, '#64748b');
            } else {
                cg.addColorStop(0, '#d9c28a'); cg.addColorStop(0.55, '#8a6b2c'); cg.addColorStop(1, '#3b2a0c');
            }
            ctx.fillStyle = cg;
            disc(capR);
            ctx.fill();
            if (D.cap === 'screw') {
                ctx.strokeStyle = 'rgba(30, 20, 5, 0.6)';
                ctx.lineWidth = 0.7 * scale;
                ctx.beginPath();
                ctx.moveTo(capX - capR * 0.6, capY);
                ctx.lineTo(capX + capR * 0.6, capY);
                ctx.stroke();
            } else if (D.cap === 'rosette') {
                ctx.strokeStyle = P.edge;
                ctx.lineWidth = 0.6 * scale;
                disc(capR);
                ctx.stroke();
                ctx.fillStyle = P.edge;
                disc(capR * 0.3);
                ctx.fill();
            }
        } else if (D.cap === 'ring') {
            ctx.shadowColor = P.glow;
            ctx.shadowBlur = isLight ? 0 : 5 * scale;
            ctx.strokeStyle = P.needle;
            ctx.lineWidth = 1.1 * scale;
            disc(capR);
            ctx.stroke();
            ctx.fillStyle = P.tip;
            disc(capR * 0.35);
            ctx.fill();
        } else {
            ctx.fillStyle = P.needle;
            disc(capR * 0.8);
            ctx.fill();
        }
        ctx.restore();

        // 11. Glass reflection
        const glass = ctx.createLinearGradient(x, y, x, y + h * 0.45);
        glass.addColorStop(0, isLight ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.08)');
        glass.addColorStop(0.5, isLight ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.02)');
        glass.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = glass;
        ctx.fillRect(x, y, w, h * 0.45);
        if (D.sheen) {
            const sg = ctx.createLinearGradient(x, y, x + w, y + h);
            sg.addColorStop(0.28, 'rgba(255, 255, 255, 0)');
            sg.addColorStop(0.42, isLight ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.10)');
            sg.addColorStop(0.55, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = sg;
            ctx.fillRect(x, y, w, h);
        }
        ctx.restore(); // end clip

        // 12. Bezel
        if (isCompact || stereo) {
            ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.08)';
            ctx.lineWidth = 1;
            this.roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, podR);
            ctx.stroke();
        } else {
            // Machined metal bezel: brushed gradient ring with inner shadow lip and a specular top edge
            const warmMetal = D.deco === 'vintage' || D.deco === 'champagne';
            const ringW = 3.2 * scale;
            const mg = ctx.createLinearGradient(x, y - ringW, x, y + h + ringW);
            if (warmMetal) {
                mg.addColorStop(0, '#f4dfa4'); mg.addColorStop(0.25, '#b68a3a'); mg.addColorStop(0.55, '#6e4f17'); mg.addColorStop(0.8, '#c9a557'); mg.addColorStop(1, '#4a3410');
            } else if (D.deco === 'mono') {
                mg.addColorStop(0, '#f1f5f9'); mg.addColorStop(0.3, '#94a3b8'); mg.addColorStop(0.6, '#475569'); mg.addColorStop(1, '#1e293b');
            } else {
                mg.addColorStop(0, '#e2e8f0'); mg.addColorStop(0.3, '#7c8da3'); mg.addColorStop(0.6, '#3b4a5e'); mg.addColorStop(1, '#141c27');
            }
            ctx.strokeStyle = mg;
            ctx.lineWidth = ringW;
            this.roundRect(ctx, x - ringW / 2, y - ringW / 2, w + ringW, h + ringW, podR + ringW / 2);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
            ctx.lineWidth = 0.6 * scale;
            this.roundRect(ctx, x - ringW, y - ringW, w + ringW * 2, h + ringW * 2, podR + ringW);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
            ctx.lineWidth = 1.0 * scale;
            this.roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, podR);
            ctx.stroke();
            ctx.strokeStyle = P.rim;
            ctx.lineWidth = 0.6 * scale;
            this.roundRect(ctx, x - 0.5, y - 0.5, w + 1, h + 1, podR);
            ctx.stroke();
        }
        ctx.restore();
    }

    // Per-profile dial face layout: scale window, printed zones and panel structure (under scale and pointer)
    drawDialFace(ctx, D, P, c) {
        const { x, y, w, h, scale, isLight, compactLike, gsp, majLen, gap, fontPx, baseY, pivotX, pivotY } = c;
        const outer = majLen + gap + fontPx * 0.75;
        const inner = -(compactLike ? 3 : 5) * scale;
        const small = Math.max(6, Math.round(7 * scale));
        const dash = (a) => { if (typeof ctx.setLineDash === 'function') ctx.setLineDash(a); };
        const band = (n0, n1, a, b, steps = 36) => {
            ctx.beginPath();
            for (let i = 0; i <= steps; i++) {
                const p = gsp(n0 + (n1 - n0) * (i / steps), a);
                if (i === 0) ctx.moveTo(p.bx, p.by); else ctx.lineTo(p.bx, p.by);
            }
            for (let i = steps; i >= 0; i--) {
                const p = gsp(n0 + (n1 - n0) * (i / steps), b);
                ctx.lineTo(p.bx, p.by);
            }
            ctx.closePath();
        };
        const lower = (n0, n1) => {
            ctx.beginPath();
            for (let i = 0; i <= 36; i++) {
                const p = gsp(n0 + (n1 - n0) * (i / 36), inner);
                if (i === 0) ctx.moveTo(p.bx, p.by); else ctx.lineTo(p.bx, p.by);
            }
            ctx.lineTo(x + w, y + h);
            ctx.lineTo(x, y + h);
            ctx.closePath();
        };
        ctx.save();
        if (D.deco === 'vintage') {
            // Cream scale window set into a darker lacquered housing, red zone printed as a tint
            lower(-0.045, 1.045);
            ctx.fillStyle = isLight ? 'rgba(90, 55, 15, 0.12)' : 'rgba(50, 28, 5, 0.28)';
            ctx.fill();
            band(-0.045, 1.045, inner, outer);
            const wg = ctx.createLinearGradient(x, y, x, y + h);
            wg.addColorStop(0, isLight ? 'rgba(255, 253, 242, 0.80)' : 'rgba(255, 249, 228, 0.62)');
            wg.addColorStop(1, isLight ? 'rgba(255, 244, 214, 0.40)' : 'rgba(255, 232, 165, 0.28)');
            ctx.fillStyle = wg;
            ctx.fill();
            band(VU_NORM_ZERO, 1.045, inner, outer, 12);
            ctx.fillStyle = 'rgba(200, 30, 58, 0.11)';
            ctx.fill();
            ctx.strokeStyle = P.frame;
            ctx.lineWidth = 1.0 * scale;
            band(-0.045, 1.045, inner, outer);
            ctx.stroke();
            ctx.lineWidth = 0.5 * scale;
            band(-0.03, 1.03, inner + 1.6 * scale, outer - 1.6 * scale);
            ctx.stroke();
            if (!compactLike) {
                ctx.font = `700 ${small}px ${D.font.family}`;
                ctx.fillStyle = P.muted;
                ctx.textBaseline = 'middle';
                ctx.letterSpacing = '2px';
                ctx.textAlign = 'left';
                ctx.fillText('LX AUDIO', x + 12 * scale, y + h - 9 * scale);
                ctx.textAlign = 'right';
                ctx.fillText('PRECISION METER', x + w - 12 * scale, y + h - 9 * scale);
            }
        } else if (D.deco === 'ocean') {
            // Sonar chart: radial bearing lines and range rings swept from the pivot, calm surface band
            const d0 = pivotY - baseY;
            const half = Math.atan2(w * 0.55, d0);
            const a0 = -Math.PI / 2 - half;
            const a1 = -Math.PI / 2 + half;
            const deep = ctx.createLinearGradient(x, y + h * 0.55, x, y + h);
            deep.addColorStop(0, 'rgba(0, 40, 90, 0)');
            deep.addColorStop(1, isLight ? 'rgba(3, 105, 161, 0.18)' : 'rgba(0, 20, 55, 0.40)');
            ctx.fillStyle = deep;
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = P.wave;
            ctx.lineWidth = 0.5 * scale;
            ctx.globalAlpha = 0.55;
            const rays = 16;
            for (let i = 0; i <= rays; i++) {
                const a = a0 + (a1 - a0) * (i / rays);
                ctx.beginPath();
                ctx.moveTo(pivotX + Math.cos(a) * (d0 - h * 0.35), pivotY + Math.sin(a) * (d0 - h * 0.35));
                ctx.lineTo(pivotX + Math.cos(a) * (d0 + h * 0.75), pivotY + Math.sin(a) * (d0 + h * 0.75));
                ctx.stroke();
            }
            for (let k = -1; k <= 3; k++) {
                ctx.beginPath();
                ctx.arc(pivotX, pivotY, d0 + k * h * 0.17, a0, a1);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
            band(-0.03, 1.03, inner, outer);
            const sg = ctx.createLinearGradient(x, y, x, y + h);
            sg.addColorStop(0, isLight ? 'rgba(255, 255, 255, 0.50)' : 'rgba(255, 255, 255, 0.16)');
            sg.addColorStop(1, isLight ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.04)');
            ctx.fillStyle = sg;
            ctx.fill();
            ctx.strokeStyle = P.arc;
            ctx.globalAlpha = 0.45;
            ctx.lineWidth = 0.7 * scale;
            ctx.stroke();
            ctx.globalAlpha = 1;
            if (!compactLike) {
                ctx.font = `600 ${small}px ${D.font.family}`;
                ctx.fillStyle = P.muted;
                ctx.textBaseline = 'middle';
                ctx.letterSpacing = '2px';
                ctx.textAlign = 'left';
                ctx.fillText('SONAR · LEVEL', x + 12 * scale, y + h - 9 * scale);
                ctx.textAlign = 'right';
                ctx.fillText('dB RE 0 VU', x + w - 12 * scale, y + h - 9 * scale);
            }
        } else if (D.deco === 'cyber') {
            // Chamfered HUD panel with dashed scale lane, bottom ruler and data readouts
            const b = 4 * scale;
            const cc = 7 * scale;
            ctx.beginPath();
            ctx.moveTo(x + b + cc, y + b);
            ctx.lineTo(x + w - b, y + b);
            ctx.lineTo(x + w - b, y + h - b - cc);
            ctx.lineTo(x + w - b - cc, y + h - b);
            ctx.lineTo(x + b, y + h - b);
            ctx.lineTo(x + b, y + b + cc);
            ctx.closePath();
            ctx.fillStyle = isLight ? 'rgba(15, 118, 110, 0.05)' : 'rgba(6, 182, 212, 0.05)';
            ctx.fill();
            ctx.strokeStyle = P.grid;
            ctx.lineWidth = 0.8 * scale;
            ctx.stroke();
            band(-0.02, 1.02, inner, outer);
            ctx.save();
            ctx.globalAlpha = 0.55;
            dash([2.5 * scale, 2.5 * scale]);
            ctx.lineWidth = 0.6 * scale;
            ctx.stroke();
            ctx.restore();
            const ry = y + h - b - 3.5 * scale;
            const n = Math.max(8, Math.floor(w / (5 * scale)));
            ctx.globalAlpha = 0.5;
            ctx.lineWidth = 0.6 * scale;
            ctx.beginPath();
            for (let i = 0; i <= n; i++) {
                const px = x + b + cc + (w - 2 * (b + cc)) * (i / n);
                ctx.moveTo(px, ry);
                ctx.lineTo(px, ry - (i % 5 === 0 ? 3.2 : 1.6) * scale);
            }
            ctx.stroke();
            ctx.globalAlpha = 1;
            if (!compactLike) {
                ctx.font = `700 ${small}px ${D.font.family}`;
                ctx.fillStyle = P.muted;
                ctx.textBaseline = 'middle';
                ctx.letterSpacing = '1px';
                ctx.textAlign = 'right';
                ctx.fillText('RMS 300ms', x + w - b - 6 * scale, y + b + 7 * scale);
                ctx.textAlign = 'left';
                ctx.fillText('ref -18 dBFS', x + b + 6 * scale, y + h - b - 12 * scale);
            }
        } else if (D.deco === 'champagne') {
            // Arched cartouche with pearl-studded border above a pinstriped gold pedestal
            lower(-0.05, 1.05);
            const pg = ctx.createLinearGradient(x, y + h * 0.6, x, y + h);
            pg.addColorStop(0, isLight ? 'rgba(150, 105, 20, 0.10)' : 'rgba(110, 70, 10, 0.18)');
            pg.addColorStop(1, isLight ? 'rgba(120, 80, 10, 0.26)' : 'rgba(70, 40, 5, 0.42)');
            ctx.fillStyle = pg;
            ctx.fill();
            ctx.save();
            lower(-0.05, 1.05);
            ctx.clip();
            ctx.strokeStyle = P.frame;
            ctx.globalAlpha = 0.18;
            ctx.lineWidth = 0.5 * scale;
            const step = Math.max(2.5, 3 * scale);
            ctx.beginPath();
            for (let px = x; px <= x + w; px += step) { ctx.moveTo(px, y); ctx.lineTo(px, y + h); }
            ctx.stroke();
            ctx.restore();
            band(-0.05, 1.05, inner, outer);
            const cg = ctx.createLinearGradient(x, y, x, y + h);
            cg.addColorStop(0, isLight ? 'rgba(255, 255, 250, 0.75)' : 'rgba(255, 252, 236, 0.60)');
            cg.addColorStop(1, isLight ? 'rgba(255, 248, 215, 0.35)' : 'rgba(255, 236, 170, 0.25)');
            ctx.fillStyle = cg;
            ctx.fill();
            ctx.strokeStyle = P.frame;
            ctx.lineWidth = 1.1 * scale;
            ctx.stroke();
            ctx.lineWidth = 0.5 * scale;
            band(-0.035, 1.035, inner + 1.8 * scale, outer - 1.8 * scale);
            ctx.stroke();
            ctx.fillStyle = P.frame;
            const pearls = compactLike ? 14 : 22;
            for (let i = 0; i <= pearls; i++) {
                const p = gsp(-0.035 + 1.07 * (i / pearls), outer);
                ctx.beginPath();
                ctx.arc(p.bx, p.by, (compactLike ? 0.6 : 0.85) * scale, 0, Math.PI * 2);
                ctx.fill();
            }
            if (!compactLike) {
                ctx.font = `italic 700 ${small}px ${D.font.family}`;
                ctx.fillStyle = P.muted;
                ctx.textBaseline = 'middle';
                ctx.letterSpacing = '3px';
                ctx.textAlign = 'left';
                ctx.fillText('LX AUDIO', x + 12 * scale, y + h - 9 * scale);
                ctx.textAlign = 'right';
                ctx.fillText('MASTER SERIES', x + w - 12 * scale, y + h - 9 * scale);
            }
        } else if (D.deco === 'mono') {
            // Bauhaus layout: solid overload block, heavy top bar and a baseline rule
            const zx = gsp(VU_NORM_ZERO).bx;
            ctx.fillStyle = P.red;
            ctx.globalAlpha = isLight ? 0.10 : 0.16;
            ctx.fillRect(zx, y, x + w - zx, h);
            ctx.globalAlpha = 0.5;
            ctx.fillRect(zx, y, 0.8 * scale, h);
            ctx.globalAlpha = 1;
            ctx.fillStyle = P.ink;
            ctx.fillRect(x, y, w, (compactLike ? 1.8 : 3) * scale);
            const by = y + h - (compactLike ? 4 : 8) * scale;
            ctx.strokeStyle = P.rule;
            ctx.lineWidth = 0.6 * scale;
            ctx.beginPath();
            ctx.moveTo(x + 8 * scale, by);
            ctx.lineTo(x + w - 8 * scale, by);
            ctx.stroke();
            if (!compactLike) {
                ctx.font = `600 ${small}px ${D.font.family}`;
                ctx.fillStyle = P.muted;
                ctx.textBaseline = 'bottom';
                ctx.letterSpacing = '2px';
                ctx.textAlign = 'left';
                ctx.fillText('dB', x + 10 * scale, by - 2 * scale);
                ctx.textAlign = 'right';
                ctx.fillText('LX / 01', x + w - 10 * scale, by - 2 * scale);
            }
        }
        ctx.restore();
    }

    // Decorative layer unique to each profile (drawn on the face, under scale and pointer)
    drawDialDeco(ctx, D, P, c) {
        const { x, y, w, h, scale, t, isLight } = c;
        ctx.save();
        if (D.deco === 'vintage') {
            const g = ctx.createRadialGradient(x + w / 2, y + h * 0.35, 4 * scale, x + w / 2, y + h * 0.35, w * 0.5);
            g.addColorStop(0, P.glow);
            g.addColorStop(1, 'rgba(255, 200, 90, 0)');
            ctx.globalAlpha = isLight ? 0.35 : 0.55;
            ctx.fillStyle = g;
            ctx.fillRect(x, y, w, h);
            ctx.globalAlpha = 1;
            const inset = 2.5 * scale;
            ctx.strokeStyle = P.frame;
            ctx.lineWidth = 0.9 * scale;
            this.roundRect(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2, 5 * scale);
            ctx.stroke();
            const r = 1.4 * scale;
            [[x + 6 * scale, y + 6 * scale], [x + w - 6 * scale, y + 6 * scale], [x + 6 * scale, y + h - 6 * scale], [x + w - 6 * scale, y + h - 6 * scale]].forEach(([px, py]) => {
                ctx.fillStyle = '#b08d57';
                ctx.beginPath();
                ctx.arc(px, py, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = 'rgba(40, 25, 5, 0.7)';
                ctx.lineWidth = 0.5 * scale;
                ctx.beginPath();
                ctx.moveTo(px - r * 0.7, py - r * 0.7);
                ctx.lineTo(px + r * 0.7, py + r * 0.7);
                ctx.stroke();
            });
        } else if (D.deco === 'ocean') {
            ctx.strokeStyle = P.wave;
            ctx.lineWidth = 0.8 * scale;
            const amp = 1.6 * scale;
            const wl = w / 5;
            for (let i = 0; i < 3; i++) {
                const wy = y + h * (0.80 + i * 0.07);
                ctx.beginPath();
                for (let px = 0; px <= w; px += Math.max(2, w / 48)) {
                    const yy = wy + Math.sin((px / wl) * Math.PI * 2 + t * (0.5 + i * 0.15) + i) * amp;
                    if (px === 0) ctx.moveTo(x + px, yy); else ctx.lineTo(x + px, yy);
                }
                ctx.stroke();
            }
        } else if (D.deco === 'cyber') {
            const b = 3 * scale;
            const L = 7 * scale;
            ctx.strokeStyle = P.grid;
            ctx.lineWidth = 1 * scale;
            [[x + b, y + b, 1, 1], [x + w - b, y + b, -1, 1], [x + b, y + h - b, 1, -1], [x + w - b, y + h - b, -1, -1]].forEach(([px, py, sx2, sy2]) => {
                ctx.beginPath();
                ctx.moveTo(px + sx2 * L, py);
                ctx.lineTo(px, py);
                ctx.lineTo(px, py + sy2 * L);
                ctx.stroke();
            });
            ctx.globalAlpha = 0.25;
            ctx.lineWidth = 0.5 * scale;
            for (let i = 1; i < 4; i++) {
                const gy = y + h * (0.74 + i * 0.06);
                ctx.beginPath();
                ctx.moveTo(x + b, gy);
                ctx.lineTo(x + w - b, gy);
                ctx.stroke();
            }
            ctx.globalAlpha = isLight ? 0.18 : 0.22;
            const scanX = x + ((t * 0.12) % 1) * w;
            const sg = ctx.createLinearGradient(scanX - 14 * scale, 0, scanX + 2 * scale, 0);
            sg.addColorStop(0, 'rgba(0, 245, 255, 0)');
            sg.addColorStop(1, P.glow);
            ctx.fillStyle = sg;
            ctx.fillRect(scanX - 14 * scale, y, 16 * scale, h);
        } else if (D.deco === 'champagne') {
            const R = (c.pivotY - y) + h;
            const half = Math.atan2(w * 0.6, c.pivotY - y);
            const n = 18;
            const step = (half * 2) / n;
            ctx.fillStyle = P.ray;
            for (let i = 0; i < n; i += 2) {
                const a0 = -Math.PI / 2 - half + i * step;
                const a1 = a0 + step;
                ctx.beginPath();
                ctx.moveTo(c.pivotX, c.pivotY);
                ctx.lineTo(c.pivotX + R * Math.cos(a0), c.pivotY + R * Math.sin(a0));
                ctx.lineTo(c.pivotX + R * Math.cos(a1), c.pivotY + R * Math.sin(a1));
                ctx.closePath();
                ctx.fill();
            }
            ctx.strokeStyle = P.frame;
            ctx.lineWidth = 0.9 * scale;
            this.roundRect(ctx, x + 2.2 * scale, y + 2.2 * scale, w - 4.4 * scale, h - 4.4 * scale, 5 * scale);
            ctx.stroke();
            ctx.lineWidth = 0.5 * scale;
            this.roundRect(ctx, x + 4.2 * scale, y + 4.2 * scale, w - 8.4 * scale, h - 8.4 * scale, 4 * scale);
            ctx.stroke();
            const d = 2.6 * scale;
            ctx.fillStyle = P.frame;
            [[x + 8 * scale, y + 8 * scale], [x + w - 8 * scale, y + 8 * scale], [x + 8 * scale, y + h - 8 * scale], [x + w - 8 * scale, y + h - 8 * scale]].forEach(([px, py]) => {
                ctx.beginPath();
                ctx.moveTo(px, py - d);
                ctx.lineTo(px + d, py);
                ctx.lineTo(px, py + d);
                ctx.lineTo(px - d, py);
                ctx.closePath();
                ctx.fill();
            });
        } else if (D.deco === 'mono') {
            if (!c.stereo) {
                ctx.globalAlpha = isLight ? 0.06 : 0.07;
                ctx.fillStyle = P.ink;
                ctx.font = `800 ${Math.round(h * 0.7)}px ${D.font.family}`;
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillText(c.o.title, x + w - 6 * scale, y + h * 0.5);
                ctx.globalAlpha = 1;
            }
            const ry = y + (c.isCompact || c.stereo ? 15 : 24) * scale;
            ctx.strokeStyle = P.rule;
            ctx.lineWidth = 0.6 * scale;
            ctx.beginPath();
            ctx.moveTo(c.sx, ry);
            ctx.lineTo(c.ex, ry);
            ctx.stroke();
        }
        ctx.restore();
    }


    drawCenterConsole(ctx, x, y, w, h, scale, isCompact, theme, isLight, levelL, levelR) {
        if (isCompact) {
            this.drawCompactBridge(ctx, x, y, w, h, scale, isLight, levelL, levelR);
            return;
        }
        ctx.save();
        const cornerR = (isCompact ? 5 : 8) * scale;

        // 1. 沉降式拉丝金属基座
        if (isLight) {
            const grad = ctx.createLinearGradient(x, y, x, y + h);
            grad.addColorStop(0, '#f8fafc');
            grad.addColorStop(1, '#e2e8f0');
            ctx.fillStyle = grad;
            this.roundRect(ctx, x, y, w, h, cornerR);
            ctx.fill();

            ctx.strokeStyle = 'rgba(148, 163, 184, 0.40)';
            ctx.lineWidth = 0.8 * scale;
            this.roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, cornerR);
            ctx.stroke();
        } else {
            ctx.fillStyle = theme === 'champagne-gold' ? '#181510' : '#0e1014';
            this.roundRect(ctx, x, y, w, h, cornerR);
            ctx.fill();

            ctx.strokeStyle = theme === 'champagne-gold' ? 'rgba(218, 185, 120, 0.18)' : 'rgba(255, 255, 255, 0.06)';
            ctx.lineWidth = 0.8 * scale;
            this.roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, cornerR);
            ctx.stroke();
        }

        const cx = x + w / 2;
        const cy = y + h / 2;

        // 2. 现代极简品牌标识 (LX AUDIO Precision Badge)
        ctx.save();
        const logoSize = Math.max(7.5, Math.round((isCompact ? 8.8 : 12.0) * scale));
        ctx.font = `700 ${logoSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif`;
        ctx.fillStyle = isLight ? '#059669' : ((theme === 'vintage-amber' || theme === 'champagne-gold') ? '#d4af37' : '#10b981');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.letterSpacing = '1.5px';
        ctx.fillText('LX AUDIO', cx, isCompact ? (cy - 9 * scale) : (cy - 14 * scale));
        ctx.restore();

        // 3. 立体声动态信号 LED 呼吸指示灯 (Stereo Signal Dynamic LEDs)
        const ledSpacing = (isCompact ? 6.5 : 10.5) * scale;
        const ledY = isCompact ? (cy - 1 * scale) : (cy - 2 * scale);
        const ledR = (isCompact ? 1.6 : 2.4) * scale;

        const valL = Math.max(0, Math.min(1.0, levelL || 0));
        const valR = Math.max(0, Math.min(1.0, levelR || 0));

        const drawLED = (lx, val) => {
            ctx.save();
            ctx.fillStyle = isLight ? '#cbd5e1' : '#05070a';
            ctx.beginPath();
            if (typeof ctx.arc === 'function') {
                ctx.arc(lx, ledY, ledR + 0.5 * scale, 0, Math.PI * 2);
            } else {
                this.roundRect(ctx, lx - ledR - 0.5 * scale, ledY - ledR - 0.5 * scale, (ledR + 0.5 * scale) * 2, (ledR + 0.5 * scale) * 2, ledR);
            }
            ctx.fill();

            const isActive = val > 0.08;
            const alpha = isActive ? Math.min(1.0, 0.45 + val * 0.55) : 0.20;
            const ledColor = val > 0.86 ? `rgba(244, 63, 94, ${alpha})` : `rgba(16, 185, 129, ${alpha})`;

            if (isActive) {
                ctx.shadowColor = val > 0.86 ? '#f43f5e' : '#10b981';
                ctx.shadowBlur = (isCompact ? 3.5 : 6.0) * scale * val;
            }

            ctx.fillStyle = ledColor;
            ctx.beginPath();
            if (typeof ctx.arc === 'function') {
                ctx.arc(lx, ledY, ledR, 0, Math.PI * 2);
            } else {
                this.roundRect(ctx, lx - ledR, ledY - ledR, ledR * 2, ledR * 2, ledR);
            }
            ctx.fill();
            ctx.restore();
        };

        drawLED(cx - ledSpacing, valL);
        drawLED(cx + ledSpacing, valR);

        // 4. 精密工程标 (字号加大清晰度提升)
        ctx.save();
        ctx.font = `600 ${Math.max(6.0, Math.round((isCompact ? 6.8 : 8.5) * scale))}px monospace`;
        ctx.fillStyle = isLight ? '#64748b' : 'rgba(148, 163, 184, 0.7)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('0VU REF', cx, isCompact ? (cy + 7.5 * scale) : (cy + 10 * scale));

        if (!isCompact) {
            ctx.font = `600 ${Math.max(5.5, Math.round(6.5 * scale))}px -apple-system, BlinkMacSystemFont, Arial, sans-serif`;
            ctx.fillStyle = isLight ? '#94a3b8' : 'rgba(100, 116, 139, 0.7)';
            ctx.fillText('STUDIO REF', cx, cy + 20 * scale);
        }
        ctx.restore();

        ctx.restore();
    }

    // 紧凑模式中桥：无底座，仅竖排 L/R 信号灯 + VU 小标，保持与播放栏一致的轻盈感
    drawCompactBridge(ctx, x, y, w, h, scale, isLight, levelL, levelR) {
        ctx.save();
        const cx = x + w / 2;
        const cy = y + h / 2;
        const accent = '#10b981';
        const muted = isLight ? 'rgba(100, 116, 139, 0.75)' : 'rgba(148, 163, 184, 0.7)';
        const ledR = Math.max(1.8, 2.2 * scale);
        const fs = Math.max(7, Math.round(7.5 * scale));

        const drawRow = (label, val, ry) => {
            const v = Math.max(0, Math.min(1, val || 0));
            const active = v > 0.08;
            const hot = v > 0.86;
            ctx.font = `700 ${fs}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = muted;
            ctx.fillText(label, cx - 1 * scale, ry);

            ctx.save();
            if (active) {
                ctx.shadowColor = hot ? '#f43f5e' : accent;
                ctx.shadowBlur = 5 * scale * v;
            }
            const a = active ? Math.min(1, 0.45 + v * 0.55) : 0.25;
            ctx.fillStyle = hot ? `rgba(244, 63, 94, ${a})` : (active ? `rgba(16, 185, 129, ${a})` : (isLight ? '#cbd5e1' : '#334155'));
            ctx.beginPath();
            ctx.arc(cx + 2 * scale + ledR, ry, ledR, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        };

        const rowGap = Math.min(h * 0.22, 13 * scale);
        drawRow('L', levelL, cy - rowGap);
        drawRow('R', levelR, cy + rowGap * 0.15);

        ctx.font = `800 ${Math.max(6.5, Math.round(7 * scale))}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = accent;
        ctx.fillText('VU', cx, cy + rowGap * 1.35);
        ctx.restore();
    }

}

const musicVisualizer = (function () {
    let audioContext, audioSource, audioAnalyser;
    let splitterNode, analyserL, analyserR;
    let waveFooter, waveDetail;
    let isInitialized = false;

    let standaloneRafId = null;
    let standaloneFooterVU = null;
    let standaloneDetailVU = null;

    const audio = document.getElementById('audio-player');
    const footerCanvas = document.getElementById('footer-visualizer');
    const detailCanvas = document.getElementById('detail-visualizer');
    const playerFooter = document.getElementById('player-footer');

    function isMobileDevice() {
        const ua = navigator.userAgent;
        const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
        return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (isTouch && window.innerWidth < 1024);
    }

    function isDetailVisible() {
        const view = document.getElementById('view-player-detail');
        return !!view && !view.classList.contains('hidden') && !view.classList.contains('translate-y-[100%]');
    }

    /**
     * Standalone animation loop: used when Wave is bypassed, during initialization, or when rendering real/calibrated data.
     */
    function drawFallbackBars(ctx, width, height, themeColor, globalStyle, data) {
        const isPlaying = audio && !audio.paused;
        const numBars = Math.min(64, Math.max(16, Math.floor(width / 6.5)));
        const barWidth = Math.max(2, (width / numBars) - 1.5);

        // Check for real frequency spectrum data
        let hasRealAudio = false;
        if (data && data.length > 0 && isPlaying) {
            let sum = 0;
            const checkLimit = Math.min(64, data.length);
            for (let i = 0; i < checkLimit; i++) sum += data[i];
            if (sum > 20) hasRealAudio = true;
        }

        ctx.fillStyle = themeColor;
        for (let i = 0; i < numBars; i++) {
            let hRatio = 0.04;
            if (hasRealAudio) {
                // Map logarithmic/non-linear frequency bands to spectrum bars
                const binIdx = Math.min(data.length - 1, Math.floor(Math.pow(i / numBars, 1.35) * (data.length * 0.72)));
                const val = (data[binIdx] || 0) / 255;
                hRatio = Math.max(0.06, Math.min(0.96, val * 1.18));
            } else if (isPlaying) {
                // Gentle idle breathing only when no PCM data is yet available
                const t = performance.now() * 0.0018;
                const wave = Math.sin(t * 1.8 + i * 0.25) * 0.04;
                hRatio = Math.max(0.04, 0.07 + wave);
            }
            const barH = hRatio * height;
            const x = i * (width / numBars);
            const y = height - barH;

            if (globalStyle === 'blocks') {
                const blockSize = 4;
                const blockGap = 1;
                const totalBlocks = Math.floor(barH / (blockSize + blockGap));
                for (let b = 0; b < totalBlocks; b++) {
                    const by = height - (b + 1) * (blockSize + blockGap);
                    ctx.fillRect(x, by, barWidth, blockSize);
                }
            } else {
                ctx.beginPath();
                if (typeof ctx.roundRect === 'function') {
                    ctx.roundRect(x, y, barWidth, barH, [2, 2, 0, 0]);
                } else {
                    ctx.fillRect(x, y, barWidth, barH);
                }
                ctx.fill();
            }
        }
    }

    function drawFallbackWave(ctx, width, height, themeColor, data) {
        const isPlaying = audio && !audio.paused;
        let hasRealAudio = false;
        if (data && data.length > 0 && isPlaying) {
            let sum = 0;
            const checkLimit = Math.min(64, data.length);
            for (let i = 0; i < checkLimit; i++) sum += data[i];
            if (sum > 20) hasRealAudio = true;
        }

        ctx.save();
        ctx.strokeStyle = themeColor;
        ctx.fillStyle = themeColor;
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(0, height);
        const steps = 36;
        for (let s = 0; s <= steps; s++) {
            const x = (s / steps) * width;
            let y = height * 0.88;
            if (hasRealAudio) {
                const binIdx = Math.min(data.length - 1, Math.floor((s / steps) * (data.length * 0.65)));
                const val = (data[binIdx] || 0) / 255;
                y = height * 0.92 - val * (height * 0.82);
            } else if (isPlaying) {
                const t = performance.now() * 0.002;
                const wave = Math.sin(t * 2.2 + s * 0.35) * 0.08;
                y = height * 0.85 - wave * height;
            }
            ctx.lineTo(x, y);
        }
        ctx.lineTo(width, height);
        ctx.closePath();
        ctx.fill();

        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
            const x = (s / steps) * width;
            let y = height * 0.88;
            if (hasRealAudio) {
                const binIdx = Math.min(data.length - 1, Math.floor((s / steps) * (data.length * 0.65)));
                const val = (data[binIdx] || 0) / 255;
                y = height * 0.92 - val * (height * 0.82);
            } else if (isPlaying) {
                const t = performance.now() * 0.002;
                const wave = Math.sin(t * 2.2 + s * 0.35) * 0.08;
                y = height * 0.85 - wave * height;
            }
            if (s === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
    }

    /**
     * Standalone animation loop: used when Wave is bypassed or not yet initialized
     */
    function triggerStandaloneLoop() {
        const s = window.settings || {};
        const isFooterWanted = s.showFooterVisualizer && footerCanvas;
        const isDetailWanted = s.showDetailVisualizer && detailCanvas && isDetailVisible();

        // If Wave is running, do NOT run standalone loop to prevent frame collision
        if (isInitialized && waveFooter && waveDetail) {
            if (standaloneRafId) {
                cancelAnimationFrame(standaloneRafId);
                standaloneRafId = null;
            }
            return;
        }

        if (!isFooterWanted && !isDetailWanted) {
            if (standaloneRafId) {
                cancelAnimationFrame(standaloneRafId);
                standaloneRafId = null;
            }
            return;
        }

        if (standaloneRafId) return;

        function renderLoop() {
            const currentSettings = window.settings || {};
            const needFooter = currentSettings.showFooterVisualizer && footerCanvas;
            const needDetail = currentSettings.showDetailVisualizer && detailCanvas && isDetailVisible();

            if (isInitialized || (!needFooter && !needDetail)) {
                standaloneRafId = null;
                return;
            }

            const themeColor = getComputedStyle(document.documentElement).getPropertyValue('--c-500').trim() || '#10b981';
            const globalStyle = currentSettings.visualizerGlobalStyle || 'blocks';

            let realData = null;
            if (audioAnalyser) {
                realData = new Uint8Array(audioAnalyser.frequencyBinCount);
                audioAnalyser.getByteFrequencyData(realData);
            }

            if (needFooter) {
                if (footerCanvas.width === 0 || footerCanvas.height === 0) syncSize();
                const ctx = footerCanvas.getContext('2d');
                ctx.clearRect(0, 0, footerCanvas.width, footerCanvas.height);
                const footerStyle = currentSettings.footerVisualizerStyle || 'bars';

                if (footerStyle === 'vumeter') {
                    if (!standaloneFooterVU) standaloneFooterVU = new LXStudioVUMeterAnimation({ isCompact: true, analyserL, analyserR });
                    standaloneFooterVU.draw(realData, ctx);
                } else if (footerStyle === 'wave') {
                    drawFallbackWave(ctx, footerCanvas.width, footerCanvas.height, themeColor, realData);
                } else {
                    drawFallbackBars(ctx, footerCanvas.width, footerCanvas.height, themeColor, globalStyle, realData);
                }
            }

            if (needDetail) {
                if (detailCanvas.width === 0 || detailCanvas.height === 0) syncSize();
                const ctx = detailCanvas.getContext('2d');
                ctx.clearRect(0, 0, detailCanvas.width, detailCanvas.height);
                const detailStyle = currentSettings.detailVisualizerStyle || 'pulse';

                if (detailStyle === 'vumeter') {
                    if (!standaloneDetailVU) standaloneDetailVU = new LXStudioVUMeterAnimation({ isCompact: false, analyserL, analyserR });
                    standaloneDetailVU.draw(realData, ctx);
                } else if (detailStyle === 'wave') {
                    drawFallbackWave(ctx, detailCanvas.width, detailCanvas.height, themeColor, realData);
                } else {
                    drawFallbackBars(ctx, detailCanvas.width, detailCanvas.height, themeColor, globalStyle, realData);
                }
            }

            standaloneRafId = requestAnimationFrame(renderLoop);
        }

        standaloneRafId = requestAnimationFrame(renderLoop);
    }

    /**
     * Initialize AudioContext and AnalyserNode.
     */
    function init() {
        if (isInitialized || !audio) return;

        const isFooterOn = window.settings ? window.settings.showFooterVisualizer !== false : true;
        const isDetailOn = window.settings ? window.settings.showDetailVisualizer : false;
        const isAnyVisualizerWanted = isFooterOn || isDetailOn;
        const hasEffectsAnalyser = window.soundEffects && window.soundEffects.getAnalyser && window.soundEffects.getAnalyser();

        if (!isAnyVisualizerWanted && !hasEffectsAnalyser) {
            console.log('[Visualizer] Visualizer disabled. Skipping AudioContext creation.');
            return;
        }

        // Only avoid Web Audio when wireless target like AirPlay is actively routing stream
        if (audio.webkitCurrentPlaybackTargetIsWireless) {
            triggerStandaloneLoop();
            return;
        }

        if (!window.Wave) return;

        try {
            console.log('[Visualizer] Initializing AudioContext & Visualizer graph...');
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            audioContext = window._sharedAudioContext || (window.soundEffects && window.soundEffects.getContext && window.soundEffects.getContext()) || (window._sharedAudioContext = new AudioContextClass({ latencyHint: 'playback' }));

            if (hasEffectsAnalyser && window.soundEffects && window.soundEffects.isGraphBuilt && window.soundEffects.isGraphBuilt()) {
                audioAnalyser = window.soundEffects.getAnalyser();
                audioSource = window.soundEffects.getSourceNode ? window.soundEffects.getSourceNode() : window._sharedAudioSourceNode;
                console.log('[Visualizer] Using analyser from SoundEffectsManager (exclusive output)');
            } else {
                audioSource = window._sharedAudioSourceNode || (window._sharedAudioSourceNode = audioContext.createMediaElementSource(audio));
                audioAnalyser = window._sharedAudioAnalyser || (window._sharedAudioAnalyser = audioContext.createAnalyser());
                
                try { audioSource.disconnect(); } catch (_) { }
                try { audioAnalyser.disconnect(); } catch (_) { }
                audioSource.connect(audioAnalyser);
                audioAnalyser.connect(audioContext.destination);

                // iOS keep-alive bridge
                if (window.iOSBackgroundAudio && typeof window.iOSBackgroundAudio.init === 'function') {
                    window.iOSBackgroundAudio.init(audioContext, audioAnalyser);
                }
            }

            audioAnalyser.smoothingTimeConstant = 0.65; // Snappy, punchy response
            audioAnalyser.fftSize = 512;

            // Stereo channel splitting for independent Left & Right needle dynamics
            try {
                splitterNode = audioContext.createChannelSplitter(2);
                analyserL = audioContext.createAnalyser();
                analyserR = audioContext.createAnalyser();
                analyserL.smoothingTimeConstant = 0.65;
                analyserR.smoothingTimeConstant = 0.65;
                analyserL.fftSize = 512;
                analyserR.fftSize = 512;
                audioSource.connect(splitterNode);
                splitterNode.connect(analyserL, 0);
                splitterNode.connect(analyserR, 1);
                window._sharedAnalyserL = analyserL;
                window._sharedAnalyserR = analyserR;
                window._sharedSplitterNode = splitterNode;
            } catch (err) {
                console.warn('[Visualizer] Stereo splitter setup fallback to mono:', err);
                analyserL = audioAnalyser;
                analyserR = audioAnalyser;
                window._sharedAnalyserL = audioAnalyser;
                window._sharedAnalyserR = audioAnalyser;
            }

            if (audioContext.state === 'suspended') {
                audioContext.resume().catch(() => {});
            }

            waveFooter = new Wave(audioAnalyser, footerCanvas);
            waveDetail = new Wave(audioAnalyser, detailCanvas);

            isInitialized = true;
            console.log('[Visualizer] Initialized successfully with live audio capture');

            // Cancel any standalone loop now that Wave is handling it
            if (standaloneRafId) {
                cancelAnimationFrame(standaloneRafId);
                standaloneRafId = null;
            }

            syncSize();
            applySettings();
        } catch (e) {
            console.error('[Visualizer] Initialization failed:', e);
            syncSize();
            triggerStandaloneLoop();
        }
    }

    /**
     * Sync canvas resolutions with DPR.
     */
    function syncSize() {
        [footerCanvas, detailCanvas].forEach(canvas => {
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.round(rect.width * dpr);
            canvas.height = Math.round(rect.height * dpr);
        });
    }

    /**
     * Apply independent settings for Footer and Detail.
     */
    function applySettings() {
        syncSize();

        const s = window.settings || {};
        const isMobile = window.innerWidth < 768;
        const themeColor = getComputedStyle(document.documentElement).getPropertyValue('--c-500').trim() || '#10b981';
        const opacity = s.visualizerOpacity !== undefined ? s.visualizerOpacity : 0.85;
        const globalStyle = s.visualizerGlobalStyle || 'blocks';
        const globalGap = globalStyle === 'blocks' ? 2 : 0;
        const visualizerContainer = document.getElementById('visualizer-container');
        const progressRow = document.getElementById('player-progress-row');

        if (!isInitialized) {
            triggerStandaloneLoop();
            if (s.showFooterVisualizer && footerCanvas && visualizerContainer) {
                if (s.footerVisualizerStyle === 'vumeter') {
                    if (progressRow) progressRow.style.marginTop = isMobile ? '24px' : '';
                    footerCanvas.style.opacity = opacity;
                    visualizerContainer.style.width = '100%';
                    visualizerContainer.style.maxWidth = isMobile ? 'calc(100% - 16px)' : '460px';
                    visualizerContainer.style.left = '50%';
                    visualizerContainer.style.transform = 'translateX(-50%)';
                    visualizerContainer.style.bottom = isMobile ? '16px' : '';
                    visualizerContainer.style.marginBottom = '';
                    visualizerContainer.style.height = isMobile ? '40px' : (window.innerHeight <= 845 ? '58px' : '72px');
                    visualizerContainer.style.display = 'flex';
                    visualizerContainer.style.zIndex = isMobile ? '1' : '5';
                } else {
                    if (progressRow) progressRow.style.marginTop = '';
                    visualizerContainer.style.width = '100%';
                    visualizerContainer.style.maxWidth = '';
                    visualizerContainer.style.left = '0';
                    visualizerContainer.style.transform = '';
                    visualizerContainer.style.bottom = '';
                    visualizerContainer.style.marginBottom = '';
                    visualizerContainer.style.height = isMobile ? '62px' : (window.innerHeight <= 845 ? '50px' : '80px');
                    visualizerContainer.style.display = 'flex';
                    visualizerContainer.style.zIndex = '1';
                }
                footerCanvas.style.opacity = opacity;
                syncSize();
            } else if (progressRow) {
                progressRow.style.marginTop = '';
            }
            if (s.showDetailVisualizer && detailCanvas) {
                if (s.detailVisualizerStyle === 'vumeter') {
                    detailCanvas.style.opacity = opacity;
                }
            }
            return;
        }

        // --- Handle Footer Visualizer ---
        waveFooter.clearAnimations();

        if (s.showFooterVisualizer && footerCanvas && visualizerContainer) {
            const style = s.footerVisualizerStyle || 'bars';
            const containerRect = visualizerContainer.getBoundingClientRect();
            const containerWidth = containerRect.width;

            let count, gap, lineWidth, cubeHeight;

            if (style === 'vumeter') {
                if (progressRow) progressRow.style.marginTop = isMobile ? '24px' : '';
                visualizerContainer.style.width = '100%';
                visualizerContainer.style.maxWidth = isMobile ? 'calc(100% - 16px)' : '460px';
                visualizerContainer.style.left = '50%';
                visualizerContainer.style.transform = 'translateX(-50%)';
                visualizerContainer.style.bottom = isMobile ? '16px' : '';
                visualizerContainer.style.marginBottom = '';
                visualizerContainer.style.height = isMobile ? '40px' : (window.innerHeight <= 845 ? '58px' : '72px');
                visualizerContainer.style.zIndex = isMobile ? '1' : '5';
                footerCanvas.style.width = '100%';
                footerCanvas.style.height = '100%';
                syncSize();
                waveFooter.addAnimation(new LXStudioVUMeterAnimation({ isCompact: true, analyserL, analyserR }));
                footerCanvas.style.opacity = opacity;
            } else {
                if (progressRow) progressRow.style.marginTop = '';
                visualizerContainer.style.width = '100%';
                visualizerContainer.style.maxWidth = '';
                visualizerContainer.style.left = '0';
                visualizerContainer.style.transform = '';
                visualizerContainer.style.bottom = '';
                visualizerContainer.style.marginBottom = '';
                visualizerContainer.style.height = isMobile ? '62px' : (window.innerHeight <= 845 ? '50px' : '80px');
                visualizerContainer.style.zIndex = '1';
                if (globalStyle === 'blocks') {
                    gap = 1;
                    lineWidth = 0;
                    cubeHeight = 4;
                    const targetPitch = 5;
                    const maxCount = Math.floor(containerWidth / targetPitch);
                    count = Math.min(maxCount, 1024);
                    footerCanvas.style.width = '100%';
                    footerCanvas.style.height = '100%';
                } else {
                    gap = 0;
                    lineWidth = 2;
                    cubeHeight = undefined;
                    const targetPitch = 6;
                    const maxCount = Math.floor(containerWidth / targetPitch);
                    count = Math.min(maxCount, 1024);
                    footerCanvas.style.width = '100%';
                    footerCanvas.style.height = '100%';
                }

                syncSize();

                const options = {
                    fillColor: themeColor,
                    lineColor: themeColor,
                    lineWidth: lineWidth,
                    count: count,
                    rounded: true,
                    bottom: true,
                    gap: gap
                };

                if (cubeHeight !== undefined) {
                    options.cubeHeight = cubeHeight;
                }

                let AnimationClass = waveFooter.animations.Cubes;
                if (style === 'wave') {
                    AnimationClass = waveFooter.animations.Wave;
                }

                waveFooter.addAnimation(new AnimationClass(options));
                footerCanvas.style.opacity = opacity;
            }

            const footerIsHidden = playerFooter && playerFooter.classList.contains('translate-y-[110%]');
            const isShortWindow = window.innerHeight <= 845;
            visualizerContainer.style.zIndex = isMobile ? '1' : (style === 'vumeter' ? '5' : '1');
            visualizerContainer.style.display = 'flex';
            if (playerFooter) {
                playerFooter.style.transition = 'height 0.3s ease';
                if (window.innerWidth >= 768) {
                    playerFooter.style.height = isShortWindow ? '90px' : (style === 'vumeter' ? '125px' : '150px');
                    playerFooter.style.justifyContent = 'center';
                } else {
                    playerFooter.style.height = '';
                    playerFooter.style.justifyContent = '';
                }
            }

            if (audioContext && audioContext.state === 'suspended' && audio && !audio.paused) {
                audioContext.resume();
            }

            const mainViews = document.querySelectorAll('#view-search, #view-favorites, #view-settings, #view-about, #view-player-detail, #view-songlist, #songlist-detail-view, #view-leaderboard');
            let targetPb = footerIsHidden ? '' : (isShortWindow ? '120px' : '180px');

            mainViews.forEach(view => {
                view.style.transition = 'padding-bottom 0.3s ease, padding-top 0.3s ease';
                let pb = targetPb;

                if (view.id === 'view-player-detail') {
                    const container = view.querySelector('#player-detail-container');
                    if (container) {
                        const needsTopPadding = !footerIsHidden && window.innerWidth >= 768;
                        container.style.marginTop = needsTopPadding ? '60px' : '';
                        const extraPb = pb === '' ? '' : Math.max(0, parseInt(pb) - 96) + 'px';
                        container.style.marginBottom = extraPb;
                        container.style.transition = 'margin 0.3s ease';
                    }
                    view.style.paddingBottom = '';
                    view.style.paddingTop = '';
                } else {
                    view.style.paddingBottom = pb;
                }
            });

            const sidebar = document.querySelector('aside');
            if (sidebar) {
                sidebar.style.transition = 'padding-bottom 0.3s ease';
                sidebar.style.paddingBottom = targetPb;
            }
        } else if (footerCanvas && visualizerContainer) {
            if (progressRow) progressRow.style.marginTop = '';
            footerCanvas.style.opacity = '0';
            visualizerContainer.style.height = '';
            footerCanvas.style.width = '100%';
            if (playerFooter) {
                playerFooter.style.height = '';
                playerFooter.style.justifyContent = '';
            }
            const mainViews = document.querySelectorAll('#view-search, #view-favorites, #view-settings, #view-about, #view-player-detail, #view-songlist, #songlist-detail-view, #view-leaderboard');
            mainViews.forEach(view => {
                view.style.paddingBottom = '';
                const container = view.querySelector('#player-detail-container');
                if (container) {
                    container.style.marginTop = '';
                    container.style.marginBottom = '';
                }
                view.style.paddingTop = '';
            });
            const sidebar = document.querySelector('aside');
            if (sidebar) {
                sidebar.style.paddingBottom = '';
            }
        }

        // --- Handle Detail Visualizer ---
        waveDetail.clearAnimations();
        const isDetailViewVisible = isDetailVisible();

        if (s.showDetailVisualizer && detailCanvas && isDetailViewVisible) {
            const style = s.detailVisualizerStyle || 'pulse';
            if (style === 'vumeter') {
                waveDetail.addAnimation(new LXStudioVUMeterAnimation({ isCompact: false, analyserL, analyserR }));
                detailCanvas.style.opacity = opacity;
            } else {
                const options = {
                    fillColor: themeColor,
                    lineColor: themeColor,
                    lineWidth: 1.5,
                    count: 60,
                    rounded: true,
                    diameter: 220,
                    gap: globalGap
                };

                let AnimationClass = waveDetail.animations.Turntable;
                if (style === 'dots') {
                    AnimationClass = waveDetail.animations.Glob;
                    options.diameter = 180;
                } else if (style === 'flower') {
                    AnimationClass = waveDetail.animations.Flower;
                    options.diameter = 200;
                }

                waveDetail.addAnimation(new AnimationClass(options));
                detailCanvas.style.opacity = opacity;
            }
        } else if (detailCanvas) {
            detailCanvas.style.opacity = '0';
        }
    }

    /**
     * Clear canvas animations
     */
    function clear(type) {
        if (type === 'footer' && waveFooter) {
            waveFooter.clearAnimations();
            if (footerCanvas) {
                const ctx = footerCanvas.getContext('2d');
                ctx.clearRect(0, 0, footerCanvas.width, footerCanvas.height);
            }
        } else if (type === 'detail' && waveDetail) {
            waveDetail.clearAnimations();
            if (detailCanvas) {
                const ctx = detailCanvas.getContext('2d');
                ctx.clearRect(0, 0, detailCanvas.width, detailCanvas.height);
            }
        }
    }

    if (audio) {
        const resumeAudioContext = () => {
            if (audioContext && audioContext.state === 'suspended') {
                audioContext.resume().catch(() => {});
            }
        };
        audio.addEventListener('play', () => {
            if (!isInitialized) {
                init();
            } else {
                resumeAudioContext();
            }
        });
        audio.addEventListener('playing', () => {
            if (!isInitialized) {
                init();
            }
            resumeAudioContext();
        });
        audio.addEventListener('timeupdate', () => {
            if (!isInitialized && audio && !audio.paused) {
                init();
            }
            if (audioContext && audioContext.state === 'suspended' && audio && !audio.paused) {
                resumeAudioContext();
            }
        });
    }

    window.addEventListener('resize', () => {
        syncSize();
        applySettings();
    });

    if (typeof window !== 'undefined' && window.ResizeObserver) {
        const resizeObserver = new ResizeObserver(() => {
            syncSize();
        });
        if (footerCanvas) resizeObserver.observe(footerCanvas);
        if (detailCanvas) resizeObserver.observe(detailCanvas);
        const vContainer = document.getElementById('visualizer-container');
        if (vContainer) resizeObserver.observe(vContainer);
    }

    return { init, applySettings, syncSize, clear };
})();

window.musicVisualizer = musicVisualizer;
window.LXStudioVUMeterAnimation = LXStudioVUMeterAnimation;
