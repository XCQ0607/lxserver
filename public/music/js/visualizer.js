/**
 * Music Visualizer Integration using Wave.js
 * Manages independent footer and detail view canvases and syncs with theme color.
 */

const musicVisualizer = (function () {
    let audioContext, audioSource, audioAnalyser;
    let waveFooter, waveDetail;
    let isInitialized = false;

    const audio = document.getElementById('audio-player');
    const footerCanvas = document.getElementById('footer-visualizer');
    const detailCanvas = document.getElementById('detail-visualizer');
    const playerFooter = document.getElementById('player-footer');

    function isIOSDevice() {
        if (window.iOSBackgroundAudio && typeof window.iOSBackgroundAudio.isIOS === 'function') {
            return window.iOSBackgroundAudio.isIOS();
        }
        const ua = navigator.userAgent;
        const isIPad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        return /iPhone|iPod/.test(ua) || isIPad;
    }

    /**
     * Initialize AudioContext and AnalyserNode.
     */
    function init() {
        if (isInitialized || !window.Wave || !audio) return;

        // If visualizer is disabled in settings, do NOT hijack the native audio output!
        const isFooterOn = window.settings ? window.settings.showFooterVisualizer !== false : true;
        const isDetailOn = window.settings ? window.settings.showDetailVisualizer : false;
        const isAnyVisualizerWanted = isFooterOn || isDetailOn;

        const hasEffectsAnalyser = window.soundEffects && window.soundEffects.getAnalyser && window.soundEffects.getAnalyser();

        if (!isAnyVisualizerWanted && !hasEffectsAnalyser) {
            console.log('[Visualizer] Visualizer disabled. Skipping AudioContext creation to preserve native playback.');
            return;
        }

        // [iOS Fix] On iOS (Safari/WebKit), creating Web Audio createMediaElementSource silences native audio output.
        // WebKit automatically suspends all AudioContexts when Safari is minimized or locked, killing background playback.
        // To preserve native background and lock-screen playback on iOS, skip Web Audio hijacking when no external DSP is active.
        if (isIOSDevice() && !hasEffectsAnalyser) {
            console.log('[Visualizer] iOS device detected. Skipping AudioContext capture to preserve native background playback.');
            return;
        }

        try {
            console.log('[Visualizer] Initializing AudioContext & Visualizer graph...');
            audioContext = window._sharedAudioContext || (window.soundEffects && window.soundEffects.getContext && window.soundEffects.getContext()) || (window._sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)());

            if (hasEffectsAnalyser) {
                audioAnalyser = window.soundEffects.getAnalyser();
                audioSource = window.soundEffects.getSourceNode ? window.soundEffects.getSourceNode() : window._sharedAudioSourceNode;
                console.log('[Visualizer] Using analyser from SoundEffectsManager');
            } else {
                audioSource = window._sharedAudioSourceNode || (window._sharedAudioSourceNode = audioContext.createMediaElementSource(audio));
                audioAnalyser = window._sharedAudioAnalyser || (window._sharedAudioAnalyser = audioContext.createAnalyser());
                
                try { audioSource.disconnect(); } catch (_) { }
                try { audioAnalyser.disconnect(); } catch (_) { }
                audioSource.connect(audioAnalyser);
                audioAnalyser.connect(audioContext.destination);
            }

            audioAnalyser.smoothingTimeConstant = 0.8;
            audioAnalyser.fftSize = 512;

            if (audioContext.state === 'suspended') {
                audioContext.resume().catch(() => {});
            }

            waveFooter = new Wave(audioAnalyser, footerCanvas);
            waveDetail = new Wave(audioAnalyser, detailCanvas);

            isInitialized = true;
            console.log('[Visualizer] Initialized successfully');

            syncSize();
            applySettings();
        } catch (e) {
            console.error('[Visualizer] Initialization failed:', e);
        }
    }

    /**
     * Sync canvas resolutions.
     */
    function syncSize() {
        [footerCanvas, detailCanvas].forEach(canvas => {
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            if (rect.width === 0) return;
            const dpr = window.devicePixelRatio || 1;
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
        });
    }

    /**
     * Apply independent settings for Footer and Detail.
     */
    function applySettings() {
        if (!isInitialized) return;

        // 每次应用设置前同步一次尺寸，确保全宽对齐
        syncSize();

        const s = window.settings || {};
        const themeColor = getComputedStyle(document.documentElement).getPropertyValue('--c-500').trim() || '#10b981';
        const opacity = s.visualizerOpacity !== undefined ? s.visualizerOpacity : 0.5;
        const globalStyle = s.visualizerGlobalStyle || 'blocks';
        const globalGap = globalStyle === 'blocks' ? 2 : 0;

        // --- Handle Footer Visualizer ---
        waveFooter.clearAnimations();
        const visualizerContainer = document.getElementById('visualizer-container');

        if (s.showFooterVisualizer && footerCanvas && visualizerContainer) {
            const style = s.footerVisualizerStyle || 'bars';
            // 获取容器实际宽度而不是 Canvas 宽度
            const containerRect = visualizerContainer.getBoundingClientRect();
            const containerWidth = containerRect.width;

            let count, gap, lineWidth, cubeHeight;

            if (globalStyle === 'blocks') {
                gap = 1; // 极小间距，更细腻
                lineWidth = 0;
                cubeHeight = 4; // 稍微降低高度，配合宽度
                const targetPitch = 5; // Pitch reduced (Width ~4px)

                // 计算填满宽度所需的数量 (近似值)
                const maxCount = Math.floor(containerWidth / targetPitch);
                count = Math.min(maxCount, 1024);

                // 不再强制设置像素宽度，而是让它填满容器
                //这能兼容各种屏幕尺寸和浏览器缩放，避免“前端对齐”或右侧留白问题
                footerCanvas.style.width = '100%';
                footerCanvas.style.height = '100%';
            } else {
                // 连体样式
                gap = 0;
                lineWidth = 2;
                cubeHeight = undefined;
                const targetPitch = 6;
                const maxCount = Math.floor(containerWidth / targetPitch);
                count = Math.min(maxCount, 1024);

                footerCanvas.style.width = '100%';
                footerCanvas.style.height = '100%';
            }

            // 同步物理分辨率
            syncSize();

            const options = {
                fillColor: themeColor,
                lineColor: themeColor,
                lineWidth: lineWidth,
                count: count,
                rounded: true, // 方块样式下 rounded 对 Cubes 无效或产生圆角，可保留
                bottom: true,
                gap: gap
            };

            if (cubeHeight !== undefined) {
                options.cubeHeight = cubeHeight;
            }

            let AnimationClass = waveFooter.animations.Cubes; // Default
            if (style === 'wave') {
                AnimationClass = waveFooter.animations.Wave;
            }

            waveFooter.addAnimation(new AnimationClass(options));
            footerCanvas.style.opacity = opacity;

            // 调整内容区域高度
            const footerIsHidden = playerFooter && playerFooter.classList.contains('translate-y-[110%]');

            // 增加容器高度和 Footer 高度
            const isShortWindow = window.innerHeight <= 845;
            visualizerContainer.style.height = isShortWindow ? '40px' : '100px';
            visualizerContainer.style.zIndex = '1';
            visualizerContainer.style.display = 'flex'; // 确保可见
            if (playerFooter) {
                playerFooter.style.transition = 'height 0.3s ease';
                if (window.innerWidth >= 768) {
                    // 再次压缩：超矮窗口下，Footer 高度仅设为 90px
                    playerFooter.style.height = isShortWindow ? '90px' : '150px';
                    playerFooter.style.justifyContent = 'center'; // [Fix] 增加高度后内容保持垂直居中
                } else {
                    // 手机端保持自适应高度，避免 flex-center 导致内容溢出屏幕外
                    playerFooter.style.height = '';
                    playerFooter.style.justifyContent = '';
                }
            }

            // [Important] 如果音频正在播放但 Context 挂起了（常见于浏览器策略），立即恢复
            if (audioContext && audioContext.state === 'suspended' && audio && !audio.paused) {
                audioContext.resume();
            }

            // 调整内容区域的间距以防被遮挡
            const mainViews = document.querySelectorAll('#view-search, #view-favorites, #view-settings, #view-about, #view-player-detail, #view-songlist, #songlist-detail-view, #view-leaderboard');
            const isMobile = window.innerWidth < 768;
            let targetPb = footerIsHidden ? '' : (isShortWindow ? '120px' : '180px');

            mainViews.forEach(view => {
                view.style.transition = 'padding-bottom 0.3s ease, padding-top 0.3s ease';
                let pb = targetPb;

                if (view.id === 'view-player-detail') {
                    // [Fix] 详情页特殊处理：使用容器 Margin 而不是视图 Padding，防止背景图层因 Padding 出现视觉断层（黑线）
                    const container = view.querySelector('#player-detail-container');
                    if (container) {
                        const needsTopPadding = !footerIsHidden && window.innerWidth >= 768;
                        container.style.marginTop = needsTopPadding ? '60px' : '';

                        // [Important] 详情页父容器 view-player-detail 已有 pb-24 (96px)，
                        // 此处的 margin-bottom 应扣除这部分，否则会导致歌词区域被过度压缩
                        const extraPb = pb === '' ? '' : Math.max(0, parseInt(pb) - 96) + 'px';
                        container.style.marginBottom = extraPb;
                        container.style.transition = 'margin 0.3s ease';
                    }
                    view.style.paddingBottom = ''; // 确保详情页视图本身没有 Padding
                    view.style.paddingTop = '';
                } else {
                    // 其他列表页继续使用 Padding
                    view.style.paddingBottom = pb;
                }
            });

            // 调整侧边栏底部 Padding
            const sidebar = document.querySelector('aside');
            if (sidebar) {
                sidebar.style.transition = 'padding-bottom 0.3s ease';
                sidebar.style.paddingBottom = targetPb;
            }
        } else if (footerCanvas && visualizerContainer) {
            footerCanvas.style.opacity = '0';
            visualizerContainer.style.height = ''; // 复原 (h-12 / 48px)
            footerCanvas.style.width = '100%'; // 复原宽度
            if (playerFooter) {
                playerFooter.style.height = '';
                playerFooter.style.justifyContent = ''; // 复原
            }
            // 复原 Padding
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
        if (s.showDetailVisualizer && detailCanvas) {
            const style = s.detailVisualizerStyle || 'pulse';
            const options = {
                fillColor: themeColor,
                lineColor: themeColor,
                lineWidth: 1.5,
                count: 60,
                rounded: true,
                diameter: 220,
                gap: globalGap // 为 Pulse 等样式应用全局风格间距
            };

            let AnimationClass = waveDetail.animations.Turntable; // Default for 'pulse'

            if (style === 'dots') {
                AnimationClass = waveDetail.animations.Glob;
                options.diameter = 180;
            } else if (style === 'flower') {
                AnimationClass = waveDetail.animations.Flower;
                options.diameter = 200;
            }

            waveDetail.addAnimation(new AnimationClass(options));
            detailCanvas.style.opacity = opacity;
        } else if (detailCanvas) {
            detailCanvas.style.opacity = '0';
        }
    }

    /**
     * 手动清除可视化内容
     * @param {string} type 'footer' | 'detail'
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
        audio.addEventListener('play', () => {
            if (!isInitialized) {
                init();
            } else if (audioContext && audioContext.state === 'suspended') {
                audioContext.resume();
            }
        });
    }

    window.addEventListener('resize', () => {
        syncSize();
        if (isInitialized) applySettings();
    });

    return { init, applySettings, syncSize, clear };
})();

window.musicVisualizer = musicVisualizer;
