/**
 * OpenListManager (OpenList 存储模块)
 * 浏览/搜索 OpenList 服务器目录、播放音频、歌词加载、上传歌曲
 */

window.OpenListManager = {
    servers: [],
    currentServerId: '',
    currentServer: null,
    currentItems: [],
    currentPath: '/',
    breadcrumb: [],
    searchMode: false,
    searchKeyword: '',
    loading: false,

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
        await this.loadServers();
    },

    async loadServers() {
        const headers = {};
        if (window.getUserAuthHeaders) Object.assign(headers, window.getUserAuthHeaders());
        try {
            const res = await fetch('/api/openlist/available', { headers });
            if (!res.ok) throw new Error('加载失败');
            const data = await res.json();
            this.servers = (data.servers || []).filter(s => s.baseUrl);
            const select = document.getElementById('ol-server-select');
            if (!select) return;
            const saved = localStorage.getItem('lx_openlist_server');
            let options = '<option value="">选择服务器</option>';
            this.servers.forEach(s => {
                options += `<option value="${this.escapeHtml(s.id)}">${this.escapeHtml(s.name)}</option>`;
            });
            select.innerHTML = options;
            if (saved && this.servers.some(s => s.id === saved)) {
                select.value = saved;
                this.selectServer(saved);
            }
        } catch (err) {
            const statusEl = document.getElementById('ol-status');
            if (statusEl) statusEl.textContent = '加载服务器失败: ' + err.message;
        }
    },

    async selectServer(serverId) {
        this.currentServerId = serverId;
        this.currentServer = this.servers.find(s => s.id === serverId) || null;
        if (serverId) localStorage.setItem('lx_openlist_server', serverId);
        if (!this.currentServer) {
            const statusEl = document.getElementById('ol-status');
            if (statusEl) statusEl.textContent = '请先选择 OpenList 服务器';
            document.getElementById('ol-file-list').innerHTML = '';
            document.getElementById('ol-breadcrumb').innerHTML = '';
            return;
        }
        await this.refresh();
    },

    async refresh() {
        this.searchMode = false;
        this.currentPath = this.currentServer ? (this.currentServer.rootPath || '/') : '/';
        this.breadcrumb = [{ path: this.currentPath, name: '根目录' }];
        this.renderBreadcrumb();
        await this.loadList(true);
    },

    async search() {
        const keyword = (document.getElementById('ol-search-input')?.value || '').trim();
        if (!keyword || !this.currentServer) {
            this.refresh();
            return;
        }
        this.searchMode = true;
        this.searchKeyword = keyword;
        this.breadcrumb = [{ path: '', name: `搜索: ${keyword}` }];
        this.renderBreadcrumb();
        await this.loadList(true);
    },

    clearSearch() {
        const input = document.getElementById('ol-search-input');
        if (input) input.value = '';
        this.refresh();
    },

    async navigateTo(dirPath, name) {
        this.searchMode = false;
        this.currentPath = dirPath;
        this.breadcrumb.push({ path: dirPath, name });
        this.renderBreadcrumb();
        await this.loadList(true);
    },

    async goBack() {
        if (this.breadcrumb.length > 1) {
            this.breadcrumb.pop();
            const prev = this.breadcrumb[this.breadcrumb.length - 1];
            if (prev.path === '') {
                this.refresh();
                return;
            }
            this.currentPath = prev.path;
            this.renderBreadcrumb();
            await this.loadList(true);
        }
    },

    goRoot() {
        if (!this.currentServer) return;
        this.refresh();
    },

    async loadList(reset = true) {
        if (this.loading) return;
        this.loading = true;
        const statusEl = document.getElementById('ol-status');
        const listEl = document.getElementById('ol-file-list');
        if (!statusEl || !listEl || !this.currentServer) {
            this.loading = false;
            return;
        }
        if (reset) listEl.innerHTML = '<div class="text-xs t-text-muted py-4 text-center">正在加载...</div>';

        const headers = {};
        if (window.getUserAuthHeaders) Object.assign(headers, window.getUserAuthHeaders());

        let url;
        if (this.searchMode) {
            url = `/api/openlist/search?server=${encodeURIComponent(this.currentServerId)}&keyword=${encodeURIComponent(this.searchKeyword)}`;
        } else {
            url = `/api/openlist/list?server=${encodeURIComponent(this.currentServerId)}&path=${encodeURIComponent(this.currentPath)}`;
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
            this.currentItems = items;
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
        const statusEl = document.getElementById('ol-status');
        const listEl = document.getElementById('ol-file-list');
        const countEl = document.getElementById('ol-total-count');
        if (!statusEl || !listEl) return;

        const folders = this.currentItems.filter(it => it.is_dir);
        const audios = this.currentItems.filter(it => !it.is_dir && this.isAudioFile(it.name));
        const otherFiles = this.currentItems.filter(it => !it.is_dir && !this.isAudioFile(it.name) && !this.isLyricFile(it.name));
        const lyricFiles = this.currentItems.filter(it => !it.is_dir && this.isLyricFile(it.name));

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

        if (reset && this.breadcrumb.length > 1) {
            html += `
                <div class="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:t-bg-main transition-colors"
                    onclick="window.OpenListManager.goBack()">
                    <i class="fas fa-level-up-alt text-xs t-text-muted w-5 text-center"></i>
                    <span class="text-xs t-text-main">返回上级</span>
                </div>`;
        }

        folders.forEach((it) => {
            const childPath = (this.currentPath === '/' ? '' : this.currentPath) + '/' + it.name;
            html += `
                <div class="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:t-bg-main transition-colors"
                    onclick="window.OpenListManager.navigateTo('${this.escapeHtml(childPath)}', '${this.escapeHtml(it.name)}')">
                    <i class="fas fa-folder text-[var(--c-500)] text-sm w-5 text-center"></i>
                    <span class="text-xs t-text-main truncate flex-1">${this.escapeHtml(it.name)}</span>
                </div>`;
        });

        audios.forEach((it, i) => {
            const globalIndex = i;
            html += `
                <div class="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:t-bg-main transition-colors group"
                    onclick="window.OpenListManager.playAudio('${this.escapeHtml(it.name)}', ${globalIndex})">
                    <i class="fas fa-music text-emerald-500 text-sm w-5 text-center"></i>
                    <span class="text-xs t-text-main truncate flex-1">${this.escapeHtml(it.name)}</span>
                    <span class="text-[10px] t-text-muted shrink-0">${this.formatSize(it.size)}</span>
                    <span class="hidden group-hover:flex items-center gap-1 shrink-0">
                        <button class="w-6 h-6 flex items-center justify-center rounded hover:bg-emerald-500 hover:text-white transition-all"
                            title="播放" onclick="event.stopPropagation(); window.OpenListManager.playAudio('${this.escapeHtml(it.name)}', ${globalIndex})">
                            <i class="fas fa-play text-xs"></i>
                        </button>
                        <button class="w-6 h-6 flex items-center justify-center rounded hover:bg-blue-500 hover:text-white transition-all"
                            title="下载到本地" onclick="event.stopPropagation(); window.OpenListManager.downloadFile('${this.escapeHtml(it.name)}', '${this.escapeHtml(it.sign || '')}')">
                            <i class="fas fa-download text-xs"></i>
                        </button>
                    </span>
                </div>`;
        });

        if (lyricFiles.length) {
            html += `<div class="text-[10px] t-text-muted px-3 py-1">歌词文件（随歌曲自动识别）：${lyricFiles.map(l => this.escapeHtml(l.name)).join('、')}</div>`;
        }

        if (otherFiles.length) {
            html += `<div class="text-[10px] t-text-muted px-3 py-1">其他文件 ${otherFiles.length} 个（已隐藏）</div>`;
        }

        if (reset) {
            listEl.innerHTML = html;
        } else {
            listEl.insertAdjacentHTML('beforeend', html);
        }
    },

    renderBreadcrumb() {
        const el = document.getElementById('ol-breadcrumb');
        if (!el) return;
        el.innerHTML = this.breadcrumb.map((b, i) => {
            const isLast = i === this.breadcrumb.length - 1;
            const name = b.name.length > 20 ? b.name.slice(0, 20) + '...' : b.name;
            if (isLast) return `<span class="t-text-main font-bold">${this.escapeHtml(name)}</span>`;
            return `<button class="hover:text-emerald-500 transition-colors" onclick="window.OpenListManager.breadcrumbTo(${i})">${this.escapeHtml(name)}</button><i class="fas fa-chevron-right text-[8px] t-text-muted"></i>`;
        }).join('');
    },

    breadcrumbTo(index) {
        this.breadcrumb = this.breadcrumb.slice(0, index + 1);
        const target = this.breadcrumb[this.breadcrumb.length - 1];
        if (target.path === '') return;
        this.currentPath = target.path;
        this.searchMode = false;
        this.renderBreadcrumb();
        this.loadList(true);
    },

    // 构造当前目录下某个音频的完整路径
    _fullPath(name) {
        if (this.searchMode) return '/' + name;
        const base = this.currentPath === '/' ? '' : this.currentPath;
        return base + '/' + name;
    },

    // ===== 播放 =====
    playAudio(fileName, audioIndex = 0) {
        const audios = this.currentItems.filter(it => !it.is_dir && this.isAudioFile(it.name));
        if (!audios.length) return;

        const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '_open';
        const authToken = (window.getUserAuthHeaders ? window.getUserAuthHeaders()['x-user-token'] : null) || localStorage.getItem('lx_user_token') || '';
        const tokenSuffix = authToken ? `&token=${encodeURIComponent(authToken)}` : '';

        const makeSong = (file) => {
            const name = file.name.replace(/\.[^.]+$/, '');
            const fullPath = this._fullPath(file.name);
            const sign = file.sign || '';
            return {
                id: `openlist_${encodeURIComponent(fullPath)}`,
                songmid: `openlist_${encodeURIComponent(fullPath)}`,
                songId: `openlist_${encodeURIComponent(fullPath)}`,
                source: 'openlist',
                name,
                singer: '',
                path: fullPath,
                serverId: this.currentServerId,
                sign,
                url: `/api/openlist/stream?server=${encodeURIComponent(this.currentServerId)}&path=${encodeURIComponent(fullPath)}${sign ? `&sign=${encodeURIComponent(sign)}` : ''}${tokenSuffix}`,
                isLocal: true,
                openlist: true,
                quality: 'flac',
                type: 'flac',
                interval: 0
            };
        };

        const playlist = audios.map(makeSong);
        const idx = Math.max(audios.findIndex(a => a.name === fileName), 0);

        if (typeof window.updatePlaylist === 'function') {
            window.updatePlaylist(playlist, idx, 'openlist');
        } else if (typeof window.playSong === 'function') {
            window.playSong(playlist[idx], idx);
        }
    },

    downloadFile(fileName, sign) {
        const fullPath = this._fullPath(fileName);
        const authToken = (window.getUserAuthHeaders ? window.getUserAuthHeaders()['x-user-token'] : null) || localStorage.getItem('lx_user_token') || '';
        const tokenSuffix = authToken ? `&token=${encodeURIComponent(authToken)}` : '';
        const a = document.createElement('a');
        let url = `/api/openlist/download?server=${encodeURIComponent(this.currentServerId)}&path=${encodeURIComponent(fullPath)}`;
        if (sign) url += `&sign=${encodeURIComponent(sign)}`;
        url += tokenSuffix;
        a.href = url;
        a.download = fileName;
        a.target = '_blank';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    },

    // ===== 上传歌曲到 OpenList =====
    uploadFromUrl() {
        if (!this.currentServer) {
            if (typeof showError === 'function') showError('请先选择 OpenList 服务器');
            return;
        }
        if (typeof showInputModal === 'function') {
            showInputModal({
                title: '上传歌曲到 OpenList',
                message: '输入歌曲直链 URL 与文件名，将下载并保存到 OpenList 当前目录。需要服务器配置了用户名/密码或 Token。',
                fields: [
                    { id: 'ol-upload-url', label: '歌曲 URL', type: 'text', placeholder: 'https://.../song.mp3', required: true },
                    { id: 'ol-upload-filename', label: '文件名（含扩展名）', type: 'text', placeholder: '歌曲名.mp3' }
                ],
                onConfirm: async (values) => {
                    const url = values['ol-upload-url'];
                    const filename = values['ol-upload-filename'];
                    await this._doUpload(url, filename);
                }
            });
            return;
        }

        const url = prompt('请输入歌曲 URL（可留空，使用当前播放歌曲）:');
        this._doUpload(url, null);
    },

    async _doUpload(sourceUrl, filename) {
        if (!sourceUrl) {
            const cur = window.currentPlayingSong;
            if (cur && cur.url) {
                if (cur.openlist) {
                    if (typeof showError === 'function') showError('该歌曲已存在于 OpenList，无需重复上传');
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

        if (typeof showLoading === 'function') showLoading('正在上传到 OpenList...');
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (window.getUserAuthHeaders) Object.assign(headers, window.getUserAuthHeaders());
            const res = await fetch('/api/openlist/upload-song', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    server: this.currentServerId,
                    url: sourceUrl,
                    filename: filename || 'song.mp3',
                    dirPath: this.searchMode ? '' : this.currentPath
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '上传失败');
            if (typeof showSuccess === 'function') showSuccess(`已上传到 OpenList: ${filename || 'song.mp3'}`);
            if (!this.searchMode) this.loadList(true);
        } catch (err) {
            if (typeof showError === 'function') showError('上传失败: ' + err.message);
        } finally {
            if (typeof hideLoading === 'function') hideLoading();
        }
    },
};

// 切换 Tab 到 OpenList 时加载
(function () {
    const origSwitchTab = window.switchTab;
    window.switchTab = function (tabId) {
        if (typeof origSwitchTab === 'function') origSwitchTab(tabId);
        if (tabId === 'openlist') {
            window.OpenListManager.init();
        }
    };
})();
