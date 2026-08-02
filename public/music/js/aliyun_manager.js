/**
 * AliyunManager (阿里云盘模块)
 * 云盘文件浏览、搜索、播放、歌词加载、上传到云盘
 */

window.AliyunManager = {
    currentItems: [],
    currentParentId: 'root',
    breadcrumb: [],
    searchMode: false,
    searchKeyword: '',
    loading: false,
    marker: '',
    hasMore: false,

    escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        })[ch]);
    },

    formatSize(size) {
        if (!size) return '';
        if (size < 1024) return size + ' B';
        if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
        if (size < 1024 * 1024 * 1024) return (size / 1024 / 1024).toFixed(1) + ' MB';
        return (size / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    },

    isAudioFile(name) {
        return /\.(mp3|flac|wav|ogg|aac|m4a|ape|wma|opus|alac)$/i.test(name);
    },

    isLyricFile(name) {
        return /\.(lrc|lrcx)$/i.test(name);
    },

    async init() {
        await this.refresh();
    },

    async refresh() {
        this.searchMode = false;
        this.marker = '';
        this.hasMore = false;
        await this.loadList(true);
    },

    async search() {
        const keyword = (document.getElementById('ad-search-input')?.value || '').trim();
        if (!keyword) {
            this.refresh();
            return;
        }
        this.searchMode = true;
        this.searchKeyword = keyword;
        this.marker = '';
        this.hasMore = false;
        this.breadcrumb = [{ fileId: 'search', name: `搜索: ${keyword}` }];
        this.renderBreadcrumb();
        await this.loadList(true);
    },

    clearSearch() {
        const input = document.getElementById('ad-search-input');
        if (input) input.value = '';
        this.refresh();
    },

    async navigateTo(fileId, name) {
        this.searchMode = false;
        this.marker = '';
        this.hasMore = false;
        this.currentParentId = fileId;
        this.breadcrumb.push({ fileId, name });
        this.renderBreadcrumb();
        await this.loadList(true);
    },

    async goBack() {
        if (this.breadcrumb.length > 1) {
            this.breadcrumb.pop();
            const prev = this.breadcrumb[this.breadcrumb.length - 1];
            this.currentParentId = prev.fileId;
            this.renderBreadcrumb();
            await this.loadList(true);
        }
    },

    goRoot() {
        this.searchMode = false;
        this.marker = '';
        this.hasMore = false;
        this.currentParentId = 'root';
        this.breadcrumb = [{ fileId: 'root', name: '根目录' }];
        this.renderBreadcrumb();
        this.loadList(true);
    },

    async loadList(reset = false) {
        if (this.loading) return;
        this.loading = true;
        const statusEl = document.getElementById('ad-status');
        const listEl = document.getElementById('ad-file-list');
        if (!statusEl || !listEl) {
            this.loading = false;
            return;
        }
        if (reset) listEl.innerHTML = '<div class="text-xs t-text-muted py-4 text-center">正在加载...</div>';

        const headers = {};
        if (window.getUserAuthHeaders) Object.assign(headers, window.getUserAuthHeaders());

        let url;
        if (this.searchMode) {
            url = `/api/alidrive/search?keyword=${encodeURIComponent(this.searchKeyword)}`;
            if (this.marker) url += `&marker=${encodeURIComponent(this.marker)}`;
        } else {
            url = `/api/alidrive/list?parentFileId=${encodeURIComponent(this.currentParentId)}`;
            if (this.marker) url += `&marker=${encodeURIComponent(this.marker)}`;
        }

        try {
            const res = await fetch(url, { headers });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || '加载失败');
            }
            const data = await res.json();
            if (!data.success) throw new Error(data.message || '加载失败');

            const items = data.items || [];
            this.marker = data.next_marker || '';
            this.hasMore = !!this.marker;

            if (reset) {
                this.currentItems = items;
            } else {
                this.currentItems = this.currentItems.concat(items);
            }

            this.renderList(reset);
        } catch (err) {
            statusEl.textContent = '加载失败: ' + err.message;
            statusEl.style.color = 'var(--accent-error, #ef4444)';
            if (reset) listEl.innerHTML = '';
        } finally {
            this.loading = false;
        }
    },

    renderList(reset) {
        const statusEl = document.getElementById('ad-status');
        const listEl = document.getElementById('ad-file-list');
        const countEl = document.getElementById('ad-total-count');
        if (!statusEl || !listEl) return;

        const folders = this.currentItems.filter(it => it.type === 'folder');
        const audios = this.currentItems.filter(it => it.type === 'file' && this.isAudioFile(it.name));
        const otherFiles = this.currentItems.filter(it => it.type === 'file' && !this.isAudioFile(it.name) && !this.isLyricFile(it.name));
        const lyricFiles = this.currentItems.filter(it => it.type === 'file' && this.isLyricFile(it.name));

        if (!this.currentItems.length) {
            statusEl.textContent = '此目录为空';
            statusEl.style.color = '';
            if (countEl) countEl.textContent = '共 0 项';
            if (reset) listEl.innerHTML = '<div class="text-xs t-text-muted py-6 text-center">此目录为空</div>';
            return;
        }

        statusEl.textContent = '';
        statusEl.style.color = '';
        if (countEl) countEl.textContent = `共 ${this.currentItems.length} 项（音频 ${audios.length}）`;

        let html = '';

        // 返回上级
        if (reset && this.breadcrumb.length > 1) {
            html += `
                <div class="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:t-bg-main transition-colors"
                    onclick="window.AliyunManager.goBack()">
                    <i class="fas fa-level-up-alt text-xs t-text-muted w-5 text-center"></i>
                    <span class="text-xs t-text-main">返回上级</span>
                </div>`;
        }

        // 文件夹
        folders.forEach((it, i) => {
            html += `
                <div class="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:t-bg-main transition-colors"
                    onclick="window.AliyunManager.navigateTo('${this.escapeHtml(it.file_id)}', '${this.escapeHtml(it.name)}')">
                    <i class="fas fa-folder text-[var(--c-500)] text-sm w-5 text-center"></i>
                    <span class="text-xs t-text-main truncate flex-1">${this.escapeHtml(it.name)}</span>
                </div>`;
        });

        // 音频文件
        audios.forEach((it, i) => {
            const globalIndex = i;
            html += `
                <div class="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:t-bg-main transition-colors group"
                    onclick="window.AliyunManager.playAudio('${this.escapeHtml(it.file_id)}', '${this.escapeHtml(it.name)}', ${globalIndex})">
                    <i class="fas fa-music text-emerald-500 text-sm w-5 text-center"></i>
                    <span class="text-xs t-text-main truncate flex-1">${this.escapeHtml(it.name)}</span>
                    <span class="text-[10px] t-text-muted shrink-0">${this.formatSize(it.size)}</span>
                    <span class="hidden group-hover:flex items-center gap-1 shrink-0">
                        <button class="w-6 h-6 flex items-center justify-center rounded hover:bg-emerald-500 hover:text-white transition-all"
                            title="播放" onclick="event.stopPropagation(); window.AliyunManager.playAudio('${this.escapeHtml(it.file_id)}', '${this.escapeHtml(it.name)}', ${globalIndex})">
                            <i class="fas fa-play text-xs"></i>
                        </button>
                        <button class="w-6 h-6 flex items-center justify-center rounded hover:bg-blue-500 hover:text-white transition-all"
                            title="下载到本地" onclick="event.stopPropagation(); window.AliyunManager.downloadFile('${this.escapeHtml(it.file_id)}', '${this.escapeHtml(it.name)}')">
                            <i class="fas fa-download text-xs"></i>
                        </button>
                    </span>
                </div>`;
        });

        // 歌词文件（标注，不单独展示可播放项，但显示提示）
        if (lyricFiles.length) {
            html += `<div class="text-[10px] t-text-muted px-3 py-1">歌词文件（随歌曲自动识别）：${lyricFiles.map(l => this.escapeHtml(l.name)).join('、')}</div>`;
        }

        // 其他文件（折叠展示）
        if (otherFiles.length) {
            html += `<div class="text-[10px] t-text-muted px-3 py-1">其他文件 ${otherFiles.length} 个（已隐藏）</div>`;
        }

        if (reset) {
            listEl.innerHTML = html;
        } else {
            listEl.insertAdjacentHTML('beforeend', html);
        }

        if (this.hasMore) {
            const moreBtn = document.createElement('div');
            moreBtn.id = 'ad-more-btn';
            moreBtn.className = 'text-center py-3';
            moreBtn.innerHTML = '<button class="text-xs px-3 py-1 rounded-lg bg-gray-100 dark:bg-gray-700/50 hover:text-emerald-500 transition-all" onclick="window.AliyunManager.loadMore()">加载更多</button>';
            listEl.appendChild(moreBtn);
        }
    },

    async loadMore() {
        const btn = document.getElementById('ad-more-btn');
        if (btn) btn.remove();
        await this.loadList(false);
    },

    renderBreadcrumb() {
        const el = document.getElementById('ad-breadcrumb');
        if (!el) return;
        el.innerHTML = this.breadcrumb.map((b, i) => {
            const isLast = i === this.breadcrumb.length - 1;
            const name = b.name.length > 20 ? b.name.slice(0, 20) + '...' : b.name;
            if (isLast) return `<span class="t-text-main font-bold">${this.escapeHtml(name)}</span>`;
            return `<button class="hover:text-emerald-500 transition-colors" onclick="window.AliyunManager.breadcrumbTo(${i})">${this.escapeHtml(name)}</button><i class="fas fa-chevron-right text-[8px] t-text-muted"></i>`;
        }).join('');
    },

    breadcrumbTo(index) {
        this.breadcrumb = this.breadcrumb.slice(0, index + 1);
        const target = this.breadcrumb[this.breadcrumb.length - 1];
        if (target.fileId === 'search') return;
        this.currentParentId = target.fileId;
        this.searchMode = false;
        this.marker = '';
        this.hasMore = false;
        this.renderBreadcrumb();
        this.loadList(true);
    },

    // ===== 播放 =====
    async playAudio(fileId, fileName, audioIndex = 0) {
        // 构造当前目录下所有音频的播放列表
        const audios = this.currentItems.filter(it => it.type === 'file' && this.isAudioFile(it.name));
        if (!audios.length) return;

        const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '_open';
        const authToken = (window.getUserAuthHeaders ? window.getUserAuthHeaders()['x-user-token'] : null) || localStorage.getItem('lx_user_token') || '';
        const tokenSuffix = authToken ? `&token=${encodeURIComponent(authToken)}` : '';

        const makeSong = (file) => {
            const name = file.name.replace(/\.[^.]+$/, '');
            return {
                id: `alipan_${file.file_id}`,
                songmid: `alipan_${file.file_id}`,
                songId: `alipan_${file.file_id}`,
                source: 'alipan',
                name,
                singer: '',
                fileId: file.file_id,
                url: `/api/alidrive/stream?fileId=${encodeURIComponent(file.file_id)}${tokenSuffix}`,
                isLocal: true,
                alidrive: true,
                quality: 'flac',
                type: 'flac',
                interval: 0
            };
        };

        const playlist = audios.map(makeSong);
        const idx = Math.max(audios.findIndex(a => a.file_id === fileId), 0);

        if (typeof window.updatePlaylist === 'function') {
            window.updatePlaylist(playlist, idx, 'alidrive');
        } else if (typeof window.playSong === 'function') {
            window.playSong(playlist[idx], idx);
        }
    },

    downloadFile(fileId, fileName) {
        const a = document.createElement('a');
        a.href = `/api/alidrive/download?fileId=${encodeURIComponent(fileId)}`;
        a.download = fileName;
        a.target = '_blank';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    },

    // ===== 上传歌曲到云盘 =====
    uploadFromUrl() {
        if (typeof showInputModal === 'function') {
            showInputModal({
                title: '上传歌曲到阿里云盘',
                message: '输入歌曲直链 URL 与文件名，将下载并保存到云盘的 /music/lxserver 目录。',
                fields: [
                    { id: 'ad-upload-url', label: '歌曲 URL', type: 'text', placeholder: 'https://.../song.mp3', required: true },
                    { id: 'ad-upload-filename', label: '文件名（含扩展名）', type: 'text', placeholder: '歌曲名.mp3' }
                ],
                onConfirm: async (values) => {
                    const url = values['ad-upload-url'];
                    const filename = values['ad-upload-filename'];
                    await this._doUpload(url, filename);
                }
            });
            return;
        }

        // Fallback：使用浏览器 prompt
        const url = prompt('请输入歌曲 URL（可留空，使用当前播放歌曲）:');
        this._doUpload(url, null);
    },

    async _doUpload(sourceUrl, filename) {
        if (!sourceUrl) {
            const cur = window.currentPlayingSong;
            if (cur && cur.url) {
                if (cur.url.startsWith('/api/alidrive/stream')) {
                    if (typeof showError === 'function') showError('该歌曲已存在于阿里云盘，无需重复上传');
                    return;
                }
                sourceUrl = cur.url;
                if (!filename) filename = (cur.name || 'song') + '.mp3';
            }
        }
        if (!sourceUrl) {
            if (typeof showError === 'function') showError('缺少歌曲 URL');
            return;
        }

        if (typeof showLoading === 'function') showLoading('正在上传到阿里云盘...');
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (window.getUserAuthHeaders) Object.assign(headers, window.getUserAuthHeaders());
            const res = await fetch('/api/alidrive/upload-song', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    url: sourceUrl,
                    filename: filename || 'song.mp3',
                    dirPath: '/music/lxserver'
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '上传失败');
            if (typeof showSuccess === 'function') showSuccess(`已上传到云盘: ${filename || 'song.mp3'}`);
            this.refresh();
        } catch (err) {
            if (typeof showError === 'function') showError('上传失败: ' + err.message);
        } finally {
            if (typeof hideLoading === 'function') hideLoading();
        }
    },
};

// 切换 Tab 到阿里云盘时刷新
(function () {
    const origSwitchTab = window.switchTab;
    window.switchTab = function (tabId) {
        if (typeof origSwitchTab === 'function') origSwitchTab(tabId);
        if (tabId === 'alidrive') {
            window.AliyunManager.refresh();
        }
    };
})();
