/**
 * iOS Background Audio Keep-Alive Module
 *
 * 解决 iOS Safari 息屏断播问题。
 * 原理：在 Web Audio 图末端（analyser 之后）桥接 MediaStreamDestination，
 * 并将其输出流赋给隐藏 <audio> 元素的 srcObject，使 iOS 将其识别为活跃媒体流，
 * 从而在息屏/后台状态维持音频会话。
 *
 * 仅在 iOS 设备上激活，其他平台为 no-op。
 * 加载顺序：须在 sound-effects.js 之前加载。
 */
window.iOSBackgroundAudio = (function () {

    // 检测是否为真实 iOS 移动设备（严格排除 macOS 桌面系统）
    function isIOS() {
        const ua = navigator.userAgent;
        // 排除桌面操作系统 (Mac/Windows/Linux/Unix)
        const isDesktopMac = /Macintosh/i.test(ua) && !('ontouchend' in document);
        if (isDesktopMac) return false;
        if (/Windows|Linux|X11/i.test(ua)) return false;

        // 真实 iPhone / iPod
        if (/iPhone|iPod/i.test(ua)) return true;

        // 真实 iPad (具有多点触控屏幕事件支持)
        const isIPad = (/iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) && ('ontouchend' in document);
        return isIPad;
    }

    let streamDestination = null;
    let anchorAudio = null;
    let isActive = false;
    let _audioContext = null;
    let outputAnalyser = null;
    let mainAudio = null;
    let wireless = false;
    let positionTimer = null;

    function routeOutput() {
        if (!outputAnalyser || !_audioContext || !streamDestination) return;
        try { outputAnalyser.disconnect(streamDestination); } catch (_) { }
        try { outputAnalyser.disconnect(_audioContext.destination); } catch (_) { }
        outputAnalyser.connect(wireless ? _audioContext.destination : streamDestination);
    }

    function dispose() {
        if (positionTimer) clearTimeout(positionTimer);
        positionTimer = null;
        mainAudio?.removeEventListener('play', onMainPlay);
        mainAudio?.removeEventListener('pause', syncAnchorWithContext);
        _audioContext?.removeEventListener('statechange', onContextStateChange);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        if (outputAnalyser && _audioContext) {
            try { outputAnalyser.disconnect(streamDestination); } catch (_) { }
            try { outputAnalyser.connect(_audioContext.destination); } catch (_) { }
        }
        if (anchorAudio) {
            anchorAudio.pause();
            anchorAudio.srcObject = null;
            anchorAudio.remove();
        }
        streamDestination = anchorAudio = _audioContext = outputAnalyser = mainAudio = null;
        isActive = false;
    }

    function init(audioContext, analyserNode) {
        if (!isIOS() || !audioContext || !analyserNode) return;
        if (isActive && _audioContext === audioContext) {
            if (outputAnalyser !== analyserNode) {
                try { outputAnalyser.disconnect(streamDestination); } catch (_) { }
            }
            outputAnalyser = analyserNode;
            try {
                routeOutput(); // Reconnect after the effects graph disconnects/rebuilds its analyser.
                syncAnchorWithContext();
            } catch (error) {
                dispose();
                console.warn('[iOSAudio] Reconnect failed; restored native output:', error);
            }
            return;
        }
        if (isActive) dispose();
        _audioContext = audioContext;
        outputAnalyser = analyserNode;
        mainAudio = document.getElementById('audio-player');
        wireless = !!mainAudio?.webkitCurrentPlaybackTargetIsWireless;
        try {
            // Build the replacement output before removing the working native connection.
            streamDestination = audioContext.createMediaStreamDestination();
            anchorAudio = document.createElement('audio');
            anchorAudio.id = 'ios-audio-anchor';
            anchorAudio.setAttribute('playsinline', '');
            anchorAudio.setAttribute('webkit-playsinline', '');
            anchorAudio.setAttribute('x-webkit-airplay', 'deny');
            anchorAudio.disableRemotePlayback = true;
            anchorAudio.volume = 1;
            anchorAudio.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0.01;pointer-events:none;';
            anchorAudio.srcObject = streamDestination.stream;
            document.body.appendChild(anchorAudio);
            routeOutput();
            mainAudio?.addEventListener('play', onMainPlay);
            mainAudio?.addEventListener('pause', syncAnchorWithContext);
            audioContext.addEventListener('statechange', onContextStateChange);
            document.addEventListener('visibilitychange', onVisibilityChange);
            isActive = true;
            syncAnchorWithContext();
        } catch (error) {
            dispose();
            console.warn('[iOSAudio] Bridge unavailable; restored native output:', error);
        }
    }

    function onMainPlay() {
        if (!_audioContext) return;
        if (_audioContext.state === 'suspended' || _audioContext.state === 'interrupted') {
            _audioContext.resume().then(syncAnchorWithContext).catch(error => console.warn('[iOSAudio] Resume deferred:', error));
        } else syncAnchorWithContext();
    }

    function onContextStateChange() {
        syncAnchorWithContext();
    }

    function onVisibilityChange() {
        if (document.visibilityState === 'visible' && mainAudio && !mainAudio.paused && !wireless) onMainPlay();
    }

    function syncAnchorWithContext() {
        if (!anchorAudio || !_audioContext) return;
        const shouldPlay = !wireless && _audioContext.state === 'running' && mainAudio && !mainAudio.paused;
        if (shouldPlay && anchorAudio.paused) {
            const currentAnchor = anchorAudio;
            Promise.resolve(currentAnchor.play()).then(() => {
                if (currentAnchor !== anchorAudio) return;
                if (wireless || !mainAudio || mainAudio.paused || _audioContext?.state !== 'running') {
                    currentAnchor.pause();
                    return;
                }
                if (typeof window.updatePositionState === 'function') {
                    window.updatePositionState();
                    if (positionTimer) clearTimeout(positionTimer);
                    positionTimer = setTimeout(() => {
                        if (isActive && !wireless && mainAudio && !mainAudio.paused) window.updatePositionState();
                    }, 500);
                }
            }).catch(error => {
                // Keep the bridge/listeners available for a later gesture retry.
                if (error.name !== 'NotAllowedError') console.warn('[iOSAudio] Play deferred:', error);
            });
        } else if (!shouldPlay && !anchorAudio.paused) anchorAudio.pause();
    }

    return {
        init,
        dispose,
        ensureAnchorPlaying: syncAnchorWithContext,
        setWirelessPlayback(value) {
            wireless = !!value;
            if (isActive) { routeOutput(); syncAnchorWithContext(); }
        },
        isActive: () => isActive,
        isIOS,
    };
})();
