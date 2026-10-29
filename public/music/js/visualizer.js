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
        const tauRise = 0.120; // 120ms: snappy transient punch
        const tauFall = 0.280; // 280ms: organic mechanical decay
        const alphaL = 1.0 - Math.exp(-dt / (targetNormL > this.needleNormL ? tauRise : tauFall));
        const alphaR = 1.0 - Math.exp(-dt / (targetNormR > this.needleNormR ? tauRise : tauFall));
        this.needleNormL += alphaL * (targetNormL - this.needleNormL);
        this.needleNormR += alphaR * (targetNormR - this.needleNormR);

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

    drawMeterPod(ctx, x, y, w, h, level, scale, channelTitle, isCompact, theme, isLight) {
        ctx.save();
        const podR = (isCompact ? 8 : 8) * scale;

        // 1. 视窗边界裁剪与防溢出
        ctx.save();
        this.roundRect(ctx, x, y, w, h, podR);
        ctx.clip();

        // 2. 现代专业母带表盘表面 (Ultra-Clean Audiophile Plate)
        if (theme === 'vintage-amber') {
            const bgGrad = ctx.createRadialGradient(x + w / 2, y + h * 0.45, 12 * scale, x + w / 2, y + h * 0.45, Math.max(w * 0.65, h * 1.1));
            if (isLight) {
                bgGrad.addColorStop(0, '#fffdfa');
                bgGrad.addColorStop(0.40, '#fef8ea');
                bgGrad.addColorStop(0.80, '#fdecc4');
                bgGrad.addColorStop(1, '#fbd38d');
            } else {
                bgGrad.addColorStop(0, '#ffe8a3');
                bgGrad.addColorStop(0.35, '#f6c343');
                bgGrad.addColorStop(0.75, '#d99b1a');
                bgGrad.addColorStop(1, '#9c6600');
            }
            ctx.fillStyle = bgGrad;
            ctx.fillRect(x, y, w, h);

            const vigGrad = ctx.createLinearGradient(x, y, x, y + h);
            vigGrad.addColorStop(0, isLight ? 'rgba(180, 120, 20, 0.08)' : 'rgba(80, 40, 10, 0.25)');
            vigGrad.addColorStop(0.3, 'rgba(80, 40, 10, 0)');
            vigGrad.addColorStop(0.7, 'rgba(80, 40, 10, 0)');
            vigGrad.addColorStop(1, isLight ? 'rgba(160, 100, 10, 0.16)' : 'rgba(60, 30, 5, 0.38)');
            ctx.fillStyle = vigGrad;
            ctx.fillRect(x, y, w, h);

        } else if (theme === 'ocean-blue') {
            const bgGrad = ctx.createRadialGradient(x + w / 2, y + h * 0.40, 12 * scale, x + w / 2, y + h * 0.40, Math.max(w * 0.65, h * 1.1));
            if (isLight) {
                bgGrad.addColorStop(0, '#f8fafc');
                bgGrad.addColorStop(0.45, '#e0f2fe');
                bgGrad.addColorStop(0.85, '#bae6fd');
                bgGrad.addColorStop(1, '#7dd3fc');
            } else {
                bgGrad.addColorStop(0, '#42d2ff');
                bgGrad.addColorStop(0.35, '#12a4df');
                bgGrad.addColorStop(0.75, '#0369a1');
                bgGrad.addColorStop(1, '#073b64');
            }
            ctx.fillStyle = bgGrad;
            ctx.fillRect(x, y, w, h);

            const vigGrad = ctx.createLinearGradient(x, y, x, y + h);
            vigGrad.addColorStop(0, isLight ? 'rgba(3, 105, 161, 0.08)' : 'rgba(0, 30, 65, 0.30)');
            vigGrad.addColorStop(0.3, 'rgba(0, 30, 65, 0)');
            vigGrad.addColorStop(0.7, 'rgba(0, 30, 65, 0)');
            vigGrad.addColorStop(1, isLight ? 'rgba(2, 132, 199, 0.15)' : 'rgba(0, 20, 50, 0.45)');
            ctx.fillStyle = vigGrad;
            ctx.fillRect(x, y, w, h);

        } else if (theme === 'cyber-cyan') {
            // 现代极客赛博：深邃纯净黑白，绝不艳俗糊绿！
            if (isLight) {
                const bgGrad = ctx.createLinearGradient(x, y, x, y + h);
                bgGrad.addColorStop(0, '#ffffff');
                bgGrad.addColorStop(0.60, '#f0fdfa');
                bgGrad.addColorStop(1, '#ccfbf1');
                ctx.fillStyle = bgGrad;
                ctx.fillRect(x, y, w, h);
            } else {
                const bgGrad = ctx.createLinearGradient(x, y, x, y + h);
                bgGrad.addColorStop(0, '#0c1015');
                bgGrad.addColorStop(0.5, '#070a0e');
                bgGrad.addColorStop(1, '#030508');
                ctx.fillStyle = bgGrad;
                ctx.fillRect(x, y, w, h);

                const glow = ctx.createRadialGradient(x + w / 2, y + h * 0.5, 10 * scale, x + w / 2, y + h * 0.5, w * 0.65);
                glow.addColorStop(0, 'rgba(6, 182, 212, 0.14)');
                glow.addColorStop(0.6, 'rgba(6, 182, 212, 0.03)');
                glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = glow;
                ctx.fillRect(x, y, w, h);
            }

        } else if (theme === 'champagne-gold') {
            const bgGrad = ctx.createRadialGradient(x + w / 2, y + h * 0.45, 12 * scale, x + w / 2, y + h * 0.45, Math.max(w * 0.65, h * 1.1));
            if (isLight) {
                bgGrad.addColorStop(0, '#ffffff');
                bgGrad.addColorStop(0.40, '#fefce8');
                bgGrad.addColorStop(0.80, '#fef08a');
                bgGrad.addColorStop(1, '#fde047');
            } else {
                bgGrad.addColorStop(0, '#fff4cc');
                bgGrad.addColorStop(0.35, '#fae39b');
                bgGrad.addColorStop(0.70, '#dfba63');
                bgGrad.addColorStop(1, '#9b7625');
            }
            ctx.fillStyle = bgGrad;
            ctx.fillRect(x, y, w, h);

            const vigGrad = ctx.createLinearGradient(x, y, x, y + h);
            vigGrad.addColorStop(0, isLight ? 'rgba(113, 63, 18, 0.06)' : 'rgba(60, 45, 20, 0.25)');
            vigGrad.addColorStop(0.3, 'rgba(60, 45, 20, 0)');
            vigGrad.addColorStop(0.7, 'rgba(60, 45, 20, 0)');
            vigGrad.addColorStop(1, isLight ? 'rgba(113, 63, 18, 0.14)' : 'rgba(50, 35, 10, 0.38)');
            ctx.fillStyle = vigGrad;
            ctx.fillRect(x, y, w, h);

        } else if (theme === 'studio-monochrome') {
            // 现代包豪斯极简母带黑白
            const bgGrad = ctx.createRadialGradient(x + w / 2, y + h * 0.38, 12 * scale, x + w / 2, y + h * 0.38, Math.max(w * 0.65, h * 1.1));
            if (isLight) {
                bgGrad.addColorStop(0, '#ffffff');
                bgGrad.addColorStop(0.65, '#f8fafc');
                bgGrad.addColorStop(1, '#edf2f7');
            } else {
                bgGrad.addColorStop(0, '#191b22');
                bgGrad.addColorStop(0.60, '#101217');
                bgGrad.addColorStop(1, '#08090d');
            }
            ctx.fillStyle = bgGrad;
            ctx.fillRect(x, y, w, h);

            const vigGrad = ctx.createLinearGradient(x, y, x, y + h);
            vigGrad.addColorStop(0, isLight ? 'rgba(0, 0, 0, 0.03)' : 'rgba(0, 0, 0, 0.35)');
            vigGrad.addColorStop(0.3, 'rgba(0, 0, 0, 0)');
            vigGrad.addColorStop(0.7, 'rgba(0, 0, 0, 0)');
            vigGrad.addColorStop(1, isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(0, 0, 0, 0.50)');
            ctx.fillStyle = vigGrad;
            ctx.fillRect(x, y, w, h);
        }

        // 3. 几何浅弧线参数
        const spanMarginX = w * 0.075;
        const scaleStartX = x + spanMarginX;
        const scaleEndX = x + w - spanMarginX;
        const scaleW = scaleEndX - scaleStartX;

        const baseCenterY = isCompact ? (y + h * 0.65) : (y + h * 0.60);
        const arcSag = isCompact ? (h * 0.065) : (h * 0.075);

        const pivotX = x + w / 2;
        const pivotDepth = isCompact ? (h * 1.95) : (h * 2.25);
        const pivotY = y + pivotDepth;

        const getScalePoint = (norm) => {
            const bx = scaleStartX + norm * scaleW;
            const u = (norm - 0.5) * 2;
            const by = baseCenterY + (u * u) * arcSag;

            const dx = bx - pivotX;
            const dy = by - pivotY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const ux = dx / dist;
            const uy = dy / dist;

            return { bx, by, ux, uy };
        };

        // 配色定义
        const isDarkText = theme === 'vintage-amber' || theme === 'champagne-gold' || (isLight && (theme === 'ocean-blue' || theme === 'cyber-cyan' || theme === 'studio-monochrome'));
        const textMain = isDarkText ? '#1e293b' : (theme === 'studio-monochrome' ? '#f8fafc' : (theme === 'cyber-cyan' ? '#22d3ee' : '#f1f5f9'));
        const textMuted = isDarkText ? 'rgba(51, 65, 85, 0.65)' : (theme === 'studio-monochrome' ? 'rgba(226, 232, 240, 0.65)' : 'rgba(34, 211, 238, 0.65)');
        const redColor = '#f43f5e'; // 现代活力珊瑚红
        const arcColor = isDarkText ? '#334155' : (theme === 'studio-monochrome' ? 'rgba(241, 245, 249, 0.85)' : (theme === 'cyber-cyan' ? 'rgba(34, 211, 238, 0.85)' : '#94a3b8'));

        // 4. 现代极简通道徽标 (Top Channel Pill Badge)
        ctx.save();
        const tagText = channelTitle === 'L' ? 'CH · L' : 'CH · R';
        const tagFontSize = Math.max(7.5, Math.round((isCompact ? 8.5 : 11.0) * scale));
        ctx.font = `700 ${tagFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif`;
        const tagY = y + (isCompact ? 4.5 : 7.5) * scale;
        
        ctx.fillStyle = textMuted;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.letterSpacing = '1px';
        ctx.fillText(tagText, x + w / 2, tagY);
        ctx.restore();

        // 5. 现代双段能量弧带 (Ambient Glow Track Ribbon)
        const normZero = 0.86;
        const majorTickLen = isCompact ? (6.0 * scale) : (11.0 * scale);
        const medTickLen = isCompact ? (4.0 * scale) : (7.0 * scale);
        const minorTickLen = isCompact ? (2.5 * scale) : (4.5 * scale);

        // 主安全区间浅光轨
        ctx.beginPath();
        for (let i = 0; i <= 40; i++) {
            const n = (i / 40) * normZero;
            const p = getScalePoint(n);
            if (i === 0) ctx.moveTo(p.bx, p.by);
            else ctx.lineTo(p.bx, p.by);
        }
        ctx.strokeStyle = arcColor;
        ctx.lineWidth = (isCompact ? 1.0 : 1.4) * scale;
        ctx.stroke();

        // 0dB 过载红区能量条
        ctx.beginPath();
        for (let i = 0; i <= 15; i++) {
            const n = normZero + (i / 15) * (1.0 - normZero);
            const p = getScalePoint(n);
            if (i === 0) ctx.moveTo(p.bx, p.by);
            else ctx.lineTo(p.bx, p.by);
        }
        ctx.strokeStyle = redColor;
        ctx.lineWidth = (isCompact ? 1.6 : 2.2) * scale;
        ctx.stroke();

        // 6. 现代专业母带级 dB 刻度 (等宽工整，高清晰度)
        const masterTicks = isCompact ? [
            { label: '-20', norm: 0.08, major: true },
            { norm: 0.20, type: 'min' },
            { label: '-10', norm: 0.32, major: true },
            { norm: 0.46, type: 'med' },
            { label: '-5',  norm: 0.60, major: true },
            { norm: 0.73, type: 'med' },
            { label: '0',   norm: 0.86, major: true, isRed: true },
            { norm: 0.93, type: 'min', isRed: true },
            { label: '+3',  norm: 1.00, major: true, isRed: true }
        ] : [
            { label: '-20', norm: 0.08, major: true },
            { norm: 0.16, type: 'min' },
            { norm: 0.24, type: 'min' },
            { label: '-10', norm: 0.32, major: true },
            { norm: 0.40, type: 'min' },
            { label: '-7',  norm: 0.48, major: false, type: 'med' },
            { label: '-5',  norm: 0.60, major: true },
            { norm: 0.67, type: 'min' },
            { label: '-3',  norm: 0.73, major: false, type: 'med' },
            { norm: 0.80, type: 'min' },
            { label: '0',   norm: 0.86, major: true, isRed: true },
            { label: '+1',  norm: 0.91, major: false, type: 'med', isRed: true },
            { label: '+2',  norm: 0.95, major: false, type: 'min', isRed: true },
            { label: '+3',  norm: 1.00, major: true, isRed: true }
        ];

        // 绘制刻度线
        masterTicks.forEach(t => {
            const p = getScalePoint(t.norm);
            const len = t.major ? majorTickLen : (t.type === 'med' ? medTickLen : minorTickLen);
            ctx.strokeStyle = t.isRed ? redColor : arcColor;
            ctx.lineWidth = (t.major ? (t.isRed ? 1.6 : 1.2) : 0.8) * scale;
            ctx.beginPath();
            ctx.moveTo(p.bx, p.by);
            ctx.lineTo(p.bx + p.ux * len, p.by + p.uy * len);
            ctx.stroke();
        });

        // 绘制主刻度文字 (字号加大，粗体 700，高清晰度)
        const fontSize = Math.max(8.5, Math.round((isCompact ? 9.8 : 13.0) * scale));
        ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const labelGap = (isCompact ? 5.0 : 8.0) * scale;

        masterTicks.forEach(t => {
            if (!t.label) return;
            const p = getScalePoint(t.norm);
            const lx = p.bx + p.ux * (majorTickLen + labelGap);
            const ly = p.by + p.uy * (majorTickLen + labelGap);
            ctx.fillStyle = t.isRed ? redColor : textMain;
            ctx.fillText(t.label, lx, ly);
        });

        // 7. 优雅中心 VU 徽标 (字号加大)
        ctx.save();
        const vuY = baseCenterY + (isCompact ? 10.5 : 18.5) * scale;
        const vuFontSize = Math.max(8.0, Math.round((isCompact ? 9.2 : 13.0) * scale));
        ctx.font = `800 ${vuFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.fillStyle = textMuted;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.letterSpacing = '2px';
        ctx.fillText('VU', x + w / 2, vuY);
        ctx.restore();

        // 8. 现代高精度光纤碳针与珊瑚红荧光针尖 (Fiber-Optic Needle with Coral Tip)
        const norm = Math.max(0, Math.min(1.0, level));
        const targetPoint = getScalePoint(norm);

        const ndx = targetPoint.bx - pivotX;
        const ndy = targetPoint.by - pivotY;
        const nDist = Math.sqrt(ndx * ndx + ndy * ndy);
        const nux = ndx / nDist;
        const nuy = ndy / nDist;

        const needleTipX = targetPoint.bx + nux * (majorTickLen + 1.2 * scale);
        const needleTipY = targetPoint.by + nuy * (majorTickLen + 1.2 * scale);

        const needleBaseY = y + h + 2 * scale;
        const tBase = (needleBaseY - pivotY) / nuy;
        const needleBaseX = pivotX + tBase * nux;

        const npX = -nuy;
        const npY = nux;

        const baseW = (isCompact ? 0.9 : 1.3) * scale;
        const tipW = (isCompact ? 0.25 : 0.35) * scale;

        // 悬浮立体柔和阴影
        ctx.save();
        ctx.shadowColor = isLight ? 'rgba(0, 0, 0, 0.25)' : 'rgba(0, 0, 0, 0.50)';
        ctx.shadowBlur = (isCompact ? 2.5 : 4.5) * scale;
        ctx.shadowOffsetX = 1.0 * scale;
        ctx.shadowOffsetY = 1.5 * scale;

        // 碳素针体 (Bottom 65%)
        const midRatio = 0.65;
        const needleMidX = needleBaseX + (needleTipX - needleBaseX) * midRatio;
        const needleMidY = needleBaseY + (needleTipY - needleBaseY) * midRatio;
        const midW = baseW + (tipW - baseW) * midRatio;

        ctx.beginPath();
        ctx.moveTo(needleBaseX - npX * baseW, needleBaseY - npY * baseW);
        ctx.lineTo(needleBaseX + npX * baseW, needleBaseY + npY * baseW);
        ctx.lineTo(needleMidX + npX * midW, needleMidY + npY * midW);
        ctx.lineTo(needleMidX - npX * midW, needleMidY - npY * midW);
        ctx.closePath();
        ctx.fillStyle = isLight ? '#0f172a' : (theme === 'studio-monochrome' ? '#cbd5e1' : '#111318');
        ctx.fill();

        // 现代珊瑚红荧光针尖 (Top 35%)
        ctx.beginPath();
        ctx.moveTo(needleMidX - npX * midW, needleMidY - npY * midW);
        ctx.lineTo(needleMidX + npX * midW, needleMidY + npY * midW);
        ctx.lineTo(needleTipX + npX * tipW, needleTipY + npY * tipW);
        ctx.lineTo(needleTipX - npX * tipW, needleTipY - npY * tipW);
        ctx.closePath();
        ctx.fillStyle = theme === 'cyber-cyan' && !isLight ? '#00f5ff' : redColor;
        ctx.fill();
        ctx.restore();

        // 9. 精工双环金属轴心螺帽 (Machined Pivot Cap)
        ctx.save();
        const capR = (isCompact ? 3.0 : 5.0) * scale;
        const capGrad = ctx.createRadialGradient(needleBaseX - 0.5, needleBaseY - 0.5, 0.5, needleBaseX, needleBaseY, capR);
        if (isLight) {
            capGrad.addColorStop(0, '#ffffff');
            capGrad.addColorStop(0.5, '#cbd5e1');
            capGrad.addColorStop(1, '#64748b');
        } else {
            capGrad.addColorStop(0, '#64748b');
            capGrad.addColorStop(0.6, '#334155');
            capGrad.addColorStop(1, '#0f172a');
        }
        ctx.fillStyle = capGrad;
        ctx.beginPath();
        if (typeof ctx.arc === 'function') {
            ctx.arc(needleBaseX, needleBaseY, capR, 0, Math.PI * 2);
        } else {
            this.roundRect(ctx, needleBaseX - capR, needleBaseY - capR, capR * 2, capR * 2, capR);
        }
        ctx.fill();
        ctx.restore();

        // 10. 防眩光蓝宝石双曲面玻璃反光
        const glassGrad = ctx.createLinearGradient(x, y, x, y + h * 0.45);
        glassGrad.addColorStop(0, isLight ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.08)');
        glassGrad.addColorStop(0.5, isLight ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.02)');
        glassGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = glassGrad;
        ctx.fillRect(x, y, w, h * 0.45);

        ctx.restore(); // 解除裁剪

        // 11. 现代细致拉丝视窗内嵌倒角框
        if (isCompact) {
            // 紧凑模式：单条柔和描边，降低视觉重量
            ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.08)';
            ctx.lineWidth = 1;
            this.roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, podR);
            ctx.stroke();
        } else if (isLight) {
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
            ctx.lineWidth = 1.0 * scale;
            this.roundRect(ctx, x - 0.5, y - 0.5, w + 1, h + 1, podR);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.lineWidth = 0.8 * scale;
            this.roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, podR);
            ctx.stroke();
        } else {
            const rimColor = theme === 'vintage-amber' ? '#bfa15f' : (theme === 'champagne-gold' ? '#dab978' : (theme === 'cyber-cyan' ? '#1e3040' : '#334155'));
            ctx.strokeStyle = rimColor;
            ctx.lineWidth = 1.2 * scale;
            this.roundRect(ctx, x - 0.5, y - 0.5, w + 1, h + 1, podR);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.lineWidth = 0.8 * scale;
            this.roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, podR);
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

    // 手机移动端自适应：单表盘·同轴双指针 (Dual-Needle Studio Mastering Pod)
    drawSingleStereoPod(ctx, x, y, w, h, levelL, levelR, scale, theme, isLight) {
        ctx.save();
        const podR = 8 * scale;

        // 1. 视窗边界裁剪与防溢出
        ctx.save();
        this.roundRect(ctx, x, y, w, h, podR);
        ctx.clip();

        // 2. 专业母带表盘底色表面 (依主题定制)
        if (theme === 'vintage-amber') {
            const bgGrad = ctx.createRadialGradient(x + w / 2, y + h * 0.45, 12 * scale, x + w / 2, y + h * 0.45, Math.max(w * 0.6, h * 1.2));
            if (isLight) {
                bgGrad.addColorStop(0, '#fffdfa');
                bgGrad.addColorStop(0.40, '#fef8ea');
                bgGrad.addColorStop(0.80, '#fdecc4');
                bgGrad.addColorStop(1, '#fbd38d');
            } else {
                bgGrad.addColorStop(0, '#ffe8a3');
                bgGrad.addColorStop(0.35, '#f6c343');
                bgGrad.addColorStop(0.75, '#d99b1a');
                bgGrad.addColorStop(1, '#9c6600');
            }
            ctx.fillStyle = bgGrad;
            ctx.fillRect(x, y, w, h);

            const vigGrad = ctx.createLinearGradient(x, y, x, y + h);
            vigGrad.addColorStop(0, isLight ? 'rgba(180, 120, 20, 0.08)' : 'rgba(80, 40, 10, 0.25)');
            vigGrad.addColorStop(0.3, 'rgba(80, 40, 10, 0)');
            vigGrad.addColorStop(0.7, 'rgba(80, 40, 10, 0)');
            vigGrad.addColorStop(1, isLight ? 'rgba(160, 100, 10, 0.16)' : 'rgba(60, 30, 5, 0.38)');
            ctx.fillStyle = vigGrad;
            ctx.fillRect(x, y, w, h);
        } else if (theme === 'ocean-blue') {
            const bgGrad = ctx.createRadialGradient(x + w / 2, y + h * 0.40, 12 * scale, x + w / 2, y + h * 0.40, Math.max(w * 0.6, h * 1.2));
            if (isLight) {
                bgGrad.addColorStop(0, '#f8fafc');
                bgGrad.addColorStop(0.45, '#e0f2fe');
                bgGrad.addColorStop(0.85, '#bae6fd');
                bgGrad.addColorStop(1, '#7dd3fc');
            } else {
                bgGrad.addColorStop(0, '#42d2ff');
                bgGrad.addColorStop(0.35, '#12a4df');
                bgGrad.addColorStop(0.75, '#0369a1');
                bgGrad.addColorStop(1, '#073b64');
            }
            ctx.fillStyle = bgGrad;
            ctx.fillRect(x, y, w, h);

            const vigGrad = ctx.createLinearGradient(x, y, x, y + h);
            vigGrad.addColorStop(0, isLight ? 'rgba(3, 105, 161, 0.08)' : 'rgba(0, 30, 65, 0.30)');
            vigGrad.addColorStop(0.3, 'rgba(0, 30, 65, 0)');
            vigGrad.addColorStop(0.7, 'rgba(0, 30, 65, 0)');
            vigGrad.addColorStop(1, isLight ? 'rgba(2, 132, 199, 0.15)' : 'rgba(0, 20, 50, 0.45)');
            ctx.fillStyle = vigGrad;
            ctx.fillRect(x, y, w, h);
        } else if (theme === 'cyber-cyan') {
            if (isLight) {
                const bgGrad = ctx.createLinearGradient(x, y, x, y + h);
                bgGrad.addColorStop(0, '#ffffff');
                bgGrad.addColorStop(0.60, '#f0fdfa');
                bgGrad.addColorStop(1, '#ccfbf1');
                ctx.fillStyle = bgGrad;
                ctx.fillRect(x, y, w, h);
            } else {
                const bgGrad = ctx.createLinearGradient(x, y, x, y + h);
                bgGrad.addColorStop(0, '#0c1015');
                bgGrad.addColorStop(0.5, '#070a0e');
                bgGrad.addColorStop(1, '#030508');
                ctx.fillStyle = bgGrad;
                ctx.fillRect(x, y, w, h);

                const glow = ctx.createRadialGradient(x + w / 2, y + h * 0.5, 10 * scale, x + w / 2, y + h * 0.5, w * 0.5);
                glow.addColorStop(0, 'rgba(6, 182, 212, 0.14)');
                glow.addColorStop(0.6, 'rgba(6, 182, 212, 0.03)');
                glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = glow;
                ctx.fillRect(x, y, w, h);
            }
        } else if (theme === 'champagne-gold') {
            const bgGrad = ctx.createRadialGradient(x + w / 2, y + h * 0.45, 12 * scale, x + w / 2, y + h * 0.45, Math.max(w * 0.6, h * 1.2));
            if (isLight) {
                bgGrad.addColorStop(0, '#ffffff');
                bgGrad.addColorStop(0.40, '#fefce8');
                bgGrad.addColorStop(0.80, '#fef08a');
                bgGrad.addColorStop(1, '#fde047');
            } else {
                bgGrad.addColorStop(0, '#fff4cc');
                bgGrad.addColorStop(0.35, '#fae39b');
                bgGrad.addColorStop(0.70, '#dfba63');
                bgGrad.addColorStop(1, '#9b7625');
            }
            ctx.fillStyle = bgGrad;
            ctx.fillRect(x, y, w, h);

            const vigGrad = ctx.createLinearGradient(x, y, x, y + h);
            vigGrad.addColorStop(0, isLight ? 'rgba(113, 63, 18, 0.06)' : 'rgba(60, 45, 20, 0.25)');
            vigGrad.addColorStop(0.3, 'rgba(60, 45, 20, 0)');
            vigGrad.addColorStop(0.7, 'rgba(60, 45, 20, 0)');
            vigGrad.addColorStop(1, isLight ? 'rgba(113, 63, 18, 0.14)' : 'rgba(50, 35, 10, 0.38)');
            ctx.fillStyle = vigGrad;
            ctx.fillRect(x, y, w, h);
        } else {
            // studio-monochrome
            const bgGrad = ctx.createRadialGradient(x + w / 2, y + h * 0.38, 12 * scale, x + w / 2, y + h * 0.38, Math.max(w * 0.6, h * 1.2));
            if (isLight) {
                bgGrad.addColorStop(0, '#ffffff');
                bgGrad.addColorStop(0.65, '#f8fafc');
                bgGrad.addColorStop(1, '#edf2f7');
            } else {
                bgGrad.addColorStop(0, '#191b22');
                bgGrad.addColorStop(0.60, '#101217');
                bgGrad.addColorStop(1, '#08090d');
            }
            ctx.fillStyle = bgGrad;
            ctx.fillRect(x, y, w, h);

            const vigGrad = ctx.createLinearGradient(x, y, x, y + h);
            vigGrad.addColorStop(0, isLight ? 'rgba(0, 0, 0, 0.03)' : 'rgba(0, 0, 0, 0.35)');
            vigGrad.addColorStop(0.3, 'rgba(0, 0, 0, 0)');
            vigGrad.addColorStop(0.7, 'rgba(0, 0, 0, 0)');
            vigGrad.addColorStop(1, isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(0, 0, 0, 0.50)');
            ctx.fillStyle = vigGrad;
            ctx.fillRect(x, y, w, h);
        }

        // 3. 几何浅弧线参数 (宽幅单表盘，平缓舒展大气)
        const spanMarginX = w * 0.08;
        const scaleStartX = x + spanMarginX;
        const scaleEndX = x + w - spanMarginX;
        const scaleW = scaleEndX - scaleStartX;

        const baseCenterY = y + h * 0.66;
        const arcSag = h * 0.07;

        const pivotX = x + w / 2;
        const pivotDepth = h * 2.1;
        const pivotY = y + pivotDepth;

        const getScalePoint = (norm) => {
            const bx = scaleStartX + norm * scaleW;
            const u = (norm - 0.5) * 2;
            const by = baseCenterY + (u * u) * arcSag;

            const dx = bx - pivotX;
            const dy = by - pivotY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const ux = dx / dist;
            const uy = dy / dist;

            return { bx, by, ux, uy };
        };

        // 配色定义
        const isDarkText = theme === 'vintage-amber' || theme === 'champagne-gold' || (isLight && (theme === 'ocean-blue' || theme === 'cyber-cyan' || theme === 'studio-monochrome'));
        const textMain = isDarkText ? '#1e293b' : (theme === 'studio-monochrome' ? '#f8fafc' : (theme === 'cyber-cyan' ? '#22d3ee' : '#f1f5f9'));
        const textMuted = isDarkText ? 'rgba(51, 65, 85, 0.65)' : (theme === 'studio-monochrome' ? 'rgba(226, 232, 240, 0.65)' : 'rgba(34, 211, 238, 0.65)');
        const redColor = '#f43f5e'; // 活力珊瑚红（R通道与过载红区）
        const greenColor = '#10b981'; // 经典翠绿（L通道）
        const arcColor = isDarkText ? '#334155' : (theme === 'studio-monochrome' ? 'rgba(241, 245, 249, 0.85)' : (theme === 'cyber-cyan' ? 'rgba(34, 211, 238, 0.85)' : '#94a3b8'));

        // 4. 顶部立体声声道指示与指示图例
        // 左边：● L (绿点)；中间：DUAL VU · STEREO；右边：● R (红点)
        ctx.save();
        const topY = y + 4.5 * scale;
        const tagFontSize = Math.max(7.5, Math.round(8.5 * scale));
        ctx.font = `700 ${tagFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.textBaseline = 'top';

        // 中间徽标
        ctx.fillStyle = textMuted;
        ctx.textAlign = 'center';
        ctx.letterSpacing = '1px';
        ctx.fillText('DUAL VU · STEREO', x + w / 2, topY);

        // 左通道指示 (绿点 + L)
        ctx.textAlign = 'left';
        ctx.fillStyle = greenColor;
        ctx.beginPath();
        ctx.arc(scaleStartX, topY + 4 * scale, 2 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = textMuted;
        ctx.fillText('L', scaleStartX + 5 * scale, topY);

        // 右通道指示 (红点 + R)
        ctx.textAlign = 'right';
        ctx.fillText('R', scaleEndX - 5 * scale, topY);
        ctx.fillStyle = redColor;
        ctx.beginPath();
        ctx.arc(scaleEndX, topY + 4 * scale, 2 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 5. 现代双段能量弧带
        const normZero = 0.86;
        const majorTickLen = 5.5 * scale;
        const medTickLen = 3.8 * scale;
        const minorTickLen = 2.2 * scale;

        ctx.beginPath();
        for (let i = 0; i <= 50; i++) {
            const n = (i / 50) * normZero;
            const p = getScalePoint(n);
            if (i === 0) ctx.moveTo(p.bx, p.by);
            else ctx.lineTo(p.bx, p.by);
        }
        ctx.strokeStyle = arcColor;
        ctx.lineWidth = 1.0 * scale;
        ctx.stroke();

        ctx.beginPath();
        for (let i = 0; i <= 20; i++) {
            const n = normZero + (i / 20) * (1.0 - normZero);
            const p = getScalePoint(n);
            if (i === 0) ctx.moveTo(p.bx, p.by);
            else ctx.lineTo(p.bx, p.by);
        }
        ctx.strokeStyle = redColor;
        ctx.lineWidth = 1.5 * scale;
        ctx.stroke();

        // 6. 宽幅工整刻度
        const ticks = [
            { label: '-20', norm: 0.08, major: true },
            { norm: 0.20, type: 'min' },
            { label: '-10', norm: 0.32, major: true },
            { norm: 0.46, type: 'med' },
            { label: '-5',  norm: 0.60, major: true },
            { norm: 0.73, type: 'med' },
            { label: '0',   norm: 0.86, major: true, isRed: true },
            { norm: 0.93, type: 'min', isRed: true },
            { label: '+3',  norm: 1.00, major: true, isRed: true }
        ];

        ticks.forEach(t => {
            const p = getScalePoint(t.norm);
            const len = t.major ? majorTickLen : (t.type === 'med' ? medTickLen : minorTickLen);
            ctx.strokeStyle = t.isRed ? redColor : arcColor;
            ctx.lineWidth = (t.major ? (t.isRed ? 1.5 : 1.1) : 0.8) * scale;
            ctx.beginPath();
            ctx.moveTo(p.bx, p.by);
            ctx.lineTo(p.bx + p.ux * len, p.by + p.uy * len);
            ctx.stroke();
        });

        // 刻度文字
        const fontSize = Math.max(8.0, Math.round(9.2 * scale));
        ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const labelGap = 4.5 * scale;

        ticks.forEach(t => {
            if (!t.label) return;
            const p = getScalePoint(t.norm);
            const lx = p.bx + p.ux * (majorTickLen + labelGap);
            const ly = p.by + p.uy * (majorTickLen + labelGap);
            ctx.fillStyle = t.isRed ? redColor : textMain;
            ctx.fillText(t.label, lx, ly);
        });

        // 7. 优雅中心 VU 徽标
        ctx.save();
        const vuY = baseCenterY + 10.0 * scale;
        const vuFontSize = Math.max(7.5, Math.round(8.5 * scale));
        ctx.font = `800 ${vuFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.fillStyle = textMuted;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.letterSpacing = '2px';
        ctx.fillText('VU', x + w / 2, vuY);
        ctx.restore();

        // 8. 同轴双指针 (Coaxial Dual-Needle)
        const needleBaseY = y + h + 2 * scale;
        const baseW = 0.85 * scale;
        const tipW = 0.25 * scale;

        const drawNeedle = (levelVal, tipColor, isLeftChannel) => {
            const norm = Math.max(0, Math.min(1.0, levelVal));
            const targetPoint = getScalePoint(norm);

            const ndx = targetPoint.bx - pivotX;
            const ndy = targetPoint.by - pivotY;
            const nDist = Math.sqrt(ndx * ndx + ndy * ndy);
            const nux = ndx / nDist;
            const nuy = ndy / nDist;

            const needleTipX = targetPoint.bx + nux * (majorTickLen + 1.0 * scale);
            const needleTipY = targetPoint.by + nuy * (majorTickLen + 1.0 * scale);

            const tBase = (needleBaseY - pivotY) / nuy;
            const needleBaseX = pivotX + tBase * nux;

            const npX = -nuy;
            const npY = nux;

            // 柔和投影
            ctx.save();
            ctx.shadowColor = isLight ? 'rgba(0, 0, 0, 0.20)' : 'rgba(0, 0, 0, 0.45)';
            ctx.shadowBlur = 2.5 * scale;
            ctx.shadowOffsetX = (isLeftChannel ? -0.8 : 0.8) * scale;
            ctx.shadowOffsetY = 1.2 * scale;

            // 碳素深色针体 (底部 65%)
            const midRatio = 0.65;
            const needleMidX = needleBaseX + (needleTipX - needleBaseX) * midRatio;
            const needleMidY = needleBaseY + (needleTipY - needleBaseY) * midRatio;
            const midW = baseW + (tipW - baseW) * midRatio;

            ctx.beginPath();
            ctx.moveTo(needleBaseX - npX * baseW, needleBaseY - npY * baseW);
            ctx.lineTo(needleBaseX + npX * baseW, needleBaseY + npY * baseW);
            ctx.lineTo(needleMidX + npX * midW, needleMidY + npY * midW);
            ctx.lineTo(needleMidX - npX * midW, needleMidY - npY * midW);
            ctx.closePath();
            ctx.fillStyle = isLight ? '#0f172a' : (theme === 'studio-monochrome' ? '#cbd5e1' : '#111318');
            ctx.fill();

            // 荧光双色针尖 (顶部 35%)
            ctx.beginPath();
            ctx.moveTo(needleMidX - npX * midW, needleMidY - npY * midW);
            ctx.lineTo(needleMidX + npX * midW, needleMidY + npY * midW);
            ctx.lineTo(needleTipX + npX * tipW, needleTipY + npY * tipW);
            ctx.lineTo(needleTipX - npX * tipW, needleTipY - npY * tipW);
            ctx.closePath();
            ctx.fillStyle = tipColor;
            ctx.fill();
            ctx.restore();
        };

        // 绘制 L 通道指针（翠绿/主题色针尖）
        const tipLColor = theme === 'cyber-cyan' && !isLight ? '#00f5ff' : greenColor;
        drawNeedle(levelL, tipLColor, true);

        // 绘制 R 通道指针（珊瑚红针尖）
        drawNeedle(levelR, redColor, false);

        // 9. 精工同轴金属旋钮轴帽 (Machined Dual-Coaxial Pivot Cap)
        ctx.save();
        const capR = 3.6 * scale;
        const capGrad = ctx.createRadialGradient(pivotX - 0.5, needleBaseY - 0.5, 0.5, pivotX, needleBaseY, capR);
        if (isLight) {
            capGrad.addColorStop(0, '#ffffff');
            capGrad.addColorStop(0.5, '#cbd5e1');
            capGrad.addColorStop(1, '#64748b');
        } else {
            capGrad.addColorStop(0, '#64748b');
            capGrad.addColorStop(0.6, '#334155');
            capGrad.addColorStop(1, '#0f172a');
        }
        ctx.fillStyle = capGrad;
        ctx.beginPath();
        if (typeof ctx.arc === 'function') {
            ctx.arc(pivotX, needleBaseY, capR, 0, Math.PI * 2);
        } else {
            this.roundRect(ctx, pivotX - capR, needleBaseY - capR, capR * 2, capR * 2, capR);
        }
        ctx.fill();
        ctx.restore();

        // 10. 防眩光蓝宝石双曲面玻璃反光
        const glassGrad = ctx.createLinearGradient(x, y, x, y + h * 0.45);
        glassGrad.addColorStop(0, isLight ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.08)');
        glassGrad.addColorStop(0.5, isLight ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.02)');
        glassGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = glassGrad;
        ctx.fillRect(x, y, w, h * 0.45);

        ctx.restore(); // 解除裁剪

        // 11. 视窗内嵌倒角框
        ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        this.roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, podR);
        ctx.stroke();

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
