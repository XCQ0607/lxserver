/* Shared surface lifecycle. Observe only surface visibility, not every animated row. */
(function () {
    const surfaces = new Set();
    const previousFocus = new WeakMap();
    const background = new Map();
    let top = null;
    let scheduled = false;
    let desktopMenu = null;
    let dialogSequence = 0;
    const surfaceSelector = '[data-player-dialog],[id$="-modal"],[id^="modal-"],[id$="-drawer"],#main-sidebar';
    const focusable = 'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';
    const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden' && !element.closest('.hidden,[hidden]');
    const isOpen = element => visible(element) && !element.classList.contains('translate-x-full') && !element.classList.contains('-translate-x-full');
    const buttons = element => [...element.querySelectorAll(focusable)].filter(item => visible(item) && !item.closest('[inert]'));
    function closeSurface(element) {
        const close = [...element.querySelectorAll('button')].find(button => /关闭|取消|close/i.test(button.getAttribute('aria-label') || button.title || button.textContent) || /close|cancel/i.test(button.id) || /close|toggle.*Drawer|toggleSidebar/.test(button.getAttribute('onclick') || ''));
        if (close) close.click();
    }
    const MOBILE_ACTION_DEFS = [
        { key: 'queue', label: '播放队列', icon: 'fas fa-list', handler: () => window.toggleQueueDrawer?.() },
        { key: 'effects', label: '音效均衡', icon: 'fas fa-sliders-h', handler: () => window.soundEffects?.toggle?.() },
        { key: 'download', label: '下载缓存', icon: 'fas fa-download', handler: (e) => window.handleDownloadClick?.(e) },
        { key: 'comment', label: '歌曲评论', icon: 'fas fa-comment-alt', handler: () => window.toggleCommentModal?.() },
        { key: 'share', label: '分享卡片', icon: 'fas fa-image', handler: () => window.lyricCard?.open?.() }
    ];

    function adjustMobilePlayerActions() {
        if (innerWidth >= 1025) return;
        const songInfo = document.getElementById('player-song-info');
        const actionsContainer = document.getElementById('player-mobile-actions');
        const menu = document.getElementById('player-mobile-overflow-menu');
        const menuContent = document.getElementById('player-mobile-overflow-content');
        if (!songInfo || !actionsContainer || !menu || !menuContent) return;

        const cover = document.getElementById('player-cover-container');
        const coverWidth = cover ? cover.offsetWidth : 48;
        const totalWidth = songInfo.clientWidth;

        // 给歌曲标题和作者留出舒适可读空间（最小 85px）
        const minTitleWidth = 85;
        // 播放器右上角悬浮的收起按钮 #btn-collapse-panel 占位安全边距（约 36px）
        const collapseBtn = document.getElementById('btn-collapse-panel');
        const rightMargin = (collapseBtn && collapseBtn.offsetParent !== null) ? 36 : 8;
        const likeBtn = document.getElementById('player-like-btn');
        const likeWidth = likeBtn ? likeBtn.offsetWidth || 28 : 28;

        const availableWidth = totalWidth - coverWidth - minTitleWidth - rightMargin - likeWidth;
        const btnWidth = 32; // 每个按钮占宽（含 gap）
        const menuSummaryWidth = 32; // 三个点按钮占宽

        const outerButtons = MOBILE_ACTION_DEFS.map(def => actionsContainer.querySelector(`[data-mobile-btn="${def.key}"]`)).filter(Boolean);

        // 如果宽度足够放下所有 5 个按钮
        if (availableWidth >= MOBILE_ACTION_DEFS.length * btnWidth) {
            outerButtons.forEach(btn => btn.classList.remove('hidden'));
            menu.style.display = 'none';
            menu.open = false;
            menuContent.innerHTML = '';
        } else {
            // 空间不足，优先保留前面重要按钮，放不下的移入三个点折叠菜单
            menu.style.display = '';
            const remaining = availableWidth - menuSummaryWidth;
            const fitCount = Math.max(0, Math.min(MOBILE_ACTION_DEFS.length - 1, Math.floor(remaining / btnWidth)));

            menuContent.innerHTML = '';
            MOBILE_ACTION_DEFS.forEach((def, index) => {
                const outerBtn = actionsContainer.querySelector(`[data-mobile-btn="${def.key}"]`);
                if (index < fitCount) {
                    if (outerBtn) outerBtn.classList.remove('hidden');
                } else {
                    if (outerBtn) outerBtn.classList.add('hidden');
                    const item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'mobile-menu-item';
                    item.innerHTML = `<i class="${def.icon}"></i><span>${def.label}</span>`;
                    item.onclick = (e) => {
                        e.stopPropagation();
                        menu.open = false;
                        def.handler(e);
                    };
                    menuContent.appendChild(item);
                }
            });
        }
    }
    window.adjustMobilePlayerActions = adjustMobilePlayerActions;

    function refresh() {
        scheduled = false;
        adjustMobilePlayerActions();
        for (const [element, inert] of background) element.inert = inert;
        background.clear();
        const open = [];
        for (const element of surfaces) {
            if (!element.isConnected) { surfaces.delete(element); continue; }
            const sidebar = element.id === 'main-sidebar';
            const opened = sidebar && innerWidth >= 1025 ? false : isOpen(element);
            const closed = sidebar && innerWidth >= 1025 ? false : !opened;
            element.inert = closed;
            if (closed) element.setAttribute('aria-hidden', 'true');
            else element.removeAttribute('aria-hidden');
            if (opened) open.push(element);
            else { element.removeAttribute('role'); element.removeAttribute('aria-modal'); }
        }
        open.sort((a, b) => (parseInt(getComputedStyle(a).zIndex) || 0) - (parseInt(getComputedStyle(b).zIndex) || 0));
        const next = open.at(-1) || null;
        if (next !== top) {
            const old = top;
            const active = document.activeElement;
            const returning = old && previousFocus.get(old);
            top = next;
            if (top) {
                top.id ||= 'player-dialog-' + ++dialogSequence;
                if (!previousFocus.has(top) || !old || !isOpen(old)) previousFocus.set(top, active);
                top.setAttribute('role', 'dialog');
                top.setAttribute('aria-modal', 'true');
                const heading = top.querySelector('h1,h2,h3,h4');
                if (heading) {
                    heading.id ||= top.id + '-heading';
                    top.setAttribute('aria-labelledby', heading.id);
                } else top.setAttribute('aria-label', top.id === 'main-sidebar' ? '导航菜单' : '对话框');
                top.tabIndex = -1;
                (returning?.isConnected && top.contains(returning) ? returning : buttons(top)[0] || top).focus({ preventScroll: true });
            } else if (returning?.isConnected && !returning.closest('[inert]')) returning.focus({ preventScroll: true });
            if (old && !isOpen(old)) previousFocus.delete(old);
        }
        if (top) {
            let branch = top;
            while (branch.parentElement && branch.parentElement !== document.documentElement) {
                for (const sibling of branch.parentElement.children) {
                    if (sibling === branch || ['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) continue;
                    background.set(sibling, sibling.inert);
                    sibling.inert = true;
                }
                branch = branch.parentElement;
            }
        }
    }
    function schedule() {
        if (!scheduled) { scheduled = true; queueMicrotask(refresh); }
    }
    const observer = new MutationObserver(schedule);
    function discover(root) {
        const candidates = [...root.querySelectorAll(surfaceSelector)];
        if (root.matches?.(surfaceSelector)) candidates.push(root);
        for (const element of candidates) {
            if (!element.classList.contains('fixed') || surfaces.has(element)) continue;
            surfaces.add(element);
            element.querySelectorAll('button[id$="close-x"]').forEach(button => button.setAttribute('aria-label', '关闭'));
            observer.observe(element, { attributes: true, attributeFilter: ['class', 'style'] });
        }
    }
    document.addEventListener('keydown', event => {
        if (!top) return;
        if (event.key === 'Escape') {
            event.preventDefault(); event.stopImmediatePropagation(); closeSurface(top);
        } else if (event.key === 'Tab') {
            const items = buttons(top);
            const index = items.indexOf(document.activeElement);
            const target = event.shiftKey ? (index <= 0 ? items.at(-1) : items[index - 1]) : items[(index + 1) % items.length];
            event.preventDefault(); event.stopImmediatePropagation(); (target || top).focus();
        }
    }, true);
    document.addEventListener('focusin', event => {
        if (top && !top.contains(event.target)) (buttons(top)[0] || top).focus({ preventScroll: true });
    });
    function observePlayerFooter() {
        const footer = document.getElementById('player-footer');
        if (!footer) return;
        let pending = false;
        const measure = () => {
            pending = false;
            const hidden = footer.classList.contains('translate-y-[110%]') ||
                getComputedStyle(footer).display === 'none';
            // Border-box height already includes the device safe area. Transforms
            // during collapse must not change the amount reserved for an open bar.
            const inset = hidden ? 'env(safe-area-inset-bottom, 0px)' :
                Math.ceil(footer.getBoundingClientRect().height) + 'px';
            document.documentElement.style.setProperty('--player-footer-inset', inset);
        };
        const scheduleMeasure = () => {
            if (pending) return;
            pending = true;
            requestAnimationFrame(measure);
        };
        if (window.ResizeObserver) new ResizeObserver(scheduleMeasure).observe(footer);
        new MutationObserver(scheduleMeasure).observe(footer, {
            attributes: true, attributeFilter: ['class', 'style'],
        });
        window.addEventListener('resize', scheduleMeasure);
        window.visualViewport?.addEventListener('resize', scheduleMeasure);
        measure();
    }

    document.addEventListener('DOMContentLoaded', () => {
        observePlayerFooter();
        document.querySelectorAll('button').forEach(button => {
            if (!button.getAttribute('aria-label')) {
                const label = button.title || (button.querySelector('.fa-times') ? '关闭' : '');
                if (label) button.setAttribute('aria-label', label);
            }
        });
        discover(document);
        refresh();
        new MutationObserver(records => {
            let changed = false;
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (node.nodeType === 1 && (node.matches?.(surfaceSelector) || node.querySelector(surfaceSelector))) {
                        discover(node); changed = true;
                    }
                }
                for (const node of record.removedNodes) if (node.nodeType === 1 && [...surfaces].some(surface => node === surface || node.contains(surface))) changed = true;
            }
            if (changed) schedule();
        }).observe(document.body, { childList: true, subtree: true });
        const search = document.getElementById('search-input');
        search?.addEventListener('input', () => { window.SearchRequests.cancel(); window.setSearchStatus(); });

        const songInfo = document.getElementById('player-song-info');
        if (songInfo && window.ResizeObserver) {
            new ResizeObserver(() => adjustMobilePlayerActions()).observe(songInfo);
        }
        adjustMobilePlayerActions();
    });
    window.addEventListener('resize', schedule);

    // Main-view history coexists with the existing lyric/artist detail entries.
    let restoring = false;
    let current = history.state?.lxMain || { tab: 'search' };
    history.replaceState({ ...history.state, lxMain: current }, '');
    window.PlayerNavigation = {
        record(state) {
            if (restoring || JSON.stringify(current) === JSON.stringify(state)) return;
            current = state;
            history.pushState({ lxMain: state }, '', '#view=' + encodeURIComponent(state.tab));
        },
    };
    document.addEventListener('click', event => {
        if (event.target.closest('#custom-dir-switch-container')) return;
        const link = event.target.closest('a[id^="tab-"]');
        if (link?.getAttribute('href') === '#') event.preventDefault();
    }, true);
    document.addEventListener('click', event => {
        if (innerWidth < 1025 && !event.target.closest('.mobile-player-menu > summary')) {
            const menu = document.querySelector('details.mobile-player-menu[open]');
            if (menu) menu.open = false;
        }
    });
    window.addEventListener('popstate', event => {
        if (!event.state?.lxMain || event.state.page) return;
        const state = event.state.lxMain;
        setTimeout(() => {
            restoring = true;
            try {
                current = state;
                if (state.listId) window.handleListClick(state.listId, true);
                else window.switchTab(state.tab);
            } finally { restoring = false; }
        }, 0);
    });

    // The lyric-card exporter is optional; its existing API becomes available on demand.
    let lyricModule;
    window.lyricCard = {
        async open() {
            try {
                lyricModule ||= new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = new URL('js/lyrics/lyric-card.js', document.baseURI).href;
                    script.onload = resolve;
                    script.onerror = () => { script.remove(); reject(new Error('歌词卡片加载失败，请重试')); };
                    document.head.appendChild(script);
                });
                await lyricModule;
                return window.lyricCard.open();
            } catch (error) { lyricModule = null; window.showError?.(error.message); }
        },
    };
})();
