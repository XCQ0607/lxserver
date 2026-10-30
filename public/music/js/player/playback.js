// Keep the player's existing media controls/events independent of the output route.
(() => {
    const element = document.getElementById('audio-player');
    if (!element) return;
    const events = new EventTarget();
    let remote = null;
    let localVolumeState = null;
    const emit = type => events.dispatchEvent(new Event(type));
    for (const type of ['play', 'playing', 'pause', 'ended', 'error', 'timeupdate', 'loadedmetadata',
        'durationchange', 'canplay', 'seeked', 'seeking', 'waiting', 'stalled', 'ratechange', 'volumechange']) {
        element.addEventListener(type, () => { if (!remote) emit(type); });
    }
    const properties = new Set(['src', 'currentSrc', 'currentTime', 'duration', 'paused', 'ended',
        'volume', 'muted', 'playbackRate', 'error', 'readyState']);
    window.LXPlayback = new Proxy(element, {
        get(target, key) {
            if (key === 'isRemote') return !!remote;
            if (key === 'emit') return emit;
            if (key === 'addEventListener' || key === 'removeEventListener') return events[key].bind(events);
            if (key === 'connectRemote') return output => {
                const snapshot = { src: element.currentSrc || element.src, currentTime: element.currentTime,
                    paused: element.paused, volume: element.volume, muted: element.muted, playbackRate: element.playbackRate };
                if (!remote) localVolumeState = { volume: element.volume, muted: element.muted };
                remote = output;
                element.pause(); // Suppressed locally; the receiver will supply playback events.
                return snapshot;
            };
            if (key === 'restoreLocal') return () => {
                if (!remote) return;
                const output = remote;
                const position = output.currentTime;
                const resume = !(output.loaded === false ? output.desiredPaused : output.paused) && !output.ended;
                remote = null;
                if (output.src && element.src !== output.src) element.src = window.authorizeMediaUrl?.(output.src) || output.src;
                if (localVolumeState) {
                    element.volume = localVolumeState.volume;
                    element.muted = localVolumeState.muted;
                    localVolumeState = null;
                }
                const seek = () => { if (Number.isFinite(position)) element.currentTime = Math.max(0, position); };
                if (element.readyState >= 1) seek();
                else element.addEventListener('loadedmetadata', seek, { once: true });
                emit('volumechange');
                if (resume && output.src) element.play().catch(() => emit('pause'));
                else emit('pause');
            };
            if (remote && (properties.has(key) || key === 'play' || key === 'pause')) {
                const value = remote[key];
                return typeof value === 'function' ? value.bind(remote) : value;
            }
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
        set(target, key, value) {
            if (remote && properties.has(key)) remote[key] = value;
            else Reflect.set(target, key, value, target);
            return true;
        }
    });
})();
