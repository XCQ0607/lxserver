/**
 * Lyric Card Share Manager
 * 歌词卡片分享功能 - 将当前播放歌曲渲染为海报图片
 */

(function () {
    'use strict';

    // ==========================================
    // 配置与状态
    // ==========================================
    const CARD_SIZES = {
        portrait: { w: 1080, h: 1920, label: '竖版 9:16' },
        landscape: { w: 1920, h: 1080, label: '横版 16:9' },
        square: { w: 1080, h: 1080, label: '方形 1:1' },
    };

    let state = {
        layout: 'landscape', // 默认横版
        colorTheme: 'light',     // 默认浅色
        showCover: true,
        showTitle: true,
        showArtist: true,
        showLyric: true,
        lyricLines: 5,           // 默认5行
        fontSize: 1.0,
        lineSpacing: 1.0,
        fontFamily: '',
        scale: 1.0,
        isDragging: false,
        dragStart: { x: 0, y: 0 },
        panOffset: { x: 0, y: 0 },
        albumColors: null,
    };

    let _coverImage = null;
    let _renderTimer = null;
    let _wasPlaying = false;

    // ==========================================
    // 工具函数
    // ==========================================

    function extractAlbumColors(img) {
        const canvas = document.createElement('canvas');
        const size = 100;
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        const regions = [
            [0, 0, 30, 30], [70, 0, 100, 30], [0, 70, 30, 100], [70, 70, 100, 100], [35, 35, 65, 65],
        ];
        let bestR = 0, bestG = 0, bestB = 0, maxSat = -1;
        for (const [x1, y1, x2, y2] of regions) {
            let r = 0, g = 0, b = 0, cnt = 0;
            for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) {
                const i = (y * size + x) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; cnt++;
            }
            r = Math.round(r / cnt); g = Math.round(g / cnt); b = Math.round(b / cnt);
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            const sat = mx === 0 ? 0 : (mx - mn) / mx;
            if (sat > maxSat) { maxSat = sat; bestR = r; bestG = g; bestB = b; }
        }
        const lum = 0.299 * bestR + 0.587 * bestG + 0.114 * bestB;
        const isDark = lum < 160;
        const dk = (v, f) => Math.max(0, Math.round(v * f));
        return {
            bg1: `rgb(${dk(bestR, .2)},${dk(bestG, .2)},${dk(bestB, .2)})`,
            bg2: `rgb(${dk(bestR, .08)},${dk(bestG, .08)},${dk(bestB, .08)})`,
            accent: `rgb(${bestR},${bestG},${bestB})`,
            textColor: isDark ? '#ffffff' : '#1a1a2e',
            subColor: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.55)',
            isDark,
        };
    }

    function getCurrentLyricContext() {
        const lines = window.currentLyricLines || [];
        const idx = (typeof window.currentLyricIndex === 'number') ? window.currentLyricIndex : -1;
        if (!lines.length || idx < 0) return { current: '♪ 暂无歌词', context: [] };
        const half = Math.floor(state.lyricLines / 2);
        const start = Math.max(0, idx - half);
        const end = Math.min(lines.length - 1, idx + (state.lyricLines - 1 - half));
        const context = [];
        for (let i = start; i <= end; i++) {
            const t = (typeof lines[i] === 'object') ? (lines[i].text || lines[i].content || '') : String(lines[i]);
            context.push({ text: t, isActive: i === idx });
        }
        return { context };
    }

    function getFontFamily() {
        if (state.fontFamily) return state.fontFamily;
        return (window.settings && window.settings.lyricFontFamily) || '-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    }

    /**
     * 加载图片 (支持跨域代理回退)
     * @param {string} src 图片地址
     * @returns {Promise<HTMLImageElement>}
     */
    function loadImage(src) {
        return new Promise((res, rej) => {
            if (!src) { rej(new Error('no src')); return; }

            const img = new Image();
            img.crossOrigin = 'anonymous'; // 必须开启，否则无法导出 Canvas

            img.onload = () => res(img);

            img.onerror = () => {
                // 如果直接加载失败（通常是 CORS 问题），尝试通过本地后端代理加载
                console.log('[LyricCard] 图片加载失败，尝试通过代理加载:', src);
                const proxyUrl = `/api/music/download?url=${encodeURIComponent(src)}&inline=1`;

                const proxyImg = new Image();
                proxyImg.crossOrigin = 'anonymous';
                proxyImg.onload = () => res(proxyImg);
                proxyImg.onerror = () => rej(new Error('图片加载失败 (代理加载也无法完成)'));
                proxyImg.src = proxyUrl;
            };

            // 如果 src 是本地占位符或者已经是 base64，不需要代理
            if (src.includes('logo.svg') || src.startsWith('data:')) {
                img.src = src;
            } else {
                img.src = src;
            }
        });
    }

    function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
        ctx.textBaseline = 'top';
        let line = '', lineCount = 0;
        const tokens = text.match(/[\u4e00-\u9fa5]|[a-zA-Z0-9']+|./g) || [];
        for (let i = 0; i < tokens.length; i++) {
            const test = line + tokens[i];
            if (ctx.measureText(test).width > maxWidth && line) {
                ctx.fillText(line, x, y + lineCount * lineHeight); line = tokens[i]; lineCount++;
            } else line = test;
        }
        ctx.fillText(line, x, y + lineCount * lineHeight);
        return lineCount + 1;
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    }

    function measureTitleLines(title, fontSize, font, maxW) {
        const c = document.createElement('canvas').getContext('2d');
        c.font = `bold ${fontSize}px ${font}`;
        const tokens = title.match(/[\u4e00-\u9fa5]|[a-zA-Z0-9']+|./g) || [];
        let line = '', lines = 1;
        for (const tk of tokens) {
            const test = line + tk;
            if (c.measureText(test).width > maxW && line) { lines++; line = tk; }
            else line = test;
        }
        return lines;
    }

    function autoCalcFontSize(title, W, layout) {
        const font = getFontFamily();
        const pad = W * 0.1;
        const maxW = layout === 'landscape' ? W * 0.45 : W - pad * 2;
        const baseRatio = layout === 'landscape' ? 0.08 : 0.075;
        for (let r = 1.0; r >= 0.5; r -= 0.05) {
            const fs = W * baseRatio * r;
            if (measureTitleLines(title, fs, font, maxW) <= 1) return Math.round(r * 100) / 100;
        }
        return 0.5;
    }

    function calcDynamicCoverSize(W, H, layout, fMul) {
        const song = window.currentPlayingSong || {};
        const title = song.name || '未知歌曲';

        if (layout === 'portrait') {
            const topPad = H * 0.07;
            const bottomPad = H * 0.06;
            const titleH = state.showTitle ? W * 0.075 * fMul * 1.35 + H * 0.015 : 0;
            const artistH = state.showArtist ? W * 0.043 * fMul * 1.4 + H * 0.02 : 0;
            const dividerH = state.showLyric ? H * 0.03 : 0;
            const lyricFS = W * 0.06 * fMul;
            const lyricH = state.showLyric ? (lyricFS * 1.6 * state.lineSpacing) * state.lyricLines * 1.2 : 0;
            const availForCover = H - topPad - bottomPad - titleH - artistH - dividerH - lyricH - H * 0.05;
            return Math.max(W * 0.3, Math.min(W * 0.75, availForCover));

        } else if (layout === 'square') {
            const topPad = H * 0.04;
            const bottomPad = H * 0.06;
            const titleH = state.showTitle ? W * 0.068 * fMul * 1.25 + H * 0.01 : 0;
            const artistH = state.showArtist ? W * 0.04 * fMul * 1.6 + H * 0.015 : 0;
            const dividerH = state.showLyric ? H * 0.02 : 0;
            const lyricFS = W * 0.055 * fMul;
            const lyricH = state.showLyric ? (lyricFS * 1.6 * state.lineSpacing) * state.lyricLines * 1.25 : 0;
            const availForCover = H - topPad - bottomPad - titleH - artistH - dividerH - lyricH - H * 0.02;
            return Math.max(W * 0.3, Math.min(W * 0.85, availForCover));

        } else {
            const availH = H * 0.8;
            return Math.max(H * 0.4, Math.min(H * 0.75, availH));
        }
    }

    // ==========================================
    // Canvas 渲染引擎
    // ==========================================

    async function renderCard() {
        const size = CARD_SIZES[state.layout];
        const W = size.w, H = size.h;
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');

        const song = window.currentPlayingSong || {};
        const title = song.name || document.getElementById('player-title')?.textContent?.trim() || '未知歌曲';
        const artist = song.singer || song.artist || document.getElementById('player-artist')?.textContent?.trim() || '未知歌手';

        let colors;
        if (state.colorTheme === 'dark') {
            colors = {
                bg1: '#0f0c29', bg2: '#302b63', accent: '#a78bfa', textColor: '#ffffff',
                subColor: 'rgba(255,255,255,0.6)', lyricActive: '#ffffff', lyricInactive: 'rgba(255,255,255,0.35)', isDark: true
            };
        } else if (state.colorTheme === 'light') {
            colors = {
                bg1: '#ffffff', bg2: '#f0f4f8', accent: '#4a90e2', textColor: '#1a1a2e',
                subColor: 'rgba(0,0,0,0.5)', lyricActive: '#1a1a2e', lyricInactive: 'rgba(0,0,0,0.3)', isDark: false
            };
        } else {
            const ex = state.albumColors || {
                bg1: '#1a1a2e', bg2: '#0d0d1a', accent: '#4a90e2',
                textColor: '#ffffff', subColor: 'rgba(255,255,255,0.6)', isDark: true
            };
            colors = { ...ex, lyricActive: ex.textColor, lyricInactive: ex.subColor };
        }

        if (state.colorTheme === 'album' && _coverImage) {
            ctx.save(); ctx.filter = 'blur(60px)';
            ctx.drawImage(_coverImage, -W * .15, -H * .15, W * 1.3, H * 1.3);
            ctx.restore();
            ctx.fillStyle = colors.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.25)';
            ctx.fillRect(0, 0, W, H);
        } else {
            const grad = ctx.createLinearGradient(0, 0, W * .4, H);
            grad.addColorStop(0, colors.bg1); grad.addColorStop(1, colors.bg2);
            ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
            const glow = ctx.createRadialGradient(W * .8, H * .15, 0, W * .8, H * .15, W * .65);
            glow.addColorStop(0, colors.accent + '33'); glow.addColorStop(1, 'transparent');
            ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
        }

        if (state.layout === 'portrait') await renderPortrait(ctx, W, H, title, artist, colors);
        else if (state.layout === 'landscape') await renderLandscape(ctx, W, H, title, artist, colors);
        else await renderSquare(ctx, W, H, title, artist, colors);

        drawWatermark(ctx, W, H, colors);
        const dataUrl = canvas.toDataURL('image/png');
        const previewImg = document.getElementById('lyric-card-preview-img');
        if (previewImg) { previewImg.src = dataUrl; previewImg.dataset.dataUrl = dataUrl; }
    }

    async function renderPortrait(ctx, W, H, title, artist, colors) {
        const pad = W * 0.1, font = getFontFamily(), fMul = state.fontSize, bottomLimit = H * 0.94;
        const coverSize = (state.showCover && _coverImage) ? calcDynamicCoverSize(W, H, 'portrait', fMul) : 0;
        let y = H * 0.07;
        if (coverSize > 0) {
            const cx = (W - coverSize) / 2;
            ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 20;
            roundRect(ctx, cx, y, coverSize, coverSize, coverSize * 0.06);
            ctx.clip(); ctx.drawImage(_coverImage, cx, y, coverSize, coverSize);
            ctx.restore();
            y += coverSize + H * 0.05;
        }
        const titleFS = W * 0.075 * fMul, artistFS = W * 0.043 * fMul;
        ctx.textBaseline = 'top';
        if (state.showTitle) {
            ctx.font = `bold ${titleFS}px ${font}`;
            ctx.fillStyle = colors.textColor; ctx.textAlign = 'center';
            const lc = drawWrappedText(ctx, title, W / 2, y, W - pad * 2, titleFS * 1.3);
            y += lc * titleFS * 1.3 + H * 0.005; // 缩小间距
        }
        if (state.showArtist) {
            ctx.font = `${artistFS}px ${font}`;
            ctx.fillStyle = colors.subColor; ctx.textAlign = 'center';
            ctx.fillText(artist, W / 2, y);
            y += artistFS * 1.4 + H * 0.02;
        }
        if (state.showLyric) {
            ctx.strokeStyle = colors.accent + '55'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(pad * 1.5, y); ctx.lineTo(W - pad * 1.5, y); ctx.stroke();
            y += H * 0.025;
            const availH = bottomLimit - y;
            const lyrFS = Math.min(W * 0.06 * fMul, availH / (state.lyricLines * 1.7 * state.lineSpacing));
            const lyrLH = lyrFS * 1.6 * state.lineSpacing;
            const lyrY = y + (availH - lyrLH * state.lyricLines) / 2;
            drawLyricLines(ctx, W, lyrY, pad, colors, 'center', lyrFS, lyrLH, font);
        }
    }

    async function renderLandscape(ctx, W, H, title, artist, colors) {
        const pad = H * 0.1, font = getFontFamily(), fMul = state.fontSize, bottomLimit = H * 0.92;
        const coverSize = (state.showCover && _coverImage) ? calcDynamicCoverSize(W, H, 'landscape', fMul) : 0;
        const coverX = pad, coverY = (H - coverSize) / 2;
        if (coverSize > 0) {
            ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 50; ctx.shadowOffsetX = 15;
            roundRect(ctx, coverX, coverY, coverSize, coverSize, coverSize * 0.06);
            ctx.clip(); ctx.drawImage(_coverImage, coverX, coverY, coverSize, coverSize);
            ctx.restore();
        }

        const textX = coverSize > 0 ? coverX + coverSize + pad : pad;
        const textW = W - textX - pad;
        const startY = H * 0.18;
        let y = startY;
        const titleFS = H * 0.08 * fMul, artistFS = H * 0.048 * fMul;
        const xOff = textX + 24;
        ctx.textBaseline = 'top';

        if (state.showTitle) {
            ctx.font = `bold ${titleFS}px ${font}`;
            ctx.fillStyle = colors.textColor; ctx.textAlign = 'left';
            const lc = drawWrappedText(ctx, title, xOff, y, textW - 24, titleFS * 1.2);
            y += lc * titleFS * 1.2 + H * 0.008;
        }
        if (state.showArtist) {
            ctx.font = `${artistFS}px ${font}`;
            ctx.fillStyle = colors.subColor; ctx.textAlign = 'left';
            ctx.fillText(artist, xOff, y);
            y += artistFS * 1.4 + H * 0.035;
        }

        let endY = y;
        if (state.showLyric) {
            const availH = bottomLimit - y;
            const lyrFS = Math.min(H * 0.058 * fMul, availH / (state.lyricLines * 1.7 * state.lineSpacing));
            const lyrLH = lyrFS * 1.6 * state.lineSpacing;
            const lyrY = y + (availH - lyrLH * state.lyricLines) / 2;
            drawLyricLines(ctx, W, lyrY, 0, colors, 'left', lyrFS, lyrLH, font, xOff, textW - 24);
            // 计算末行歌词的大致高度
            endY = lyrY + lyrLH * (state.lyricLines + 0.15);
        }

        // 最后绘制分割线，确保长度覆盖到 endY
        ctx.strokeStyle = colors.accent; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(textX, startY); ctx.lineTo(textX, endY); ctx.stroke();
    }

    async function renderSquare(ctx, W, H, title, artist, colors) {
        const pad = W * 0.08, font = getFontFamily(), fMul = state.fontSize, bottomLimit = H * 0.93;
        const coverSize = (state.showCover && _coverImage) ? calcDynamicCoverSize(W, H, 'square', fMul) : 0;
        let y = H * 0.04;
        if (coverSize > 0) {
            const cx = (W - coverSize) / 2;
            ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 15;
            roundRect(ctx, cx, y, coverSize, coverSize, coverSize * 0.08);
            ctx.clip(); ctx.drawImage(_coverImage, cx, y, coverSize, coverSize);
            ctx.restore();
            y += coverSize + H * 0.02;
        }
        const titleFS = W * 0.068 * fMul, artistFS = W * 0.04 * fMul;
        ctx.textBaseline = 'top';
        if (state.showTitle) {
            ctx.font = `bold ${titleFS}px ${font}`;
            ctx.fillStyle = colors.textColor; ctx.textAlign = 'center';
            // 减小行高 (1.4 -> 1.25)，固定间距
            const lc = drawWrappedText(ctx, title, W / 2, y, W - pad * 2, titleFS * 1.25);
            y += lc * titleFS * 1.25 + H * 0.01;
        }
        if (state.showArtist) {
            ctx.font = `${artistFS}px ${font}`;
            ctx.fillStyle = colors.subColor; ctx.textAlign = 'center';
            ctx.fillText(artist, W / 2, y);
            y += artistFS * 1.6 + H * 0.015;
        }
        if (state.showLyric) {
            ctx.strokeStyle = colors.isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.15)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(pad * 2, y); ctx.lineTo(W - pad * 2, y); ctx.stroke();
            y += H * 0.02;
            const availH = bottomLimit - y;
            const lyrFS = Math.min(W * 0.055 * fMul, availH / (state.lyricLines * 1.7 * state.lineSpacing));
            const lyrLH = lyrFS * 1.6 * state.lineSpacing;
            const lyrY = y + (availH - lyrLH * state.lyricLines) / 2;
            drawLyricLines(ctx, W, lyrY, pad, colors, 'center', lyrFS, lyrLH, font);
        }
    }

    function drawLyricLines(ctx, W, startY, pad, colors, align, fontSize, lineH, font, fixedX, maxW) {
        const { context } = getCurrentLyricContext();
        if (!context.length) return;
        ctx.textAlign = align; ctx.textBaseline = 'top';
        let y = startY;
        context.forEach(({ text, isActive }) => {
            const fs = isActive ? fontSize * 1.15 : fontSize;
            ctx.font = isActive ? `bold ${fs}px ${font || getFontFamily()}` : `${fs}px ${font || getFontFamily()}`;
            ctx.fillStyle = isActive ? colors.lyricActive : colors.lyricInactive;
            if (align === 'center') ctx.fillText(text, W / 2, y, W - pad * 2);
            else ctx.fillText(text, fixedX || pad, y, maxW || W - pad * 2);
            y += lineH * (isActive ? 1.2 : 1.0);
        });
    }

    function drawWatermark(ctx, W, H, colors) {
        const iconSize = Math.round(W * 0.028), fontSize = Math.round(W * 0.022);
        const padR = Math.round(W * 0.04), padB = Math.round(H * 0.04);
        const text = 'LX Sync';
        const iconColor = colors.isDark !== false ? 'rgba(255,255,255,0.7)' : 'rgba(30,30,30,0.6)';
        const textColor = colors.isDark !== false ? 'rgba(255,255,255,0.6)' : 'rgba(30,30,30,0.5)';

        ctx.save();
        ctx.textBaseline = 'middle'; // 强制垂直居中对齐
        ctx.font = `bold ${fontSize}px -apple-system,"PingFang SC",sans-serif`;
        ctx.fillStyle = textColor; ctx.textAlign = 'right';

        const y = H - padB;
        ctx.fillText(text, W - padR, y);

        const tw = ctx.measureText(text).width;
        const ix = W - padR - tw - iconSize - 8;
        const iy = y - iconSize / 2; // 图标中心与文字中心重合
        const s = iconSize / 24;

        ctx.strokeStyle = iconColor; ctx.lineWidth = 2 * s; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(ix + 9 * s, iy + 18 * s); ctx.lineTo(ix + 9 * s, iy + 5 * s);
        ctx.lineTo(ix + 21 * s, iy + 3 * s); ctx.lineTo(ix + 21 * s, iy + 16 * s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ix + 6 * s, iy + 15 * s); ctx.lineTo(ix + 6 * s, iy + 23 * s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ix + 12 * s, iy + 15 * s); ctx.lineTo(ix + 12 * s, iy + 23 * s); ctx.stroke();
        ctx.restore();
    }

    function initPreviewInteraction() {
        const wrapper = document.getElementById('lyric-card-preview-wrapper');
        const img = document.getElementById('lyric-card-preview-img');
        if (!wrapper || !img) return;
        const nw = wrapper.cloneNode(false);
        while (wrapper.firstChild) nw.appendChild(wrapper.firstChild);
        wrapper.parentNode.replaceChild(nw, wrapper);
        state.scale = 1.0; state.panOffset = { x: 0, y: 0 };
        nw.addEventListener('wheel', e => {
            e.preventDefault();
            state.scale = Math.min(4, Math.max(0.3, state.scale + (e.deltaY > 0 ? -0.1 : 0.1)));
            img.style.transform = `translate(${state.panOffset.x}px,${state.panOffset.y}px) scale(${state.scale})`;
        }, { passive: false });
        nw.addEventListener('mousedown', e => {
            state.isDragging = true;
            state.dragStart = { x: e.clientX - state.panOffset.x, y: e.clientY - state.panOffset.y };
            nw.style.cursor = 'grabbing';
        });
        window.addEventListener('mousemove', e => {
            if (!state.isDragging) return;
            state.panOffset = { x: e.clientX - state.dragStart.x, y: e.clientY - state.dragStart.y };
            img.style.transform = `translate(${state.panOffset.x}px,${state.panOffset.y}px) scale(${state.scale})`;
        });
        window.addEventListener('mouseup', () => { state.isDragging = false; nw.style.cursor = 'grab'; });
        nw.addEventListener('dblclick', () => { state.scale = 1.0; state.panOffset = { x: 0, y: 0 }; img.style.transform = ''; });
    }

    async function open() {
        const modal = document.getElementById('lyric-card-modal'), content = document.getElementById('lyric-card-modal-content');
        if (!modal) return;
        const audio = document.getElementById('audio-player');
        _wasPlaying = audio && !audio.paused;
        if (_wasPlaying) audio.pause();
        modal.classList.remove('hidden'); modal.classList.add('flex');
        requestAnimationFrame(() => content.classList.remove('translate-y-10', 'opacity-0'));
        const coverEl = document.getElementById('detail-cover') || document.getElementById('player-cover') ||
            document.querySelector('#player-footer img[src]:not([src*="logo"])') || document.querySelector('img[id*="cover"]');
        _coverImage = null;
        if (coverEl && coverEl.src && !coverEl.src.includes('logo.svg') && !coverEl.src.startsWith('data:image/svg')) {
            try { _coverImage = await loadImage(coverEl.src); state.albumColors = extractAlbumColors(_coverImage); }
            catch (err) { console.warn(err); }
        }
        document.querySelectorAll('.lc-layout-btn').forEach(b => b.classList.toggle('lc-btn-active', b.dataset.layout === state.layout));
        document.querySelectorAll('.lc-color-btn').forEach(b => b.classList.toggle('lc-btn-active', b.dataset.color === state.colorTheme));
        document.querySelectorAll('.lc-lines-btn').forEach(b => b.classList.toggle('lc-btn-active', parseInt(b.dataset.lines) === state.lyricLines));
        const sz = CARD_SIZES[state.layout];
        state.fontSize = autoCalcFontSize((window.currentPlayingSong || {}).name || '未知歌曲', sz.w, state.layout);

        // 初始化滑块标签
        const fsLabel = document.getElementById('lc-font-size-label');
        if (fsLabel) fsLabel.textContent = Math.round(state.fontSize * 100) + '%';
        const fsInput = document.getElementById('lc-font-size-input');
        if (fsInput) fsInput.value = state.fontSize;

        const lsLabel = document.getElementById('lc-line-spacing-label');
        if (lsLabel) lsLabel.textContent = state.lineSpacing + (state.lineSpacing == 1 ? '.0x' : 'x');
        const lsInput = document.getElementById('lc-line-spacing-input');
        if (lsInput) lsInput.value = state.lineSpacing;

        initPreviewInteraction(); scheduleRender();
    }

    function close() {
        const modal = document.getElementById('lyric-card-modal'), content = document.getElementById('lyric-card-modal-content');
        if (!modal) return;
        content.classList.add('translate-y-10', 'opacity-0');
        setTimeout(() => { modal.classList.add('hidden'); modal.classList.remove('flex'); }, 400);
        if (_wasPlaying) { const a = document.getElementById('audio-player'); if (a) a.play().catch(() => { }); }
    }

    function scheduleRender() { clearTimeout(_renderTimer); _renderTimer = setTimeout(() => { renderCard().catch(e => console.error(e)); }, 80); }
    function setLayout(layout) {
        state.layout = layout;
        document.querySelectorAll('.lc-layout-btn').forEach(b => b.classList.toggle('lc-btn-active', b.dataset.layout === layout));

        // 每次切换版式，都强制重写大小
        const sz = CARD_SIZES[layout];
        const autoFS = autoCalcFontSize((window.currentPlayingSong || {}).name || '未知歌曲', sz.w, layout);
        setFontSize(autoFS);

        scheduleRender();
    }
    function setColorTheme(theme) { state.colorTheme = theme; document.querySelectorAll('.lc-color-btn').forEach(b => b.classList.toggle('lc-btn-active', b.dataset.color === theme)); scheduleRender(); }
    function setLyricLines(n) {
        state.lyricLines = parseInt(n);
        document.querySelectorAll('.lc-lines-btn').forEach(b => b.classList.toggle('lc-btn-active', parseInt(b.dataset.lines) === state.lyricLines));

        // 调整行数也重算
        const sz = CARD_SIZES[state.layout];
        const autoFS = autoCalcFontSize((window.currentPlayingSong || {}).name || '未知歌曲', sz.w, state.layout);
        setFontSize(autoFS);

        scheduleRender();
    }
    function setFontSize(val) {
        state.fontSize = parseFloat(val);
        const label = document.getElementById('lc-font-size-label');
        if (label) label.textContent = Math.round(val * 100) + '%';
        const input = document.getElementById('lc-font-size-input');
        if (input) input.value = val;
        scheduleRender();
    }
    function setLineSpacing(val) {
        state.lineSpacing = parseFloat(val);
        const label = document.getElementById('lc-line-spacing-label');
        if (label) label.textContent = val + (val == 1 ? '.0x' : 'x');
        const input = document.getElementById('lc-line-spacing-input');
        if (input) input.value = val;
        scheduleRender();
    }
    function setFontFamily(val) { state.fontFamily = val; scheduleRender(); }
    function toggleOption(key) { state[key] = !state[key]; scheduleRender(); }
    function download() {
        const img = document.getElementById('lyric-card-preview-img'); if (!img || !img.dataset.dataUrl) return;
        const song = window.currentPlayingSong || {}, a = document.createElement('a'); a.href = img.dataset.dataUrl;
        a.download = `${song.name || 'lyric-card'} - ${song.singer || ''}.png`.replace(/[/\\?%*:|"<>]/g, '_'); a.click();
    }
    async function copyToClipboard() {
        const img = document.getElementById('lyric-card-preview-img'); if (!img || !img.dataset.dataUrl) return;
        const r = await fetch(img.dataset.dataUrl), b = await r.blob(); await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
        typeof showToast === 'function' && showToast('success', '已复制');
    }
    window.lyricCard = { open, close, setLayout, setColorTheme, setLyricLines, setFontSize, setLineSpacing, setFontFamily, toggleOption, download, copyToClipboard, scheduleRender };
})();
