// Safari's picker must be opened synchronously from the user's click.
(() => {
    const audio = document.getElementById('audio-player');
    const button = document.getElementById('btn-airplay');
    if (!audio || !button || typeof audio.webkitShowPlaybackTargetPicker !== 'function') return;

    let available = false;
    function update() {
        const wireless = !!audio.webkitCurrentPlaybackTargetIsWireless;
        button.hidden = !available && !wireless;
        button.disabled = !available && !wireless;
        button.setAttribute('aria-pressed', String(wireless));
        button.title = wireless ? 'AirPlay connected' : 'AirPlay';
        button.classList.toggle('text-emerald-500', wireless);
        window.iOSBackgroundAudio?.setWirelessPlayback(wireless);
    }
    audio.addEventListener('webkitplaybacktargetavailabilitychanged', event => {
        available = event.availability === 'available';
        update();
    });
    audio.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', update);
    button.addEventListener('click', () => {
        if (window.soundEffects?.needsNativeReload()) {
            window.soundEffects.open();
            window.showInfo?.('请先点击“刷新并恢复原生播放 / AirPlay”，再选择 AirPlay 设备。', 5000);
            return;
        }
        try { audio.webkitShowPlaybackTargetPicker(); }
        catch (error) { console.warn('[AirPlay] Picker unavailable:', error); }
    });
    update();
})();
