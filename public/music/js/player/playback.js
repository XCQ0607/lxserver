// Keep the player's existing media controls/events independent of the output route.
(() => {
    let element = document.getElementById('audio-player');
    if (!element) return;
    const events = new EventTarget();
    let remote = null;
    let localVolumeState = null;
    const emit = type => events.dispatchEvent(new Event(type));
    const mediaEvents = ['play', 'playing', 'pause', 'ended', 'error', 'timeupdate', 'loadedmetadata',
        'durationchange', 'canplay', 'seeked', 'seeking', 'waiting', 'stalled', 'ratechange', 'volumechange',
        'webkitplaybacktargetavailabilitychanged', 'webkitcurrentplaybacktargetiswirelesschanged'];
    function bindElement(media) {
        for (const type of mediaEvents) media.addEventListener(type, event => {
            if (remote || media !== element) return;
            const forwarded = new Event(type);
            if ('availability' in event) forwarded.availability = event.availability;
            events.dispatchEvent(forwarded);
        });
    }
    bindElement(element);
    let seekVersion = 0;
    let pendingSeek = null;
    function replaceLocalElement(beforeResume) {
        if (remote) return false;
        const previous = element;
        const source = previous.src || previous.currentSrc;
        const position = pendingSeek?.element === previous ? pendingSeek.position : previous.currentTime;
        const playbackRate = previous.playbackRate;
        const resume = !previous.paused && !previous.ended;
        const next = previous.cloneNode(false);
        next.removeAttribute('src');
        next.srcObject = null;
        next.volume = previous.volume;
        next.muted = previous.muted;
        next.defaultPlaybackRate = previous.defaultPlaybackRate;
        next.playbackRate = playbackRate;
        next.loop = previous.loop;
        for (const key of ['preservesPitch', 'webkitPreservesPitch', 'mozPreservesPitch']) {
            if (key in previous) next[key] = previous[key];
        }
        next.autoplay = false;
        previous.replaceWith(next);
        element = next;
        const version = ++seekVersion;
        pendingSeek = source ? { element: next, position, duration: previous.duration } : null;
        bindElement(next);
        // Old pause/error events must never reach queue recovery or auto-advance.
        previous.pause();
        previous.removeAttribute('src');
        previous.srcObject = null;
        previous.load();
        beforeResume?.();
        window.dispatchEvent(new CustomEvent('lx-audio-replaced'));
        if (source) {
            next.addEventListener('loadedmetadata', () => {
                if (next !== element || version !== seekVersion) return;
                if (Number.isFinite(position) && position > 0) {
                    next.currentTime = Number.isFinite(next.duration) ? Math.min(position, next.duration) : position;
                }
                pendingSeek = null;
            }, { once: true });
            next.src = source;
            next.load();
            // load() resets playbackRate to defaultPlaybackRate in native media elements.
            next.playbackRate = playbackRate;
            // Call play in the original click gesture, without waiting for metadata.
            if (resume) next.play().catch(error => {
                if (next !== element || version !== seekVersion || error.name === 'AbortError') return;
                emit('pause');
                window.showInfo?.('已恢复原生播放，请点击播放继续。');
            });
        }
        return true;
    }
    const properties = new Set(['src', 'currentSrc', 'currentTime', 'duration', 'paused', 'ended',
        'volume', 'muted', 'playbackRate', 'error', 'readyState']);
    window.LXPlayback = new Proxy(element, {
        get(target, key) {
            if (key === 'replaceLocalElement') return replaceLocalElement;
            if (key === 'isRemote') return !!remote;
            if (key === 'emit') return emit;
            if (key === 'addEventListener' || key === 'removeEventListener') return events[key].bind(events);
            if (key === 'connectRemote') return output => {
                const snapshot = { src: element.src || element.currentSrc, currentTime: pendingSeek?.position ?? element.currentTime,
                    paused: element.paused, volume: element.volume, muted: element.muted, playbackRate: element.playbackRate };
                if (!remote) localVolumeState = { volume: element.volume, muted: element.muted };
                remote = output;
                seekVersion++;
                pendingSeek = null;
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
            if (pendingSeek?.element === element) {
                if (key === 'currentTime') return pendingSeek.position;
                if (key === 'duration') return pendingSeek.duration;
            }
            const value = Reflect.get(element, key, element);
            return typeof value === 'function' ? value.bind(element) : value;
        },
        set(target, key, value) {
            if (remote && properties.has(key)) remote[key] = value;
            else {
                if (key === 'src' || key === 'currentTime') { seekVersion++; pendingSeek = null; }
                Reflect.set(element, key, value, element);
            }
            return true;
        }
    });
})();
