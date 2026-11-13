// 界面语言：简体中文（原文）/ 繁體中文（OpenCC 自动转换）/ English（对照表）。
// 界面文字都直接写在页面和脚本里，这里不改动它们，而是在显示层翻译：
// 监听 DOM 变化，把文本节点和几个属性换成所选语言，并记住原文，切换语言时不用刷新页面。
(function () {
    const STORAGE_KEY = 'lx_ui_language';
    const LANGUAGES = ['zh-CN', 'zh-Hant', 'en'];
    const HAN = /[㐀-鿿]/;
    const ATTRIBUTES = ['placeholder', 'title', 'aria-label'];
    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'NOSCRIPT']);

    // 英文：exact 为整段原文 → 译文；patterns 为带 {n} 占位符的模板
    function createTranslator(table) {
        const exact = new Map(), patterns = [];
        const hanCount = text => (text.match(/[㐀-鿿]/g) || []).length;
        for (const [source, target] of Object.entries(table || {})) {
            if (!/\{\d+\}/.test(source)) { exact.set(source, target); continue; }
            const literals = source.split(/\{\d+\}/);
            const order = [...source.matchAll(/\{(\d+)\}/g)].map(match => Number(match[1]));
            const weight = hanCount(literals.join(''));
            if (weight < 1) continue;
            const escaped = literals.map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'));
            patterns.push({
                regex: new RegExp('^' + escaped.reduce((all, part, i) => all + '([\\s\\S]+?)' + part) + '$'),
                anchor: literals.reduce((best, part) => (part.trim().length > best.length ? part.trim() : best), ''),
                order, target, weight,
                // 固定汉字不多的模板容易误伤歌名：少于 4 个字时占位符里只能是数字 / 英文 / 已知界面词，
                // 只有 1 个字（如「{0}首」）时只能是数字
                strict: weight < 4, numericOnly: weight < 2,
            });
        }
        patterns.sort((a, b) => b.weight - a.weight);
        function translate(text) {
            const hit = exact.get(text);
            if (hit !== undefined) return hit;
            for (const pattern of patterns) {
                if (pattern.anchor && !text.includes(pattern.anchor)) continue;
                const match = pattern.regex.exec(text);
                if (!match) continue;
                const values = match.slice(1);
                if (pattern.numericOnly && values.some(value => !/^[\d\s.,:/%+-]+$/.test(value))) continue;
                if (pattern.strict && values.some(value => HAN.test(value) && !exact.has(value.trim()))) continue;
                const byIndex = {};
                values.forEach((value, i) => { byIndex[pattern.order[i]] = exact.get(value.trim()) ?? value; });
                return pattern.target.replace(/\{(\d+)\}/g, (_, n) => byIndex[n] ?? '');
            }
            return compose(text);
        }
        // 由几段界面词拼起来的文字（如「暂停中 (无损音质) 【缓存】」）：每一段都是已知界面词时逐段翻译
        function compose(text) {
            const parts = text.split(/(\s*[()（）【】\[\]·|:：,，、/]\s*)/);
            if (parts.length < 3) return null;
            let out = '';
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (i % 2) { out += part.replace('【', '[').replace('】', ']').replace('（', '(').replace('）', ')').replace('：', ': ').replace(/[，、]/, ', '); continue; }
                if (!HAN.test(part)) { out += part; continue; }
                const hit = exact.get(part.trim());
                if (hit === undefined) return null;
                out += part.replace(part.trim(), hit);
            }
            return out;
        }
        return { translate, size: exact.size + patterns.length };
    }

    const api = { createTranslator, LANGUAGES };
    if (typeof window !== 'undefined') window.LXI18n = api;
    if (typeof document === 'undefined') return;

    let language = 'zh-CN';
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (LANGUAGES.includes(saved)) language = saved;
    } catch (e) { /* 存储不可用时用默认语言 */ }

    let english = null, toTraditional = null, observer = null, applying = false;
    const textSources = new WeakMap(); // Text -> { source, shown }
    const attributeSources = new WeakMap(); // Element -> { name: { source, shown } }

    const scriptBase = (document.currentScript && document.currentScript.src.replace(/[^/]*$/, '')) || 'js/ui/';
    const loaded = {};
    function loadScript(file) {
        loaded[file] ||= new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = scriptBase + file;
            script.onload = resolve;
            script.onerror = () => { delete loaded[file]; reject(new Error(`Failed to load ${file}`)); };
            document.head.appendChild(script);
        });
        return loaded[file];
    }
    async function prepare(target) {
        if (target === 'en' && !english) {
            await loadScript('i18n_en.js');
            english = createTranslator(window.LX_I18N_EN || {});
        }
        if (target === 'zh-Hant' && !toTraditional) {
            await loadScript('../vendor/opencc-cn2t.js');
            toTraditional = window.OpenCC.Converter({ from: 'cn', to: 'hk' });
        }
    }

    function convert(source) {
        if (!HAN.test(source)) return source;
        if (language === 'zh-Hant') return toTraditional ? toTraditional(source) : source;
        if (language === 'en' && english) {
            const lead = source.match(/^\s*/)[0], trail = source.match(/\s*$/)[0];
            const core = source.slice(lead.length, source.length - trail.length).replace(/\s+/g, ' ');
            const translated = english.translate(core);
            return translated === null ? source : lead + translated + trail;
        }
        return source;
    }

    function skipped(node) {
        for (let el = node.nodeType === 1 ? node : node.parentElement; el; el = el.parentElement) {
            if (SKIP_TAGS.has(el.tagName) || el.isContentEditable || el.hasAttribute('data-i18n-skip')) return true;
        }
        return false;
    }
    function applyText(node) {
        const current = node.nodeValue;
        const record = textSources.get(node);
        const source = record && record.shown === current ? record.source : current;
        if (!HAN.test(source)) { if (record) textSources.delete(node); return; }
        if (skipped(node)) return;
        const shown = convert(source);
        textSources.set(node, { source, shown });
        if (shown !== current) node.nodeValue = shown;
    }
    function applyAttributes(el) {
        for (const name of ATTRIBUTES) {
            if (!el.hasAttribute(name)) continue;
            const current = el.getAttribute(name);
            const records = attributeSources.get(el) || {};
            const record = records[name];
            const source = record && record.shown === current ? record.source : current;
            if (!HAN.test(source) || skipped(el)) continue;
            const shown = convert(source);
            records[name] = { source, shown };
            attributeSources.set(el, records);
            if (shown !== current) el.setAttribute(name, shown);
        }
    }
    function applyTree(root) {
        if (!root) return;
        if (root.nodeType === 3) { applyText(root); return; }
        if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
        if (root.nodeType === 1) {
            if (SKIP_TAGS.has(root.tagName)) return;
            applyAttributes(root);
        }
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (node.nodeType === 3) applyText(node);
            else applyAttributes(node);
        }
    }

    let titleSource = null, titleShown = null;
    function applyTitle() {
        const current = document.title;
        if (titleShown !== current) titleSource = current;
        titleShown = convert(titleSource);
        if (titleShown !== current) document.title = titleShown;
    }

    function applyAll() {
        applying = true;
        try {
            applyTree(document.body);
            applyTitle();
        } finally {
            // 自己写入引起的变更记录在这一轮里丢弃
            observer?.takeRecords();
            applying = false;
        }
    }

    function watch() {
        if (observer) return;
        observer = new MutationObserver(records => {
            if (applying) return;
            applying = true;
            try {
                for (const record of records) {
                    if (record.type === 'characterData') applyText(record.target);
                    else if (record.type === 'attributes') applyAttributes(record.target);
                    else record.addedNodes.forEach(applyTree);
                }
            } finally {
                observer.takeRecords();
                applying = false;
            }
        });
        observer.observe(document.documentElement, {
            subtree: true, childList: true, characterData: true,
            attributes: true, attributeFilter: ATTRIBUTES,
        });
    }

    function syncControls() {
        document.documentElement.lang = language === 'zh-Hant' ? 'zh-Hant' : language;
        document.querySelectorAll('[data-language-select]').forEach(select => { select.value = language; });
        const short = { 'zh-CN': '简', 'zh-Hant': '繁', en: 'EN' }[language];
        document.querySelectorAll('[data-language-label]').forEach(label => { label.textContent = short; });
    }

    async function setLanguage(next) {
        if (!LANGUAGES.includes(next)) return;
        language = next;
        try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* 仅本次会话生效 */ }
        syncControls();
        try {
            await prepare(next);
        } catch (e) {
            console.warn('[i18n]', e.message);
        }
        if (language !== next) return;
        // 简体是原文：之前没切换过语言就不必监听
        if (next !== 'zh-CN' || observer) { watch(); applyAll(); }
        window.dispatchEvent(new CustomEvent('lx-language-change', { detail: { language: next } }));
    }

    // 手机顶栏的语言按钮：点一下换到下一种语言
    const cycleLanguage = () => setLanguage(LANGUAGES[(LANGUAGES.indexOf(language) + 1) % LANGUAGES.length]);
    // t(原文) 返回当前语言下显示的文字，给需要按界面文字查找元素的代码用
    Object.assign(api, { setLanguage, cycleLanguage, getLanguage: () => language, refresh: applyAll, t: convert });

    const start = () => { syncControls(); if (language !== 'zh-CN') setLanguage(language); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
