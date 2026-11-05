/**
 * Music Visualizer Integration using Wave.js & LX Studio Reference Dual VU Meter
 * Manages independent footer and detail view canvases and syncs with theme color.
 */

/**
 * LX Studio dual VU meter.
 * Each profile (vuMeterTheme) is a complete printed instrument ported from the approved
 * industrial design study: machined frame, black well, printed face, glass, elliptical scale,
 * typography, pointer and pivot hub. Geometry lives in a 620×326 design space.
 * Calibration is shared: mapVuToNorm puts 0 VU at norm 0.80, -20 VU at 0.08 and +3 VU at 1.0,
 * and every design maps -20 VU to its scale start and +3 VU to its scale end.
 * Add a new profile with LXStudioVUMeterAnimation.registerDesign(id, design).
 */
const VU_NORM_ZERO = 0.8;
const VU_SCALE_ANCHORS = [
    { vu: -30, norm: 0.00 },
    { vu: -20, norm: 0.08 },
    { vu: -15, norm: 0.20 },
    { vu: -10, norm: 0.32 },
    { vu:  -7, norm: 0.44 },
    { vu:  -5, norm: 0.54 },
    { vu:  -3, norm: 0.64 },
    { vu:  -1, norm: 0.74 },
    { vu:   0, norm: 0.80 },
    { vu:   1, norm: 0.8666667 },
    { vu:   2, norm: 0.9333333 },
    { vu:   3, norm: 1.00 }
];
const mapVuToNorm = vu => {
    if (vu <= -30) return 0;
    if (vu >= 3) return Math.min(1.02, 1 + (vu - 3) * 0.01);
    for (let i = 0; i < VU_SCALE_ANCHORS.length - 1; i++) {
        const lower = VU_SCALE_ANCHORS[i];
        const upper = VU_SCALE_ANCHORS[i + 1];
        if (vu >= lower.vu && vu <= upper.vu) {
            const fraction = (vu - lower.vu) / (upper.vu - lower.vu);
            return lower.norm + fraction * (upper.norm - lower.norm);
        }
    }
    return 0;
};

// Printed scale position (0 = -20 VU at the scale start, 1 = +3 VU at the scale end).
// The small overrun lets the pointer travel onto the stop pins.
const VU_SCALE_NORM_MIN = mapVuToNorm(-20);
const VU_SCALE_P_MIN = -0.03;
const VU_SCALE_P_MAX = 1.03;
const vuNormToScale = norm => Math.max(VU_SCALE_P_MIN, Math.min(VU_SCALE_P_MAX, (norm - VU_SCALE_NORM_MIN) / (1 - VU_SCALE_NORM_MIN)));
const vuMarks = points => points.map(([vu, label]) => ({
    vu,
    label: label || null,
    norm: mapVuToNorm(vu),
    major: !!label,
    hot: vu >= 0
}));
const vuPowerMarks = points => points.map(([vu, label]) => ({ vu, label, norm: mapVuToNorm(vu), hot: vu > 0 }));

const LX_VU_FONT_SANS = '"Avenir Next", Avenir, "Segoe UI", "Helvetica Neue", Arial, sans-serif';
const LX_VU_FONT_SERIF = 'Georgia, "Times New Roman", serif';
const LX_VU_DEFAULT_THEME = 'study-nocturne';

const LX_VU_DIAL_DESIGNS = {
    // Smoked-titanium reference meter: wide shallow sweep, hairline nickel pointer, warm diffuser.
    'study-nocturne': {
        key: 'nocturne', name: 'Nocturne', scale: 'essential',
        face: ['#323536', '#202425', '#15191a'], rim: ['#f1e4c8', '#706d66', '#171817'],
        ink: '#e5ded0', softInk: '#9da09c', accent: '#c5a36d', hot: '#c9654f',
        arc: 'double', tick: 'hair', pointer: 'hairline',
        geometry: { start: -148, sweep: 116, radius: 185, pivotY: 257, scaleX: 1.72 },
        type: LX_VU_FONT_SANS, weight: 600, diffuser: { color: '216, 196, 159', alpha: 0.12 },
        caption: 'IEC 60268-17',
        marks: vuMarks([[-20, '-20'], [-15], [-10, '-10'], [-7], [-5, '-5'], [-3], [-1], [0, '0'], [1], [2], [3, '+3']]),
        secondary: null
    },
    // Broadcast meter on lamp-lit ivory: double rail, serif numerals, tapered blade, watts sub-scale.
    'study-heritage': {
        key: 'heritage', name: 'Heritage', scale: 'broadcast',
        face: ['#fffaf0', '#f0e2c5', '#d9c39d'], rim: ['#f5e1b5', '#b39765', '#4b3b24'],
        ink: '#332a1e', softInk: '#75664f', accent: '#826843', hot: '#bf4436',
        arc: 'double', tick: 'bar', pointer: 'blade',
        geometry: { start: -155, sweep: 130, radius: 194, pivotY: 269, scaleX: 1.5 },
        type: LX_VU_FONT_SERIF, weight: 500, diffuser: null,
        caption: '8 Ω · 100 W REF @ 0 VU',
        marks: vuMarks([[-20, '-20'], [-18], [-15, '-15'], [-12], [-10, '-10'], [-8], [-7, '-7'], [-6], [-5, '-5'], [-4], [-3, '-3'], [-2], [-1], [0, '0'], [1, '+1'], [2, '+2'], [3, '+3']]),
        secondary: vuPowerMarks([[-20, '1'], [-10, '10'], [-5, '32'], [-3, '50'], [0, '100'], [3, '200']])
    },
    // Mastering meter in a champagne-brass frame: single rail, wedge graduations, counterweighted pointer.
    'study-atelier': {
        key: 'atelier', name: 'Atelier', scale: 'studio',
        face: ['#292824', '#1a1b19', '#121311'], rim: ['#f2deb4', '#a7844b', '#28231b'],
        ink: '#e7d3ae', softInk: '#a18f70', accent: '#d0ad73', hot: '#cf674f',
        arc: 'single', tick: 'wedge', pointer: 'counterweight',
        geometry: { start: -158, sweep: 136, radius: 191, pivotY: 270, scaleX: 1.48 },
        type: LX_VU_FONT_SANS, weight: 600, diffuser: null,
        caption: 'IEC 60268-17',
        marks: vuMarks([[-20, '-20'], [-17], [-13, '-13'], [-10], [-8, '-8'], [-6], [-5, '-5'], [-4], [-3, '-3'], [-2], [-1], [0, '0'], [1, '+1'], [2, '+2'], [3, '+3']]),
        secondary: null
    },
    // Porcelain reference meter: open shallow sweep, fine charcoal indices, blue-steel hairline.
    'study-riviera': {
        key: 'riviera', name: 'Riviera', scale: 'open',
        face: ['#f1f0e9', '#d9d9d1', '#c5c6c0'], rim: ['#fafaf5', '#a9aaa5', '#4b4d4a'],
        ink: '#252923', softInk: '#777b75', accent: '#6d7771', hot: '#bd5947',
        arc: 'double', tick: 'hair', pointer: 'hairline', pointerColors: ['#172128', '#26363f', '#10171b'],
        geometry: { start: -152, sweep: 124, radius: 194, pivotY: 267, scaleX: 1.5 },
        type: LX_VU_FONT_SANS, weight: 600, diffuser: null,
        caption: 'IEC 60268-17',
        marks: vuMarks([[-20, '-20'], [-15], [-10, '-10'], [-5], [-3], [0, '0'], [3, '+3']]),
        secondary: null
    },
    // Cobalt mastering instrument: dense dB scale, 8 Ω power arc, vermilion-tipped blade.
    'study-cobalt': {
        key: 'cobalt', name: 'Cobalt', scale: 'mastering',
        face: ['#16345a', '#0c2343', '#08172d'], rim: ['#c9d6df', '#576d82', '#111923'],
        ink: '#dce9ef', softInk: '#9cb6c5', accent: '#80bad1', hot: '#ff785f',
        arc: 'single', tick: 'bar', pointer: 'blade',
        geometry: { start: -158, sweep: 136, radius: 191, pivotY: 270, scaleX: 1.48 },
        type: LX_VU_FONT_SANS, weight: 600, diffuser: { color: '83, 170, 255', alpha: 0.25 },
        caption: '8 Ω · 100 W REF @ 0 VU',
        marks: vuMarks([[-20, '-20'], [-18], [-15, '-15'], [-12, '-12'], [-10], [-9, '-9'], [-8], [-7], [-6, '-6'], [-5], [-4, '-4'], [-3, '-3'], [-2, '-2'], [-1], [0, '0'], [1, '+1'], [2, '+2'], [3, '+3']]),
        secondary: vuPowerMarks([[-18, '1.6'], [-12, '6'], [-6, '25'], [-3, '50'], [0, '100'], [3, '200']])
    }
};

const LX_VU_RAD = Math.PI / 180;
// Same projection as the design study: an ellipse around (cx, cy) stretched horizontally by scaleX.
const vuDesignPoint = (deg, radius, cx, cy, scaleX) => [
    cx + Math.cos(deg * LX_VU_RAD) * radius * scaleX,
    cy + Math.sin(deg * LX_VU_RAD) * radius
];

const normalizeVuTheme = theme => {
    if (theme && Object.prototype.hasOwnProperty.call(LX_VU_DIAL_DESIGNS, theme)) return theme;
    return LX_VU_DEFAULT_THEME;
};
// Phones get no VU meter: the instrument needs desktop width to stay legible.
const isVuMobileViewport = () => typeof window !== 'undefined' && typeof window.innerWidth === 'number' && window.innerWidth > 0 && window.innerWidth < 768;
// Design-space window drawn per pod. The compact footer crops to the scale band and hides the pivot.
const LX_VU_VIEWPORT = { full: { x: 0, y: 0, w: 620, h: 326 }, compact: { x: 0, y: 36, w: 620, h: 214 } };
const vuHexA = (hex, a) => {
    const v = parseInt(hex.slice(1), 16);
    return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
};
const vuLabelPriority = vu => (vu === 0 ? 0 : (vu === -20 || vu === 3) ? 1 : vu % 5 === 0 ? 2 : 3);
const vuBoxesOverlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

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
        return mapVuToNorm(vu);
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

                // Base level around -10 VU to -5 VU, with rhythmic peaks near 0 VU.
                const dynamicBase = 0.42 + beat1 * 0.35 + beat2 * 0.15;
                targetNormL = Math.max(0.08, Math.min(0.92, (dynamicBase + swingL + microJitter) * (0.4 + 0.6 * vol)));
                targetNormR = Math.max(0.08, Math.min(0.92, (dynamicBase + swingR - microJitter) * (0.4 + 0.6 * vol)));
            }
        }

        // 3. ANSI C16.5-style VU ballistics with a small, time-based moving-coil overshoot.
        // The damped spring keeps the response smooth while retaining a little mechanical character.
        const omega = 17.5;
        const zeta = 0.82;
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
            if (n < 0) return [0, 0];
            if (n > 1.03) return [1.03, 0];
            return [n, v];
        };
        [this.needleNormL, this.velL] = stop(this.needleNormL, this.velL);
        [this.needleNormR, this.velR] = stop(this.needleNormR, this.velR);

        this.renderConsole(ctx, width, height, this.needleNormL, this.needleNormR, this.isCompact);
    }

    getDesign(theme) {
        return LX_VU_DIAL_DESIGNS[normalizeVuTheme(theme)];
    }

    resolveTheme() {
        const saved = typeof window !== 'undefined' && window.settings && window.settings.vuMeterTheme;
        return normalizeVuTheme(saved || this.options.theme);
    }

    getScaleMarks(theme) {
        return this.getDesign(theme).marks;
    }

    // Angle (design degrees) of a calibrated norm on the profile's printed scale
    scaleAngle(theme, norm) {
        const g = this.getDesign(theme).geometry;
        return g.start + g.sweep * vuNormToScale(norm);
    }

    static registerDesign(id, design) {
        if (id && design) LX_VU_DIAL_DESIGNS[id] = design;
    }

    static normalizeTheme(theme) {
        return normalizeVuTheme(theme);
    }

    pixelRatio(ctx) {
        const c = ctx && ctx.canvas;
        if (c && c.clientWidth > 0 && c.width > 0) return Math.max(1, c.width / c.clientWidth);
        return (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    }

    renderConsole(ctx, width, height, levelL, levelR, isCompact) {
        ctx.save();
        ctx.clearRect(0, 0, width, height);
        if (isVuMobileViewport()) {
            ctx.restore();
            return;
        }

        const D = this.getDesign(this.resolveTheme());
        const isLight = this.isLightMode();
        const dpr = this.pixelRatio(ctx);

        const marginX = isCompact ? 3 : 6;
        const marginY = isCompact ? 2 : 5;
        const panelW = width - marginX * 2;
        const panelH = height - marginY * 2;
        const panelX = marginX;
        const panelY = marginY;
        const scale = Math.min(panelW / (isCompact ? 500 : 840), panelH / (isCompact ? 68 : 210));
        const cornerR = (isCompact ? 10 : 12) * scale;

        if (isCompact) {
            ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(17, 20, 26, 0.96)';
            this.roundRect(ctx, panelX, panelY, panelW, panelH, cornerR);
            ctx.fill();
            ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.07)' : 'rgba(255, 255, 255, 0.07)';
            ctx.lineWidth = 1;
            this.roundRect(ctx, panelX + 0.5, panelY + 0.5, panelW - 1, panelH - 1, cornerR);
            ctx.stroke();
        } else {
            const chassis = ctx.createLinearGradient(panelX, panelY, panelX, panelY + panelH);
            const stops = isLight ? ['#ffffff', '#f1f5f9', '#e2e8f0'] : ['#1a1d24', '#121419', '#090a0d'];
            chassis.addColorStop(0, stops[0]);
            chassis.addColorStop(0.5, stops[1]);
            chassis.addColorStop(1, stops[2]);
            ctx.fillStyle = chassis;
            this.roundRect(ctx, panelX, panelY, panelW, panelH, cornerR);
            ctx.fill();
            ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.40)' : 'rgba(255, 255, 255, 0.09)';
            ctx.lineWidth = 0.8 * scale;
            this.roundRect(ctx, panelX + 0.5, panelY + 0.5, panelW - 1, panelH - 1, cornerR);
            ctx.stroke();
        }

        const padX = (isCompact ? 4 : 12) * scale;
        const padY = (isCompact ? 3 : 8) * scale;
        const innerX = panelX + padX;
        const innerY = panelY + padY;
        const innerW = panelW - padX * 2;
        const innerH = panelH - padY * 2;
        const centerW = (isCompact ? 26 : 72) * scale;
        const gap = (isCompact ? 3 : 10) * scale;
        const meterW = (innerW - centerW - gap * 2) / 2;
        const leftX = innerX;
        const centerX = leftX + meterW + gap;
        const rightX = centerX + centerW + gap;
        const o = { compact: !!isCompact, dpr };

        this.drawMeterPod(ctx, leftX, innerY, meterW, innerH, levelL, 'L', D, o);
        this.drawCenterConsole(ctx, centerX, innerY, centerW, innerH, scale, isCompact, D, isLight, levelL, levelR);
        this.drawMeterPod(ctx, rightX, innerY, meterW, innerH, levelR, 'R', D, o);
        ctx.restore();
    }

    // Maps the 620×326 design space onto a pod. Horizontal stretch is limited so the dial keeps its wide look.
    podLayout(D, x, y, w, h, compact) {
        const vp = compact ? LX_VU_VIEWPORT.compact : LX_VU_VIEWPORT.full;
        let kx = w / vp.w;
        let ky = h / vp.h;
        if (kx > ky * 1.3) kx = ky * 1.3;
        if (ky > kx * 1.05) ky = kx * 1.05;
        const rw = vp.w * kx;
        const rh = vp.h * ky;
        const rx = x + (w - rw) / 2;
        const ry = y + (h - rh) / 2;
        const k = Math.min(kx, ky);
        const X = dx => rx + (dx - vp.x) * kx;
        const Y = dy => ry + (dy - vp.y) * ky;
        const g = D.geometry;
        const inset = d => ({ x: rx + d * k, y: ry + d * k, w: rw - 2 * d * k, h: rh - 2 * d * k });
        return {
            compact, vp, rx, ry, rw, rh, kx, ky, k, X, Y, inset,
            frame: inset(3), well: inset(9), face: inset(15), clip: inset(16),
            pivot: [X(310), Y(g.pivotY)],
            angleOf: p => g.start + g.sweep * p,
            pt: (deg, r) => {
                const [dx, dy] = vuDesignPoint(deg, r, 310, g.pivotY, g.scaleX);
                return [X(dx), Y(dy)];
            }
        };
    }

    frameGradient(ctx, D, x, y, w, h) {
        const grad = ctx.createLinearGradient(x, y, x + w, y + h);
        grad.addColorStop(0, D.rim[0]);
        grad.addColorStop(0.18, D.rim[1]);
        grad.addColorStop(0.49, D.rim[2]);
        grad.addColorStop(0.77, D.rim[1]);
        grad.addColorStop(1, D.rim[0]);
        return grad;
    }

    setLetterSpacing(ctx, px) {
        if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`;
    }

    // Printed text: letter spacing trails the last glyph, so shift centred text back by half a space.
    printText(ctx, text, x, y, font, color, spacing = 0) {
        ctx.font = font;
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        this.setLetterSpacing(ctx, spacing);
        ctx.fillText(text, x + spacing / 2, y);
        this.setLetterSpacing(ctx, 0);
    }

    // Places scale numerals radially inside the graduations; any numeral that would touch a
    // neighbour or leave the face is dropped (important numerals are placed first).
    layoutScaleLabels(ctx, D, L, dpr = 1, withSecondary = false) {
        const g = D.geometry;
        const k = L.k;
        const minFont = (L.compact ? 8 : 9) * dpr;
        const innerR = D.arc === 'single' ? g.radius - (D.tick === 'wedge' ? 12 : 7) : g.radius - 15;
        const gap = Math.max(2 * dpr, 3 * k);
        const pad = 1.5 * dpr;
        const face = L.clip;
        const placed = [];
        const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
        const place = (mark, labelR, innerDist, size, color, group) => {
            ctx.font = `${D.weight} ${size.toFixed(2)}px ${D.type}`;
            const tw = ctx.measureText(mark.label).width;
            const th = size * 0.74;
            const deg = L.angleOf(vuNormToScale(mark.norm));
            const base = L.pt(deg, g.radius);
            const u0 = base[0] - L.pivot[0];
            const u1 = base[1] - L.pivot[1];
            const ul = Math.hypot(u0, u1) || 1;
            const ux = u0 / ul;
            const uy = u1 / ul;
            const half = Math.abs(ux) * tw / 2 + Math.abs(uy) * th / 2;
            const d = Math.max(dist(base, L.pt(deg, labelR)), innerDist(deg) + gap + half);
            const lx = base[0] - ux * d;
            const ly = base[1] - uy * d;
            if (lx - tw / 2 < face.x || lx + tw / 2 > face.x + face.w || ly - th / 2 < face.y || ly + th / 2 > face.y + face.h) return;
            const box = { x0: lx - tw / 2 - pad, x1: lx + tw / 2 + pad, y0: ly - th / 2 - pad, y1: ly + th / 2 + pad };
            if (placed.some(p => vuBoxesOverlap(p.box, box))) return;
            placed.push({ text: mark.label, vu: mark.vu, x: lx, y: ly, size, color, font: ctx.font, box, group });
        };
        const minTick = L.compact ? 4.5 * dpr : 0;
        const main = D.marks.map((m, i) => ({ m, i })).filter(c => c.m.label)
            .sort((a, b) => vuLabelPriority(a.m.vu) - vuLabelPriority(b.m.vu) || a.i - b.i);
        for (const { m } of main) {
            const size = Math.max(minFont, ((m.label === '-20' || m.label === '+3') ? 11 : 12) * k);
            place(m, g.radius - 28, deg => Math.max(dist(L.pt(deg, g.radius), L.pt(deg, innerR)), minTick), size, m.hot ? D.hot : D.ink, 'main');
        }
        if (withSecondary && D.secondary) {
            const size = Math.max(7 * dpr, 9 * k);
            for (const m of D.secondary) {
                place(m, g.radius - 101, deg => dist(L.pt(deg, g.radius), L.pt(deg, g.radius - 82)), size, m.hot ? D.hot : D.softInk, 'secondary');
            }
        }
        return placed.sort((a, b) => (a.group === b.group ? a.vu - b.vu : a.group === 'main' ? -1 : 1));
    }

    drawMeterPod(ctx, x, y, w, h, level, channel, D, o = {}) {
        const compact = !!o.compact;
        const dpr = o.dpr || 1;
        const L = this.podLayout(D, x, y, w, h, compact);
        const { k, pt, angleOf } = L;
        const g = D.geometry;
        const showDetail = !compact && k >= 0.55 * dpr;
        const lw = (v, min) => Math.max(v * k, min * dpr);
        const rr = (r, rad) => this.roundRect(ctx, r.x, r.y, r.w, r.h, rad * k);

        ctx.save();
        // Machined frame, black well and printed face
        ctx.fillStyle = this.frameGradient(ctx, D, L.frame.x, L.frame.y, L.frame.w, L.frame.h);
        rr(L.frame, 8);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
        ctx.lineWidth = lw(1.2, 0.5);
        ctx.stroke();
        ctx.fillStyle = '#080909';
        rr(L.well, 5);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.86)';
        ctx.lineWidth = lw(2, 0.5);
        ctx.stroke();
        const F = L.face;
        const faceGrad = ctx.createLinearGradient(F.x, F.y, F.x + F.w * 0.15, F.y + F.h);
        faceGrad.addColorStop(0, D.face[0]);
        faceGrad.addColorStop(0.56, D.face[1]);
        faceGrad.addColorStop(1, D.face[2]);
        ctx.fillStyle = faceGrad;
        rr(F, 3);
        ctx.fill();
        ctx.strokeStyle = vuHexA(D.accent, 0.46);
        ctx.lineWidth = lw(0.8, 0.5);
        ctx.stroke();

        // Glass reflection across the top of the window (bounding-box radial gradient)
        {
            const gx0 = F.x + 2 * k;
            const gw = F.w - 4 * k;
            const gy = d => F.y + (d - 15) * L.ky;
            const top = gy(11.5);
            const bh = gy(72) - top;
            ctx.save();
            ctx.globalAlpha = 0.8;
            ctx.translate(gx0 + gw / 2, top);
            ctx.scale(gw, bh);
            const nx = px => (px - (gx0 + gw / 2)) / gw;
            const ny = py => (py - top) / bh;
            ctx.beginPath();
            ctx.moveTo(-0.5, ny(gy(20)));
            ctx.quadraticCurveTo(0, ny(gy(3)), 0.5, ny(gy(20)));
            ctx.lineTo(0.5, ny(gy(72)));
            ctx.quadraticCurveTo(0, ny(gy(45)), -0.5, ny(gy(72)));
            ctx.closePath();
            const glass = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
            glass.addColorStop(0, 'rgba(255, 255, 255, 0.13)');
            glass.addColorStop(0.5, 'rgba(255, 255, 255, 0.025)');
            glass.addColorStop(1, 'rgba(0, 0, 0, 0.15)');
            ctx.fillStyle = glass;
            ctx.fill();
            ctx.restore();
            void nx;
        }

        ctx.save();
        rr(L.clip, 2);
        ctx.clip();

        if (D.diffuser) {
            // Ellipse cx 310, cy 20, 300×130 with its gradient centred on the top of its bounding box
            ctx.save();
            ctx.translate(L.X(310), L.Y(-110));
            ctx.scale(600 * L.kx, 260 * L.ky);
            const dg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
            dg.addColorStop(0, `rgba(${D.diffuser.color}, ${D.diffuser.alpha})`);
            dg.addColorStop(0.48, `rgba(${D.diffuser.color}, 0.055)`);
            dg.addColorStop(1, `rgba(${D.diffuser.color}, 0)`);
            ctx.fillStyle = dg;
            ctx.beginPath();
            ctx.arc(0, 0.5, 0.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        const strokeArc = (r, alpha, width) => {
            ctx.beginPath();
            const n = 72;
            for (let i = 0; i <= n; i++) {
                const [px, py] = pt(angleOf(i / n), r);
                if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
            }
            ctx.strokeStyle = vuHexA(D.accent, alpha);
            ctx.lineWidth = lw(width, 0.5);
            ctx.stroke();
        };
        if (D.arc === 'double') {
            strokeArc(g.radius + 12, 0.62, 0.65);
            strokeArc(g.radius - 15, 0.34, 0.6);
        } else if (D.arc === 'single') {
            strokeArc(g.radius + 10, 0.8, 1.15);
        } else {
            strokeArc(g.radius + 9, 0.48, 0.8);
            strokeArc(g.radius - 15, 0.28, 0.55);
        }

        // Graduations
        ctx.lineCap = 'round';
        for (const m of D.marks) {
            const deg = angleOf(vuNormToScale(m.norm));
            const outer = pt(deg, g.radius + (m.major ? 2 : 0));
            const ref = pt(deg, g.radius - 7);
            const u0 = outer[0] - L.pivot[0];
            const u1 = outer[1] - L.pivot[1];
            const ul = Math.hypot(u0, u1) || 1;
            const ux = u0 / ul;
            const uy = u1 / ul;
            const len = Math.max(Math.hypot(outer[0] - ref[0], outer[1] - ref[1]), compact ? (m.major ? 4.5 : 3) * dpr : 0);
            const inner = [outer[0] - ux * len, outer[1] - uy * len];
            ctx.strokeStyle = m.hot ? D.hot : (m.major ? D.ink : D.softInk);
            ctx.beginPath();
            if (D.tick === 'wedge' && !m.major) {
                const wl = Math.max(5 * k, 2.5 * dpr);
                ctx.lineWidth = lw(1.15, 0.8);
                ctx.moveTo(inner[0], inner[1]);
                ctx.lineTo(inner[0] - ux * wl, inner[1] - uy * wl);
            } else {
                ctx.lineWidth = D.tick === 'hair' ? lw(m.major ? 1.35 : 0.65, m.major ? 0.9 : 0.6) : lw(m.major ? 1.7 : 0.9, m.major ? 1 : 0.7);
                ctx.moveTo(inner[0], inner[1]);
                ctx.lineTo(outer[0], outer[1]);
            }
            ctx.stroke();
        }

        // Secondary 8 Ω power arc (detail size only)
        if (showDetail && D.secondary) {
            strokeArc(g.radius - 77, 0.42, 0.7);
            ctx.lineWidth = lw(0.8, 0.6);
            for (const m of D.secondary) {
                const deg = angleOf(vuNormToScale(m.norm));
                const a = pt(deg, g.radius - 82);
                const b = pt(deg, g.radius - 72);
                ctx.strokeStyle = m.hot ? D.hot : D.softInk;
                ctx.beginPath();
                ctx.moveTo(a[0], a[1]);
                ctx.lineTo(b[0], b[1]);
                ctx.stroke();
            }
            ctx.textBaseline = 'alphabetic';
            this.printText(ctx, 'WATTS · 8 Ω', L.X(310), L.Y(197), `400 ${Math.max(7 * k, 6 * dpr).toFixed(2)}px ${D.type}`, D.softInk, 1.6 * k);
        }

        // Numerals
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const lbl of this.layoutScaleLabels(ctx, D, L, dpr, showDetail)) {
            ctx.font = lbl.font;
            ctx.fillStyle = lbl.color;
            ctx.fillText(lbl.text, lbl.x, lbl.y);
        }

        // Stop pins just beyond the needle's travel
        for (const p of [VU_SCALE_P_MIN - 0.015, VU_SCALE_P_MAX + 0.015]) {
            const [px, py] = pt(angleOf(p), g.radius - 11);
            const r = lw(2.6, 1.6);
            ctx.fillStyle = this.frameGradient(ctx, D, px - r, py - r, r * 2, r * 2);
            ctx.strokeStyle = D.accent;
            ctx.lineWidth = lw(0.65, 0.5);
            ctx.beginPath();
            ctx.arc(px, py, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = vuHexA(D.ink, 0.72);
            ctx.beginPath();
            ctx.arc(px, py - 0.45 * k, lw(0.7, 0.45), 0, Math.PI * 2);
            ctx.fill();
        }

        if (!compact) {
            ctx.textBaseline = 'alphabetic';
            this.printText(ctx, 'VU', L.X(310), L.Y(241), `600 ${Math.max(12 * k, 8 * dpr).toFixed(2)}px ${D.type}`, D.ink, 3.2 * k);
            if (showDetail) {
                this.printText(ctx, D.caption, L.X(310), L.Y(300), `400 ${Math.max(7 * k, 6 * dpr).toFixed(2)}px ${D.type}`, D.softInk, 1.3 * k);
            }
        }

        this.drawNeedle(ctx, D, L, level, dpr);
        this.drawHub(ctx, D, L, dpr);
        ctx.restore();

        // Furniture outside the printed clip
        const hiFont = Math.max(9 * k, 7 * dpr);
        ctx.textBaseline = 'middle';
        if (compact) {
            ctx.font = `600 ${Math.max(9 * k, 7.5 * dpr).toFixed(2)}px ${D.type}`;
            ctx.fillStyle = D.ink;
            ctx.textAlign = 'left';
            ctx.fillText(channel, L.X(40), L.Y(70));
        } else {
            for (const sx of [29, 591]) {
                ctx.fillStyle = vuHexA(D.accent, 0.72);
                ctx.beginPath();
                ctx.arc(L.X(sx), L.Y(28), lw(1.7, 1), 0, Math.PI * 2);
                ctx.fill();
            }
            this.printText(ctx, channel === 'L' ? 'LEFT' : 'RIGHT', L.X(310), L.Y(47), `600 ${hiFont.toFixed(2)}px ${D.type}`, D.ink, 3.6 * k);
        }

        // Clip / peak lamp
        const lampOn = vuNormToScale(level) > 0.94;
        const [lx, ly] = compact ? [L.X(580), L.Y(70)] : [L.X(562), L.Y(47)];
        ctx.save();
        if (lampOn) {
            ctx.shadowColor = D.hot;
            ctx.shadowBlur = lw(6, 3);
        }
        ctx.globalAlpha = lampOn ? 0.95 : 0.22;
        ctx.fillStyle = D.hot;
        ctx.beginPath();
        ctx.arc(lx, ly, lw(3, 1.6), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.restore();
    }

    // Needle is drawn in pixel space from the pivot to the elliptical tip, so its width never deforms.
    drawNeedle(ctx, D, L, level, dpr) {
        const g = D.geometry;
        const k = L.k;
        const tip = L.pt(L.angleOf(vuNormToScale(level)), g.radius - 9);
        const [cx, cy] = L.pivot;
        const len = Math.hypot(tip[0] - cx, tip[1] - cy) || 1;
        const ux = (tip[0] - cx) / len;
        const uy = (tip[1] - cy) / len;
        const nx = -uy;
        const ny = ux;
        const blade = D.pointer === 'blade';
        const hw = (v, min) => Math.max(v * k, min * dpr);
        const section = (from, to, w0, w1) => {
            const at = (t, s) => [cx + ux * t + nx * s, cy + uy * t + ny * s];
            const mid = (from + to) / 2;
            const wm = (w0 + w1) / 2;
            const pts = [at(from, w0), at(mid, wm), at(to, w1), at(to, -w1), at(mid, -wm), at(from, -w0)];
            ctx.beginPath();
            pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
            ctx.closePath();
            ctx.fill();
        };
        const colors = D.pointerColors || (blade ? ['#41311f', '#171717', '#56442c'] : ['#596064', '#f3eee1', '#71777a']);
        const w0 = hw(blade ? 2.15 : 1.15, blade ? 1.1 : 0.6);
        const w1 = hw(blade ? 0.45 : 0.32, blade ? 0.35 : 0.3);
        const grad = ctx.createLinearGradient(cx - nx * w0, cy - ny * w0, cx + nx * w0, cy + ny * w0);
        grad.addColorStop(0, colors[0]);
        grad.addColorStop(0.47, colors[1]);
        grad.addColorStop(1, colors[2]);

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
        ctx.shadowBlur = Math.max(2.7 * k, 1.2 * dpr);
        ctx.shadowOffsetX = 1.5 * k;
        ctx.shadowOffsetY = 2 * k;
        ctx.fillStyle = grad;
        if (D.pointer === 'counterweight') section(-26 * k, -6 * k, hw(1.25, 0.8), hw(1.8, 1.1));
        section(5 * k, len * (blade ? 0.88 : 1), w0, w1);
        if (blade) {
            ctx.fillStyle = D.hot;
            section(len * 0.88, len, w1, hw(0.16, 0.2));
        }
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.lineWidth = Math.max(0.55 * k, 0.4 * dpr);
        ctx.lineCap = 'round';
        const off = 0.35 * k;
        const s1 = len * (blade ? 0.82 : 0.75);
        ctx.beginPath();
        ctx.moveTo(cx + ux * 13 * k + nx * off, cy + uy * 13 * k + ny * off);
        ctx.lineTo(cx + ux * s1 + nx * off, cy + uy * s1 + ny * off);
        ctx.stroke();
        ctx.restore();
    }

    drawHub(ctx, D, L, dpr) {
        const k = L.k;
        const [cx, cy] = L.pivot;
        const blade = D.pointer === 'blade';
        const r0 = Math.max((blade ? 11 : 9) * k, 4 * dpr);
        const r1 = r0 * (blade ? 6.5 / 11 : 5.5 / 9);
        const r2 = r0 * 2 / (blade ? 11 : 9);
        ctx.beginPath();
        ctx.arc(cx, cy, r0, 0, Math.PI * 2);
        ctx.fillStyle = this.frameGradient(ctx, D, cx - r0, cy - r0, r0 * 2, r0 * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.lineWidth = Math.max(1.3 * k, 0.6 * dpr);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, r1, 0, Math.PI * 2);
        ctx.fillStyle = blade ? '#b4935c' : '#1d2020';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
        ctx.lineWidth = Math.max(0.8 * k, 0.5 * dpr);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, r2, 0, Math.PI * 2);
        ctx.fillStyle = blade ? '#312719' : D.accent;
        ctx.fill();
    }

    drawCenterConsole(ctx, x, y, w, h, scale, isCompact, D, isLight, levelL, levelR) {
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
            ctx.fillStyle = '#0e1014';
            this.roundRect(ctx, x, y, w, h, cornerR);
            ctx.fill();

            ctx.strokeStyle = vuHexA(D.accent, 0.18);
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
        ctx.fillStyle = isLight ? '#059669' : D.accent;
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
        const footerVuHidden = isMobile && s.footerVisualizerStyle === 'vumeter';
        const detailVuHidden = isMobile && s.detailVisualizerStyle === 'vumeter';
        const themeColor = getComputedStyle(document.documentElement).getPropertyValue('--c-500').trim() || '#10b981';
        const opacity = s.visualizerOpacity !== undefined ? s.visualizerOpacity : 0.85;
        const globalStyle = s.visualizerGlobalStyle || 'blocks';
        const globalGap = globalStyle === 'blocks' ? 2 : 0;
        const visualizerContainer = document.getElementById('visualizer-container');
        const progressRow = document.getElementById('player-progress-row');

        if (!isInitialized) {
            triggerStandaloneLoop();
            if (s.showFooterVisualizer && footerCanvas && visualizerContainer && !footerVuHidden) {
                if (s.footerVisualizerStyle === 'vumeter') {
                    if (progressRow) progressRow.style.marginTop = '';
                    footerCanvas.style.opacity = opacity;
                    visualizerContainer.style.width = '100%';
                    visualizerContainer.style.maxWidth = '460px';
                    visualizerContainer.style.left = '50%';
                    visualizerContainer.style.transform = 'translateX(-50%)';
                    visualizerContainer.style.bottom = '';
                    visualizerContainer.style.marginBottom = '';
                    visualizerContainer.style.height = window.innerHeight <= 845 ? '58px' : '72px';
                    visualizerContainer.style.display = 'flex';
                    visualizerContainer.style.zIndex = '5';
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
            } else {
                if (progressRow) progressRow.style.marginTop = '';
                if (footerVuHidden && footerCanvas) footerCanvas.style.opacity = '0';
            }
            if (s.showDetailVisualizer && detailCanvas) {
                if (s.detailVisualizerStyle === 'vumeter') {
                    detailCanvas.style.opacity = detailVuHidden ? '0' : opacity;
                }
            }
            return;
        }

        // --- Handle Footer Visualizer ---
        waveFooter.clearAnimations();

        if (s.showFooterVisualizer && footerCanvas && visualizerContainer && !footerVuHidden) {
            const style = s.footerVisualizerStyle || 'bars';
            const containerRect = visualizerContainer.getBoundingClientRect();
            const containerWidth = containerRect.width;

            let count, gap, lineWidth, cubeHeight;

            if (style === 'vumeter') {
                if (progressRow) progressRow.style.marginTop = '';
                visualizerContainer.style.width = '100%';
                visualizerContainer.style.maxWidth = '460px';
                visualizerContainer.style.left = '50%';
                visualizerContainer.style.transform = 'translateX(-50%)';
                visualizerContainer.style.bottom = '';
                visualizerContainer.style.marginBottom = '';
                visualizerContainer.style.height = window.innerHeight <= 845 ? '58px' : '72px';
                visualizerContainer.style.zIndex = '5';
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

        if (s.showDetailVisualizer && detailCanvas && isDetailViewVisible && !detailVuHidden) {
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
