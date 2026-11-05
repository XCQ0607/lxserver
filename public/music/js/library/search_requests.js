// One active user search; each provider has its own bounded lifetime.
(function () {
    let active = null;
    function cancel() {
        if (active) active.abort();
        active = null;
    }
    window.SearchRequests = {
        cancel,
        begin() {
            cancel();
            const owner = new AbortController();
            active = owner;
            return {
                current: () => active === owner && !owner.signal.aborted,
                async json(url, headers, timeout = 15000) {
                    const controller = new AbortController();
                    const abort = () => controller.abort();
                    owner.signal.addEventListener('abort', abort, { once: true });
                    if (owner.signal.aborted) abort();
                    const timer = setTimeout(abort, timeout);
                    try {
                        const response = await fetch(url, { headers, signal: controller.signal });
                        if (!response.ok) throw new Error(`搜索请求失败: ${response.status}`);
                        return await response.json();
                    } finally {
                        clearTimeout(timer);
                        owner.signal.removeEventListener('abort', abort);
                    }
                },
            };
        },
    };
    window.setSearchStatus = function (message = '', loading = false) {
        const status = document.getElementById('search-status');
        const wave = document.getElementById('search-progress-wave');
        if (wave) wave.classList.toggle('is-active', !!loading);
        if (!status) return;
        status.classList.toggle('hidden', !message);
        const textEl = document.getElementById('search-status-text');
        if (textEl) textEl.textContent = message;
        const cancelBtn = document.getElementById('search-cancel');
        if (cancelBtn) cancelBtn.hidden = !loading;
        const homeBtn = document.getElementById('search-home-btn');
        if (homeBtn) homeBtn.hidden = !message;
        const spinner = document.getElementById('search-status-spinner');
        if (spinner) spinner.style.display = loading ? 'inline-flex' : 'none';
    };
    window.cancelMusicSearch = function () {
        cancel();
        window.setSearchStatus('搜索已取消，可修改关键词后重试', false);
        const results = document.getElementById('search-results');
        if (results?.querySelector('.fa-spinner')) results.replaceChildren();
    };
    window.returnSearchHome = function () {
        cancel();
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.value = '';
        window.savedNetworkSearchState = null;
        if (typeof window.showInitialSearchState === 'function') {
            window.showInitialSearchState();
        } else {
            window.setSearchStatus('');
        }
    };
})();
