/* Server-owned matching jobs: closing the panel or refreshing never stops a job. */
window.AutoLinkPanel = (() => {
    const platforms = { tx: 'QQ 音乐', wy: '网易云音乐', kg: '酷狗音乐', kw: '酷我音乐', mg: '咪咕音乐' };
    const defaultTagColors = {
        tx: 't-badge-green border-green-200 dark:border-emerald-500/30',
        wy: 't-badge-red border-red-200 dark:border-red-500/30',
        kg: 't-badge-blue border-blue-200 dark:border-blue-500/30',
        kw: 't-badge-yellow border-yellow-200 dark:border-yellow-500/30',
        mg: 't-badge-pink border-pink-200 dark:border-pink-500/30'
    };
    const defaultTagNames = { tx: 'QQ', wy: '网易', kg: '酷狗', kw: '酷我', mg: '咪咕' };

    const labels = {
        idle: '尚未开始',
        running: '正在检测',
        cancelling: '正在停止（等待当前操作结束）',
        completed: '检测完成',
        cancelled: '已停止',
        interrupted: '已中断',
        error: '任务异常'
    };

    let modal, session = 0, pollRevision = 0, timer, user, auth, custom, location,
        candidates = [], selected = new Set(), results = [], taskId = '',
        busy = true, page = 1, resultPage = 1, terminalId = '', previousFocus;

    const el = id => document.getElementById('al-' + id);
    const escape = value => window.LocalMusicManager?.escapeHtml?.(value) ?? String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const escapeAttr = value => window.LocalMusicManager?.escapeAttr?.(value) ?? escape(value);
    const active = () => modal && !modal.classList.contains('hidden') && user === window.LocalMusicManager?.getCurrentUsername?.();

    // Render platform source tag adhering to song list style
    function renderPlatformTag(source) {
        if (!source) return '';
        if (typeof window.getSourceTag === 'function') {
            return window.getSourceTag(source);
        }
        const s = String(source).toLowerCase();
        const color = defaultTagColors[s] || 't-bg-main t-text-muted t-border-main';
        const name = defaultTagNames[s] || s.toUpperCase();
        return `<span class="song-tag ${color}">${name}</span>`;
    }

    function getSavedConcurrency() {
        const val = parseInt(localStorage.getItem('lx_autolink_concurrency'), 10);
        return [1, 2, 3, 4].includes(val) ? val : 2;
    }

    function saveConcurrency(val) {
        localStorage.setItem('lx_autolink_concurrency', String(val));
    }

    function mount() {
        if (modal) return;
        modal = document.createElement('div');
        modal.id = 'lm-auto-link-modal';
        modal.className = 'fixed inset-0 z-[110] hidden items-center justify-center p-2.5 md:p-6';
        modal.innerHTML = `
          <!-- Backdrop -->
          <div class="absolute inset-0 bg-black/75 backdrop-blur-md transition-opacity" data-close></div>

          <!-- Dialog Box -->
          <section role="dialog" aria-modal="true" aria-labelledby="al-title"
            class="relative t-bg-panel/95 border t-border-main rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] md:h-[86vh] md:max-h-[780px] flex flex-col overflow-hidden backdrop-blur-xl">

            <!-- Modal Header -->
            <header class="px-5 py-3.5 border-b t-border-main flex items-center justify-between shrink-0 bg-gray-50/50 dark:bg-white/[0.02]">
              <div class="flex items-center gap-3 min-w-0">
                <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 via-teal-500 to-cyan-500 text-white flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
                  <i class="fas fa-wand-magic-sparkles text-xs"></i>
                </div>
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <h3 id="al-title" class="text-base font-bold t-text-main tracking-tight">智能检测</h3>
                    <span id="al-scope-badge" class="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">待检测</span>
                  </div>
                  <p id="al-scope" class="text-[11px] t-text-muted truncate mt-0.5">声学指纹深度识别与多平台歌曲匹配，智能补全歌曲信息</p>
                </div>
              </div>
              <button class="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 transition-all duration-200"
                data-close aria-label="关闭智能检测" title="关闭">
                <i class="fas fa-times text-sm"></i>
              </button>
            </header>

            <!-- Modal Body: Responsive Split Layout -->
            <div class="p-4 md:p-5 flex-1 min-h-0 overflow-y-auto md:overflow-hidden grid grid-cols-1 md:grid-cols-12 gap-4">

              <!-- Left Panel: Song Selection & Search (7 cols) -->
              <div class="md:col-span-7 flex flex-col min-h-[360px] md:min-h-0 border t-border-main rounded-xl overflow-hidden shadow-xs bg-gray-50/20 dark:bg-white/[0.01]">
                <!-- Top Toolbar -->
                <div class="px-3.5 py-2.5 t-bg-main border-b t-border-main flex items-center justify-between gap-2 shrink-0">
                  <div class="flex items-center gap-1.5 text-xs font-bold t-text-main min-w-0">
                    <i class="fas fa-list-check text-emerald-500 text-xs shrink-0"></i>
                    <span class="truncate">未链接歌曲</span>
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 dark:bg-white/10 t-text-muted shrink-0">
                      已选 <b id="al-selected-count" class="text-emerald-500 mx-1">0</b> / <span id="al-count" class="ml-1">0</span>
                    </span>
                  </div>
                  <div class="flex items-center gap-1.5 shrink-0">
                    <button id="al-all" class="h-6.5 px-2 text-[11px] font-medium border t-border-main rounded-md hover:t-bg-track hover:border-emerald-400/50 flex items-center gap-1 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                      <i class="fas fa-check-double text-[9px]"></i>
                      全选
                    </button>
                    <button id="al-none" class="h-6.5 px-2 text-[11px] font-medium border t-border-main rounded-md hover:t-bg-track flex items-center gap-1 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                      <i class="fas fa-times text-[9px]"></i>
                      清空
                    </button>
                    <button id="al-reload" class="h-6.5 px-2 text-[11px] font-medium border t-border-main rounded-md hover:t-bg-track flex items-center gap-1 transition-all disabled:opacity-40 disabled:cursor-not-allowed" title="刷新列表">
                      <i class="fas fa-rotate text-[9px]"></i>
                      刷新
                    </button>
                  </div>
                </div>

                <!-- Search Bar -->
                <div class="p-2 border-b t-border-main t-bg-main shrink-0">
                  <div class="relative flex items-center">
                    <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none z-10"></i>
                    <input id="al-search" type="search" placeholder="搜索歌曲、歌手或文件名..." aria-label="搜索未链接歌曲"
                      style="padding-left: 2.25rem !important;"
                      class="w-full h-8 pr-3 t-bg-main border t-border-main rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-all">
                  </div>
                </div>

                <!-- Song List -->
                <div id="al-songs" class="flex-1 overflow-y-auto custom-scrollbar divide-y divide-gray-100 dark:divide-white/[0.04] min-h-[220px]">
                  <div class="h-full min-h-[160px] flex items-center justify-center text-xs t-text-muted">正在加载歌曲...</div>
                </div>

                <!-- Bottom Pagination -->
                <div class="h-8.5 px-3 t-bg-main border-t t-border-main flex items-center justify-between shrink-0">
                  <span id="al-source-hint" class="text-[10px] t-text-muted flex items-center gap-1 truncate">
                    <i class="fas fa-circle-info text-[9px]"></i>
                    <span id="al-page-summary">仅列出尚未链接平台的歌曲</span>
                  </span>
                  <div class="flex items-center gap-1 shrink-0">
                    <button id="al-prev" class="w-6 h-6 flex items-center justify-center rounded-md border t-border-main hover:t-bg-track disabled:opacity-30 disabled:cursor-not-allowed transition-all" title="上一页">
                      <i class="fas fa-chevron-left text-[9px]"></i>
                    </button>
                    <span id="al-page" class="min-w-10 text-center text-[10px] font-mono t-text-muted font-medium">1 / 1</span>
                    <button id="al-next" class="w-6 h-6 flex items-center justify-center rounded-md border t-border-main hover:t-bg-track disabled:opacity-30 disabled:cursor-not-allowed transition-all" title="下一页">
                      <i class="fas fa-chevron-right text-[9px]"></i>
                    </button>
                  </div>
                </div>
              </div>

              <!-- Right Panel: Controls, Dashboard & Results (5 cols) -->
              <div class="md:col-span-5 flex flex-col gap-3 min-h-0">

                <!-- Platform Settings & Trigger Console -->
                <div class="p-3 rounded-xl border t-border-main bg-gray-50/60 dark:bg-white/[0.02] shadow-xs shrink-0 space-y-2.5">
                  <div>
                    <div class="flex items-center justify-between mb-1.5">
                      <label class="text-xs font-bold t-text-main flex items-center gap-1.5">
                        <i class="fas fa-layer-group text-[11px] text-emerald-500"></i>
                        匹配平台
                      </label>
                      <span class="text-[10px] t-text-muted">按顺序依次尝试匹配</span>
                    </div>

                    <!-- Modern Pill Checkboxes -->
                    <fieldset id="al-platforms" class="flex flex-wrap gap-1.5 text-xs">
                      ${Object.entries(platforms).map(([key, name]) => `
                        <label class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border t-border-main text-xs font-medium cursor-pointer hover:t-bg-track select-none transition-all has-[:checked]:border-emerald-500/50 has-[:checked]:bg-emerald-500/10 has-[:checked]:text-emerald-600 dark:has-[:checked]:text-emerald-400">
                          <input type="checkbox" value="${key}" checked class="accent-emerald-500 w-3.5 h-3.5 rounded cursor-pointer">
                          <span>${name}</span>
                        </label>
                      `).join('')}
                    </fieldset>
                  </div>

                  <!-- Concurrency Multi-thread Setting -->
                  <div class="flex items-center justify-between pt-1 border-t t-border-main">
                    <label for="al-concurrency" class="text-xs font-bold t-text-main flex items-center gap-1.5 cursor-pointer">
                      <i class="fas fa-microchip text-[11px] text-emerald-500"></i>
                      <span>识别并发线程</span>
                    </label>
                    <div class="flex items-center gap-2">
                      <select id="al-concurrency" class="h-7 px-2 rounded-lg text-xs font-medium t-bg-main border t-border-main focus:ring-2 focus:ring-emerald-500/30 transition-all cursor-pointer">
                        <option value="1">1 线程 (单任务顺序)</option>
                        <option value="2">2 线程 (默认推荐)</option>
                        <option value="3">3 线程 (极速并发)</option>
                        <option value="4">4 线程 (激进模式)</option>
                      </select>
                    </div>
                  </div>

                  <!-- Mini Strategy Hint -->
                  <div class="text-[10px] leading-normal text-emerald-800/90 dark:text-emerald-200/80 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5">
                    <i class="fas fa-fingerprint text-emerald-500 text-[10px] shrink-0"></i>
                    <span>声纹识别与多平台搜索并行执行，歌曲关联与写入排队串行保存以保障安全。</span>
                  </div>

                  <!-- Start / Stop Button Controls -->
                  <div class="flex items-center gap-2">
                    <button id="al-start" disabled
                      class="w-full h-9 px-4 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-emerald-500/20 disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed active:scale-[0.98] transition-all duration-200">
                      <i class="fas fa-play text-[10px]"></i>
                      <span>开始智能检测</span>
                    </button>
                    <button id="al-cancel" disabled
                      class="hidden w-full h-9 px-4 bg-gray-700 hover:bg-gray-800 text-white rounded-lg font-bold text-xs items-center justify-center gap-2 transition-all">
                      <i class="fas fa-stop text-[10px]"></i>
                      <span>停止任务</span>
                    </button>
                  </div>
                </div>

                <!-- Live Progress & Metrics Dashboard -->
                <div class="p-3 rounded-xl border t-border-main bg-gray-50/40 dark:bg-white/[0.01] shadow-xs shrink-0 space-y-2.5">
                  <div>
                    <div class="flex items-center justify-between text-xs mb-1.5">
                      <span id="al-status" class="font-bold t-text-main flex items-center gap-1.5 text-xs">
                        <span id="al-status-dot" class="w-2 h-2 rounded-full bg-gray-400"></span>
                        <span id="al-status-text">尚未开始</span>
                      </span>
                      <span id="al-progress-text" class="font-mono font-semibold text-[11px] text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.2 rounded-full border border-emerald-200 dark:border-emerald-900/40">
                        0 / 0
                      </span>
                    </div>

                    <!-- Progress Bar -->
                    <div class="h-2 bg-gray-200/80 dark:bg-gray-800/80 rounded-full overflow-hidden border t-border-main p-0.2 shadow-inner">
                      <div id="al-progress" class="h-full bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 rounded-full transition-all duration-300 shadow-sm" style="width: 0%"></div>
                    </div>
                  </div>

                  <!-- Current Action Notice -->
                  <div id="al-current" class="text-[11px] t-text-muted truncate"></div>

                  <!-- 4 Stats Metric Cards -->
                  <div class="grid grid-cols-4 gap-1.5 text-center">
                    <div class="border t-border-main rounded-lg p-1.5 bg-gray-50/40 dark:bg-white/[0.01]">
                      <div class="text-[9px] font-medium t-text-muted truncate">总数</div>
                      <div id="al-metric-total" class="text-xs font-black t-text-main font-mono mt-0.5">0</div>
                    </div>
                    <div class="border t-border-main rounded-lg p-1.5 bg-emerald-500/[0.03]">
                      <div class="text-[9px] font-medium text-emerald-600 dark:text-emerald-400 truncate">成功匹配</div>
                      <div id="al-metric-linked" class="text-xs font-black text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">0</div>
                    </div>
                    <div class="border t-border-main rounded-lg p-1.5 bg-amber-500/[0.03]">
                      <div class="text-[9px] font-medium text-amber-600 dark:text-amber-400 truncate">未匹配/失败</div>
                      <div id="al-metric-failed" class="text-xs font-black text-amber-600 dark:text-amber-400 font-mono mt-0.5">0</div>
                    </div>
                    <div class="border t-border-main rounded-lg p-1.5 bg-gray-500/[0.02]">
                      <div class="text-[9px] font-medium text-gray-500 dark:text-gray-400 truncate">已处理</div>
                      <div id="al-metric-processed" class="text-xs font-black text-gray-500 dark:text-gray-400 font-mono mt-0.5">0</div>
                    </div>
                  </div>
                </div>

                <!-- Error Alert Box -->
                <div id="al-error-box" class="hidden px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-500 flex items-center gap-2 shrink-0">
                  <i class="fas fa-circle-exclamation shrink-0 text-red-500"></i>
                  <span id="al-error" class="break-all flex-1 text-[11px]"></span>
                </div>

                <!-- Live Results List -->
                <div class="flex-1 min-h-[160px] flex flex-col border t-border-main rounded-xl overflow-hidden shadow-xs bg-gray-50/20 dark:bg-white/[0.01]">
                  <div class="px-3 py-2 t-bg-main border-b t-border-main text-xs font-bold flex items-center justify-between shrink-0">
                    <div class="flex items-center gap-1.5">
                      <i class="fas fa-square-poll-vertical text-emerald-500 text-xs"></i>
                      <span>处理列表</span>
                    </div>
                    <span id="al-result-stats" class="text-[10px] font-mono font-medium t-text-muted">0 条</span>
                  </div>

                  <div id="al-results" class="flex-1 overflow-y-auto custom-scrollbar divide-y divide-gray-100 dark:divide-white/[0.04] min-h-0">
                    <div class="h-full min-h-[120px] flex flex-col items-center justify-center text-xs t-text-muted gap-1.5">
                      <i class="fas fa-clipboard-list text-2xl text-gray-400/50 mb-0.5"></i>
                      <span>暂无处理结果</span>
                    </div>
                  </div>

                  <!-- Results Bottom Pagination -->
                  <div class="h-8.5 px-3 t-bg-main border-t t-border-main flex items-center justify-between shrink-0">
                    <span class="text-[10px] t-text-muted">按选择顺序逐首展示状态</span>
                    <div class="flex items-center gap-1 shrink-0">
                      <button id="al-result-prev" class="w-6 h-6 flex items-center justify-center rounded-md border t-border-main hover:t-bg-track disabled:opacity-30 disabled:cursor-not-allowed transition-all" title="上一页">
                        <i class="fas fa-chevron-left text-[9px]"></i>
                      </button>
                      <span id="al-result-page" class="min-w-10 text-center text-[10px] font-mono t-text-muted font-medium">1 / 1</span>
                      <button id="al-result-next" class="w-6 h-6 flex items-center justify-center rounded-md border t-border-main hover:t-bg-track disabled:opacity-30 disabled:cursor-not-allowed transition-all" title="下一页">
                        <i class="fas fa-chevron-right text-[9px]"></i>
                      </button>
                    </div>
                  </div>
                </div>

              </div>
            </div>

            <!-- Modal Footer -->
            <footer class="px-5 py-2.5 border-t t-border-main text-[11px] t-text-muted flex items-center justify-between bg-gray-50/50 dark:bg-white/[0.02]">
              <div class="flex items-center gap-1.5">
                <i class="fas fa-server text-emerald-500 text-[10px]"></i>
                <span>任务在服务端独立运行，关闭面板或刷新网页不会中断匹配。</span>
              </div>
            </footer>
          </section>`;

        document.body.appendChild(modal);

        modal.querySelectorAll('[data-close]').forEach(node => node.onclick = close);
        modal.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.stopPropagation(); close(); }
            if (event.key === 'Tab') {
                const focusable = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')].filter(n => !n.closest('fieldset:disabled'));
                const first = focusable[0], last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
        });

        el('concurrency').value = String(getSavedConcurrency());
        el('concurrency').onchange = () => {
            saveConcurrency(el('concurrency').value);
        };

        el('search').oninput = () => { page = 1; renderSongs(); };
        el('all').onclick = () => { if (!busy) filtered().forEach(item => selected.add(item.key)); renderSongs(); };
        el('none').onclick = () => { if (!busy) selected.clear(); renderSongs(); };
        el('prev').onclick = () => { page--; renderSongs(); };
        el('next').onclick = () => { page++; renderSongs(); };
        el('result-prev').onclick = () => { resultPage--; renderResults(); };
        el('result-next').onclick = () => { resultPage++; renderResults(); };
        el('platforms').onchange = controls;

        el('songs').onchange = event => {
            if (busy) return;
            const checkbox = event.target.closest('[data-song-key]');
            if (!checkbox) return;
            const key = checkbox.dataset.songKey;
            checkbox.checked ? selected.add(key) : selected.delete(key);
            controls();
        };

        el('reload').onclick = () => reload(session).catch(fail);
        el('start').onclick = start;
        el('cancel').onclick = async () => {
            el('cancel').disabled = true;
            try { await request('cancel', {}); await poll(session); } catch (e) { fail(e); }
        };
    }

    function close() {
        session++; pollRevision++; clearTimeout(timer);
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
        previousFocus?.focus();
    }

    function fail(e) {
        if (!active()) return;
        const msg = e?.message || String(e || '未知错误');
        const box = el('error-box');
        if (box) {
            box.classList.remove('hidden');
            el('error').textContent = msg;
        }
    }

    function clearError() {
        const box = el('error-box');
        if (box) box.classList.add('hidden');
        if (el('error')) el('error').textContent = '';
    }

    async function request(action, body) {
        if (!active()) throw new Error('账号已切换，请重新打开智能检测面板');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetch(`/api/music/auto-link/${action}${action.includes('?') ? '&' : '?'}browseLocation=${encodeURIComponent(location)}`, {
                signal: controller.signal,
                method: body === undefined ? 'GET' : 'POST',
                headers: { ...auth, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) })
            });

            const text = await response.text();
            let result;
            try {
                result = JSON.parse(text);
            } catch {
                if (response.status === 404) {
                    throw new Error('智能检测接口未就绪或未找到，请确认服务已更新');
                }
                throw new Error(text && text.length < 200 ? text : `服务返回异常响应 (HTTP ${response.status})`);
            }

            if (!response.ok || !result.success) {
                throw new Error(result.message || '智能检测请求失败');
            }
            return result.data;
        } finally {
            clearTimeout(timeout);
        }
    }

    const filtered = () => {
        const text = el('search').value.trim().toLowerCase();
        if (!text) return candidates;
        return candidates.filter(item =>
            `${item.name || ''} ${item.singer || ''} ${item.album || ''} ${item.filename || ''}`.toLowerCase().includes(text)
        );
    };

    function controls() {
        const selCount = selected.size;
        el('selected-count').textContent = String(selCount);

        const hasPlatform = !!el('platforms').querySelector('input:checked');
        const canWrite = !custom || window.userAllowWriteCustomDir;
        el('start').disabled = busy || !selCount || !hasPlatform || !canWrite;

        el('platforms').disabled = busy;
        el('concurrency').disabled = busy;
        for (const id of ['all', 'none', 'reload']) {
            if (el(id)) el(id).disabled = busy;
        }
    }

    function renderSongs() {
        const container = el('songs');
        const scrollTop = container.scrollTop;
        const list = filtered(), pages = Math.max(1, Math.ceil(list.length / 50));
        page = Math.max(1, Math.min(pages, page));

        el('count').textContent = String(candidates.length);
        el('page').textContent = `${page} / ${pages}`;
        el('prev').disabled = page <= 1;
        el('next').disabled = page >= pages;

        const currentSlice = list.slice((page - 1) * 50, page * 50);

        if (!currentSlice.length) {
            container.innerHTML = `
                <div class="h-full min-h-[160px] flex flex-col items-center justify-center text-xs t-text-muted gap-1.5 p-6 text-center">
                    <i class="fas fa-check-circle text-2xl text-emerald-500/40 mb-1"></i>
                    <span>没有符合条件的未链接歌曲</span>
                </div>`;
        } else {
            const username = custom
                ? ((window.getCurrentUser && window.getCurrentUser()) || localStorage.getItem('lx_user_username') || 'default')
                : (window.LocalMusicManager?.getCurrentUsername?.() || 'default');

            container.innerHTML = currentSlice.map(item => {
                const isSelected = selected.has(item.key);

                // Quality Badge
                let qualityBadge = '';
                if (window.LocalMusicManager?.getModernQualityBadge) {
                    qualityBadge = window.LocalMusicManager.getModernQualityBadge(item.quality);
                } else if (item.quality) {
                    qualityBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] border tracking-tight bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700">${escape(item.quality)}</span>`;
                }

                // Subpath & folder badges
                const subPathBadge = item.subPath
                    ? `<span class="text-[9px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/40 rounded px-1.5 py-0.2 mr-1 inline-block font-mono" title="${escapeAttr(item.subPath)}">${escape(item.subPath)}</span>`
                    : '';

                const folderBadge = `<span class="px-1.5 py-0.2 bg-gray-100 dark:bg-gray-800 border t-border-main rounded text-[9px] font-bold uppercase tracking-tight text-gray-500 dark:text-gray-400 mr-1 inline-block shrink-0 leading-tight">${escape(item.folder || 'local')}</span>`;

                // Cover HTML
                let coverHtml = `
                    <div class="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800/80 flex-shrink-0 flex items-center justify-center border t-border-main shadow-xs">
                        <i class="fas fa-music text-gray-400 text-xs"></i>
                    </div>`;

                if (item.hasCover || (item.img && typeof item.img === 'string' && /^https?:\/\//i.test(item.img))) {
                    const coverUrl = item.hasCover
                        ? (custom
                            ? `/api/music/custom/cover?filename=${encodeURIComponent(item.filename)}&user=${encodeURIComponent(username)}&v=${encodeURIComponent([Math.round(item.mtime || 0), item.size || 0].join('-'))}`
                            : `/api/music/cache/cover?filename=${encodeURIComponent(item.filename)}&user=${encodeURIComponent(username)}&browseLocation=${encodeURIComponent(location)}&v=${encodeURIComponent([item.coverCheckedVersion || 0, Math.round(item.coverCheckedMtime || item.mtime || 0), item.coverCheckedSize || item.size || 0, 1].join('-'))}`)
                        : item.img;

                    const fallbackAttr = item.img && item.img !== coverUrl ? `data-fallback-src="${escapeAttr(item.img)}"` : '';
                    coverHtml = `<img data-src="${escapeAttr(coverUrl)}" ${fallbackAttr} src="/music/assets/logo.svg" loading="lazy" fetchpriority="low" class="lazy-image lm-remaster-cover is-placeholder w-9 h-9 rounded-lg object-cover shadow-xs flex-shrink-0 border t-border-main" onerror="if(this.dataset.fallbackSrc && !this.dataset.fallbackTried){this.dataset.fallbackTried='true';this.src=this.dataset.fallbackSrc;}else{this.src='/music/assets/logo.svg';}">`;
                }

                return `
                    <label class="min-h-13 px-3.5 py-2.5 flex items-center gap-3 transition-colors ${isSelected ? 'bg-emerald-500/[0.04] dark:bg-emerald-500/[0.06]' : ''} ${busy ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:t-bg-track'}">
                        <input type="checkbox" data-song-key="${escapeAttr(item.key)}" ${isSelected ? 'checked' : ''} ${busy ? 'disabled' : ''}
                            class="w-4 h-4 rounded-md border-gray-300 dark:border-gray-700 text-emerald-600 focus:ring-emerald-500 shrink-0 cursor-pointer accent-emerald-600">
                        ${coverHtml}
                        <span class="min-w-0 flex-1">
                            <span class="block text-xs font-bold t-text-main truncate">${escape(item.name || item.filename)}</span>
                            <span class="block text-[11px] t-text-muted truncate mt-0.5 flex items-center flex-wrap gap-y-0.5">
                                ${subPathBadge}${folderBadge}<span>${escape(item.singer || '未知歌手')} · ${escape(item.interval || '未知时长')} · ${escape(item.filename)}</span>
                            </span>
                        </span>
                        <div class="shrink-0 flex items-center">${qualityBadge}</div>
                    </label>`;
            }).join('');

            if (typeof window.lazyLoadImages === 'function') {
                window.lazyLoadImages(container);
            }
        }

        controls();
        container.scrollTop = scrollTop;
    }

    function renderResults() {
        const pages = Math.max(1, Math.ceil(results.length / 50));
        resultPage = Math.max(1, Math.min(pages, resultPage));

        el('result-page').textContent = `${resultPage} / ${pages}`;
        el('result-stats').textContent = `${results.length} 首`;
        el('result-prev').disabled = resultPage <= 1;
        el('result-next').disabled = resultPage >= pages;

        const container = el('results');
        const scrollTop = container.scrollTop;

        if (!results.length) {
            container.innerHTML = `
                <div class="h-full min-h-[120px] flex flex-col items-center justify-center text-xs t-text-muted gap-1.5">
                    <i class="fas fa-clipboard-list text-2xl text-gray-400/50 mb-0.5"></i>
                    <span>暂无处理列表</span>
                </div>`;
            return;
        }

        const start = (resultPage - 1) * 50;
        const currentSlice = results.slice(start, start + 50);

        const username = custom
            ? ((window.getCurrentUser && window.getCurrentUser()) || localStorage.getItem('lx_user_username') || 'default')
            : (window.LocalMusicManager?.getCurrentUsername?.() || 'default');

        container.innerHTML = currentSlice.map(r => {
            const status = r.status || 'waiting';

            // State Badge & Icon Config
            let statusBadge = '';
            let statusIcon = '';
            let statusTextClass = 'text-gray-500 dark:text-gray-400';
            let rowBgClass = '';

            if (status === 'waiting') {
                statusIcon = `<span class="w-2.5 h-2.5 rounded-full bg-gray-400/60 shrink-0 mt-1.5 ml-0.5"></span>`;
                statusBadge = `<span class="px-1.5 py-0.2 rounded text-[9px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border t-border-main shrink-0">等待识别</span>`;
            } else if (status === 'identifying') {
                statusIcon = `<i class="fas fa-spinner fa-spin text-emerald-500 text-xs shrink-0 mt-1"></i>`;
                statusBadge = `<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 animate-pulse shrink-0">提取声纹</span>`;
                statusTextClass = 'text-emerald-600 dark:text-emerald-400 font-medium';
                rowBgClass = 'bg-emerald-500/[0.04] dark:bg-emerald-500/[0.06]';
            } else if (status === 'searching') {
                statusIcon = `<i class="fas fa-magnifying-glass fa-pulse text-blue-500 text-xs shrink-0 mt-1"></i>`;
                statusBadge = `<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30 animate-pulse shrink-0">多平台搜索</span>`;
                statusTextClass = 'text-blue-600 dark:text-blue-400 font-medium';
                rowBgClass = 'bg-blue-500/[0.04] dark:bg-blue-500/[0.06]';
            } else if (status === 'linking') {
                statusIcon = `<i class="fas fa-link fa-fade text-amber-500 text-xs shrink-0 mt-1"></i>`;
                statusBadge = `<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 animate-pulse shrink-0">正在关联</span>`;
                statusTextClass = 'text-amber-600 dark:text-amber-400 font-medium';
                rowBgClass = 'bg-amber-500/[0.04] dark:bg-amber-500/[0.06]';
            } else if (status === 'linked') {
                statusIcon = `<i class="fas fa-check-circle text-emerald-500 text-xs shrink-0 mt-1"></i>`;
                statusBadge = `<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0">已匹配</span>`;
                statusTextClass = 'text-emerald-700 dark:text-emerald-300';
            } else if (status === 'failed') {
                statusIcon = `<i class="fas fa-circle-exclamation text-amber-500 text-xs shrink-0 mt-1"></i>`;
                statusBadge = `<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shrink-0">未匹配</span>`;
                statusTextClass = 'text-amber-700 dark:text-amber-300';
            } else if (status === 'interrupted' || status === 'cancelled') {
                statusIcon = `<i class="fas fa-ban text-gray-400 text-xs shrink-0 mt-1"></i>`;
                statusBadge = `<span class="px-1.5 py-0.2 rounded text-[9px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 border t-border-main shrink-0">${status === 'interrupted' ? '已中断' : '已停止'}</span>`;
                statusTextClass = 'text-gray-500 dark:text-gray-400';
            }

            // Platform colored tag (rendered with getSourceTag style)
            const matchedSource = r.matchedSource || r.source;
            const platformTagHtml = (status === 'linked' && matchedSource) ? renderPlatformTag(matchedSource) : '';

            // Cover rendering for each row in the processing list
            const coverTargetFilename = r.coverFilename || r.filename;
            let coverHtml = `
                <div class="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800/80 flex-shrink-0 flex items-center justify-center border t-border-main shadow-xs">
                    <i class="fas fa-music text-gray-400 text-xs"></i>
                </div>`;

            if (r.hasCover || (r.img && typeof r.img === 'string' && /^https?:\/\//i.test(r.img))) {
                const coverUrl = r.hasCover
                    ? (custom
                        ? `/api/music/custom/cover?filename=${encodeURIComponent(coverTargetFilename)}&user=${encodeURIComponent(username)}&v=${encodeURIComponent([Math.round(r.mtime || 0), r.size || 0].join('-'))}`
                        : `/api/music/cache/cover?filename=${encodeURIComponent(coverTargetFilename)}&user=${encodeURIComponent(username)}&browseLocation=${encodeURIComponent(location)}&v=${encodeURIComponent([r.coverCheckedVersion || 0, Math.round(r.coverCheckedMtime || r.mtime || 0), r.coverCheckedSize || r.size || 0, 1].join('-'))}`)
                    : r.img;

                const fallbackAttr = r.img && r.img !== coverUrl ? `data-fallback-src="${escapeAttr(r.img)}"` : '';
                coverHtml = `<img data-src="${escapeAttr(coverUrl)}" ${fallbackAttr} src="/music/assets/logo.svg" loading="lazy" fetchpriority="low" class="lazy-image lm-remaster-cover is-placeholder w-9 h-9 rounded-lg object-cover shadow-xs flex-shrink-0 border t-border-main" onerror="if(this.dataset.fallbackSrc && !this.dataset.fallbackTried){this.dataset.fallbackTried='true';this.src=this.dataset.fallbackSrc;}else{this.src='/music/assets/logo.svg';}">`;
            }

            return `
                <div class="px-3.5 py-2.5 flex items-start gap-3 hover:t-bg-track transition-colors ${rowBgClass}">
                    <div class="shrink-0 flex items-center gap-2">
                        ${statusIcon}
                        ${coverHtml}
                    </div>
                    <div class="min-w-0 flex-1 text-xs">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="font-bold t-text-main truncate">${escape(r.name || r.filename)}</span>
                            ${statusBadge}
                            ${platformTagHtml}
                        </div>
                        <div class="text-[11px] t-text-muted truncate mt-0.5">
                            ${escape(r.singer || '未知歌手')} · ${escape(r.interval || '未知时长')} · ${escape(r.filename)}
                        </div>
                        <div class="text-[11px] truncate mt-1 ${statusTextClass}">
                            ${escape(r.message || '')}
                        </div>
                    </div>
                </div>`;
        }).join('');

        if (typeof window.lazyLoadImages === 'function') {
            window.lazyLoadImages(container);
        }

        container.scrollTop = scrollTop;
    }

    async function reload(token) {
        clearError();
        const items = await request(`candidates?custom=${custom}`);
        if (token !== session || !active()) return;
        candidates = items;
        const keys = new Set(items.map(i => i.key));
        selected = new Set([...selected].filter(k => keys.has(k)));
        renderSongs();
    }

    async function start() {
        if (busy) return;
        pollRevision++; clearTimeout(timer);
        busy = true;
        renderSongs();
        clearError();

        const token = session;
        const concurrency = parseInt(el('concurrency')?.value || '2', 10);
        saveConcurrency(concurrency);

        try {
            await request('start', {
                custom,
                keys: [...selected],
                sources: [...el('platforms').querySelectorAll('input:checked')].map(i => i.value),
                concurrency
            });
            if (token !== session) return;
            taskId = ''; results = []; resultPage = 1;
            await poll(token);
        } catch (e) {
            if (token === session) {
                await poll(token);
                fail(e);
            }
        }
    }

    async function poll(token) {
        clearTimeout(timer);
        if (token !== session || !active()) return;
        const revision = ++pollRevision;

        try {
            // Retrieve up to 1000 items in a single query to monitor entire batch
            const status = await request('status?offset=0&limit=1000');
            if (token !== session || revision !== pollRevision || !active()) return;

            if (status.id !== taskId) {
                taskId = status.id;
                results = status.results || [];
                resultPage = 1;
            } else {
                results = status.results || [];
            }

            busy = ['running', 'cancelling'].includes(status.status);

            // Toggle cancel & start buttons
            const cancelBtn = el('cancel');
            const startBtn = el('start');
            if (cancelBtn && startBtn) {
                if (busy) {
                    cancelBtn.classList.remove('hidden');
                    cancelBtn.classList.add('flex');
                    cancelBtn.disabled = status.status !== 'running';
                    startBtn.classList.add('hidden');
                } else {
                    cancelBtn.classList.add('hidden');
                    cancelBtn.classList.remove('flex');
                    startBtn.classList.remove('hidden');
                }
            }

            if (busy && status.sources) {
                el('platforms').querySelectorAll('input').forEach(i => {
                    i.checked = status.sources.includes(i.value);
                });
            }

            if (status.concurrency && el('concurrency')) {
                el('concurrency').value = String(status.concurrency);
            }

            // Status label & dot
            const statusDot = el('status-dot');
            const statusText = el('status-text');
            if (statusText) statusText.textContent = labels[status.status] || status.status;
            if (statusDot) {
                statusDot.className = 'w-2 h-2 rounded-full ' + (
                    status.status === 'running' ? 'bg-emerald-500 animate-pulse' :
                    status.status === 'completed' ? 'bg-emerald-500' :
                    status.status === 'error' || status.status === 'interrupted' ? 'bg-red-500' :
                    status.status === 'cancelled' || status.status === 'cancelling' ? 'bg-amber-500' :
                    'bg-gray-400'
                );
            }

            // Metrics
            const total = status.total || 0;
            const processed = status.processed || 0;
            const linked = status.linked || 0;
            const failed = status.failed || 0;

            el('progress-text').textContent = `${processed} / ${total}`;
            el('metric-total').textContent = String(total);
            el('metric-linked').textContent = String(linked);
            el('metric-failed').textContent = String(failed);
            el('metric-processed').textContent = String(processed);

            const percent = total > 0 ? (processed / total) * 100 : 0;
            el('progress').style.width = `${percent}%`;

            // Current state details
            const currentParts = [
                status.id ? `任务目录：${status.custom ? '自定义目录' : status.location}` : '',
                status.sources?.map(s => platforms[s] || s).join('、'),
                status.concurrency ? `${status.concurrency} 线程并发` : ''
            ].filter(Boolean);
            el('current').textContent = currentParts.join(' · ');

            if (status.error) {
                fail(status.error);
            }

            renderResults();
            renderSongs();

            if (!busy && status.id && terminalId !== status.id) {
                await reload(token);
                terminalId = status.id;
                if (active() && token === session) {
                    window.LocalMusicManager?.refresh?.();
                }
            }
        } catch (e) {
            if (token === session && revision === pollRevision) {
                busy = true;
                controls();
                fail(e);
            }
        }

        if (token === session && revision === pollRevision && active()) {
            timer = setTimeout(() => poll(token), 1500);
        }
    }

    async function open() {
        mount();
        clearTimeout(timer);
        const token = ++session;
        previousFocus = document.activeElement;

        user = window.LocalMusicManager?.getCurrentUsername?.();
        auth = { ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {}) };
        custom = !!window.CustomDirManager?.isActive;
        location = document.getElementById('lm-location-select')?.value || 'root';

        busy = true;
        candidates = [];
        selected.clear();
        results = [];
        taskId = '';
        page = 1;
        resultPage = 1;
        terminalId = '';

        el('search').value = '';
        clearError();
        el('results').innerHTML = `
            <div class="h-full min-h-[120px] flex flex-col items-center justify-center text-xs t-text-muted gap-1.5">
                <i class="fas fa-clipboard-list text-2xl text-gray-400/50 mb-0.5"></i>
                <span>暂无处理列表</span>
            </div>`;

        el('status-text').textContent = '正在加载任务…';
        el('progress-text').textContent = '0 / 0';
        el('progress').style.width = '0%';
        el('metric-total').textContent = '0';
        el('metric-linked').textContent = '0';
        el('metric-failed').textContent = '0';
        el('metric-processed').textContent = '0';
        el('current').textContent = '';

        const locationName = custom ? '自定义目录' : (location === 'data' ? 'data 目录' : '根目录');
        el('scope-badge').textContent = locationName;
        el('scope').textContent = `待检测目录：${locationName} · 声学指纹深度识别与多平台歌曲匹配`;

        el('platforms').querySelectorAll('input').forEach(i => { i.checked = true; });

        modal.classList.remove('hidden');
        modal.classList.add('flex');

        renderSongs();
        el('search').focus();

        await poll(token);
        try {
            await reload(token);
        } catch (e) {
            if (token === session) fail(e);
        }
    }

    return { open, close };
})();
