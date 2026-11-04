/**
 * Unified List Search Service
 * Handles searching, navigation, and filtering across all song list views.
 */
window.ListSearch = {
    // Current state
    state: {
        id: '', // Unique identifier for the current search context (e.g., 'songlist', 'global')
        active: false,
        query: '',
        matches: [],
        currentIndex: -1,
        onlyShowMatches: false
    },

    // Config for different contexts
    config: {
        renderCallback: null,   // Function to trigger re-render
        paginationCallback: null, // Function to trigger navigation (optional)
        getList: null,          // Function to get original list
        itemsPerPage: 20
    },

    /**
     * Initialize the search service for a specific view
     */
    init: function (id, config) {
        this.state.id = id;
        this.config = { ...this.config, ...config };
        this.resetState();
    },

    resetState: function () {
        this.state.active = false;
        this.state.query = '';
        this.state.matches = [];
        this.state.currentIndex = -1;
        this.state.onlyShowMatches = false;

        // Update UI elements if they exist
        const prefix = this.state.id === 'songlist' ? 'sl-' : (this.state.id === 'leaderboard' ? 'lb-' : 'gl-');
        const bar = document.getElementById(`${prefix}local-search-bar`);
        const input = document.getElementById(`${prefix}local-search-input`);
        const filter = document.getElementById(`${prefix}local-search-filter`);
        const nav = document.getElementById(`${prefix}local-search-nav`);

        if (bar) bar.classList.add('hidden');
        if (input) input.value = '';
        if (filter) filter.checked = false;
        if (nav) nav.classList.add('opacity-0', 'pointer-events-none');
    },

    toggleBar: function (force) {
        const prefix = this.state.id === 'songlist' ? 'sl-' : (this.state.id === 'leaderboard' ? 'lb-' : 'gl-');
        const bar = document.getElementById(`${prefix}local-search-bar`);
        const input = document.getElementById(`${prefix}local-search-input`);
        const show = typeof force === 'boolean' ? force : bar.classList.contains('hidden');

        if (show) {
            bar.classList.remove('hidden');
            input.focus();
            this.state.active = true;
        } else {
            this.resetState();
            if (this.config.renderCallback) this.config.renderCallback();
        }
    },

    handleSearch: function () {
        const prefix = this.state.id === 'songlist' ? 'sl-' : (this.state.id === 'leaderboard' ? 'lb-' : 'gl-');
        const inputVal = document.getElementById(`${prefix}local-search-input`).value.trim().toLowerCase();
        const nav = document.getElementById(`${prefix}local-search-nav`);
        const countEl = document.getElementById(`${prefix}local-search-count`);

        this.state.query = inputVal;
        this.state.active = !!inputVal;

        if (!inputVal) {
            this.state.matches = [];
            this.state.currentIndex = -1;
            if (nav) nav.classList.add('opacity-0', 'pointer-events-none');
            if (this.config.renderCallback) this.config.renderCallback();
            return;
        }

        const list = this.config.getList ? this.config.getList() : [];
        const matches = [];
        list.forEach((item, index) => {
            if ((item.name && item.name.toLowerCase().includes(inputVal)) ||
                (item.singer && item.singer.toLowerCase().includes(inputVal))) {
                matches.push(index);
            }
        });

        this.state.matches = matches;
        this.state.currentIndex = matches.length > 0 ? 0 : -1;

        if (matches.length > 0) {
            if (nav) nav.classList.remove('opacity-0', 'pointer-events-none');
            if (countEl) countEl.textContent = `1/${matches.length}`;
        } else {
            if (nav) nav.classList.add('opacity-0', 'pointer-events-none');
            if (countEl) countEl.textContent = `0/0`;
        }

        if (this.config.renderCallback) this.config.renderCallback();
    },

    navigate: function (dir) {
        if (this.state.matches.length === 0) return;

        let newIdx = this.state.currentIndex + dir;
        if (newIdx < 0) newIdx = this.state.matches.length - 1;
        if (newIdx >= this.state.matches.length) newIdx = 0;

        this.state.currentIndex = newIdx;
        const targetSongIndex = this.state.matches[newIdx];
        const prefix = this.state.id === 'songlist' ? 'sl-' : (this.state.id === 'leaderboard' ? 'lb-' : 'gl-');

        const countEl = document.getElementById(`${prefix}local-search-count`);
        if (countEl) countEl.textContent = `${newIdx + 1}/${this.state.matches.length}`;

        // Handle Pagination if needed
        if (this.config.paginationCallback) {
            const itemsPerPage = this.config.itemsPerPage || 20;
            // 开启过滤模式时，页码计算应基于“匹配列表”中的位置(newIdx)
            const referenceIndex = this.state.onlyShowMatches ? newIdx : targetSongIndex;
            const targetPage = Math.floor(referenceIndex / itemsPerPage) + 1;

            // 准确获取当前页码
            const currentPage = this.config.getCurrentPage ? this.config.getCurrentPage() :
                ((this.state.id === 'global' && typeof window.currentPage !== 'undefined') ? window.currentPage : 1);

            if (targetPage !== currentPage) {
                this.config.paginationCallback(targetPage, targetSongIndex);
            } else {
                // 同页：直接刷新高亮并滚动
                if (this.config.renderCallback) this.config.renderCallback();
                this.scrollToMatch(targetSongIndex);
            }
        } else {
            if (this.config.renderCallback) this.config.renderCallback();
            this.scrollToMatch(targetSongIndex);
        }
    },

    handleKeydown: function (e) {
        if (!e || e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            this.navigate(1);
        }
    },

    toggleFilter: function () {
        const prefix = this.state.id === 'songlist' ? 'sl-' : (this.state.id === 'leaderboard' ? 'lb-' : 'gl-');
        const filterEl = document.getElementById(`${prefix}local-search-filter`);
        this.state.onlyShowMatches = filterEl ? filterEl.checked : false;

        // 切换过滤时，如果正在搜索中且有匹配项，尝试将页面对齐到当前匹配项
        if (this.state.active && this.state.currentIndex !== -1) {
            const itemsPerPage = this.config.itemsPerPage || 20;
            const targetSongIndex = this.state.matches[this.state.currentIndex];
            const referenceIndex = this.state.onlyShowMatches ? this.state.currentIndex : targetSongIndex;
            const targetPage = Math.floor(referenceIndex / itemsPerPage) + 1;

            const currentPage = this.config.getCurrentPage ? this.config.getCurrentPage() :
                ((this.state.id === 'global' && typeof window.currentPage !== 'undefined') ? window.currentPage : 1);

            if (currentPage !== targetPage) {
                if (this.config.paginationCallback) {
                    this.config.paginationCallback(targetPage, targetSongIndex);
                    return;
                } else if (this.state.id === 'global' && window.goToPage) {
                    window.goToPage(targetPage);
                    setTimeout(() => this.scrollToMatch(targetSongIndex), 300);
                    return;
                }
            }
        }

        if (this.config.renderCallback) this.config.renderCallback();

        // 确保当前选中的匹配项在过滤后依然可见
        if (this.state.currentIndex !== -1) {
            const targetSongIndex = this.state.matches[this.state.currentIndex];
            setTimeout(() => this.scrollToMatch(targetSongIndex), 50);
        }
    },

    scrollToMatch: function (index) {
        let rowId;
        if (this.state.id === 'songlist') rowId = `sl-row-${index}`;
        else if (this.state.id === 'leaderboard') rowId = `lb-row-${index}`;
        else rowId = `gl-row-${index}`;

        const row = document.getElementById(rowId);
        if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // Apply a temporary intense highlight
            row.classList.add('search-current', 'shadow-lg');
            setTimeout(() => {
                row.classList.remove('shadow-lg');
                // We keep search-current as it's part of the persistent state highlighting
                // but we might want to pulse it or something? For now keeping it consistent with render.
            }, 2500);
        }
    },

    /**
     * Get the display list based on current filter state
     */
    getDisplayList: function (originalList) {
        if (!this.state.active || !this.state.onlyShowMatches) {
            return originalList.map((item, originalIndex) => ({ item, originalIndex }));
        }

        return originalList
            .map((item, originalIndex) => ({ item, originalIndex }))
            .filter(obj => this.state.matches.includes(obj.originalIndex));
    },

    /**
     * Check if an index is matched by search
     */
    isMatched: function (index) {
        return this.state.active && this.state.matches.includes(index);
    },

    /**
     * Check if an index is the CURRENT focused match
     */
    isCurrentMatch: function (index) {
        return this.state.active && this.state.matches[this.state.currentIndex] === index;
    }
};
