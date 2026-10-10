/**
 * PostHog 通用通知引擎 (混合模式 + 多样式美化版)
 * 核心特性：
 * 1. 优先级控制：System > Remote
 * 2. 队列系统：FIFO 队列处理
 * 3. 智能样式：根据 type 和 title 自动匹配图标与配色 (版本火箭、警告三角、广播铃铛)
 */
(function () {
    // ================= 1. 基础配置与资源 =================
    const CONFIG = {
        PRIORITY_KEYS: ['system_notification_config', 'remote_config_source'],
        getLocalVersion: () => (window.CONFIG && window.CONFIG.version) ? window.CONFIG.version : '0.0.0'
    };

    // 图标库 (SVG Path)
    const ICONS = {
        bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path>',
        rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path><path d="M9 12H4s.55-3.03 2-4c1.62-1.1 2.73-1.68 4.12-1.98"></path><path d="M15 13v5c0 1.8.71 2.93 2 4 1.15-1.46 1.83-2.6 1.98-4.02.26-2.48.51-3.66 1.02-4.98"></path>',
        warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>',
        check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>',
        info: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>',
        fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline>',
        broadcast: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>'
    };

    // 队列状态
    const NOTIFICATION_QUEUE = [];
    let isShowing = false;

    // ================= 2. 工具函数 =================

    function compareVersions(local, remote) {
        if (!local || !remote) return 0;
        const v1 = local.replace(/^v/, '').split('.').map(Number);
        const v2 = remote.replace(/^v/, '').split('.').map(Number);
        const len = Math.max(v1.length, v2.length);
        for (let i = 0; i < len; i++) {
            const n1 = v1[i] || 0;
            const n2 = v2[i] || 0;
            if (n1 < n2) return -1;
            if (n1 > n2) return 1;
        }
        return 0;
    }

    function processQueue() {
        if (isShowing || NOTIFICATION_QUEUE.length === 0) return;

        const { item, storageKey } = NOTIFICATION_QUEUE.shift();
        isShowing = true;
        console.log(`[Notification] Showing from queue: ${item.id}`);

        renderModal(item, storageKey, () => {
            isShowing = false;
            setTimeout(processQueue, 300);
        });
    }

    /**
     * 格式化通知日志文本，将其渲染为结构化美观的更新项列表与富文本
     * 
     * 支持的编写语法规范：
     * 1. 编号要点 (Ordered)：行首为数字序号，如 "1. "、"2. "、"1) "，渲染为带微底色圆角的数字徽标
     * 2. 符号要点 (Unordered)：行首为符号，如 "- "、"* "、"• "，渲染为发光的主题色微小圆点
     * 3. 标题与说明自动拆分：条目中使用冒号（中英文皆可）隔开，如 "🎵 歌手页交互革新: 新增流式浮动小窗..."，冒号前标题自动加粗突出
     * 4. 分类胶囊标签：支持 [新增]、[优化]、[修复]、[重构]、[Feature]、[Fix] 等语法，自动渲染为彩色微胶囊标签
     * 5. 行内 Markdown 增强：
     *    - **加粗文字**
     *    - `代码/键值`
     *    - 「中文强调」
     * 6. 导言与普通段落：列表前后的普通说明行自动渲染为轻量说明导语，不挤占列表布局
     */
    function formatNotificationMessage(rawMessage, accentColor) {
        if (!rawMessage) return '';

        // 1. 转义 HTML 基础字符，防止 XSS
        const escapeHtml = (str) => {
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };

        // 2. 解析行内 Markdown 样式与标签
        const parseInline = (text) => {
            let t = text;
            // **加粗**
            t = t.replace(/\*\*(.+?)\*\*/g, '<strong style="color: var(--text-main, var(--text-primary, #111827)); font-weight: 600;">$1</strong>');
            // `代码`
            t = t.replace(/`([^`]+)`/g, `<code style="padding: 1px 5px; font-size: 11px; background: color-mix(in srgb, ${accentColor} 10%, rgba(125,125,125,0.08)); color: ${accentColor}; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">$1</code>`);
            // 「强调」
            t = t.replace(/「([^」]+)」/g, `<span style="color: var(--text-main, var(--text-primary, #111827)); font-weight: 600;">「$1」</span>`);
            
            // 分类标签：[新增] [优化] [修复] [提示] 等
            t = t.replace(/\[(新增|特性|新功能|Feature|Add)\]/gi, `<span class="ph-tag ph-tag-green">$1</span>`);
            t = t.replace(/\[(修复|Bug|Fix)\]/gi, `<span class="ph-tag ph-tag-red">$1</span>`);
            t = t.replace(/\[(优化|改进|重构|提升|Perf|Opt)\]/gi, `<span class="ph-tag ph-tag-blue">$1</span>`);
            t = t.replace(/\[(警告|提示|注意|Warn)\]/gi, `<span class="ph-tag ph-tag-amber">$1</span>`);
            return t;
        };

        const rawLines = rawMessage.split(/\r?\n/);
        // 清理空行
        const lines = rawLines.map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length === 0) return '';

        // 判断是否包含列表项 (以数字序号或符号开头)
        const isListItem = (line) => /^(\d+[\.、\)]|[-*•])\s+/.test(line);
        const hasListItems = lines.some(isListItem);

        if (!hasListItems) {
            // 普通文本段落，逐段渲染
            return lines.map(line => {
                const escaped = escapeHtml(line);
                return `<p style="margin: 0 0 8px; color: var(--text-main, var(--text-primary, #374151)); font-size: 13.5px; line-height: 1.6;">${parseInline(escaped)}</p>`;
            }).join('');
        }

        let html = '';
        let inList = false;

        lines.forEach(line => {
            const escaped = escapeHtml(line);
            const matchOrdered = escaped.match(/^(\d+)[\.、\)]\s+(.*)/);
            const matchUnordered = escaped.match(/^[-*•]\s+(.*)/);

            if (matchOrdered || matchUnordered) {
                if (!inList) {
                    html += '<div class="ph-changelog-list" style="display: flex; flex-direction: column; gap: 8px; margin-top: 6px;">';
                    inList = true;
                }

                let badgeHtml = '';
                let contentRaw = '';

                if (matchOrdered) {
                    const num = matchOrdered[1];
                    contentRaw = matchOrdered[2];
                    badgeHtml = `
                        <div class="ph-num-badge" style="
                            flex-shrink: 0;
                            width: 19px; height: 19px;
                            border-radius: 6px;
                            background: color-mix(in srgb, ${accentColor} 14%, var(--bg-item-hover, rgba(0,0,0,0.06)));
                            color: ${accentColor};
                            font-size: 11px;
                            font-weight: 700;
                            display: flex; align-items: center; justify-content: center;
                            margin-top: 2px;
                        ">${num}</div>
                    `;
                } else {
                    contentRaw = matchUnordered[1];
                    badgeHtml = `
                        <div class="ph-dot-badge" style="
                            flex-shrink: 0;
                            width: 6px; height: 6px;
                            border-radius: 50%;
                            background: ${accentColor};
                            box-shadow: 0 0 6px color-mix(in srgb, ${accentColor} 60%, transparent);
                            margin-top: 7px;
                            margin-left: 4px; margin-right: 6px;
                        "></div>
                    `;
                }

                // 智能拆分 标题: 描述
                let itemContentHtml = '';
                const colonIndex = contentRaw.search(/[:：]/);
                if (colonIndex > 0 && colonIndex < 35) {
                    const titlePart = contentRaw.slice(0, colonIndex + 1);
                    const descPart = contentRaw.slice(colonIndex + 1).trim();
                    itemContentHtml = `
                        <div style="flex: 1; font-size: 13px; line-height: 1.55; color: var(--text-muted, var(--text-secondary, #4b5563));">
                            <span style="font-weight: 600; color: var(--text-main, var(--text-primary, #111827)); display: inline; margin-right: 4px;">
                                ${parseInline(titlePart)}
                            </span>
                            ${descPart ? `<span>${parseInline(descPart)}</span>` : ''}
                        </div>
                    `;
                } else {
                    itemContentHtml = `
                        <div style="flex: 1; font-size: 13px; line-height: 1.55; color: var(--text-main, var(--text-primary, #374151));">
                            ${parseInline(contentRaw)}
                        </div>
                    `;
                }

                html += `
                    <div class="ph-changelog-item" style="
                        display: flex;
                        align-items: flex-start;
                        gap: 10px;
                        padding: 8px 10px;
                        border-radius: 10px;
                        background: var(--bg-card, rgba(125, 125, 125, 0.04));
                        border: 1px solid var(--border-dim, rgba(125, 125, 125, 0.06));
                        transition: all 0.15s ease;
                    ">
                        ${badgeHtml}
                        ${itemContentHtml}
                    </div>
                `;
            } else {
                if (inList) {
                    html += '</div>';
                    inList = false;
                }
                html += `
                    <div class="ph-changelog-lead" style="
                        margin: 0 0 6px;
                        color: var(--text-muted, var(--text-secondary, #4b5563));
                        font-size: 12.5px;
                        line-height: 1.5;
                        font-weight: 500;
                    ">${parseInline(escaped)}</div>
                `;
            }
        });

        if (inList) {
            html += '</div>';
        }

        return html;
    }

    // 智能获取样式配置
    function getStyleConfig(type, title) {
        const t = (title || '').toLowerCase();
        const typeStr = (type || '').toLowerCase();

        // 系统当前主题主色
        const themePrimaryColor = 'var(--c-600, var(--accent-primary, #059669))';
        const themePrimaryBg = 'color-mix(in srgb, var(--c-500, var(--accent-primary, #10b981)) 14%, var(--bg-item-hover, rgba(0, 0, 0, 0.04)))';

        // 1. 版本更新 (Rocket) - 遵循当前系统主题色
        if (typeStr === 'version' || t.includes('update') || t.includes('更新') || t.includes('版本')) {
            return {
                icon: ICONS.rocket,
                color: themePrimaryColor,
                bg: themePrimaryBg,
                label: 'New Update',
                sectionTitle: '更新内容与日志',
                sectionIcon: ICONS.fileText
            };
        }

        // 2. 警告/维护 (Warning) - 使用醒目的橙色警示
        if (typeStr === 'warning' || t.includes('维护') || t.includes('警告') || t.includes('失败') || t.includes('error') || t.includes('warning')) {
            return {
                icon: ICONS.warning,
                color: '#f59e0b', // Amber 500
                bg: 'color-mix(in srgb, #f59e0b 14%, var(--bg-item-hover, rgba(0, 0, 0, 0.04)))',
                label: 'System Alert',
                sectionTitle: '重要提示与说明',
                sectionIcon: ICONS.warning
            };
        }

        // 3. 成功/连接 (Success)
        if (typeStr === 'success' || t.includes('成功') || t.includes('success') || t.includes('完成')) {
            return {
                icon: ICONS.check,
                color: '#10b981', // Emerald 500
                bg: 'color-mix(in srgb, #10b981 14%, var(--bg-item-hover, rgba(0, 0, 0, 0.04)))',
                label: 'Success',
                sectionTitle: '详细信息',
                sectionIcon: ICONS.check
            };
        }

        // 4. 广播/公告 (Broadcast / Announcement) - 遵循当前系统主题色
        if (typeStr === 'broadcast' || typeStr === 'announcement' || typeStr === 'notice' || t.includes('公告') || t.includes('通知') || t.includes('欢迎')) {
            return {
                icon: ICONS.bell,
                color: themePrimaryColor,
                bg: themePrimaryBg,
                label: 'Announcement',
                sectionTitle: '公告内容',
                sectionIcon: ICONS.broadcast
            };
        }

        // 5. 默认/通用通知 (Bell) - 遵循当前系统主题色
        return {
            icon: ICONS.bell,
            color: themePrimaryColor,
            bg: themePrimaryBg,
            label: 'Notification',
            sectionTitle: '通知内容',
            sectionIcon: ICONS.bell
        };
    }

    // 渲染 UI (多样式版)
    function renderModal(item, storageKey, onModalClose) {
        if (document.getElementById('ph-notification-overlay')) return;

        const styleConfig = getStyleConfig(item.type, item.ui ? item.ui.title : '');

        // 版本信息展示逻辑
        const currentVer = CONFIG.getLocalVersion();
        const isVerRelated = item.type === 'version' || (item.id && item.id.includes('manual_check'));
        let versionBadge = '';
        if (isVerRelated) {
            let targetVer = '未知';
            const currentVer = CONFIG.getLocalVersion().replace(/^v+/, 'v');
            if (item.logic && item.logic.target_version) {
                targetVer = item.logic.target_version.replace(/^v+/, 'v');
            } else if (item.id === 'manual_check_uptodate') {
                targetVer = currentVer;
            }
            versionBadge = `
                <div style="display: flex; align-items: center; justify-content: space-around; gap: 12px; margin: 14px 0; padding: 12px; background: var(--bg-item-hover, rgba(0,0,0,0.03)); border: 1px solid var(--border-dim, rgba(0,0,0,0.08)); border-radius: 14px; font-size: 13px;">
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 3px;">
                        <span style="color: var(--text-dim, var(--text-muted, #9ca3af)); font-size: 11px; font-weight: 600; text-transform: uppercase;">当前版本</span>
                        <span style="color: var(--text-main, var(--text-primary, #111827)); font-weight: 700;">${currentVer}</span>
                    </div>
                    <div style="width: 1px; height: 24px; background: var(--border-dim, rgba(0,0,0,0.1));"></div>
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 3px;">
                        <span style="color: var(--text-dim, var(--text-muted, #9ca3af)); font-size: 11px; font-weight: 600; text-transform: uppercase;">最新版本</span>
                        <span style="color: ${item.type === 'version' ? styleConfig.color : 'var(--text-main, #111827)'}; font-weight: 700; text-shadow: 0 0 10px color-mix(in srgb, ${styleConfig.color} 30%, transparent);">${targetVer}</span>
                    </div>
                </div>
            `;
        }

        const overlay = document.createElement('div');
        overlay.id = 'ph-notification-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.45);z-index:99999;display:flex;justify-content:center;align-items:center;font-family:Inter,system-ui,-apple-system,sans-serif;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);transition:opacity 0.3s;';

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: var(--bg-panel, var(--bg-secondary, #ffffff));
            color: var(--text-main, var(--text-primary, #1f2937));
            border: 1px solid var(--border-dim, var(--glass-border, rgba(0,0,0,0.08)));
            width: 380px; 
            max-width: calc(100vw - 32px);
            padding: 0;
            border-radius: 24px; 
            box-shadow: 0 20px 45px rgba(0, 0, 0, 0.25), 0 0 0 1px var(--border-dim, rgba(0,0,0,0.05));
            text-align: center; 
            overflow: hidden;
            animation: phFadeIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
        `;

        // 注入全局动画与列表美化样式
        if (!document.getElementById('ph-style')) {
            const style = document.createElement('style');
            style.id = 'ph-style';
            style.textContent = `
                @keyframes phFadeIn { from {opacity:0;transform:scale(0.95) translateY(20px);} to {opacity:1;transform:scale(1) translateY(0);} }
                .ph-btn { transition: all 0.2s; position: relative; overflow: hidden; }
                .ph-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
                .ph-btn:active { transform: scale(0.98); }
                .ph-scroll-box::-webkit-scrollbar { width: 5px; }
                .ph-scroll-box::-webkit-scrollbar-track { background: transparent; }
                .ph-scroll-box::-webkit-scrollbar-thumb { background: var(--border-dim, rgba(150, 150, 150, 0.25)); border-radius: 10px; }
                .ph-scroll-box::-webkit-scrollbar-thumb:hover { background: var(--text-dim, rgba(150, 150, 150, 0.45)); }
                .ph-changelog-item:hover { background: color-mix(in srgb, var(--bg-item-hover, rgba(0,0,0,0.06)) 80%, transparent) !important; }
                .ph-tag { display: inline-flex; align-items: center; padding: 1px 6px; font-size: 11px; font-weight: 700; border-radius: 4px; margin-right: 4px; }
                .ph-tag-green { background: rgba(16,185,129,0.12); color: #10b981; }
                .ph-tag-red { background: rgba(239,68,68,0.12); color: #ef4444; }
                .ph-tag-blue { background: rgba(59,130,246,0.12); color: #3b82f6; }
                .ph-tag-amber { background: rgba(245,158,11,0.12); color: #f59e0b; }
            `;
            document.head.appendChild(style);
        }

        const { title, message, confirm_text, cancel_text } = item.ui;
        const hasCancel = cancel_text && cancel_text.length > 0;
        const sectionTitle = (item.ui && (item.ui.section_title || item.ui.sectionTitle || item.ui.header_label)) || styleConfig.sectionTitle || '详细内容';
        const sectionIcon = styleConfig.sectionIcon || ICONS.fileText;

        // 根据样式配置动态生成头部
        modal.innerHTML = `
            <div style="padding: 32px 24px 20px;">
                <div style="
                    margin: 0 auto 16px; 
                    width: 64px; height: 64px; 
                    border-radius: 20px; 
                    background: ${styleConfig.bg}; 
                    color: ${styleConfig.color};
                    display: flex; align-items: center; justify-content: center;
                    border: 1px solid color-mix(in srgb, ${styleConfig.color} 25%, var(--border-dim, rgba(0,0,0,0.08)));
                    box-shadow: 0 8px 24px color-mix(in srgb, ${styleConfig.color} 20%, transparent);
                ">
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        ${styleConfig.icon}
                    </svg>
                </div>
                
                <h3 style="margin:0 0 8px; color: var(--text-main, var(--text-primary, #111827)); font-size:19px; font-weight:700; letter-spacing: -0.3px;">${title}</h3>
                ${versionBadge}
                ${item.ui.date ? `<p style="margin:0 0 8px; color: var(--text-dim, var(--text-muted, #6b7280)); font-size:12px;">发布日期: ${item.ui.date}</p>` : ''}
                
                <div class="ph-scroll-box" style="margin-top: 14px; padding: 14px 16px; background: var(--bg-item-hover, rgba(0,0,0,0.03)); border-radius: 16px; border: 1px solid var(--border-dim, rgba(0,0,0,0.06)); text-align: left; max-height: 220px; overflow-y: auto;">
                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${styleConfig.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${sectionIcon}</svg>
                        <span style="font-size: 12px; font-weight: 700; color: var(--text-muted, var(--text-secondary, #4b5563)); text-transform: uppercase;">${sectionTitle}</span>
                    </div>
                    ${formatNotificationMessage(message, styleConfig.color)}
                </div>
            </div>

            <div style="padding: 0 24px 24px; display:flex; gap:12px; justify-content:center;">
                ${hasCancel ? `
                <button id="ph-btn-cancel" class="ph-btn" style="
                    flex:1; padding:12px; border:1px solid var(--border-dim, rgba(0,0,0,0.1)); background: var(--bg-item-hover, rgba(0,0,0,0.04)); 
                    border-radius:14px; cursor:pointer; color: var(--text-muted, var(--text-secondary, #4b5563)); font-weight:600; font-size:14px;
                ">${cancel_text}</button>` : ''}
                
                <button id="ph-btn-confirm" class="ph-btn" style="
                    flex:1; padding:12px; border:none; background:${styleConfig.color}; 
                    color:#ffffff; border-radius:14px; cursor:pointer; font-weight:600; font-size:14px;
                    box-shadow: 0 4px 16px color-mix(in srgb, ${styleConfig.color} 35%, transparent); letter-spacing: 0.3px;
                ">${confirm_text}</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const close = () => {
            if (document.body.contains(overlay)) {
                overlay.style.opacity = '0';
                modal.style.transform = 'scale(0.95) translateY(10px)';
                modal.style.opacity = '0';
                modal.style.transition = 'all 0.2s ease-in';
                setTimeout(() => {
                    if (document.body.contains(overlay)) document.body.removeChild(overlay);
                    if (onModalClose) onModalClose();
                }, 200);
            }
        };

        const recordView = () => {
            if (item.logic.interval_hours !== 0) {
                localStorage.setItem(storageKey, Date.now().toString());
            }
        };

        document.getElementById('ph-btn-confirm').onclick = () => {
            recordView();
            const action = item.action ? item.action.type : 'close';

            // 动作处理逻辑
            if (action === 'reload') {
                close();
                if (navigator.serviceWorker) {
                    navigator.serviceWorker.getRegistrations().then(regs => {
                        for (let reg of regs) reg.unregister();
                        window.location.reload(true);
                    });
                } else {
                    window.location.reload(true);
                }
            } else if (action === 'link') {
                close();
                window.open(item.action.url, '_blank');
            } else {
                close();
            }
        };

        if (hasCancel) {
            document.getElementById('ph-btn-cancel').onclick = () => {
                if (item.logic.interval_hours > 0) {
                    localStorage.setItem(storageKey, Date.now().toString());
                }
                close();
            };
        }
    }

    // ================= 3. 核心逻辑处理 =================
    function processItem(item, isManual = false) {
        if (!item || item.status !== 'active') return false;

        // Manual check: ONLY allow 'version' type notifications
        if (isManual && item.type !== 'version') return false;

        const currentVer = CONFIG.getLocalVersion();
        const storageKey = `ph_notif_${item.id}`;
        const lastSeen = localStorage.getItem(storageKey);

        // 如果是手动检查，忽略时间间隔限制
        if (!isManual && lastSeen) {
            const interval = item.logic.interval_hours;
            if (interval === -1) return false;
            const hoursPassed = (Date.now() - parseInt(lastSeen)) / (1000 * 60 * 60);
            if (hoursPassed < interval) return false;
        }

        if (item.type === 'version') {
            const target = item.logic.target_version;
            // 如果是手动检查，且已经是最新版，返回 false
            if (item.logic.operator === '<' && compareVersions(currentVer, target) >= 0) {
                return false;
            }
        }

        NOTIFICATION_QUEUE.push({ item, storageKey });
        processQueue();
        return true;
    }

    // ================= 4. 数据获取与处理 =================
    async function handlePayload(payload, sourceKey, isManual = false) {
        if (!payload) return false;
        let hasUpdate = false;
        try {
            if (typeof payload === 'object' && payload.url && typeof payload.url === 'string') {
                await fetchRemoteConfig(payload.url, isManual);
                return; // fetchRemoteConfig 会处理结果，这里不好直接返回 hasUpdate，简化处理
            }
            if (typeof payload === 'string' && payload.startsWith('http')) {
                await fetchRemoteConfig(payload, isManual);
                return;
            }
            const data = (typeof payload === 'string') ? JSON.parse(payload) : payload;
            let latestItem = null;
            if (Array.isArray(data)) {
                data.forEach(item => {
                    if (item.type === 'version' && (!latestItem || compareVersions(item.logic.target_version, latestItem.logic.target_version) > 0)) latestItem = item;
                    if (processItem(item, isManual)) hasUpdate = true;
                });
            } else {
                if (data.type === 'version') latestItem = data;
                if (processItem(data, isManual)) hasUpdate = true;
            }

            if (isManual && !hasUpdate) {
                const msg = latestItem && latestItem.ui && latestItem.ui.message
                    ? latestItem.ui.message
                    : `无法从服务器获取到版本发布详情，您的系统当前版本为 ${CONFIG.getLocalVersion()}。`;
                const upToDateItem = {
                    id: 'manual_check_uptodate',
                    type: 'info',
                    ui: {
                        title: '当前已是最新版本',
                        message: msg,
                        confirm_text: '确定',
                        cancel_text: ''
                    },
                    action: { type: 'close' },
                    logic: { interval_hours: 0 }
                };
                renderModal(upToDateItem, 'temp_manual_check', null);
            }
        } catch (e) {
            console.error(`[Notification] Error processing payload from ${sourceKey}:`, e);
        }
        return hasUpdate;
    }

    async function fetchRemoteConfig(url, isManual = false) {
        try {
            const bustUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
            const res = await fetch(bustUrl, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            const data = await res.json();
            let hasUpdate = false;
            let latestItem = null;
            if (Array.isArray(data)) {
                data.forEach(item => {
                    if (item.type === 'version' && (!latestItem || compareVersions(item.logic.target_version, latestItem.logic.target_version) > 0)) latestItem = item;
                    if (processItem(item, isManual)) hasUpdate = true;
                });
            } else {
                if (data.type === 'version') latestItem = data;
                if (processItem(data, isManual)) hasUpdate = true;
            }

            if (isManual && !hasUpdate) {
                const msg = latestItem && latestItem.ui && latestItem.ui.message
                    ? latestItem.ui.message
                    : `无法从服务器获取到版本发布详情，您的系统当前版本为 ${CONFIG.getLocalVersion()}。`;
                // Construct a temporary item for "Up to date"
                const upToDateItem = {
                    id: 'manual_check_uptodate',
                    type: 'info', // Will use Success/Check icon based on title match in getStyleConfig
                    ui: {
                        title: '当前已是最新版本',
                        message: msg,
                        confirm_text: '确定',
                        cancel_text: ''
                    },
                    action: { type: 'close' },
                    logic: { interval_hours: 0 }
                };
                renderModal(upToDateItem, 'temp_manual_check', null);
            }
        } catch (e) {
            console.error('[Notification] Check failed:', e);
            if (isManual) {
                let errorTitle = '检查更新失败';
                let errorMessage = '无法连接到更新服务器，请检查网络连接或稍后重试。';

                // 更精确的错误提示
                if (e.message.includes('404')) {
                    errorMessage = '当前服务器未发现预设的更新通知文件，且在线更新检查功能已关闭。';
                } else if (!window.CONFIG || window.CONFIG.disableTelemetry) {
                    errorMessage = '由于你已在设置或环境变量中禁用了「数据收集与统计」，系统无法自动连接到远程更新服务器。请直接前往 GitHub 发布页面下载最新版本。';
                }

                const errorItem = {
                    id: 'manual_check_error',
                    type: 'warning',
                    ui: {
                        title: errorTitle,
                        message: errorMessage,
                        confirm_text: '确定',
                        cancel_text: ''
                    },
                    action: { type: 'close' },
                    logic: { interval_hours: 0 }
                };
                renderModal(errorItem, 'temp_manual_error', null);
            }
        }
    }

    // ================= 5. 初始化入口 =================
    function init() {
        if (typeof posthog === 'undefined') {
            if (!window._ph_retry) window._ph_retry = 0;
            if (window._ph_retry < 10) {
                window._ph_retry++;
                setTimeout(init, 500);
            }
            return;
        }

        posthog.onFeatureFlags(() => {
            checkUpdates(false);
        });
    }

    async function checkUpdates(isManual = false) {
        // 如果是手动检查，增加一个主动探测逻辑来判断 PostHog 是否被拦截
        let adBlocked = !!window._ph_blocked;
        if (isManual && !adBlocked) {
            // 如果 posthog 对象看起来还没完全加载，进行一次 fetch 探测
            if (typeof posthog === 'undefined' || !posthog.__loaded) {
                try {
                    await fetch('https://us.i.posthog.com/static/array.js', { mode: 'no-cors', cache: 'no-store' });
                } catch (e) {
                    console.warn('[Notification] Proactive AdBlocker detection triggered.');
                    adBlocked = true;
                }
            }
        }

        // 如果是手动检查，尝试强制刷新 PostHog 配置以获取最新数据
        if (isManual && typeof posthog !== 'undefined' && !adBlocked) {
            try { posthog.reloadFeatureFlags(); } catch (e) { console.error('[Notification] Reload flags failed:', e); }
        }

        // 如果服务没加载，或者被 AdBlocker 拦截，或者配置里明确禁用了，直接弹窗提示
        if (typeof posthog === 'undefined' || (window.CONFIG && window.CONFIG.disableTelemetry) || adBlocked) {
            if (isManual) {
                const message = adBlocked
                    ? '由于您的浏览器广告拦截插件（AdBlocker）拦截了更新检查服务，无法在线获取最新版本信息。请暂时关闭插件或将 LX Server 地址加入白名单。'
                    : '由于在线更新检测服务未加载（可能已禁用统计），请前往 GitHub 检查最新版本。';

                const errorItem = {
                    id: 'manual_check_disabled',
                    type: 'warning',
                    ui: {
                        title: '检查更新受阻',
                        message: message,
                        confirm_text: '确定',
                        cancel_text: ''
                    },
                    action: { type: 'close' },
                    logic: { interval_hours: 0 }
                };
                renderModal(errorItem, 'temp_manual_disabled', null);
            }
            return;
        }

        let checked = false;
        for (const key of CONFIG.PRIORITY_KEYS) {
            const isEnabled = posthog.isFeatureEnabled(key);
            if (isEnabled) {
                const payload = posthog.getFeatureFlagPayload(key);
                if (payload) {
                    handlePayload(payload, key, isManual);
                    checked = true;
                    return;
                }
            }
        }

        if (isManual && !checked) {
            // 如果 Feature Flags 里没东西，仅显示提示即可
            const upToDateItem = {
                id: 'manual_check_uptodate',
                type: 'info',
                ui: {
                    title: '当前已是最新版本',
                    message: `无法从服务器获取到版本发布详情，您的系统当前版本为 ${CONFIG.getLocalVersion().replace(/^v+/, 'v')}。`,
                    confirm_text: '确定',
                    cancel_text: ''
                },
                action: { type: 'close' },
                logic: { interval_hours: 0 }
            };
            renderModal(upToDateItem, 'temp_manual_check', null);
        }
    }

    // 暴露给全局的方法
    window.LxNotification = {
        checkUpdates: checkUpdates
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
