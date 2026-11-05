(() => {
    const playback = window.LXPlayback;
    const button = document.getElementById('btn-cast');
    // Google does not provide a Web Sender for iOS. Native Safari/AirPlay stays intact.
    if (!playback || !button || /iPhone|iPad|iPod/.test(navigator.userAgent) ||
        !/Chrome|Chromium|Edg\//.test(navigator.userAgent) || !window.isSecureContext) return;
    let context, player, controller, output = null;
    const notify = message => window.showError?.(message);
    const headers = () => ({ 'Content-Type': 'application/json', ...window.getUserAuthHeaders?.() });
    const route = active => window.dispatchEvent(new CustomEvent('lx-cast-route', { detail: { active } }));
    const localUrl = source => {
        const url = new URL(source, location.href);
        return url.origin === location.origin ? url.pathname + url.search : url.href;
    };
    const mimeFor = (source, song = {}) => {
        const name = new URL(source, location.href).searchParams.get('url') || source;
        if (/\.flac(?:[?#]|$)/i.test(name) || /flac/i.test(song.quality || '')) return 'audio/flac';
        if (/\.(m4a|mp4)(?:[?#]|$)/i.test(name)) return 'audio/mp4';
        if (/\.aac(?:[?#]|$)/i.test(name)) return 'audio/aac';
        if (/\.(ogg|opus)(?:[?#]|$)/i.test(name)) return 'audio/ogg';
        if (/\.wav(?:[?#]|$)/i.test(name)) return 'audio/wav';
        return 'audio/mpeg';
    };
    async function grant(source, mime) {
        const response = await fetch('/api/music/cast/session', { method: 'POST', headers: headers(),
            body: JSON.stringify({ url: localUrl(source), mime }), signal: AbortSignal.timeout(15000) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '无法准备投放链接');
        return { ...data, url: new URL(data.url, location.origin).href };
    }
    const revoke = id => {
        if (id) void fetch('/api/music/cast/session?id=' + encodeURIComponent(id), { method: 'DELETE', headers: headers() }).catch(() => {});
    };
    const abort = () => Object.assign(new Error('Playback changed'), { name: 'AbortError' });

    class CastOutput {
        constructor(session) {
            this.session = session;
            this.source = '';
            this.position = 0;
            this.length = 0;
            this.stopped = true;
            this.finished = false;
            this.error = null;
            this.loaded = false;
            this.version = 0;
            this.grants = [];
            this.chain = Promise.resolve();
            this.pending = null;
            this.pendingSeek = false;
            this.desiredPaused = true;
            this.level = session.getVolume?.() ?? player.volumeLevel ?? 0.5;
            this.silent = session.isMute?.() ?? player.isMuted ?? false;
        }
        get src() { return this.source; }
        set src(value) {
            this.source = value;
            this.version++;
            this.pending = null;
            this.pendingSeek = false;
            this.loaded = false;
            this.finished = false;
            this.error = null;
            this.position = 0;
            this.length = 0;
            this.stopped = true;
            this.song = window.getCastSong?.() || window.currentPlayingSong;
        }
        get currentSrc() { return this.source; }
        get currentTime() { return this.position; }
        set currentTime(value) {
            if (!Number.isFinite(value)) return;
            this.position = Math.max(0, this.length ? Math.min(value, this.length) : value);
            if (this.loaded) { player.currentTime = this.position; controller.seek(); }
            else this.pendingSeek = true;
            playback.emit('seeked');
        }
        get duration() { return this.length; }
        get paused() { return this.loaded ? this.stopped : this.desiredPaused; }
        get ended() { return this.finished; }
        get readyState() { return this.loaded ? 4 : 0; }
        get volume() { return this.level; }
        set volume(value) {
            if (!Number.isFinite(value)) return;
            const level = Math.max(0, Math.min(1, value));
            if (level === this.level) return;
            this.level = level;
            player.volumeLevel = level;
            controller.setVolumeLevel();
        }
        get muted() { return this.silent; }
        set muted(value) {
            if (!!value === this.silent) return;
            this.silent = !!value;
            if (player.isMuted !== this.silent) controller.muteOrUnmute();
        }
        get playbackRate() { return 1; }
        set playbackRate(_value) { /* Default receiver uses normal playback speed. */ }
        pause() {
            this.desiredPaused = true;
            if (this.loaded && !player.isPaused) controller.playOrPause();
            else if (!this.loaded) playback.emit('pause');
        }
        async play() {
            this.desiredPaused = false;
            if (!this.source) return;
            if (!this.loaded) return this.load();
            if (player.isPaused) controller.playOrPause();
        }
        load() {
            if (this.pending) return this.pending;
            const version = this.version, source = this.source, song = this.song || {};
            // Serialize receiver LOAD commands so an older response cannot replace a newer track.
            const task = this.chain.catch(() => {}).then(async () => {
                if (version !== this.version || output !== this) throw abort();
                const credentials = [];
                try {
                    const media = await grant(source, mimeFor(source, song));
                    credentials.push(media.id);
                    if (version !== this.version || output !== this) throw abort();
                    const info = new chrome.cast.media.MediaInfo(media.url, media.mime);
                    const metadata = new chrome.cast.media.MusicTrackMediaMetadata();
                    metadata.title = song.name || 'LX Music';
                    metadata.artist = song.singer || '';
                    metadata.albumName = window.getSongAlbumName?.(song) || '';
                    try {
                        const pic = window.getImgUrl?.(song) || song.pic;
                        if (pic && !/\/music\/assets\/logo\.(svg|png)(?:[?#]|$)/i.test(pic)) {
                            const art = new URL(pic, location.href);
                            if (art.origin === location.origin && /\/api\/music\/(cache|custom)\/cover$/.test(art.pathname)) {
                                const cover = await grant(pic, 'image/jpeg');
                                credentials.push(cover.id);
                                metadata.images = [new chrome.cast.Image(cover.url)];
                            } else if (art.protocol === 'https:' && !art.searchParams.has('token')) {
                                metadata.images = [new chrome.cast.Image(art.href)];
                            }
                        }
                    } catch { /* Artwork must never prevent audio playback. */ }
                    if (version !== this.version || output !== this) throw abort();
                    info.metadata = metadata;
                    info.customData = { lxMusicCast: true, song: { id: song.id, name: song.name,
                        singer: song.singer, source: song.source, songmid: song.songmid, albumName: metadata.albumName, img: metadata.images?.[0]?.url } };
                    const request = new chrome.cast.media.LoadRequest(info);
                    request.currentTime = this.position;
                    this.pendingSeek = false;
                    request.autoplay = !this.desiredPaused;
                    this.contentId = media.url;
                    await this.session.loadMedia(request);
                    if (version !== this.version || output !== this) throw abort();
                    this.grants.forEach(revoke);
                    this.grants = credentials;
                    this.loaded = true;
                    this.error = null;
                    const seekAfterLoad = this.pendingSeek ? this.position : null;
                    this.pendingSeek = false;
                    playback.emit('loadedmetadata');
                    playback.emit('canplay');
                    this.sync();
                    if (seekAfterLoad !== null) this.currentTime = seekAfterLoad;
                    // Apply the last transport request made while LOAD was in flight.
                    if (this.desiredPaused !== !!player.isPaused) controller.playOrPause();
                } catch (error) {
                    credentials.forEach(revoke);
                    throw error;
                }
            });
            this.chain = task;
            this.pending = task;
            task.finally(() => { if (this.pending === task) this.pending = null; }).catch(() => {});
            return task;
        }
        sync() {
            const media = this.session.getMediaSession() || this.media;
            if (!media || media.media?.contentId !== this.contentId || !this.loaded) return;
            if (this.finished && media.idleReason === 'FINISHED') return;
            this.media = media;
            this.length = player.duration || media.media.duration || this.length;
            this.position = player.currentTime || 0;
            const wasPaused = this.stopped;
            const paused = !!player.isPaused;
            this.stopped = paused;
            this.level = player.volumeLevel ?? this.level;
            this.silent = !!player.isMuted;
            if (media.idleReason === 'FINISHED' && !this.finished) {
                this.finished = true;
                this.stopped = true;
                this.position = this.length;
                playback.emit('timeupdate');
                playback.emit('ended');
                return;
            }
            if (media.idleReason === 'ERROR' && !this.error) {
                this.error = new Error('Chromecast 无法播放此音频，请尝试其他音质或音源');
                playback.emit('error');
                return;
            }
            if (wasPaused !== paused) playback.emit(paused ? 'pause' : 'play');
            if (media.playerState !== this.lastState) {
                this.lastState = media.playerState;
                if (media.playerState === 'BUFFERING') playback.emit('waiting');
                else if (media.playerState === 'PLAYING') playback.emit('playing');
            }
            playback.emit('volumechange');
            playback.emit('timeupdate');
        }
        dispose() {
            this.version++;
            this.grants.forEach(revoke);
            this.grants = [];
        }
    }

    function updateButton() {
        // During SESSION_ENDED the SDK can still return the previous session.
        const connected = !!output && !!context?.getCurrentSession();
        // Opening the picker starts discovery on browsers that defer it until a user gesture.
        button.hidden = false;
        button.disabled = false;
        button.setAttribute('aria-pressed', String(connected));
        button.title = connected ? '正在投放 · ' + (context.getCurrentSession().getCastDevice().friendlyName || 'Chromecast') : 'Chromecast';
        button.classList.toggle('text-emerald-500', connected);
    }
    async function connect(resumed) {
        if (output) return;
        const session = context.getCurrentSession();
        if (!session) return;
        const transport = new CastOutput(session);
        output = transport;
        const snapshot = playback.connectRemote(transport);
        transport.src = snapshot.src;
        transport.position = snapshot.currentTime || 0;
        transport.desiredPaused = snapshot.paused;
        playback.emit('volumechange'); // Adopt receiver volume; never turn it up on connection.
        route(true);
        try {
            const media = session.getMediaSession();
            if (resumed && media?.media?.customData?.lxMusicCast) {
                const id = new URL(media.media.contentId).searchParams.get('id');
                const response = await fetch('/api/music/cast/session?id=' + encodeURIComponent(id), { headers: headers() });
                if (!response.ok) throw new Error('投放链接已过期，请重新选择歌曲');
                const data = await response.json();
                if (output !== transport) return;
                transport.src = data.url;
                transport.contentId = media.media.contentId;
                transport.loaded = true;
                transport.grants = [id];
                window.dispatchEvent(new CustomEvent('lx-cast-track', { detail: media.media.customData.song }));
                playback.emit('loadedmetadata');
                transport.sync();
            } else if (transport.src) {
                playback.emit('waiting');
                await transport.load();
            }
        } catch (error) {
            if (output !== transport || error.name === 'AbortError') return;
            notify('Chromecast 连接失败：' + (error.message || error));
            disconnect();
            session.endSession(true);
        }
    }
    function disconnect() {
        if (!output) return;
        const previous = output;
        playback.restoreLocal();
        output = null;
        previous.dispose();
        route(false);
        updateButton();
    }
    function initialize(available) {
        if (!available || context) return;
        try {
            context = cast.framework.CastContext.getInstance();
            context.setOptions({ receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
                autoJoinPolicy: chrome.cast.AutoJoinPolicy.TAB_AND_ORIGIN_SCOPED });
            player = new cast.framework.RemotePlayer();
            controller = new cast.framework.RemotePlayerController(player);
            controller.addEventListener(cast.framework.RemotePlayerEventType.ANY_CHANGE, () => output?.sync());
            context.addEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, updateButton);
            context.addEventListener(cast.framework.CastContextEventType.SESSION_STATE_CHANGED, event => {
                if (event.sessionState === cast.framework.SessionState.SESSION_STARTED) void connect(false);
                else if (event.sessionState === cast.framework.SessionState.SESSION_RESUMED) void connect(true);
                else if (event.sessionState === cast.framework.SessionState.SESSION_ENDED) disconnect();
                updateButton();
            });
            button.addEventListener('click', () => { void context.requestSession().catch(error => {
                if (error !== 'cancel' && error?.code !== 'cancel') notify('无法打开 Chromecast 设备选择器');
            }); });
            updateButton();
            if (context.getCurrentSession()) void connect(true);
        } catch { button.hidden = true; }
    }
    window.__onGCastApiAvailable = initialize;
    if (window.cast?.framework) initialize(true);
    else {
        const script = document.createElement('script');
        script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
        script.async = true;
        script.onerror = () => { button.hidden = true; };
        document.head.appendChild(script);
    }
})();
