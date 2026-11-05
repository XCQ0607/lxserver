/**
 * 动态背景引擎（登录页 / 播放页共用）
 * 包含通用动效渲染、自动初始化登录页组件、播放页调用接口
 */
(() => {
    'use strict';

    const EFFECTS = [
        ['none', '无'],
        ['aurora', '极光流光'],
        ['cosmos', '宇宙星海'],
        ['icons', 'SVG 音乐漫游'],
        ['notes', '音符升腾'],
        ['bubbles', '梦幻泡泡'],
        ['waves', '流动波纹'],
        ['fireflies', '萤火虫'],
        ['meteors', '流星雨'],
        ['snow', '冬日飘雪'],
        ['sakura', '樱花飘落'],
        ['constellation', '粒子星座']
    ].map(([value, label]) => ({ value, label }));

    const VALID = new Set(EFFECTS.map(e => e.value));
    const CANVAS_MODES = new Set(['aurora', 'cosmos', 'fireflies', 'meteors', 'snow', 'sakura', 'constellation']);
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const rand = (a, b) => a + Math.random() * (b - a);

    // 仅使用固定的本地 SVG 路径，不插入任何用户提供的内容
    const PATHS = [
        '<path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
        '<path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/>',
        '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M5 10a7 7 0 0 1 5-5m4 14a7 7 0 0 0 5-5"/>',
        '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11v1a6 6 0 0 0 12 0v-1m-6 7v4m-4 0h8"/>',
        '<path d="M3 12h2l2-7 3 14 4-15 3 13 2-5h2"/>'
    ];
    const NOTE_PATHS = [
        '<path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
        '<path d="M12 17V4l6 2"/><ellipse cx="9" cy="17" rx="3" ry="2.2"/>'
    ];

    function fillOptions(select) {
        if (!select) return;
        const current = select.value;
        select.replaceChildren(...EFFECTS.map(e => new Option(e.label, e.value)));
        if (VALID.has(current)) select.value = current;
    }

    function create(host, options = {}) {
        const isLight = options.isLight || (() => {
            const root = document.documentElement;
            if (root.classList.contains('theme-light')) return true;
            const appearance = root.getAttribute('data-appearance');
            if (appearance === 'light') return true;
            if (appearance === 'dark') return false;
            return !root.classList.contains('dark');
        });
        const layer = document.createElement('div');
        layer.className = 'dbg-layer';
        const canvas = document.createElement('canvas');
        canvas.className = 'dbg-canvas';
        host.append(layer, canvas);
        const ctx = canvas.getContext('2d');

        let mode = 'none', w = 0, h = 0, frame = 0, last = 0, t = 0, visible = false, light = false;
        let parts = [], stars = [], meteors = [];

        const density = n => Math.max(8, Math.round(n * Math.min(1, Math.max(0.45, (w * h) / (1440 * 900)))));

        function measure() {
            const r = host.getBoundingClientRect();
            visible = r.width > 0 && r.height > 0;
            w = Math.round(r.width) || window.innerWidth;
            h = Math.round(r.height) || window.innerHeight;
            const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        function makeStars(n) {
            return Array.from({ length: n }, () => ({
                x: Math.random() * w, y: Math.random() * h, r: rand(0.5, 2),
                phase: rand(0, 6.28), speed: rand(2, 8)
            }));
        }

        function seed() {
            parts = []; meteors = []; stars = [];
            switch (mode) {
                case 'aurora': stars = makeStars(density(40)); break;
                case 'cosmos': stars = makeStars(density(170)); break;
                case 'meteors': stars = makeStars(density(90)); break;
                case 'fireflies':
                    parts = Array.from({ length: density(45) }, () => ({
                        x: Math.random() * w, y: Math.random() * h, vx: rand(-15, 15), vy: rand(-15, 15),
                        r: rand(1.4, 3), phase: rand(0, 6.28)
                    }));
                    break;
                case 'snow':
                    parts = Array.from({ length: density(140) }, () => ({
                        x: Math.random() * w, y: Math.random() * h, r: rand(0.8, 3.2),
                        speed: rand(18, 55), sway: rand(0.4, 1.4), phase: rand(0, 6.28)
                    }));
                    break;
                case 'sakura':
                    parts = Array.from({ length: density(40) }, () => ({
                        x: Math.random() * w, y: Math.random() * h, size: rand(5, 11),
                        speed: rand(25, 60), rot: rand(0, 6.28), vr: rand(-1.5, 1.5),
                        sway: rand(0.5, 1.5), phase: rand(0, 6.28)
                    }));
                    break;
                case 'constellation':
                    parts = Array.from({ length: density(75) }, () => ({
                        x: Math.random() * w, y: Math.random() * h, vx: rand(-14, 14), vy: rand(-14, 14), r: rand(1, 2.2)
                    }));
                    break;
            }
        }

        function populate() {
            layer.replaceChildren();
            layer.dataset.mode = mode;
            const add = (cls, style = {}, html = '') => {
                const el = document.createElement('div');
                el.className = cls;
                for (const [k, v] of Object.entries(style)) k.startsWith('--') ? el.style.setProperty(k, v) : (el.style[k] = v);
                if (html) el.innerHTML = html;
                layer.append(el);
            };
            if (mode === 'aurora') {
                for (let i = 1; i <= 3; i++) add(`dbg-blob dbg-blob-${i}`);
            } else if (mode === 'waves') {
                for (let i = 0; i < 3; i++) add('dbg-wave');
            } else if (mode === 'icons' || mode === 'bubbles') {
                const count = w < 600 ? 14 : 26;
                for (let i = 0; i < count; i++) {
                    const size = mode === 'bubbles' ? rand(24, 134) : rand(22, 58);
                    add(mode === 'bubbles' ? 'dbg-item dbg-bubble' : 'dbg-item', {
                        left: `${rand(0, 96)}%`, top: `${rand(0, 100)}%`, width: `${size}px`, height: `${size}px`,
                        '--duration': `${rand(14, 32)}s`, '--delay': `${-rand(0, 32)}s`
                    }, mode === 'icons' ? `<svg class="dbg-icon" viewBox="0 0 24 24">${PATHS[i % PATHS.length]}</svg>` : '');
                }
            } else if (mode === 'notes') {
                const count = w < 600 ? 12 : 22;
                for (let i = 0; i < count; i++) {
                    const size = rand(18, 42);
                    add('dbg-note', {
                        left: `${rand(0, 96)}%`, width: `${size}px`, height: `${size}px`,
                        '--duration': `${rand(10, 20)}s`, '--delay': `${-rand(0, 20)}s`, '--sway': `${rand(-40, 40)}px`
                    }, `<svg class="dbg-icon" viewBox="0 0 24 24">${NOTE_PATHS[i % NOTE_PATHS.length]}</svg>`);
                }
            }
        }

        // ---------- Canvas 渲染 ----------
        function drawStars(color, drift) {
            ctx.fillStyle = color;
            for (const s of stars) {
                const y = drift ? ((s.y - t * s.speed) % h + h) % h : s.y;
                ctx.globalAlpha = 0.3 + 0.35 * (Math.sin(t * 0.8 + s.phase) * 0.5 + 0.5);
                ctx.beginPath(); ctx.arc(s.x, y, s.r, 0, Math.PI * 2); ctx.fill();
            }
        }

        function stepMeteors(dt, rate) {
            if (dt > 0 && Math.random() < rate * dt) {
                meteors.push({ x: rand(w * 0.2, w * 1.1), y: rand(-h * 0.2, h * 0.35), len: rand(90, 200), speed: rand(500, 900), life: 0, max: rand(0.8, 1.5) });
            }
            const head = light ? '#334155' : '#ffffff';
            for (const m of meteors) {
                m.life += dt; m.x -= m.speed * 0.7 * dt; m.y += m.speed * 0.7 * dt;
                const fade = 1 - m.life / m.max;
                const tx = m.x + m.len * 0.7, ty = m.y - m.len * 0.7;
                const g = ctx.createLinearGradient(m.x, m.y, tx, ty);
                g.addColorStop(0, head); g.addColorStop(1, 'transparent');
                ctx.globalAlpha = Math.max(0, fade);
                ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
                ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(tx, ty); ctx.stroke();
            }
            meteors = meteors.filter(m => m.life < m.max);
        }

        function render(dt) {
            if (!ctx) return;
            light = isLight();
            ctx.clearRect(0, 0, w, h);
            switch (mode) {
                case 'aurora':
                    drawStars(light ? '#059669' : '#6ee7b7', true);
                    break;
                case 'cosmos': {
                    drawStars(light ? '#475569' : '#e0e7ff', true);
                    const px = w * 0.8, py = h * 0.26;
                    ctx.globalAlpha = 0.35; ctx.strokeStyle = light ? '#64748b' : '#a5b4fc'; ctx.lineWidth = 1;
                    ctx.beginPath(); ctx.ellipse(px, py, 75, 22, -0.45, 0, Math.PI * 2); ctx.stroke();
                    const planet = ctx.createRadialGradient(px - 10, py - 12, 2, px, py, 34);
                    planet.addColorStop(0, light ? '#93c5fd' : '#a5b4fc');
                    planet.addColorStop(1, light ? '#6366f1' : '#312e81');
                    ctx.globalAlpha = 0.85; ctx.fillStyle = planet;
                    ctx.beginPath(); ctx.arc(px, py, 34, 0, Math.PI * 2); ctx.fill();
                    stepMeteors(dt, 0.12);
                    break;
                }
                case 'meteors':
                    drawStars(light ? '#64748b' : '#cbd5e1', false);
                    stepMeteors(dt, 1.1);
                    break;
                case 'fireflies': {
                    const core = light ? '#d97706' : '#fde68a';
                    for (const p of parts) {
                        p.vx = Math.max(-25, Math.min(25, p.vx + rand(-40, 40) * dt));
                        p.vy = Math.max(-25, Math.min(25, p.vy + rand(-40, 40) * dt));
                        p.x = (p.x + p.vx * dt + w) % w; p.y = (p.y + p.vy * dt + h) % h;
                        const a = 0.25 + 0.75 * (Math.sin(t * 1.8 + p.phase) * 0.5 + 0.5);
                        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 7);
                        g.addColorStop(0, core); g.addColorStop(0.25, light ? '#f59e0b66' : '#bef26466'); g.addColorStop(1, 'transparent');
                        ctx.globalAlpha = a; ctx.fillStyle = g;
                        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 7, 0, Math.PI * 2); ctx.fill();
                    }
                    break;
                }
                case 'snow':
                    ctx.fillStyle = light ? '#94a3b8' : '#ffffff';
                    for (const p of parts) {
                        p.y += p.speed * dt; p.x += Math.sin(t * p.sway + p.phase) * 18 * dt;
                        if (p.y > h + 5) { p.y = -5; p.x = Math.random() * w; }
                        if (p.x > w + 5) p.x = -5; else if (p.x < -5) p.x = w + 5;
                        ctx.globalAlpha = 0.45 + p.r / 6;
                        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
                    }
                    break;
                case 'sakura':
                    for (const p of parts) {
                        p.y += p.speed * dt; p.x += (Math.sin(t * p.sway + p.phase) * 30 + 18) * dt; p.rot += p.vr * dt;
                        if (p.y > h + 20 || p.x > w + 20) { p.y = -20; p.x = rand(-w * 0.3, w); }
                        ctx.save();
                        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
                        ctx.scale(Math.cos(t * 1.4 + p.phase) * 0.5 + 0.6, 1);
                        ctx.globalAlpha = 0.75;
                        ctx.fillStyle = light ? '#f472b6' : '#fbcfe8';
                        ctx.beginPath();
                        ctx.moveTo(0, -p.size);
                        ctx.bezierCurveTo(p.size, -p.size * 0.4, p.size * 0.6, p.size * 0.8, 0, p.size);
                        ctx.bezierCurveTo(-p.size * 0.6, p.size * 0.8, -p.size, -p.size * 0.4, 0, -p.size);
                        ctx.fill();
                        ctx.restore();
                    }
                    break;
                case 'constellation': {
                    const color = light ? '15, 118, 110' : '94, 234, 212';
                    const maxD = Math.min(140, Math.max(90, w / 10));
                    for (const p of parts) {
                        p.x += p.vx * dt; p.y += p.vy * dt;
                        if (p.x < 0 || p.x > w) p.vx *= -1;
                        if (p.y < 0 || p.y > h) p.vy *= -1;
                    }
                    ctx.lineWidth = 0.8;
                    for (let i = 0; i < parts.length; i++) {
                        const a = parts[i];
                        for (let j = i + 1; j < parts.length; j++) {
                            const b = parts[j], dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
                            if (d < maxD) {
                                ctx.globalAlpha = (1 - d / maxD) * 0.4;
                                ctx.strokeStyle = `rgb(${color})`;
                                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
                            }
                        }
                    }
                    ctx.globalAlpha = 0.8; ctx.fillStyle = `rgb(${color})`;
                    for (const p of parts) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
                    break;
                }
            }
            ctx.globalAlpha = 1;
        }

        const shouldAnimate = () => CANVAS_MODES.has(mode) && visible && !document.hidden && !reducedMotion.matches;

        function loop(time) {
            frame = 0;
            const dt = last ? Math.min((time - last) / 1000, 0.05) : 0;
            last = time;
            const step = reducedMotion.matches ? 0 : dt;
            t += step;
            render(step);
            if (shouldAnimate()) frame = requestAnimationFrame(loop);
        }

        function sync() {
            cancelAnimationFrame(frame); frame = 0; last = 0;
            light = isLight();
            layer.classList.toggle('dbg-light', light);
            layer.classList.toggle('dbg-paused', document.hidden || !visible);
            canvas.hidden = !CANVAS_MODES.has(mode);
            if (!canvas.hidden && visible) loop(performance.now());
        }

        function setMode(next) {
            mode = VALID.has(next) ? next : 'none';
            host.dataset.effect = mode;
            measure(); seed(); populate(); sync();
        }

        // 容器尺寸变化（包括从 display:none 变为可见）时重新测量并恢复动画
        const resizeObserver = new ResizeObserver(() => {
            const wasVisible = visible, oldW = w, oldH = h;
            measure();
            if ((!wasVisible && visible) || Math.abs(oldW - w) > 40 || Math.abs(oldH - h) > 40) seed();
            sync();
        });
        resizeObserver.observe(host);

        const themeObserver = new MutationObserver(sync);
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
        if (options.watch) themeObserver.observe(options.watch, { attributes: true, attributeFilter: ['data-applied-background'] });

        const onMotionChange = () => { populate(); sync(); };
        document.addEventListener('visibilitychange', sync);
        reducedMotion.addEventListener('change', onMotionChange);

        return {
            setMode,
            get mode() { return mode; },
            refresh: sync,
            destroy() {
                cancelAnimationFrame(frame);
                resizeObserver.disconnect();
                themeObserver.disconnect();
                document.removeEventListener('visibilitychange', sync);
                reducedMotion.removeEventListener('change', onMotionChange);
                layer.remove(); canvas.remove();
            }
        };
    }

    // 暴露全局命名空间
    window.DynamicBackground = { EFFECTS, isValid: v => VALID.has(v), fillOptions, create };

    // ========== 登录页自动初始化逻辑（合并自 login_backgrounds.js） ==========
    if (typeof document !== 'undefined') {
        const initLoginPage = () => {
            const picker = document.getElementById('login-background');
            const scene = document.getElementById('login-scene');
            if (!picker || !scene) return;
            const STORAGE_KEY = 'lx_login_background';
            fillOptions(picker);
            const fx = create(scene);

            const host = picker.closest('.background-picker');
            let syncUI = () => {};
            if (host && !host.querySelector('.cs-trigger')) {
                picker.hidden = true;
                const trigger = document.createElement('button');
                trigger.type = 'button';
                trigger.className = 'cs-trigger';
                const menu = document.createElement('ul');
                menu.className = 'cs-dropdown';
                menu.innerHTML = EFFECTS.map(e =>
                    `<li class="cs-option" data-value="${e.value}"><span>${e.label}</span><i class="fas fa-check"></i></li>`
                ).join('');
                host.append(trigger, menu);

                syncUI = (mode) => {
                    const cur = EFFECTS.find(e => e.value === mode) || EFFECTS[0];
                    trigger.innerHTML = `<span class="cs-trigger-text">${cur.label}</span><i class="fas fa-chevron-down cs-trigger-icon"></i>`;
                    trigger.classList.toggle('highlight', mode !== 'none');
                    menu.querySelectorAll('.cs-option').forEach(li => li.classList.toggle('selected', li.dataset.value === mode));
                };
                trigger.onclick = (e) => { e.stopPropagation(); host.classList.toggle('open'); };
                menu.onclick = (e) => {
                    const li = e.target.closest('.cs-option');
                    if (li) { host.classList.remove('open'); select(li.dataset.value, true); }
                };
                document.addEventListener('click', (e) => { if (!host.contains(e.target)) host.classList.remove('open'); });
            }

            function select(value, save = false) {
                const mode = VALID.has(value) ? value : 'aurora';
                picker.value = mode;
                syncUI(mode);
                // 网格遮罩 / 鼠标光晕仅在极光模式显示 (见 dynamic-backgrounds.css)
                document.documentElement.dataset.loginBackground = mode;
                if (save) {
                    try { localStorage.setItem(STORAGE_KEY, mode); } catch (e) { /* ignore */ }
                }
                fx.setMode(mode);
            }

            picker.addEventListener('change', () => select(picker.value, true));
            let saved = null;
            try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { /* ignore */ }
            select(saved);
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initLoginPage);
        } else {
            initLoginPage();
        }
    }
})();
