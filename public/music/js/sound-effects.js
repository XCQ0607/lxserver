/**
 * Sound Effects Manager for LX Music Web Player
 * Handles EQ, 3D Surround, Pitch Shifting, and Environment Reverb.
 */
window.soundEffects = (function () {
    let audioContext, mediaSource, analyser;
    let eqFilters = [];
    let convolverNode, convolverMainGain, convolverSendGain;
    let pitchShifterNode, pitchFactorParam;
    let pannerNode;
    let pannerInfo = { enable: false, speed: 25, distance: 5, rad: 0, interval: null };

    const freqs = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    const defaultPresets = [
        { name: '流行', values: [6, 5, -3, -2, 5, 4, -4, -3, 6, 4] },
        { name: '舞曲', values: [4, 3, -4, -6, 0, 0, 3, 4, 4, 5] },
        { name: '摇滚', values: [7, 6, 2, 1, -3, -4, 2, 1, 4, 5] },
        { name: '古典', values: [6, 7, 1, 2, -1, 1, -4, -6, -7, -8] },
        { name: '人声', values: [-5, -6, -4, -3, 3, 4, 5, 4, -3, -3] },
        { name: '慢歌', values: [5, 4, 2, 0, -2, 0, 3, 6, 7, 8] },
        { name: '电子乐', values: [6, 5, 0, -5, -4, 0, 6, 8, 8, 7] },
        { name: '重低音', values: [8, 7, 5, 4, 0, 0, 0, 0, 0, 0] },
        { name: '柔和', values: [-5, -5, -4, -4, 3, 2, 4, 4, 0, 0] }
    ];
    let customPresets = [];
    let isAddingPreset = false;
    let activePresetName = ''; // Track which preset was explicitly clicked

    const reverbOptions = [
        { id: 'none', name: '关闭', source: null, main: 1.0, send: 0 },
        { id: 'telephone', name: '电话', source: 'filter-telephone.wav', main: 0.0, send: 3.0 },
        { id: 'church', name: '教堂', source: 's2_r4_bd.wav', main: 1.8, send: 0.9 },
        { id: 'hall', name: '大厅', source: 'bright-hall.wav', main: 0.8, send: 2.4 },
        { id: 'cinema', name: '电影院', source: 'cinema-diningroom.wav', main: 0.6, send: 2.3 },
        { id: 'dining', name: '餐厅', source: 'dining-living-true-stereo.wav', main: 0.6, send: 1.8 },
        { id: 'living', name: '卫生间', source: 'living-bedroom-leveled.wav', main: 1.6, send: 2.1 },
        { id: 'spreader', name: '室内', source: 'spreader50-65ms.wav', main: 1.0, send: 2.5 },
        { id: 'stereo', name: '立体声', source: 'cardiod-35-10-spread.wav', main: 1.8, send: 0.6 },
        { id: 'matrix1', name: '矩阵混响 (1)', source: 'matrix-reverb1.wav', main: 1.5, send: 0.9 },
        { id: 'matrix2', name: '矩阵混响 (2)', source: 'matrix-reverb2.wav', main: 1.3, send: 1.0 },
        { id: 'cardiod', name: '心形扩散', source: 'cardiod-35-10-spread.wav', main: 1.8, send: 0.6 },
        { id: 'magnetic', name: '磁性立体声', source: 'tim-omni-35-10-magnetic.wav', main: 1.0, send: 0.2 },
        { id: 'spring', name: '反馈弹簧', source: 'feedback-spring.wav', main: 1.8, send: 0.8 }
    ];

    let settings = {
        eq: Array(10).fill(0),
        pitch: 1.0,
        panner: { enable: false, speed: 25, distance: 5 },
        reverb: { id: 'none', mainGain: 1.0, sendGain: 0 }
    };

    let dryGainNode, wetGainNode, mixerNode;
    let isGraphBuilt = false;

    function hasActiveEffects() {
        const isEqActive = settings.eq && settings.eq.some(val => val !== 0);
        const isPitchActive = settings.pitch !== 1.0;
        const isReverbActive = settings.reverb && settings.reverb.id && settings.reverb.id !== 'none';
        const isPannerActive = settings.panner && settings.panner.enable;
        return isEqActive || isPitchActive || isReverbActive || isPannerActive;
    }

    function isIOSDevice() {
        if (window.iOSBackgroundAudio && typeof window.iOSBackgroundAudio.isIOS === 'function') {
            return window.iOSBackgroundAudio.isIOS();
        }
        const ua = navigator.userAgent;
        const isIPad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        return /iPhone|iPod/.test(ua) || isIPad;
    }

    function init(force = false) {
        if (audioContext && isGraphBuilt) return;
        loadSettings();
        if (!force && (isIOSDevice() || !hasActiveEffects())) {
            console.log('[SoundEffects] No custom sound effects enabled or iOS device detected. Keeping direct native audio output (zero throttling).');
            return;
        }
        const audio = document.getElementById('audio-player');
        if (!audio) return;

        console.log('[SoundEffects] Initializing AudioContext and DSP graph...');
        audioContext = window._sharedAudioContext || (window._sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)());

        // 1. Create or Reuse Nodes
        if (!mediaSource) {
            mediaSource = window._sharedAudioSourceNode || (window._sharedAudioSourceNode = audioContext.createMediaElementSource(audio));
        }
        if (!analyser) {
            analyser = window._sharedAudioAnalyser || (window._sharedAudioAnalyser = audioContext.createAnalyser());
            analyser.fftSize = 512;
            analyser.smoothingTimeConstant = 0.8;
        }

        // Disconnect any bypass link (e.g. created previously by visualizer)
        try { mediaSource.disconnect(); } catch (_) { }
        try { analyser.disconnect(); } catch (_) { }

        // EQ Filters
        eqFilters = freqs.map(freq => {
            const filter = audioContext.createBiquadFilter();
            filter.type = 'peaking';
            filter.frequency.value = freq;
            filter.Q.value = 1.4;
            filter.gain.value = 0;
            return filter;
        });

        // Reverb
        convolverNode = audioContext.createConvolver();
        dryGainNode = audioContext.createGain();
        wetGainNode = audioContext.createGain();
        mixerNode = audioContext.createGain();

        // Panner
        pannerNode = audioContext.createPanner();
        // pannerNode.panningModel = 'HRTF';


        // 2. Connect Link: Source -> EQ -> Split(Dry/Wet)
        mediaSource.connect(eqFilters[0]);
        for (let i = 0; i < eqFilters.length - 1; i++) {
            eqFilters[i].connect(eqFilters[i + 1]);
        }

        const lastEq = eqFilters[eqFilters.length - 1];

        // Dry Path
        lastEq.connect(dryGainNode);
        dryGainNode.connect(mixerNode);

        // Wet Path (Reverb)
        lastEq.connect(convolverNode);
        convolverNode.connect(wetGainNode);
        wetGainNode.connect(mixerNode);

        // Mixer -> [Pitch inserted later] -> Panner -> Analyser -> Destination
        mixerNode.connect(pannerNode);
        pannerNode.connect(analyser);
        analyser.connect(audioContext.destination);

        // Store gains for control
        window._soundEffectsGains = { dry: dryGainNode, wet: wetGainNode };

        // iOS: 在 analyser 之后接入后台保活流桥（仅 iOS 设备生效）
        if (window.iOSBackgroundAudio) {
            window.iOSBackgroundAudio.init(audioContext, analyser);
        }

        isGraphBuilt = true;

        if (audioContext.state === 'suspended') {
            audioContext.resume().catch(() => {});
        }

        // 3. Load Settings
        loadSettings();
        applySettings();
        renderUI();
        initPitchShifter();
    }

    let pitchShifterInitPromise = null;

    async function initPitchShifter() {
        if (!audioContext) return null;
        if (pitchShifterNode) return pitchShifterNode;
        if (pitchShifterInitPromise) return pitchShifterInitPromise;

        pitchShifterInitPromise = (async () => {
            try {
                console.log('[SoundEffects] Loading Pitch Shifter Module from /music/js/pitch-shifter/phase-vocoder.js');
                await audioContext.audioWorklet.addModule('/music/js/pitch-shifter/phase-vocoder.js');

                if (!pitchShifterNode) {
                    pitchShifterNode = new AudioWorkletNode(audioContext, 'phase-vocoder-processor', {
                        numberOfInputs: 1,
                        numberOfOutputs: 1,
                        outputChannelCount: [2],
                        processorOptions: { blockSize: 2048 }
                    });
                    pitchFactorParam = pitchShifterNode.parameters.get('pitchFactor');

                    console.log('[SoundEffects] Pitch Shifter Node created successfully');

                    // Apply the pitch param since node was just created
                    applyPitch();

                    // If settings already have a pitch, apply it and connect if needed
                    if (settings.pitch !== 1.0) {
                        connectPitchShifter();
                    }
                }
                return pitchShifterNode;
            } catch (e) {
                console.error('[SoundEffects] Failed to initialize pitch shifter:', e);
                pitchShifterInitPromise = null;
                return null;
            }
        })();

        return pitchShifterInitPromise;
    }

    function connectPitchShifter() {
        if (pitchShifterNode) {
            // Already loaded, just connect
            try { mixerNode.disconnect(pannerNode); } catch (e) { }
            try { mixerNode.disconnect(pitchShifterNode); } catch (e) { }
            try { pitchShifterNode.disconnect(pannerNode); } catch (e) { }
            mixerNode.connect(pitchShifterNode);
            pitchShifterNode.connect(pannerNode);
        } else {
            initPitchShifter().then(node => {
                if (node && settings.pitch !== 1.0) {
                    try { mixerNode.disconnect(pannerNode); } catch (e) { }
                    try { mixerNode.disconnect(node); } catch (e) { }
                    try { node.disconnect(pannerNode); } catch (e) { }
                    mixerNode.connect(node);
                    node.connect(pannerNode);
                }
            });
        }
    }

    function disconnectPitchShifter() {
        if (pitchShifterNode) {
            try { mixerNode.disconnect(pitchShifterNode); } catch (e) { }
            try { pitchShifterNode.disconnect(pannerNode); } catch (e) { }
            try { mixerNode.disconnect(pannerNode); } catch (e) { }
            mixerNode.connect(pannerNode);
        }
    }

    function loadSettings() {
        const saved = localStorage.getItem('lx_sound_effects');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                settings = { ...settings, ...data.settings };
                customPresets = data.customPresets || [];
            } catch (e) { }
        }
    }

    function saveSettings() {
        const payload = {
            settings: settings,
            customPresets: customPresets
        };
        localStorage.setItem('lx_sound_effects', JSON.stringify(payload));

        if (window.settings && window.settings.saveAccountSettingsToFile) {
            pushToServer(payload);
        }
    }

    async function pushToServer(payload) {
        if (localStorage.getItem('lx_sync_mode') !== 'local') return;
        const user = localStorage.getItem('lx_sync_user');
        const pass = localStorage.getItem('lx_sync_pass');
        if (!user || !pass) return;

        try {
            await fetch('/api/user/sound-effects', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...getUserAuthHeaders()
                },
                body: JSON.stringify(payload)
            });
        } catch (e) {
            console.error('[SoundEffects] Failed to sync settings to server:', e);
        }
    }

    async function fetchFromServer() {
        if (!window.settings || !window.settings.saveAccountSettingsToFile) return;
        if (localStorage.getItem('lx_sync_mode') !== 'local') return;

        const user = localStorage.getItem('lx_sync_user');
        const pass = localStorage.getItem('lx_sync_pass');
        if (!user || !pass) return;

        try {
            const res = await fetch('/api/user/sound-effects', {
                headers: getUserAuthHeaders()
            });
            if (res.ok) {
                const data = await res.json();
                settings = { ...settings, ...data.settings };
                customPresets = data.customPresets || [];
                // Save to local
                localStorage.setItem('lx_sound_effects', JSON.stringify({
                    settings: settings,
                    customPresets: customPresets
                }));
                // Apply immediately
                applySettings();
                renderUI();
            }
        } catch (e) {
            console.error('[SoundEffects] Failed to read settings from server:', e);
            // Fallback to local
            loadSettings();
        }
    }

    function applySettings() {
        // EQ - check if initialized
        if (eqFilters && eqFilters.length > 0) {
            eqFilters.forEach((f, i) => {
                if (f && f.gain) f.gain.value = settings.eq[i];
            });
        }
        // Reverb
        updateReverb();
        // Panner
        updatePanner();
        // Pitch
        applyPitch();
    }

    function updateReverb() {
        if (!convolverNode || !audioContext) return;
        const rev = reverbOptions.find(r => r.id === settings.reverb.id);

        if (!rev || rev.id === 'none') {
            convolverNode.buffer = null;
            // When none, force dry to 1 and wet to 0
            if (dryGainNode) dryGainNode.gain.value = 1.0;
            if (wetGainNode) wetGainNode.gain.value = 0;
        } else {
            fetch(`/music/assets/medias/filters/${rev.source}`)
                .then(r => r.arrayBuffer())
                .then(data => audioContext.decodeAudioData(data))
                .then(buffer => {
                    if (!convolverNode) return;
                    convolverNode.buffer = buffer;
                    if (dryGainNode) dryGainNode.gain.value = settings.reverb.mainGain;
                    if (wetGainNode) wetGainNode.gain.value = settings.reverb.sendGain;
                });
        }
    }

    function updatePanner() {
        if (!pannerNode) return;
        const p = settings.panner;

        if (pannerInfo.interval) {
            clearInterval(pannerInfo.interval);
            pannerInfo.interval = null;
            pannerInfo.rad = 0;
        }

        if (p.enable) {
            console.log('[SoundEffects] Starting Panner (Desktop Logic)');
            pannerInfo.interval = setInterval(() => {
                if (!pannerNode) return;
                pannerInfo.rad += 1;
                if (pannerInfo.rad > 360) pannerInfo.rad -= 360;

                const rad = pannerInfo.rad * Math.PI / 180;
                const nx = Math.sin(rad);
                const ny = Math.cos(rad);
                const nz = Math.cos(rad);

                const factor = p.distance * 0.1; // Adjust distance factor to match desktop feel
                pannerNode.positionX.value = nx * factor;
                pannerNode.positionY.value = ny * factor;
                pannerNode.positionZ.value = nz * factor;
            }, p.speed * 10);
        } else {
            pannerNode.positionX.value = 0;
            pannerNode.positionY.value = 0;
            pannerNode.positionZ.value = 0;
        }
    }

    function animateSlider(id, targetValue, duration = 300) {
        const slider = document.getElementById(id);
        if (!slider) return;
        const startValue = parseFloat(slider.value);
        const startTime = performance.now();

        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const ease = 1 - Math.pow(1 - progress, 3); // easeOutCubic
            const currentValue = startValue + (targetValue - startValue) * ease;
            slider.value = currentValue;

            // Trigger the oninput handler to update labels and logic
            if (slider.oninput) slider.oninput({ target: slider });

            if (progress < 1) {
                requestAnimationFrame(update);
            }
        }
        requestAnimationFrame(update);
    }

    function applyPitch() {
        if (pitchFactorParam) {
            // Use setTargetAtTime for immediate and smooth Web Audio update
            pitchFactorParam.setTargetAtTime(settings.pitch, audioContext.currentTime, 0.05);
        }
        const label = document.getElementById('pitch-val');
        if (label) label.innerText = settings.pitch.toFixed(2) + 'x';
    }

    function renderUI() {
        // EQ Presets
        const presetContainer = document.getElementById('eq-presets');
        if (presetContainer) {
            // Render default presets
            let html = defaultPresets.map(p => {
                const isActive = activePresetName === p.name || (activePresetName === '' && settings.eq.join(',') === p.values.join(','));
                return `
                <button class="px-3 py-1.5 text-[11px] font-bold rounded-lg border t-border-main transition-all ${isActive ? 'bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-500/20' : 't-bg-main t-text-muted hover:t-bg-item-hover'}"
                    onclick="window.soundEffects.applyPreset('${p.name}')">${p.name}</button>
            `;
            }).join('');

            // Render custom presets with edit/delete icons
            html += customPresets.map(p => {
                const isActive = activePresetName === p.name;
                return `
                <div class="relative group">
                    <button class="px-3 py-1.5 pr-10 text-[11px] font-bold rounded-lg border t-border-main transition-all ${isActive ? 'bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-500/20' : 't-bg-main t-text-muted hover:t-bg-item-hover'}"
                        onclick="window.soundEffects.applyPreset('${p.name}')">${p.name}</button>
                    <div class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center transition-opacity">
                        <button class="w-4 h-4 flex items-center justify-center text-[10px] text-gray-400 hover:text-emerald-500" 
                            onclick="event.stopPropagation(); window.soundEffects.renameCustomPreset('${p.name}')" title="重命名">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="w-4 h-4 flex items-center justify-center text-[10px] text-gray-400 hover:text-red-500" 
                            onclick="event.stopPropagation(); window.soundEffects.deleteCustomPreset('${p.name}')" title="删除">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                </div>
            `;
            }).join('');

            if (isAddingPreset) {
                html += `
                    <div class="relative flex items-center">
                        <input type="text" id="new-preset-name" placeholder="输入名称..." 
                            class="w-24 px-2 py-1 text-[11px] rounded-lg border border-emerald-500 t-bg-main t-text-main focus:outline-none shadow-sm"
                            onkeydown="if(event.key==='Enter') window.soundEffects.saveNewPreset(this.value); if(event.key==='Escape') window.soundEffects.cancelAddPreset();"
                            onblur="window.soundEffects.saveNewPreset(this.value)">
                        <script>setTimeout(() => document.getElementById('new-preset-name')?.focus(), 50);</script>
                    </div>
                `;
            } else {
                html += `<button class="p-1 px-3 text-xs rounded-lg border border-dashed t-border-main hover:text-emerald-500 transition-colors" 
                    onclick="window.soundEffects.startAddPreset()" title="在此添加自定义预设">+</button>`;
            }
            presetContainer.innerHTML = html;
        }

        // Reverb List (Multi-column list like reference)
        const reverbList = document.getElementById('reverb-list');
        if (reverbList) {
            reverbList.innerHTML = reverbOptions.map(r => `
                <label class="flex items-center gap-2 cursor-pointer group text-[12px] font-bold t-text-muted hover:t-text-main min-w-[75px]">
                    <div class="relative w-4 h-4 border t-border-dim rounded flex items-center justify-center transition-colors ${settings.reverb.id === r.id ? 'bg-emerald-500 border-emerald-500' : 'bg-white'}">
                         <input type="radio" name="reverb-opt" value="${r.id}" ${settings.reverb.id === r.id ? 'checked' : ''} 
                            class="absolute inset-0 opacity-0 cursor-pointer" onchange="window.soundEffects.setReverb('${r.id}')">
                         ${settings.reverb.id === r.id ? '<i class="fas fa-check text-[9px] text-white"></i>' : ''}
                    </div>
                    <span>${r.name}</span>
                </label>
            `).join('');
        }

        // EQ Sliders (Horizontal 2-column grid)
        const eqContainer = document.getElementById('eq-sliders-container');
        if (eqContainer) {
            let html = '<div class="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6 w-full px-2">';
            freqs.forEach((f, i) => {
                const label = f >= 1000 ? (f / 1000) + 'k' : f;
                html += `
                <div class="flex items-center gap-4 w-full">
                    <span class="w-8 text-[12px] font-bold t-text-muted text-right">${label}</span>
                    <input type="range" min="-12" max="12" step="1" value="${settings.eq[i]}" 
                        class="flex-1 h-1.5 rounded-full lc-range-input cursor-pointer"
                        oninput="window.soundEffects.setEQ(${i}, this.value)">
                    <span class="w-10 text-[12px] font-mono font-bold text-emerald-600 text-left">${settings.eq[i]}db</span>
                </div>
                `;
            });
            html += '</div>';
            eqContainer.innerHTML = html;
        }

        // Update Slider States
        const isReverbDisabled = settings.reverb.id === 'none';
        const mainGainInput = document.getElementById('reverb-main-gain');
        if (mainGainInput) {
            mainGainInput.value = settings.reverb.mainGain * 100;
            mainGainInput.disabled = isReverbDisabled;
            mainGainInput.style.opacity = isReverbDisabled ? '0.5' : '1';
            mainGainInput.style.cursor = isReverbDisabled ? 'not-allowed' : 'pointer';
            document.getElementById('reverb-main-gain-val').innerText = Math.round(settings.reverb.mainGain * 100) + '%';
        }

        const sendGainInput = document.getElementById('reverb-send-gain');
        if (sendGainInput) {
            sendGainInput.value = settings.reverb.sendGain * 100;
            sendGainInput.disabled = isReverbDisabled;
            sendGainInput.style.opacity = isReverbDisabled ? '0.5' : '1';
            sendGainInput.style.cursor = isReverbDisabled ? 'not-allowed' : 'pointer';
            document.getElementById('reverb-send-gain-val').innerText = Math.round(settings.reverb.sendGain * 100) + '%';
        }

        const pitchInput = document.getElementById('pitch-slider');
        if (pitchInput) {
            pitchInput.value = settings.pitch;
            document.getElementById('pitch-val').innerText = settings.pitch.toFixed(2) + 'x';
        }

        const pannerEnableInput = document.getElementById('panner-enable');
        if (pannerEnableInput) {
            pannerEnableInput.checked = settings.panner.enable;
        }

        const pannerSpeedInput = document.getElementById('panner-speed');
        if (pannerSpeedInput) {
            pannerSpeedInput.value = settings.panner.speed;
            document.getElementById('panner-speed-val').innerText = settings.panner.speed;
        }

        const pannerDistanceInput = document.getElementById('panner-distance');
        if (pannerDistanceInput) {
            pannerDistanceInput.value = settings.panner.distance;
            document.getElementById('panner-distance-val').innerText = settings.panner.distance;
        }
    }

    const manager = {
        init,
        toggle: function () {
            const modal = document.getElementById('sound-effects-modal');
            if (modal.classList.contains('hidden')) {
                this.open();
            } else {
                this.close();
            }
        },
        open: function () {
            // 打开面板时只加载并显示设置，不在此强制初始化 Web Audio 图
            loadSettings();
            if (isIOSDevice() && window.showInfo) {
                window.showInfo('提示：iOS 系统限制，开启自定义音效将导致退至后台或锁屏时暂停播放。如需后台播放请保持音效关闭。', 5000);
            }
            const modal = document.getElementById('sound-effects-modal');
            if (!modal) return;
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            // Background animation
            setTimeout(() => {
                const content = document.getElementById('sound-effects-content');
                if (content) {
                    content.classList.remove('translate-y-10', 'opacity-0');
                }
            }, 10);
            renderUI();
        },
        close: function () {
            const modal = document.getElementById('sound-effects-modal');
            const content = document.getElementById('sound-effects-content');
            if (content) { // Check if content exists
                content.classList.add('translate-y-10', 'opacity-0');
            }
            setTimeout(() => {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }, 300);
        },
        setEQ: function (index, val) {
            if (!audioContext || !isGraphBuilt) init(true);
            val = parseInt(val);
            settings.eq[index] = val;
            if (eqFilters[index]) eqFilters[index].gain.setTargetAtTime(val, audioContext.currentTime, 0.1);
            activePresetName = ''; // Reset when manually adjusted
            saveSettings();
            renderUI();
        },
        applyPreset: function (name) {
            if (!audioContext || !isGraphBuilt) init(true);
            const allPresets = [...defaultPresets, ...customPresets];
            const p = allPresets.find(p => p.name === name);
            if (p) {
                settings.eq = [...p.values];
                activePresetName = name; // Set active preset by name
                settings.eq.forEach((v, i) => {
                    // Smoothly transition EQ gains
                    if (eqFilters[i]) eqFilters[i].gain.setTargetAtTime(v, audioContext.currentTime, 0.1);
                });
                saveSettings();
                renderUI();
                if (window.showSuccess) window.showSuccess(`应用预设: ${name}`);
            }
        },
        resetEQ: function () {
            settings.eq = Array(10).fill(0);
            activePresetName = '';
            if (eqFilters.length && audioContext) {
                eqFilters.forEach(f => f.gain.setTargetAtTime(0, audioContext.currentTime, 0.1));
            }
            saveSettings();
            renderUI();
        },
        setReverb: function (id) {
            if (!audioContext || !isGraphBuilt) init(true);
            settings.reverb.id = id;
            const rev = reverbOptions.find(r => r.id === id);
            if (rev) {
                settings.reverb.mainGain = rev.main;
                settings.reverb.sendGain = rev.send;

                // Animate the DRY/WET sliders visually
                animateSlider('reverb-main-gain', rev.main * 100);
                animateSlider('reverb-send-gain', rev.send * 100);
            }
            updateReverb();
            saveSettings();
            renderUI(); // Update radio selection state
        },
        setPitch: function (val) {
            if (!audioContext || !isGraphBuilt) init(true);
            const oldPitch = settings.pitch;
            settings.pitch = parseFloat(val);

            if (settings.pitch !== 1.0 && oldPitch === 1.0) {
                connectPitchShifter();
            } else if (settings.pitch === 1.0 && oldPitch !== 1.0) {
                disconnectPitchShifter();
            }

            applyPitch();
            saveSettings();

            // Immediate UI update for smooth dragging
            const label = document.getElementById('pitch-val');
            if (label) label.innerText = settings.pitch.toFixed(2) + 'x';
            const slider = document.getElementById('pitch-slider');
            if (slider) slider.value = settings.pitch;
        },
        resetPitch: function () {
            this.setPitch(1.0);
        },
        setPanner: function (key, val) {
            if (!audioContext || !isGraphBuilt) init(true);
            if (key === 'enable') settings.panner.enable = val;
            else settings.panner[key] = parseInt(val);
            updatePanner();
            saveSettings();
            renderUI();
        },
        getContext: () => audioContext || window._sharedAudioContext || null,
        getSourceNode: () => mediaSource || window._sharedAudioSourceNode || null,
        getAnalyser: () => analyser || window._sharedAudioAnalyser || null,
        setReverbGain: function (type, val) {
            if (!audioContext || !isGraphBuilt) init(true);
            if (type === 'main') settings.reverb.mainGain = val;
            else settings.reverb.sendGain = val;
            saveSettings();

            if (window._soundEffectsGains && audioContext) {
                if (type === 'main') window._soundEffectsGains.dry.gain.setTargetAtTime(val, audioContext.currentTime, 0.1);
                else window._soundEffectsGains.wet.gain.setTargetAtTime(val, audioContext.currentTime, 0.1);
            }

            const label = document.getElementById(`reverb-${type}-gain-val`);
            if (label) label.innerText = Math.round(val * 100) + '%';
        },
        startAddPreset: function () {
            isAddingPreset = true;
            renderUI();
        },
        cancelAddPreset: function () {
            isAddingPreset = false;
            renderUI();
        },
        saveNewPreset: function (name) {
            if (!isAddingPreset) return;
            if (name && name.trim()) {
                const newName = name.trim();
                // Check for duplicates
                if ([...defaultPresets, ...customPresets].some(p => p.name === newName)) {
                    if (window.showError) window.showError('预设名称已存在');
                    isAddingPreset = false;
                    renderUI();
                    return;
                }
                const newPreset = {
                    name: newName,
                    values: [...settings.eq]
                };
                customPresets.push(newPreset);
                activePresetName = newName; // Mark new one as active
                saveSettings();
                if (window.showSuccess) window.showSuccess(`已添加预设: ${newName}`);
            }
            isAddingPreset = false;
            renderUI();
        },
        renameCustomPreset: async function (oldName) {
            const preset = customPresets.find(p => p.name === oldName);
            if (!preset) return;

            const newName = await window.showInput('重命名预设', `请输入预设 "${oldName}" 的新名称`, {
                defaultValue: oldName,
                placeholder: '新名称...'
            });

            if (newName && newName.trim() && newName.trim() !== oldName) {
                const name = newName.trim();
                if ([...defaultPresets, ...customPresets].some(p => p.name === name)) {
                    if (window.showError) window.showError('名称已存在');
                    return;
                }
                if (activePresetName === oldName) activePresetName = name;
                preset.name = name;
                saveSettings();
                renderUI();
                if (window.showSuccess) window.showSuccess(`已重命名为: ${name}`);
            }
        },
        deleteCustomPreset: async function (name) {
            const confirmed = await window.showSelect('删除预设', `确认要删除预设 "${name}" 吗？`, {
                danger: true,
                confirmText: '立刻删除'
            });
            if (confirmed) {
                if (activePresetName === name) activePresetName = '';
                customPresets = customPresets.filter(p => p.name !== name);
                saveSettings();
                renderUI();
                if (window.showSuccess) window.showSuccess(`已删除预设: ${name}`);
            }
        },
        fetchFromServer: fetchFromServer,
        pushToServer: () => {
            pushToServer({ settings: settings, customPresets: customPresets });
        }
    };

    // Attach event listeners to sound effects UI elements
    function attachListeners() {
        console.log('[SoundEffects] Attaching event listeners...');
        // Reverb Gain Sliders
        const mainGain = document.getElementById('reverb-main-gain');
        if (mainGain) mainGain.oninput = (e) => {
            const val = e.target.value / 100;
            manager.setReverbGain('main', val);
        };

        const sendGain = document.getElementById('reverb-send-gain');
        if (sendGain) sendGain.oninput = (e) => {
            const val = e.target.value / 100;
            manager.setReverbGain('send', val);
        };

        // Tone Pitch Slider
        const pitchSlider = document.getElementById('pitch-slider');
        if (pitchSlider) {
            pitchSlider.oninput = (e) => manager.setPitch(e.target.value);
            console.log('[SoundEffects] Pitch slider listener attached');
        }

        // Panner Controls
        const pannerEnable = document.getElementById('panner-enable');
        if (pannerEnable) pannerEnable.onchange = (e) => manager.setPanner('enable', e.target.checked);

        const pannerSpeed = document.getElementById('panner-speed');
        if (pannerSpeed) pannerSpeed.oninput = (e) => manager.setPanner('speed', e.target.value);

        const pannerDist = document.getElementById('panner-distance');
        if (pannerDist) pannerDist.oninput = (e) => manager.setPanner('distance', e.target.value);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attachListeners);
    } else {
        attachListeners();
    }

    return manager;
})();
