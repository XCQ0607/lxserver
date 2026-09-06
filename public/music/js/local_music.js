/**
 * LocalMusicManager (本地音乐模块)
 * 处理在本地音乐Tab下的列表加载、刷选、删除功能
 */

window.LocalMusicManager = {
    originalData: [],
    displayData: [],
    currentPage: 1,
    pageSize: 60,
    batchMode: false,
    selectedItems: new Set(),
    searchKeyword: '',
    filterFolder: 'all',  // 单选，'all' | 'cache' | 'music'
    filterQuality: new Set(), // 多选 Set，空集合 = 不限制
    filterStatus: new Set(),  // 多选 Set，空集合 = 不限制
    filterSource: new Set(),  // 多选 Set，空集合 = 不限制
    sortBy: 'mtime',
    sortOrder: 'desc',
    quickSearchKeyword: '',
    searchTimer: null,
    isFilterPanelOpen: false,
    manualIndexTargetItem: null, // 当前正在手动关联的本地项
    currentManualResults: [],    // 搜索回来的结果缓存
    currentManualPage: 1,        // 当前搜索页码
    isManualSearching: false,    // 全局锁，防止滚动触发多次加载
    selectedSubPath: '',         // [New] 当前选中的子目录
    subPathModalMode: 'filter',  // [New] 'filter' | 'categorize'
    cacheKey: 'lx_lm_filters',   // [New] localStorage key
    enableReMapping: false,
    listEventsBound: false,
    remasterPollTimer: null,
    remasterResultOffset: 0,
    remasterResults: [],
    remasterResultFilter: 'all',
    remasterTaskId: '',
    remasterTargetQuality: 'flac',
    remasterLastTerminalTaskId: '',
    remasterSelectedItems: new Set(),
    remasterSearchKeyword: '',
    remasterSelectionPage: 1,
    remasterSelectionPageSize: 50,
    remasterSelectionEventsBound: false,
    remasterQualityEventsBound: false,
    remasterTaskRunning: false,
    remasterSource: 'local', // 'local' | 'custom' — 洗版模态框内部数据源，与外部 toggle 解耦
    authExpired: false,
    authExpiredNotified: false,
    coverRenderTimer: null,
    isCustomDirMode: false,

    toggleCustomDirMode(enable) {
        this.isCustomDirMode = !!enable;
        if (window.CustomDirManager && typeof window.CustomDirManager.setActive === 'function') {
            window.CustomDirManager.setActive(enable);
        }
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

    tokenizeSearchExpression(expression) {
        const tokens = [];
        let buffer = '';
        let quote = '';
        let escaped = false;
        const operatorTypes = {
            '&': 'and',
            '|': 'or',
            '!': 'not',
            '(': 'leftParen',
            ')': 'rightParen',
        };
        const flushTerm = () => {
            const value = buffer.trim();
            if (value) tokens.push({ type: 'term', value });
            buffer = '';
        };

        const str = String(expression || '');
        let i = 0;
        while (i < str.length) {
            const char = str[i];

            if (quote) {
                if (escaped) {
                    buffer += char;
                    escaped = false;
                } else if (char === '\\') {
                    escaped = true;
                } else if (char === quote) {
                    quote = '';
                } else {
                    buffer += char;
                }
                i++;
                continue;
            }

            if (char === '"' || char === "'") {
                quote = char;
                i++;
                continue;
            }

            // 1. 优先检测由 lm-op-tag 转换生成的 \u0001[op]\u0001 显式运算符标签
            if (char === '\u0001') {
                const nextMarker = str.indexOf('\u0001', i + 1);
                if (nextMarker !== -1) {
                    const op = str.substring(i + 1, nextMarker).trim();
                    const opType = operatorTypes[op];
                    if (opType) {
                        flushTerm();
                        tokens.push({ type: opType });
                        i = nextMarker + 1;
                        continue;
                    }
                }
            }

            // 2. 兜底检测：符号后紧跟空格或处于串尾的运算符
            const operatorType = operatorTypes[char];
            if (operatorType) {
                const nextChar = str[i + 1];
                const isFollowedBySpaceOrEnd = !nextChar || /\s/.test(nextChar);
                if (isFollowedBySpaceOrEnd) {
                    flushTerm();
                    tokens.push({ type: operatorType });
                    i++;
                    continue;
                }
            }

            // 普通字符（例如 R&B 中的 &）
            buffer += char;
            i++;
        }

        if (quote) return null;
        if (escaped) buffer += '\\';
        flushTerm();
        return tokens;
    },

    getRichInputValue(el) {
        if (!el) return '';
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            return el.value || '';
        }
        let result = '';
        const walk = (node) => {
            if (node.nodeType === 3) {
                result += node.nodeValue;
            } else if (node.nodeType === 1) {
                if (node.classList.contains('lm-op-tag')) {
                    const op = node.getAttribute('data-op') || node.textContent.trim();
                    result += `\u0001${op}\u0001 `;
                } else if (node.tagName === 'BR') {
                    result += ' ';
                } else {
                    for (let child of node.childNodes) walk(child);
                }
            }
        };
        walk(el);
        return result.replace(/[\u200B\u00A0]/g, ' ');
    },

    setRichInputValue(el, value) {
        if (!el) return;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            el.value = value || '';
            return;
        }
        const str = String(value || '');
        if (!str.trim()) {
            el.innerHTML = '';
            return;
        }

        let html = '\u200B';
        let i = 0;
        const operatorSymbols = ['&', '|', '!', '(', ')'];

        while (i < str.length) {
            if (str[i] === '\u0001') {
                const nextMarker = str.indexOf('\u0001', i + 1);
                if (nextMarker !== -1) {
                    const op = str.substring(i + 1, nextMarker).trim();
                    if (operatorSymbols.includes(op)) {
                        html += `<span class="lm-op-tag" data-op="${this.escapeAttr(op)}" contenteditable="false">${this.escapeHtml(op)}</span>&nbsp;`;
                        i = nextMarker + 1;
                        if (i < str.length && str[i] === ' ') i++;
                        continue;
                    }
                }
            }
            const char = str[i];
            if (operatorSymbols.includes(char) && (i + 1 >= str.length || /\s/.test(str[i + 1]))) {
                html += `<span class="lm-op-tag" data-op="${this.escapeAttr(char)}" contenteditable="false">${this.escapeHtml(char)}</span>&nbsp;`;
                i += (str[i + 1] === ' ' ? 2 : 1);
                continue;
            }
            html += this.escapeHtml(char);
            i++;
        }
        el.innerHTML = html;
    },

    formatRichInput(el, force = false) {
        if (!el || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return false;

        const rawVal = this.getRichInputValue(el).replace(/[\u200B\u00A0]/g, '').trim();
        if (!rawVal) {
            el.innerHTML = '';
            this.updateSearchInputErrorState(el, '');
            return false;
        }

        let needsFormat = force;
        if (!needsFormat) {
            const walkCheck = (node) => {
                if (node.nodeType === 3) {
                    const text = node.nodeValue || '';
                    if (/([&|!()])(\s|\u00A0)/.test(text)) {
                        needsFormat = true;
                    }
                } else if (node.nodeType === 1 && !node.classList.contains('lm-op-tag')) {
                    for (let child of node.childNodes) walkCheck(child);
                }
            };
            walkCheck(el);
        }

        if (!needsFormat) return false;

        const caretOffset = this.getRichCaretOffset(el);
        const val = this.getRichInputValue(el);
        this.setRichInputValue(el, val);
        this.setRichCaretOffset(el, caretOffset);
        return true;
    },

    getRichCaretOffset(el) {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return 0;
        const range = sel.getRangeAt(0);
        if (!el.contains(range.startContainer)) return 0;
        const preRange = range.cloneRange();
        preRange.selectNodeContents(el);
        preRange.setEnd(range.startContainer, range.startOffset);
        return preRange.toString().length;
    },

    setRichCaretOffset(el, offset) {
        const sel = window.getSelection();
        if (!sel) return;
        const range = document.createRange();
        let currentPos = 0;
        let nodeStack = [el], node, found = false;

        while (!found && (node = nodeStack.pop())) {
            if (node.nodeType === 3) {
                const nextPos = currentPos + node.length;
                if (offset >= currentPos && offset <= nextPos) {
                    const pos = Math.min(node.length, Math.max(0, offset - currentPos));
                    range.setStart(node, pos);
                    range.setEnd(node, pos);
                    found = true;
                }
                currentPos = nextPos;
            } else if (node.nodeType === 1 && node.classList.contains('lm-op-tag')) {
                const nextPos = currentPos + 1;
                if (offset === currentPos || offset === nextPos) {
                    range.setStartAfter(node);
                    range.setEndAfter(node);
                    found = true;
                }
                currentPos = nextPos;
            } else {
                let i = node.childNodes.length;
                while (i--) {
                    nodeStack.push(node.childNodes[i]);
                }
            }
        }
        if (!found) {
            range.selectNodeContents(el);
            range.collapse(false);
        }
        sel.removeAllRanges();
        sel.addRange(range);
    },

    handleRichKeydown(event, el) {
        if (event.key === 'Enter') {
            event.preventDefault();
            return;
        }
        if (event.key === 'Backspace') {
            const sel = window.getSelection();
            if (sel && sel.rangeCount) {
                const range = sel.getRangeAt(0);
                if (range.collapsed) {
                    const node = range.startContainer;
                    const offset = range.startOffset;
                    if (node.nodeType === 3 && offset === 0 && node.previousSibling && node.previousSibling.classList?.contains('lm-op-tag')) {
                        event.preventDefault();
                        node.previousSibling.remove();
                        this.triggerSearchFromElement(el);
                        return;
                    }
                    if (node.nodeType === 1 && offset > 0) {
                        const targetChild = node.childNodes[offset - 1];
                        if (targetChild && targetChild.classList?.contains('lm-op-tag')) {
                            event.preventDefault();
                            targetChild.remove();
                            this.triggerSearchFromElement(el);
                            return;
                        }
                    }
                }
            }
        }
    },

    handleRichCopy(event, el) {
        if (!el) return;
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;

        const range = sel.getRangeAt(0);
        const fullText = this.getRichInputValue(el).replace(/[\u200B\u00A0]/g, ' ').trim();
        const selectedText = sel.toString().replace(/[\u200B\u00A0]/g, ' ').trim();

        // 当全选或选区从最开始节点延伸时，确保克隆包含首个标签在内的所有内容
        const isSelectAll = (selectedText.length >= fullText.length - 2) ||
                            (range.startContainer === el && range.startOffset <= 1) ||
                            (range.startContainer === el.firstChild) ||
                            (el.firstChild && el.firstChild.contains(range.startContainer));

        const container = document.createElement('div');
        if (isSelectAll) {
            container.innerHTML = el.innerHTML;
        } else {
            for (let i = 0; i < sel.rangeCount; i++) {
                container.appendChild(sel.getRangeAt(i).cloneContents());
            }
        }

        let text = '';
        const walk = (node) => {
            if (node.nodeType === 3) {
                text += node.nodeValue;
            } else if (node.nodeType === 1) {
                if (node.classList.contains('lm-op-tag')) {
                    const op = node.getAttribute('data-op') || node.textContent.trim();
                    text += `${op} `;
                } else {
                    for (let child of node.childNodes) walk(child);
                }
            }
        };
        walk(container);

        const cleanText = text.replace(/[\u200B\u00A0]/g, ' ').replace(/\s+/g, ' ').trim();
        if (cleanText) {
            event.preventDefault();
            (event.clipboardData || window.clipboardData)?.setData('text/plain', cleanText);
            if (event.type === 'cut') {
                if (isSelectAll) {
                    el.innerHTML = '';
                } else {
                    document.execCommand('delete');
                }
                this.formatRichInput(el, true);
                this.triggerSearchFromElement(el);
            }
        }
    },

    handleRichPaste(event, el) {
        if (!el) return;
        event.preventDefault();
        const text = (event.clipboardData || window.clipboardData)?.getData('text/plain') || '';
        if (!text) return;

        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
            const range = sel.getRangeAt(0);
            range.deleteContents();
            const textNode = document.createTextNode(text);
            range.insertNode(textNode);
            range.setStartAfter(textNode);
            range.setEndAfter(textNode);
            sel.removeAllRanges();
            sel.addRange(range);
        } else {
            const curVal = this.getRichInputValue(el);
            this.setRichInputValue(el, curVal + text);
        }

        this.formatRichInput(el, true);
        this.triggerSearchFromElement(el);
    },

    triggerSearchFromElement(el) {
        if (!el) return;
        if (el.id === 'lm-quick-search') {
            this.handleQuickSearch({ target: el });
        } else if (el.id === 'lm-search-input') {
            this.applyFilters();
        } else if (el.id === 'lm-remaster-search') {
            this.setRemasterSearch(el);
        }
    },

    hasSearchSyntaxError(expression) {
        const rawStr = String(expression || '').trim();
        if (!rawStr) return false;
        const tokens = this.tokenizeSearchExpression(rawStr);
        if (!tokens || !tokens.length) return false;
        const hasOperators = tokens.some(t => t.type !== 'term');
        if (!hasOperators) return false;
        return this.parseSearchExpression(rawStr) === null;
    },

    updateSearchInputErrorState(el, keyword) {
        if (!el) return;
        const isError = this.hasSearchSyntaxError(keyword);
        if (isError) {
            el.classList.add('lm-search-input-error');
            el.title = '布尔表达式语法错误（例如：括号未闭合、缺少逻辑关键词等）';
        } else {
            el.classList.remove('lm-search-input-error');
            el.title = '';
        }
    },

    parseSearchExpression(expression) {
        const tokens = this.tokenizeSearchExpression(expression);
        if (!tokens || !tokens.length) return null;
        let position = 0;

        const parsePrimary = () => {
            const token = tokens[position];
            if (!token) return null;
            if (token.type === 'term') {
                position += 1;
                return { type: 'term', value: token.value };
            }
            if (token.type !== 'leftParen') return null;
            position += 1;
            const node = parseOr();
            if (!node || tokens[position]?.type !== 'rightParen') return null;
            position += 1;
            return node;
        };

        const parseNot = () => {
            if (tokens[position]?.type !== 'not') return parsePrimary();
            position += 1;
            const child = parseNot();
            return child ? { type: 'not', child } : null;
        };

        const parseAnd = () => {
            let node = parseNot();
            if (!node) return null;
            while (tokens[position]?.type === 'and') {
                position += 1;
                const right = parseNot();
                if (!right) return null;
                node = { type: 'and', left: node, right };
            }
            return node;
        };

        const parseOr = () => {
            let node = parseAnd();
            if (!node) return null;
            while (tokens[position]?.type === 'or') {
                position += 1;
                const right = parseAnd();
                if (!right) return null;
                node = { type: 'or', left: node, right };
            }
            return node;
        };

        const root = parseOr();
        return root && position === tokens.length ? root : null;
    },

    createSearchMatcher(expression) {
        const normalizedExpression = String(expression || '').trim().toLowerCase();
        if (!normalizedExpression) return () => true;
        const tree = this.parseSearchExpression(normalizedExpression);
        const fallbackTerm = normalizedExpression;

        const evaluate = (node, values) => {
            if (!node) return values.some(value => value.includes(fallbackTerm));
            switch (node.type) {
                case 'term':
                    return values.some(value => value.includes(node.value));
                case 'not':
                    return !evaluate(node.child, values);
                case 'and':
                    return evaluate(node.left, values) && evaluate(node.right, values);
                case 'or':
                    return evaluate(node.left, values) || evaluate(node.right, values);
                default:
                    return false;
            }
        };

        return rawValues => {
            const values = rawValues.map(value => String(value || '').toLowerCase());
            return evaluate(tree, values);
        };
    },

    getSearchValues(item, includeQuality = false) {
        const values = [item.name, item.singer, item.album, item.filename];
        if (item.subPath) values.push(item.subPath);
        if (includeQuality) values.push(item.quality);
        return values;
    },

    getItemKey(item) {
        return `${item.folder}\u0000${item.filename}`;
    },

    getSelectedEntries() {
        return this.originalData.filter(item => this.selectedItems.has(this.getItemKey(item)));
    },

    getSelectedFilenames() {
        return this.getSelectedEntries().map(item => item.filename);
    },

    bindListEvents() {
        if (this.listEventsBound) return;
        const container = document.getElementById('lm-list-container');
        if (!container) return;
        this.listEventsBound = true;
        container.addEventListener('click', (event) => {
            if (this.isCustomDirMode) return;
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
                case 'login':
                    this.openSyncLogin();
                    break;
            }
        });
        container.addEventListener('change', (event) => {
            if (this.isCustomDirMode) return;
            const target = event.target;
            if (!target.matches('[data-lm-action="select"]')) return;
            this.toggleSelect(parseInt(target.dataset.lmIndex || '', 10), target.checked);
        });
    },

    saveFilters() {
        const filters = {
            searchKeyword: this.searchKeyword,
            filterFolder: this.filterFolder,
            filterQuality: Array.from(this.filterQuality),
            filterStatus: Array.from(this.filterStatus),
            filterSource: Array.from(this.filterSource),
            sortBy: this.sortBy,
            sortOrder: this.sortOrder,
            selectedSubPath: this.selectedSubPath
        };
        localStorage.setItem(this.cacheKey, JSON.stringify(filters));
    },

    loadFilters() {
        try {
            const cached = localStorage.getItem(this.cacheKey);
            if (cached) {
                const filters = JSON.parse(cached);
                this.searchKeyword = filters.searchKeyword || '';
                this.filterFolder = filters.filterFolder || 'all';
                const toSet = (v) => {
                    if (!v || v === 'all') return new Set();
                    if (Array.isArray(v)) return new Set(v);
                    return new Set([v]);
                };
                this.filterQuality = toSet(filters.filterQuality);
                this.filterStatus = toSet(filters.filterStatus);
                this.filterSource = toSet(filters.filterSource);
                this.sortBy = filters.sortBy || 'mtime';
                this.sortOrder = filters.sortOrder || 'desc';
                this.selectedSubPath = filters.selectedSubPath || '';

                // Update UI elements
                if (document.getElementById('lm-search-input')) this.setRichInputValue(document.getElementById('lm-search-input'), this.searchKeyword);
                
                ['lm-sort-by', 'lm-sort-order', 'lm-folder-select'].forEach(id => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    if (id === 'lm-sort-by') el.value = this.sortBy;
                    if (id === 'lm-sort-order') el.value = this.sortOrder;
                    if (id === 'lm-folder-select') el.value = this.filterFolder;
                    this._syncSelectActive(id);
                    if (window.CustomSelectManager && typeof window.CustomSelectManager.syncUI === 'function') {
                        window.CustomSelectManager.syncUI(el);
                    }
                });

                // 标签按钮 UI 更新
                this._syncTagUI('lm-quality-tags', this.filterQuality);
                this._syncTagUI('lm-source-tags', this.filterSource);
                this._syncTagUI('lm-status-tags', this.filterStatus);

                const subPathText = document.getElementById('lm-subpath-text');
                if (subPathText) {
                    let displayText = this.selectedSubPath;
                    if (this.selectedSubPath === '') displayText = '全部';
                    else if (this.selectedSubPath === '__ROOT__') displayText = '根目录';
                    subPathText.innerText = displayText;
                }
            }
        } catch (e) {
            console.error('Failed to load cached filters:', e);
        }
    },

    // 同步标签按钮的激活状态
    _syncTagUI(containerId, filterSet) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.querySelectorAll('[data-filter-value]').forEach(btn => {
            const val = btn.dataset.filterValue;
            if (filterSet.has(val)) {
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
            folder: 'filterFolder',
            status: 'filterStatus'
        };
        const tagContainerMap = {
            quality: 'lm-quality-tags',
            source: 'lm-source-tags',
            folder: 'lm-folder-tags',
            status: 'lm-status-tags'
        };
        const prop = setMap[filterKey];
        if (!prop) return;
        const set = this[prop];
        if (set.has(value)) {
            set.delete(value);
        } else {
            set.add(value);
        }
        this._syncTagUI(tagContainerMap[filterKey], set);
        this.applyFilters();
    },

    // 同步 select 下拉框的激活状态样式
    _syncSelectActive(id) {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.value !== 'all' && el.value !== 'mtime' && el.value !== 'desc') {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    },

    isViewingPublicSongs: false,

    getCurrentUsername() {
        return this.isViewingPublicSongs ? '_open' : ((window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '_open');
    },

    togglePublicSongs() {
        this.isViewingPublicSongs = !this.isViewingPublicSongs;
        this.syncPublicSongsBtn();
        if (typeof showInfo === 'function') {
            showInfo(this.isViewingPublicSongs ? '已切换至【公开歌曲】库 (_open)' : '已切换至【个人本地歌曲】');
        }
        this.fetchData();
    },

    syncPublicSongsBtn() {
        const btn = document.getElementById('lm-public-songs-btn');
        if (!btn) return;
        const enablePublicFavorites = !!window.lx_config?.['user.enablePublicFavorites'];
        const enablePublicNonAdminAccess = !!window.lx_config?.['user.enablePublicNonAdminAccess'];
        const isAdmin = !!localStorage.getItem('lx_admin_password');
        const isLoggedIn = typeof window.isUserLoggedIn === 'function' ? window.isUserLoggedIn() : false;
        if (enablePublicFavorites && (isLoggedIn || isAdmin || enablePublicNonAdminAccess)) {
            btn.classList.remove('hidden');
            const label = this.isViewingPublicSongs ? '公开歌曲 (已开启)' : '公开歌曲';
            btn.title = label;
            const baseClass = 'text-[9px] md:text-[10px] font-bold px-1.5 md:px-2 py-0.5 rounded-lg transition-all inline-flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap w-auto self-center h-fit';
            if (this.isViewingPublicSongs) {
                btn.className = `${baseClass} bg-emerald-500 text-white shadow-sm`;
                btn.innerHTML = `<i class="fas fa-globe text-[10px]"></i><span class="hidden sm:inline md:hidden 2xl:inline">${label}</span>`;
            } else {
                btn.className = `${baseClass} bg-gray-100/50 dark:bg-gray-700/30 text-gray-600 dark:text-gray-300 border t-border-main hover:text-emerald-500`;
                btn.innerHTML = `<i class="fas fa-globe text-[10px]"></i><span class="hidden sm:inline md:hidden 2xl:inline">${label}</span>`;
            }
        } else {
            btn.classList.add('hidden');
        }
    },

    init() {
        // Initialization can run when the tab is clicked, or immediately.
        // Try reading global cache location to sync the selector.
        this.syncLocationSelector();
        this.loadFilters();
        this.bindListEvents();
        this.syncPublicSongsBtn();
        this.fetchData();
        this.syncRemasterVisibility();

        // Listen to tab switch to trigger refresh if we are on this tab
        const origSwitchTab = window.switchTab;
        window.switchTab = function (tabId) {
            if (typeof origSwitchTab === 'function') {
                origSwitchTab(tabId);
            }
            if (tabId === 'localmusic') {
                window.LocalMusicManager.syncLocationSelector();
                window.LocalMusicManager.loadFilters();
                window.LocalMusicManager.syncPublicSongsBtn();
                window.LocalMusicManager.fetchData(true); // silent fetch
            } else {
                // Auto exit batch mode when leaving
                if (window.LocalMusicManager.batchMode) {
                    window.LocalMusicManager.toggleBatchMode();
                }
            }
        };
    },

    syncLocationSelector() {
        // Let's assume 'data' or 'root' based on the config. 
        // We might not have async config sync in UI immediately, but we can read from global.
        // Fallback: we fetch stats or just assume what we get.
        // Setting it via API is the most robust way.
    },

    async changeLocation() {
        const el = document.getElementById('lm-location-select');
        const val = el.value;
        try {
            await fetch('/api/music/cache/config', {
                method: 'POST',
                headers: window.getUserAuthHeaders ? window.getUserAuthHeaders() : {},
                body: JSON.stringify({ location: val })
            });
            // Reset subpath when changing location
            this.selectedSubPath = '';
            const subPathText = document.getElementById('lm-subpath-text');
            if (subPathText) subPathText.innerText = '全部';

            this.refresh();
        } catch (e) {
            if (typeof showError === 'function') showError('切换目录失败');
        }
    },

    changeFolder() {
        const el = document.getElementById('lm-folder-select');
        this.filterFolder = el.value;
        this.applyFilters();
    },

    toggleUnindexed() {
        const el = document.getElementById('lm-unindexed-filter');
        this.filterUnindexed = el.checked;
        this.applyFilters();
    },

    debounceSearch() {
        if (this.searchTimer) clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => {
            const el = document.getElementById('lm-search-input');
            this.searchKeyword = (el.value || '').trim().toLowerCase();
            this.applyFilters();
        }, 300);
    },

    async refresh() {
        const btn = document.querySelector('button[title="同步并刷新"] i');
        if (btn) btn.classList.add('fa-spin');

        try {
            // First trigger sync on server
            if (typeof showInfo === 'function') showInfo('正在同步物理文件...');
            const syncRes = await fetch('/api/music/cache/sync', {
                method: 'POST',
                headers: window.getUserAuthHeaders ? window.getUserAuthHeaders() : {}
            });
            const syncResult = await syncRes.json();
            if (!syncResult.success) {
                console.warn('Sync failed:', syncResult.message);
            }
        } catch (e) {
            console.error('Sync request error:', e);
        }

        await this.fetchData();
        if (btn) btn.classList.remove('fa-spin');
    },

    toggleFilterPanel() {
        const panel = document.getElementById('lm-filter-panel');
        const btn = document.getElementById('lm-filter-toggle-btn');
        this.isFilterPanelOpen = !this.isFilterPanelOpen;

        if (this.isFilterPanelOpen) {
            if (panel) panel.classList.remove('hidden');
            if (btn) btn.classList.add('t-bg-main', 'shadow-inner');
        } else {
            if (panel) panel.classList.add('hidden');
            if (btn) btn.classList.remove('t-bg-main', 'shadow-inner');
        }
    },

    handleQuickSearch(e) {
        const el = e?.target || document.getElementById('lm-quick-search');
        if (el) this.formatRichInput(el);
        const val = this.getRichInputValue(el);
        this.updateSearchInputErrorState(el, val);
        this.quickSearchKeyword = val.trim().toLowerCase();
        this.applyFilters();
    },

    resetFilters(apply = true) {
        this.searchKeyword = '';
        this.quickSearchKeyword = '';
        this.filterFolder = 'all';
        this.filterQuality = new Set();
        this.filterStatus = new Set();
        this.filterSource = new Set();
        this.sortBy = 'mtime';
        this.sortOrder = 'desc';

        const si = document.getElementById('lm-search-input');
        if (si) {
            this.setRichInputValue(si, '');
            this.updateSearchInputErrorState(si, '');
        }
        const qs = document.getElementById('lm-quick-search');
        if (qs) {
            this.setRichInputValue(qs, '');
            this.updateSearchInputErrorState(qs, '');
        }
        const sortBy = document.getElementById('lm-sort-by');
        if (sortBy) sortBy.value = 'mtime';
        const sortOrder = document.getElementById('lm-sort-order');
        if (sortOrder) sortOrder.value = 'desc';

        if (document.getElementById('lm-folder-select')) {
            document.getElementById('lm-folder-select').value = 'all';
            this._syncSelectActive('lm-folder-select');
        }

        // 清空所有标签按钮激活状态
        this._syncTagUI('lm-quality-tags', this.filterQuality);
        this._syncTagUI('lm-source-tags', this.filterSource);
        this._syncTagUI('lm-status-tags', this.filterStatus);

        this.selectedSubPath = '';
        const subPathText = document.getElementById('lm-subpath-text');
        if (subPathText) subPathText.innerText = '\u5168\u90e8';

        localStorage.removeItem(this.cacheKey);
        const activeDot = document.getElementById('lm-filter-active-dot');
        if (activeDot) activeDot.classList.add('hidden');
        if (apply) this.applyFilters();
    },

    clearFilters() {
        this.resetFilters();
    },

    showNoPermissionState() {
        this.originalData = [];
        this.displayData = [];
        this.updatePagination();
        const countEl = document.getElementById('lm-total-count');
        if (countEl) countEl.innerText = '0 首';
        const container = document.getElementById('lm-list-container');
        if (container) {
            container.innerHTML = `
                <div class="text-center py-20 text-gray-500 animate-fade-in">
                    <i class="fas fa-lock text-4xl mb-4 text-amber-500/80"></i>
                    <p class="font-bold tracking-wider text-base t-text-main mb-1">您没有权限查看此目录，请联系管理员设置</p>
                </div>`;
        }
        const pagination = document.getElementById('lm-pagination');
        if (pagination) pagination.classList.add('hidden');
    },

    async fetchData(silent = false) {
        const isLoggedIn = typeof window.isUserLoggedIn === 'function' ? window.isUserLoggedIn() : false;
        const isAdmin = !!localStorage.getItem('lx_admin_password');
        const enablePublicNonAdminLocalMusic = !!window.lx_config?.['user.enablePublicNonAdminLocalMusic'];

        if (!isLoggedIn && !isAdmin && !enablePublicNonAdminLocalMusic) {
            this.showNoPermissionState();
            return;
        }

        if (!silent) {
            const container = document.getElementById('lm-list-container');
            if (container) {
                container.innerHTML = `
                    <div class="text-center py-20 text-gray-500 animate-fade-in">
                        <i class="fas fa-circle-notch fa-spin text-4xl mb-4 text-emerald-500"></i>
                        <p class="font-bold tracking-wider">正在加载本地音乐...</p>
                    </div>`;
            }
        }

        try {
            const requestList = () => {
                const headers = window.getUserAuthHeaders ? window.getUserAuthHeaders() : {};
                if (this.isViewingPublicSongs) {
                    headers['x-user-name'] = '_open';
                }
                const url = `/api/music/cache/list${this.isViewingPublicSongs ? '?user=_open' : ''}`;
                return fetch(url, { headers, cache: 'no-store' });
            };

            let res = await requestList();
            if (res.status === 401 && typeof window.ensureUserAuthToken === 'function') {
                const refreshed = await window.ensureUserAuthToken({ force: true });
                if (refreshed) res = await requestList();
            }

            if (res.status === 401) {
                this.showAuthExpiredState();
                return;
            }

            const result = await res.json();
            if (result.success) {
                this.authExpired = false;
                this.authExpiredNotified = false;
                this.originalData = result.data || [];
                // Sort by mtime initially descending
                this.originalData.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
                this.applyFilters();
                this.pruneRemasterSelection();
                if (document.getElementById('lm-remaster-modal')?.classList.contains('flex')) {
                    this.renderRemasterSelection();
                }

                // Attempt to auto-sync location switch UI if not selected manually
                // (Only works if we know somehow what the backend uses, but we can ignore for now)
            } else {
                throw new Error(result.message || 'Failed to fetch local music');
            }
        } catch (err) {
            if (typeof showError === 'function') showError('拉取本地列表失败');
            console.error('LocalMusic Fetch Error:', err);
        }
    },

    showAuthExpiredState() {
        this.authExpired = true;
        this.originalData = [];
        this.displayData = [];
        this.updatePagination();
        const countEl = document.getElementById('lm-total-count');
        if (countEl) countEl.innerText = '登录已失效';
        this.render();
        if (!this.authExpiredNotified && typeof showError === 'function') {
            showError('同步账户登录已失效，请重新登录');
            this.authExpiredNotified = true;
        }
    },

    openSyncLogin() {
        if (typeof window.showSyncModeModal === 'function') {
            window.showSyncModeModal();
        } else if (typeof showError === 'function') {
            showError('请在设置中重新登录同步账户');
        }
    },

    applyFilters() {
        let current = this.originalData;
        this.currentPage = 1;

        // 2. Read current filter values from input
        const searchInput = document.getElementById('lm-search-input');
        if (searchInput) {
            this.formatRichInput(searchInput);
            const val = this.getRichInputValue(searchInput);
            this.updateSearchInputErrorState(searchInput, val);
            this.searchKeyword = val.trim().toLowerCase();
        }

        const sortBySelect = document.getElementById('lm-sort-by');
        if (sortBySelect) this.sortBy = sortBySelect.value;
        const sortOrderSelect = document.getElementById('lm-sort-order');
        if (sortOrderSelect) this.sortOrder = sortOrderSelect.value;

        // [New] Save to localStorage
        this.saveFilters();

        const searchMatcher = this.createSearchMatcher(this.searchKeyword);
        const quickSearchMatcher = this.createSearchMatcher(this.quickSearchKeyword);

        // 3. Apply Filters（多选 Set，空集合表示不限制；Folder 为单选）
        current = current.filter(item => {
            // Folder check（单选）
            if (this.filterFolder !== 'all' && item.folder !== this.filterFolder) return false;

            // Quality check（多选）
            if (this.filterQuality.size > 0 && !this.filterQuality.has(item.quality)) return false;

            // Source check（多选）
            const displayedSource = item.downloadSource || item.source;
            if (this.filterSource.size > 0 && !this.filterSource.has(displayedSource)) return false;

            // Metadata Status check（多选：任意一个条件命中即显示）
            if (this.filterStatus.size > 0) {
                const isUnindexed = item.source === 'unknown' || (item.songmid && item.songmid.includes(' - '));
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
                // 只要勾选的状态中任一命中即保留（OR 逻辑）
                const matched = Array.from(this.filterStatus).some(s => statusMap[s]);
                if (!matched) return false;
            }

            const searchValues = this.getSearchValues(item);
            if (!searchMatcher(searchValues)) return false;
            if (!quickSearchMatcher(searchValues)) return false;

            // SubPath check
            if (this.selectedSubPath !== '') {
                const target = this.selectedSubPath === '__ROOT__' ? '' : this.selectedSubPath;
                if ((item.subPath || '') !== target) return false;
            }

            return true;
        });

        // 3.0.1 Update SubPath Button State
        const subPathBtn = document.getElementById('lm-subpath-btn');
        if (subPathBtn) {
            if (this.filterFolder !== 'music') {
                if (this.selectedSubPath !== '') {
                    this.selectedSubPath = '';
                    const subPathText = document.getElementById('lm-subpath-text');
                    if (subPathText) subPathText.innerText = '全部';
                    // Re-filter if we just reset
                    return setTimeout(() => window.LocalMusicManager.applyFilters(), 0);
                }
            }
        }

        // 3.1 Apply Sorting
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
                case 'source':
                    valA = (a.source || '').toLowerCase();
                    valB = (b.source || '').toLowerCase();
                    break;
                case 'size':
                    valA = a.size || 0;
                    valB = b.size || 0;
                    break;
                case 'subPath':
                    valA = (a.subPath || '').toLowerCase();
                    valB = (b.subPath || '').toLowerCase();
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

        // 4. Update UI Indicator
        const dot = document.getElementById('lm-filter-active-dot');
        const hasActiveFilters = this.searchKeyword || this.quickSearchKeyword || this.filterQuality.size > 0 || this.filterFolder !== 'all' || this.filterStatus.size > 0 || this.filterSource.size > 0;
        if (dot) {
            if (hasActiveFilters) dot.classList.remove('hidden');
            else dot.classList.add('hidden');
        }

        // 同步所有 select 的 active 状态（非 all 时背景高亮）
        this._syncSelectActive('lm-folder-select');
        this._syncSelectActive('lm-sort-by');
        this._syncSelectActive('lm-sort-order');

        const countEl = document.getElementById('lm-total-count');
        if (countEl) countEl.innerText = `共 ${current.length} 首`;

        this.displayData = current;

        // Clean up selected items that are no longer in display
        const displayIdentifiers = new Set(this.displayData.map(item => this.getItemKey(item)));
        for (const sel of this.selectedItems) {
            if (!displayIdentifiers.has(sel)) {
                this.selectedItems.delete(sel);
            }
        }
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
        this.bindListEvents();

        if (this.authExpired) {
            this.updatePagination();
            if (typeof window.unobserveLazyImages === 'function') {
                window.unobserveLazyImages(container);
            }
            container.innerHTML = `
                <div class='text-center py-20 text-gray-500'>
                    <i class='fas fa-user-lock text-4xl mb-4 opacity-50'></i>
                    <p class='font-bold t-text-main mb-2'>同步账户登录已失效</p>
                    <p class='text-xs mb-5'>请重新登录后加载本地音乐</p>
                    <button data-lm-action='login' class='h-9 px-4 rounded-md bg-emerald-500 text-white hover:bg-emerald-600 transition-colors'>
                        <i class='fas fa-sign-in-alt mr-1.5'></i>重新登录
                    </button>
                </div>`;
            return;
        }

        if (this.displayData.length === 0) {
            this.updatePagination();
            if (typeof window.unobserveLazyImages === 'function') {
                window.unobserveLazyImages(container);
            }
            container.innerHTML = `
                <div class="text-center py-20 text-gray-500">
                    <i class="fas fa-inbox text-4xl mb-4 opacity-50"></i>
                    <p>没有找到相关本地音乐</p>
                </div>`;
            return;
        }

        const username = this.getCurrentUsername();
        const page = this.getPageSlice();
        this.updatePagination();

        let html = '';
        page.list.forEach((item, pageIndex) => {
            const index = page.start + pageIndex;
            const safeName = this.escapeHtml(item.name || '未知歌曲');
            const safeSinger = this.escapeHtml(item.singer || '未知歌手');
            const safeAlbum = this.escapeHtml(item.album || '--');
            const displayedSource = item.downloadSource || item.source;
            const safeSource = this.escapeHtml(displayedSource === 'unknown' ? '未知' : (displayedSource || ''));
            const sourceTitle = item.downloadSource && item.downloadSource !== item.source
                ? `下载来源：${item.downloadSource}；歌曲平台：${item.source || '未知'}`
                : `歌曲平台：${item.source || '未知'}`;
            const safeSourceTitle = this.escapeAttr(sourceTitle);
            const safeSubPath = this.escapeHtml(item.subPath || '');
            const isUnindexed = item.source === 'unknown' || (item.songmid && item.songmid.includes(' - '));
            const isNoTag = (n) => !n || n === '未知歌曲' || n === '未知歌手' || n.toLowerCase() === 'unknown';
            const missingID3 = isNoTag(item.name) || isNoTag(item.singer) || isUnindexed;
            const missingCover = !item.hasCover;
            const missingLyric = !item.hasLyric && !item.lyricFilename;
            const metadataUnsupported = item.metadataWritable === false;
            const coverStatusTitle = item.coverType === 'embedded'
                ? '封面已嵌入音频标签'
                : item.coverType === 'cached'
                    ? '封面使用服务端持久缓存'
                    : item.coverType === 'remote'
                        ? '封面将在显示时从音源获取并缓存'
                        : '已有封面';
            const lyricStatusBadge = item.hasEmbedLyric
                ? '<span class="text-[10px] text-emerald-500 border border-gray-400/40 dark:border-gray-600/50 rounded px-1 scale-90 hidden sm:inline-block" title="已嵌入歌词标签">词</span>'
                : metadataUnsupported && item.hasLyric
                    ? `<span class="text-[10px] text-amber-500 border border-amber-400/40 rounded px-1 scale-90 hidden sm:inline-block" title="${this.escapeAttr(item.embedLyricError || item.metadataError || '音频容器不支持嵌入歌词，已保留外置歌词')}">外置词</span>`
                    : '';

            const isSelected = this.selectedItems.has(this.getItemKey(item));
            const qualityClass = window.QualityManager && window.QualityManager.getQualityColor ? window.QualityManager.getQualityColor(item.quality) : 'bg-gray-100 text-gray-600';
            const qualityName = window.QualityManager ? window.QualityManager.getQualityDisplayName(item.quality) : item.quality;

            let coverHtml = `<div class="w-10 h-10 md:w-12 md:h-12 rounded-lg bg-gray-100/50 flex-shrink-0 flex items-center justify-center border t-border-main mr-2.5 md:mr-4 ml-0.5 md:ml-3">
                                <i class="fas fa-music t-text-muted text-xs"></i>
                             </div>`;
            if (item.hasCover) {
                const authToken = (window.getUserAuthHeaders ? window.getUserAuthHeaders()['x-user-token'] : null) || localStorage.getItem('lx_user_token') || '';
                const coverVersion = [
                    item.coverCheckedVersion || 0,
                    Math.round(item.coverCheckedMtime || item.mtime || 0),
                    item.coverCheckedSize || item.size || 0,
                    1
                ].join('-');
                const coverUrl = `/api/music/cache/cover?filename=${encodeURIComponent(item.filename)}&user=${encodeURIComponent(username)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}&v=${encodeURIComponent(coverVersion)}`;
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

            const folderIcon = item.folder === 'music' ? '<i class="fas fa-download text-blue-500 mr-1" title="下载目录"></i>' : '<i class="fas fa-hdd text-emerald-500 mr-1" title="缓存目录"></i>';

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
                            ${item.subPath ? `<span class="t-text-muted opacity-50 truncate max-w-[50px] sm:max-w-[80px] italic text-[9px] shrink min-w-0" title="${safeSubPath}">${safeSubPath}</span>` : ''}
                            
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
                    ${item.subPath ? `<div class="text-[9px] text-emerald-500 font-mono truncate mb-1" title="${safeSubPath}"><i class="far fa-folder mr-1 opacity-70"></i>${safeSubPath}</div>` : ''}
                    <div class="flex flex-wrap gap-1">
                        ${missingID3 ? '<span class="px-1 py-0 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 rounded text-[9px] font-bold">缺标签</span>' : ''}
                        ${missingCover ? '<span class="px-1 py-0 bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 rounded text-[9px] font-bold">缺封面</span>' : ''}
                        ${missingLyric ? '<span class="px-1 py-0 bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400 rounded text-[9px] font-bold">缺词</span>' : ''}
                        ${metadataUnsupported && !missingLyric ? `<span class="px-1 py-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded text-[9px] font-bold" title="${this.escapeAttr(item.embedLyricError || item.metadataError || '音频容器不支持写入标签')}">仅外置词</span>` : ''}
                        ${(!missingID3 && !missingCover && !missingLyric) ? '<span class="px-1 py-0 bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 rounded text-[9px] font-bold">完整</span>' : ''}
                    </div>
                    <div class="text-[9px] mt-1 opacity-70 scale-90 origin-left">${formatTime(item.mtime)}</div>
                </div>

                <!-- Action Button -->
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
                    <!-- Download -->
                    <button data-lm-action="download" data-lm-index="${index}"
                            class="w-7 h-7 flex items-center justify-center rounded-full t-bg-main border t-border-main t-text-main hover:text-blue-500 hover:border-blue-300 transition-all shadow-sm shrink-0" title="保存到设备">
                        <i class="fas fa-download text-[10px]"></i>
                    </button>
                    <button data-lm-action="playlist" data-lm-index="${index}"
                            class="w-7 h-7 flex items-center justify-center rounded-full t-bg-main border t-border-main text-emerald-500 hover:bg-emerald-50 hover:border-emerald-300 transition-all shadow-sm shrink-0" title="添加到歌单">
                        <i class="fas fa-plus text-[10px]"></i>
                    </button>
                    <!-- Deletion from single operations -->
                    ${(!this.isCustomDirMode || !!window.userAllowOperateCustomDir) ? `
                    <button data-lm-action="delete" data-lm-index="${index}"
                            class="w-7 h-7 flex items-center justify-center rounded-full t-bg-main border t-border-main t-text-muted hover:text-red-500 hover:border-red-300 transition-all shadow-sm shrink-0" title="删除">
                        <i class="far fa-trash-alt text-[10px]"></i>
                    </button>
                    ` : ''}
                </div>
            </div>
            `;
        });

        if (typeof window.unobserveLazyImages === 'function') {
            window.unobserveLazyImages(container);
        }
        container.innerHTML = html;
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

    toggleSelect(index, checked) {
        const item = this.displayData[index];
        if (!item) return;
        const key = this.getItemKey(item);
        if (checked) {
            this.selectedItems.add(key);
        } else {
            this.selectedItems.delete(key);
        }

        // Update DOM visually immediately if possible
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

                // [New] Show categorize button only for music folder
                const catBtn = document.getElementById('lm-batch-categorize-btn');
                if (catBtn) {
                    if (this.filterFolder === 'music') catBtn.classList.remove('hidden');
                    else catBtn.classList.add('hidden');
                }
            } else {
                tb.classList.add('hidden');
                tb.classList.remove('flex');
            }
        }

        this.updateBatchUI();
        this.render(); // Re-render to show/hide checkboxes globally
    },

    toggleReMapping() {
        this.enableReMapping = !this.enableReMapping;

        // Update button UI style
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

    selectAll() {
        this.displayData.forEach(item => this.selectedItems.add(this.getItemKey(item)));
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

    getPlaylistPlatformIdentity(item) {
        const songInfo = item?.songInfo || {};
        const meta = songInfo.meta || item?.meta || {};
        const source = String(songInfo.source || item?.source || meta.source || '').trim().toLowerCase();
        if (!source || source === 'unknown' || source === 'local' || source === 'temp') return null;

        const prefix = `${source}_`;
        const candidates = [
            songInfo.songmid,
            songInfo.id,
            item?.songmid,
            item?.id,
            meta.songId
        ];

        for (const candidate of candidates) {
            const value = String(candidate || '').trim();
            if (!value) continue;

            const platformId = value.startsWith(prefix)
                ? value.slice(prefix.length)
                : candidate === meta.songId
                    ? value
                    : '';
            if (!platformId || /\s/.test(platformId) || /^(unknown|local|temp|undefined|null)$/i.test(platformId)) continue;

            return {
                source,
                platformId,
                id: `${source}_${platformId}`
            };
        }

        return null;
    },

    isPlaylistCollectable(item) {
        return !!this.getPlaylistPlatformIdentity(item);
    },

    buildPlaylistSong(item) {
        const songInfo = item?.songInfo || {};
        const identity = this.getPlaylistPlatformIdentity(item);
        if (!identity) return null;
        const quality = item?.quality || songInfo.quality || songInfo.type || '128k';
        let types = songInfo.types;

        if (Array.isArray(types)) {
            types = types.map(type => typeof type === 'object' ? { ...type } : type);
            if (!types.some(type => (type?.type || type) === quality)) {
                types.push({ type: quality, size: item?.size || 0 });
            }
        } else {
            types = { ...(types || {}) };
            if (!types[quality]) types[quality] = { size: item?.size || 0 };
        }

        return {
            ...songInfo,
            id: identity.id,
            songmid: identity.platformId,
            songId: identity.platformId,
            name: item.name || songInfo.name,
            singer: item.singer || songInfo.singer,
            source: identity.source,
            albumName: item.album || songInfo.albumName || '',
            albumId: item.albumId || songInfo.albumId,
            img: item.img || songInfo.img,
            interval: item.interval || songInfo.interval,
            quality,
            type: quality,
            types,
            _localLibraryItem: true
        };
    },

    batchAddToPlaylist() {
        const targets = this.getSelectedEntries();
        if (targets.length === 0) {
            if (typeof showInfo === 'function') showInfo('请先选择要加入歌单的歌曲');
            return;
        }

        const collectableTargets = targets.filter(item => this.isPlaylistCollectable(item));
        const unavailableCount = targets.length - collectableTargets.length;
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

        window.openPlaylistAddModal(collectableTargets.map(item => this.buildPlaylistSong(item)).filter(Boolean));
    },

    addItemToPlaylist(index) {
        const item = this.displayData[index];
        if (!item) return;
        if (!this.isPlaylistCollectable(item)) {
            if (typeof showError === 'function') {
                showError('歌曲不在曲库中，无法收藏到歌单。请先使用“手动关联”绑定平台歌曲 ID。');
            }
            return;
        }
        const song = this.buildPlaylistSong(item);
        if (song && typeof window.openPlaylistAddModalForSongObject === 'function') {
            window.openPlaylistAddModalForSongObject(song);
        }
    },

    playItem(index) {
        const item = this.displayData[index];
        if (!item) return;

        // Transform into songInfo for global player
        const username = this.getCurrentUsername();
        const authToken = (window.getUserAuthHeaders ? window.getUserAuthHeaders()['x-user-token'] : null) || localStorage.getItem('lx_user_token') || '';

        // Important: Use existing checkCache via global logic if possible, 
        // or directly supply local URL
        const songInfo = {
            ...item.songInfo,
            // Reconstruct full URL locally
            url: `/api/music/cache/file/${encodeURIComponent(username)}/${encodeURIComponent(item.filename)}?folder=${item.folder}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}`,
            pic: `/api/music/cache/cover?filename=${encodeURIComponent(item.filename)}&user=${encodeURIComponent(username)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}`,
            isLocal: true,
            folder: item.folder
        };

        // If 'app.js' exposes playSong(song), we use it.
        // We might want to construct a playlist of local tracks.
        const playlist = this.displayData.map(d => ({
            ...d.songInfo,
            url: `/api/music/cache/file/${encodeURIComponent(username)}/${encodeURIComponent(d.filename)}?folder=${d.folder}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}`,
            pic: `/api/music/cache/cover?filename=${encodeURIComponent(d.filename)}&user=${encodeURIComponent(username)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}`,
            isLocal: true
        }));

        if (typeof window.updatePlaylist === 'function') {
            window.updatePlaylist(playlist, index, 'local_all');
        } else if (typeof window.playSong === 'function') {
            // Fallback for older versions
            window.playSong(songInfo, index);
        } else {
            console.error('Playback functions are not defined globally.');
        }
    },

    async deleteSingle(index) {
        const item = this.displayData[index];
        if (!item) {
            if (typeof showError === 'function') showError('文件信息已失效，请刷新后重试');
            return;
        }

        // 未登录个人账号 或 查看公开库 时删除文件需要管理员权限
        const isLoggedIn = typeof window.isUserLoggedIn === 'function' ? window.isUserLoggedIn() : false;
        const isAdmin = !!localStorage.getItem('lx_admin_password');
        const requiresAdmin = this.isViewingPublicSongs || !isLoggedIn;

        if (requiresAdmin && !isAdmin) {
            if (typeof handleAdminAuth === 'function') {
                const ok = await handleAdminAuth(this.isViewingPublicSongs ? '删除公开库中的文件需要管理员权限' : '删除本地歌曲需要验证管理员权限');
                if (!ok) return;
            } else {
                if (typeof showError === 'function') showError('删除本地歌曲需要管理员权限');
                return;
            }
        }

        if (typeof showSelect === 'function') {
            if (!(await showSelect('删除本地文件', '确定要删除此文件吗?', { danger: true }))) return;
        } else {
            if (!confirm('确定要删除此文件吗?')) return;
        }

        this._executeDelete([item]);
    },

    async batchDelete() {
        if (this.selectedItems.size === 0) {
            if (typeof showError === 'function') showError('请先选择要删除的文件');
            return;
        }

        // 未登录个人账号 或 查看公开库 时删除文件需要管理员权限
        const isLoggedIn = typeof window.isUserLoggedIn === 'function' ? window.isUserLoggedIn() : false;
        const isAdmin = !!localStorage.getItem('lx_admin_password');
        const requiresAdmin = this.isViewingPublicSongs || !isLoggedIn;

        if (requiresAdmin && !isAdmin) {
            if (typeof handleAdminAuth === 'function') {
                const ok = await handleAdminAuth(this.isViewingPublicSongs ? '批量删除公开库中的文件需要管理员权限' : '批量删除本地歌曲需要验证管理员权限');
                if (!ok) return;
            } else {
                if (typeof showError === 'function') showError('批量删除本地歌曲需要管理员权限');
                return;
            }
        }

        if (typeof showSelect === 'function') {
            if (!(await showSelect('删除本地文件', `确定要批量删除这 ${this.selectedItems.size} 个文件吗?`, { danger: true }))) return;
        } else {
            if (!confirm(`确定要删除 ${this.selectedItems.size} 个文件吗?`)) return;
        }

        this._executeDelete(this.getSelectedEntries());
    },

    async _executeDelete(items) {
        try {
            const headers = {
                'Content-Type': 'application/json',
                ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
            };
            const isLoggedIn = typeof window.isUserLoggedIn === 'function' ? window.isUserLoggedIn() : false;
            if (this.isViewingPublicSongs || !isLoggedIn) {
                headers['x-user-name'] = '_open';
                delete headers['x-user-token'];
                delete headers['x-user-password'];
            }
            const res = await fetch('/api/music/cache/remove', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    items: items.map(item => ({ filename: item.filename, folder: item.folder }))
                })
            });
            const result = await res.json();
            if (result.deletedCount > 0) {
                // Clear selection
                for (const item of items) this.selectedItems.delete(this.getItemKey(item));
                this.updateBatchUI();
                await this.refresh();
            }
            if (!res.ok || !result.success) throw new Error(result.message || 'Server returned error');
            if (typeof showInfo === 'function') showInfo(`成功删除了 ${result.deletedCount} 个文件`);
        } catch (e) {
            if (typeof showError === 'function') showError('删除失败: ' + e.message);
            console.error('Delete error:', e);
        }
    },

    async batchFetchLyrics() {
        // Find items that don't have lyrics
        const targets = this.getSelectedEntries().filter(item => !item.hasLyric);

        if (targets.length === 0) {
            if (typeof showInfo === 'function') showInfo('选中的歌曲中没有需要补充歌词的项');
            return;
        }

        if (typeof showSelect === 'function') {
            if (!(await showSelect('补全歌词', `选中的文件中有 ${targets.length} 首没有对应的歌词，确定要向服务器请求补全吗?`))) return;
        }

        let success = 0;
        let fail = 0;

        for (const item of targets) {
            if (!item.songInfo || !item.songInfo.source || item.songInfo.source === 'unknown') {
                fail++;
                continue;
            }
            try {
                // If single_song_ops exposes requestServerLyricCache
                if (typeof window.requestServerLyricCache === 'function') {
                    const synced = await window.requestServerLyricCache(item.songInfo, item.quality, true);
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
            showInfo(`补全操作完成。成功 ${success} 项，失败/不支持 ${fail} 项`);
        }
        this.refresh();
    },

    async batchEmbedLyric() {
        const targetFilenames = this.getSelectedFilenames();
        if (targetFilenames.length === 0) {
            if (typeof showError === 'function') showError('请先选择要嵌入歌词的文件');
            return;
        }

        if (typeof showSelect === 'function') {
            if (!(await showSelect('嵌入歌词到文件',
                `将对选中的 ${targetFilenames.length} 首歌曲嵌入歌词到 USLT 标签。\n` +
                `• 已有歌词标签的歌曲将跳过\n` +
                `• 有 .lrc 文件的直接读取嵌入\n` +
                `• 没有 .lrc 文件的将尝试从网络获取\n\n确定继续吗?`
            ))) return;
        }

        try {
            if (typeof showInfo === 'function') showInfo('正在嵌入歌词，请稍候...');
            const res = await fetch('/api/music/cache/embedLyric', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
                },
                body: JSON.stringify({ filenames: targetFilenames })
            });

            const result = await res.json();
            if (result.success) {
                const { successCount = 0, skippedCount = 0, failCount = 0 } = result;
                if (typeof showInfo === 'function') {
                    showInfo(`嵌入完成：成功 ${successCount} 首，跳过（已有） ${skippedCount} 首，失败 ${failCount} 首`);
                }
                // 打印详情供排查
                if (result.details && result.details.length > 0) {
                    const failed = result.details.filter(d => d.status === 'fail');
                    if (failed.length > 0) {
                        console.warn('[EmbedLyric] 失败详情:', failed);
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
            console.error('[EmbedLyric] Error:', e);
        }
    },

    async batchUpdateMetadata() {
        const targets = this.getSelectedEntries();
        const targetFilenames = targets.map(item => item.filename);

        if (targets.length === 0) {
            if (typeof showInfo === 'function') showInfo('请先选择需要补全元信息的文件');
            return;
        }

        if (typeof showSelect === 'function') {
            if (!(await showSelect('补全元信息', `确定要向服务器请求补全这 ${targets.length} 个文件的元信息(包含封面与ID3标签)吗?`))) return;
        } else {
            if (!confirm(`确定要补全这 ${targets.length} 个文件的元信息吗?`)) return;
        }

        try {
            if (typeof showInfo === 'function') showInfo('正在处理，请稍候...');
            const res = await fetch('/api/music/cache/updateMetadata', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
                },
                body: JSON.stringify({ filenames: targetFilenames })
            });

            const result = await res.json();
            if (result.success) {
                if (typeof showInfo === 'function') showInfo(`元信息补全完成。成功 ${result.successCount} 项，失败 ${result.failCount} 项`);
                this.refresh();
            } else {
                throw new Error(result.message || 'Server returned error');
            }
        } catch (e) {
            if (typeof showError === 'function') showError('补全元信息失败: ' + e.message);
        }
    },

    async batchSwitchFolder() {
        const selectedEntries = this.getSelectedEntries();
        if (selectedEntries.length === 0) {
            if (typeof showError === 'function') showError('请先选择要移动的文件');
            return;
        }

        let targetEntries = [...selectedEntries];
        let skipCount = 0;

        // [Constraint Check] 识别在 'music' 目录下的子目录歌曲
        // 移动（下载 -> 缓存）时，缓存目录不支持子目录结构
        if (this.filterFolder === 'music') {
            targetEntries = selectedEntries.filter(item => {
                const hasSub = item && item.subPath && item.subPath !== '';
                if (hasSub) skipCount++;
                return !hasSub;
            });
        }

        const targetFilenames = targetEntries.map(item => item.filename);

        if (targetFilenames.length === 0) {
            if (skipCount > 0) {
                if (typeof showError === 'function') showError(`选中的 ${skipCount} 个文件均包含分类，缓存目录不支持分类，无法移动`);
            }
            return;
        }

        let confirmMsg = `确定要将选中的 ${targetFilenames.length} 个文件在 下载目录 与 缓存目录 之间互相转移吗?`;
        if (skipCount > 0) {
            confirmMsg += `\n提示：选中的歌曲中有 ${skipCount} 首带分类，将无法移动到缓存目录，操作时将自动跳过。`;
        }

        if (typeof showSelect === 'function') {
            if (!(await showSelect('移动目录', confirmMsg))) return;
        }

        try {
            if (typeof showInfo === 'function') showInfo('正在移动文件，请稍候...');
            const res = await fetch('/api/music/cache/move', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
                },
                body: JSON.stringify({ filenames: targetFilenames })
            });

            const result = await res.json();
            if (result.success) {
                if (typeof showInfo === 'function') showInfo(`目录转移完成。成功 ${result.successCount} 项，失败 ${result.failCount} 项`);
                this.deselectAll();
                this.refresh();
            } else {
                throw new Error(result.message || 'Server returned error');
            }
        } catch (e) {
            if (typeof showError === 'function') showError('移动失败: ' + e.message);
        }
    },

    async batchSwitchBaseLocation() {
        const targetFilenames = this.getSelectedFilenames();
        if (targetFilenames.length === 0) {
            if (typeof showError === 'function') showError('请先选择要转移的文件');
            return;
        }

        const el = document.getElementById('lm-location-select');
        const currentLocName = el ? (el.value === 'data' ? '云端(Data)' : '本地(Root)') : '当前目录';
        const targetLocName = el ? (el.value === 'data' ? '本地(Root)' : '云端(Data)') : '另一目录';

        if (typeof showSelect === 'function') {
            if (!(await showSelect('云端同步', `确定要将选中的 ${targetFilenames.length} 个文件从 ${currentLocName} 转移到 ${targetLocName} 吗?`))) return;
        }

        try {
            if (typeof showInfo === 'function') showInfo('正在跨目录转移文件，请稍候...');
            const res = await fetch('/api/music/cache/switch-base', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
                },
                body: JSON.stringify({ filenames: targetFilenames })
            });

            const result = await res.json();
            if (result.success) {
                if (typeof showInfo === 'function') showInfo(`跨目录转移完成。成功 ${result.successCount} 项，失败 ${result.failCount} 项`);
                this.deselectAll();
                this.refresh();
            } else {
                throw new Error(result.message || 'Server returned error');
            }
        } catch (e) {
            if (typeof showError === 'function') showError('转移失败: ' + e.message);
        }
    },



    downloadSingle(index) {
        const item = this.displayData[index];
        if (!item) return;
        const username = this.getCurrentUsername();
        const authToken = (window.getUserAuthHeaders ? window.getUserAuthHeaders()['x-user-token'] : null) || localStorage.getItem('lx_user_token') || '';
        const url = `/api/music/cache/file/${encodeURIComponent(username)}/${encodeURIComponent(item.filename)}?folder=${item.folder}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}`;

        const a = document.createElement('a');
        a.href = url;
        a.download = item.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    },

    batchDownloadToDevice() {
        const targets = this.getSelectedEntries();

        if (targets.length === 0) {
            if (typeof showError === 'function') showError('请先选择要保存的文件');
            return;
        }

        const username = this.getCurrentUsername();
        const authToken = (window.getUserAuthHeaders ? window.getUserAuthHeaders()['x-user-token'] : null) || localStorage.getItem('lx_user_token') || '';

        // Use a slight delay to prevent browser from blocking multiple downloads
        targets.forEach((item, idx) => {
            setTimeout(() => {
                const url = `/api/music/cache/file/${encodeURIComponent(username)}/${encodeURIComponent(item.filename)}?folder=${item.folder}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}`;
                const a = document.createElement('a');
                a.href = url;
                a.download = item.filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }, idx * 500);
        });

        if (typeof showInfo === 'function') showInfo(`已开始下载 ${targets.length} 个文件到设备`);
        this.deselectAll();
    },

    async openManualIndexModal(indexOrItem) {
        console.log('[ManualIndex] Opening modal for:', indexOrItem);
        let item = (indexOrItem && typeof indexOrItem === 'object') ? indexOrItem : this.displayData[indexOrItem];
        if (!item && window.CustomDirManager && window.CustomDirManager.isActive && typeof indexOrItem === 'number') {
            item = window.CustomDirManager.displayData[indexOrItem];
        }
        if (!item) {
            console.error('[ManualIndex] Item not found:', indexOrItem);
            return;
        }

        this.manualIndexTargetItem = item;
        const modal = document.getElementById('modal-manual-index');
        const content = document.getElementById('modal-manual-index-content');
        const input = document.getElementById('manual-index-search-input');
        const filenameEl = document.getElementById('manual-index-target-filename');
        const durationEl = document.getElementById('manual-index-target-duration');

        if (filenameEl) filenameEl.textContent = item.filename;
        if (durationEl) durationEl.textContent = item.interval || '--:--';

        // 默认搜索词：优先使用已有标签，否则使用文件名
        let defaultSearch = '';
        const isNoTag = (n) => !n || n === '未知歌曲' || n === '未知歌手' || n.toLowerCase() === 'unknown';

        if (!isNoTag(item.name)) defaultSearch += item.name;
        if (!isNoTag(item.singer)) defaultSearch += ' ' + item.singer;

        if (!defaultSearch.trim()) {
            defaultSearch = item.filename.replace(/\.[^/.]+$/, "").replace(/_-_/g, " ").replace(/ - /g, " ");
        }

        if (input) {
            input.value = defaultSearch.trim();
        }

        if (modal) {
            console.log('[ManualIndex] Modifying modal styles for visibility');
            // 确保移除所有可能导致残留隐藏的属性
            modal.classList.remove('hidden');
            modal.style.setProperty('display', 'flex', 'important');
            modal.style.setProperty('z-index', '9999', 'important');
            modal.style.setProperty('opacity', '1', 'important');

            // 监听滚动加载更多
            const resContainer = document.getElementById('manual-index-results');
            if (resContainer) {
                // 移除旧监听器防止重复
                resContainer.onscroll = null;
                resContainer.onscroll = () => {
                    if (this.isManualSearching) return;
                    // 距离底部 50px 时触发
                    if (resContainer.scrollTop + resContainer.clientHeight >= resContainer.scrollHeight - 50) {
                        this.doManualSearch(this.currentManualPage + 1);
                    }
                };
            }

            setTimeout(() => {
                if (content) {
                    content.classList.remove('scale-95', 'opacity-0');
                    content.classList.add('scale-100', 'opacity-100');
                    content.style.opacity = '1';
                    content.style.transform = 'scale(1)';
                }
                if (input) input.focus();
            }, 50);
        } else {
            console.error('[ManualIndex] Modal element not found!');
        }

        if (input && input.value) {
            this.currentManualPage = 1; // 重置页码
            this.doManualSearch(1);
        }
    },

    closeManualIndexModal() {
        const modal = document.getElementById('modal-manual-index');
        const content = document.getElementById('modal-manual-index-content');
        if (content) {
            content.classList.add('scale-95', 'opacity-0');
            content.classList.remove('scale-100', 'opacity-100');
        }
        setTimeout(() => {
            if (modal) {
                modal.classList.add('hidden');
                modal.style.display = 'none';
            }
            const resultsContainer = document.getElementById('manual-index-results');
            if (resultsContainer) {
                resultsContainer.innerHTML = `
                    <div class="flex flex-col items-center justify-center h-full opacity-30 mt-10">
                        <i class="fas fa-magnifying-glass text-6xl mb-4"></i>
                        <p class="text-sm font-bold tracking-wider">搜索在线歌曲以建立关联</p>
                    </div>`;
            }
            this.manualIndexTargetItem = null;
            this.currentManualResults = [];

            // Reset identify button
            const btn = document.getElementById('btn-manual-identify');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-fingerprint text-xl"></i>';
                btn.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        }, 300);
    },

    async identifyTargetSong() {
        const item = this.manualIndexTargetItem;
        if (!item) return;

        const btn = document.getElementById('btn-manual-identify');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin text-xl"></i>';
            btn.classList.add('opacity-50', 'cursor-not-allowed');
        }

        try {
            const username = this.getCurrentUsername();
            const authToken = (window.getUserAuthHeaders ? window.getUserAuthHeaders()['x-user-token'] : null) || localStorage.getItem('lx_user_token') || '';

            const resp = await fetch('/api/music/identify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-name': username,
                    'x-user-token': authToken
                },
                body: JSON.stringify({ filename: item.filename, folder: item.folder })
            });

            const result = await resp.json();
            if (result.success && result.results && result.results.length > 0) {
                const bestMatch = result.results[0];
                const searchInput = document.getElementById('manual-index-search-input');
                if (searchInput) {
                    searchInput.value = `${bestMatch.singer} - ${bestMatch.name}`;
                    // Trigger search
                    this.doManualSearch();
                }
                const scorePct = Math.round(bestMatch.score * 100);
                if (typeof showInfo === 'function') showInfo(`特征识别成功: ${bestMatch.singer} - ${bestMatch.name} (置信度: ${scorePct}%)`);
            } else {
                if (typeof showInfo === 'function') showInfo('无法识别该歌曲特征');
            }
        } catch (e) {
            console.error('[Identify] Failed:', e);
            if (typeof showInfo === 'function') showInfo('识别失败: ' + e.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-fingerprint text-xl"></i>';
                btn.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        }
    },

    async doManualSearch(page = 1) {
        if (this.isManualSearching) return;

        const input = document.getElementById('manual-index-search-input');
        const keyword = input ? input.value.trim() : '';
        const sourceEl = document.getElementById('manual-index-source-select');
        const source = (sourceEl ? sourceEl.value : '') || 'tx';
        const container = document.getElementById('manual-index-results');
        const btn = document.getElementById('btn-do-manual-search');

        if (!keyword) return;

        this.currentManualPage = page;
        this.isManualSearching = true;

        const origBtnHtml = btn ? btn.innerHTML : '搜索';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
        }

        console.log('[ManualIndex] Searching for:', keyword, 'on source:', source, 'page:', page);

        if (page === 1 && container) {
            this.currentManualResults = [];
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full py-20 animate-fade-in">
                    <div class="music-visualizer-loader mb-12">
                        <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
                    </div>
                    <div class="text-center">
                        <p class="text-xl t-text-main font-black tracking-[0.2em] mb-2 uppercase">Searching ${source}</p>
                        <div class="flex items-center justify-center gap-2 text-emerald-500 font-bold mb-4">
                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                            <span class="text-sm">正在请求第 ${page} 页</span>
                        </div>
                    </div>
                </div>`;
        }

        try {
            const url = `/api/music/search?name=${encodeURIComponent(keyword)}&source=${source}&page=${page}&limit=20`;
            const res = await fetch(url, {
                headers: window.getUserAuthHeaders ? window.getUserAuthHeaders() : {}
            });

            if (!res.ok) throw new Error(`Status: ${res.status}`);
            const result = await res.json();

            let newList = [];
            if (Array.isArray(result)) newList = result;
            else if (result.success && result.data && result.data.list) newList = result.data.list;
            else if (result.list) newList = result.list;

            if (newList && newList.length > 0) {
                // 如果是第1页则替换，否则追加
                if (page === 1) {
                    this.currentManualResults = newList;
                } else {
                    // 去重合并
                    const existingIds = new Set(this.currentManualResults.map(r => String(r.id || r.songmid)));
                    const filteredNew = newList.filter(n => !existingIds.has(String(n.id || n.songmid)));
                    this.currentManualResults = [...this.currentManualResults, ...filteredNew];
                    if (filteredNew.length === 0 && page > 1) {
                        if (typeof showInfo === 'function') showInfo('已经到底啦');
                    }
                }
                this.renderManualSearchResults(this.currentManualResults);
            } else {
                if (page === 1 && container) {
                    container.innerHTML = `<div class="text-center py-20 opacity-50 font-bold">未找到相关结果</div>`;
                } else if (page > 1) {
                    if (typeof showInfo === 'function') showInfo('没有更多搜索结果了');
                }
            }
        } catch (e) {
            console.error('[ManualIndex] Search failed:', e);
            if (page === 1 && container) {
                container.innerHTML = `<div class="text-center py-20 text-red-500 font-bold">搜索失败: ${e.message}</div>`;
            }
        } finally {
            this.isManualSearching = false;
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = origBtnHtml;
            }
        }
    },

    renderManualSearchResults(results) {
        const container = document.getElementById('manual-index-results');
        if (!container || !this.manualIndexTargetItem) return;

        const targetInterval = this.manualIndexTargetItem.interval;
        const targetSecs = this.parseInterval(targetInterval);

        // 排序逻辑：时长匹配的排在前面
        const sortedResults = [...results].sort((a, b) => {
            const aSecs = this.parseInterval(a.interval);
            const bSecs = this.parseInterval(b.interval);
            const aDiff = targetSecs > 0 ? Math.abs(aSecs - targetSecs) : 999;
            const bDiff = targetSecs > 0 ? Math.abs(bSecs - targetSecs) : 999;

            if (aDiff <= 3 && bDiff > 3) return -1;
            if (bDiff <= 3 && aDiff > 3) return 1;
            return 0;
        });

        let html = '';
        sortedResults.forEach((item) => {
            const itemSecs = this.parseInterval(item.interval);
            const isMatch = targetSecs > 0 && Math.abs(itemSecs - targetSecs) <= 3;

            // 找到原始索引
            const originalIdx = results.findIndex(r => r === item);

            html += `
                <div class="flex items-center p-3 md:p-4 t-bg-main border t-border-main rounded-2xl md:rounded-3xl hover:border-emerald-400 group transition-all shadow-sm">
                    <div class="w-12 h-12 rounded-xl overflow-hidden mr-4 flex-shrink-0 bg-gray-100 border t-border-main">
                        <img src="${item.img || '/music/assets/logo.svg'}" onerror="this.src='/music/assets/logo.svg'" loading="lazy" class="w-full h-full object-cover">
                    </div>
                    <div class="flex-1 min-w-0 mr-4">
                        <div class="font-bold t-text-main text-sm md:text-base truncate group-hover:text-emerald-500 transition-colors">${item.name}</div>
                        <div class="text-[11px] t-text-muted truncate mt-0.5 font-medium">${item.singer} · ${item.albumName || '未知专辑'}</div>
                    </div>
                    <div class="text-right mr-5 flex-shrink-0">
                        <div class="text-[10px] uppercase font-black t-text-muted opacity-30 tracking-widest mb-0.5">${item.source}</div>
                        <div class="text-[11px] font-mono font-bold ${isMatch ? 'text-emerald-500 bg-emerald-50 px-1.5 py-0.5 rounded-lg' : 't-text-main'}">${item.interval || '--:--'}</div>
                    </div>
                    <div class="flex items-center gap-2 flex-shrink-0">
                        <button onclick="window.LocalMusicManager.addManualResultToPlaylist(${originalIdx})"
                            class="w-10 h-10 flex items-center justify-center rounded-xl bg-emerald-50 text-emerald-500 hover:bg-emerald-100 border border-emerald-100 transition-all active:scale-95" title="添加到歌单">
                            <i class="fas fa-plus text-xs"></i>
                        </button>
                        <button onclick="window.LocalMusicManager.linkItem(${originalIdx})"
                            class="px-6 py-2.5 ${isMatch ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/20' : 't-bg-track hover:t-bg-item-hover t-text-main border t-border-main'} font-bold text-xs rounded-xl shadow-lg transition-all active:scale-95">
                            关联
                        </button>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html || `<div class="text-center py-20 opacity-50 font-bold">未找到搜索结果</div>`;
    },

    addManualResultToPlaylist(index) {
        const song = this.currentManualResults?.[index];
        if (song && typeof window.openPlaylistAddModalForSongObject === 'function') {
            window.openPlaylistAddModalForSongObject(song);
        }
    },

    async linkItem(idx) {
        if (!this.manualIndexTargetItem || !this.currentManualResults || !this.currentManualResults[idx]) return;

        const onlineItem = this.currentManualResults[idx];
        const targetSecs = this.parseInterval(this.manualIndexTargetItem.interval);
        const itemSecs = this.parseInterval(onlineItem.interval);
        const isMatch = targetSecs > 0 && Math.abs(itemSecs - targetSecs) <= 3;

        if (!isMatch && targetSecs > 0) {
            if (typeof showSelect === 'function') {
                if (!(await showSelect('时长不匹配', `选中的歌曲时长 (${onlineItem.interval}) 与本地文件 (${this.manualIndexTargetItem.interval}) 相差较大，确定要强制关联吗?`))) return;
            } else {
                if (!confirm('时长不匹配，确定要关联吗?')) return;
            }
        }

        try {
            if (typeof showInfo === 'function') showInfo('正在关联并同步元数据...');
            const isCustom = this.manualIndexTargetItem?.folder === 'custom' || (window.CustomDirManager && window.CustomDirManager.isActive);
            const linkApi = isCustom ? '/api/music/custom/link' : '/api/music/cache/link';

            const res = await fetch(linkApi, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
                },
                body: JSON.stringify({
                    filename: this.manualIndexTargetItem.filename,
                    songInfo: onlineItem
                })
            });

            const result = await res.json();
            if (result.success) {
                if (typeof showInfo === 'function') showInfo('关联成功！文件名及标签已更新');
                this.closeManualIndexModal();
                if (isCustom && window.CustomDirManager) {
                    window.CustomDirManager.refresh();
                } else {
                    this.refresh();
                }
            } else {
                throw new Error(result.message || 'Server error');
            }
        } catch (e) {
            if (typeof showError === 'function') showError('关联操作失败: ' + e.message);
        }
    },

    async autoLinkAll() {
        const unindexed = this.originalData.filter(item =>
            item.source === 'unknown' || (item.songmid && item.songmid.includes(' - ')) || !item.name || item.name === '未知歌曲'
        );

        if (unindexed.length === 0) {
            if (typeof showInfo === 'function') showInfo('所有歌曲已关联，无需自动处理');
            return;
        }

        if (typeof showSelect === 'function') {
            if (!(await showSelect('自动关联', `共发现 ${unindexed.length} 首未关联歌曲，系统将尝试通过多源搜索并匹配时长（误差±2s内）进行自动识别，确定开始吗？`))) return;
        }

        let successCount = 0;
        let failCount = 0;
        const total = unindexed.length;

        for (let i = 0; i < total; i++) {
            const item = unindexed[i];
            if (typeof showInfo === 'function') showInfo(`正在自动识别 (${i + 1}/${total}): ${item.name || item.filename}`);

            const match = await this.findBestMatch(item);
            if (match) {
                try {
                    const res = await fetch('/api/music/cache/link', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
                        },
                        body: JSON.stringify({
                            filename: item.filename,
                            songInfo: match
                        })
                    });
                    const result = await res.json();
                    if (result.success) {
                        successCount++;
                    } else {
                        failCount++;
                    }
                } catch (e) {
                    failCount++;
                }
            } else {
                failCount++;
            }
        }

        if (typeof showSelect === 'function') {
            await showSelect('自动关联完成', `成功关联: ${successCount} 首\n未能识别: ${failCount} 首\n未识别歌曲建议手动关联。`, { okOnly: true });
        } else {
            alert(`自动关联完成！\n成功: ${successCount}\n失败: ${failCount}`);
        }
        this.refresh();
    },

    async findBestMatch(localItem) {
        const sources = ['tx', 'wy', 'kg', 'kw', 'mg'];
        const targetSecs = this.parseInterval(localItem.interval);
        if (targetSecs <= 0) return null;

        // 1. 优先：使用 AcoustID 指纹识别
        console.log('[AutoLink] Using AcoustID first for:', localItem.filename);
        try {
            const username = this.getCurrentUsername();
            const authToken = (window.getUserAuthHeaders ? window.getUserAuthHeaders()['x-user-token'] : null) || localStorage.getItem('lx_user_token') || '';

            const resp = await fetch('/api/music/identify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-name': username,
                    'x-user-token': authToken
                },
                body: JSON.stringify({ filename: localItem.filename, folder: localItem.folder })
            });

            const result = await resp.json();
            if (result.success && result.results && result.results.length > 0) {
                const bestIdentify = result.results[0];
                const scorePct = Math.round(bestIdentify.score * 100);
                if (typeof showInfo === 'function') showInfo(`[指纹识别] ${bestIdentify.singer} - ${bestIdentify.name} (${scorePct}%)`);

                // 使用识别出的信息再次在各源中搜索以获取规范的 songInfo
                const identifyKeyword = `${bestIdentify.singer} ${bestIdentify.name}`;
                for (const source of sources) {
                    const results = await this.searchSingleSource(identifyKeyword, source);
                    const match = results.find(r => {
                        const rSecs = this.parseInterval(r.interval);
                        return Math.abs(rSecs - targetSecs) <= 3;
                    });
                    if (match) return match;
                }
            }
        } catch (e) {
            console.error('[AutoLink] AcoustID indentify failed:', e);
        }

        // 2. 兜底：关键词搜索
        // Try to get clean keywords
        let keyword = localItem.name;
        const isNoTag = (n) => !n || n === '未知歌曲' || n === '未知歌手' || n.toLowerCase() === 'unknown';

        if (isNoTag(keyword)) {
            keyword = localItem.filename.replace(/\.[^/.]+$/, "").replace(/^[0-9\-_\s]+/, "");
        } else if (localItem.singer && !isNoTag(localItem.singer)) {
            keyword = `${localItem.name} ${localItem.singer}`;
        }

        console.log('[AutoLink] Falling back to keyword search:', keyword);
        for (const source of sources) {
            try {
                const results = await this.searchSingleSource(keyword, source);
                if (results && results.length > 0) {
                    // Look for precise duration match
                    const match = results.find(r => {
                        const rSecs = this.parseInterval(r.interval);
                        return Math.abs(rSecs - targetSecs) <= 2;
                    });
                    if (match) return match;
                }
            } catch (e) {
                console.warn(`Search failed for ${source}:`, e);
            }
        }

        return null;
    },

    async searchSingleSource(text, source) {
        try {
            const res = await fetch(`/api/music/search?name=${encodeURIComponent(text)}&source=${source}&page=1&limit=10`, {
                headers: window.getUserAuthHeaders ? window.getUserAuthHeaders() : {}
            });
            const result = await res.json();

            // Normalize result format (supporting array or object)
            if (Array.isArray(result)) return result;
            if (result.list && Array.isArray(result.list)) return result.list;
            if (result.data && result.data.list) return result.data.list;
            return [];
        } catch (e) {
            return [];
        }
    },

    parseInterval(str) {
        if (!str) return 0;
        if (typeof str === 'number') return str;
        const pts = str.split(':');
        if (pts.length === 2) return parseInt(pts[0]) * 60 + parseInt(pts[1]);
        if (pts.length === 3) return parseInt(pts[0]) * 3600 + parseInt(pts[1]) * 60 + parseInt(pts[2]);
        return parseInt(str) || 0;
    },

    async openSubPathModal(mode = 'filter') {
        if (this.filterFolder !== 'music') {
            if (typeof showInfo === 'function') showInfo('请先在筛选中选择“下载”目录');
            return;
        }
        this.subPathModalMode = mode;
        const modal = document.getElementById('subpath-select-modal');
        const content = document.getElementById('subpath-select-modal-content');
        if (!modal || !content) return;

        // Update modal title based on mode
        const title = modal.querySelector('h3');
        if (title) title.innerText = mode === 'categorize' ? '移动到分类' : '选择子目录';

        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => {
            content.classList.remove('scale-95', 'opacity-0');
            content.classList.add('scale-100', 'opacity-100');
        }, 10);

        try {
            const res = await fetch(`/api/music/cache/subdirs?folder=music`, {
                headers: window.getUserAuthHeaders ? window.getUserAuthHeaders() : {}
            });
            const { data } = await res.json();
            this.renderSubPathList(data || []);
        } catch (e) {
            console.error('Failed to fetch subdirs:', e);
            if (typeof showError === 'function') showError('获取子目录失败');
        }
    },

    closeSubPathModal() {
        const modal = document.getElementById('subpath-select-modal');
        const content = document.getElementById('subpath-select-modal-content');
        if (!modal || !content) return;

        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }, 300);
    },

    renderSubPathList(dirs) {
        const list = document.getElementById('subpath-select-list');
        if (!list) return;

        let html = '';

        if (this.subPathModalMode === 'filter') {
            // [All Directories] Option
            html += `
                <button onclick="window.LocalMusicManager.selectSubPath('')" class="p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 group ${this.selectedSubPath === '' ? 'subpath-btn-active' : 'subpath-btn-inactive'}">
                    <i class="fas fa-layer-group text-xl"></i>
                    <span class="text-xs font-bold truncate w-full text-center">全部目录</span>
                </button>
            `;
            // [Root Only] Option
            html += `
                <button onclick="window.LocalMusicManager.selectSubPath('__ROOT__')" class="p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 group ${this.selectedSubPath === '__ROOT__' ? 'subpath-btn-active' : 'subpath-btn-inactive'}">
                    <i class="fas fa-home text-xl"></i>
                    <span class="text-xs font-bold truncate w-full text-center">根目录</span>
                </button>
            `;
        } else {
            // [Categorize to Root] Option
            html += `
                <button onclick="window.LocalMusicManager.selectSubPath('')" class="p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 group ${this.selectedSubPath === '' ? 'subpath-btn-active' : 'subpath-btn-inactive'}">
                    <i class="fas fa-home text-xl"></i>
                    <span class="text-xs font-bold truncate w-full text-center">移动到根目录 (/)</span>
                </button>
            `;
        }

        dirs.forEach(dir => {
            const isActive = this.selectedSubPath === dir;
            const safeDir = dir.replace(/'/g, "\\'");
            html += `
                <div class="relative group">
                    <button onclick="window.LocalMusicManager.selectSubPath('${safeDir}')" class="w-full p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 group ${isActive ? 'subpath-btn-active' : 'subpath-btn-inactive'}">
                        <i class="fas fa-folder text-xl"></i>
                        <span class="text-xs font-bold truncate w-full text-center" title="${dir}">${dir}</span>
                    </button>
                    <!-- Action buttons on top right -->
                    <div class="absolute top-2 right-2 flex items-center gap-1 opacity-80 md:opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        <button onclick="event.stopPropagation(); window.LocalMusicManager.renameSubFolder('${safeDir}')"
                            class="w-6 h-6 rounded-md bg-white/80 dark:bg-gray-800/80 hover:bg-emerald-500 hover:text-white t-text-muted transition-colors flex items-center justify-center text-xs shadow-sm"
                            title="重命名分类">
                            <i class="fas fa-pencil-alt text-[10px]"></i>
                        </button>
                        <button onclick="event.stopPropagation(); window.LocalMusicManager.deleteSubFolder('${safeDir}')"
                            class="w-6 h-6 rounded-md bg-white/80 dark:bg-gray-800/80 hover:bg-red-500 hover:text-white t-text-muted transition-colors flex items-center justify-center text-xs shadow-sm"
                            title="删除分类">
                            <i class="fas fa-trash-alt text-[10px]"></i>
                        </button>
                    </div>
                </div>
            `;
        });

        list.innerHTML = html;
    },

    selectSubPath(path) {
        if (this.subPathModalMode === 'categorize') {
            const target = path === '__ROOT__' ? '' : path;
            this.batchCategorize(target);
            return;
        }
        this.selectedSubPath = path;
        const text = document.getElementById('lm-subpath-text');
        let displayText = path;
        if (path === '') displayText = '全部';
        else if (path === '__ROOT__') displayText = '根目录';
        if (text) text.innerText = displayText;
        this.closeSubPathModal();
        this.applyFilters();
    },

    async batchCategorize(targetSubPath) {
        const filenames = this.getSelectedFilenames();
        if (filenames.length === 0) return;

        if (typeof showMsg === 'function') showMsg(`正在移动 ${filenames.length} 首歌曲到 ${targetSubPath || '根目录'}...`, 'info');

        try {
            const username = this.getCurrentUsername();
            const res = await fetch(`/api/music/cache/categorize?user=${encodeURIComponent(username)}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
                },
                body: JSON.stringify({ filenames, subPath: targetSubPath })
            });
            const data = await res.json();
            if (data.success) {
                if (typeof showMsg === 'function') showMsg(`成功移动 ${data.successCount} 首, 失败 ${data.failCount} 首`, 'success');
                this.closeSubPathModal();
                this.selectedItems.clear();
                this.updateBatchUI();
                // We need to reload data because filenames/paths in memory are now invalid
                await this.fetchData(true);
            } else {
                if (typeof showError === 'function') showError('移动文件失败');
            }
        } catch (e) {
            console.error('Categorize failed:', e);
            if (typeof showError === 'function') showError('网络请求失败');
        }
    },

    openCategorizeModal() {
        this.openSubPathModal('categorize');
    },

    // 同步洗版模态框副标题与底部提示（根据当前 remasterSource 更新文字）
    syncRemasterSourceUI() {
        const isCustom = this.remasterSource === 'custom';

        // 副标题
        const subtitleEl = document.getElementById('lm-remaster-modal-subtitle');
        if (subtitleEl) {
            subtitleEl.textContent = isCustom
                ? '处理用户自定义音乐目录歌曲（替换同名音频及元数据）'
                : '仅处理服务器下载目录，不处理缓存目录';
        }

        // 底部提示
        const hintEl = document.getElementById('lm-remaster-source-hint');
        if (hintEl) {
            hintEl.textContent = isCustom ? '自定义目录中的歌曲' : '仅列出下载目录中的歌曲';
        }
    },

    syncRemasterVisibility() {
        const isCustomDir = window.CustomDirManager && window.CustomDirManager.isActive;
        const enabled = isCustomDir
            ? (!!window.settings?.enableRemaster && !!window.userAllowOperateCustomDir)
            : !!window.settings?.enableRemaster;
        ['lm-remaster-btn', 'lm-remaster-btn-mobile'].forEach(id => {
            const button = document.getElementById(id);
            if (!button) return;
            button.classList.toggle('hidden', !enabled);
            button.classList.toggle('flex', enabled);
            button.style.display = enabled ? '' : 'none';
        });
        if (!enabled) this.closeRemasterModal();
    },

    bindRemasterSelectionEvents() {
        if (!this.remasterSelectionEventsBound) {
            const container = document.getElementById('lm-remaster-song-list');
            if (container) {
                this.remasterSelectionEventsBound = true;
                container.addEventListener('change', (event) => {
                    const checkbox = event.target.closest('[data-remaster-filename]');
                    if (!checkbox || this.remasterTaskRunning) return;
                    this.toggleRemasterSelection(checkbox.dataset.remasterFilename || '', checkbox.checked);
                });
            }
        }
        if (!this.remasterQualityEventsBound) {
            const qualitySelect = document.getElementById('lm-remaster-quality');
            if (qualitySelect) {
                this.remasterQualityEventsBound = true;
                qualitySelect.addEventListener('change', () => this.saveRemasterTargetQuality(qualitySelect.value));
            }
        }
    },

    getRemasterQualityStorageKey() {
        const username = window.getRemasterStorageUsername?.()
            || (window.currentListData && window.currentListData.username)
            || localStorage.getItem('lx_sync_user')
            || '_open';
        const normalizedUsername = !username || username === 'default' ? '_open' : username;
        return `lx_remaster_target_quality:${encodeURIComponent(normalizedUsername)}`;
    },

    saveRemasterTargetQuality(quality) {
        const qualitySelect = document.getElementById('lm-remaster-quality');
        if (!qualitySelect) return;
        const supported = Array.from(qualitySelect.options).some(option => option.value === quality);
        if (supported) localStorage.setItem(this.getRemasterQualityStorageKey(), quality);
    },

    restoreRemasterTargetQuality() {
        const qualitySelect = document.getElementById('lm-remaster-quality');
        if (!qualitySelect) return;
        const stored = localStorage.getItem(this.getRemasterQualityStorageKey()) || '';
        const supported = Array.from(qualitySelect.options).some(option => option.value === stored);
        qualitySelect.value = supported ? stored : 'flac';
    },

    getRemasterSelectableItems() {
        if (this.remasterSource === 'custom' && window.CustomDirManager && Array.isArray(window.CustomDirManager.originalData)) {
            return window.CustomDirManager.originalData;
        }
        return this.originalData.filter(item => item.folder === 'music');
    },

    getRemasterFilteredItems() {
        const keyword = this.remasterSearchKeyword;
        const items = this.getRemasterSelectableItems();
        if (!keyword) return items;
        const searchMatcher = this.createSearchMatcher(keyword);
        return items.filter(item => searchMatcher(this.getSearchValues(item, true)));
    },

    pruneRemasterSelection() {
        const available = new Set(this.getRemasterSelectableItems().map(item => item.filename));
        for (const filename of this.remasterSelectedItems) {
            if (!available.has(filename)) this.remasterSelectedItems.delete(filename);
        }
    },

    setRemasterSearch(valueOrEl) {
        const el = typeof valueOrEl === 'string' ? null : (valueOrEl || document.getElementById('lm-remaster-search'));
        if (el) {
            this.formatRichInput(el);
            const val = this.getRichInputValue(el);
            this.updateSearchInputErrorState(el, val);
            this.remasterSearchKeyword = val.trim().toLowerCase();
        } else {
            this.remasterSearchKeyword = String(valueOrEl || '').trim().toLowerCase();
        }
        this.remasterSelectionPage = 1;
        this.renderRemasterSelection();
    },

    toggleRemasterSelection(filename, checked) {
        if (!filename || this.remasterTaskRunning) return;
        if (checked) this.remasterSelectedItems.add(filename);
        else this.remasterSelectedItems.delete(filename);
        this.updateRemasterSelectionControls();
    },

    selectAllRemasterResults() {
        if (this.remasterTaskRunning) return;
        this.getRemasterFilteredItems().forEach(item => this.remasterSelectedItems.add(item.filename));
        this.renderRemasterSelection();
    },

    clearRemasterSelection() {
        if (this.remasterTaskRunning) return;
        this.remasterSelectedItems.clear();
        this.renderRemasterSelection();
    },

    changeRemasterSelectionPage(delta) {
        const filtered = this.getRemasterFilteredItems();
        const totalPages = Math.max(1, Math.ceil(filtered.length / this.remasterSelectionPageSize));
        this.remasterSelectionPage = Math.min(totalPages, Math.max(1, this.remasterSelectionPage + delta));
        this.renderRemasterSelection();
    },

    updateRemasterSelectionControls() {
        const allItems = this.getRemasterSelectableItems();
        const filtered = this.getRemasterFilteredItems();
        const totalPages = Math.max(1, Math.ceil(filtered.length / this.remasterSelectionPageSize));
        const disabled = this.remasterTaskRunning;
        const selectedCount = document.getElementById('lm-remaster-selected-count');
        const availableCount = document.getElementById('lm-remaster-available-count');
        const pageInfo = document.getElementById('lm-remaster-selection-page-info');
        const prevButton = document.getElementById('lm-remaster-selection-prev');
        const nextButton = document.getElementById('lm-remaster-selection-next');
        const searchInput = document.getElementById('lm-remaster-search');
        const selectAllButton = document.getElementById('lm-remaster-select-all');
        const clearButton = document.getElementById('lm-remaster-clear-selection');
        const startButton = document.getElementById('lm-remaster-start');
        if (selectedCount) selectedCount.textContent = String(this.remasterSelectedItems.size);
        if (availableCount) availableCount.textContent = String(allItems.length);
        if (pageInfo) pageInfo.textContent = `${this.remasterSelectionPage} / ${totalPages}`;
        if (prevButton) prevButton.disabled = disabled || this.remasterSelectionPage <= 1;
        if (nextButton) nextButton.disabled = disabled || this.remasterSelectionPage >= totalPages;
        if (searchInput) searchInput.setAttribute('contenteditable', disabled ? 'false' : 'true');
        if (selectAllButton) selectAllButton.disabled = disabled || filtered.length === 0;
        if (clearButton) clearButton.disabled = disabled || this.remasterSelectedItems.size === 0;
        if (startButton) startButton.disabled = disabled || this.remasterSelectedItems.size === 0;
    },

    renderRemasterSelection() {
        const container = document.getElementById('lm-remaster-song-list');
        if (!container) return;
        this.pruneRemasterSelection();
        const filtered = this.getRemasterFilteredItems();
        const totalPages = Math.max(1, Math.ceil(filtered.length / this.remasterSelectionPageSize));
        this.remasterSelectionPage = Math.min(totalPages, Math.max(1, this.remasterSelectionPage));
        const start = (this.remasterSelectionPage - 1) * this.remasterSelectionPageSize;
        const pageItems = filtered.slice(start, start + this.remasterSelectionPageSize);
        const disabled = this.remasterTaskRunning;

        if (!pageItems.length) {
            const emptyText = this.remasterSource === 'custom'
                ? '没有可选择的自定义目录歌曲'
                : '没有可选择的下载歌曲';
            container.innerHTML = `<div class="h-36 flex items-center justify-center text-xs t-text-muted">${emptyText}</div>`;
        } else {
            const isCustomDir = this.remasterSource === 'custom';
            container.innerHTML = pageItems.map(item => {
                const selected = this.remasterSelectedItems.has(item.filename);
                const qualityName = window.QualityManager?.getQualityDisplayName(item.quality) || item.quality || '未知音质';
                const subPathBadge = item.subPath ? `<span class="text-[9px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/40 rounded px-1 mr-1 inline-block font-mono" title="${this.escapeAttr(item.subPath)}">${this.escapeHtml(item.subPath)}</span>` : '';
                return `
                    <label class="min-h-12 px-3 py-2 flex items-center gap-3 border-b last:border-b-0 t-border-main ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:t-bg-track'}">
                        <input type="checkbox" data-remaster-filename="${this.escapeAttr(item.filename)}" ${selected ? 'checked' : ''} ${disabled ? 'disabled' : ''}
                            class="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500 shrink-0">
                        <span class="min-w-0 flex-1">
                            <span class="block text-xs font-bold t-text-main truncate">${this.escapeHtml(item.name || item.filename)}</span>
                            <span class="block text-[10px] t-text-muted truncate mt-0.5">${subPathBadge}${this.escapeHtml(item.singer || '未知歌手')} · ${this.escapeHtml(item.album || '未知专辑')}</span>
                        </span>
                        <span class="shrink-0 text-[10px] t-text-muted">${this.escapeHtml(qualityName)}</span>
                    </label>`;
            }).join('');
        }

        this.updateRemasterSelectionControls();
    },

    async remasterRequest(path, options = {}) {
        const response = await fetch(path, {
            ...options,
            headers: {
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {}),
                ...(options.headers || {})
            }
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) throw new Error(result.message || '洗版请求失败');
        return result.data;
    },

    async openRemasterModal() {
        if (!window.settings?.enableRemaster) {
            if (typeof showError === 'function') showError('请先在设置中启用歌曲洗版');
            return;
        }
        // 初始化数据源：默认跟随当前视图模式，但可在模态框内独立切换
        const isCustomDirActive = !!(window.CustomDirManager && window.CustomDirManager.isActive);
        if (isCustomDirActive && !window.userAllowOperateCustomDir) {
            // 自定义目录无权限时，降级到本地模式而非拒绝打开
            this.remasterSource = 'local';
        } else {
            this.remasterSource = isCustomDirActive ? 'custom' : 'local';
        }
        try {
            const modal = document.getElementById('lm-remaster-modal');
            if (!modal) return;

            // 同步当前主列表的勾选项目到洗版选择列表中
            this.remasterSelectedItems.clear();
            if (this.remasterSource === 'custom') {
                if (window.CustomDirManager && window.CustomDirManager.selectedItems && window.CustomDirManager.selectedItems.size > 0) {
                    window.CustomDirManager.selectedItems.forEach(filename => this.remasterSelectedItems.add(filename));
                }
            } else {
                if (this.selectedItems && this.selectedItems.size > 0) {
                    const musicSelected = this.getSelectedEntries().filter(item => item.folder === 'music');
                    musicSelected.forEach(item => this.remasterSelectedItems.add(item.filename));
                }
            }

            modal.classList.remove('hidden');
            modal.classList.add('flex');
            document.body.style.overflow = 'hidden';
            this.bindRemasterSelectionEvents();
            this.restoreRemasterTargetQuality();
            this.remasterSearchKeyword = '';
            this.remasterSelectionPage = 1;
            const searchInput = document.getElementById('lm-remaster-search');
            if (searchInput) this.setRichInputValue(searchInput, '');
            this.syncRemasterSourceUI();
            this.renderRemasterSelection();
            await this.loadRemasterStatus(true);
        } catch (e) {
            if (typeof showError === 'function') showError(e.message || '无法打开洗版功能');
        }
    },

    closeRemasterModal() {
        const modal = document.getElementById('lm-remaster-modal');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
        if (this.remasterPollTimer) {
            clearTimeout(this.remasterPollTimer);
            this.remasterPollTimer = null;
        }
        document.body.style.overflow = '';
    },

    async startRemaster() {
        const isCustomDir = this.remasterSource === 'custom';
        const quality = document.getElementById('lm-remaster-quality')?.value || 'flac';
        this.saveRemasterTargetQuality(quality);
        const qualityName = window.QualityManager?.getQualityDisplayName(quality) || quality;
        const filenames = Array.from(this.remasterSelectedItems);
        if (!filenames.length) {
            if (typeof showError === 'function') showError('请至少选择一首需要洗版的歌曲');
            return;
        }
        const locationDesc = isCustomDir ? '自定义音乐目录' : '本地下载目录';
        const confirmed = await showSelect(
            '确认开始洗版',
            `即将把【${locationDesc}】中已选择的 ${filenames.length} 首歌曲洗版为“${qualityName}”。此操作会替换原音频文件，建议先备份。确定继续吗？`,
            { danger: true, confirmText: '开始洗版' }
        );
        if (!confirmed) return;

        try {
            this.remasterResultOffset = 0;
            this.remasterResults = [];
            this.remasterResultFilter = 'all';
            this.remasterTaskId = '';
            this.renderRemasterResults();
            await this.remasterRequest('/api/music/remaster/start', {
                method: 'POST',
                body: JSON.stringify({ targetQuality: quality, filenames, isCustomDir })
            });
            if (typeof showInfo === 'function') showInfo('洗版任务已启动，关闭页面后服务端仍会继续处理');
            await this.loadRemasterStatus(true);
        } catch (e) {
            if (typeof showError === 'function') showError(e.message || '启动洗版失败');
        }
    },

    async cancelRemaster() {
        const confirmed = await showSelect('停止洗版', '确定停止当前洗版任务吗？正在下载的歌曲会取消，已经完成替换的歌曲不会恢复。', {
            danger: true,
            confirmText: '停止任务'
        });
        if (!confirmed) return;
        try {
            await this.remasterRequest('/api/music/remaster/cancel', { method: 'POST' });
            await this.loadRemasterStatus(false);
        } catch (e) {
            if (typeof showError === 'function') showError(e.message || '停止洗版失败');
        }
    },

    async loadRemasterStatus(reset = false) {
        if (reset) {
            this.remasterResultOffset = 0;
            this.remasterResults = [];
            this.remasterTaskId = '';
        }
        if (this.remasterPollTimer) {
            clearTimeout(this.remasterPollTimer);
            this.remasterPollTimer = null;
        }

        const status = await this.remasterRequest(`/api/music/remaster/status?offset=${this.remasterResultOffset}&limit=200`);
        if (status.id && this.remasterTaskId && status.id !== this.remasterTaskId) {
            this.remasterResultOffset = 0;
            this.remasterResults = [];
            this.remasterTaskId = status.id;
            return this.loadRemasterStatus(false);
        }
        if (status.id) this.remasterTaskId = status.id;
        if (status.targetQuality) this.remasterTargetQuality = status.targetQuality;
        if (Array.isArray(status.results) && status.results.length) {
            this.remasterResults.push(...status.results);
        }
        this.remasterResultOffset = Number(status.nextOffset || this.remasterResultOffset);
        this.renderRemasterStatus(status);

        if (this.remasterResultOffset < Number(status.processed || 0)) {
            return this.loadRemasterStatus(false);
        }

        const modalOpen = document.getElementById('lm-remaster-modal')?.classList.contains('flex');
        if (status.status === 'running' && modalOpen) {
            this.remasterPollTimer = setTimeout(() => this.loadRemasterStatus(false).catch(e => {
                if (typeof showError === 'function') showError(e.message || '获取洗版进度失败');
            }), 1000);
        } else if (status.id && status.status !== 'idle' && this.remasterLastTerminalTaskId !== status.id) {
            this.remasterLastTerminalTaskId = status.id;
            if (window.CustomDirManager && window.CustomDirManager.isActive) {
                await window.CustomDirManager.fetchData(true);
            } else {
                await this.fetchData(true);
            }
            if (status.status === 'completed' && typeof showSuccess === 'function') showSuccess('洗版任务已完成');
            if (status.status === 'error' && typeof showError === 'function') showError(status.errorMsg || '洗版任务异常终止');
        }
    },

    renderRemasterStatus(status) {
        const total = Number(status.total || 0);
        const processed = Number(status.processed || 0);
        const percent = total > 0 ? Math.min(100, Math.round(processed / total * 100)) : 0;
        const statusNames = {
            idle: '尚未开始',
            running: '正在洗版',
            completed: '处理完成',
            cancelled: '任务已停止',
            error: '任务异常'
        };
        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = String(value);
        };
        setText('lm-remaster-status', statusNames[status.status] || status.status || '未知状态');
        setText('lm-remaster-progress-text', `${processed} / ${total}`);
        setText('lm-remaster-total', total);
        setText('lm-remaster-replaced', status.replaced || 0);
        setText('lm-remaster-downgraded', status.downgraded || 0);
        setText('lm-remaster-skipped', status.skipped || 0);
        setText('lm-remaster-failed', status.failed || 0);
        const progress = document.getElementById('lm-remaster-progress');
        if (progress) progress.style.width = `${percent}%`;

        const running = status.status === 'running';
        const runningChanged = this.remasterTaskRunning !== running;
        this.remasterTaskRunning = running;
        const startButton = document.getElementById('lm-remaster-start');
        const cancelButton = document.getElementById('lm-remaster-cancel');
        const qualitySelect = document.getElementById('lm-remaster-quality');
        if (startButton) startButton.classList.toggle('hidden', running);
        if (cancelButton) {
            cancelButton.classList.toggle('hidden', !running);
            cancelButton.classList.toggle('flex', running);
        }
        if (qualitySelect) qualitySelect.disabled = running;
        if (runningChanged) this.renderRemasterSelection();
        this.renderRemasterResults();
    },

    setRemasterResultFilter(filter) {
        const allowedFilters = new Set(['all', 'successful', 'downgraded', 'skipped', 'failed']);
        this.remasterResultFilter = allowedFilters.has(filter) ? filter : 'all';
        this.renderRemasterResults();
        document.getElementById('lm-remaster-results')?.scrollIntoView({ block: 'nearest' });
    },

    updateRemasterResultFilterUI() {
        const counts = {
            all: this.remasterResults.length,
            successful: this.remasterResults.filter(item => item.status === 'replaced' || item.status === 'downgraded').length,
            downgraded: this.remasterResults.filter(item => item.status === 'downgraded').length,
            skipped: this.remasterResults.filter(item => item.status === 'skipped').length,
            failed: this.remasterResults.filter(item => item.status === 'failed').length
        };
        document.querySelectorAll('[data-remaster-result-filter]').forEach(button => {
            const filter = button.dataset.remasterResultFilter;
            const active = filter === this.remasterResultFilter;
            button.disabled = !counts[filter];
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
            button.style.borderColor = active ? 'rgb(239 68 68)' : '';
            button.style.boxShadow = active ? 'inset 0 0 0 1px rgb(239 68 68)' : '';
        });
        return counts;
    },

    renderRemasterResults() {
        const container = document.getElementById('lm-remaster-results');
        if (!container) return;
        const counts = this.updateRemasterResultFilterUI();
        const filterConfig = {
            all: ['全部', item => true],
            successful: ['成功', item => item.status === 'replaced' || item.status === 'downgraded'],
            downgraded: ['发生降级', item => item.status === 'downgraded'],
            skipped: ['已跳过', item => item.status === 'skipped'],
            failed: ['失败', item => item.status === 'failed']
        };
        const activeFilter = filterConfig[this.remasterResultFilter] || filterConfig.all;
        const filteredResults = this.remasterResults.filter(activeFilter[1]);
        const title = document.getElementById('lm-remaster-results-title');
        if (title) title.textContent = `处理结果 · ${activeFilter[0]} (${counts[this.remasterResultFilter] || 0})`;
        if (!filteredResults.length) {
            container.innerHTML = '<div class="p-6 text-center text-xs t-text-muted">暂无结果</div>';
            return;
        }
        const statusConfig = {
            replaced: ['已替换', 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30'],
            downgraded: ['已降级', 'text-amber-700 bg-amber-50 dark:bg-amber-950/30'],
            skipped: ['已跳过', 'text-gray-600 bg-gray-100 dark:bg-gray-800'],
            failed: ['失败', 'text-red-700 bg-red-50 dark:bg-red-950/30']
        };
        container.innerHTML = filteredResults.map(item => {
            const config = statusConfig[item.status] || [item.status, 'text-gray-600 bg-gray-100'];
            const originalName = window.QualityManager?.getQualityDisplayName(item.originalQuality) || item.originalQuality;
            const actualName = item.actualQuality
                ? (window.QualityManager?.getQualityDisplayName(item.actualQuality) || item.actualQuality)
                : '-';
            return `
                <div class="p-3 flex items-start gap-3">
                    <span class="shrink-0 px-2 py-1 rounded text-[10px] font-bold ${config[1]}">${config[0]}</span>
                    <div class="min-w-0 flex-1">
                        <div class="text-xs font-bold t-text-main truncate">${this.escapeHtml(item.name)} · ${this.escapeHtml(item.singer)}</div>
                        <div class="text-[10px] t-text-muted mt-1">${this.escapeHtml(originalName)} → ${this.escapeHtml(actualName)}</div>
                        <div class="text-[10px] t-text-muted mt-1 break-words">${this.escapeHtml(item.message || '')}</div>
                    </div>
                </div>`;
        }).join('');
    },

    async createSubFolder() {
        const input = document.getElementById('new-subfolder-input');
        if (!input) return;
        const subPath = input.value.trim();
        if (!subPath) return;

        try {
            const res = await fetch('/api/music/cache/mkdir', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
                },
                body: JSON.stringify({ folder: 'music', subPath })
            });
            const { success } = await res.json();
            if (success) {
                if (typeof showMsg === 'function') showMsg('文件夹创建成功', 'success');
                input.value = '';
                // Re-open/refresh modal
                this.openSubPathModal();
            } else {
                if (typeof showError === 'function') showError('文件夹已存在或创建失败');
            }
        } catch (e) {
            console.error('Failed to create subdir:', e);
        }
    },

    async renameSubFolder(oldSubPath) {
        if (!oldSubPath) return;
        const newName = prompt(`请输入分类【${oldSubPath}】的新名称：`, oldSubPath);
        if (!newName || newName.trim() === '' || newName.trim() === oldSubPath) return;

        try {
            const res = await fetch('/api/music/cache/subdirs/rename', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
                },
                body: JSON.stringify({ folder: 'music', oldSubPath, newSubPath: newName.trim() })
            });
            const data = await res.json();
            if (data.success) {
                if (typeof showMsg === 'function') showMsg(`分类已重命名为【${newName.trim()}】`, 'success');
                if (this.selectedSubPath === oldSubPath) {
                    this.selectedSubPath = newName.trim();
                    const text = document.getElementById('lm-subpath-text');
                    if (text) text.innerText = newName.trim();
                }
                // Refresh subpath modal and list data
                this.openSubPathModal(this.subPathModalMode || 'filter');
                await this.fetchData(true);
            } else {
                if (typeof showError === 'function') showError(data.message || '重命名分类失败');
            }
        } catch (e) {
            console.error('Rename subfolder error:', e);
            if (typeof showError === 'function') showError('网络请求失败');
        }
    },

    deleteSubFolder(subPath) {
        if (!subPath) return;
        this.pendingDeleteSubPath = subPath;
        this.pendingDeleteSongs = false;

        const modal = document.getElementById('subpath-delete-modal');
        const content = document.getElementById('subpath-delete-modal-content');
        const targetNameEl = document.getElementById('subpath-delete-target-name');
        const step1 = document.getElementById('subpath-delete-step1');
        const step2 = document.getElementById('subpath-delete-step2');

        if (!modal || !content) return;
        if (targetNameEl) targetNameEl.innerText = subPath;

        if (step1) step1.classList.remove('hidden');
        if (step2) step2.classList.add('hidden');

        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => {
            content.classList.remove('scale-95', 'opacity-0');
            content.classList.add('scale-100', 'opacity-100');
        }, 10);
    },

    closeSubPathDeleteModal() {
        const modal = document.getElementById('subpath-delete-modal');
        const content = document.getElementById('subpath-delete-modal-content');
        if (!modal || !content) return;

        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            this.pendingDeleteSubPath = null;
        }, 300);
    },

    confirmDeleteStep(deleteSongs) {
        this.pendingDeleteSongs = deleteSongs;
        const step1 = document.getElementById('subpath-delete-step1');
        const step2 = document.getElementById('subpath-delete-step2');
        const notice = document.getElementById('subpath-delete-step2-notice');
        const executeBtn = document.getElementById('subpath-delete-execute-btn');

        if (step1) step1.classList.add('hidden');
        if (step2) step2.classList.remove('hidden');

        if (notice) {
            if (deleteSongs) {
                notice.innerHTML = `⚠️ <b>危险操作警告：</b>您即将永久删除分类【<b>${this.escapeHtml(this.pendingDeleteSubPath)}</b>】以及分类目录下的<b>所有歌曲和歌词文件</b>。此操作无法撤销，确认继续？`;
            } else {
                notice.innerHTML = `ℹ️ <b>操作确认：</b>您即将删除分类【<b>${this.escapeHtml(this.pendingDeleteSubPath)}</b>】。分类下的所有歌曲和歌词将<b>安全转移至根目录</b>，不会丢失文件。确认继续？`;
            }
        }

        if (executeBtn) {
            executeBtn.innerText = deleteSongs ? '彻底删除分类及歌曲' : '移到根目录并删除分类';
        }
    },

    backToDeleteStep1() {
        const step1 = document.getElementById('subpath-delete-step1');
        const step2 = document.getElementById('subpath-delete-step2');
        if (step1) step1.classList.remove('hidden');
        if (step2) step2.classList.add('hidden');
    },

    async executeDeleteSubFolder() {
        const subPath = this.pendingDeleteSubPath;
        const deleteSongs = !!this.pendingDeleteSongs;
        if (!subPath) return;

        try {
            const res = await fetch('/api/music/cache/subdirs/delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
                },
                body: JSON.stringify({ folder: 'music', subPath, deleteSongs })
            });
            const data = await res.json();
            if (data.success) {
                const actionText = deleteSongs ? '分类及歌曲已彻底删除' : '分类已删除，歌曲已全部移入根目录';
                if (typeof showMsg === 'function') showMsg(actionText, 'success');
                this.closeSubPathDeleteModal();

                if (this.selectedSubPath === subPath) {
                    this.selectedSubPath = '';
                    const text = document.getElementById('lm-subpath-text');
                    if (text) text.innerText = '全部';
                }
                // Refresh subpath modal and list data
                this.openSubPathModal(this.subPathModalMode || 'filter');
                await this.fetchData(true);
            } else {
                if (typeof showError === 'function') showError(data.message || '删除分类失败');
            }
        } catch (e) {
            console.error('Delete subfolder error:', e);
            if (typeof showError === 'function') showError('网络请求失败');
        }
    }
};

window.toggleLmBatchMode = () => {
    if (window.CustomDirManager && window.CustomDirManager.isActive) {
        window.CustomDirManager.toggleBatchMode();
    } else if (window.LocalMusicManager) {
        window.LocalMusicManager.toggleBatchMode();
    }
};

// 当处于自定义目录模式时，将通用动作自动转发给 CustomDirManager
['toggleBatchMode', 'selectAll', 'deselectAll', 'batchDelete', 'batchDownloadToDevice', 'batchAddToPlaylist', 'batchFetchLyrics', 'batchEmbedLyric', 'batchUpdateMetadata', 'applyFilters', 'refresh', 'resetFilters', 'clearFilters'].forEach(method => {
    if (window.LocalMusicManager && typeof window.LocalMusicManager[method] === 'function') {
        const orig = window.LocalMusicManager[method];
        window.LocalMusicManager[method] = function(...args) {
            if (window.CustomDirManager && window.CustomDirManager.isActive && typeof window.CustomDirManager[method] === 'function') {
                return window.CustomDirManager[method].apply(window.CustomDirManager, args);
            }
            return orig.apply(this, args);
        };
    }
});

// Auto init when script loads (if in scope), else done manually
setTimeout(() => {
    if (window.LocalMusicManager) {
        window.LocalMusicManager.init();
    }
}, 500);
