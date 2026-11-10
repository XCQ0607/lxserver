/* Shared Web rating controls. Ratings live in user metadata, never in playlists. */
window.RatingManager = (() => {
    const controls = new Map();
    let fingerprint = '', generation = 0, refreshSequence = 0, openSequence = 0, queued = false, dialog, collectionDialog, collectionReload, lastVersion = '', controlsRevision = 0, paintedRevision = -1;
    const LABELS = ['', '很差', '一般', '还行', '喜欢', '超赞'];
    const scope = () => `${localStorage.getItem('lx_sync_user') || ''}:${localStorage.getItem('lx_user_token') || ''}`;
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    function checkScope() {
        const next = scope();
        if (next !== fingerprint) { fingerprint = next; generation++; lastVersion = ''; paintedRevision = -1; for (const info of controls.values()) { info.id = null; info.rating = 0; paint(info); } if (dialog?.open) dialog.close(); if (collectionDialog?.open) collectionDialog.close(); }
        return generation;
    }
    function paint(info) {
        if (controls.get(info.button) !== info) return;
        if (info.button.classList?.contains('rating-menu-item')) info.button.textContent = info.rating ? `★ 评分 ${info.rating}` : '☆ 评分';
        else info.button.textContent = info.tag || info.button.id === 'player-rating' ? (info.rating ? `★ ${info.rating}` : '☆') : (info.rating ? '★' : '☆');
        info.button.classList?.toggle('is-rated', !!info.rating);
        info.button.setAttribute('data-score', String(info.rating || ''));
        if (info.tag) info.button.hidden = !info.rating;
        info.button.title = info.error || (info.rating ? `当前 ${info.rating} 星，点击修改` : '给歌曲评分');
        info.button.setAttribute('aria-label', info.button.title);
    }
    function describe(song) {
        const result = {};
        for (const key of ['id', 'source', 'songmid', 'name', 'singer', 'albumName', 'interval', 'img', 'isLocal', 'filename', 'folder', '_localFilename', '_localFolder', '_localLocation', '_localUsername', '_isCustomDir']) if (song[key] !== undefined) result[key] = song[key];
        result.meta = { songId: song.meta?.songId, albumName: song.meta?.albumName, albumId: song.meta?.albumId, picUrl: song.meta?.picUrl };
        return result;
    }
    async function request(body, endpoint = '/api/music/ratings') {
        if (body?.songs) body = { ...body, songs: body.songs.map(describe) };
        if (body?.song) body = { ...body, song: describe(body.song) };
        const requestedUser = localStorage.getItem('lx_sync_user');
        if (typeof ensureUserAuthToken === 'function') await ensureUserAuthToken();
        if (requestedUser !== localStorage.getItem('lx_sync_user')) throw Error('账号已切换，请重试');
        const headers = { ...(typeof getUserAuthHeaders === 'function' ? getUserAuthHeaders() : {}), 'Content-Type': 'application/json' };
        const response = await fetch(endpoint, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined });
        const data = await response.json();
        if (!response.ok) throw Error(data.error || '评分请求失败');
        return data;
    }
    async function refresh() {
        const sequence = ++refreshSequence;
        const epoch = checkScope(), user = fingerprint;
        for (const [button] of controls) if (!button.isConnected) controls.delete(button);
        if (!localStorage.getItem('lx_sync_user')) return;
        if (collectionDialog?.open) void collectionReload?.();
        if (lastVersion && paintedRevision === controlsRevision) {
            try { const current = await request({operation:'version'}); if (sequence !== refreshSequence || scope() !== user || generation !== epoch) return; if (current.version && current.version === lastVersion) return; } catch { /* 网络恢复后继续批量查询 */ }
        }
        const revision = controlsRevision;
        let observedVersion = '', versionConsistent = true;
        const entries = [...controls.values()];
        for (let start = 0; start < entries.length; start += 100) {
            const batch = entries.slice(start, start + 100);
            try {
                const data = await request({ operation: 'resolve', songs: batch.map(x => x.song) });
                if (sequence !== refreshSequence || scope() !== user || generation !== epoch) return;
                if (!observedVersion) observedVersion = data.version || '';
                else if (data.version !== observedVersion) versionConsistent = false;
                batch.forEach((info, index) => { const entry = data.entries[index]; info.id = entry.id; info.rating = entry.rating; info.error = entry.error; paint(info); });
            } catch { versionConsistent = false; /* 下次重试 */ }
        }
        if (sequence === refreshSequence && observedVersion && versionConsistent) { lastVersion = observedVersion; paintedRevision = revision; }
    }
    function attach(button, song, tag = false) {
        if (!button || !song) return;
        checkScope();
        button.classList?.add('rating-chip');
        if (tag) button.classList?.add('rating-score-tag');
        const info = { button, song, id: null, rating: 0, tag };
        controls.set(button, info); controlsRevision++; paint(info);
        if (!tag) {
            const row = button.closest?.('[data-song-id], [data-lm-row-index], tr');
            const host = row?.querySelector('[data-rating-badges]');
            if (host) attachTag(host, song);
        }
        button.onclick = event => { event.preventDefault(); event.stopPropagation(); open(song); };
        if (!queued) { queued = true; queueMicrotask(() => { queued = false; refresh(); }); }
    }
    function attachTag(host, song) {
        if (!host || !song) return;
        let tag = host.querySelector('.rating-score-tag');
        if (!tag) { tag = el('button', 'rating-score-tag'); tag.type = 'button'; host.appendChild(tag); }
        attach(tag, song, true);
    }
    function notice(message, error = false) {
        const fn = error ? window.showError : window.showSuccess;
        if (typeof fn === 'function') fn(message);
    }
    function makeDialog(old) {
        const d = old || el('dialog', 'web-rating-dialog');
        if (!old) {
            document.body.appendChild(d);
            // 点击遮罩关闭
            d.addEventListener('click', event => { if (event.target === d) d.close(); });
        }
        d.replaceChildren();
        return d;
    }
    /** 交互式星星：悬停预览、点击/触摸滑动选择、方向键调整。onPick(value) 返回 Promise。 */
    function starPicker(initial, onPick) {
        const wrap = el('div', 'rs-picker');
        const row = el('div', 'rs-row'); row.setAttribute('role', 'radiogroup'); row.setAttribute('aria-label', '评分');
        const caption = el('div', 'rs-caption');
        let value = initial, preview = 0, busy = false;
        const stars = [];
        const show = v => {
            stars.forEach((s, i) => { s.classList.toggle('on', i < v); s.setAttribute('aria-checked', String(i + 1 === value)); });
            caption.textContent = v ? `${v} 星 · ${LABELS[v]}` : '轻触星星打分';
            caption.classList.toggle('dim', !v);
        };
        const commit = async v => {
            if (busy) return;
            busy = true; wrap.classList.add('busy');
            try { await onPick(v); value = v; stars.forEach((s, i) => { if (i + 1 === v) { s.classList.remove('pop'); void s.offsetWidth; s.classList.add('pop'); } }); }
            finally { busy = false; wrap.classList.remove('busy'); show(value); }
        };
        for (let i = 1; i <= 5; i++) {
            const s = el('button', 'rs-star', '★'); s.type = 'button'; s.setAttribute('role', 'radio'); s.setAttribute('aria-label', `${i} 星`); s.dataset.v = i;
            s.addEventListener('mouseenter', () => { preview = i; show(i); });
            s.addEventListener('focus', () => show(i));
            s.addEventListener('keydown', ev => {
                if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') { ev.preventDefault(); stars[Math.min(4, i)].focus(); }
                else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') { ev.preventDefault(); stars[Math.max(0, i - 2)].focus(); }
                else if (ev.key === 'Home') { ev.preventDefault(); stars[0].focus(); }
                else if (ev.key === 'End') { ev.preventDefault(); stars[4].focus(); }
            });
            s.addEventListener('click', () => commit(i));
            stars.push(s); row.appendChild(s);
        }
        row.addEventListener('mouseleave', () => { preview = 0; show(value); });
        row.addEventListener('focusout', () => { if (!row.contains(document.activeElement)) show(value); });
        // 触摸滑动选星
        const starAt = ev => { const t = document.elementFromPoint(ev.clientX, ev.clientY); return t?.classList?.contains('rs-star') ? Number(t.dataset.v) : 0; };
        row.addEventListener('pointerdown', ev => { if (ev.pointerType === 'mouse') return; row.dataset.drag = '1'; const v = starAt(ev); if (v) show(v); });
        row.addEventListener('pointermove', ev => { if (row.dataset.drag !== '1' || ev.pointerType === 'mouse') return; const v = starAt(ev); if (v) { preview = v; show(v); } });
        const end = ev => { if (row.dataset.drag !== '1') return; row.dataset.drag = ''; const v = starAt(ev) || preview; if (v && ev.type === 'pointerup') commit(v); else show(value); };
        row.addEventListener('pointerup', end); row.addEventListener('pointercancel', end);
        const clear = el('button', 'rs-clear', '清除评分'); clear.type = 'button';
        clear.onclick = () => commit(0);
        wrap.append(row, caption, clear);
        show(value);
        wrap.setClear = visible => { clear.hidden = !visible; };
        return wrap;
    }
    async function open(song) {
        const sequence = ++openSequence;
        checkScope();
        if (!localStorage.getItem('lx_sync_user')) { notice('请先登录本地账号后评分', true); return; }
        const epoch = generation, user = fingerprint;
        let entry;
        try { entry = (await request({ operation: 'resolve', songs: [song], includeDetails: true })).entries[0]; if (entry.error) throw Error(entry.error); }
        catch (e) { notice(e.message, true); return; }
        if (sequence !== openSequence || generation !== epoch || scope() !== user) return;
        dialog = makeDialog(dialog);
        const grip = el('div', 'rd-grip'); dialog.appendChild(grip);
        const head = el('div', 'rd-head');
        const art = el('div', 'rd-art', '♪');
        const img = song.img || song.meta?.picUrl;
        if (typeof img === 'string' && /^(https?:)?\/\//i.test(img)) { const i = el('img'); i.src = img; i.alt = ''; i.referrerPolicy = 'no-referrer'; i.onerror = () => i.remove(); art.appendChild(i); }
        const meta = el('div', 'rd-meta');
        meta.append(el('h3', '', song.name || '歌曲评分'), el('p', 'rd-singer', [song.singer, song.albumName || song.meta?.albumName].filter(Boolean).join(' · ')));
        const plats = el('div', 'rd-tags'); const pName = { tx: 'QQ音乐', wy: '网易云', kw: '酷我', kg: '酷狗', mg: '咪咕', local: '本地' }; plats.append(el('span', '', pName[song.source] || song.source || (song.isLocal ? '本地' : '未知平台'))); if (entry.identity === 'linked-online') plats.append(el('span', '', '已关联在线')); meta.appendChild(plats);
        head.append(art, meta); dialog.appendChild(head);
        const status = el('p', 'rd-status', entry.rating ? `当前评分：${entry.rating} 星` : '尚未评分');
        const picker = starPicker(entry.rating || 0, async value => {
            if (scope() !== user || generation !== epoch) { dialog.close(); throw Error('账号已切换'); }
            try {
                ++refreshSequence;
                const result = await request({ song, rating: value });
                if (scope() !== user || generation !== epoch) return;
                for (const info of controls.values()) if (info.id === result.id) { info.rating = result.rating; paint(info); }
                status.textContent = result.rating ? `已保存：${result.rating} 星` : '已清除评分';
                picker.setClear(!!result.rating);
                notice(result.warning || (value ? `已评 ${value} 星` : '已清除评分'), !!result.warning);
                window.dispatchEvent(new CustomEvent('ratingchange', { detail: { id: result.id, rating: result.rating } }));
                refresh();
                setTimeout(() => { if (dialog.open && scope() === user) dialog.close(); }, 650);
            } catch (e) { status.textContent = e.message; throw e; }
        });
        picker.setClear(!!entry.rating);
        dialog.append(picker, status);
        const hint = el('p', 'rating-hint', (entry.identity === 'linked-online' ? '此本地文件已关联在线歌曲，评分以在线歌曲为准；修改会同步影响在线版及其他关联文件。' : entry.identity === 'local' ? '此文件尚未关联在线歌曲，评分按本地ID保存；关联后将以在线评分为准。' : '评分与 Subsonic 在线歌曲互通。') + ' 启用低分联动时可补不喜欢；提高或清除评分不会删除规则。');
        dialog.appendChild(hint);
        const ownership = el('details', 'rating-hint');
        ownership.appendChild(el('summary', '', '评分归属与关联信息'));
        ownership.appendChild(el('p', '', `当前评分ID：${entry.id}；关联副本：${entry.linkedCopies || 0}。`));
        dialog.appendChild(ownership);
        const close = el('button', 'rating-close', '关闭'); close.type = 'button'; close.onclick = () => dialog.close(); dialog.appendChild(close);
        if (!dialog.open) dialog.showModal();
        picker.querySelector('.rs-star')?.blur();
    }
    const PLATFORM = { tx: 'QQ音乐', wy: '网易云', kw: '酷我', kg: '酷狗', mg: '咪咕', local: '本地', xm: '虾米' };
    const KIND = { song: '歌曲', album: '专辑', artist: '歌手' };
    const ORIGINS = { web: 'Web 手动评分', subsonic: 'Subsonic 手动评分', 'web-dislike-link': '不喜欢自动补分', 'manual-dislike-to-rating': '后台补分', 'web-rating-link': 'Web 低分联动', 'subsonic-rating': 'Subsonic 低分联动', 'manual-rating-to-dislike': '管理员低分补不喜欢', 'snapshot-restore': '评分恢复', unknown: '来源未记录' };
    const originLabel = origin => ORIGINS[origin?.channel || 'unknown'] || '其他来源（未识别）';

    const fmtDate = t => t ? new Date(t).toLocaleDateString() : '';
    async function browse() {
        checkScope();
        const epoch = generation, user = fingerprint;
        let data;
        try { data = await request(); } catch (e) { notice(e.message, true); return; }
        if (generation !== epoch || scope() !== user) return;
        collectionDialog = makeDialog(collectionDialog);
        collectionDialog.classList.add('is-collection');
        const head = el('div', 'rc-head');
        const titles = el('div'); titles.append(el('h3', '', '我的评分'), el('p', 'rc-sub', 'Web 与 Subsonic 共用，不会创建实体歌单。歌曲可直接点星级修改。'));
        const xbtn = el('button', 'rc-x', '✕'); xbtn.type = 'button'; xbtn.setAttribute('aria-label', '关闭'); xbtn.onclick = () => collectionDialog.close();
        const exportButton = el('button', 'rc-export', '导出评分备份'); exportButton.type = 'button';
        exportButton.title = '包含评分、歌曲描述和本地关联参照；不包含音频。恢复保留当前文件关联。';
        exportButton.onclick = async () => {
            try {
                const backup = await request({ operation: 'exportBackup' });
                if (generation !== epoch || scope() !== user) return;
                const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
                const link = el('a'); link.href = url; link.download = 'lx_rating_backup.json'; link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (error) { notice(error.message, true); }
        };
        head.append(titles, exportButton, xbtn); collectionDialog.appendChild(head);
        const summary = el('div', 'rc-summary'); collectionDialog.appendChild(summary);
        const kinds = el('div', 'rc-kinds'); collectionDialog.appendChild(kinds);
        const tools = el('div', 'rc-tools');
        const search = el('input', 'rc-search'); search.type = 'search'; search.placeholder = '搜索名称、歌手、专辑'; search.setAttribute('aria-label', '搜索我的评分');
        const plat = el('select', 'rc-sort'); plat.setAttribute('aria-label', '平台');
        const sort = el('select', 'rc-sort'); sort.setAttribute('aria-label', '排序');
        for (const [v, t] of [['high', '评分高→低'], ['low', '评分低→高'], ['time', '最近评分'], ['name', '名称'], ['singer', '歌手']]) { const o = el('option', '', t); o.value = v; sort.appendChild(o); }
        const origin = el('select', 'rc-sort'); origin.setAttribute('aria-label', '评分产生来源');
        for (const [value, text] of [['','全部评分来源'], ...['web', 'subsonic', 'web-dislike-link', 'manual-dislike-to-rating'].map(key => [key, ORIGINS[key]])]) { const option = el('option','',text); option.value = value; origin.appendChild(option); }
        const reset = el('button', 'rc-reset', '重置筛选'); reset.type = 'button';
        reset.onclick = () => { search.value = ''; plat.value = ''; sort.value = 'high'; origin.value = ''; kind = ''; level = 0; page = 0; render(); };
        tools.append(search, plat, origin, sort, reset); collectionDialog.appendChild(tools);
        const help = el('details', 'rc-source-help');
        help.appendChild(el('summary', '', '评分来源是什么意思？'));
        help.appendChild(el('p', '', '音乐平台表示歌曲来自哪里；评分来源表示最后一次写入该评分的操作。Web / Subsonic 是直接评分；不喜欢自动补分是 Web 添加不喜欢后补1星；管理员手动补分是后台执行“不喜欢补1星”。这些不是歌曲平台，也不代表完整操作历史。'));
        collectionDialog.appendChild(help);
        const resultStatus = el('p', 'rc-result-status'); resultStatus.setAttribute('role','status'); collectionDialog.appendChild(resultStatus);
        const chips = el('div', 'rc-chips'); collectionDialog.appendChild(chips);
        const syncStatus = el('details', 'rc-source-help'); collectionDialog.appendChild(syncStatus);
        const list = el('div', 'rc-list'); collectionDialog.appendChild(list);
        let page = 0, level = 0, kind = '';
        const more = el('button', 'rc-more', '加载更多');
        function render() {
            syncStatus.replaceChildren(); syncStatus.hidden = !(data.pending || []).length;
            syncStatus.appendChild(el('summary','',`同步待处理 ${(data.pending || []).length} 项`));
            for (const task of data.pending || []) syncStatus.appendChild(el('p','',`${task.id || '评分快照'}：${task.message}`));
            const retry = el('button','rc-reset','仅重试失败项'); retry.type='button';
            retry.onclick=async()=>{retry.disabled=true;try{await request({operation:'retryFailed'});await collectionReload?.()}catch(error){notice(error.message,true)}finally{retry.disabled=false}};
            syncStatus.appendChild(retry);
            const all = (data.songs || []).map(s => ({ kind: 'song', ...s }));
            const pool = kind ? all.filter(s => s.kind === kind) : all;
            const terms = search.value.normalize('NFKC').trim().toLowerCase().split(/\s+/).filter(Boolean);
            const scoped = pool.filter(s => (!plat.value || s.source === plat.value) && (!origin.value || (s.origin?.channel || 'unknown') === origin.value) && terms.every(term => `${s.name} ${s.singer} ${s.albumName} ${s.id}`.normalize('NFKC').toLowerCase().includes(term)));
            const counts = [0, 0, 0, 0, 0, 0]; scoped.forEach(s => counts[s.rating] = (counts[s.rating] || 0) + 1);
            const selectedRows = scoped.filter(s => !level || s.rating === level);
            const avg = selectedRows.length ? (selectedRows.reduce((a, s) => a + s.rating, 0) / selectedRows.length) : 0;
            summary.replaceChildren();
            const big = el('div', 'rc-avg'); big.append(el('b', '', avg ? avg.toFixed(1) : '–'), el('span', '', `筛选平均 · ${selectedRows.length} 项`)); summary.appendChild(big);
            const bars = el('div', 'rc-bars');
            for (let n = 5; n >= 1; n--) {
                const r = el('button', 'rc-bar'); r.type = 'button'; r.setAttribute('aria-label', `筛选${n}星，共${counts[n]}项`); r.onclick = () => { level = level === n ? 0 : n; page = 0; render(); }; const fill = el('i'); fill.style.width = (scoped.length ? counts[n] / scoped.length * 100 : 0) + '%';
                const track = el('span'); track.appendChild(fill); r.append(el('em', '', `${n}★`), track, el('small', '', String(counts[n]))); bars.appendChild(r);
            }
            summary.appendChild(bars);
            kinds.replaceChildren();
            for (const [k, label] of [['', '全部'], ['song', '歌曲'], ['album', '专辑'], ['artist', '歌手']]) {
                const n = k ? all.filter(s => s.kind === k).length : all.length;
                const c = el('button', 'rc-kind' + (kind === k ? ' on' : ''), `${label} ${n}`); c.type = 'button';
                c.onclick = () => { kind = k; page = 0; render(); }; kinds.appendChild(c);
            }
            const platforms = [...new Set([...Object.keys(PLATFORM).filter(p => p !== 'xm'), ...all.map(s => s.source).filter(Boolean)])].filter(source => source !== 'bd');
            const keep = plat.value; plat.replaceChildren();
            const o0 = el('option', '', '全部平台'); o0.value = ''; plat.appendChild(o0);
            for (const p of platforms) { const o = el('option', '', `${PLATFORM[p] || p}（${all.filter(s => s.source === p).length}）`); o.value = p; plat.appendChild(o); }
            plat.value = platforms.includes(keep) ? keep : '';
            chips.replaceChildren();
            for (const n of [0, 5, 4, 3, 2, 1]) {
                const c = el('button', 'rc-chip' + (level === n ? ' on' : ''), n ? `${n}★ ${counts[n]}` : `全部 ${scoped.length}`); c.type = 'button';
                c.onclick = () => { level = n; page = 0; render(); }; chips.appendChild(c);
            }
            list.replaceChildren();
            const filtered = selectedRows;
            resultStatus.textContent = `匹配 ${filtered.length} / ${all.length} 项 · 已显示 ${Math.min(filtered.length, (page + 1) * 50)} 项`;
            window.CustomSelectManager?.syncUI(plat);
            const by = sort.value;
            filtered.sort((a, b) => by === 'low' ? a.rating - b.rating : by === 'time' ? (b.origin?.at || 0) - (a.origin?.at || 0) : by === 'name' ? String(a.name).localeCompare(String(b.name), 'zh') : by === 'singer' ? String(a.singer).localeCompare(String(b.singer), 'zh') : b.rating - a.rating);
            for (const song of filtered.slice(0, (page + 1) * 50)) {
                const row = el('div', 'rc-row kind-' + song.kind);
                const cover = el('div', 'rc-cover', song.kind === 'song' ? '♪' : song.kind === 'album' ? '◎' : '♙');
                if (song.img) { const i = el('img'); i.src = song.img; i.alt = ''; i.loading = 'lazy'; i.referrerPolicy = 'no-referrer'; i.onerror = () => i.remove(); cover.appendChild(i); }
                const info = el('div', 'rc-info');
                const tags = el('div', 'rc-tags'); tags.append(el('span', 'k', KIND[song.kind]), el('span', '', PLATFORM[song.source] || song.source || '未知平台'), Object.assign(el('span', '', originLabel(song.origin)), { title: `评分来源代码：${song.origin?.channel || '未记录'}；表示最后一次写入评分的操作` }));
                const sub = [song.singer, song.albumName].filter(Boolean).join(' · ') || (song.kind === 'song' ? '未知歌手' : '');
                const when = fmtDate(song.origin?.at);
                info.append(el('b', '', song.name || '未知'), el('span', '', sub + (when ? `  ·  ${when}` : '')), tags);
                const details = el('details', 'rc-record-detail'); details.appendChild(el('summary', '', '评分记录'));
                details.append(el('p', '', `评分ID：${song.id}`), el('p', '', `来源：${originLabel(song.origin)}`), el('p', '', song.origin?.at ? `记录时间：${new Date(song.origin.at).toLocaleString()}` : '记录时间未保存'));
                for (const event of (song.history || []).slice().reverse()) details.appendChild(el('p', '', `${event.from || '未评分'} → ${event.to || '清除'} · ${originLabel({ channel: event.channel })} · ${new Date(event.at).toLocaleString()}`));
                info.appendChild(details);
                const stars = el('button', 'rc-stars'); stars.type = 'button'; stars.setAttribute('aria-label', `${song.rating} 星${song.kind === 'song' ? '，点击修改' : ''}`); stars.style.setProperty('--v', song.rating);
                stars.append(el('span', 'rc-star-text', '★★★★★'), el('small', '', String(song.rating)));
                if (song.kind === 'song') stars.onclick = () => open(song); else { stars.disabled = true; stars.title = '专辑/歌手评分来自 Subsonic 客户端，仅可查看'; }
                row.append(cover, info, stars); list.appendChild(row);
            }
            if (!filtered.length) list.appendChild(el('div', 'rc-empty', all.length ? '暂无符合条件的评分' : '还没有评分，去给喜欢的歌曲打星吧'));
            more.hidden = filtered.length <= (page + 1) * 50;
        }
        search.oninput = () => { page = 0; render(); }; origin.onchange = () => { page = 0; render(); }; sort.onchange = () => { page = 0; render(); }; plat.onchange = () => { page = 0; render(); }; more.onclick = () => { page++; render(); };
        collectionDialog.appendChild(more);
        collectionDialog._ratingAbort?.abort();
        const abort = new AbortController(); collectionDialog._ratingAbort = abort;
        let reloadSequence = 0;
        const reloadCollection = async () => {
            const sequence = ++reloadSequence;
            try {
                const current = await request({operation:'version'});
                if (data.version && current.version === data.version) return;
                const latest = await request();
                if (sequence !== reloadSequence || collectionReload !== reloadCollection || !collectionDialog.open || generation !== epoch || scope() !== user) return;
                const scroll = list.scrollTop;
                data = latest; render(); list.scrollTop = scroll;
            } catch { /* 保留现有列表，下次刷新重试 */ }
        };
        collectionReload = reloadCollection;
        window.addEventListener('ratingchange', reloadCollection, { signal: abort.signal });
        window.addEventListener('ratingdatachange', reloadCollection, { signal: abort.signal });
        collectionDialog.addEventListener('close', () => { if (collectionReload === reloadCollection) collectionReload = null; }, { once: true });
        collectionDialog.addEventListener('close', () => abort.abort(), { once: true });
        render(); if (!collectionDialog.open) collectionDialog.showModal();
        for (const select of [plat, origin, sort]) window.CustomSelectManager?.init(select);
        collectionDialog.addEventListener('close', () => window.CustomSelectManager?.closeAll(), { once: true });
    }
    let preferenceSequence = 0;
    async function loadPreference() {
        const sequence = ++preferenceSequence;
        const user = localStorage.getItem('lx_sync_user');
        const toggle = document.getElementById('setting-dislike-auto-rating');
        const status = document.getElementById('rating-preference-status');
        if (!toggle) return;
        toggle.disabled = true; toggle.checked = false;
        if (status) status.hidden = true;
        if (!localStorage.getItem('lx_sync_user')) { if (status) { status.textContent = '登录本地账号后可设置'; status.hidden = false; } return; }
        try {
            const saved = await request(undefined, '/api/music/rating-preferences');
            if (sequence !== preferenceSequence || localStorage.getItem('lx_sync_user') !== user) return;
            toggle.checked = saved.dislikeAutoRating; toggle.disabled = false;
            if (status) { status.textContent = ''; status.hidden = true; }
        } catch (error) { if (sequence === preferenceSequence && localStorage.getItem('lx_sync_user') === user && status) { status.textContent = '读取失败：' + error.message; status.hidden = false; } }
    }
    async function setDislikeAutoRating(enabled) {
        const sequence = ++preferenceSequence, user = localStorage.getItem('lx_sync_user');
        const toggle = document.getElementById('setting-dislike-auto-rating');
        if (toggle) toggle.disabled = true;
        try {
            const saved = await request({ dislikeAutoRating: enabled }, '/api/music/rating-preferences');
            if (localStorage.getItem('lx_sync_user') !== user || sequence !== preferenceSequence) return;
            if (toggle) toggle.checked = saved.dislikeAutoRating;
            notice(enabled ? '已开启不喜欢自动补分（仅当前账号）' : '已关闭不喜欢自动补分，已有评分保留');
        } catch(error) {
            if (localStorage.getItem('lx_sync_user') === user && sequence === preferenceSequence) { notice(error.message, true); if (toggle) toggle.checked = !enabled; }
        } finally { if (toggle && localStorage.getItem('lx_sync_user') === user && sequence === preferenceSequence) toggle.disabled = false; }
    }
    function current(song) {
        const button = document.getElementById('player-rating');
        if (button) attach(button, song);
    }
    window.addEventListener('ratingidentitychange', () => refresh());
    window.addEventListener('ratingdatachange', () => refresh());
    window.addEventListener('ratingaccountchange', () => { checkScope(); refresh(); loadPreference(); });
    window.addEventListener('storage', () => { checkScope(); refresh(); loadPreference(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    setInterval(() => { if (!document.hidden) refresh(); }, 30000);
    return { attach, attachTag, open, refresh, current, browse, loadPreference, setDislikeAutoRating };
})();
