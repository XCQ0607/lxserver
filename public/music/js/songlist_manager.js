/**
 * Song List Manager for LX Music Web
 * Handles fetching, rendering and interactions for the "Song List" (Playlist) feature.
 */

window.SongListManager = (function () {
    const API_BASE = '/api/music';
    let currentState = {
        source: 'wy',
        viewMode: localStorage.getItem('songlist-view-mode') || 'grid', // 'grid' | 'row'
        tagId: '',
        tagName: '全部分类',
        sortId: 'hot',
        sortList: [{ name: '最热', id: 'hot' }], // Default for WY
        page: 1,
        total: 0,
        limit: 30,
        list: [],
        tags: [],
        hotTags: []
    };

    let detailState = {
        id: '',
        source: '',
        info: null,
        list: [],
        page: 1,
        total: 0,
        limit: 30
    };

    // Sort mode state
    let sortMode = false;
    let sortableInstance = null;
    // Working copy of list in sort mode (to avoid mutating detailState.list until save)
    let sortWorkList = [];

    // Initialize
    async function init() {
        console.log('[SongList] Initializing...');

        // 优先从缓存读取
        const cachedSource = localStorage.getItem('songlist-source');
        if (cachedSource) {
            currentState.source = cachedSource;
            const sel = document.getElementById('songlist-source');
            if (sel) sel.value = cachedSource;
        }

        updateViewModeUI();
        renderSortTabs();
        await loadTags();
        if (window.DislikeManager) window.DislikeManager.load();
        loadList();

        // Bind events that might not be in HTML attributes
        document.addEventListener('click', function (e) {
            const popup = document.getElementById('tag-selector-popup');
            const btn = document.getElementById('tag-selector-btn');
            if (popup && !popup.classList.contains('hidden')) {
                if (!popup.contains(e.target) && !btn.contains(e.target)) {
                    toggleTagSelector(false);
                }
            }
        });
    }

    // --- UI Helpers ---

    function toggleTagSelector(force) {
        const popup = document.getElementById('tag-selector-popup');
        const arrow = document.getElementById('tag-arrow');
        const isHidden = popup.classList.contains('hidden');
        const show = force !== undefined ? force : isHidden;

        if (show) {
            popup.classList.remove('hidden');
            setTimeout(() => {
                popup.classList.remove('opacity-0', 'translate-y-2');
                popup.classList.add('opacity-100', 'translate-y-0');
            }, 10);
            arrow.style.transform = 'rotate(180deg)';
            if (currentState.tags.length === 0) loadTags();
        } else {
            popup.classList.add('opacity-0', 'translate-y-2');
            popup.classList.remove('opacity-100', 'translate-y-0');
            arrow.style.transform = 'rotate(0deg)';
            setTimeout(() => popup.classList.add('hidden'), 300);
        }
    }

    function toggleExternalListModal(show) {
        const modal = document.getElementById('external-list-modal');
        const content = document.getElementById('external-list-modal-content');
        if (show) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            setTimeout(() => {
                content.classList.remove('scale-95', 'opacity-0');
                content.classList.add('scale-100', 'opacity-100');
            }, 10);
            // Default select current source
            document.getElementById('external-list-source').value = currentState.source;
            // Trigger entry check
            window.SongListManager.onExternalSourceChange();
        } else {
            content.classList.remove('scale-100', 'opacity-100');
            content.classList.add('scale-95', 'opacity-0');
            setTimeout(() => {
                modal.classList.remove('flex');
                modal.classList.add('hidden');
            }, 300);
        }
    }

    function toggleQQInputModal(show) {
        const modal = document.getElementById('qq-input-modal');
        const content = document.getElementById('qq-input-modal-content');
        if (show) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            setTimeout(() => {
                content.classList.remove('scale-95', 'opacity-0');
                content.classList.add('scale-100', 'opacity-100');
            }, 10);
        } else {
            content.classList.remove('scale-100', 'opacity-100');
            content.classList.add('scale-95', 'opacity-0');
            setTimeout(() => {
                modal.classList.remove('flex');
                modal.classList.add('hidden');
            }, 300);
        }
    }

    function toggleUserPlaylistModal(show) {
        const modal = document.getElementById('user-playlist-modal');
        const content = document.getElementById('user-playlist-modal-content');
        if (show) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            setTimeout(() => {
                content.classList.remove('scale-95', 'opacity-0');
                content.classList.add('scale-100', 'opacity-100');
            }, 10);
        } else {
            content.classList.remove('scale-100', 'opacity-100');
            content.classList.add('scale-95', 'opacity-0');
            setTimeout(() => {
                modal.classList.remove('flex');
                modal.classList.add('hidden');
            }, 300);
        }
    }

    // --- Data Fetching ---

    async function loadTags() {
        const source = currentState.source;
        if (source === 'all') {
            currentState.tags = [];
            currentState.hotTags = [];
            currentState.sortList = [{ name: '最热', id: 'hot' }];
            currentState.sortId = 'hot';
            renderSortTabs();
            renderTags();
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/songList/tags?source=${source}`);
            const data = await res.json();
            currentState.tags = data.tags || [];
            currentState.hotTags = data.hotTags || [];
            currentState.sortList = data.sortList || [];
            if (currentState.sortList.length > 0 && !currentState.sortList.some(opt => String(opt.id) === String(currentState.sortId))) {
                currentState.sortId = currentState.sortList[0].id;
            }
            renderSortTabs();
            renderTags();
        } catch (e) {
            console.error('[SongList] Load tags failed:', e);
        }
    }

    async function loadList(page = 1) {
        currentState.page = page;
        const { source, tagId, sortId } = currentState;
        const container = document.getElementById('songlist-container');

        container.innerHTML = `
            <div class="col-span-full py-20 text-center t-text-muted">
                <i class="fas fa-spinner fa-spin text-4xl mb-4 text-emerald-500"></i>
                <p>正在拉取 ${source === 'all' ? '聚合' : source.toUpperCase()} 歌单...</p>
            </div>
        `;

        try {
            if (source === 'all') {
                const sources = ['wy', 'tx', 'kg', 'kw', 'mg'];
                const promises = sources.map(s =>
                    fetch(`${API_BASE}/songList/list?source=${s}&tagId=${encodeURIComponent(tagId)}&sortId=${encodeURIComponent(sortId || 'hot')}&page=${page}`)
                        .then(r => r.json())
                        .then(d => (d.list || []).map(item => ({ ...item, source: s })))
                        .catch(e => {
                            console.warn(`[SongList] ${s} load failed:`, e);
                            return [];
                        })
                );
                const results = await Promise.all(promises);
                const combined = [];
                const maxLen = Math.max(...results.map(r => r.length), 0);
                for (let i = 0; i < maxLen; i++) {
                    for (const resList of results) {
                        if (resList[i]) combined.push(resList[i]);
                    }
                }
                currentState.list = combined;
                currentState.total = combined.length;
                currentState.limit = 30;
            } else {
                const url = `${API_BASE}/songList/list?source=${source}&tagId=${encodeURIComponent(tagId)}&sortId=${encodeURIComponent(sortId)}&page=${page}`;
                const res = await fetch(url);
                const data = await res.json();

                currentState.list = data.list || [];
                currentState.total = data.total || 0;
                currentState.limit = data.limit || 30;
            }

            renderList();
            updatePaginationUI();
        } catch (e) {
            console.error('[SongList] Load list failed:', e);
            container.innerHTML = `<div class="col-span-full py-20 text-center text-red-500">加载失败: ${e.message}</div>`;
        }
    }

    async function loadDetail(id, source, page = 1) {
        detailState.id = id;
        detailState.source = source;
        detailState.page = page;

        const detailView = document.getElementById('songlist-detail-view');
        const listContainer = document.getElementById('sl-detail-list');

        if (page === 1) {
            detailView.classList.remove('hidden');
            setTimeout(() => detailView.classList.remove('translate-x-full'), 10);
            listContainer.innerHTML = '<div class="flex items-center justify-center py-20"><i class="fas fa-spinner fa-spin text-4xl text-emerald-500"></i></div>';

            // Clear old data to prevent flickering
            detailState.info = null;
            detailState.list = [];
            document.getElementById('sl-detail-name').innerText = '正在加载...';
            document.getElementById('sl-detail-title').innerText = '加载中...';
            if (window.setImg) window.setImg('sl-detail-cover', '/music/assets/logo.svg');
            else document.getElementById('sl-detail-cover').src = '/music/assets/logo.svg';
            document.getElementById('sl-detail-author').innerText = '';
            document.getElementById('sl-detail-subtitle').innerText = '正在加载歌单详情...';
            const descEl = document.getElementById('sl-detail-desc');
            if (descEl) descEl.innerText = '正在拉取详情，请稍后...';
            const statsEl = document.getElementById('sl-detail-stats');
            if (statsEl) statsEl.innerHTML = '';

            // Reset header collapse state
            const header = document.getElementById('sl-detail-header');
            const icon = document.getElementById('sl-detail-collapse-icon');
            if (header && icon && header.classList.contains('is-collapsed')) {
                header.classList.remove('is-collapsed', 'max-h-0', 'opacity-0', 'py-0', 'border-b-0', 'pointer-events-none');
                header.classList.add('max-h-[1000px]', 'p-4', 'md:p-6', 'border-b');
                icon.style.transform = 'rotate(0deg)';
            }

        }


        try {
            const url = `${API_BASE}/songList/detail?source=${source}&id=${encodeURIComponent(id)}&page=${page}`;
            const res = await fetch(url);
            const data = await res.json();

            detailState.info = data.info;

            // Normalize IDs to ensure batch operations work correctly
            const normalizedList = (data.list || []).map((song, idx) => {
                if (!song.id || song.id === 'undefined') {
                    song.id = song.songmid || song.songId || song.hash || song.copyrightId || song.mid || song.mediaMid || `sl_${detailState.id}_${idx}`;
                }
                return song;
            });

            if (page === 1) {
                detailState.list = normalizedList;
            } else {
                detailState.list = [...detailState.list, ...normalizedList];
            }
            detailState.total = data.total;
            window.viewingPlaylist = detailState.list; // Sync with global

            // Initialize Unified Search for this context only on first load
            if (page === 1) {
                window.ListSearch.init('songlist', {
                    renderCallback: () => window.SongListManager.renderDetail(),
                    getList: () => detailState.list
                });
            } else if (window.ListSearch && window.ListSearch.state.active && window.ListSearch.state.id === 'songlist') {
                // If appending more songs while filtering, refresh results
                window.ListSearch.handleSearch();
                return; // handleSearch already calls renderDetail
            }

            renderDetail();
        } catch (e) {
            console.error('[SongList] Load detail failed:', e);
            if (page === 1) {
                listContainer.innerHTML = `<div class="text-center text-red-500 p-10">加载失败: ${e.message}</div>`;
            }
        }
    }

    // --- Rendering ---
    function renderTags() {
        const container = document.getElementById('tag-container');
        if (!container) return;
        let html = '';
        // Default All Tag
        html += `<div class="mb-6">
            <h4 class="text-xs font-bold t-text-muted uppercase tracking-wider mb-3">默认</h4>
            <div class="flex flex-wrap gap-2">
                <button onclick="window.SongListManager.selectTag('', '全部分类')" 
                    class="px-3 py-1.5 rounded-lg text-sm transition-all ${currentState.tagId === '' ? 'active-option' : 't-bg-main hover:t-bg-track'}">全部分类</button>
            </div>
        </div>`;

        // Hot Tags
        if (currentState.hotTags.length > 0) {
            html += `<div class="mb-6">
                <h4 class="text-xs font-bold t-text-muted uppercase tracking-wider mb-3">热门标签</h4>
                <div class="flex flex-wrap gap-2">
                    ${currentState.hotTags.map(tag => `
                        <button onclick="window.SongListManager.selectTag('${tag.id}', '${tag.name}')" 
                            class="px-3 py-1.5 rounded-lg text-sm transition-all ${currentState.tagId === tag.id ? 'active-option' : 't-bg-main hover:t-bg-track'}">${tag.name}</button>
                    `).join('')}
                </div>
            </div>`;
        }

        // All Categories
        currentState.tags.forEach(cat => {
            html += `<div class="mb-6">
                <h4 class="text-xs font-bold t-text-muted uppercase tracking-wider mb-3">${cat.name}</h4>
                <div class="flex flex-wrap gap-2">
                    ${cat.list.map(tag => `
                        <button onclick="window.SongListManager.selectTag('${tag.id}', '${tag.name}')" 
                            class="px-3 py-1.5 rounded-lg text-sm transition-all ${currentState.tagId === tag.id ? 'active-option' : 't-bg-main hover:t-bg-track'}">${tag.name}</button>
                    `).join('')}
                </div>
            </div>`;
        });

        container.innerHTML = html;
    }

    const SOURCE_LABELS = {
        wy: '网易',
        tx: 'QQ',
        kg: '酷狗',
        kw: '酷我',
        mg: '咪咕'
    };

    function updateViewModeUI() {
        const icon = document.getElementById('songlist-view-mode-icon');
        const container = document.getElementById('songlist-container');
        const btn = document.getElementById('songlist-view-mode-btn');

        if (currentState.viewMode === 'row') {
            if (icon) {
                icon.className = 'fas fa-list text-emerald-500';
            }
            if (btn) btn.title = '当前：行列模式（点击切换为方块）';
            if (container) {
                container.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4';
            }
        } else {
            if (icon) {
                icon.className = 'fas fa-th-large';
            }
            if (btn) btn.title = '当前：方块模式（点击切换为行列）';
            if (container) {
                container.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6';
            }
        }
    }

    function toggleViewMode() {
        currentState.viewMode = currentState.viewMode === 'grid' ? 'row' : 'grid';
        localStorage.setItem('songlist-view-mode', currentState.viewMode);
        updateViewModeUI();
        renderList();
    }

    function renderList() {
        const container = document.getElementById('songlist-container');
        if (!container) return;
        updateViewModeUI();

        if (currentState.list.length === 0) {
            container.innerHTML = '<div class="col-span-full py-20 text-center t-text-muted">暂无数据</div>';
            return;
        }

        if (currentState.viewMode === 'row') {
            // 行列模式 (自适应多列/单列条形卡片)
            container.innerHTML = currentState.list.map(item => {
                const itemSource = item.source || currentState.source;
                const sourceLabel = SOURCE_LABELS[itemSource] || itemSource;
                return `
                <div class="group cursor-pointer flex items-center gap-3.5 p-3 rounded-2xl t-bg-panel border t-border-main hover:border-emerald-500/40 hover:shadow-md transition-all hover:-translate-y-0.5" 
                     onclick="window.SongListManager.openDetail('${item.id}', '${itemSource}')">
                    <div class="relative w-16 h-16 md:w-20 md:h-20 flex-shrink-0 overflow-hidden rounded-xl shadow-sm">
                        <img data-src="${item.img || '/music/assets/logo.svg'}" src="/music/assets/logo.svg" 
                             class="lazy-image w-full h-full object-cover dynamic-logo is-placeholder" 
                             onerror="this.src='/music/assets/logo.svg'; this.classList.add('is-placeholder');">
                        ${itemSource ? `<span class="absolute top-1 left-1 px-1.5 py-0.5 text-[9px] font-semibold bg-black/60 backdrop-blur-md text-white rounded shadow-sm z-10">${sourceLabel}</span>` : ''}
                        <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <div class="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow transform scale-50 group-hover:scale-100 transition-transform duration-300">
                                <i class="fas fa-play text-xs ml-0.5"></i>
                            </div>
                        </div>
                    </div>
                    <div class="flex-1 min-w-0 flex flex-col justify-center">
                        <h3 class="text-sm md:text-base font-bold t-text-main truncate group-hover:text-emerald-500 transition-colors" title="${item.name}">${item.name}</h3>
                        ${item.author ? `<p class="text-xs t-text-muted mt-1 truncate">${item.author}</p>` : ''}
                        <div class="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400 font-medium">
                            ${item.total ? `<span><i class="fas fa-music text-[10px] mr-1"></i>${item.total}首</span>` : ''}
                            ${(item.play_count || item.playCount) ? `<span><i class="fas fa-headphones text-[10px] mr-1"></i>${item.play_count || formatPlayCount(item.playCount)}</span>` : ''}
                            ${item.time ? `<span class="truncate"><i class="far fa-calendar-alt text-[10px] mr-1"></i>${item.time}</span>` : ''}
                        </div>
                    </div>
                </div>`;
            }).join('');
        } else {
            // 方块 (Grid) 模式
            container.innerHTML = currentState.list.map(item => {
                const itemSource = item.source || currentState.source;
                const sourceLabel = SOURCE_LABELS[itemSource] || itemSource;
                return `
                <div class="group cursor-pointer" onclick="window.SongListManager.openDetail('${item.id}', '${itemSource}')">
                    <div class="relative aspect-square overflow-hidden rounded-2xl shadow-md transition-all group-hover:shadow-xl group-hover:-translate-y-1">
                        <img data-src="${item.img || '/music/assets/logo.svg'}" src="/music/assets/logo.svg" 
                             class="lazy-image w-full h-full object-cover dynamic-logo is-placeholder" 
                             onerror="this.src='/music/assets/logo.svg'; this.classList.add('is-placeholder');">
                        ${itemSource ? `<span class="absolute top-2 right-2 px-2 py-0.5 text-[10px] font-medium bg-black/60 backdrop-blur-md text-white rounded-md shadow-sm z-10">${sourceLabel}</span>` : ''}
                        <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <div class="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-lg transform scale-50 group-hover:scale-100 transition-transform duration-300">
                                <i class="fas fa-play ml-1"></i>
                            </div>
                        </div>
                    </div>
                    <div class="mt-3">
                        <h3 class="text-sm font-bold t-text-main line-clamp-2 leading-snug group-hover:text-emerald-500 transition-colors" title="${item.name}">${item.name}</h3>
                        ${item.author ? `<p class="text-xs t-text-muted mt-1.5 truncate">${item.author}</p>` : ''}
                        ${item.time ? `<p class="text-[11px] text-gray-400 mt-0.5 truncate">${item.time}</p>` : ''}
                        <div class="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400 font-medium">
                            ${item.total ? `<span><i class="fas fa-music text-[10px] mr-1"></i>${item.total}</span>` : ''}
                            ${(item.play_count || item.playCount) ? `<span><i class="fas fa-headphones text-[10px] mr-1"></i>${item.play_count || formatPlayCount(item.playCount)}</span>` : ''}
                        </div>
                    </div>
                </div>`;
            }).join('');
        }

        // Trigger Lazy Load
        if (typeof window.lazyLoadImages === 'function') {
            window.lazyLoadImages();
        }
    }

    function renderSortTabs() {
        const container = document.getElementById('songlist-sort-container');
        if (!container) return;
        const options = currentState.sortList;

        if (options.length === 0) return;

        // If current sortId is not in options, reset to first option
        if (!options.some(opt => String(opt.id) === String(currentState.sortId))) {
            currentState.sortId = options[0].id;
        }

        container.innerHTML = options.map(opt => `
            <button onclick="window.SongListManager.changeSort('${opt.id}')" 
                id="sort-${opt.id}"
                class="px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 ${String(currentState.sortId) === String(opt.id) ? 'active-option' : 't-text-muted hover:t-bg-main'}">${opt.name}</button>
        `).join('');
    }

    function renderDetail() {
        const info = detailState.info;
        if (!info) return;

        const listContainer = document.getElementById('sl-detail-list');

        // Sync with global viewingPlaylist
        window.viewingPlaylist = detailState.list;

        const nameEl = document.getElementById('sl-detail-name');
        if (nameEl) {
            nameEl.innerHTML = window.createMarqueeHtml ? window.createMarqueeHtml(info.name) : info.name;
        }

        const titleEl = document.getElementById('sl-detail-title');
        if (titleEl) {
            titleEl.innerHTML = window.createMarqueeHtml ? window.createMarqueeHtml(info.name) : info.name;
        }

        if (window.setImg) window.setImg('sl-detail-cover', info.img || info.cover || '/music/assets/logo.svg');
        else document.getElementById('sl-detail-cover').src = info.img || info.cover || '/music/assets/logo.svg';

        const authorEl = document.getElementById('sl-detail-author');
        if (authorEl) {
            authorEl.innerHTML = window.createMarqueeHtml ? window.createMarqueeHtml(info.author || '', 'text-emerald-500 font-medium') : (info.author || '');
        }

        // Render stats (time, song count, play count)
        const statsHtml = [];
        const totalSongs = detailState.total || info.total || detailState.list.length;
        statsHtml.push(`<span><i class="fas fa-music text-[10px] mr-1"></i>${totalSongs} 首歌曲</span>`);

        if (info.play_count || info.playCount) {
            statsHtml.push(`<span><i class="fas fa-headphones text-[10px] mr-1"></i>${info.play_count || formatPlayCount(info.playCount)}</span>`);
        }
        if (info.time) {
            statsHtml.push(`<span><i class="far fa-calendar text-[10px] mr-1"></i>${info.time}</span>`);
        }

        const statsEl = document.getElementById('sl-detail-stats');
        if (statsEl) {
            statsEl.innerHTML = statsHtml.join('');
        }

        // Hide the original count element as we merged it into stats
        const countEl = document.getElementById('sl-detail-count');
        if (countEl) countEl.style.display = 'none';

        document.getElementById('sl-detail-subtitle').innerText = `${info.author ? info.author + ' · ' : ''}${totalSongs} 首`;

        const descEl = document.getElementById('sl-detail-desc');
        const descBtn = document.getElementById('sl-detail-desc-btn');
        descEl.innerText = info.desc || '暂无介绍';

        // Reset description styles
        descEl.classList.add('line-clamp-3', 'md:line-clamp-4');
        descEl.dataset.expanded = 'false';
        if (descBtn) {
            descBtn.innerHTML = '展开全部 <i class="fas fa-chevron-down text-[10px] ml-0.5"></i>';
            descBtn.classList.add('hidden');

            // Wait for next frame to check if text overflows
            requestAnimationFrame(() => {
                // If scrollHeight is greater than clientHeight, it means it is truncated
                if (descEl.scrollHeight > descEl.clientHeight) {
                    descBtn.classList.remove('hidden');
                }
            });
        }

        // --- Unified Search & Filtering Logic ---
        const displayList = window.ListSearch.getDisplayList(detailState.list);

        listContainer.innerHTML = displayList.map((obj, displayIdx) => {
            const song = obj.item;
            const index = obj.originalIndex;
            const isSelected = window.selectedItems.has(String(song.id));
            const isMatched = window.ListSearch.isMatched(index);
            const isCurrentMatch = window.ListSearch.isCurrentMatch(index);
            const isDisliked = Boolean(window.DislikeManager && window.DislikeManager.isDisliked(song));

            // --- Sort mode row ---
            if (sortMode) {
                return `
                <div class="sort-row grid grid-cols-12 gap-2 md:gap-4 px-3 py-2 rounded-xl hover:t-bg-panel group transition-colors items-center border border-transparent hover:border-violet-200 dark:hover:border-violet-800 bg-white/50 dark:bg-white/5 cursor-grab active:cursor-grabbing active:shadow-lg active:scale-[1.01] active:border-violet-400"
                     data-song-id="${String(song.id)}" data-sort-index="${index}">
                    <!-- Drag handle + position input -->
                    <div class="col-span-1 sm:col-span-1 text-center flex items-center justify-center gap-1">
                        <span class="sort-handle text-gray-300 hover:text-violet-400 transition-colors cursor-grab active:cursor-grabbing text-base px-0.5" title="拖动调整序号">
                            <i class="fas fa-grip-vertical"></i>
                        </span>
                        <input type="number" min="1" max="${sortWorkList.length}" value="${displayIdx + 1}"
                            class="sort-pos-input w-10 text-center text-xs font-mono border border-violet-200 dark:border-violet-700 rounded-lg py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-400 t-bg-panel t-text-main"
                            title="输入目标序号"
                            data-song-id="${String(song.id)}"
                            onkeydown="if(event.key==='Enter'){window.SongListManager.moveSongToPosition(this, this.value);this.blur();}"
                            onblur="window.SongListManager.moveSongToPosition(this, this.value)"
                            onclick="event.stopPropagation()"
                            onfocus="this.select()">
                    </div>
                    <!-- Title & Info -->
                    <div class="col-span-7 sm:col-span-5 md:col-span-4 lg:col-span-5 flex items-center gap-3 min-w-0 pr-2">
                        <div class="w-8 h-8 flex-shrink-0 rounded-lg overflow-hidden shadow-sm border t-border-main">
                            <img src="${window.getImgUrl ? window.getImgUrl(song) : (song.img || song.albumImg || '/music/assets/logo.svg')}"
                                 class="w-full h-full object-cover dynamic-logo"
                                 onerror="this.src='/music/assets/logo.svg'">
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="font-bold text-sm t-text-main truncate">${song.name}</div>
                            <div class="text-[10px] t-text-muted truncate">${song.singer || ''}</div>
                        </div>
                    </div>
                    <!-- Artist -->
                    <div class="hidden sm:flex sm:col-span-3 md:col-span-3 lg:col-span-2 items-center text-xs t-text-muted overflow-hidden min-w-0">
                        <span class="truncate">${song.singer || ''}</span>
                    </div>
                    <!-- Duration -->
                    <div class="hidden md:flex md:col-span-2 lg:col-span-1 items-center justify-center text-xs font-mono t-text-muted min-w-0 text-center">
                        ${song.interval || '--:--'}
                    </div>
                    <!-- Spacer -->
                    <div class="col-span-4 sm:col-span-1 md:col-span-2 lg:col-span-3"></div>
                </div>
                `;
            }

            let rowClass = 'grid grid-cols-12 gap-2 md:gap-4 px-3 py-2.5 rounded-xl hover:t-bg-panel group transition-colors cursor-pointer items-center border border-transparent ';
            if (isDisliked) rowClass += 'opacity-40 grayscale hover:opacity-80 transition-opacity ';
            if (isCurrentMatch) rowClass += 'search-current ';
            else if (isMatched) rowClass += 'search-match ';
            if (isSelected) rowClass += 'row-selected ring-1 ring-emerald-500/30 ';

            return `
            <div id="sl-row-${index}" class="${rowClass}" data-song-id="${String(song.id)}" 
                 onclick="window.SongListManager.handleRowClick(${index})">
                <div class="col-span-1 sm:col-span-1 text-center text-gray-400 font-mono text-xs flex items-center justify-center">
                    ${window.batchMode ? `
                        <input type="checkbox" 
                               class="batch-checkbox w-4 h-4 text-emerald-600 rounded" 
                               data-song-id="${String(song.id)}" 
                               ${isSelected ? 'checked' : ''}
                               onclick="event.stopPropagation(); handleBatchSelect('${String(song.id)}', this.checked);">
                    ` : index + 1}
                </div>
                <!-- Title & Info -->
                <div class="col-span-7 sm:col-span-5 md:col-span-4 lg:col-span-4 flex items-center gap-3 min-w-0 pr-2">
                    <div class="w-10 h-10 md:w-12 md:h-12 flex-shrink-0 relative rounded-lg overflow-hidden shadow-sm border t-border-main group-hover:shadow-md transition-all group-hover:scale-105 duration-300">
                        <img data-src="${window.getImgUrl ? window.getImgUrl(song) : (song.img || song.albumImg || '/music/assets/logo.svg')}" src="/music/assets/logo.svg"
                             class="lazy-image w-full h-full object-cover dynamic-logo is-placeholder" 
                             onerror="this.src='/music/assets/logo.svg'; this.classList.add('is-placeholder');">
                        <div class="absolute inset-0 bg-black/20 hidden group-hover:flex items-center justify-center transition-all">
                            <i class="fas fa-play text-white text-xs"></i>
                        </div>
                    </div>
                    <div class="min-w-0 flex-1 flex flex-col justify-center overflow-hidden">
                        <div class="font-bold text-sm t-text-main group-hover:text-emerald-500 transition-colors">
                            ${window.createMarqueeHtml ? window.createMarqueeHtml(song.name) : `<span class="truncate">${song.name}</span>`}
                        </div>
                        <div class="flex items-center gap-1 mt-0.5 overflow-hidden whitespace-nowrap">
                             ${window.getSourceTag ? window.getSourceTag(song.source || detailState.source) : ''}
                             ${window.getQualityTags ? window.getQualityTags(song) : ''}
                             <span class="flex-shrink-0 inline-flex items-center" data-server-badge="${window.ServerFileState ? window.ServerFileState.songKey(song) : ''}"></span>
                             <div class="md:hidden flex-1 min-w-0">
                                ${window.createMarqueeHtml ? window.createMarqueeHtml(song.singer, 'text-[10px] t-text-muted') : `<span class="text-[10px] t-text-muted truncate">${song.singer}</span>`}
                             </div>
                        </div>
                    </div>
                </div>
                <!-- Artist -->
                <div class="hidden sm:flex sm:col-span-3 md:col-span-3 lg:col-span-2 items-center text-xs md:text-sm t-text-muted overflow-hidden min-w-0">
                    ${window.createMarqueeHtml ? window.createMarqueeHtml(song.singer) : `<span class="truncate">${song.singer}</span>`}
                </div>
                <!-- Album -->
                <div class="hidden lg:flex lg:col-span-2 items-center text-xs md:text-sm t-text-muted overflow-hidden min-w-0" title="${window.getSongAlbumName ? window.getSongAlbumName(song) : (song.albumName || (typeof song.album === 'string' ? song.album : (song.album?.name || '')))}">
                    ${(() => {
                        const alb = (window.getSongAlbumName ? window.getSongAlbumName(song) : (song.albumName || (typeof song.album === 'string' ? song.album : (song.album?.name || '')))) || '-';
                        return window.createMarqueeHtml ? window.createMarqueeHtml(alb) : `<span class="truncate">${alb}</span>`;
                    })()}
                </div>
                <!-- Duration -->
                <div class="hidden md:flex md:col-span-2 lg:col-span-1 items-center justify-center text-xs md:text-sm font-mono t-text-muted min-w-0 text-center">
                    ${song.interval || '--:--'}
                </div>
                <!-- Actions -->
                <div class="col-span-4 sm:col-span-3 md:col-span-2 lg:col-span-2 flex items-center justify-end gap-0 sm:gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                    <button class="p-0.5 sm:p-1.5 hover:bg-emerald-50 rounded-lg text-emerald-600 transition-colors"
                            title="播放"
                            onclick="event.stopPropagation(); window.SongListManager.playSong(${index})">
                        <i class="fas fa-play w-3.5 h-3.5 flex items-center justify-center"></i>
                    </button>
                    <button class="p-0.5 sm:p-1.5 hover:bg-blue-50 rounded-lg text-blue-600 transition-colors"
                            title="下载"
                            onclick="event.stopPropagation(); downloadSong(${JSON.stringify(song).replace(/"/g, '&quot;')})">
                        <i class="fas fa-download w-3.5 h-3.5 flex items-center justify-center"></i>
                    </button>
                    <button class="p-0.5 sm:p-1.5 hover:bg-emerald-50 rounded-lg text-emerald-500 transition-colors"
                            title="添加到歌单"
                            onclick="event.stopPropagation(); window.SongListManager.addSongToPlaylist(${index})">
                        <i class="fas fa-plus w-3.5 h-3.5 flex items-center justify-center"></i>
                    </button>
                    <button class="p-0.5 sm:p-1.5 hover:bg-red-50 rounded-lg ${(window.DislikeManager && window.DislikeManager.isDisliked(song)) ? 'text-red-500' : 'text-gray-400'} transition-colors"
                            title="${(window.DislikeManager && window.DislikeManager.isDisliked(song)) ? '取消不喜欢' : '不喜欢'}"
                            onclick="event.stopPropagation(); window.SongListManager.dislikeSong(${index})">
                        <i class="fas fa-thumbs-down w-3.5 h-3.5 flex items-center justify-center"></i>
                    </button>
                </div>
            </div>
        `}).join('');

        // After render: init Sortable.js if sort mode is on
        if (sortMode && typeof Sortable !== 'undefined') {
            _bindSortable(listContainer);
        }

        // Trigger Lazy Load
        if (typeof window.lazyLoadImages === 'function') {
            window.lazyLoadImages();
        }
        if (typeof window.applyMarqueeChecks === 'function') {
            window.applyMarqueeChecks();
        }
        window.ServerFileState?.paintBadges(listContainer);
    }

    // --- Sortable binding (private helper) ---
    function _bindSortable(container) {
        if (sortableInstance) { sortableInstance.destroy(); sortableInstance = null; }
        sortableInstance = Sortable.create(container, {
            animation: 180,
            handle: '.sort-handle',
            ghostClass: 'sort-ghost',
            dragClass: 'sort-drag',
            onEnd: function (evt) {
                const { oldIndex, newIndex } = evt;
                if (oldIndex === newIndex) return;
                // Reorder sortWorkList
                const [moved] = sortWorkList.splice(oldIndex, 1);
                sortWorkList.splice(newIndex, 0, moved);
                // Re-render to update position inputs
                const origList = detailState.list;
                detailState.list = sortWorkList;
                renderDetail();
                detailState.list = origList;
            }
        });
    }

    function updatePaginationUI() {

        const totalPages = Math.max(1, Math.ceil((currentState.total || currentState.list.length) / currentState.limit));
        document.getElementById('songlist-page-info').innerText = `第 ${currentState.page} / ${totalPages} 页`;
        document.getElementById('btn-songlist-first').disabled = currentState.page <= 1;
        document.getElementById('btn-songlist-prev').disabled = currentState.page <= 1;
        document.getElementById('btn-songlist-next').disabled = currentState.page >= totalPages;
        document.getElementById('btn-songlist-last').disabled = currentState.page >= totalPages;
    }

    // --- Public Methods ---

    return {
        init,
        selectTag: function (id, name) {
            currentState.tagId = id;
            currentState.tagName = name;
            document.getElementById('current-tag-name').innerText = name;
            toggleTagSelector(false);
            loadList(1);
        },
        changeSource: async function () {
            currentState.source = document.getElementById('songlist-source').value;

            // 保存到缓存
            localStorage.setItem('songlist-source', currentState.source);

            currentState.tagId = '';
            currentState.tagName = '全部分类';
            document.getElementById('current-tag-name').innerText = '全部分类';
            currentState.tags = [];
            currentState.sortList = [];
            currentState.sortId = '';
            renderSortTabs();
            await loadTags();
            loadList(1);
        },
        changeSort: function (sort) {
            currentState.sortId = sort;
            renderSortTabs();
            loadList(1);
        },
        changePage: function (delta) {
            this.goToPage(currentState.page + delta);
        },
        goToPage: function (page) {
            const totalPages = Math.max(1, Math.ceil((currentState.total || currentState.list.length) / currentState.limit));
            const target = page === 'last' ? totalPages : Math.min(totalPages, Math.max(1, Number(page) || 1));
            if (target === currentState.page) return;
            loadList(target);
            document.getElementById('songlist-grid').scrollTo({ top: 0, behavior: 'smooth' });
        },
        openDetail: function (id, source) {
            if (window.ListSearch) window.ListSearch.resetState();
            loadDetail(id, source);
        },
        closeDetail: function () {
            const detailView = document.getElementById('songlist-detail-view');
            detailView.classList.add('translate-x-full');
            setTimeout(() => detailView.classList.add('hidden'), 300);
        },
        toggleTagSelector,
        playSong: function (index) {
            const song = detailState.list[index];
            if (typeof window.updatePlaylist === 'function') {
                const listWithSource = detailState.list.map(s => ({ ...s, source: detailState.source }));
                // 单曲点击：加入默认列表 (shouldAddToDefault = true)
                window.updatePlaylist(listWithSource, index, 'songlist', true);
            }
        },
        addSongToPlaylist: function (index) {
            const song = detailState.list[index];
            if (!song || typeof window.openPlaylistAddModalForSongObject !== 'function') return;
            window.openPlaylistAddModalForSongObject({
                ...song,
                source: song.source || detailState.source
            });
        },
        dislikeSong: async function (index) {
            const song = detailState.list[index];
            if (!song) return;
            const songObj = {
                ...song,
                source: song.source || detailState.source
            };
            if (typeof toggleDislikeSong === 'function') {
                await toggleDislikeSong(songObj);
                renderDetail();
            } else if (window.DislikeManager) {
                try {
                    const nowDisliked = await window.DislikeManager.toggleSong(songObj);
                    renderDetail();
                    if (typeof window.showToast === 'function') {
                        window.showToast('success', nowDisliked ? '已加入不喜欢' : '已移出不喜欢');
                    }
                } catch (e) {
                    console.error('[SongList] dislike failed:', e);
                    if (typeof window.showToast === 'function') {
                        window.showToast('error', e.message || '操作失败');
                    }
                }
            }
        },
        playAll: function () {
            if (detailState.list.length === 0) return;
            if (typeof window.updatePlaylist === 'function') {
                const listWithSource = detailState.list.map(s => ({ ...s, source: detailState.source }));
                // 播放全部：不加入默认列表 (shouldAddToDefault = false)
                window.updatePlaylist(listWithSource, 0, 'songlist', false);
                this.closeDetail();
            }
        },
        search: async function () {
            const text = document.getElementById('songlist-search-input').value.trim();
            if (!text) {
                loadList(1);
                return;
            }

            const container = document.getElementById('songlist-container');
            container.innerHTML = '<div class="col-span-full py-20 text-center t-text-muted"><i class="fas fa-spinner fa-spin text-4xl mb-4 text-emerald-500"></i><p>正在搜索歌单...</p></div>';

            try {
                if (currentState.source === 'all') {
                    const sources = ['wy', 'tx', 'kg', 'kw', 'mg'];
                    const promises = sources.map(s =>
                        fetch(`${API_BASE}/songList/search?source=${s}&text=${encodeURIComponent(text)}&page=1`)
                            .then(r => r.json())
                            .then(d => (d.list || []).map(item => ({ ...item, source: s })))
                            .catch(e => {
                                console.warn(`[SongList] ${s} search failed:`, e);
                                return [];
                            })
                    );
                    const results = await Promise.all(promises);
                    const flatList = results.flat();
                    if (typeof window.sortSearchResults === 'function') {
                        currentState.list = window.sortSearchResults(flatList, text, false);
                    } else {
                        currentState.list = flatList;
                    }
                    currentState.total = currentState.list.length;
                } else {
                    const url = `${API_BASE}/songList/search?source=${currentState.source}&text=${encodeURIComponent(text)}&page=1`;
                    const res = await fetch(url);
                    const data = await res.json();
                    currentState.list = data.list || [];
                    currentState.total = data.total || 0;
                }
                renderList();
                document.getElementById('songlist-pagination').classList.add('hidden');
            } catch (e) {
                console.error('[SongList] Search failed:', e);
                container.innerHTML = `<div class="col-span-full py-20 text-center text-red-500">搜索失败: ${e.message}</div>`;
            }
        },
        handleRowClick: function (index) {
            if (window.batchMode) {
                const song = detailState.list[index];
                const id = String(song.id);
                const isChecked = !window.selectedItems.has(id);
                window.handleBatchSelect(id, isChecked);
            } else {
                this.playSong(index);
            }
        },
        renderDetail: renderDetail,
        openExternalListModal: function () {
            toggleExternalListModal(true);
        },
        closeExternalListModal: function () {
            toggleExternalListModal(false);
        },
        handleOpenExternalList: function () {
            const source = document.getElementById('external-list-source').value;
            const input = document.getElementById('external-list-input').value.trim();
            if (!input) {
                if (window.showToast) window.showToast('info', '请输入歌单链接或 ID');
                return;
            }
            this.openDetail(input, source);
            this.closeExternalListModal();
            // Clear input for next time
            document.getElementById('external-list-input').value = '';
        },
        getCurrentDetail: function () {
            return {
                id: detailState.id,
                source: detailState.source,
                info: detailState.info,
                list: detailState.list
            };
        },
        onExternalSourceChange: function () {
            const source = document.getElementById('external-list-source').value;
            const entry = document.getElementById('tx-user-playlist-entry');
            if (source === 'tx') {
                entry.classList.remove('hidden');
            } else {
                entry.classList.add('hidden');
            }
        },
        openQQInputModal: function () {
            toggleQQInputModal(true);
        },
        closeQQInputModal: function () {
            toggleQQInputModal(false);
            document.getElementById('qq-input-field').value = '';
        },
        handleQQSubmit: async function () {
            const uid = document.getElementById('qq-input-field').value.trim();
            if (!uid) {
                if (window.showToast) window.showToast('info', '请输入 QQ 号');
                return;
            }
            this.closeQQInputModal();
            this.closeExternalListModal();

            toggleUserPlaylistModal(true);
            const container = document.getElementById('user-playlist-container');
            const title = document.getElementById('user-playlist-title');
            const subtitle = document.getElementById('user-playlist-subtitle');
            const avatarImg = document.getElementById('user-playlist-avatar');

            title.innerText = '拉取 QQ 歌单';
            subtitle.innerText = `正在拉取用户 ${uid} 的歌单...`;
            avatarImg.classList.add('hidden');
            container.innerHTML = '<div class="flex items-center justify-center py-20"><i class="fas fa-spinner fa-spin text-4xl text-emerald-500"></i></div>';

            try {
                const res = await fetch(`${API_BASE}/songList/userPlaylist?source=tx&uid=${uid}`);
                const data = await res.json();

                if (data.error) throw new Error(data.error);

                title.innerText = `${data.nickname || uid} 的歌单`;
                subtitle.innerText = `共发现 ${data.list.length} 个歌单`;

                if (data.avatar) {
                    avatarImg.src = data.avatar;
                    avatarImg.classList.remove('hidden');
                }

                if (data.list.length === 0) {
                    container.innerHTML = '<div class="text-center py-10 t-text-muted">未找到公开歌单</div>';
                    return;
                }

                container.innerHTML = data.list.map(item => `
                    <div class="flex items-center gap-4 p-3 rounded-xl hover:t-bg-main transition-all cursor-pointer group" 
                         onclick="window.SongListManager.selectUserPlaylist('${item.id}')">
                        <div class="relative flex-shrink-0">
                            <img src="${item.img || '/music/assets/logo.svg'}" class="w-12 h-12 rounded-lg object-cover shadow-sm group-hover:scale-105 transition-transform">
                        </div>
                        <div class="flex-1 min-w-0">
                            <h4 class="text-sm font-bold t-text-main truncate">${item.name}</h4>
                            <p class="text-xs t-text-muted mt-1 uppercase tracking-tighter">
                                ${item.total || 0} 首 · ${item.play_count || 0} 次播放 · <span class="text-emerald-500/80">tid:${item.id}</span>
                            </p>
                        </div>
                        <i class="fas fa-chevron-right text-gray-300 text-xs transition-transform group-hover:translate-x-1"></i>
                    </div>
                `).join('');
            } catch (e) {
                console.error('[UserPlaylist] Load failed:', e);
                container.innerHTML = `<div class="text-center py-10 text-red-500">加载失败: ${e.message}</div>`;
                subtitle.innerText = '加载失败';
            }
        },
        selectUserPlaylist: function (id) {
            this.openDetail(id, 'tx');
            this.closeUserPlaylistModal();
        },
        closeUserPlaylistModal: function () {
            toggleUserPlaylistModal(false);
        },

        // ---- Sort Mode ----
        toggleSortMode: function (force) {
            const enter = force !== undefined ? !!force : !sortMode;

            // Can only sort if viewing a local user list
            if (enter) {
                const listId = typeof getCurrentActiveListId === 'function' ? getCurrentActiveListId() : null;
                if (!listId) {
                    if (window.showToast) window.showToast('info', '请在我的收藏中打开一个歌单再使用排序功能');
                    return;
                }
                // Disable during batch mode
                if (window.batchMode) {
                    if (window.showToast) window.showToast('info', '请先退出批量模式');
                    return;
                }
            }

            sortMode = enter;
            // Init working copy from current displayed list
            if (enter) {
                sortWorkList = [...detailState.list];
            } else {
                // Destroy sortable
                if (sortableInstance) { sortableInstance.destroy(); sortableInstance = null; }
                sortWorkList = [];
            }

            // Toggle toolbar
            const toolbar = document.getElementById('sl-sort-toolbar');
            const hashBtn = document.getElementById('sl-sort-hash-btn');
            if (toolbar) toolbar.classList.toggle('hidden', !enter);
            if (hashBtn) {
                if (enter) {
                    hashBtn.classList.add('text-violet-500', 'font-bold');
                    hashBtn.classList.remove('text-gray-400');
                } else {
                    hashBtn.classList.remove('text-violet-500', 'font-bold');
                    hashBtn.classList.add('text-gray-400');
                }
            }

            // Hide other toolbars when entering sort mode
            if (enter) {
                const batchToolbar = document.getElementById('sl-batch-toolbar');
                if (batchToolbar) batchToolbar.classList.add('hidden');
                const searchBar = document.getElementById('sl-local-search-bar');
                if (searchBar) searchBar.classList.add('hidden');
            }

            // Re-render list in sort/normal mode
            // Temporarily swap detailState.list to sortWorkList for render
            const origList = detailState.list;
            if (enter) detailState.list = sortWorkList;
            renderDetail();
            if (enter) detailState.list = origList;
        },

        moveSongToPosition: function (inputEl, rawValue) {
            const targetPos = parseInt(rawValue, 10);
            if (isNaN(targetPos)) return;
            const songId = inputEl.dataset.songId;
            const clampedPos = Math.max(1, Math.min(sortWorkList.length, targetPos));

            const fromIdx = sortWorkList.findIndex(s => String(s.id) === songId);
            if (fromIdx === -1) return;

            const [removed] = sortWorkList.splice(fromIdx, 1);
            sortWorkList.splice(clampedPos - 1, 0, removed);

            // Re-render sort list
            const origList = detailState.list;
            detailState.list = sortWorkList;
            renderDetail();
            detailState.list = origList;

            // Scroll moved item into view
            requestAnimationFrame(() => {
                const listContainer = document.getElementById('sl-detail-list');
                const rows = listContainer ? listContainer.querySelectorAll('.sort-row') : [];
                const targetRow = rows[clampedPos - 1];
                if (targetRow) targetRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            });
        },

        saveSortOrder: async function () {
            const listId = typeof getCurrentActiveListId === 'function' ? getCurrentActiveListId() : null;
            if (!listId || sortWorkList.length === 0) {
                if (window.showToast) window.showToast('info', '无法确定当前歌单');
                return;
            }

            const saveBtn = document.getElementById('sl-sort-save-btn');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span class="hidden sm:inline">保存中...</span>'; }

            try {
                const authHeaders = typeof getUserAuthHeaders === 'function' ? getUserAuthHeaders() : {};
                const orderedSongIds = sortWorkList.map(s => String(s.id));

                const send = () => fetch('/api/music/user/list/reorder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...authHeaders },
                    body: JSON.stringify({ listId, orderedSongIds })
                });

                let res = await send();
                if (res.status === 401 && typeof ensureUserAuthToken === 'function') {
                    const refreshed = await ensureUserAuthToken({ force: true });
                    if (refreshed) res = await send();
                }

                if (!res.ok) {
                    const errText = await res.text();
                    throw new Error(errText || '保存失败');
                }

                // Apply new order to detailState.list
                detailState.list = [...sortWorkList];
                window.viewingPlaylist = detailState.list;

                if (window.showToast) window.showToast('success', '排序已保存');

                // Reload sidebar counts
                if (typeof renderMyLists === 'function' && typeof currentListData !== 'undefined' && currentListData) {
                    const data = await window.SyncManager.sync().catch(() => null);
                    if (data) {
                        currentListData = data;
                        renderMyLists(data);
                    }
                }

                // Exit sort mode
                this.toggleSortMode(false);

            } catch (e) {
                console.error('[SortOrder] Save failed:', e);
                if (window.showToast) window.showToast('error', '保存失败: ' + e.message);
            } finally {
                if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i><span class="hidden sm:inline">保存排序</span>'; }
            }
        },
        toggleViewMode,
        getViewMode: function () {
            return currentState.viewMode;
        }
    };
})();

// Global proxies for HTML onclick attributes
function toggleTagSelector() { window.SongListManager.toggleTagSelector(); }
function changeSongListSource() { window.SongListManager.changeSource(); }
function changeSongListSort(sort) { window.SongListManager.changeSort(sort); }
function changeSongListPage(delta) { window.SongListManager.changePage(delta); }
function toggleSongListViewMode() { window.SongListManager.toggleViewMode(); }

function closeSongListDetail() { window.SongListManager.closeDetail(); }
function playAllInSongList() { window.SongListManager.playAll(); }
function handleSongListSearchKeyPress(e) { if (e.key === 'Enter') window.SongListManager.search(); }
function openExternalListModal() { window.SongListManager.openExternalListModal(); }
function closeExternalListModal() { window.SongListManager.closeExternalListModal(); }
function handleOpenExternalList() { window.SongListManager.handleOpenExternalList(); }
function onExternalSourceChange() { window.SongListManager.onExternalSourceChange(); }
function openQQInputModal() { window.SongListManager.openQQInputModal(); }
function closeQQInputModal() { window.SongListManager.closeQQInputModal(); }
function handleQQSubmit() { window.SongListManager.handleQQSubmit(); }
function closeUserPlaylistModal() { window.SongListManager.closeUserPlaylistModal(); }

function toggleSongListDesc() {
    const descEl = document.getElementById('sl-detail-desc');
    const descBtn = document.getElementById('sl-detail-desc-btn');
    if (!descEl || !descBtn) return;

    const isExpanded = descEl.dataset.expanded === 'true';
    if (isExpanded) {
        descEl.classList.add('line-clamp-3', 'md:line-clamp-4');
        descEl.dataset.expanded = 'false';
        descBtn.innerHTML = '展开全部 <i class="fas fa-chevron-down text-[10px] ml-0.5"></i>';
    } else {
        descEl.classList.remove('line-clamp-3', 'md:line-clamp-4');
        descEl.dataset.expanded = 'true';
        descBtn.innerHTML = '收起 <i class="fas fa-chevron-up text-[10px] ml-0.5"></i>';
    }
}

// Helper for formatting large numbers
function formatPlayCount(count) {
    if (!count) return '0';
    if (count > 100000000) return (count / 100000000).toFixed(1) + '亿';
    if (count > 10000) return (count / 10000).toFixed(1) + '万';
    return count;
}

/**
 * Toggle the visibility of the song list detail header (cover, description, etc.)
 * to allow more space for the song list itself.
 */
function toggleSlDetailHeader() {
    const header = document.getElementById('sl-detail-header');
    const icon = document.getElementById('sl-detail-collapse-icon');
    if (!header || !icon) return;

    const isCollapsed = header.classList.contains('is-collapsed');

    if (isCollapsed) {
        // Restore
        header.classList.remove('is-collapsed', 'max-h-0', 'opacity-0', 'py-0', 'border-b-0', 'pointer-events-none');
        header.classList.add('max-h-[1000px]', 'p-4', 'md:p-6', 'border-b');
        icon.style.transform = 'rotate(0deg)';
    } else {
        // Collapse
        header.classList.remove('max-h-[1000px]', 'p-4', 'md:p-6', 'border-b');
        header.classList.add('is-collapsed', 'max-h-0', 'opacity-0', 'py-0', 'border-b-0', 'pointer-events-none');
        icon.style.transform = 'rotate(180deg)';
    }
}
