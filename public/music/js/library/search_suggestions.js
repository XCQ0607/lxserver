(function () {
    const SOURCES = ['kw', 'kg', 'tx', 'wy', 'mg'];
    const normalize = text => text.normalize('NFKC').trim().toLowerCase().replace(/\s*[-–—]\s*/g, ' - ').replace(/\s+/g, ' ');
    function merge(groups, query, limit = 10) {
        const words = new Map(), keyword = normalize(query);
        groups.forEach((group, source) => {
            const seen = new Set();
            group.forEach((text, rank) => {
                if (typeof text !== 'string' || !text.trim()) return;
                const key = normalize(text);
                if (seen.has(key)) return;
                seen.add(key);
                if (!words.has(key)) words.set(key, { text: text.trim(), votes: 0, rank, source, match: key === keyword ? 2 : key.startsWith(keyword) ? 1 : 0 });
                const word = words.get(key);
                word.votes++;
                word.rank = Math.min(word.rank, rank);
            });
        });
        return [...words.values()].sort((a, b) => b.votes - a.votes || b.match - a.match || a.rank - b.rank || a.source - b.source).slice(0, limit).map(word => word.text);
    }
    function create({ fetchTips, sources = SOURCES, timeout = 2000, ttl = 60000, capacity = 100, now = Date.now }) {
        const cache = new Map();
        let active = null;
        function cancel() { active?.abort(); active = null; }
        async function search(query, source, onUpdate) {
            cancel();
            const owner = new AbortController();
            active = owner;
            const providers = source === 'all' ? sources : sources.includes(source) ? [source] : [];
            const groups = providers.map(() => []);
            const current = () => active === owner && !owner.signal.aborted;
            const publish = () => { if (current()) onUpdate(merge(groups, query)); };
            const missing = [];
            providers.forEach((provider, index) => {
                const key = `${provider}:${normalize(query)}`, entry = cache.get(key);
                if (entry && entry.expires > now()) groups[index] = entry.tips;
                else { cache.delete(key); missing.push({ provider, index, key }); }
            });
            publish();
            await Promise.all(missing.map(async ({ provider, index, key }) => {
                const controller = new AbortController();
                let timer, abort;
                const deadline = new Promise((_, reject) => {
                    abort = () => { controller.abort(); reject(new Error('Suggestions cancelled')); };
                    owner.signal.addEventListener('abort', abort, { once: true });
                    timer = setTimeout(abort, timeout);
                    if (owner.signal.aborted) abort();
                });
                try {
                    const tips = await Promise.race([Promise.resolve().then(() => fetchTips(provider, query, controller.signal)), deadline]);
                    if (!current() || !Array.isArray(tips)) return;
                    groups[index] = tips.filter(tip => typeof tip === 'string' && tip.trim()).slice(0, 30);
                    // Empty responses may represent an unavailable upstream; retry them next time.
                    if (groups[index].length) {
                        cache.delete(key);
                        cache.set(key, { tips: groups[index], expires: now() + ttl });
                        while (cache.size > capacity) cache.delete(cache.keys().next().value);
                    }
                    publish();
                } catch (_) {
                    // A failed or slow source must not hide other providers' suggestions.
                } finally {
                    clearTimeout(timer);
                    owner.signal.removeEventListener('abort', abort);
                }
            }));
            return current() ? merge(groups, query) : [];
        }
        return { search, cancel };
    }
    window.MusicSuggestions = { create, merge };
    if (typeof document === 'undefined') return;

    let engine, timer, composing = false, selected = -1, context = '', lastContext = '';
    // 手指 / 鼠标按在联想词上的那一下：期间输入框失焦或列表重绘都不能让这次点选落空
    let press = null, chosenAt = 0;
    const input = () => document.getElementById('search-input');
    const box = () => document.getElementById('search-suggestions');
    const list = () => document.getElementById('search-suggestions-list');
    function signature() {
        return JSON.stringify([input()?.value.trim(), document.getElementById('search-source')?.value || 'kw', document.getElementById('search-type')?.value || 'song', window.currentSearchScope]);
    }
    function hide() {
        clearTimeout(timer);
        engine?.cancel();
        context = '';
        selected = -1;
        box()?.classList.add('hidden');
        input()?.setAttribute('aria-expanded', 'false');
        input()?.removeAttribute('aria-activedescendant');
    }
    function select(index) {
        selected = index;
        const items = list()?.querySelectorAll('.search-tip-item') || [];
        items.forEach((item, i) => {
            item.classList.toggle('t-bg-muted', i === selected);
            item.setAttribute('aria-selected', String(i === selected));
        });
        if (items[selected]) {
            input().setAttribute('aria-activedescendant', items[selected].id);
            items[selected].scrollIntoView({ block: 'nearest' });
        } else input()?.removeAttribute('aria-activedescendant');
    }
    function choose(text) {
        chosenAt = Date.now();
        press = null;
        input().value = text;
        hide();
        window.doSearch();
    }
    function render(tips) {
        const target = list(), field = input(), container = box();
        if (!target || !field || !container) return;
        const previous = selected >= 0 ? target.children[selected]?.dataset.tip : null;
        // 各平台的结果陆续返回时内容常常没变：不重建节点，免得正被按住的那一项被换掉
        const shown = [...target.children].map(item => item.dataset.tip);
        if (tips.length && shown.length === tips.length && shown.every((tip, i) => tip === tips[i]) && !container.classList.contains('hidden')) return;
        target.replaceChildren();
        tips.forEach((tip, index) => {
            const item = document.createElement('div');
            item.id = `search-tip-${index}`;
            item.dataset.tip = tip;
            item.className = 'search-tip-item px-4 py-2.5 hover:t-bg-muted cursor-pointer transition-colors text-sm flex items-center gap-3';
            item.setAttribute('role', 'option');
            const icon = document.createElement('i');
            icon.className = 'fas fa-search t-text-muted text-xs';
            icon.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.className = 'truncate';
            label.textContent = tip;
            item.append(icon, label);
            item.onpointerdown = event => event.preventDefault();
            // 触屏上按下会让输入框失焦，mousedown 也拦住才能保住焦点
            item.onmousedown = event => event.preventDefault();
            item.onclick = event => { event.stopPropagation(); if (Date.now() - chosenAt > 600) choose(tip); };
            target.appendChild(item);
        });
        container.classList.toggle('hidden', !tips.length);
        field.setAttribute('aria-expanded', String(!!tips.length));
        select(previous ? tips.indexOf(previous) : -1);
    }
    async function request(query = input()?.value.trim()) {
        hide();
        if (!query || composing || window.currentSearchScope !== 'network' || document.activeElement !== input()) return;
        engine ||= create({ fetchTips: async (source, text, signal) => {
            const headers = typeof getUserAuthHeaders === 'function' ? getUserAuthHeaders() : {};
            const response = await fetch(`/api/music/tipSearch?name=${encodeURIComponent(text)}&source=${encodeURIComponent(source)}`, { signal, headers });
            if (!response.ok) throw new Error('Suggestion request failed');
            return response.json();
        } });
        context = signature();
        if (lastContext !== context) { list()?.replaceChildren(); lastContext = context; }
        const owner = context;
        const source = document.getElementById('search-source')?.value || 'kw';
        await engine.search(query, source, tips => {
            if (context === owner && signature() === owner && !composing && document.activeElement === input()) render(tips);
        });
    }
    function schedule() {
        hide();
        const query = input()?.value.trim();
        if (composing || !query || window.currentSearchScope !== 'network') return;
        timer = setTimeout(() => request(query), 300);
    }
    function submit(event) {
        event.preventDefault();
        if (composing || event.isComposing || event.keyCode === 229) return;
        hide();
        window.doSearch();
    }
    function init() {
        const field = input(), container = box();
        if (!field || !container) return;
        field.addEventListener('compositionstart', () => { composing = true; hide(); });
        field.addEventListener('compositionend', () => { composing = false; schedule(); });
        field.addEventListener('input', event => {
            if (event.isComposing || composing) { hide(); return; }
            schedule();
            if (!field.value.trim() && window.currentSearchScope === 'network') window.returnSearchHome?.();
        });
        field.addEventListener('focus', () => request());
        field.addEventListener('blur', () => { if (!press) hide(); });
        // 点选以「按下和抬起都落在联想词上、且没有滑动」为准，不依赖 click：
        // 触屏上输入框失焦或列表重绘后，click 可能根本不会触发
        container.addEventListener('pointerdown', event => { press = { x: event.clientX, y: event.clientY }; });
        const release = event => {
            const start = press;
            press = null;
            if (!start || event.type === 'pointercancel') { if (start && document.activeElement !== field) hide(); return; }
            if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) return;
            const item = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.search-tip-item');
            if (item && container.contains(item)) choose(item.dataset.tip);
        };
        document.addEventListener('pointerup', release);
        document.addEventListener('pointercancel', release);
        field.addEventListener('keydown', event => {
            if (composing || event.isComposing || event.keyCode === 229) return;
            const items = container.classList.contains('hidden') ? [] : list()?.querySelectorAll('.search-tip-item') || [];
            if (event.key === 'Escape') { event.preventDefault(); hide(); }
            else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                if (!items.length) return;
                event.preventDefault();
                select(event.key === 'ArrowDown' ? (selected + 1) % items.length : selected < 0 ? items.length - 1 : (selected - 1 + items.length) % items.length);
            } else if (event.key === 'Enter' && selected >= 0 && items[selected]) {
                event.preventDefault();
                event.stopPropagation();
                choose(items[selected].dataset.tip);
            }
        });
        ['search-source', 'search-type'].forEach(id => document.getElementById(id)?.addEventListener('change', hide));
        document.addEventListener('click', event => { if (!field.contains(event.target) && !container.contains(event.target)) hide(); });
    }
    window.SearchSuggestions = { hide, request, submit, get composing() { return composing; } };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
