/**
 * CustomDirManager (用户自定义音乐目录管理器)
 * 独立于本地音乐的 cache/music 目录，专门读取和呈现用户自定义目录 (customMusicDir) 下的 custom_index.json
 */

window.CustomDirManager = {
    originalData: [],
    displayData: [],
    currentPage: 1,
    pageSize: 60,
    batchMode: false,
    selectedItems: new Set(),
    searchKeyword: '',
    quickSearchKeyword: '',
    filterQuality: new Set(),
    filterSource: new Set(),
    filterStatus: new Set(),
    sortBy: 'mtime',
    sortOrder: 'desc',
    isActive: false,
    listEventsBound: false,
    coverRenderTimer: null,
    enableReMapping: false,

    // 目录树筛选状态
    dirFilterAll: true,
    selectedDirPaths: new Set(),
    pendingDirFilterAll: true,
    pendingDirPaths: new Set(),
    cacheKey: 'lx_custom_dir_filters',

    // 同步标签按钮的激活状态
    _syncTagUI(containerId, filterSet) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.querySelectorAll('[data-filter-value]').forEach(btn => {
            const val = btn.dataset.filterValue;
            if (filterSet && filterSet.has(val)) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    },

    // 切换某个筛选标签的选中状态
    toggleFilterTag(filterKey, value) {
        const setMap = {
            quality: 'filterQuality',
            source: 'filterSource',
            status: 'filterStatus'
        };
        const tagContainerMap = {
            quality: 'lm-quality-tags',
            source: 'lm-source-tags',
            status: 'lm-status-tags'
        };
        const prop = setMap[filterKey];
        if (!prop) return;
        if (!this[prop]) this[prop] = new Set();
        const set = this[prop];
        if (set.has(value)) {
            set.delete(value);
        } else {
            set.add(value);
        }
        this._syncTagUI(tagContainerMap[filterKey], set);
        this.applyFilters();
    },

    // 保存筛选状态到 localStorage
    saveFilters() {
        try {
            const filters = {
                searchKeyword: this.searchKeyword || '',
                quickSearchKeyword: this.quickSearchKeyword || '',
                filterQuality: Array.from(this.filterQuality || []),
                filterSource: Array.from(this.filterSource || []),
                filterStatus: Array.from(this.filterStatus || []),
                sortBy: this.sortBy || 'mtime',
                sortOrder: this.sortOrder || 'desc',
                dirFilterAll: this.dirFilterAll !== false,
                selectedDirPaths: Array.from(this.selectedDirPaths || [])
            };
            localStorage.setItem(this.cacheKey, JSON.stringify(filters));
        } catch (e) {
            console.warn('[CustomDir] Failed to save filters:', e);
        }
    },

    // 从 localStorage 加载筛选状态
    loadFilters() {
        try {
            const raw = localStorage.getItem(this.cacheKey);
            const toSet = (v) => {
                if (!v || v === 'all') return new Set();
                if (Array.isArray(v)) return new Set(v);
                return new Set([v]);
            };

            if (raw) {
                const filters = JSON.parse(raw);
                this.searchKeyword = filters.searchKeyword || '';
                this.quickSearchKeyword = filters.quickSearchKeyword || '';
                this.filterQuality = toSet(filters.filterQuality);
                this.filterSource = toSet(filters.filterSource);
                this.filterStatus = toSet(filters.filterStatus);
                this.sortBy = filters.sortBy || 'mtime';
                this.sortOrder = filters.sortOrder || 'desc';
                this.dirFilterAll = filters.dirFilterAll !== false;
                this.selectedDirPaths = new Set(Array.isArray(filters.selectedDirPaths) ? filters.selectedDirPaths : []);
                this.pendingDirFilterAll = this.dirFilterAll;
                this.pendingDirPaths = new Set(this.selectedDirPaths);

                // 同步输入框与下拉选择框
                const si = document.getElementById('lm-search-input');
                if (si) {
                    if (window.LocalMusicManager && typeof window.LocalMusicManager.setRichInputValue === 'function') {
                        window.LocalMusicManager.setRichInputValue(si, this.searchKeyword);
                    } else {
                        si.value = this.searchKeyword;
                        si.innerText = this.searchKeyword;
                    }
                }
                const qs = document.getElementById('lm-quick-search');
                if (qs) {
                    if (window.LocalMusicManager && typeof window.LocalMusicManager.setRichInputValue === 'function') {
                        window.LocalMusicManager.setRichInputValue(qs, this.quickSearchKeyword);
                    } else {
                        qs.value = this.quickSearchKeyword;
                        qs.innerText = this.quickSearchKeyword;
                    }
                }
                const sortBy = document.getElementById('lm-sort-by');
                if (sortBy) sortBy.value = this.sortBy;
                const sortOrder = document.getElementById('lm-sort-order');
                if (sortOrder) sortOrder.value = this.sortOrder;

                // 同步标签按钮 UI
                this._syncTagUI('lm-quality-tags', this.filterQuality);
                this._syncTagUI('lm-source-tags', this.filterSource);
                this._syncTagUI('lm-status-tags', this.filterStatus);

                this.updateDirFilterButtonText();
            } else {
                this.filterQuality = new Set();
                this.filterSource = new Set();
                this.filterStatus = new Set();
                this._syncTagUI('lm-quality-tags', this.filterQuality);
                this._syncTagUI('lm-source-tags', this.filterSource);
                this._syncTagUI('lm-status-tags', this.filterStatus);
            }
        } catch (e) {
            console.warn('[CustomDir] Failed to load filters:', e);
        }
    },

    resetFilters(apply = true) {
        this.searchKeyword = '';
        this.quickSearchKeyword = '';
        this.filterQuality = new Set();
        this.filterSource = new Set();
        this.filterStatus = new Set();
        this.sortBy = 'mtime';
        this.sortOrder = 'desc';
        this.dirFilterAll = true;
        this.selectedDirPaths = new Set();
        this.pendingDirFilterAll = true;
        this.pendingDirPaths = new Set();

        const si = document.getElementById('lm-search-input');
        if (si) {
            if (window.LocalMusicManager && typeof window.LocalMusicManager.setRichInputValue === 'function') {
                window.LocalMusicManager.setRichInputValue(si, '');
                window.LocalMusicManager.updateSearchInputErrorState(si, '');
            } else {
                si.value = '';
                si.innerText = '';
            }
        }
        const qs = document.getElementById('lm-quick-search');
        if (qs) {
            if (window.LocalMusicManager && typeof window.LocalMusicManager.setRichInputValue === 'function') {
                window.LocalMusicManager.setRichInputValue(qs, '');
                window.LocalMusicManager.updateSearchInputErrorState(qs, '');
            } else {
                qs.value = '';
                qs.innerText = '';
            }
        }
        const sortBy = document.getElementById('lm-sort-by');
        if (sortBy) sortBy.value = 'mtime';
        const sortOrder = document.getElementById('lm-sort-order');
        if (sortOrder) sortOrder.value = 'desc';

        this._syncTagUI('lm-quality-tags', this.filterQuality);
        this._syncTagUI('lm-source-tags', this.filterSource);
        this._syncTagUI('lm-status-tags', this.filterStatus);

        this.updateDirFilterButtonText();
        localStorage.removeItem(this.cacheKey);
        const activeDot = document.getElementById('lm-filter-active-dot');
        if (activeDot) activeDot.classList.add('hidden');
        if (apply) this.applyFilters();
    },

    clearFilters() {
        this.resetFilters();
    },

    escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        })[ch]);
    },

    escapeAttr(value) {
        return this.escapeHtml(value);
    },

    getCurrentUsername() {
        return (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || 'admin';
    },

    getAuthHeaders() {
        return window.getUserAuthHeaders ? window.getUserAuthHeaders() : {};
    },

    // 模式切换：进入或退出自定义目录视图
    setActive(active) {
        this.isActive = !!active;
        localStorage.setItem('lx_custom_dir_active', this.isActive ? 'true' : 'false');
        if (window.LocalMusicManager) {
            window.LocalMusicManager.isCustomDirMode = this.isActive;
        }

        // 1. 切换 Tab 导航与页面主标题
        const tabTextEl = document.querySelector('#tab-localmusic span.font-medium');
        if (tabTextEl) {
            tabTextEl.textContent = this.isActive ? '自定义目录' : '本地音乐';
        }
        const pageTitleEl = document.querySelector('#view-localmusic h2');
        if (pageTitleEl) {
            pageTitleEl.textContent = this.isActive ? '自定义目录' : '本地音乐';
        }
        const headerPageTitleEl = document.getElementById('page-title');
        const localViewEl = document.getElementById('view-localmusic');
        if (headerPageTitleEl && localViewEl && !localViewEl.classList.contains('hidden')) {
            headerPageTitleEl.textContent = this.isActive ? '自定义目录' : '本地音乐';
        }

        // 2. 隐藏/显示位置选框（根目录/数据目录）
        const locationSelect = document.getElementById('lm-location-select');
        const locationContainer = document.getElementById('lm-location-container')
            || (locationSelect ? locationSelect.closest('[id="lm-location-container"]') || locationSelect.parentElement : null);
        if (locationContainer) {
            if (this.isActive) {
                locationContainer.classList.add('hidden');
                locationContainer.classList.remove('flex');
            } else {
                locationContainer.classList.remove('hidden');
                locationContainer.classList.add('flex');
            }
        }

        // 3. 隐藏/显示分类子目录按钮
        const subpathBtn = document.getElementById('lm-subpath-btn');
        if (subpathBtn) {
            subpathBtn.style.display = this.isActive ? 'none' : '';
        }

        // 3.1 切换高级筛选面板中的【位置】与【目录】筛选
        const folderContainer = document.getElementById('lm-folder-select-container');
        const dirContainer = document.getElementById('cd-dir-filter-container');
        if (folderContainer) {
            folderContainer.classList.toggle('hidden', this.isActive);
            folderContainer.classList.toggle('flex', !this.isActive);
        }
        if (dirContainer) {
            dirContainer.classList.toggle('hidden', !this.isActive);
            dirContainer.classList.toggle('flex', this.isActive);
        }
        this.updateDirFilterButtonText();
        this.syncSidePanel();

        // 4. 同步批量操作栏按钮（移动、同步、歌词、元信息及批量删除按钮受控）
        this.syncBatchButtonsVisibility();

        // 5. 隐藏/显示公开歌曲切换按钮 (自定义目录专属个人，无公开歌曲模式)
        const publicSongsBtn = document.getElementById('lm-public-songs-btn');
        if (publicSongsBtn) {
            publicSongsBtn.style.display = this.isActive ? 'none' : '';
        }

        // 6. 洗版按钮：自定义目录下仅在用户开启 allowOperateCustomMusicDir 且系统开启洗版时显示
        if (window.LocalMusicManager && typeof window.LocalMusicManager.syncRemasterVisibility === 'function') {
            window.LocalMusicManager.syncRemasterVisibility();
        } else {
            const canRemaster = !this.isActive || (!!window.settings?.enableRemaster && !!window.userAllowOperateCustomDir);
            const remasterBtn = document.getElementById('lm-remaster-btn');
            const remasterBtnMobile = document.getElementById('lm-remaster-btn-mobile');
            if (remasterBtn) remasterBtn.style.display = canRemaster ? '' : 'none';
            if (remasterBtnMobile) remasterBtnMobile.style.display = canRemaster ? '' : 'none';
        }

        // 7. 手动关联按钮：需要 userAllowWriteCustomDir 权限
        const canWrite = !this.isActive || !!window.userAllowWriteCustomDir;
        const remapBtn = document.getElementById('lm-remap-toggle-btn');
        const remapBtnMobile = document.getElementById('lm-remap-toggle-btn-mobile');
        if (remapBtn) remapBtn.style.display = canWrite ? '' : 'none';
        if (remapBtnMobile) remapBtnMobile.style.display = canWrite ? '' : 'none';

        // 8. 切换模式时，清空洗版选择与洗版模态框状态，防止旧列表残留或串音
        if (window.LocalMusicManager) {
            window.LocalMusicManager.remasterSelectedItems.clear();
            window.LocalMusicManager.remasterSearchKeyword = '';
            window.LocalMusicManager.remasterSelectionPage = 1;
            // 同步洗版数据源到新模式（外部 toggle 切换时跟随）
            const canUseCustom = this.isActive && !!window.userAllowOperateCustomDir;
            window.LocalMusicManager.remasterSource = canUseCustom ? 'custom' : 'local';
            const remasterModal = document.getElementById('lm-remaster-modal');
            if (remasterModal && remasterModal.classList.contains('flex')) {
                if (typeof window.LocalMusicManager.syncRemasterSourceUI === 'function') {
                    window.LocalMusicManager.syncRemasterSourceUI();
                }
                window.LocalMusicManager.renderRemasterSelection();
            }
        }

        // 9. 如果开启，则拉取自定义目录数据；否则让 LocalMusicManager 接管恢复
        if (this.isActive) {
            this.bindEvents();
            this.loadFilters();
            this.fetchData();
        } else {
            if (window.LocalMusicManager) {
                if (typeof window.LocalMusicManager.loadFilters === 'function') {
                    window.LocalMusicManager.loadFilters();
                }
                if (typeof window.LocalMusicManager.fetchData === 'function') {
                    window.LocalMusicManager.fetchData();
                }
            }
        }

        // 10. 更新同步下载按钮可见性（模式切换后需重新判断）
        if (typeof window.updateSyncDownloadBtnVisibility === 'function') {
            window.updateSyncDownloadBtnVisibility();
        }
    },

    syncBatchButtonsVisibility() {
        // 1. 批量删除按钮：自定义目录下严格取决于 userAllowOperateCustomDir
        const canDelete = !this.isActive || !!window.userAllowOperateCustomDir;
        const batchDeleteBtn = document.getElementById('lm-batch-delete-btn') || document.querySelector('button[onclick*="batchDelete"]');
        if (batchDeleteBtn) {
            batchDeleteBtn.style.display = canDelete ? '' : 'none';
        }

        // 2. 仅隐藏移动目录与云端同步（及分类按钮）
        const moveBtn = document.getElementById('lm-batch-move-btn') || document.querySelector('button[onclick*="batchSwitchFolder"]');
        const syncBtn = document.getElementById('lm-batch-sync-btn') || document.querySelector('button[onclick*="batchSwitchBaseLocation"]');
        const catBtn = document.getElementById('lm-batch-categorize-btn');
        if (moveBtn) moveBtn.style.display = this.isActive ? 'none' : '';
        if (syncBtn) syncBtn.style.display = this.isActive ? 'none' : '';
        if (catBtn) catBtn.style.display = this.isActive ? 'none' : '';

        // 3. 始终保留的批量功能按钮（加入歌单、保存）
        const alwaysShowActions = [
            'batchAddToPlaylist',
            'batchDownloadToDevice'
        ];
        alwaysShowActions.forEach(action => {
            const btn = document.querySelector(`button[onclick*="${action}"]`);
            if (btn) btn.style.display = '';
        });

        // 4. 需要 userAllowWriteCustomDir 权限的写操作按钮
        const canWrite = !this.isActive || !!window.userAllowWriteCustomDir;
        const writeActions = [
            'batchFetchLyrics',
            'batchEmbedLyric',
            'batchUpdateMetadata'
        ];
        writeActions.forEach(action => {
            const btn = document.querySelector(`button[onclick*="${action}"]`);
            if (btn) btn.style.display = canWrite ? '' : 'none';
        });
    },

    getSelectedEntries() {
        return this.originalData.filter(item => this.selectedItems.has(item.filename));
    },

    getSelectedFilenames() {
        return Array.from(this.selectedItems);
    },

    bindEvents() {
        if (this.listEventsBound) return;
        const container = document.getElementById('lm-list-container');
        if (!container) return;
        this.listEventsBound = true;

        container.addEventListener('click', (event) => {
            if (!this.isActive) return;
            const target = event.target.closest('[data-lm-action]');
            if (!target || !container.contains(target)) return;
            const index = parseInt(target.dataset.lmIndex || '', 10);
            switch (target.dataset.lmAction) {
                case 'play':
                    this.playItem(index);
                    break;
                case 'download':
                    this.downloadSingle(index);
                    break;
                case 'playlist':
                    this.addItemToPlaylist(index);
                    break;
                case 'delete':
                    this.deleteSingle(index);
                    break;
                case 'manual':
                    this.openManualIndexModal(index);
                    break;
            }
        });

        container.addEventListener('change', (event) => {
            if (!this.isActive) return;
            const target = event.target;
            if (!target.matches('[data-lm-action="select"]')) return;
            this.toggleSelect(parseInt(target.dataset.lmIndex || '', 10), target.checked);
        });

        // 绑定刷新按钮
        const refreshBtn = document.querySelector('button[title="同步并刷新"]');
        if (refreshBtn && !refreshBtn.dataset.customDirBound) {
            refreshBtn.dataset.customDirBound = 'true';
            const origClick = refreshBtn.onclick;
            refreshBtn.onclick = (e) => {
                if (this.isActive) {
                    this.refresh();
                } else if (typeof origClick === 'function') {
                    origClick.call(refreshBtn, e);
                } else if (window.LocalMusicManager && typeof window.LocalMusicManager.refresh === 'function') {
                    window.LocalMusicManager.refresh();
                }
            };
        }

        // 绑定重映射(手动关联)高亮按钮
        const remapBtn = document.getElementById('lm-remap-toggle-btn');
        if (remapBtn && !remapBtn.dataset.customDirBound) {
            remapBtn.dataset.customDirBound = 'true';
            const origRemap = remapBtn.onclick;
            remapBtn.onclick = (e) => {
                if (this.isActive) {
                    this.toggleReMapping();
                } else if (typeof origRemap === 'function') {
                    origRemap.call(remapBtn, e);
                }
            };
        }

        // 绑定分页按钮
        const first = document.getElementById('lm-page-first');
        const prev = document.getElementById('lm-page-prev');
        const next = document.getElementById('lm-page-next');
        const last = document.getElementById('lm-page-last');
        if (first && !first.dataset.cdBound) {
            first.dataset.cdBound = 'true';
            first.addEventListener('click', () => { if (this.isActive) this.goToPage(1); });
        }
        if (prev && !prev.dataset.cdBound) {
            prev.dataset.cdBound = 'true';
            prev.addEventListener('click', () => { if (this.isActive) this.changePage(-1); });
        }
        if (next && !next.dataset.cdBound) {
            next.dataset.cdBound = 'true';
            next.addEventListener('click', () => { if (this.isActive) this.changePage(1); });
        }
        if (last && !last.dataset.cdBound) {
            last.dataset.cdBound = 'true';
            last.addEventListener('click', () => { if (this.isActive) this.goToPage('last'); });
        }
    },

    toggleReMapping() {
        this.enableReMapping = !this.enableReMapping;
        const desktopBtn = document.getElementById('lm-remap-toggle-btn');
        const mobileBtn = document.getElementById('lm-remap-toggle-btn-mobile');
        const updateBtnStyle = (btn) => {
            if (!btn) return;
            if (this.enableReMapping) {
                btn.classList.remove('bg-gray-100', 'dark:bg-gray-700/50');
                btn.classList.add('bg-emerald-500', 'text-white');
            } else {
                btn.classList.remove('bg-emerald-500', 'text-white');
                btn.classList.add('bg-gray-100', 'dark:bg-gray-700/50');
            }
        };
        updateBtnStyle(desktopBtn);
        updateBtnStyle(mobileBtn);
        this.render();
    },

    async fetchData(silent = false) {
        if (!silent) {
            const container = document.getElementById('lm-list-container');
            if (container) {
                container.innerHTML = `
                    <div class="text-center py-20 text-gray-500 animate-fade-in">
                        <i class="fas fa-circle-notch fa-spin text-4xl mb-4 text-emerald-500"></i>
                        <p class="font-bold tracking-wider">正在加载自定义目录音乐...</p>
                    </div>`;
            }
        }

        try {
            const res = await fetch('/api/music/custom/list', {
                headers: this.getAuthHeaders(),
                cache: 'no-store'
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.message || `请求失败 (${res.status})`);
            }

            const result = await res.json();
            if (result.success) {
                if (result.allowOperateCustomMusicDir !== undefined) {
                    window.userAllowOperateCustomDir = !!result.allowOperateCustomMusicDir;
                }
                if (result.allowWriteCustomMusicDir !== undefined) {
                    window.userAllowWriteCustomDir = !!result.allowWriteCustomMusicDir;
                }

                this.syncBatchButtonsVisibility();
                if (window.LocalMusicManager && typeof window.LocalMusicManager.syncRemasterVisibility === 'function') {
                    window.LocalMusicManager.syncRemasterVisibility();
                }

                this.originalData = result.data || [];
                this.originalData.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
                this.applyFilters();
            } else {
                throw new Error(result.message || '加载自定义目录失败');
            }
        } catch (err) {
            if (typeof showError === 'function') showError(err.message || '获取自定义目录歌曲失败');
            console.error('[CustomDir] Fetch Error:', err);
            const container = document.getElementById('lm-list-container');
            if (container) {
                container.innerHTML = `
                    <div class="text-center py-20 text-gray-500 animate-fade-in">
                        <i class="fas fa-folder-open text-4xl mb-4 text-amber-500/80"></i>
                        <p class="font-bold tracking-wider text-base t-text-main mb-1">${this.escapeHtml(err.message || '无法访问自定义目录')}</p>
                        <p class="text-xs t-text-muted">请检查后端该用户的 customMusicDir 配置及目录权限</p>
                    </div>`;
            }
        }
    },

    async refresh() {
        const btn = document.querySelector('button[title="同步并刷新"] i');
        if (btn) btn.classList.add('fa-spin');

        try {
            if (typeof showInfo === 'function') showInfo('正在同步自定义目录...');
            const res = await fetch('/api/music/custom/sync', {
                method: 'POST',
                headers: this.getAuthHeaders()
            });
            const result = await res.json();
            if (result.success) {
                if (typeof showInfo === 'function') showInfo('自定义目录同步完成');
            } else {
                if (typeof showError === 'function') showError(result.message || '同步失败');
            }
        } catch (e) {
            console.error('[CustomDir] Sync error:', e);
            if (typeof showError === 'function') showError('同步自定义目录失败');
        }

        await this.fetchData();
        if (btn) btn.classList.remove('fa-spin');
    },

    applyFilters() {
        let current = this.originalData;
        this.currentPage = 1;

        // 关键词过滤（高级筛选面板关键词）
        const searchInput = document.getElementById('lm-search-input');
        if (searchInput) {
            const rawVal = (window.LocalMusicManager && typeof window.LocalMusicManager.getRichInputValue === 'function')
                ? window.LocalMusicManager.getRichInputValue(searchInput)
                : (searchInput.value || searchInput.innerText || '');
            this.searchKeyword = rawVal.trim().toLowerCase();
        }

        // 快速搜索关键词
        const quickInput = document.getElementById('lm-quick-search');
        if (quickInput) {
            const rawQuick = (window.LocalMusicManager && typeof window.LocalMusicManager.getRichInputValue === 'function')
                ? window.LocalMusicManager.getRichInputValue(quickInput)
                : (quickInput.value || quickInput.innerText || '');
            this.quickSearchKeyword = rawQuick.trim().toLowerCase();
        }

        const createMatcher = (keyword) => {
            if (!keyword) return () => true;
            if (window.LocalMusicManager && typeof window.LocalMusicManager.createSearchMatcher === 'function') {
                return window.LocalMusicManager.createSearchMatcher(keyword);
            }
            return (values) => values.some(v => v.includes(keyword));
        };

        const searchMatcher = createMatcher(this.searchKeyword);
        const quickSearchMatcher = createMatcher(this.quickSearchKeyword);

        if (this.searchKeyword || this.quickSearchKeyword) {
            current = current.filter(item => {
                const values = [
                    item.name || '',
                    item.singer || '',
                    item.album || '',
                    item.filename || '',
                    item.subPath || ''
                ];
                return searchMatcher(values) && quickSearchMatcher(values);
            });
        }

        // 音质过滤（多选）
        if (this.filterQuality && this.filterQuality.size > 0) {
            current = current.filter(item => this.filterQuality.has(item.quality));
        }

        // 来源过滤（多选）
        if (this.filterSource && this.filterSource.size > 0) {
            current = current.filter(item => {
                const displayedSource = item.downloadSource || item.source;
                return this.filterSource.has(displayedSource);
            });
        }

        // 状态过滤（多选：命中任一状态条件即保留）
        if (this.filterStatus && this.filterStatus.size > 0) {
            current = current.filter(item => {
                const isUnindexed = item.source === 'unknown' || item.source === 'local' || (item.songmid && String(item.songmid).includes(' - '));
                const isNoTag = (n) => !n || n === '未知歌曲' || n === '未知歌手' || n.toLowerCase() === 'unknown';
                const missingID3 = isNoTag(item.name) || isNoTag(item.singer) || isUnindexed;
                const missingCover = !item.hasCover;
                const missingLyric = !item.hasLyric && !item.lyricFilename;
                const missingEmbedLyric = !item.hasEmbedLyric;

                const statusMap = {
                    'unindexed': isUnindexed,
                    'missing_id3': missingID3,
                    'missing_cover': missingCover,
                    'missing_lyric': missingLyric,
                    'missing_lyric_file': missingLyric,
                    'missing_embed_lyric': missingEmbedLyric,
                };
                return Array.from(this.filterStatus).some(s => statusMap[s]);
            });
        }

        // 目录层级过滤（dirFilterAll 为 true 时不限制；否则严格匹配选中的目录或其子目录）
        if (!this.dirFilterAll && this.selectedDirPaths && this.selectedDirPaths.size > 0) {
            current = current.filter(item => {
                const itemSubPath = (item.subPath || '').trim();
                for (const selDir of this.selectedDirPaths) {
                    // “/”代表仅根目录，不能包含其下的子目录。
                    if (selDir === '/') {
                        if (!itemSubPath) return true;
                        continue;
                    }
                    if (itemSubPath === selDir || itemSubPath.startsWith(selDir + '/')) {
                        return true;
                    }
                }
                return false;
            });
        }

        // 更新筛选面板活跃小红点指示器
        const hasActiveFilter = (this.searchKeyword && this.searchKeyword.length > 0)
            || (this.filterQuality && this.filterQuality.size > 0)
            || (this.filterSource && this.filterSource.size > 0)
            || (this.filterStatus && this.filterStatus.size > 0)
            || (!this.dirFilterAll && this.selectedDirPaths && this.selectedDirPaths.size > 0);
        const activeDot = document.getElementById('lm-filter-active-dot');
        if (activeDot) {
            if (hasActiveFilter) {
                activeDot.classList.remove('hidden');
            } else {
                activeDot.classList.add('hidden');
            }
        }

        // 排序
        const sortBySelect = document.getElementById('lm-sort-by');
        if (sortBySelect) this.sortBy = sortBySelect.value || 'mtime';
        const sortOrderSelect = document.getElementById('lm-sort-order');
        if (sortOrderSelect) this.sortOrder = sortOrderSelect.value || 'desc';

        current.sort((a, b) => {
            let valA, valB;
            switch (this.sortBy) {
                case 'name':
                    valA = (a.name || a.filename || '').toLowerCase();
                    valB = (b.name || b.filename || '').toLowerCase();
                    break;
                case 'singer':
                    valA = (a.singer || '').toLowerCase();
                    valB = (b.singer || '').toLowerCase();
                    break;
                case 'album':
                    valA = (a.album || '').toLowerCase();
                    valB = (b.album || '').toLowerCase();
                    break;
                case 'size':
                    valA = a.size || 0;
                    valB = b.size || 0;
                    break;
                case 'mtime':
                default:
                    valA = a.mtime || 0;
                    valB = b.mtime || 0;
                    break;
            }

            if (valA < valB) return this.sortOrder === 'asc' ? -1 : 1;
            if (valA > valB) return this.sortOrder === 'asc' ? 1 : -1;
            return 0;
        });

        this.displayData = current;

        // 保存筛选状态到 localStorage
        this.saveFilters();

        // 更新总数显示
        const countEl = document.getElementById('lm-total-count');
        if (countEl) countEl.innerText = `共 ${current.length} 首 (自定义目录)`;

        this.updateBatchUI();
        this.render();
    },

    getTotalPages() {
        return Math.max(1, Math.ceil((this.displayData.length || 0) / this.pageSize));
    },

    getPageSlice() {
        const totalPages = this.getTotalPages();
        if (this.currentPage > totalPages) this.currentPage = totalPages;
        if (this.currentPage < 1) this.currentPage = 1;
        const start = (this.currentPage - 1) * this.pageSize;
        const end = Math.min(start + this.pageSize, this.displayData.length);
        return {
            start,
            end,
            list: this.displayData.slice(start, end),
            totalPages
        };
    },

    changePage(delta) {
        this.goToPage(this.currentPage + delta);
    },

    goToPage(page) {
        const totalPages = this.getTotalPages();
        const nextPage = page === 'last' ? totalPages : Math.min(totalPages, Math.max(1, Number(page) || 1));
        if (nextPage === this.currentPage) return;
        this.currentPage = nextPage;
        this.render();
        const container = document.getElementById('lm-list-container');
        if (container) container.scrollTop = 0;
    },

    updatePagination() {
        const pagination = document.getElementById('lm-pagination');
        const info = document.getElementById('lm-page-info');
        const first = document.getElementById('lm-page-first');
        const prev = document.getElementById('lm-page-prev');
        const next = document.getElementById('lm-page-next');
        const last = document.getElementById('lm-page-last');
        if (!pagination) return;

        const total = this.displayData.length;
        const totalPages = this.getTotalPages();
        if (this.currentPage > totalPages) this.currentPage = totalPages;
        if (this.currentPage < 1) this.currentPage = 1;
        if (total <= this.pageSize) {
            pagination.classList.add('hidden');
        } else {
            pagination.classList.remove('hidden');
        }

        if (info) info.textContent = `第 ${this.currentPage} / ${totalPages} 页 (${total} 首)`;
        if (first) first.disabled = this.currentPage <= 1;
        if (prev) prev.disabled = this.currentPage <= 1;
        if (next) next.disabled = this.currentPage >= totalPages;
        if (last) last.disabled = this.currentPage >= totalPages;
    },

    render() {
        const container = document.getElementById('lm-list-container');
        if (!container) return;
        this.bindEvents();

        if (this.displayData.length === 0) {
            this.updatePagination();
            if (typeof window.unobserveLazyImages === 'function') {
                window.unobserveLazyImages(container);
            }
            container.innerHTML = `
                <div class="text-center py-20 text-gray-500">
                    <i class="fas fa-inbox text-4xl mb-4 opacity-50"></i>
                    <p>自定义目录下暂无相关歌曲</p>
                </div>`;
            return;
        }

        const username = this.getCurrentUsername();
        const authToken = (window.getUserAuthHeaders ? window.getUserAuthHeaders()['x-user-token'] : null) || localStorage.getItem('lx_user_token') || '';
        const page = this.getPageSlice();
        this.updatePagination();

        let html = '';
        page.list.forEach((item, pageIndex) => {
            const index = page.start + pageIndex;
            const safeName = this.escapeHtml(item.name || '未知歌曲');
            const safeSinger = this.escapeHtml(item.singer || '未知歌手');
            const safeAlbum = this.escapeHtml(item.album || '--');
            const safeSubPath = this.escapeHtml(item.subPath || '');
            const isSelected = this.selectedItems.has(item.filename);

            // 未索引判断：source 为 custom/unknown 或包含未解析 mid
            const isUnindexed = !item.source || item.source === 'custom' || item.source === 'unknown' || item.source === 'local' || (item.songmid && String(item.songmid).includes('custom_'));
            const isNoTag = (n) => !n || n === '未知歌曲' || n === '未知歌手' || n.toLowerCase() === 'unknown';
            const missingID3 = isNoTag(item.name) || isNoTag(item.singer) || isUnindexed;
            const missingCover = !item.hasCover;
            const missingLyric = !item.hasLyric && !item.lyricFilename;
            const metadataUnsupported = item.metadataWritable === false;

            const coverStatusTitle = item.coverType === 'embedded' ? '封面已嵌入音频标签' : (item.hasCover ? '已有封面' : '缺封面');
            const lyricStatusBadge = item.hasEmbedLyric
                ? '<span class="text-[10px] text-emerald-500 border border-gray-400/40 dark:border-gray-600/50 rounded px-1 scale-90 hidden sm:inline-block" title="已嵌入歌词标签">词</span>'
                : (item.hasLyric ? '<span class="text-[10px] text-amber-500 border border-amber-400/40 rounded px-1 scale-90 hidden sm:inline-block" title="外置歌词文件">外置词</span>' : '');

            const qualityClass = window.QualityManager && window.QualityManager.getQualityColor ? window.QualityManager.getQualityColor(item.quality) : 'bg-gray-100 text-gray-600';
            const qualityName = window.QualityManager ? window.QualityManager.getQualityDisplayName(item.quality) : item.quality;

            // 封面图片构造：携带 user 和 token 保证原生 img 加载正常鉴权通过
            let coverHtml = `<div class="w-10 h-10 md:w-12 md:h-12 rounded-lg bg-gray-100/50 flex-shrink-0 flex items-center justify-center border t-border-main mr-2.5 md:mr-4 ml-0.5 md:ml-3">
                                <i class="fas fa-music t-text-muted text-xs"></i>
                             </div>`;
            if (item.hasCover) {
                const coverVersion = [Math.round(item.mtime || 0), item.size || 0].join('-');
                const coverUrl = `/api/music/custom/cover?filename=${encodeURIComponent(item.filename)}&user=${encodeURIComponent(username)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}&v=${encodeURIComponent(coverVersion)}`;
                coverHtml = `<img data-src="${this.escapeAttr(coverUrl)}" data-lm-cover-index="${index}" src="/music/assets/logo.svg" loading="lazy" fetchpriority="low" class="lazy-image lm-cover-image is-placeholder w-10 h-10 md:w-12 md:h-12 rounded-lg object-cover shadow-sm flex-shrink-0 border t-border-main mr-2.5 md:mr-4 ml-0.5 md:ml-3">`;
            }

            const formatSize = (bytes) => {
                if (!bytes) return '--';
                return (bytes / 1024 / 1024).toFixed(1) + 'M';
            };

            const formatTime = (ts) => {
                if (!ts) return '';
                const d = new Date(ts);
                return d.toLocaleDateString() + ' ' + d.toLocaleTimeString().slice(0, 5);
            };

            const folderIcon = '<i class="fas fa-download text-blue-500 mr-1" title="自定义目录"></i>';
            const displayedSource = item.downloadSource || item.source;
            const safeSource = this.escapeHtml((displayedSource === 'unknown' || displayedSource === 'local' || displayedSource === 'custom' || !displayedSource) ? '未知' : displayedSource);
            const sourceTitle = item.downloadSource && item.downloadSource !== item.source
                ? `下载来源：${item.downloadSource}；歌曲平台：${(!item.source || item.source === 'custom') ? '未知' : item.source}`
                : `歌曲平台：${(!item.source || item.source === 'custom') ? '未知' : item.source}`;
            const safeSourceTitle = this.escapeAttr(sourceTitle);
            // 目录路径渲染（仅最前面带一个文件夹图标，根目录显示“根目录”）
            let subPathHtml = '';
            let mobileSubPathHtml = '';
            if (item.subPath) {
                subPathHtml = `<div class="text-[9px] text-emerald-500 font-mono truncate mb-1" title="${safeSubPath}"><i class="far fa-folder mr-1 opacity-70"></i>${safeSubPath}</div>`;
                mobileSubPathHtml = `<span class="text-emerald-500 font-mono truncate max-w-[50px] sm:max-w-[80px] italic inline-flex items-center gap-0.5 shrink min-w-0 text-[9px] leading-none" title="${safeSubPath}"><i class="far fa-folder mr-0.5 opacity-70"></i>${safeSubPath}</span>`;
            } else {
                subPathHtml = `<div class="text-[9px] text-emerald-500 font-mono truncate mb-1" title="自定义目录根路径"><i class="far fa-folder mr-1 opacity-70"></i>根目录</div>`;
                mobileSubPathHtml = `<span class="text-emerald-500 font-mono truncate max-w-[45px] sm:max-w-[60px] italic inline-flex items-center gap-0.5 shrink min-w-0 text-[9px] leading-none" title="根目录"><i class="far fa-folder mr-0.5 opacity-70"></i>根目录</span>`;
            }

            const canDelete = !!window.userAllowOperateCustomDir;

            html += `
            <div class="grid grid-cols-12 gap-2 md:gap-4 p-3 md:p-2 items-center rounded-xl hover:t-bg-item-hover transition-all t-border-main border-b last:border-b-0 group relative ${isSelected ? 't-bg-item-hover ring-1 ring-emerald-500/30' : ''}" data-lm-row-index="${index}">
                <!-- # / Batch -->
                <div class="col-span-1 text-center text-xs font-mono t-text-muted flex-shrink-0 flex items-center justify-center">
                    <div class="${this.batchMode ? 'hidden' : 'block'}">${index + 1}</div>
                    <div class="${this.batchMode ? 'block' : 'hidden'}">
                        <label class="flex items-center justify-center w-full h-full cursor-pointer">
                            <input type="checkbox" data-lm-action="select" data-lm-index="${index}" ${isSelected ? 'checked' : ''}
                                class="w-4 h-4 rounded border-gray-300 text-emerald-500 focus:ring-emerald-500 mx-auto cursor-pointer transition-all">
                        </label>
                    </div>
                </div>

                <!-- Song & Cover -->
                <div class="col-span-7 sm:col-span-5 md:col-span-4 lg:col-span-4 flex items-center min-w-0 pr-2">
                    ${coverHtml}
                    <div class="min-w-0 flex-1">
                        <!-- Song Name -->
                        <div class="font-bold text-sm md:text-base t-text-main truncate group-hover:text-emerald-500 transition-colors cursor-pointer" data-lm-action="play" data-lm-index="${index}">
                            ${safeName}
                        </div>
                        
                        <!-- Row 2: Singer (mobile only) + Quality badge + Audio specs (desktop only) + Lyric/Cover badges (desktop only) -->
                        <div class="text-[11px] md:text-xs t-text-muted mt-0.5 flex items-center gap-1.5 min-w-0 flex-nowrap">
                            <span class="sm:hidden font-medium text-emerald-600/80 truncate max-w-[105px] xs:max-w-[140px] shrink min-w-0" title="${safeSinger}">${safeSinger}</span>
                            <span class="px-1.5 py-0.5 rounded text-[9px] border t-border-main ${qualityClass} shrink-0 leading-none font-medium">${this.escapeHtml(qualityName || '标准')}</span>
                            ${item.bitrate ? `<span class="text-[10px] opacity-60 font-mono hidden sm:inline-block shrink-0">${Math.round(item.bitrate)}kbps</span>` : ''}
                            ${item.sampleRate ? `<span class="text-[10px] opacity-60 font-mono hidden sm:inline-block shrink-0">${(item.sampleRate / 1000).toFixed(1)}kHz</span>` : ''}
                            ${item.bitDepth && item.bitDepth > 16 ? `<span class="text-[10px] opacity-60 font-mono hidden sm:inline-block shrink-0">${item.bitDepth}bit</span>` : ''}
                            ${lyricStatusBadge}
                            ${item.hasCover ? `<span class="text-[10px] text-emerald-500 border border-gray-400/40 dark:border-gray-600/50 rounded px-1 scale-90 hidden sm:inline-block shrink-0" title="${this.escapeAttr(coverStatusTitle)}">封</span>` : ''}
                        </div>

                        <!-- Row 3: Mobile & Tablet extra info (hidden on md/lg desktop where dedicated column exists) -->
                        <div class="md:hidden text-[9px] mt-1 flex items-center gap-1 min-w-0 flex-nowrap overflow-x-auto no-scrollbar">
                            <!-- Source Tag -->
                            <div class="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-100/90 dark:bg-gray-800/90 rounded-full t-text-muted shrink-0 leading-none">
                                ${folderIcon}
                                <span class="font-bold uppercase tracking-tight text-[9px]" title="${safeSourceTitle}">${safeSource}</span>
                            </div>
                            
                            <!-- SubPath (if any) -->
                            ${mobileSubPathHtml}
                            
                            <!-- Status Badges -->
                            <div class="flex items-center gap-1 shrink-0">
                                ${missingID3 ? '<span class="px-1.5 py-0.5 bg-red-50 text-red-500 border border-red-100 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/30 rounded text-[9px] font-medium leading-none shrink-0">缺标签</span>' : ''}
                                ${missingCover ? '<span class="px-1.5 py-0.5 bg-orange-50 text-orange-500 border border-orange-100 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-900/30 rounded text-[9px] font-medium leading-none shrink-0">缺封面</span>' : ''}
                                ${missingLyric ? '<span class="px-1.5 py-0.5 bg-yellow-50 text-yellow-600 border border-yellow-100 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-900/30 rounded text-[9px] font-medium leading-none shrink-0">缺词</span>' : ''}
                                ${(!missingID3 && !missingCover && !missingLyric) ? '<span class="px-1.5 py-0.5 bg-emerald-50 text-emerald-600 border border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-900/30 rounded text-[9px] font-medium leading-none shrink-0">完整</span>' : ''}
                            </div>

                            <!-- Manual Link Button -->
                            ${(isUnindexed || this.enableReMapping) ? `
                                <button data-lm-action="manual" data-lm-index="${index}"
                                        class="px-1.5 py-0.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded font-bold shadow-sm shadow-emerald-500/20 active:scale-95 transition-all inline-flex items-center gap-0.5 shrink-0 text-[9px] leading-none" title="手动关联">
                                    <i class="fas fa-link text-[7px]"></i>关联
                                </button>
                            ` : ''}
                            
                            <!-- Embed Lyric & Cover Badges -->
                            <div class="flex items-center gap-1 shrink-0">
                                ${item.hasEmbedLyric ? '<span class="w-3.5 h-3.5 inline-flex items-center justify-center bg-emerald-500 text-white rounded text-[8px] font-bold shadow-sm shadow-emerald-500/20 shrink-0 leading-none" title="已嵌入歌词标签">词</span>' : (metadataUnsupported && item.hasLyric ? `<span class="h-3.5 px-1 inline-flex items-center justify-center bg-amber-500 text-white rounded text-[8px] font-bold shrink-0 leading-none" title="${this.escapeAttr(item.embedLyricError || item.metadataError || '音频容器不支持嵌入歌词，已保留外置歌词')}">外置词</span>` : '')}
                                ${item.hasCover ? `<span class="w-3.5 h-3.5 inline-flex items-center justify-center bg-blue-500 text-white rounded text-[8px] font-bold shadow-sm shadow-blue-500/20 shrink-0 leading-none" title="${this.escapeAttr(coverStatusTitle)}">封</span>` : ''}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Singer -->
                <div class="hidden sm:block sm:col-span-4 md:col-span-3 lg:col-span-2 text-xs t-text-main truncate pr-2">
                    ${safeSinger}
                </div>

                <!-- Album -->
                <div class="hidden lg:block lg:col-span-2 text-xs t-text-muted truncate pr-2">
                    ${safeAlbum}
                </div>

                <!-- Source/Info with Metadata Status -->
                <div class="hidden md:flex flex-col md:col-span-2 lg:col-span-1 text-xs t-text-muted pr-2">
                    <div class="flex items-center gap-1 mb-1">
                        ${folderIcon}
                        <span class="truncate font-medium" title="${safeSourceTitle}">${safeSource}</span>
                    </div>
                    ${subPathHtml}
                    <div class="flex flex-wrap gap-1">
                        ${missingID3 ? '<span class="px-1 py-0 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 rounded text-[9px] font-bold">缺标签</span>' : ''}
                        ${missingCover ? '<span class="px-1 py-0 bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 rounded text-[9px] font-bold">缺封面</span>' : ''}
                        ${missingLyric ? '<span class="px-1 py-0 bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400 rounded text-[9px] font-bold">缺词</span>' : ''}
                        ${(!missingID3 && !missingCover && !missingLyric) ? '<span class="px-1 py-0 bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 rounded text-[9px] font-bold">完整</span>' : ''}
                    </div>
                    <div class="text-[9px] mt-1 opacity-70 scale-90 origin-left">${formatTime(item.mtime)}</div>
                </div>

                <!-- Action Buttons -->
                <div class="col-span-4 sm:col-span-2 md:col-span-2 lg:col-span-2 flex items-center justify-end gap-0.5 md:gap-2">
                    <div class="hidden lg:block text-xs text-right pr-2 font-mono t-text-muted shrink-0 mr-1">
                        ${formatSize(item.size)}
                    </div>
                    ${(isUnindexed || this.enableReMapping) ? `
                        <button data-lm-action="manual" data-lm-index="${index}"
                                class="hidden sm:flex w-8 h-8 md:w-7 md:h-7 items-center justify-center rounded-full bg-emerald-500 text-white hover:bg-emerald-600 transition-all shadow-sm shrink-0" title="手动关联">
                            <i class="fas fa-link text-[10px]"></i>
                        </button>
                    ` : ''}
                    <button data-lm-action="play" data-lm-index="${index}"
                            class="w-7 h-7 flex items-center justify-center rounded-full t-bg-main border t-border-main t-text-main hover:text-emerald-500 hover:border-emerald-300 transition-all shadow-sm shrink-0" title="播放">
                        <i class="fas fa-play text-[10px] ml-0.5"></i>
                    </button>
                    <button data-lm-action="download" data-lm-index="${index}"
                            class="w-7 h-7 flex items-center justify-center rounded-full t-bg-main border t-border-main t-text-main hover:text-blue-500 hover:border-blue-300 transition-all shadow-sm shrink-0" title="保存到设备">
                        <i class="fas fa-download text-[10px]"></i>
                    </button>
                    <button data-lm-action="playlist" data-lm-index="${index}"
                            class="w-7 h-7 flex items-center justify-center rounded-full t-bg-main border t-border-main text-emerald-500 hover:bg-emerald-50 hover:border-emerald-300 transition-all shadow-sm shrink-0" title="添加到歌单">
                        <i class="fas fa-plus text-[10px]"></i>
                    </button>
                    ${canDelete ? `
                    <button data-lm-action="delete" data-lm-index="${index}"
                            class="w-7 h-7 flex items-center justify-center rounded-full t-bg-main border t-border-main t-text-muted hover:text-red-500 hover:border-red-300 transition-all shadow-sm shrink-0" title="删除">
                        <i class="far fa-trash-alt text-[10px]"></i>
                    </button>` : ''}
                </div>
            </div>
            `;
        });

        if (typeof window.unobserveLazyImages === 'function') {
            window.unobserveLazyImages(container);
        }
        container.innerHTML = html;

        // 绑定封面加载失败兜底
        container.querySelectorAll('.lm-cover-image').forEach(img => {
            img.addEventListener('error', () => {
                const index = parseInt(img.dataset.lmCoverIndex || '', 10);
                this.handleCoverLoadError(index, img);
            }, { once: true });
        });

        if (typeof window.lazyLoadImages === 'function') {
            window.lazyLoadImages(container);
        }
    },

    handleCoverLoadError(index, img) {
        const item = this.displayData[index];
        if (!item) return;
        if (item.img && typeof item.img === 'string' && /^https?:\/\//i.test(item.img) && !img.dataset.lmFallbackTried) {
            img.dataset.lmFallbackTried = 'true';
            img.src = item.img;
            return;
        }
        item.hasCover = false;
        item.coverType = 'none';

        const placeholder = document.createElement('div');
        placeholder.className = 'w-10 h-10 md:w-12 md:h-12 rounded-lg bg-gray-100/50 flex-shrink-0 flex items-center justify-center border t-border-main mr-2.5 md:mr-4 ml-0.5 md:ml-3';
        placeholder.innerHTML = '<i class="fas fa-music t-text-muted text-xs"></i>';
        if (img && img.isConnected) img.replaceWith(placeholder);

        clearTimeout(this.coverRenderTimer);
        this.coverRenderTimer = setTimeout(() => {
            this.coverRenderTimer = null;
            this.render();
        }, 80);
    },

    openManualIndexModal(index) {
        const item = this.displayData[index];
        if (!item) return;
        if (window.LocalMusicManager && typeof window.LocalMusicManager.openManualIndexModal === 'function') {
            window.LocalMusicManager.openManualIndexModal(item);
        }
    },

    toggleSelect(index, checked) {
        const item = this.displayData[index];
        if (!item) return;
        if (checked) {
            this.selectedItems.add(item.filename);
        } else {
            this.selectedItems.delete(item.filename);
        }

        const row = document.querySelector(`[data-lm-row-index="${index}"]`);
        if (row) {
            if (checked) {
                row.classList.add('t-bg-item-hover', 'ring-1', 'ring-emerald-500/30');
            } else {
                row.classList.remove('t-bg-item-hover', 'ring-1', 'ring-emerald-500/30');
            }
        }
        this.updateBatchUI();
    },

    getSelectedEntries() {
        return this.originalData.filter(item => this.selectedItems.has(item.filename));
    },

    getSelectedFilenames() {
        return Array.from(this.selectedItems);
    },

    toggleBatchMode() {
        this.batchMode = !this.batchMode;
        if (!this.batchMode) {
            this.selectedItems.clear();
        }

        const tb = document.getElementById('lm-batch-toolbar');
        if (tb) {
            if (this.batchMode) {
                tb.classList.remove('hidden');
                tb.classList.add('flex');
            } else {
                tb.classList.add('hidden');
                tb.classList.remove('flex');
            }
        }

        this.syncBatchButtonsVisibility();
        this.updateBatchUI();
        this.render();
    },

    selectAll() {
        this.displayData.forEach(item => this.selectedItems.add(item.filename));
        this.updateBatchUI();
        this.render();
    },

    deselectAll() {
        this.selectedItems.clear();
        this.updateBatchUI();
        this.render();
    },

    updateBatchUI() {
        const span = document.getElementById('lm-batch-selected-count');
        if (span) span.textContent = this.selectedItems.size;
    },

    playItem(index) {
        const item = this.displayData[index];
        if (!item) return;

        const authToken = (window.getUserAuthHeaders ? window.getUserAuthHeaders()['x-user-token'] : null) || localStorage.getItem('lx_user_token') || '';
        const username = this.getCurrentUsername();
        const playlist = this.displayData.map(d => ({
            ...d.songInfo,
            url: `/api/music/custom/file?filename=${encodeURIComponent(d.filename)}&user=${encodeURIComponent(username)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}`,
            pic: `/api/music/custom/cover?filename=${encodeURIComponent(d.filename)}&user=${encodeURIComponent(username)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}`,
            isLocal: true,
            folder: 'custom',
            // 附加本地文件定位信息，供 fetchLyric 读取内嵌歌词（未关联歌曲时优先使用）
            _localFilename: d.filename,
            _localUsername: username,
            _isCustomDir: true
        }));

        if (typeof window.updatePlaylist === 'function') {
            window.updatePlaylist(playlist, index, 'custom_dir_all');
        } else if (typeof window.playSong === 'function') {
            window.playSong(playlist[index], index);
        }
    },

    downloadSingle(index) {
        const item = this.displayData[index];
        if (!item) return;
        const authToken = (window.getUserAuthHeaders ? window.getUserAuthHeaders()['x-user-token'] : null) || localStorage.getItem('lx_user_token') || '';
        const username = this.getCurrentUsername();
        const url = `/api/music/custom/file?filename=${encodeURIComponent(item.filename)}&user=${encodeURIComponent(username)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}`;
        const a = document.createElement('a');
        a.href = url;
        a.download = item.filename.split('/').pop() || item.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    },

    addItemToPlaylist(index) {
        const item = this.displayData[index];
        if (!item) return;

        if (!item.source || item.source === 'custom' || item.source === 'unknown' || item.source === 'local') {
            if (typeof showError === 'function') {
                showError('歌曲不在曲库中，无法收藏到歌单。请先使用“手动关联”绑定平台歌曲 ID。');
            }
            return;
        }

        if (window.LocalMusicManager && typeof window.LocalMusicManager.buildPlaylistSong === 'function') {
            const fakeItem = {
                ...item,
                folder: 'custom',
                songInfo: {
                    ...(item.songInfo || {}),
                    meta: { songId: item.songmid || item.id }
                }
            };
            const song = window.LocalMusicManager.buildPlaylistSong(fakeItem);
            if (song && typeof window.openPlaylistAddModalForSongObject === 'function') {
                window.openPlaylistAddModalForSongObject(song);
                return;
            }
        }
        if (typeof showError === 'function') {
            showError('该歌曲尚未关联线上曲库，无法收藏到歌单。请先使用“手动关联”');
        }
    },

    async deleteSingle(index) {
        const item = this.displayData[index];
        if (!item) return;

        if (!window.userAllowOperateCustomDir) {
            if (typeof showError === 'function') showError('您没有删除自定义目录文件的权限');
            return;
        }

        if (typeof showSelect === 'function') {
            if (!(await showSelect('删除文件', `确定要从自定义目录删除【${item.name || item.filename}】吗?`, { danger: true }))) return;
        } else {
            if (!confirm(`确定要从自定义目录删除【${item.name || item.filename}】吗?`)) return;
        }

        this._executeDelete([item.filename]);
    },

    async batchDelete() {
        if (this.selectedItems.size === 0) {
            if (typeof showError === 'function') showError('请先选择要删除的文件');
            return;
        }

        if (!window.userAllowOperateCustomDir) {
            if (typeof showError === 'function') showError('您没有删除自定义目录文件的权限');
            return;
        }

        if (typeof showSelect === 'function') {
            if (!(await showSelect('批量删除', `确定要删除选中的 ${this.selectedItems.size} 个自定义目录文件吗?`, { danger: true }))) return;
        } else {
            if (!confirm(`确定要删除选中的 ${this.selectedItems.size} 个文件吗?`)) return;
        }

        this._executeDelete(Array.from(this.selectedItems));
    },

    async _executeDelete(filenames) {
        try {
            const res = await fetch('/api/music/custom/remove', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getAuthHeaders()
                },
                body: JSON.stringify({ filenames })
            });
            const result = await res.json();
            if (result.success) {
                if (typeof showInfo === 'function') showInfo(`成功删除 ${result.deletedCount || filenames.length} 个文件`);
                for (const f of filenames) this.selectedItems.delete(f);
                this.updateBatchUI();
                await this.refresh();
            } else {
                throw new Error(result.message || '删除失败');
            }
        } catch (e) {
            if (typeof showError === 'function') showError('删除自定义目录文件失败: ' + e.message);
        }
    },

    // 批量保存（下载）到设备
    batchDownloadToDevice() {
        const targets = this.getSelectedEntries();
        if (targets.length === 0) {
            if (typeof showError === 'function') showError('请先选择要保存的文件');
            return;
        }

        const username = this.getCurrentUsername();
        const authToken = (window.getUserAuthHeaders ? window.getUserAuthHeaders()['x-user-token'] : null) || localStorage.getItem('lx_user_token') || '';

        targets.forEach((item, idx) => {
            setTimeout(() => {
                const url = `/api/music/custom/file?filename=${encodeURIComponent(item.filename)}&user=${encodeURIComponent(username)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}`;
                const a = document.createElement('a');
                a.href = url;
                a.download = item.filename.split('/').pop() || item.filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }, idx * 500);
        });

        if (typeof showInfo === 'function') showInfo(`已开始下载 ${targets.length} 个文件到设备`);
        this.deselectAll();
    },

    // 批量加入歌单
    batchAddToPlaylist() {
        const targets = this.getSelectedEntries();
        if (targets.length === 0) {
            if (typeof showInfo === 'function') showInfo('请先选择要加入歌单的歌曲');
            return;
        }

        if (!window.LocalMusicManager || typeof window.LocalMusicManager.buildPlaylistSong !== 'function') {
            if (typeof showError === 'function') showError('歌单管理器未就绪');
            return;
        }

        const collectableTargets = [];
        let unavailableCount = 0;

        targets.forEach(item => {
            if (!item.source || item.source === 'custom' || item.source === 'unknown' || item.source === 'local') {
                unavailableCount++;
                return;
            }
            const fakeItem = {
                ...item,
                folder: 'custom',
                songInfo: {
                    ...(item.songInfo || {}),
                    meta: { songId: item.songmid || item.id }
                }
            };
            const song = window.LocalMusicManager.buildPlaylistSong(fakeItem);
            if (song) {
                collectableTargets.push(song);
            } else {
                unavailableCount++;
            }
        });

        if (collectableTargets.length === 0) {
            if (typeof showError === 'function') {
                showError('歌曲不在曲库中，无法收藏到歌单。请先使用“手动关联”绑定平台歌曲 ID。');
            }
            return;
        }

        if (typeof window.openPlaylistAddModal !== 'function') {
            if (typeof showError === 'function') showError('歌单组件尚未加载完成');
            return;
        }

        if (unavailableCount > 0 && typeof showInfo === 'function') {
            showInfo(`已跳过 ${unavailableCount} 首未绑定平台 ID 的歌曲；歌曲不在曲库中，无法收藏到歌单。`);
        }

        window.openPlaylistAddModal(collectableTargets);
    },

    // 批量补全歌词
    async batchFetchLyrics() {
        const targets = this.getSelectedEntries().filter(item => !item.hasLyric);
        if (targets.length === 0) {
            if (typeof showInfo === 'function') showInfo('选中的自定义目录歌曲中没有需要补充歌词的项');
            return;
        }

        if (typeof showSelect === 'function') {
            if (!(await showSelect('补全歌词', `选中的文件中有 ${targets.length} 首没有对应歌词，确定要向服务器请求补全吗?`))) return;
        }

        let success = 0;
        let fail = 0;

        for (const item of targets) {
            const songData = {
                ...(item.songInfo || {}),
                id: item.id,
                songmid: item.songmid,
                source: item.source,
                name: item.name,
                singer: item.singer,
                album: item.album,
                interval: item.interval,
                filename: item.filename,
                folder: 'custom'
            };

            if (!songData.source || songData.source === 'unknown' || songData.source === 'local' || songData.source === 'custom') {
                fail++;
                continue;
            }

            try {
                if (typeof window.requestServerLyricCache === 'function') {
                    const synced = await window.requestServerLyricCache(songData, item.quality, true);
                    if (!synced) {
                        fail++;
                        continue;
                    }
                    success++;
                    if (typeof showInfo === 'function') showInfo(`[${success}/${targets.length}] 成功补全: ${item.name}`);
                } else {
                    fail++;
                }
            } catch (e) {
                fail++;
            }
        }

        if (typeof showInfo === 'function') {
            showInfo(`补全操作完成。成功 ${success} 项，失败/未关联 ${fail} 项`);
        }
        await this.refresh();
    },

    // 批量嵌入歌词到音频文件 USLT 标签
    async batchEmbedLyric() {
        const targetFilenames = this.getSelectedFilenames();
        if (targetFilenames.length === 0) {
            if (typeof showError === 'function') showError('请先选择要嵌入歌词的文件');
            return;
        }

        if (typeof showSelect === 'function') {
            if (!(await showSelect('嵌入歌词到文件',
                `将对选中的 ${targetFilenames.length} 首自定义目录歌曲嵌入歌词到 USLT 标签。\n` +
                `• 已有歌词标签的歌曲将跳过\n` +
                `• 有 .lrc 文件的直接读取嵌入\n` +
                `• 没有 .lrc 文件的将尝试从网络获取\n\n确定继续吗?`
            ))) return;
        }

        try {
            if (typeof showInfo === 'function') showInfo('正在嵌入歌词，请稍候...');
            const res = await fetch('/api/music/custom/embedLyric', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getAuthHeaders()
                },
                body: JSON.stringify({ filenames: targetFilenames })
            });

            const result = await res.json();
            if (result.success) {
                const { successCount = 0, skippedCount = 0, failCount = 0 } = result;
                if (typeof showInfo === 'function') {
                    showInfo(`嵌入完成：成功 ${successCount} 首，跳过（已有） ${skippedCount} 首，失败 ${failCount} 首`);
                }
                if (result.details && result.details.length > 0) {
                    const failed = result.details.filter(d => d.status === 'fail');
                    if (failed.length > 0) {
                        console.warn('[CustomEmbedLyric] 失败详情:', failed);
                        const firstFailure = failed[0];
                        if (typeof showError === 'function') {
                            showError(`有 ${failed.length} 首无法嵌入：${firstFailure.filename} - ${firstFailure.reason || '未知原因'}`);
                        }
                    }
                }
                await this.refresh();
            } else {
                throw new Error(result.message || '服务器返回错误');
            }
        } catch (e) {
            if (typeof showError === 'function') showError('嵌入歌词失败: ' + e.message);
            console.error('[CustomEmbedLyric] Error:', e);
        }
    },

    // 批量补全元信息（包含封面与 ID3 标签）
    async batchUpdateMetadata() {
        const targetFilenames = this.getSelectedFilenames();
        if (targetFilenames.length === 0) {
            if (typeof showInfo === 'function') showInfo('请先选择需要补全元信息的文件');
            return;
        }

        if (typeof showSelect === 'function') {
            if (!(await showSelect('补全元信息', `确定要向服务器请求补全这 ${targetFilenames.length} 个文件的元信息(包含封面与ID3标签)吗?`))) return;
        } else {
            if (!confirm(`确定要补全这 ${targetFilenames.length} 个文件的元信息吗?`)) return;
        }

        try {
            if (typeof showInfo === 'function') showInfo('正在处理，请稍候...');
            const res = await fetch('/api/music/custom/updateMetadata', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getAuthHeaders()
                },
                body: JSON.stringify({ filenames: targetFilenames })
            });

            const result = await res.json();
            if (result.success) {
                if (typeof showInfo === 'function') showInfo(`元信息补全完成。成功 ${result.successCount} 项，失败 ${result.failCount} 项`);
                await this.refresh();
            } else {
                throw new Error(result.message || '服务器返回错误');
            }
        } catch (e) {
            if (typeof showError === 'function') showError('补全元信息失败: ' + e.message);
        }
    },

    // ==========================================
    // 自定义目录层级树筛选相关方法
    // ==========================================

    // 更新筛选框上的按钮展示（使用独立 tag 标签展示各个选中层级，不再用分号 ; 拼接）
    updateDirFilterButtonText() {
        const sidePanelEl = document.getElementById('cd-dir-side-panel');
        if (sidePanelEl && !sidePanelEl.classList.contains('hidden')) this.renderSidePanel();
        const textEl = document.getElementById('cd-dir-filter-text');
        const btnEl = document.getElementById('cd-dir-filter-btn');
        if (!textEl) return;

        if (this.dirFilterAll || !this.selectedDirPaths || this.selectedDirPaths.size === 0) {
            textEl.innerHTML = '<span class="text-gray-400 dark:text-gray-500 font-medium">全部</span>';
            textEl.title = '全部';
            if (btnEl) btnEl.classList.remove('active');
        } else {
            const sortedDirs = Array.from(this.selectedDirPaths).sort();
            const tagsHtml = sortedDirs.map(d => {
                const safeD = this.escapeHtml(d === '/' ? '根目录' : d);
                return `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold border border-emerald-500/30 whitespace-nowrap"><i class="far fa-folder text-[8px] opacity-70"></i>${safeD}</span>`;
            }).join('');
            textEl.innerHTML = `<div class="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5 max-w-full">${tagsHtml}</div>`;
            textEl.title = sortedDirs.map(d => d === '/' ? '根目录' : d).join(', ');
            if (btnEl) btnEl.classList.remove('active'); // 移除整体全绿背景，让内部每个tag清晰独立
        }
    },

    // ==========================================
    // 侧边目录分类面板（电脑版 + 自定义模式 + 主侧边栏折叠）
    // ==========================================
    sideExpandedDirs: new Set(),
    sidePanelCollapsed: false,
    _sidePanelInited: false,

    // 判断侧边面板是否应显示
    shouldShowSidePanel() {
        const isDesktop = window.matchMedia && window.matchMedia('(min-width: 768px)').matches;
        const sidebar = document.getElementById('main-sidebar');
        const sidebarCollapsed = !!(sidebar && sidebar.classList.contains('desktop-collapsed'));
        return !!(this.isActive && isDesktop && sidebarCollapsed);
    },

    // 同步侧边面板可见性，以及筛选面板中“目录”按钮的显隐
    syncSidePanel() {
        const panel = document.getElementById('cd-dir-side-panel');
        const view = document.getElementById('view-localmusic');
        if (!panel) return;

        if (!this._sidePanelInited) {
            this._sidePanelInited = true;
            try { this.sidePanelCollapsed = localStorage.getItem('lx_cd_side_collapsed') === 'true'; } catch (e) { }
            panel.addEventListener('click', (e) => this._onSideTreeClick(e));
            window.addEventListener('resize', () => this.syncSidePanel());
        }

        const show = this.shouldShowSidePanel();
        panel.classList.toggle('hidden', !show);
        panel.classList.toggle('collapsed', this.sidePanelCollapsed);
        if (view) {
            view.classList.toggle('cd-side-open', show && !this.sidePanelCollapsed);
            view.classList.toggle('cd-side-rail', show && this.sidePanelCollapsed);
        }

        // 面板显示时，筛选面板里的“目录”按钮不再需要
        const dirContainer = document.getElementById('cd-dir-filter-container');
        if (dirContainer) {
            const showInFilter = this.isActive && !show;
            dirContainer.classList.toggle('hidden', !showInFilter);
            dirContainer.classList.toggle('flex', showInFilter);
        }

        if (show) this.renderSidePanel();
    },

    // 展开/折叠侧边面板
    toggleSidePanel(expand) {
        this.sidePanelCollapsed = expand === undefined ? !this.sidePanelCollapsed : !expand;
        try { localStorage.setItem('lx_cd_side_collapsed', this.sidePanelCollapsed ? 'true' : 'false'); } catch (e) { }
        this.syncSidePanel();
    },

    // 展开/折叠全部目录节点
    sideExpandAll(expand) {
        this.sideExpandedDirs.clear();
        if (expand) {
            const walk = (nodes) => nodes.forEach(n => {
                if (n.children.length) { this.sideExpandedDirs.add(n.fullPath); walk(n.children); }
            });
            walk(this.buildDirTree());
        }
        this.renderSidePanel();
        const modalEl = document.getElementById('cd-dir-tree-modal');
        if (modalEl && !modalEl.classList.contains('hidden')) this.renderDirTree();
    },

    // 提交筛选（侧边面板直接生效，无需确认）
    _commitSideSelection() {
        if (!this.selectedDirPaths.size) this.dirFilterAll = true;
        this.pendingDirFilterAll = this.dirFilterAll;
        this.pendingDirPaths = new Set(this.selectedDirPaths);
        this.updateDirFilterButtonText();
        this.applyFilters();
    },

    // 多选开关（等同按住 Ctrl），侧边面板与弹窗共用
    multiMode: false,

    toggleMultiMode(on) {
        this.multiMode = on === undefined ? !this.multiMode : !!on;
        document.querySelectorAll('.cd-multi-switch').forEach(el => el.classList.toggle('on', this.multiMode));
    },

    // 计算点击后的选择结果（纯函数）
    _pick(all, paths, path, multi) {
        const next = new Set(paths);
        if (path === '') return { all: true, paths: new Set() };
        if (multi) {
            if (next.has(path)) {
                next.delete(path);
            } else {
                for (const p of next) if (path.startsWith(p + '/')) return { all, paths: next }; // 祖先已选
                for (const p of Array.from(next)) if (p.startsWith(path + '/')) next.delete(p);
                next.add(path);
            }
            return { all: next.size === 0, paths: next };
        }
        if (!all && next.size === 1 && next.has(path)) return { all: true, paths: new Set() };
        return { all: false, paths: new Set([path]) };
    },

    _onSideTreeClick(e) {
        this._onTreeClick(e, 'side');
    },

    // 目录树点击：mode = 'side'（即时生效）| 'modal'（待确认）
    _onTreeClick(e, mode) {
        const rerender = () => (mode === 'side' ? this.renderSidePanel() : this.renderDirTree());
        const caret = e.target.closest('[data-cd-caret]');
        if (caret) {
            e.stopPropagation();
            const p = caret.dataset.cdCaret;
            if (this.sideExpandedDirs.has(p)) this.sideExpandedDirs.delete(p);
            else this.sideExpandedDirs.add(p);
            rerender();
            return;
        }
        const node = e.target.closest('[data-cd-node]');
        if (!node) return;
        const multi = e.ctrlKey || e.metaKey || this.multiMode;

        if (mode === 'side') {
            const r = this._pick(this.dirFilterAll, this.selectedDirPaths, node.dataset.cdNode, multi);
            this.dirFilterAll = r.all;
            this.selectedDirPaths = r.paths;
            this._commitSideSelection();
        } else {
            const r = this._pick(this.pendingDirFilterAll, this.pendingDirPaths, node.dataset.cdNode, multi);
            this.pendingDirFilterAll = r.all;
            this.pendingDirPaths = r.paths;
            this.renderDirTree();
        }
    },

    // 生成目录树 HTML（节点式，+/- 展开，高亮选中，显示歌曲数）
    _treeHtml(allMode, pathSet) {
        const items = this.originalData || [];
        const treeData = this.buildDirTree();
        const isAll = allMode || !pathSet || pathSet.size === 0;

        // 选中节点的祖先自动展开
        if (!isAll) {
            for (const sel of pathSet) {
                const parts = sel.split('/');
                for (let i = 1; i < parts.length; i++) this.sideExpandedDirs.add(parts.slice(0, i).join('/'));
            }
        }

        // 一次遍历预计算各目录歌曲数（含子目录）
        const counts = new Map();
        for (const it of items) {
            const parts = (it.subPath || '').trim().split('/').filter(Boolean);
            let cur = '';
            for (const part of parts) {
                cur = cur ? `${cur}/${part}` : part;
                counts.set(cur, (counts.get(cur) || 0) + 1);
            }
        }
        const isIncluded = (path) => {
            if (isAll) return false;
            for (const p of pathSet) if (path.startsWith(p + '/')) return true;
            return false;
        };

        const renderNode = (n) => {
            const hasChild = n.children.length > 0;
            const open = this.sideExpandedDirs.has(n.fullPath);
            const selected = !isAll && pathSet.has(n.fullPath);
            const included = isIncluded(n.fullPath);
            const cls = `cd-node${selected ? ' selected' : ''}${included ? ' included' : ''}`;
            const sp = this.escapeAttr(n.fullPath);
            let html = `<div class="${cls}" data-cd-node="${sp}" title="${sp}">
                <span class="cd-node-caret ${hasChild ? 'has-child' : ''} ${hasChild && open ? 'open' : ''}" ${hasChild ? `data-cd-caret="${sp}" title="${open ? '折叠' : '展开'}"` : ''}>${hasChild ? `<i class="far ${open ? 'fa-square-minus' : 'fa-square-plus'}"></i>` : ''}</span>
                <i class="fas ${open && hasChild ? 'fa-folder-open' : 'fa-folder'} cd-node-icon"></i>
                <span class="cd-node-name">${this.escapeHtml(n.name)}</span>
                ${included ? '<span class="cd-node-inc">已包含</span>' : ''}
                <span class="cd-node-count">${counts.get(n.fullPath) || 0}</span>
            </div>`;
            if (hasChild && open) {
                html += `<div class="cd-node-children">${n.children.map(renderNode).join('')}</div>`;
            }
            return html;
        };

        let html = `<div class="cd-node${isAll ? ' selected' : ''}" data-cd-node="" style="margin-bottom:4px">
            <span class="cd-node-caret"></span>
            <i class="fas fa-layer-group cd-node-icon" style="color:var(--c-500)"></i>
            <span class="cd-node-name">全部歌曲</span>
            <span class="cd-node-count">${items.length}</span>
        </div>`;
        html += `<div class="cd-node${!isAll && pathSet.has('/') ? ' selected' : ''}" data-cd-node="/" title="仅显示根目录直属歌曲">
            <span class="cd-node-caret"></span>
            <i class="fas fa-folder cd-node-icon"></i>
            <span class="cd-node-name">根目录</span>
            <span class="cd-node-count">${items.filter(it => !(it.subPath || '').trim()).length}</span>
        </div>`;
        if (!treeData.length) {
            html += '<div style="padding:1.2rem .5rem;text-align:center;font-size:11px;color:var(--text-muted)"><i class="fas fa-folder-open" style="font-size:20px;opacity:.4;display:block;margin-bottom:6px"></i>暂无子目录（所有歌曲均在根路径）</div>';
        } else {
            html += treeData.map(renderNode).join('');
        }
        return html;
    },

    // 渲染侧边目录树
    renderSidePanel() {
        const treeEl = document.getElementById('cd-side-tree');
        const badge = document.getElementById('cd-side-badge');
        if (!treeEl) return;

        const isAll = this.dirFilterAll || !this.selectedDirPaths || this.selectedDirPaths.size === 0;
        if (badge) {
            badge.textContent = isAll ? '全部' : `已选 ${this.selectedDirPaths.size}`;
            badge.classList.toggle('on', !isAll);
        }

        const prevScroll = treeEl.scrollTop;
        treeEl.innerHTML = this._treeHtml(this.dirFilterAll, this.selectedDirPaths);
        treeEl.scrollTop = prevScroll;
    },

    // 重置目录筛选为“全部”
    resetDirFilterToAll() {
        this.pendingDirFilterAll = true;
        this.pendingDirPaths.clear();

        const allCheckbox = document.getElementById('cd-dir-all-checkbox');
        if (allCheckbox) allCheckbox.checked = true;

        this.renderDirTree();
    },

    // 打开目录筛选模态框
    openDirTreeModal() {
        const modal = document.getElementById('cd-dir-tree-modal');
        const content = document.getElementById('cd-dir-tree-modal-content');
        if (!modal || !content) return;

        // 将当前应用的筛选状态拷贝到 pending 待确认状态中
        this.pendingDirFilterAll = this.dirFilterAll;
        this.pendingDirPaths = new Set(this.selectedDirPaths);

        const allCheckbox = document.getElementById('cd-dir-all-checkbox');
        if (allCheckbox) allCheckbox.checked = this.pendingDirFilterAll;

        this.renderDirTree();

        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => {
            content.classList.remove('scale-95', 'opacity-0');
            content.classList.add('scale-100', 'opacity-100');
        }, 10);
    },

    // 关闭目录筛选模态框
    closeDirTreeModal() {
        const modal = document.getElementById('cd-dir-tree-modal');
        const content = document.getElementById('cd-dir-tree-modal-content');
        if (!modal || !content) return;

        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }, 200);
    },

    // 构建目录树结构
    buildDirTree() {
        const subPaths = new Set();
        (this.originalData || []).forEach(item => {
            const sp = (item.subPath || '').trim();
            if (sp) subPaths.add(sp);
        });

        // 根节点
        const root = { name: '', fullPath: '', children: new Map() };

        subPaths.forEach(pathStr => {
            const parts = pathStr.split('/').filter(Boolean);
            let current = root;
            let currentPath = '';
            for (const part of parts) {
                currentPath = currentPath ? `${currentPath}/${part}` : part;
                if (!current.children.has(part)) {
                    current.children.set(part, {
                        name: part,
                        fullPath: currentPath,
                        children: new Map()
                    });
                }
                current = current.children.get(part);
            }
        });

        // 递归转换 Map 为排序数组
        const toArray = (node) => {
            const arr = Array.from(node.children.values()).map(child => ({
                name: child.name,
                fullPath: child.fullPath,
                children: toArray(child)
            }));
            arr.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
            return arr;
        };

        return toArray(root);
    },

    // 勾选/取消勾选“全部”
    toggleAllCheck(checked) {
        this.pendingDirFilterAll = checked;
        if (checked) {
            // 勾选全部后，筛选条件只有全部，清空所有勾选的子目录
            this.pendingDirPaths.clear();
        }
        this.renderDirTree();
    },

    // 勾选/取消勾选具体某个目录层级
    toggleDirCheck(fullPath, checked) {
        if (checked) {
            // 勾选了具体目录，必须取消“全部”
            this.pendingDirFilterAll = false;
            const allCheckbox = document.getElementById('cd-dir-all-checkbox');
            if (allCheckbox) allCheckbox.checked = false;

            // 如果该目录被勾选，清理其下属所有已经被勾选的子级路径（子目录已被父目录自动包含）
            const prefix = fullPath + '/';
            for (const existingPath of Array.from(this.pendingDirPaths)) {
                if (existingPath.startsWith(prefix)) {
                    this.pendingDirPaths.delete(existingPath);
                }
            }
            this.pendingDirPaths.add(fullPath);
        } else {
            // 取消勾选：仅移除当前目录，不要自动强制勾选“全部”！
            this.pendingDirPaths.delete(fullPath);
        }
        this.renderDirTree();
    },

    // 判断某个路径的祖先是否已被勾选
    isAncestorChecked(fullPath) {
        for (const p of this.pendingDirPaths) {
            if (fullPath.startsWith(p + '/')) {
                return true;
            }
        }
        return false;
    },

    // 渲染目录树 DOM（弹窗内，与侧边面板共用节点样式；点击选择，Ctrl/多选开关多选）
    renderDirTree() {
        const container = document.getElementById('cd-dir-tree-container');
        if (!container) return;

        if (!container._cdBound) {
            container._cdBound = true;
            container.addEventListener('click', (e) => this._onTreeClick(e, 'modal'));
        }

        const prevScroll = container.scrollTop;
        container.innerHTML = this._treeHtml(this.pendingDirFilterAll, this.pendingDirPaths);
        container.scrollTop = prevScroll;

        this.updateModalConfirmState();
    },

    // 更新模态框中“确定”按钮及提示标签状态
    updateModalConfirmState() {
        const confirmBtn = document.getElementById('cd-dir-tree-confirm-btn');
        const badgeEl = document.getElementById('cd-dir-selected-badge');
        const hintTextEl = document.getElementById('cd-dir-tree-hint-text');

        const hasSelection = this.pendingDirFilterAll || (this.pendingDirPaths && this.pendingDirPaths.size > 0);

        if (confirmBtn) {
            confirmBtn.disabled = !hasSelection;
        }

        if (badgeEl) {
            if (this.pendingDirFilterAll) {
                badgeEl.textContent = '全部';
                badgeEl.className = 'cd-side-badge';
            } else if (this.pendingDirPaths.size > 0) {
                badgeEl.textContent = `已选 ${this.pendingDirPaths.size} 个目录`;
                badgeEl.className = 'cd-side-badge on';
            } else {
                badgeEl.textContent = '未选择任何条件';
                badgeEl.className = 'cd-side-badge';
            }
        }

        if (hintTextEl) {
            if (this.pendingDirFilterAll) {
                hintTextEl.textContent = '当前为全部歌曲。点击目录筛选；开启“多选”或按住 Ctrl 可多选。';
            } else {
                hintTextEl.textContent = '选中父级会自动包含其子目录；点击“确定”生效筛选。';
            }
        }
    },

    // 模态框点击“确定”生效筛选
    confirmDirTreeSelection() {
        const hasSelection = this.pendingDirFilterAll || (this.pendingDirPaths && this.pendingDirPaths.size > 0);
        if (!hasSelection) return;

        this.dirFilterAll = this.pendingDirFilterAll;
        this.selectedDirPaths = new Set(this.pendingDirPaths);

        this.updateDirFilterButtonText();
        this.closeDirTreeModal();

        // 重新过滤列表
        this.applyFilters();
    },

    // 重置所有筛选（供通用重置按钮调用）
    resetFilters(apply = true) {
        this.searchKeyword = '';
        this.quickSearchKeyword = '';
        this.filterQuality = new Set();
        this.sortBy = 'mtime';
        this.sortOrder = 'desc';
        this.dirFilterAll = true;
        this.selectedDirPaths.clear();
        this.pendingDirFilterAll = true;
        this.pendingDirPaths.clear();

        const si = document.getElementById('lm-search-input');
        if (si) {
            if (window.LocalMusicManager && typeof window.LocalMusicManager.setRichInputValue === 'function') {
                window.LocalMusicManager.setRichInputValue(si, '');
                window.LocalMusicManager.updateSearchInputErrorState(si, '');
            } else {
                si.value = '';
                si.innerText = '';
            }
        }
        const qs = document.getElementById('lm-quick-search');
        if (qs) {
            if (window.LocalMusicManager && typeof window.LocalMusicManager.setRichInputValue === 'function') {
                window.LocalMusicManager.setRichInputValue(qs, '');
                window.LocalMusicManager.updateSearchInputErrorState(qs, '');
            } else {
                qs.value = '';
                qs.innerText = '';
            }
        }
        const sortBy = document.getElementById('lm-sort-by');
        if (sortBy) sortBy.value = 'mtime';
        const sortOrder = document.getElementById('lm-sort-order');
        if (sortOrder) sortOrder.value = 'desc';

        this.updateDirFilterButtonText();

        if (apply) this.applyFilters();
    }
};

