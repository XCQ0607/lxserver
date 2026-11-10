/*
 * Copyright 2026 xcq0607 (https://github.com/xcq0607)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


const API_BASE = '';

function stringToColor(str) {
    if (!str) return 'var(--accent-primary)';
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return `hsl(${h}, 70%, 45%)`;
}

class App {
    constructor() {
        this.password = null;
        this.currentView = 'dashboard';
        this.users = [];
        this.configLoaded = false;
        this.systemCpuHistory = [];
        this.processCpuHistory = [];
        this.systemMemHistory = [];
        this.processMemHistory = [];
        this.monitorLabels = [];
        this.cpuChartInstance = null;
        this.memChartInstance = null;
        this.monitorTimer = null;
        this.init();
        this.initVersion();
        this.initCustomSelects();
    }

    init() {
        // 检查是否已登录
        const savedPassword = localStorage.getItem('lx_auth');
        if (savedPassword) {
            this.password = savedPassword;
            this.showApp();
            this.loadConfig(); // [新增] 初始化时加载配置，确保 configLoaded 标志位正确且持有环境变量数据
            this.loadDashboard();
        } else {
            this.initLoginScreenEffects();
        }

        // 绑定登录事件
        document.getElementById('login-btn')?.addEventListener('click', () => this.login());
        document.getElementById('admin-login-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.login();
        });
        document.getElementById('access-password')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.login();
        });
        document.getElementById('toggle-pwd-btn')?.addEventListener('click', () => {
            const pwdInput = document.getElementById('access-password');
            const icon = document.querySelector('#toggle-pwd-btn i');
            if (pwdInput) {
                const isPassword = pwdInput.type === 'password';
                pwdInput.type = isPassword ? 'text' : 'password';
                if (icon) {
                    icon.className = isPassword ? 'fas fa-eye-slash text-indigo-400' : 'far fa-eye';
                }
            }
        });

        // 绑定退出登录
        document.getElementById('logout-btn')?.addEventListener('click', () => this.logout());

        // 绑定导航
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const view = item.dataset.view;
                if (view === 'music') return; // 播放器链接直接跳转，不拦截
                e.preventDefault();
                this.switchView(view);
            });
        });

        // 绑定快速操作
        document.querySelectorAll('.action-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                this.handleQuickAction(action);
            });
        });

        // 用户管理
        document.getElementById('add-user-btn')?.addEventListener('click', () => this.showAddUserModal());
        document.getElementById('refresh-users-btn')?.addEventListener('click', async () => {
            try {
                // 在重载前先保存配置
                const restarting = await this.saveConfig(true);
                if (restarting) return;
                await this.request('/api/admin/reload', { method: 'POST' });
                this.loadUsers();
                this.loadDashboard();
                showSuccess('重载数据成功');
            } catch (err) {
                showError('重载数据失败: ' + err.message);
            }
        });
        // 新增：批量删除和全选
        document.getElementById('batch-delete-users-btn')?.addEventListener('click', () => this.batchDeleteUsers());
        document.getElementById('select-all-users')?.addEventListener('change', (e) => this.toggleAllUsers(e.target.checked));

        // 新增：用户名、密码修改模态框事件
        document.getElementById('save-password-btn')?.addEventListener('click', () => this.saveNewPassword());
        document.getElementById('save-rename-user-btn')?.addEventListener('click', () => this.saveRenameUser());

        // 用户配置自定义目录相关事件
        document.getElementById('user-custom-dir-enable-toggle')?.addEventListener('change', (e) => {
            const container = document.getElementById('user-custom-dir-container');
            if (e.target.checked) {
                container?.classList.remove('hidden');
                this.validateUserCustomDirState();
            } else {
                container?.classList.add('hidden');
                this.setUserConfigConfirmBtnState(true);
            }
        });

        document.getElementById('user-custom-dir-input')?.addEventListener('input', () => {
            this.setUserConfigConfirmBtnState(false);
            const statusEl = document.getElementById('user-custom-dir-status');
            if (statusEl) {
                statusEl.textContent = '目录路径已修改，请点击右侧「检测」验证可用性';
                statusEl.style.color = 'var(--text-secondary, #94a3b8)';
            }
        });

        document.getElementById('test-user-custom-dir-btn')?.addEventListener('click', () => this.testUserCustomDir());

        // 绑定所有模态框关闭按钮
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => {
                document.getElementById('edit-password-modal')?.classList.add('hidden');
                document.getElementById('rename-user-modal')?.classList.add('hidden');
                document.getElementById('modal')?.classList.add('hidden');
            });
        });

        document.getElementById('restart-server-btn')?.addEventListener('click', () => {
            this.restartServer()
        })

        // 数据查看
        document.getElementById('refresh-data-btn')?.addEventListener('click', () => this.loadUserData());
        document.getElementById('data-user-select')?.addEventListener('change', () => this.loadUserData());

        // 配置管理
        document.getElementById('config-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveConfig();
        });
        document.getElementById('subsonic-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveSubsonicConfig();
        });
        document.getElementById('reload-config-btn')?.addEventListener('click', async () => {
            const restarting = await this.saveConfig(true);
            if (restarting) return;
            this.loadConfig();
        });
        document.querySelector('input[name="user.enablePublicFavorites"]')?.addEventListener('change', () => {
            this.togglePublicNonAdminAccessVisibility();
        });
        document.querySelector('input[name="user.enablePublicRestriction"]')?.addEventListener('change', () => {
            this.togglePublicNonAdminLocalMusicVisibility();
        });
        document.querySelector('input[name="subsonic.publicLeaderboards"]')?.addEventListener('change', () => {
            this.toggleSubsonicLeaderboardVisibility();
        });
        document.querySelector('input[name="subsonic.localPlaylist"]')?.addEventListener('change', () => {
            this.toggleSubsonicCustomPlaylistVisibility();
        });
        document.querySelector('input[name="webdav.enable"]')?.addEventListener('change', () => {
            this.toggleWebdavVisibility();
        });
        this.initTagSelectors();

        // 日志查看
        document.getElementById('refresh-logs-btn')?.addEventListener('click', () => this.loadLogs());
        document.getElementById('log-type-select')?.addEventListener('change', () => this.loadLogs());
        document.getElementById('logs-auto-refresh-toggle')?.addEventListener('change', (e) => {
            if (e.target.checked) this.startLogsAutoRefresh();
            else this.stopLogsAutoRefresh();
        });

        // 模态框
        document.querySelector('.modal-close')?.addEventListener('click', () => this.closeModal());
        document.getElementById('modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'modal') this.closeModal();
        });
        document.getElementById('data-user-select')?.addEventListener('change', () => this.loadUserData());

        // 快照管理用户选择事件
        // document.getElementById('snapshot-user-select')?.addEventListener('change', () => this.loadSnapshots());
        // WebDAV 和文件管理器
        this.bindWebDAVEvents();
        this.bindFileManagerEvents();

        // PWA 安装事件
        this.deferredPrompt = null;
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            const installBtn = document.getElementById('install-pwa-btn');
            if (installBtn) {
                installBtn.style.display = 'inline-flex';
                installBtn.addEventListener('click', () => this.installPWA());
            }
        });

        // [新增] 绑定上传事件
        document.getElementById('snapshot-upload-input')?.addEventListener('change', (e) => this.handleSnapshotUpload(e));

        // Mobile Menu Events
        this.initMobileEvents();
    }

    initMobileEvents() {
        const mobileMenuBtn = document.getElementById('mobile-menu-btn');
        const mobileSidebarOverlay = document.getElementById('mobile-sidebar-overlay');
        const sidebar = document.querySelector('.sidebar');

        const toggleSidebar = () => {
            sidebar.classList.toggle('active');
            mobileSidebarOverlay.classList.toggle('active');
            if (mobileSidebarOverlay.classList.contains('active')) {
                mobileSidebarOverlay.classList.remove('hidden');
            } else {
                // Wait for animation to finish before hiding
                setTimeout(() => {
                    if (!mobileSidebarOverlay.classList.contains('active')) {
                        mobileSidebarOverlay.classList.add('hidden');
                    }
                }, 300);
            }
        };

        if (mobileMenuBtn) {
            mobileMenuBtn.addEventListener('click', toggleSidebar);
        }

        if (mobileSidebarOverlay) {
            mobileSidebarOverlay.addEventListener('click', toggleSidebar);
        }

        // Close on nav click (mobile only)
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                if (window.innerWidth <= 768 && sidebar && sidebar.classList.contains('active')) {
                    toggleSidebar();
                }
            });
        });
    }

    async installPWA() {
        if (!this.deferredPrompt) return;
        this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;
        console.log(`User response to the install prompt: ${outcome}`);
        this.deferredPrompt = null;
        document.getElementById('install-pwa-btn').style.display = 'none';
    }

    initLoginScreenEffects() {
        if (this._loginEffectsInited) return;
        this._loginEffectsInited = true;

        // 鼠标微光跟随
        const cursorGlow = document.getElementById('admin-cursor-glow');
        if (cursorGlow) {
            window.addEventListener('mousemove', (e) => {
                cursorGlow.style.left = e.clientX + 'px';
                cursorGlow.style.top = e.clientY + 'px';
            });
        }

        // 升腾浮动图标 (服务器/安全/音乐/数据)
        const container = document.getElementById('admin-notes-container');
        if (container) {
            container.innerHTML = '';
            const icons = [
                'fa-server',
                'fa-shield-halved',
                'fa-bolt',
                'fa-music',
                'fa-database',
                'fa-network-wired',
                'fa-cloud',
                'fa-sliders',
                'fa-compact-disc',
                'fa-lock',
                'fa-chart-line',
                'fa-key',
                'fa-wave-square',
                'fa-wifi',
                'fa-headphones'
            ];
            const count = 26;
            for (let i = 0; i < count; i++) {
                const item = document.createElement('i');
                const icon = icons[Math.floor(Math.random() * icons.length)];
                const sizeClass = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl'][Math.floor(Math.random() * 6)];
                item.className = `fas ${icon} admin-floating-note ${sizeClass}`;
                item.style.left = `${Math.random() * 95}%`;

                const duration = 12 + Math.random() * 12;
                const delay = Math.random() * duration;
                item.style.animationDuration = `${duration}s`;
                item.style.animationDelay = `-${delay}s`;
                container.appendChild(item);
            }
        }

        // Canvas 动态星尘微光粒子
        const canvas = document.getElementById('admin-particles-canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            let width = (canvas.width = window.innerWidth);
            let height = (canvas.height = window.innerHeight);

            window.addEventListener('resize', () => {
                width = canvas.width = window.innerWidth;
                height = canvas.height = window.innerHeight;
            });

            const particles = [];
            const particleCount = 28;

            for (let i = 0; i < particleCount; i++) {
                particles.push({
                    x: Math.random() * width,
                    y: Math.random() * height,
                    radius: Math.random() * 2 + 0.8,
                    color: Math.random() > 0.5 ? 'rgba(99, 102, 241, ' : 'rgba(6, 182, 212, ',
                    alpha: Math.random() * 0.45 + 0.1,
                    speedY: Math.random() * 0.4 + 0.15,
                    speedX: (Math.random() - 0.5) * 0.2,
                    pulse: Math.random() * Math.PI,
                });
            }

            const animateParticles = () => {
                if (document.getElementById('login-overlay')?.classList.contains('hidden')) return;
                ctx.clearRect(0, 0, width, height);
                for (const p of particles) {
                    p.y -= p.speedY;
                    p.x += p.speedX;
                    p.pulse += 0.02;

                    if (p.y < -10) {
                        p.y = height + 10;
                        p.x = Math.random() * width;
                    }
                    if (p.x < -10) p.x = width + 10;
                    if (p.x > width + 10) p.x = -10;

                    const currentAlpha = p.alpha * (0.6 + 0.4 * Math.sin(p.pulse));
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                    ctx.fillStyle = p.color + currentAlpha + ')';
                    ctx.shadowBlur = 8;
                    ctx.shadowColor = p.color + '0.5)';
                    ctx.fill();
                }
                requestAnimationFrame(animateParticles);
            };
            animateParticles();
        }

        // 动态设置后台登录卡片标题为配置的服务器名称 (serverName)
        const loginTitleEl = document.getElementById('admin-login-title');
        if (loginTitleEl && window.CONFIG && window.CONFIG.serverName) {
            loginTitleEl.textContent = window.CONFIG.serverName;
        }

        setTimeout(() => {
            document.getElementById('access-password')?.focus();
        }, 150);
    }

    async login() {
        const pwdInput = document.getElementById('access-password');
        const password = pwdInput ? pwdInput.value : '';
        const errorEl = document.getElementById('login-error');
        const errorBox = document.getElementById('login-error-box');
        const card = document.getElementById('admin-login-card');
        const btn = document.getElementById('login-btn');
        const btnText = document.getElementById('login-btn-text');

        const showError = (msg) => {
            if (errorEl) errorEl.textContent = msg;
            if (errorBox) errorBox.classList.remove('hidden');
            if (card) {
                card.classList.remove('shake-active');
                void card.offsetWidth;
                card.classList.add('shake-active');
                setTimeout(() => card.classList.remove('shake-active'), 450);
            }
        };

        if (!password) {
            showError('请输入管理员访问密码');
            pwdInput?.focus();
            return;
        }

        if (errorBox) errorBox.classList.add('hidden');
        if (btn) btn.disabled = true;
        const origIcon = btn?.querySelector('i')?.className || 'fas fa-right-to-bracket text-sm';
        if (btn?.querySelector('i')) btn.querySelector('i').className = 'fas fa-spinner fa-spin text-sm';
        if (btnText) btnText.textContent = '验证凭据中...';

        try {
            const res = await this.request('/api/login', {
                method: 'POST',
                body: JSON.stringify({ password })
            });

            if (res.success) {
                if (btn?.querySelector('i')) btn.querySelector('i').className = 'fas fa-check-circle text-sm';
                if (btnText) btnText.textContent = '验证成功，正在进入...';
                if (btn) {
                    btn.classList.remove('admin-btn-submit');
                    btn.classList.add('bg-emerald-600');
                }

                if (card) {
                    card.style.transform = 'scale(0.95)';
                    card.style.opacity = '0.3';
                }

                this.password = password;
                localStorage.setItem('lx_auth', password);
                setTimeout(() => {
                    this.showApp();
                    this.loadDashboard();
                }, 260);
            } else {
                showError('密码错误，请重新输入');
                if (btn) {
                    btn.disabled = false;
                    if (btn.querySelector('i')) btn.querySelector('i').className = origIcon;
                }
                if (btnText) btnText.textContent = '登录控制台';
                pwdInput?.focus();
            }
        } catch (err) {
            showError('登录失败，请检查服务端连接');
            if (btn) {
                btn.disabled = false;
                if (btn.querySelector('i')) btn.querySelector('i').className = origIcon;
            }
            if (btnText) btnText.textContent = '登录控制台';
            pwdInput?.focus();
        }
    }

    logout() {
        localStorage.removeItem('lx_auth');
        location.reload();
    }

    showApp() {
        document.getElementById('login-overlay').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
    }

    async switchView(viewName) {
        // 兼容旧入口：WebDAV / OpenList / 快照管理已并入「备份管理」，转向对应页签
        const legacyBackupViews = { webdav: 'cloud', openlist: 'cloud', snapshots: 'local' };
        if (legacyBackupViews[viewName]) {
            this._bmPendingTab = legacyBackupViews[viewName];
            viewName = 'backups';
        }
        // 离开备份管理且存在未保存输入时先确认，避免静默丢失
        if (this.currentView === 'backups' && viewName !== 'backups' && this.hasBackupUnsaved()) {
            const leave = await showSelect('有未保存的备份设置', `以下内容尚未保存：${this.backupUnsavedLabels().join('、')}。\n离开后这些修改将被丢弃。`, { danger: true, confirmText: '放弃修改并离开', cancelText: '留在此页' });
            if (!leave) return;
            this.clearBackupDirty();
        }
        // 更新导航状态
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === viewName);
        });

        // 切换视图
        document.querySelectorAll('.view').forEach(view => {
            view.classList.toggle('active', view.id === `view-${viewName}`);
        });

        // 更新标题
        const titles = {
            dashboard: '仪表盘',
            users: '用户管理',
            data: '数据查看',
            config: '系统配置',
            logs: '系统日志',
            backups: '备份管理',
            subsonic: 'Subsonic 配置',
            files: '文件管理',
            about: '关于'
        };
        document.getElementById('page-title').textContent = titles[viewName] || viewName;

        this.currentView = viewName;

        // 加载对应数据
        switch (viewName) {
            case 'dashboard':
                this.loadDashboard();
                break;
            case 'users':
                this.loadUsers();
                break;
            case 'data':
                this.loadUserData();
                break;
            case 'config':
                this.loadConfig();
                break;
            case 'logs':
                this.loadLogs();
                this.startLogsAutoRefresh();
                break;
            case 'subsonic':
                this.loadSubsonicConfig();
                break;
            case 'backups': {
                const targetTab = this._bmPendingTab || this.currentBackupCenterTab || 'overview';
                const targetSub = this._bmPendingSub || '';
                this._bmPendingTab = null;
                this._bmPendingSub = null;
                await this.enterBackupCenter(targetTab, targetSub);
                break;
            }
            case 'about':
                this.loadAbout();
                break;
            case 'files':
                // 跳转到新的 elFinder 文件管理器 (相对路径)
                window.location.href = 'filemanager.html';
                return;
            case 'music':
                window.location.href = (window.CONFIG && window.CONFIG['player.path']) || '/';
                return;
        }

        if (viewName !== 'logs') {
            this.stopLogsAutoRefresh();
        }
        setTimeout(() => this.initCustomSelects(), 50);
    }

    handleQuickAction(action) {
        switch (action) {
            case 'add-user':
                this.switchView('users');
                setTimeout(() => this.showAddUserModal(), 100);
                break;
            case 'view-logs':
                this.switchView('logs');
                break;
            case 'edit-config':
                this.switchView('config');
                break;
        }
    }

    async loadAbout() {
        const container = document.getElementById('about-content');
        if (!container) return;

        try {
            const response = await fetch('about.md');
            if (!response.ok) throw new Error('Failed to load about.md');
            const text = await response.text();

            const version = (window.CONFIG && window.CONFIG.version) || 'v1.0.0';
            const buildHash = (window.CONFIG && window.CONFIG.buildHash) || 'unknown';
            let content = text.replace(/{{version}}/g, version);
            content = content.replace(/{{buildHash}}/g, buildHash);

            const pPath = (window.CONFIG && window.CONFIG['player.path']) ?? '/';
            const targetPPath = String(pPath).trim() === '' ? '/' : String(pPath).trim();
            content = content.replace(/href="\/music"/g, `href="${targetPPath}"`);

            if (content.trim().startsWith('<style') || content.trim().startsWith('<div') || content.trim().startsWith('<')) {
                container.innerHTML = content;
            } else if (window.marked) {
                container.innerHTML = window.marked.parse(content);
            } else {
                container.innerText = content;
            }
        } catch (e) {
            console.error('Failed to load about content:', e);
            container.innerHTML = '<p style="color: var(--accent-error); text-align: center;">加载关于页面失败</p>';
        }
    }

    checkForUpdates() {
        if (window.LxNotification && window.LxNotification.checkUpdates) {
            window.LxNotification.checkUpdates(true);
        } else {
            showInfo('通知服务未就绪，请稍后重试');
        }
    }

    initVersion() {
        if (window.CONFIG && window.CONFIG.version) {
            const versionEl = document.getElementById('console-version');
            if (versionEl) {
                versionEl.textContent = window.CONFIG.version;
                versionEl.classList.remove('hidden');
            }
            const sidebarVersionEl = document.getElementById('sidebar-version');
            if (sidebarVersionEl) {
                sidebarVersionEl.textContent = window.CONFIG.version;
                sidebarVersionEl.classList.remove('hidden');
            }
        }
        if (window.CONFIG && window.CONFIG.serverName) {
            document.title = window.CONFIG.serverName + ' - 管理控制台';
            const loginTitleEl = document.getElementById('admin-login-title');
            if (loginTitleEl) {
                loginTitleEl.textContent = window.CONFIG.serverName;
            }
        }
        // 初始化动态播放器链接 (包括侧边栏和登录面板)
        this.updatePlayerLinks();
    }

    updatePlayerLinks(playerPath) {
        if (playerPath === undefined || playerPath === null) {
            playerPath = (window.CONFIG && window.CONFIG['player.path']) ?? '/';
        }
        let target = String(playerPath).trim();
        if (target === '') target = '/';
        else if (!target.startsWith('/') && !target.startsWith('http://') && !target.startsWith('https://')) {
            target = '/' + target;
        }

        const navPlayerLink = document.getElementById('nav-player-link');
        if (navPlayerLink) navPlayerLink.href = target;

        const loginPlayerLink = document.getElementById('login-player-link');
        if (loginPlayerLink) loginPlayerLink.href = target;

        const aboutPlayerLink = document.querySelector('.about-actions a[href*="music"], .about-actions a.about-btn-primary');
        if (aboutPlayerLink) aboutPlayerLink.href = target;
    }

    async loadDashboard() {
        this.updateGreeting();
        try {
            const status = await this.request('/api/status');

            // 更新顶部概览卡片
            document.getElementById('stat-users').textContent = status.users;
            document.getElementById('stat-devices').textContent = status.devices;
            document.getElementById('stat-cpu').textContent = status.cpuUsage + '%';
            document.getElementById('stat-memory').textContent = this.formatFileSize(status.memory);

            // 实时监控详情
            this.updateMonitorUI(status);

            // 加载用户列表
            const users = await this.request('/api/users');
            this.allUsers = users;
            this.renderAllUserSelectors();

            // 启动定时刷新
            this.startMonitor();

        } catch (err) {
            console.error('Failed to load dashboard:', err);
        }
    }

    updateGreeting() {
        const hour = new Date().getHours();
        let greeting = '你好';
        if (hour < 6) greeting = '深夜好';
        else if (hour < 9) greeting = '早安';
        else if (hour < 12) greeting = '上午好';
        else if (hour < 14) greeting = '中午好';
        else if (hour < 18) greeting = '下午好';
        else if (hour < 22) greeting = '晚上好';
        else greeting = '深夜好';

        const greetingEl = document.getElementById('greeting-text');
        if (greetingEl) greetingEl.textContent = greeting;

        const dateEl = document.getElementById('dashboard-date');
        if (dateEl) {
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            dateEl.textContent = '今天是 ' + new Date().toLocaleDateString('zh-CN', options);
        }
    }

    startMonitor() {
        if (this.monitorTimer) return;
        this.monitorTimer = setInterval(async () => {
            if (this.currentView !== 'dashboard' || !this.password) {
                clearInterval(this.monitorTimer);
                this.monitorTimer = null;
                return;
            }
            try {
                const status = await this.request('/api/status');
                this.updateMonitorUI(status);
            } catch (e) {
                console.error('Monitor refresh failed:', e);
            }
        }, 3000);
    }

    updateMonitorUI(status) {
        // --- CPU 监控 ---
        const sysCpuVal = parseFloat(status.cpuUsage) || 0;
        const procCpuVal = parseFloat(status.processCpuUsage) || 0;

        // 顶部概览
        const statCpu = document.getElementById('stat-cpu');
        const statProcCpu = document.getElementById('stat-process-cpu');
        if (statCpu) statCpu.textContent = sysCpuVal.toFixed(2) + '%';
        if (statProcCpu) statProcCpu.textContent = procCpuVal.toFixed(2) + '%';

        // 详情面板
        const cpuProgress = document.getElementById('monitor-cpu-progress');
        const sysCpuText = document.getElementById('monitor-cpu-val');
        const procCpuText = document.getElementById('monitor-process-cpu-val');
        if (cpuProgress) cpuProgress.style.width = Math.max(sysCpuVal, procCpuVal) + '%';
        if (sysCpuText) sysCpuText.textContent = sysCpuVal.toFixed(2) + '%';
        if (procCpuText) procCpuText.textContent = procCpuVal.toFixed(2) + '%';

        const nowStr = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        this.monitorLabels.push(nowStr);
        this.systemCpuHistory.push(sysCpuVal);
        this.processCpuHistory.push(procCpuVal);
        if (this.systemCpuHistory.length > 20) {
            this.monitorLabels.shift();
            this.systemCpuHistory.shift();
            this.processCpuHistory.shift();
        }
        this.updateChart('cpu', 'cpu-chart-canvas', this.monitorLabels, [
            {
                label: '系统 CPU (%)',
                data: this.systemCpuHistory,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.15)',
                borderWidth: 2,
                pointRadius: 2,
                pointHoverRadius: 5,
                tension: 0.35,
                fill: true
            },
            {
                label: '本服务 CPU (%)',
                data: this.processCpuHistory,
                borderColor: '#c084fc',
                backgroundColor: 'rgba(192, 132, 252, 0.08)',
                borderWidth: 2,
                pointRadius: 2,
                pointHoverRadius: 5,
                tension: 0.35,
                fill: true
            }
        ]);

        // --- 内存监控 ---
        const sysMemVal = parseFloat(status.systemMemoryUsage) || 0;
        const procMemVal = parseFloat(status.processMemoryUsage) || 0;

        // 顶部概览
        const statMemPerc = document.getElementById('stat-memory-percent');
        const statProcMemPerc = document.getElementById('stat-process-memory-percent');
        const statMemAbs = document.getElementById('stat-memory');
        if (statMemPerc) statMemPerc.textContent = sysMemVal.toFixed(2) + '%';
        if (statProcMemPerc) statProcMemPerc.textContent = procMemVal.toFixed(2) + '%';
        if (statMemAbs) {
            const usedBytes = (status.totalMemory || 0) - (status.freeMemory || 0);
            statMemAbs.textContent = `${this.formatFileSize(status.memory || 0)} / 系统已用 ${this.formatFileSize(usedBytes)}`;
        }

        // 详情面板
        const memProgress = document.getElementById('monitor-mem-progress');
        const sysMemText = document.getElementById('monitor-mem-val');
        const procMemText = document.getElementById('monitor-process-mem-val');
        if (memProgress) memProgress.style.width = Math.min(100, Math.max(sysMemVal, procMemVal)) + '%';
        if (sysMemText) sysMemText.textContent = sysMemVal.toFixed(2) + '%';
        if (procMemText) procMemText.textContent = procMemVal.toFixed(2) + '%';

        // 内存面板副标题详细信息
        const memTotalText = document.getElementById('monitor-mem-total-text');
        if (memTotalText && status.totalMemory) {
            const totalMb = (status.totalMemory / 1024 / 1024 / 1024).toFixed(1);
            memTotalText.textContent = `总容量 ${totalMb} GB · 服务占用 ${this.formatFileSize(status.memory || 0)}`;
        }

        this.systemMemHistory.push(sysMemVal);
        this.processMemHistory.push(procMemVal);
        if (this.systemMemHistory.length > 20) {
            this.systemMemHistory.shift();
            this.processMemHistory.shift();
        }
        this.updateChart('mem', 'mem-chart-canvas', this.monitorLabels, [
            {
                label: '系统内存 (%)',
                data: this.systemMemHistory,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                borderWidth: 2,
                pointRadius: 2,
                pointHoverRadius: 5,
                tension: 0.35,
                fill: true
            },
            {
                label: '本服务内存 (%)',
                data: this.processMemHistory,
                borderColor: '#60a5fa',
                backgroundColor: 'rgba(96, 165, 250, 0.08)',
                borderWidth: 2,
                pointRadius: 2,
                pointHoverRadius: 5,
                tension: 0.35,
                fill: true
            }
        ]);

        // --- 状态与概览更新 ---
        const statUsers = document.getElementById('stat-users');
        const statDevices = document.getElementById('stat-devices');
        const statUptime = document.getElementById('stat-uptime');
        if (statUsers) statUsers.textContent = status.users;
        if (statDevices) statDevices.textContent = status.devices;
        if (statUptime) statUptime.textContent = this.formatUptime(status.uptime);

        // 更新硬件详情
        const statCpuInfo = document.getElementById('stat-cpu-info');
        if (statCpuInfo) {
            const speedGhz = (status.cpuSpeed / 1000).toFixed(1);
            statCpuInfo.textContent = `${status.cpus} 核 · 频速 ${speedGhz} GHz`;
        }

        const cpuModelText = document.getElementById('monitor-cpu-model-text');
        if (cpuModelText && status.cpuModel) {
            cpuModelText.textContent = `${status.cpus} Cores @ ${status.cpuModel}`;
        }

        // 更新音源总数与 WebDAV 运行标徽
        const statSourcesInfo = document.getElementById('stat-sources-info');
        if (statSourcesInfo && status.sourcesCount !== undefined) {
            statSourcesInfo.textContent = `已挂载自定义源: ${status.sourcesCount} 个`;
        }

        const webdavPill = document.getElementById('dash-webdav-status-pill');
        if (webdavPill) {
            if (status.isWebDAVConfigured) {
                webdavPill.textContent = 'WebDAV 已就绪';
                webdavPill.style.background = 'rgba(16, 185, 129, 0.15)';
                webdavPill.style.color = '#34d399';
                webdavPill.style.borderColor = 'rgba(16, 185, 129, 0.3)';
            } else {
                webdavPill.textContent = 'WebDAV 未配置';
                webdavPill.style.background = 'rgba(245, 158, 11, 0.15)';
                webdavPill.style.color = '#fbbf24';
                webdavPill.style.borderColor = 'rgba(245, 158, 11, 0.3)';
            }
        }
    }

    updateChart(type, canvasId, labels, datasets) {
        if (typeof Chart === 'undefined') return;
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        let chartInstance = type === 'cpu' ? this.cpuChartInstance : this.memChartInstance;

        // 计算当前数据集合中的最大值，用于自适应纵轴
        let maxVal = 0;
        datasets.forEach(ds => {
            ds.data.forEach(v => {
                if (typeof v === 'number' && v > maxVal) maxVal = v;
            });
        });

        // 动态量程：至少留 20% 余量，最少设为 10%，封顶 100%
        let suggestedMax = Math.min(100, Math.max(10, Math.ceil((maxVal * 1.25) / 5) * 5));

        if (!chartInstance) {
            const ctx = canvas.getContext('2d');
            chartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: [...labels],
                    datasets: datasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    interaction: {
                        intersect: false,
                        mode: 'index'
                    },
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            backgroundColor: 'rgba(15, 23, 42, 0.92)',
                            titleColor: '#e2e8f0',
                            bodyColor: '#cbd5e1',
                            borderColor: 'rgba(255, 255, 255, 0.12)',
                            borderWidth: 1,
                            padding: 10,
                            boxPadding: 4,
                            usePointStyle: true,
                            callbacks: {
                                label: function (context) {
                                    return ` ${context.dataset.label}: ${Number(context.parsed.y).toFixed(2)}%`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            display: true,
                            grid: {
                                color: 'rgba(255, 255, 255, 0.04)',
                                drawBorder: false
                            },
                            ticks: {
                                color: 'rgba(255, 255, 255, 0.35)',
                                font: { size: 10 },
                                maxTicksLimit: 6,
                                maxRotation: 0
                            }
                        },
                        y: {
                            display: true,
                            suggestedMin: 0,
                            suggestedMax: suggestedMax,
                            grid: {
                                color: 'rgba(255, 255, 255, 0.05)',
                                drawBorder: false
                            },
                            ticks: {
                                color: 'rgba(255, 255, 255, 0.4)',
                                font: { size: 10 },
                                callback: function (value) {
                                    return value + '%';
                                },
                                maxTicksLimit: 5
                            }
                        }
                    }
                }
            });

            if (type === 'cpu') this.cpuChartInstance = chartInstance;
            else this.memChartInstance = chartInstance;
        } else {
            chartInstance.data.labels = [...labels];
            datasets.forEach((ds, i) => {
                if (chartInstance.data.datasets[i]) {
                    chartInstance.data.datasets[i].data = [...ds.data];
                }
            });
            // 动态调节刻度范围
            chartInstance.options.scales.y.suggestedMax = suggestedMax;
            chartInstance.update('none'); // 无多余全量动画，保持平滑高频刷新
        }
    }


    renderAllUserSelectors() {
        this.renderUserDropdown('data');
        this.renderUserDropdown('snapshot');

        // 如果当前没有选择用户，在内容区展示选择网格
        if (!document.getElementById('data-user-select').value) {
            this.renderUserSelectionGrid('data');
        }
        if (!document.getElementById('snapshot-user-select').value) {
            this.renderUserSelectionGrid('snapshot');
        }
    }

    toggleUserDropdown(type) {
        const selector = document.getElementById(`${type}-user-selector`);
        const dropdown = document.getElementById(`${type}-user-dropdown`);
        const isOpen = !dropdown.classList.contains('hidden');

        // 关闭所有其他的
        document.querySelectorAll('.selector-dropdown').forEach(d => d.classList.add('hidden'));
        document.querySelectorAll('.custom-user-selector').forEach(s => s.classList.remove('open'));

        if (!isOpen) {
            dropdown.classList.remove('hidden');
            selector.classList.add('open');
        }
    }

    renderUserDropdown(type) {
        const dropdown = document.getElementById(`${type}-user-dropdown`);
        if (!dropdown || !this.allUsers) return;

        const currentSelected = document.getElementById(`${type}-user-select`).value;

        dropdown.innerHTML = this.allUsers.map(user => {
            const isPublic = user.name === '_open';
            const displayName = isPublic ? '公开用户 (_open)' : this.escapeHtml(user.name);
            const avatarChar = isPublic ? '🌐' : this.escapeHtml(user.name.charAt(0).toUpperCase());
            const avatarStyle = isPublic ? 'background: linear-gradient(135deg, #10b981, #059669); font-size:12px;' : '';
            return `
            <div class="dropdown-item ${user.name === currentSelected ? 'active' : ''}"
                 onclick="app.selectUser('${type}', '${this.escapeHtml(user.name)}')">
                <div class="dropdown-avatar" style="${avatarStyle}">${avatarChar}</div>
                <span>${displayName}</span>
                ${user.name === currentSelected ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:14px;height:14px;margin-left:auto;"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
            </div>
        `}).join('');
    }

    renderUserSelectionGrid(type) {
        const container = type === 'data' ? document.getElementById('data-content') : document.getElementById('snapshots-list');
        if (!container || !this.allUsers) return;

        // 特殊处理：如果是数据查看视图，且没有选择用户，stats 区域也需要清空
        if (type === 'data') {
            document.getElementById('data-stats').innerHTML = '';
            const tabs = document.getElementById('data-tabs-container');
            if (tabs) tabs.classList.add('hidden');
        }

        const totalCount = this.allUsers.length;
        const hintTitle = type === 'data' ? '选择用户以查看歌单与数据' : '选择用户以管理快照备份';
        container.innerHTML = `
            <div class="user-selection-header fade-in">
                <div class="user-select-hint">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="16" x2="12" y2="12"/>
                        <line x1="12" y1="8" x2="12.01" y2="8"/>
                    </svg>
                    <span>${hintTitle}（共 ${totalCount} 位用户）</span>
                </div>
            </div>
            <div class="user-selection-grid fade-in">
                ${this.allUsers.map(user => {
            const isPublic = user.name === '_open';
            const displayName = isPublic ? '公开用户 (_open)' : this.escapeHtml(user.name);
            const roleText = isPublic ? '公共数据与歌单' : '用户数据';
            const avatarStyle = isPublic ? 'background: linear-gradient(135deg, #10b981, #059669); font-size: 1.5rem;' : '';
            const avatarHtml = isPublic ? '🌐' : this.escapeHtml(user.name.charAt(0).toUpperCase());
            return `
                    <div class="user-select-card" onclick="app.selectUser('${type}', '${this.escapeHtml(user.name)}')">
                        <div class="avatar" style="${avatarStyle}">${avatarHtml}</div>
                        <div class="name">${displayName}</div>
                        <div class="role">${roleText}</div>
                    </div>
                `}).join('')}
            </div>
        `;
    }

    selectUser(type, username) {
        const input = document.getElementById(`${type}-user-select`);
        const title = document.querySelector(`#${type}-user-selector .selected-username`);

        input.value = username;
        title.textContent = username === '_open' ? '公开用户 (_open)' : username;

        // 关闭下拉
        document.getElementById(`${type}-user-dropdown`).classList.add('hidden');
        document.getElementById(`${type}-user-selector`).classList.remove('open');

        // 刷新下拉列表显示状态
        this.renderUserDropdown(type);

        // 加载数据
        if (type === 'data') {
            this.loadUserData();
        } else {
            this.loadSnapshots();
        }
    }

    async loadUsers() {
        try {
            const users = await this.request('/api/users');
            this.users = users.filter(u => u.name !== '_open');
            this.renderUsers();
        } catch (err) {
            console.error('Failed to load users:', err);
        }
    }

    async batchDeleteUsers() {
        const checked = document.querySelectorAll('.user-checkbox:checked');
        // 使用 data-index 获取对应的用户对象
        const names = Array.from(checked).map(cb => {
            const index = parseInt(cb.dataset.index);
            return this.users[index]?.name;
        }).filter(name => name); // 过滤掉无效的 name

        if (!names.length) return;

        // 显示自定义确认对话框
        const deleteData = await this.showBatchDeleteUserDialog(names.length);
        if (deleteData === null) return; // 用户取消

        try {
            await this.request('/api/users', {
                method: 'DELETE',
                body: JSON.stringify({ names, deleteData })
            });
            this.loadUsers();
            showSuccess('批量删除成功');
        } catch (err) {
            showError('删除失败: ' + err.message);
        }
    }

    // 显示批量删除用户确认对话框
    async showBatchDeleteUserDialog(count) {
        return new Promise((resolve) => {
            const modal = document.getElementById('modal');
            const modalTitle = document.getElementById('modal-title');
            const modalBody = document.getElementById('modal-body');

            modalTitle.textContent = '批量删除用户确认';
            modalBody.innerHTML = `
                <div style="padding: 1rem 0;">
                    <p style="margin-bottom: 1rem; font-size: 1rem;">确定要删除选中的 <strong>${count}</strong> 个用户吗？</p>
                    <div class="form-group" style="margin-top: 1.5rem;">
                        <label class="checkbox-label" style="display: flex; align-items: center; cursor: pointer;">
                            <input type="checkbox" id="batch-delete-user-data-checkbox" style="margin-right: 0.5rem;">
                            <span>同时删除用户数据及音源文件</span>
                        </label>
                        <small style="color: var(--text-secondary); display: block; margin-top: 0.5rem; margin-left: 1.5rem;">
                            ⚠️ 勾选后将永久删除所有选中用户的数据（歌单、收藏、音源脚本及配置等），不可恢复！
                        </small>
                    </div>
                </div>
                <div class="form-actions" style="margin-top: 1.5rem;">
                    <button type="button" class="btn-primary" id="confirm-batch-delete-users">确认删除</button>
                    <button type="button" class="btn-secondary" id="cancel-batch-delete-users">取消</button>
                </div>
            `;

            modal.classList.remove('hidden');

            document.getElementById('confirm-batch-delete-users').addEventListener('click', () => {
                const deleteData = document.getElementById('batch-delete-user-data-checkbox').checked;
                modal.classList.add('hidden');
                resolve(deleteData);
            });

            document.getElementById('cancel-batch-delete-users').addEventListener('click', () => {
                modal.classList.add('hidden');
                resolve(null);
            });
        });
    }
    // 全选/取消全选用户
    toggleAllUsers(checked) {
        const checkboxes = document.querySelectorAll('.user-checkbox');
        checkboxes.forEach(cb => {
            cb.checked = checked;
        });
        this.updateUserBatchBtn();
    }

    // 更新批量删除按钮状态
    updateUserBatchBtn() {
        const checked = document.querySelectorAll('.user-checkbox:checked');
        const btn = document.getElementById('batch-delete-users-btn');
        const countSpan = document.getElementById('user-selected-count');

        if (btn && countSpan) {
            if (checked.length > 0) {
                btn.style.display = 'inline-flex';
                countSpan.textContent = checked.length;
            } else {
                btn.style.display = 'none';
            }
        }

        // 更新全选框状态（如果手动取消了某个子项，全选框也应取消）
        const selectAll = document.getElementById('select-all-users');
        if (selectAll) {
            const allCheckboxes = document.querySelectorAll('.user-checkbox');
            if (allCheckboxes.length > 0) {
                selectAll.checked = checked.length === allCheckboxes.length;
            } else {
                selectAll.checked = false;
            }
        }
    }
    renderUsers() {
        const container = document.getElementById('users-list');
        if (!this.users.length) {
            container.innerHTML = `
                <div class="glass" style="padding: 3rem; text-align: center; width: 100%;">
                    <p style="color: var(--text-secondary);">暂无用户，点击上方按钮添加用户</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.users.map((user, index) => `
            <div class="user-row glass">
                <div class="col-checkbox">
                    <input type="checkbox" class="user-checkbox" data-index="${index}" onchange="app.updateUserBatchBtn()">
                </div>
                <div class="col-name">
                    <span class="user-online-dot ${user.online ? 'online' : 'offline'}" title="${user.online ? `同步连接：在线 (${user.onlineDevices} 台设备)` : '同步连接：离线'}"></span>
                    <div class="user-avatar" style="background-color: ${stringToColor(user.name)}">
                        <span>${this.escapeHtml(user.name.charAt(0).toUpperCase())}</span>
                    </div>
                    <span class="user-name-text">${this.escapeHtml(user.name)}</span>
                    <button class="btn-icon" onclick="app.showRenameUserModal(${index})" title="重命名用户" style="margin-left: 8px;">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                </div>
                <div class="col-password">
                    <span class="password-text" id="pwd-text-${index}">******</span>
                    <button class="btn-icon" onclick="app.togglePasswordVisibility(${index})" title="显示/隐藏">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                    </button>
                    <button class="btn-icon" onclick="app.showEditPasswordModal(${index})" title="修改密码">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                </div>
                <div class="col-status">
                    <span class="status-badge ${user.disabled ? 'disabled' : 'active'}">${user.disabled ? '已禁用' : '活跃'}</span>
                </div>
                <div class="col-actions">
                    <button class="btn-delete" onclick="app.deleteUser(${index})" title="删除用户">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');

        // 重置全选状态
        const selectAll = document.getElementById('select-all-users');
        if (selectAll) selectAll.checked = false;
        this.updateUserBatchBtn();
    }

    filterUsers() {
        const query = document.getElementById('user-search-input').value.toLowerCase().trim();
        const rows = document.querySelectorAll('#users-list .user-row');

        rows.forEach(row => {
            const userName = row.querySelector('.col-name').textContent.toLowerCase();
            if (userName.includes(query)) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    }

    showAddUserModal() {
        const modal = document.getElementById('modal');
        const modalTitle = document.getElementById('modal-title');
        const modalBody = document.getElementById('modal-body');

        modalTitle.textContent = '添加用户';
        modalBody.innerHTML = `
            <form id="add-user-form" autocomplete="off">
                <div class="form-group">
                    <label>用户名</label>
                    <input type="text" name="name" class="form-input" autocomplete="off" required />
                </div>
                <div class="form-group">
                    <label>密码</label>
                    <input type="password" name="password" class="form-input" autocomplete="new-password" required />
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn-primary">添加</button>
                    <button type="button" class="btn-secondary" onclick="app.closeModal()">取消</button>
                </div>
            </form>
        `;

        modal.classList.remove('hidden');

        document.getElementById('add-user-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData);

            try {
                await this.request('/api/users', {
                    method: 'POST',
                    body: JSON.stringify(data)
                });
                this.closeModal();
                this.loadUsers();
                this.loadDashboard();
            } catch (err) {
                showError('添加用户失败: ' + err.message);
            }
        });
    }

    // 切换密码显示/隐藏
    togglePasswordVisibility(index) {
        const user = this.users[index];
        if (!user) return;

        const el = document.getElementById(`pwd-text-${index}`);
        if (el.textContent === '******') {
            el.textContent = user.password;
        } else {
            el.textContent = '******';
        }
    }

    // 显示修改密码模态框
    showEditPasswordModal(index) {
        const user = this.users[index];
        if (!user) return;

        this.editingUser = user.name; // 保存当前正在编辑的用户名
        document.getElementById('edit-password-input').value = '';
        document.getElementById('edit-password-modal').classList.remove('hidden');
    }

    // 保存新密码
    async saveNewPassword() {
        const newPassword = document.getElementById('edit-password-input').value;
        if (!newPassword) {
            showInfo('请填写新密码');
            return;
        }

        try {
            await this.request('/api/users', {
                method: 'PUT',
                body: JSON.stringify({
                    name: this.editingUser,
                    password: newPassword
                })
            });

            document.getElementById('edit-password-modal').classList.add('hidden');
            this.loadUsers();
            showSuccess('密码修改成功');
        } catch (err) {
            showError('修改失败: ' + err.message);
        }
    }

    async deleteUser(index) {
        const user = this.users[index];
        if (!user) return;
        const username = user.name;

        // 显示自定义确认对话框
        const deleteData = await this.showDeleteUserDialog(username);
        if (deleteData === null) return; // 用户取消

        try {
            await this.request('/api/users', {
                method: 'DELETE',
                body: JSON.stringify({ name: username, deleteData })
            });
            this.loadUsers();
            this.loadDashboard();
        } catch (err) {
            showError('删除用户失败: ' + err.message);
        }
    }

    // 显示删除用户确认对话框
    async showDeleteUserDialog(username) {
        return new Promise((resolve) => {
            const modal = document.getElementById('modal');
            const modalTitle = document.getElementById('modal-title');
            const modalBody = document.getElementById('modal-body');

            modalTitle.textContent = '删除用户确认';
            modalBody.innerHTML = `
                <div style="padding: 1rem 0;">
                    <p style="margin-bottom: 1rem; font-size: 1rem;">确定要删除用户 <strong>"${this.escapeHtml(username)}"</strong> 吗？</p>
                    <div class="form-group" style="margin-top: 1.5rem;">
                        <label class="checkbox-label" style="display: flex; align-items: center; cursor: pointer;">
                            <input type="checkbox" id="delete-user-data-checkbox" style="margin-right: 0.5rem;">
                            <span>同时删除用户数据及音源文件</span>
                        </label>
                        <small style="color: var(--text-secondary); display: block; margin-top: 0.5rem; margin-left: 1.5rem;">
                            ⚠️ 勾选后将永久删除该用户的所有数据（歌单、收藏、音源脚本及配置等），不可恢复！
                        </small>
                    </div>
                </div>
                <div class="form-actions" style="margin-top: 1.5rem;">
                    <button type="button" class="btn-primary" id="confirm-delete-user">确认删除</button>
                    <button type="button" class="btn-secondary" id="cancel-delete-user">取消</button>
                </div>
            `;

            modal.classList.remove('hidden');

            document.getElementById('confirm-delete-user').addEventListener('click', () => {
                const deleteData = document.getElementById('delete-user-data-checkbox').checked;
                modal.classList.add('hidden');
                resolve(deleteData);
            });

            document.getElementById('cancel-delete-user').addEventListener('click', () => {
                modal.classList.add('hidden');
                resolve(null);
            });
        });
    }

    // 设置用户配置确定按钮禁用状态
    setUserConfigConfirmBtnState(enabled) {
        const btn = document.getElementById('save-rename-user-btn');
        if (btn) {
            btn.disabled = !enabled;
            btn.style.opacity = enabled ? '1' : '0.5';
            btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
        }
    }

    validateUserCustomDirState() {
        const toggle = document.getElementById('user-custom-dir-enable-toggle');
        const input = document.getElementById('user-custom-dir-input');
        if (toggle && toggle.checked) {
            // 如果开启了自定义目录，初始判断需包含有效的验证
            if (!input || !input.value.trim()) {
                this.setUserConfigConfirmBtnState(false);
                const statusEl = document.getElementById('user-custom-dir-status');
                if (statusEl) {
                    statusEl.textContent = '请输入自定义歌曲目录地址';
                    statusEl.style.color = '#ef4444';
                }
            } else {
                // 如果已有固定目录，建议先检测或设为需要检测
                this.setUserConfigConfirmBtnState(false);
                const statusEl = document.getElementById('user-custom-dir-status');
                if (statusEl) {
                    statusEl.textContent = '请点击右侧「检测」按钮进行可用性验证';
                    statusEl.style.color = 'var(--text-secondary, #94a3b8)';
                }
            }
        } else {
            this.setUserConfigConfirmBtnState(true);
            const statusEl = document.getElementById('user-custom-dir-status');
            if (statusEl) statusEl.textContent = '';
        }
    }

    async testUserCustomDir() {
        const dirInput = document.getElementById('user-custom-dir-input');
        const statusEl = document.getElementById('user-custom-dir-status');
        const dirPath = dirInput ? dirInput.value.trim() : '';

        if (!dirPath) {
            if (statusEl) {
                statusEl.textContent = '请输入自定义歌曲目录地址';
                statusEl.style.color = '#ef4444';
            }
            this.setUserConfigConfirmBtnState(false);
            return;
        }

        if (statusEl) {
            statusEl.textContent = '正在检测目录可用性...';
            statusEl.style.color = '#38bdf8';
        }

        try {
            const res = await this.request('/api/utils/check-dir', {
                method: 'POST',
                body: JSON.stringify({ dirPath })
            });

            if (res && res.success) {
                if (statusEl) {
                    statusEl.textContent = `✓ 目录可用 (${res.path || dirPath})`;
                    statusEl.style.color = '#10b981';
                }
                this.setUserConfigConfirmBtnState(true);
            } else {
                if (statusEl) {
                    statusEl.textContent = `✕ ${res?.message || '目录不可用'}`;
                    statusEl.style.color = '#ef4444';
                }
                this.setUserConfigConfirmBtnState(false);
            }
        } catch (err) {
            if (statusEl) {
                statusEl.textContent = `✕ 检测失败: ${err.message}`;
                statusEl.style.color = '#ef4444';
            }
            this.setUserConfigConfirmBtnState(false);
        }
    }

    // 显示用户配置模态框
    showRenameUserModal(index) {
        const user = this.users[index];
        if (!user) return;

        this.editingUser = user.name;
        document.getElementById('rename-user-input').value = user.name;

        const toggle = document.getElementById('user-custom-dir-enable-toggle');
        const container = document.getElementById('user-custom-dir-container');
        const dirInput = document.getElementById('user-custom-dir-input');
        const operateToggle = document.getElementById('user-custom-dir-operate-toggle');
        const writeToggle = document.getElementById('user-custom-dir-write-toggle');
        const statusEl = document.getElementById('user-custom-dir-status');
        const autoDownloadToggle = document.getElementById('user-auto-download-toggle');
        const disabledToggle = document.getElementById('user-disabled-toggle');

        if (toggle) toggle.checked = user.enableCustomMusicDir === true;
        if (dirInput) dirInput.value = user.customMusicDir || '';
        if (operateToggle) operateToggle.checked = user.allowOperateCustomMusicDir === true;
        if (writeToggle) writeToggle.checked = user.allowWriteCustomMusicDir === true;
        if (autoDownloadToggle) autoDownloadToggle.checked = user.enableAutoDownload === true;
        if (disabledToggle) disabledToggle.checked = user.disabled === true;
        if (statusEl) statusEl.textContent = '';

        if (user.enableCustomMusicDir) {
            container?.classList.remove('hidden');
            // 已保存的正常状态默认允许提交，若修改过则需要重新检测
            this.setUserConfigConfirmBtnState(true);
        } else {
            container?.classList.add('hidden');
            this.setUserConfigConfirmBtnState(true);
        }

        document.getElementById('rename-user-modal').classList.remove('hidden');
    }

    // 保存用户配置
    async saveRenameUser() {
        const newName = document.getElementById('rename-user-input').value.trim();
        const enableCustomDir = document.getElementById('user-custom-dir-enable-toggle')?.checked || false;
        const customDir = document.getElementById('user-custom-dir-input')?.value.trim() || '';
        const allowOperateCustomDir = document.getElementById('user-custom-dir-operate-toggle')?.checked || false;
        const allowWriteCustomDir = document.getElementById('user-custom-dir-write-toggle')?.checked || false;
        const enableAutoDownload = document.getElementById('user-auto-download-toggle')?.checked || false;
        const disabled = document.getElementById('user-disabled-toggle')?.checked || false;

        if (!newName) {
            showInfo('请填写用户名');
            return;
        }

        try {
            const bodyData = {
                name: this.editingUser,
                enableCustomMusicDir: enableCustomDir,
                customMusicDir: customDir,
                allowOperateCustomMusicDir: allowOperateCustomDir,
                allowWriteCustomMusicDir: allowWriteCustomDir,
                enableAutoDownload: enableAutoDownload,
                disabled: disabled,
            };
            if (newName !== this.editingUser) {
                bodyData.newName = newName;
            }

            await this.request('/api/users', {
                method: 'PUT',
                body: JSON.stringify(bodyData)
            });

            document.getElementById('rename-user-modal').classList.add('hidden');
            this.loadUsers();
            this.loadDashboard();
            showSuccess(newName !== this.editingUser ? '用户配置及名称修改成功' : '用户配置更新成功');
        } catch (err) {
            showError('保存失败: ' + err.message);
        }
    }

    currentUserData = null;
    currentPlaylistView = null;
    currentAlbumView = null;
    currentDataTab = 'all';

    getSourceLabel(source) {
        const map = {
            'tx': 'QQ音乐',
            'wy': '网易云',
            'kw': '酷我',
            'kg': '酷狗',
            'mg': '咪咕',
            'local': '本地'
        };
        return map[source] || source || '';
    }

    async loadUserData() {
        const requestId = this._dataRequestId = (this._dataRequestId || 0) + 1;
        const username = document.getElementById('data-user-select')?.value;
        const statsContainer = document.getElementById('data-stats');
        const contentContainer = document.getElementById('data-content');

        if (!username) {
            this.renderUserSelectionGrid('data');
            return;
        }

        // 添加加载状态
        statsContainer.classList.add('content-loading');
        contentContainer.classList.add('content-loading');

        try {
            const data = await this.request(`/api/data?user=${encodeURIComponent(username)}`);
            if (this._dataRequestId !== requestId || document.getElementById('data-user-select')?.value !== username) return;
            if (this.currentUserData?.username !== username) this._dislikeFilters = {}, this._ratingFilters = {};
            this.currentUserData = { username, data };

            // 统计数据
            let totalSongs = 0;
            const defaultCount = data.defaultList?.length || 0;
            const loveCount = data.loveList?.length || 0;
            const userListCount = data.userList?.length || 0;
            const albumsCount = data.albums?.length || 0;
            const artistsCount = data.artists?.length || 0;

            data.userList?.forEach(list => {
                totalSongs += list.list?.length || 0;
            });
            totalSongs += defaultCount + loveCount;

            document.getElementById('data-stats').innerHTML = `
                <div class="data-stat-card clickable" onclick="app.viewAllSongs()" title="点击查看全部歌曲">
                    <div class="stat-card-header">
                        <h4>总歌曲数</h4>
                        <span class="stat-card-icon">🎵</span>
                    </div>
                    <div class="value">${totalSongs}</div>
                </div>
                <div class="data-stat-card clickable" onclick="app.viewSystemList('default')" title="点击查看试听列表">
                    <div class="stat-card-header">
                        <h4>试听列表</h4>
                        <span class="stat-card-icon">🎧</span>
                    </div>
                    <div class="value">${defaultCount}</div>
                </div>
                <div class="data-stat-card clickable" onclick="app.viewSystemList('love')" title="点击查看我的收藏歌曲">
                    <div class="stat-card-header">
                        <h4>我的收藏</h4>
                        <span class="stat-card-icon">❤️</span>
                    </div>
                    <div class="value">${loveCount}</div>
                </div>
                <div class="data-stat-card clickable ${this.currentDataTab === 'playlists' ? 'active-tab' : ''}" onclick="app.setDataTab('playlists')" title="点击查看播放列表">
                    <div class="stat-card-header">
                        <h4>播放列表</h4>
                        <span class="stat-card-icon">📑</span>
                    </div>
                    <div class="value">${userListCount}</div>
                </div>
                <div class="data-stat-card clickable ${this.currentDataTab === 'albums' ? 'active-tab' : ''}" onclick="app.setDataTab('albums')" title="点击查看收藏专辑">
                    <div class="stat-card-header">
                        <h4>收藏专辑</h4>
                        <span class="stat-card-icon">💿</span>
                    </div>
                    <div class="value">${albumsCount}</div>
                </div>
                <div class="data-stat-card clickable ${this.currentDataTab === 'artists' ? 'active-tab' : ''}" onclick="app.setDataTab('artists')" title="点击查看收藏歌手">
                    <div class="stat-card-header">
                        <h4>收藏歌手</h4>
                        <span class="stat-card-icon">🎤</span>
                    </div>
                    <div class="value">${artistsCount}</div>
                </div>
            `;

            const dislikeCount = this.getDislikeEntries(data).length;
            statsContainer.insertAdjacentHTML('beforeend', `<div class="data-stat-card clickable" onclick="app.setDataTab('dislikes')"><div class="stat-card-header"><h4>不喜欢</h4><span class="stat-card-icon">⊘</span></div><div class="value">${dislikeCount}</div></div>`);
            const ratingBadge = document.getElementById('tab-count-ratings');
            if (ratingBadge) ratingBadge.textContent = (data.ratingItems || []).length;
            const dislikeBadge = document.getElementById('tab-count-dislikes');
            if (dislikeBadge) dislikeBadge.textContent = dislikeCount;
            // 更新 Tabs 徽章与显示状态
            const tabsContainer = document.getElementById('data-tabs-container');
            if (tabsContainer) {
                tabsContainer.classList.remove('hidden');
                const pCount = document.getElementById('tab-count-playlists');
                const aCount = document.getElementById('tab-count-albums');
                const arCount = document.getElementById('tab-count-artists');
                if (pCount) pCount.textContent = userListCount;
                if (aCount) aCount.textContent = albumsCount;
                if (arCount) arCount.textContent = artistsCount;
            }

            this.renderCurrentDataTab();

            // 移除加载状态并添加淡入动画
            statsContainer.classList.remove('content-loading');
            contentContainer.classList.remove('content-loading');
            statsContainer.classList.add('fade-in');
            contentContainer.classList.add('fade-in');

            // 动画完成后移除类，以便下次触发
            setTimeout(() => {
                statsContainer.classList.remove('fade-in');
                contentContainer.classList.remove('fade-in');
            }, 400);

        } catch (err) {
            if (this._dataRequestId !== requestId) return;
            statsContainer.classList.remove('content-loading');
            contentContainer.classList.remove('content-loading');
            contentContainer.innerHTML = '<p style="color: var(--accent-error); padding: 2rem; text-align: center;">加载数据失败</p>';
        } finally {
            applyMarqueeChecks();
        }
    }

    setDataTab(tab) {
        this.currentDataTab = tab;
        this.currentPlaylistView = null;
        this.currentAlbumView = null;

        // 更新 tabs 导航按钮高亮
        document.querySelectorAll('.data-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        // 更新顶部卡片的高亮
        document.querySelectorAll('.data-stat-card').forEach(card => card.classList.remove('active-tab'));

        const tabsContainer = document.getElementById('data-tabs-container');
        if (tabsContainer) tabsContainer.classList.remove('hidden');

        this.renderCurrentDataTab();
    }

    renderPlaylists() {
        this.renderCurrentDataTab();
    }

    renderCurrentDataTab() {
        const data = this.currentUserData?.data;
        const contentContainer = document.getElementById('data-content');
        if (!data || !contentContainer) return;

        this.currentPlaylistView = null;
        this.currentAlbumView = null;

        const tabsContainer = document.getElementById('data-tabs-container');
        if (tabsContainer) tabsContainer.classList.remove('hidden');

        let html = '';
        const tab = this.currentDataTab || 'all';

        if (tab === 'all' || tab === 'playlists') {
            html += this.getPlaylistsSectionHtml(data.userList || [], tab === 'all');
        }

        if (tab === 'all' || tab === 'albums') {
            html += this.getAlbumsSectionHtml(data.albums || [], tab === 'all' && tab !== 'albums');
        }

        if (tab === 'all' || tab === 'artists') {
            html += this.getArtistsSectionHtml(data.artists || [], tab === 'all');
        }

        if (tab === 'all' || tab === 'ratings') html += this.getRatingSectionHtml(data);
        if (tab === 'all' || tab === 'dislikes') html += this.getDislikeSectionHtml(data);
        contentContainer.innerHTML = html;
        this.initCustomSelects();
        applyMarqueeChecks();
    }

    dislikeOriginLabel(channel) {
        return ({ web: 'Web 添加', 'subsonic-rating': 'Subsonic 低分联动', 'web-rating-link': 'Web 低分联动', 'manual-rating-to-dislike': '手动评分联动', 'snapshot-restore': '评分恢复', unknown: '来源未记录' })[channel] || (channel ? `其他：${channel}` : '来源未记录');
    }

    adminPlatformOptions(items, selected, allLabel) {
        const e = value => this.escapeHtml(String(value));
        const platforms = [...new Set(['wy', 'tx', 'kw', 'kg', 'mg', 'local', ...items.map(x => x.source || '*')])].filter(source => source !== 'bd');
        const label = code => code === 'local' ? '本地音乐' : code === '*' ? '未指定平台' : this.getSourceLabel(code);
        return `<option value="">${allLabel}</option>` + platforms.map(code => `<option value="${e(code)}" ${selected === code ? 'selected' : ''}>${e(label(code))}（${items.filter(x => (x.source || '*') === code).length}）</option>`).join('');
    }

    adminExtraFilters(section, filters) {
        const handler = section === 'rating' ? 'filterRatingData' : 'filterDislikeData';
        const select = (key, label, options) => `<label class="admin-filter-field"><span>${label}</span><select class="form-input" aria-label="${label}" onchange="app.${handler}('${key}',this.value)">${options.map(([value,text]) => `<option value="${value}" ${(filters[key] || '') === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label>`;
        return `<div class="admin-extra-filters">
            ${select('cover','封面资料',[['','全部封面状态'],['yes','有封面'],['no','缺少封面']])}
            ${select('period','记录时间',[['','不限时间'],['7','最近7天'],['30','最近30天'],['90','最近90天'],['unknown','未记录时间']])}
            ${select('pageSize','每页条数',[['','默认条数'],['24','24条'],['48','48条'],['96','96条']])}
            <button type="button" class="btn-secondary" onclick="app.exportAdminRecords('${section}')">导出筛选结果</button>
            <button type="button" class="btn-secondary admin-filter-reset" onclick="app.resetAdminFilters('${section}')">重置筛选</button>
        </div>`;
    }

    adminMatchesExtra(filters, cover, time, text) {
        if (filters.cover && (filters.cover === 'yes') !== !!cover) return false;
        if (filters.period === 'unknown' ? !!time : filters.period && (!time || time < Date.now() - Number(filters.period) * 86400000)) return false;
        const terms = String(filters.query || '').normalize('NFKC').trim().toLowerCase().split(/\s+/).filter(Boolean);
        const haystack = String(text).normalize('NFKC').toLowerCase();
        return terms.every(term => haystack.includes(term));
    }

    adminPageSize(filters, fallback) {
        const value = Number(filters.pageSize);
        return [24,48,96].includes(value) ? value : fallback;
    }

    exportAdminRecords(section) {
        const data = this.currentUserData?.data || {};
        const rows = section === 'rating' ? this.getFilteredRatingRows(data.ratingItems || []) : this.getFilteredDislikeRows(this.getDislikeEntries(data)).map(({ x, r }) => ({ kind: x.kind, name: x.title, singer: x.singer, source: x.source, rule: x.rule, rating: r.rating, provenance: x.raw.provenance, reasons: x.raw.reasons }));
        const url = URL.createObjectURL(new Blob([JSON.stringify({ user: this.currentUserData?.username, exportedAt: new Date().toISOString(), count: rows.length, records: rows }, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = section === 'rating' ? 'filtered-ratings.json' : 'filtered-dislikes.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    resetAdminFilters(section) {
        const rating = section === 'rating';
        if (rating) this._ratingFilters = {};
        else this._dislikeFilters = { view: this._dislikeFilters?.view };
        const node = document.querySelector(rating ? '.admin-ratings' : '.admin-dislikes:not(.admin-ratings)');
        if (node) node.outerHTML = rating ? this.getRatingSectionHtml(this.currentUserData?.data || {}) : this.getDislikeSectionHtml(this.currentUserData?.data || {});
        this.initCustomSelects();
    }

    getDislikeEntries(data) {
        const entries = new Map();
        const add = (raw, kind, library = false) => {
            const rule = String(raw.dislikeRule || '');
            const split = rule.lastIndexOf('@');
            const title = raw.name || raw.albumName || (kind === 'album' ? rule.slice(1, split < 0 ? undefined : split) : kind === 'artist' ? raw.singer || rule.slice(1) : rule.slice(0, split < 0 ? undefined : split)) || '未命名规则';
            const singer = raw.singer || raw.artistName || (split >= 0 ? rule.slice(split + 1) : '');
            const source = raw.source || '';
            const key = `${kind}|${source}|${rule || (kind === 'album' ? `!${title}@${singer}` : kind === 'artist' ? `@${title}` : `${title}@${singer}`)}`.normalize('NFKC').toLowerCase().replace(/\s*([()@])\s*/g, '$1');
            const image = raw.img || raw.pic || raw.picUrl || raw.cover || raw.meta?.picUrl || '';
            const cover = typeof image === 'string' && (/^https?:\/\//i.test(image) || /^\/(?!\/)/.test(image)) ? image : '';
            const item = { kind, title, singer, source, cover, rule, raw, library, channel: raw.provenance?.channel || 'unknown' };
            if (!entries.has(key)) entries.set(key, item);
            else { const prior = entries.get(key); if (!prior.cover) prior.cover = cover; prior.libraryData = raw; }
        };
        for (const row of data.dislikeList || []) {
            const rule = String(row.dislikeRule || '');
            add(row, rule.startsWith('!') ? 'album' : rule.startsWith('@') || (!row.name && row.singer) ? 'artist' : 'song');
        }
        for (const row of data.dislikeAlbums || []) add(row, 'album', true);
        for (const row of data.dislikeArtists || []) add(row, 'artist', true);
        return [...entries.values()];
    }

    getDislikeRating(x, data) {
        const raw = x.raw;
        const id = raw.id || raw.songmid || raw.meta?.songId || '';
        const keys = [id, `${x.source}_${id}`, x.kind === 'album' ? `alb_${x.source}_${raw.albumId || id}` : x.kind === 'artist' ? `art_${x.source}_${id}` : ''];
        const key = keys.find(k => k && Object.hasOwn(data.userRatings || {}, k));
        return { id, key, rating: key ? Number(data.userRatings[key]) : null };
    }

    starsHtml(value, size = '') {
        const v = Math.max(0, Math.min(5, Number(value) || 0));
        return `<span class="admin-stars ${size}" role="img" aria-label="${v} 星" style="--v:${v}">★★★★★</span>`;
    }

    getDislikeSectionHtml(data) {
        const items = this.getDislikeEntries(data);
        const e = value => this.escapeHtml(String(value ?? ''));
        const f = this._dislikeFilters || {};
        const option = (value, text, key) => `<option value="${e(value)}" ${(f[key] || '') === value ? 'selected' : ''}>${e(text)}</option>`;
        const channels = [...new Set(['web','web-rating-link','subsonic-rating','manual-rating-to-dislike','unknown', ...items.flatMap(x => [x.channel, ...(x.raw.reasons || []).map(r => r.channel)])])].sort();
        return `<section class="admin-dislikes" aria-label="用户不喜欢数据">
            <div class="data-section-header"><div class="section-header-title"><div class="section-icon-box admin-dislike-icon">⊘</div><div><h3>不喜欢</h3><p>歌曲、歌手与专辑规则 · Web 与 Subsonic 联动数据</p></div></div><span class="admin-section-count">${items.length} 条</span></div>
            <div id="admin-dislike-stats">${this.getDislikeStatsHtml(items)}</div>
            <div class="admin-dislike-toolbar">
                <div class="admin-dislike-search"><span aria-hidden="true">⌕</span><input class="form-input" aria-label="搜索不喜欢条目" placeholder="搜索名称、歌手、规则或 ID" value="${e(f.query || '')}" oninput="app.filterDislikeData('query',this.value)"></div>
                <select class="form-input" aria-label="添加来源" onchange="app.filterDislikeData('channel',this.value)">${option('', '全部添加来源', 'channel')}${channels.map(x => option(x, this.dislikeOriginLabel(x), 'channel')).join('')}</select>
                <select class="form-input" aria-label="音乐来源" onchange="app.filterDislikeData('source',this.value)">${this.adminPlatformOptions(items, f.source, '全部音乐平台')}</select>
                <select class="form-input" aria-label="评分筛选" onchange="app.filterDislikeData('rating',this.value)">${option('', '全部评分', 'rating')}${option('rated', '已评分', 'rating')}${option('none', '未评分', 'rating')}${option('low', '低分（1–2星）', 'rating')}${option('high', '高分（4–5星）', 'rating')}${[5, 4, 3, 2, 1].map(n => option(String(n), '★'.repeat(n), 'rating')).join('')}</select>
                <select class="form-input" aria-label="排序" onchange="app.filterDislikeData('sort',this.value)">${option('', '默认顺序', 'sort')}${option('time', '最近添加', 'sort')}${option('name', '名称 A-Z', 'sort')}${option('rating', '评分高→低', 'sort')}</select>
                <div class="admin-view-toggle" role="group" aria-label="视图"><button type="button" class="${f.view !== 'grid' ? '' : 'on'}" onclick="app.filterDislikeData('view','grid');app.refreshDislikeToggle()" aria-label="卡片视图">▦</button><button type="button" class="${f.view !== 'grid' ? 'on' : ''}" onclick="app.filterDislikeData('view','list');app.refreshDislikeToggle()" aria-label="列表视图">☰</button></div>
            </div>
            ${this.adminExtraFilters('dislike', f)}
            <p class="config-hint">平台标注总条数；来源筛选包含同一条规则的全部添加原因。多个关键词需同时匹配。添加来源与音乐平台分别记录。缺少来源记录的条目显示“来源未记录”；展开详情可查看所有已保存字段。评分只表示关联记录，不代表整张专辑或歌手的歌曲都被评分。</p>
            <div id="admin-dislike-results">${this.getDislikeResultsHtml(items)}</div>
        </section>`;
    }

    getDislikeStatsHtml(items) {
        const data = this.currentUserData?.data || {};
        const f = this._dislikeFilters || {};
        items = this.getFilteredDislikeRows(items, { ...f, kind: '' }).map(row => row.x);
        const count = k => items.filter(x => x.kind === k).length;
        const rated = items.filter(x => this.getDislikeRating(x, data).rating != null).length;
        const linked = items.filter(x => [x.raw.provenance, ...(x.raw.reasons || [])].some(reason => reason && /rating/.test(reason.channel))).length;
        const chip = (kind, label, n, icon) => `<button type="button" class="admin-dislike-stat ${(f.kind || '') === kind ? 'on' : ''}" onclick="app.filterDislikeData('kind','${kind}')"><span class="s-icon">${icon}</span><span class="s-num">${n}</span><span class="s-label">${label}</span></button>`;
        return `<div class="admin-dislike-stats">${chip('', '全部', items.length, '⊘')}${chip('song', '歌曲', count('song'), '♪')}${chip('artist', '歌手', count('artist'), '♙')}${chip('album', '专辑', count('album'), '◎')}<div class="admin-dislike-stat static"><span class="s-icon">★</span><span class="s-num">${rated}</span><span class="s-label">已评分</span></div><div class="admin-dislike-stat static"><span class="s-icon">⇄</span><span class="s-num">${linked}</span><span class="s-label">评分联动</span></div></div>`;
    }

    refreshDislikeStats() {
        const node = document.getElementById('admin-dislike-stats');
        if (node) node.innerHTML = this.getDislikeStatsHtml(this.getDislikeEntries(this.currentUserData?.data || {}));
    }

    refreshDislikeToggle() {
        const f = this._dislikeFilters || {};
        document.querySelectorAll('.admin-view-toggle button').forEach((b, i) => b.classList.toggle('on', (i === 1) === (f.view !== 'grid')));
    }

    filterDislikeData(key, value) {
        this._dislikeFilters = { ...(this._dislikeFilters || {}), [key]: value, page: 0 };
        const node = document.getElementById('admin-dislike-results');
        if (node) node.innerHTML = this.getDislikeResultsHtml(this.getDislikeEntries(this.currentUserData?.data || {}));
        this.refreshDislikeStats();
    }

    dislikePage(delta) {
        this._dislikeFilters = { ...(this._dislikeFilters || {}), page: Math.max(0, (this._dislikeFilters?.page || 0) + delta) };
        const node = document.getElementById('admin-dislike-results');
        if (node) { node.innerHTML = this.getDislikeResultsHtml(this.getDislikeEntries(this.currentUserData?.data || {})); node.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    }

    getFilteredDislikeRows(items, f = this._dislikeFilters || {}) {
        const data = this.currentUserData?.data || {};
        const withRating = items.map(x => ({ x, r: this.getDislikeRating(x, data) }));
        const matchRating = r => !f.rating || (f.rating === 'rated' ? r.rating != null : f.rating === 'none' ? r.rating == null : f.rating === 'low' ? r.rating != null && r.rating <= 2 : f.rating === 'high' ? r.rating >= 4 : r.rating === Number(f.rating));
        return withRating.filter(({ x, r }) => (!f.kind || f.kind === x.kind) && (!f.channel || f.channel === x.channel || (x.raw.reasons || []).some(reason => reason.channel === f.channel)) && (!f.source || f.source === (x.source || '*')) && matchRating(r) && this.adminMatchesExtra(f, x.cover, x.raw.provenance?.at, JSON.stringify([x.title, x.singer, x.rule, x.source, x.raw.id, x.raw.songmid, x.raw.meta])));
    }

    getDislikeResultsHtml(items) {
        const e = value => this.escapeHtml(String(value ?? ''));
        const f = this._dislikeFilters || {};
        const data = this.currentUserData?.data || {};
        let selected = this.getFilteredDislikeRows(items, f);
        if (f.sort === 'name') selected = [...selected].sort((a, b) => a.x.title.localeCompare(b.x.title, 'zh'));
        else if (f.sort === 'rating') selected = [...selected].sort((a, b) => (b.r.rating ?? -1) - (a.r.rating ?? -1));
        else if (f.sort === 'time') selected = [...selected].sort((a, b) => (b.x.raw.provenance?.at || 0) - (a.x.raw.provenance?.at || 0));
        if (!selected.length) return '<div class="admin-dislike-empty"><div class="big">⊘</div>暂无符合条件的不喜欢记录</div>';
        const PAGE = this.adminPageSize(f, 24), pages = Math.ceil(selected.length / PAGE);
        const page = Math.min(f.page || 0, pages - 1);
        this.resetAdminDetails();
        const cards = selected.slice(page * PAGE, page * PAGE + PAGE).map(({ x, r }) => {
            const raw = x.raw, { id, key: ratingKey, rating } = r;
            const fields = { '歌手': x.singer, '规则': x.rule, '音乐来源': x.source ? this.getSourceLabel(x.source) : '未指定（通用）', '对象 ID': id, '歌曲标识': raw.songmid, '专辑': raw.albumName || raw.meta?.albumName, '专辑 ID': raw.albumId || raw.meta?.albumId, '时长': raw.interval, '评分': rating == null ? '' : `${rating} 星`, '添加来源': this.dislikeOriginLabel(x.channel), '全部添加原因': (raw.reasons || [raw.provenance]).filter(Boolean).map(reason => this.dislikeOriginLabel(reason.channel) + (reason.ratingId ? `（${reason.ratingId}）` : '')).join('、'), '添加时间': raw.provenance?.at ? new Date(raw.provenance.at).toLocaleString() : '', '补全来源': raw.enrichedBy ? this.dislikeOriginLabel(raw.enrichedBy.channel) : '', '补全时间': raw.enrichedBy?.at ? new Date(raw.enrichedBy.at).toLocaleString() : '', '音质': Array.isArray(raw.types) ? raw.types.map(q => `${q.type}${q.size ? ` (${q.size})` : ''}`).join('、') : '' };
            const image = x.cover ? `<a href="${e(x.cover)}" target="_blank" rel="noopener noreferrer" aria-label="预览封面"><img src="${e(x.cover)}" loading="lazy" referrerpolicy="no-referrer" alt="${e(x.title)}封面" onerror="this.style.display='none'"></a>` : `<span aria-hidden="true">${x.kind === 'song' ? '♪' : x.kind === 'album' ? '◎' : '♙'}</span>`;
            const full = JSON.stringify({ ...raw, ...(x.libraryData ? { libraryData: x.libraryData } : {}), ...(ratingKey ? { linkedRating: { id: ratingKey, value: rating, origin: data.ratingOrigins?.[ratingKey] || null } } : {}) }, null, 2);
            const when = raw.provenance?.at ? new Date(raw.provenance.at).toLocaleDateString() : '';
            const g = keys => keys.map(k => [k, fields[k]]);
            const token = this.registerAdminDetail({ title: x.title, subtitle: [x.singer, raw.albumName || raw.meta?.albumName].filter(Boolean).join(' · '), cover: x.cover, icon: x.kind === 'song' ? '♪' : x.kind === 'album' ? '◎' : '♙', rating, raw: { ...raw, ...(x.libraryData ? { libraryData: x.libraryData } : {}), ...(ratingKey ? { linkedRating: { id: ratingKey, value: rating, origin: data.ratingOrigins?.[ratingKey] || null } } : {}) }, badges: [({ song: '歌曲', artist: '歌手', album: '专辑' })[x.kind], x.source ? this.getSourceLabel(x.source) : '通用规则', this.dislikeOriginLabel(x.channel)], sections: [{ title: '基本信息', fields: g(['歌手', '专辑', '时长', '音乐来源']) }, { title: '评分关联', fields: [['评分', fields['评分']], ['评分 ID', ratingKey || '']] }, { title: '添加记录', fields: g(['规则', '添加来源', '全部添加原因', '添加时间', '补全来源', '补全时间']) }, { title: '标识', fields: g(['对象 ID', '歌曲标识', '专辑 ID']) }, { title: '可用音质', fields: [['音质', Array.isArray(raw.types) ? raw.types.map(q => q.type + (q.size ? ' · ' + q.size : '')) : []]] }] });
            return `<article class="admin-dislike-card kind-${x.kind}"><div class="admin-dislike-cover">${image}</div><div class="admin-dislike-main"><h4 title="${e(x.title)}">${e(x.title)}</h4><p>${e([x.singer || '未记录歌手', raw.albumName || raw.meta?.albumName].filter(Boolean).join(' · '))}</p><button type="button" class="adm-open" onclick="app.openAdminDetail('${token}')">查看详情</button></div><div class="admin-dislike-badges"><span class="k">${e(({ song: '歌曲', artist: '歌手', album: '专辑' })[x.kind])}</span><span>${e(this.dislikeOriginLabel(x.channel))}</span><span>${e(x.source ? this.getSourceLabel(x.source) : '通用规则')}</span></div><div class="admin-dislike-score"><div class="admin-dislike-rating">${rating == null ? '<span class="muted">未评分</span>' : `${this.starsHtml(rating)}<b>${e(rating)}</b>`}</div><small>${e(when || '时间未记录')}</small></div></article>`;
        }).join('');
        return `<div class="admin-dislike-summary" role="status" aria-live="polite">共 ${selected.length} 条（总计 ${items.length} 条） · 第 ${page + 1} / ${pages} 页</div><div class="admin-dislike-grid ${f.view !== 'grid' ? 'is-list' : ''}">${cards}</div><div class="admin-dislike-pages"><button class="btn-secondary" ${page ? '' : 'disabled'} onclick="app.dislikePage(-1)">上一页</button><button class="btn-secondary" ${page + 1 < pages ? '' : 'disabled'} onclick="app.dislikePage(1)">下一页</button></div>`;
    }

    ratingOriginLabel(origin) {
        if (!origin?.channel) return '来源未记录';
        return ({ web: 'Web 手动评分', subsonic: 'Subsonic 手动评分', 'web-dislike-link': '不喜欢自动补分', 'manual-dislike-to-rating': '后台补分', 'web-rating-link': 'Web 低分联动', 'subsonic-rating': 'Subsonic 低分联动', 'manual-rating-to-dislike': '后台低分补不喜欢', 'snapshot-restore': '评分恢复', unknown: '来源未记录' })[origin.channel] || '其他来源（未识别）';
    }

    async retryAdminRatingSync() {
        if (this._ratingRetryBusy) return;
        const user=this.currentUserData?.username;if(!user)return;
        this._ratingRetryBusy=true;
        try {const result=await this.request(`/api/data/rating-sync?user=${encodeURIComponent(user)}`,{method:'POST'});if(result.pending?.length)showInfo(`重试完成，仍有 ${result.pending.length} 项待处理`);else showSuccess('失败项已处理');if(this.currentUserData?.username===user)await this.loadUserData()}
        catch(error){showError('重试失败：'+error.message)}finally{this._ratingRetryBusy=false}
    }

    getRatingSectionHtml(data) {
        const items = data.ratingItems || [];
        const e = v => this.escapeHtml(String(v ?? ''));
        const f = this._ratingFilters || {};
        const opt = (v, t, k) => `<option value="${e(v)}" ${(f[k] || (k === 'status' ? 'active' : '')) === v ? 'selected' : ''}>${e(t)}</option>`;
        const origins = ['web', 'subsonic', 'web-dislike-link', 'manual-dislike-to-rating'];
        return `<section class="admin-dislikes admin-ratings" aria-label="用户评分数据">
            <div class="data-section-header"><div class="section-header-title"><div class="section-icon-box admin-flat-icon">★</div><div><h3>评分</h3><p>歌曲、专辑、歌手评分 · 含封面、平台与评分来源</p></div></div><span class="admin-section-count">${items.length} 条</span></div>
            ${(data.ratingSyncPending || []).length ? `<details class="config-hint"><summary>同步待处理 ${(data.ratingSyncPending || []).length} 项</summary>${data.ratingSyncPending.map(task => `<p>${e(task.id || '评分快照')}：${e(task.message)}</p>`).join('')}<button type="button" class="btn-secondary" onclick="app.retryAdminRatingSync()">仅重试失败项</button></details>` : ''}
            <div id="admin-rating-stats">${this.getRatingStatsHtml(items)}</div>
            <div class="admin-dislike-toolbar">
                <div class="admin-dislike-search"><input class="form-input" aria-label="搜索评分" placeholder="搜索名称、歌手、专辑或 ID" value="${e(f.query || '')}" oninput="app.filterRatingData('query',this.value)"></div>
                <select class="form-input" aria-label="平台" onchange="app.filterRatingData('source',this.value)">${this.adminPlatformOptions(items, f.source, '全部音乐平台')}</select>
                <select class="form-input" aria-label="评分来源" onchange="app.filterRatingData('origin',this.value)">${opt('', '全部评分来源', 'origin')}${origins.map(o => opt(o || '*', this.ratingOriginLabel(o ? { channel: o } : null), 'origin')).join('')}</select>
                <select class="form-input" aria-label="星级" onchange="app.filterRatingData('stars',this.value)">${opt('', '全部星级', 'stars')}${opt('low', '低分（1–2星）', 'stars')}${opt('high', '高分（4–5星）', 'stars')}${[5, 4, 3, 2, 1].map(n => opt(String(n), n + ' 星', 'stars')).join('')}</select>
                <select class="form-input" aria-label="排序" onchange="app.filterRatingData('sort',this.value)">${opt('', '评分高→低', 'sort')}${opt('low', '评分低→高', 'sort')}${opt('time', '最近评分', 'sort')}${opt('oldest', '最早评分', 'sort')}${opt('singer', '歌手名称', 'sort')}${opt('source', '音乐平台', 'sort')}${opt('name', '名称', 'sort')}</select>
            </div>
            ${this.adminExtraFilters('rating', f)}
            <p class="config-hint">平台标注该用户的总条数，0条也可筛选。多个关键词以空格分隔，需同时匹配；音乐平台与评分操作来源分别筛选。</p>
            <div id="admin-rating-results">${this.getRatingResultsHtml(items)}</div>
        </section>`;
    }

    getRatingStatsHtml(items) {
        const f = this._ratingFilters || {};
        const total = items.length, dormant = items.filter(x => x.dormant).length;
        const selected = this.getFilteredRatingRows(items).length;
        items = this.getFilteredRatingRows(items, { ...f, kind: '', stars: '' });
        const n = k => items.filter(x => x.kind === k).length;
        const avg = items.length ? (items.reduce((a, x) => a + x.rating, 0) / items.length).toFixed(2) : '–';
        const cell = (k, label, v) => `<button type="button" class="${(f.kind || '') === k ? 'on' : ''}" onclick="app.filterRatingData('kind','${k}')"><b>${v}</b><span>${label}</span></button>`;
        const dist = [5, 4, 3, 2, 1].map(s => { const c = items.filter(x => x.rating === s).length; return `<button type="button" class="admin-dist-row ${f.stars === String(s) ? 'on' : ''}" aria-label="筛选 ${s} 星，共 ${c} 条" aria-pressed="${f.stars === String(s)}" onclick="app.filterRatingData('stars','${f.stars === String(s) ? '' : s}')"><span>${s}★</span><i><u style="width:${items.length ? c / items.length * 100 : 0}%"></u></i><em>${c}</em></button>`; }).join('');
        return `<div class="admin-flat-stats">${cell('', '全部', items.length)}${cell('song', '歌曲', n('song'))}${cell('album', '专辑', n('album'))}${cell('artist', '歌手', n('artist'))}<div class="static"><b>${avg}</b><span>平均分</span></div></div><div class="admin-rating-insights"><div class="admin-insight-main"><span class="admin-eyebrow">评分分布 · 点击筛选 / 再次点击取消</span><div class="admin-dist">${dist}</div></div><div class="admin-insight-score" style="--score:${Number(avg) || 0}"><div class="admin-score-ring"><b>${avg}</b><span>平均评分</span></div><p>当前匹配 <strong>${selected}</strong> / ${total} 条</p></div></div>`;
    }

    refreshRatingStats() {
        const node = document.getElementById('admin-rating-stats');
        if (node) node.innerHTML = this.getRatingStatsHtml(this.currentUserData?.data?.ratingItems || []);
    }

    filterRatingData(key, value) {
        this._ratingFilters = { ...(this._ratingFilters || {}), [key]: value, page: 0 };
        const node = document.getElementById('admin-rating-results');
        if (node) node.innerHTML = this.getRatingResultsHtml(this.currentUserData?.data?.ratingItems || []);
        this.refreshRatingStats();
        const stars = document.querySelector('.admin-ratings select[aria-label="星级"]');
        if (stars && key === 'stars') { stars.value = value; this.syncCustomSelects(); }
    }

    ratingPage(delta) {
        this._ratingFilters = { ...(this._ratingFilters || {}), page: Math.max(0, (this._ratingFilters?.page || 0) + delta) };
        const node = document.getElementById('admin-rating-results');
        if (node) { node.innerHTML = this.getRatingResultsHtml(this.currentUserData?.data?.ratingItems || []); node.scrollIntoView({ block: 'start' }); }
    }

    getFilteredRatingRows(items, f = this._ratingFilters || {}) {
        return items.filter(x => (!f.kind || x.kind === f.kind) && (!f.source || (x.source || '*') === f.source) && (!f.origin || (x.origin?.channel || '*') === f.origin) && (!f.stars || (f.stars === 'low' ? x.rating <= 2 : f.stars === 'high' ? x.rating >= 4 : x.rating === Number(f.stars))) && this.adminMatchesExtra(f, x.img, x.origin?.at, `${x.name} ${x.singer} ${x.albumName} ${x.id} ${x.effectiveId || ''} ${x.source || ''}`));
    }

    getRatingResultsHtml(items) {
        const e = v => this.escapeHtml(String(v ?? ''));
        const f = this._ratingFilters || {};
        let rows = this.getFilteredRatingRows(items, f);
        rows = [...rows].sort((a, b) => f.sort === 'low' ? a.rating - b.rating : f.sort === 'time' ? (b.origin?.at || 0) - (a.origin?.at || 0) : f.sort === 'oldest' ? (a.origin?.at || 0) - (b.origin?.at || 0) : f.sort === 'singer' ? String(a.singer).localeCompare(String(b.singer), 'zh') : f.sort === 'source' ? String(a.source).localeCompare(String(b.source)) : f.sort === 'name' ? String(a.name).localeCompare(String(b.name), 'zh') : b.rating - a.rating);
        if (!rows.length) return '<div class="admin-dislike-empty">暂无符合条件的评分</div>';
        const PAGE = this.adminPageSize(f, 30), pages = Math.ceil(rows.length / PAGE), page = Math.min(f.page || 0, pages - 1);
        const kindName = { song: '歌曲', album: '专辑', artist: '歌手' };
        this.resetAdminDetails();
        const body = rows.slice(page * PAGE, page * PAGE + PAGE).map(x => {
            const cover = x.img ? `<a href="${e(x.img)}" target="_blank" rel="noopener noreferrer" aria-label="预览封面"><img src="${e(x.img)}" loading="lazy" referrerpolicy="no-referrer" alt="" onerror="this.remove()"></a>` : '';
            const sub = [x.singer, x.albumName].filter(Boolean).join(' · ');
            const at = x.origin?.at ? new Date(x.origin.at).toLocaleString() : '';
            const token = this.registerAdminDetail({ title: x.name, subtitle: sub, cover: x.img, icon: x.kind === 'song' ? '♪' : x.kind === 'album' ? '◎' : '♙', rating: x.rating, raw: x, badges: [kindName[x.kind], x.source === 'local' ? '本地' : x.source ? this.getSourceLabel(x.source) : '未知平台'], sections: [{ title: '基本信息', fields: [['歌手', x.singer], ['专辑', x.albumName], ['时长', x.interval], ['音乐平台', x.source === 'local' ? '本地' : x.source ? this.getSourceLabel(x.source) : '']] }, { title: '评分记录', fields: [['评分来源', this.ratingOriginLabel(x.origin)], ['评分时间', at]] }, { title: '标识', fields: [['评分 ID', x.id], ['当前使用 ID', x.dormant ? x.effectiveId : '']] }] });
            return `<div class="admin-row kind-${e(x.kind)}"><div class="admin-row-cover">${cover}<span>${x.kind === 'song' ? '♪' : x.kind === 'album' ? '◎' : '♙'}</span></div><div class="admin-row-main"><div class="admin-row-title" title="${e(x.name)}">${e(x.name)}</div><div class="admin-row-sub">${e(sub || '—')}</div><button type="button" class="adm-open" onclick="app.openAdminDetail('${token}')">查看详情</button></div><div class="admin-row-meta"><span>${e(kindName[x.kind])}</span><span>${e(x.source === 'local' ? '本地' : x.source ? this.getSourceLabel(x.source) : '未知平台')}</span><span>${e(this.ratingOriginLabel(x.origin))}</span></div><div class="admin-row-score">${this.starsHtml(x.rating)}<small>${e(at)}</small></div></div>`;
        }).join('');
        return `<div class="admin-dislike-summary" role="status" aria-live="polite">共 ${rows.length} 条（总计 ${items.length} 条） · 第 ${page + 1} / ${pages} 页</div><div class="admin-rows">${body}</div><div class="admin-dislike-pages"><button class="btn-secondary" ${page ? '' : 'disabled'} onclick="app.ratingPage(-1)">上一页</button><button class="btn-secondary" ${page + 1 < pages ? '' : 'disabled'} onclick="app.ratingPage(1)">下一页</button></div>`;
    }

    registerAdminDetail(model) {
        this._adminDetails = this._adminDetails || new Map();
        const token = `d${this._adminSeq = (this._adminSeq || 0) + 1}`;
        this._adminDetails.set(token, model);
        return token;
    }

    /** 解析/渲染后清空旧登记，避免翻页后令牌无限增长 */
    resetAdminDetails() { if ((this._adminDetails?.size || 0) > 5000) this._adminDetails = new Map(); }

    closeAdminDetail() {
        const el = document.getElementById('admin-detail-modal');
        if (!el) return;
        el.classList.add('closing');
        document.removeEventListener('keydown', this._adminDetailKey);
        setTimeout(() => el.remove(), 160);
    }

    openAdminDetail(token) {
        const m = this._adminDetails?.get(token);
        if (!m) return;
        this.closeAdminDetail();
        document.getElementById('admin-detail-modal')?.remove();
        const e = v => this.escapeHtml(String(v ?? ''));
        const cell = ([k, v]) => {
            const copy = /ID|标识/.test(k) ? `<button type="button" class="adm-copy" data-copy="${e(v)}" aria-label="复制${e(k)}">复制</button>` : '';
            const val = Array.isArray(v) ? `<div class="adm-chips">${v.map(x => `<span>${e(x)}</span>`).join('')}</div>` : `<span class="adm-val ${/ID|标识|规则/.test(k) ? 'mono' : ''}">${e(v)}</span>`;
            return `<div class="adm-field"><dt>${e(k)}</dt><dd>${val}${copy}</dd></div>`;
        };
        const sections = m.sections.map(s => ({ ...s, fields: s.fields.filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length)) })).filter(s => s.fields.length)
            .map(s => `<section class="adm-section"><h5>${e(s.title)}</h5><dl>${s.fields.map(cell).join('')}</dl></section>`).join('');
        const cover = m.cover ? `<a class="adm-cover" href="${e(m.cover)}" target="_blank" rel="noopener noreferrer" title="查看原图"><img src="${e(m.cover)}" referrerpolicy="no-referrer" alt="" onerror="this.parentNode.classList.add('empty');this.remove()"></a>` : `<div class="adm-cover empty"><span>${m.icon || '♪'}</span></div>`;
        const wrap = document.createElement('div');
        wrap.id = 'admin-detail-modal';
        wrap.className = 'adm-overlay';
        wrap.innerHTML = `<div class="adm-panel" role="dialog" aria-modal="true" aria-label="${e(m.title)} 详情" tabindex="-1">
            <div class="adm-grip"></div>
            <header class="adm-head">${cover}<div class="adm-title"><div class="adm-tags">${(m.badges || []).map((b, i) => `<span class="${i ? '' : 'k'}">${e(b)}</span>`).join('')}</div><h3>${e(m.title)}</h3><p>${e(m.subtitle || '')}</p>${m.rating != null ? `<div class="adm-score">${this.starsHtml(m.rating, 'lg')}<b>${e(m.rating)}</b></div>` : '<div class="adm-score muted">未评分</div>'}</div><button type="button" class="adm-x" aria-label="关闭">✕</button></header>
            <div class="adm-body">${sections}
                <details class="adm-raw"><summary>原始数据</summary><div class="adm-raw-tools"><button type="button" class="btn-secondary adm-copy-json">复制 JSON</button></div><pre>${e(JSON.stringify(m.raw, null, 2))}</pre></details>
            </div></div>`;
        document.body.appendChild(wrap);
        const close = () => this.closeAdminDetail();
        wrap.addEventListener('click', ev => {
            if (ev.target === wrap || ev.target.closest('.adm-x')) return close();
            const c = ev.target.closest('.adm-copy');
            if (c) { navigator.clipboard?.writeText(c.dataset.copy); c.textContent = '已复制'; setTimeout(() => c.textContent = '复制', 1200); }
            if (ev.target.closest('.adm-copy-json')) { navigator.clipboard?.writeText(JSON.stringify(m.raw, null, 2)); const b = ev.target.closest('.adm-copy-json'); b.textContent = '已复制'; setTimeout(() => b.textContent = '复制 JSON', 1200); }
        });
        this._adminDetailKey = ev => { if (ev.key === 'Escape') close(); };
        document.addEventListener('keydown', this._adminDetailKey);
        wrap.querySelector('.adm-panel').focus();
    }

    getPlaylistsSectionHtml(userList, isAllTab) {
        const count = userList.length;
        let html = `
            <div class="data-section-header">
                <div class="section-header-title">
                    <div class="section-icon-box" style="background: linear-gradient(135deg, #3b82f6, #6366f1);">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 18V5l12-2v13"/>
                            <circle cx="6" cy="18" r="3"/>
                            <circle cx="18" cy="16" r="3"/>
                        </svg>
                    </div>
                    <div class="section-title-group">
                        <h3>播放列表</h3>
                        <span class="section-subtitle">共 ${count} 个自定义歌单</span>
                    </div>
                </div>
                <div class="section-header-actions">
                    <span class="section-badge">${count} 歌单</span>
                </div>
            </div>
        `;

        if (count > 0) {
            html += '<div class="playlists-grid">';
            userList.forEach((list, index) => {
                const songCount = list.list?.length || 0;
                html += `
                    <div class="playlist-card glass">
                        <div class="playlist-card-header">
                            <div class="playlist-info">
                                <div class="playlist-name" title="${this.escapeHtml(list.name)}">${this.escapeHtml(list.name)}</div>
                                <div class="playlist-meta">
                                    <span class="playlist-id">ID: ${list.id}</span>
                                    <span class="playlist-count">${songCount} 首</span>
                                </div>
                            </div>
                        </div>
                        <div class="playlist-card-actions">
                            <button class="btn-view" onclick="app.viewPlaylistDetails(${index})">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                    <circle cx="12" cy="12" r="3"/>
                                </svg>
                                查看详情
                            </button>
                            <button class="btn-delete-playlist" onclick="app.deletePlaylist(${index})">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                </svg>
                                删除歌单
                            </button>
                        </div>
                    </div>
                `;
            });
            html += '</div>';
        } else {
            html += '<p style="color: var(--text-secondary); padding: 1.5rem; text-align: center;">暂无自定义列表</p>';
        }

        return html;
    }

    getAlbumsSectionHtml(albums, withMarginTop) {
        const count = albums.length;
        let html = `
            <div class="data-section-header ${withMarginTop ? 'with-margin-top' : ''}">
                <div class="section-header-title">
                    <div class="section-icon-box" style="background: linear-gradient(135deg, #ec4899, #8b5cf6);">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                    </div>
                    <div class="section-title-group">
                        <h3>收藏专辑</h3>
                        <span class="section-subtitle">共 ${count} 张已收藏的音乐专辑</span>
                    </div>
                </div>
                <div class="section-header-actions">
                    <span class="section-badge">${count} 专辑</span>
                </div>
            </div>
        `;

        if (count > 0) {
            html += '<div class="albums-grid">';
            albums.forEach((album, index) => {
                const songCount = album.list?.length || 0;
                const picUrl = album.picUrl || album.meta?.picUrl || album.list?.[0]?.img || '';
                const artist = album.artistName || album.singer || album.list?.[0]?.singer || '未知歌手';
                const sourceLabel = this.getSourceLabel(album.source);
                const sourceClass = album.source ? `source-${album.source}` : '';

                html += `
                    <div class="album-card glass" onclick="app.viewAlbumDetails(${index})" title="点击查看专辑曲目">
                        <div class="album-cover-box">
                            ${picUrl ? `<img src="${this.escapeHtml(picUrl)}" alt="${this.escapeHtml(album.name)}" class="album-cover-img" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">` : ''}
                            <div class="album-cover-fallback" style="display: ${picUrl ? 'none' : 'flex'};">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                    <circle cx="12" cy="12" r="10"/>
                                    <circle cx="12" cy="12" r="3"/>
                                </svg>
                            </div>
                            <div class="album-card-overlay">
                                <div class="album-play-icon">
                                    <svg viewBox="0 0 24 24" fill="currentColor">
                                        <polygon points="5 3 19 12 5 21 5 3"/>
                                    </svg>
                                </div>
                                <span class="album-hover-text">查看曲目</span>
                            </div>
                            ${sourceLabel ? `<span class="card-source-badge ${sourceClass}">${sourceLabel}</span>` : ''}
                            <span class="card-count-badge">${songCount} 首</span>
                        </div>
                        <div class="album-meta-info">
                            <div class="album-title" title="${this.escapeHtml(album.name)}">${this.escapeHtml(album.name)}</div>
                            <div class="album-artist" title="${this.escapeHtml(artist)}">
                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                    <circle cx="12" cy="7" r="4"/>
                                </svg>
                                <span>${this.escapeHtml(artist)}</span>
                            </div>
                        </div>
                    </div>
                `;
            });
            html += '</div>';
        } else {
            html += '<p style="color: var(--text-secondary); padding: 1.5rem; text-align: center;">暂无收藏专辑</p>';
        }

        return html;
    }

    getArtistsSectionHtml(artists, withMarginTop) {
        const count = artists.length;
        let html = `
            <div class="data-section-header ${withMarginTop ? 'with-margin-top' : ''}">
                <div class="section-header-title">
                    <div class="section-icon-box" style="background: linear-gradient(135deg, #10b981, #06b6d4);">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                            <circle cx="12" cy="7" r="4"/>
                        </svg>
                    </div>
                    <div class="section-title-group">
                        <h3>收藏歌手</h3>
                        <span class="section-subtitle">共 ${count} 位已关注的歌手/艺人</span>
                    </div>
                </div>
                <div class="section-header-actions">
                    <span class="section-badge">${count} 歌手</span>
                </div>
            </div>
        `;

        if (count > 0) {
            html += '<div class="artists-grid">';
            artists.forEach((artist) => {
                const picUrl = artist.picUrl || '';
                const sourceLabel = this.getSourceLabel(artist.source);
                const sourceClass = artist.source ? `source-${artist.source}` : '';

                html += `
                    <div class="artist-card glass">
                        <div class="artist-avatar-box">
                            ${picUrl ? `<img src="${this.escapeHtml(picUrl)}" alt="${this.escapeHtml(artist.name)}" class="artist-avatar-img" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">` : ''}
                            <div class="artist-avatar-fallback" style="display: ${picUrl ? 'none' : 'flex'};">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                    <circle cx="12" cy="7" r="4"/>
                                </svg>
                            </div>
                            ${sourceLabel ? `<span class="artist-source-badge ${sourceClass}">${sourceLabel}</span>` : ''}
                        </div>
                        <div class="artist-meta-info">
                            <div class="artist-name" title="${this.escapeHtml(artist.name)}">${this.escapeHtml(artist.name)}</div>
                            <div class="artist-sub">${artist.id ? `ID: ${this.escapeHtml(artist.id)}` : (sourceLabel || '关注歌手')}</div>
                        </div>
                    </div>
                `;
            });
            html += '</div>';
        } else {
            html += '<p style="color: var(--text-secondary); padding: 1.5rem; text-align: center;">暂无收藏歌手</p>';
        }

        return html;
    }

    viewAlbumDetails(index) {
        const album = this.currentUserData?.data?.albums?.[index];
        if (!album) return;

        this.currentAlbumView = index;
        const tabsContainer = document.getElementById('data-tabs-container');
        if (tabsContainer) tabsContainer.classList.add('hidden');

        const picUrl = album.picUrl || album.meta?.picUrl || album.list?.[0]?.img || '';
        const artist = album.artistName || album.singer || album.list?.[0]?.singer || '未知歌手';
        const sourceLabel = this.getSourceLabel(album.source);
        const sourceClass = album.source ? `source-${album.source}` : '';
        const songCount = album.list?.length || 0;

        let content = `
            <div class="playlist-detail-header">
                <button onclick="app.renderCurrentDataTab()" class="btn-back">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
                    </svg>
                    返回列表
                </button>
            </div>
            <div class="album-detail-header-card">
                ${picUrl ? `<img src="${this.escapeHtml(picUrl)}" class="album-detail-cover" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : ''}
                <div class="album-detail-info">
                    <h2 class="album-detail-title">${this.escapeHtml(album.name)}</h2>
                    <div class="album-detail-meta">
                        <span>歌手: <strong>${this.escapeHtml(artist)}</strong></span>
                        <span>·</span>
                        <span>${songCount} 首歌曲</span>
                        ${sourceLabel ? `<span>·</span><span class="card-source-badge ${sourceClass}" style="position:static;display:inline-block;">${sourceLabel}</span>` : ''}
                        ${album.id ? `<span>·</span><span style="font-family:monospace;font-size:0.8rem;opacity:0.7;">ID: ${album.id}</span>` : ''}
                    </div>
                </div>
            </div>
        `;

        if (album.list && album.list.length) {
            content += `
                <div class="search-sort-bar">
                    <div class="search-box">
                        <input type="text" id="song-search" placeholder="搜索专辑歌曲..." oninput="app.filterSongs()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                        </svg>
                    </div>
                    <select id="song-sort" onchange="app.sortSongs()" class="sort-select">
                        <option value="">默认排序</option>
                        <option value="name-asc">歌曲名 ↑</option>
                        <option value="name-desc">歌曲名 ↓</option>
                        <option value="artist-asc">歌手 ↑</option>
                        <option value="artist-desc">歌手 ↓</option>
                    </select>
                </div>
            `;
            content += '<div class="songs-table">';
            content += `
                <div class="songs-table-header">
                    <div class="song-col-index">#</div>
                    <div class="song-col-name">歌曲</div>
                    <div class="song-col-artist">歌手</div>
                    <div class="song-col-actions" style="text-align:right;">时长</div>
                </div>
            `;

            album.list.forEach((song, songIndex) => {
                content += `
                    <div class="song-row">
                        <div class="song-col-index">${songIndex + 1}</div>
                        ${this.renderSongNameCell(song, picUrl)}
                        <div class="song-col-artist">${this.escapeHtml(song.singer || artist || '未知歌手')}</div>
                        <div class="song-col-actions" style="text-align:right; font-size:0.85rem; color:var(--text-secondary); font-family:monospace;">
                            ${this.escapeHtml(song.interval || '--:--')}
                        </div>
                    </div>
                `;
            });

            content += '</div>';
        } else {
            content += '<p style="color: var(--text-secondary); padding: 2rem; text-align: center;">此专辑暂无曲目</p>';
        }

        document.getElementById('data-content').innerHTML = content;
        applyMarqueeChecks();
    }

    viewPlaylistDetails(index) {
        const playlist = this.currentUserData?.data?.userList?.[index];
        if (!playlist) return;

        this.currentPlaylistView = index;
        const tabsContainer = document.getElementById('data-tabs-container');
        if (tabsContainer) tabsContainer.classList.add('hidden');

        let content = `
            <div class="playlist-detail-header">
                <button onclick="app.renderCurrentDataTab()" class="btn-back">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
                    </svg>
                    返回列表
                </button>
                <div class="playlist-title-row">
                    <h3 id="playlist-name-${index}">${this.escapeHtml(playlist.name)}</h3>
                    <button onclick="app.editPlaylistName(${index})" class="btn-edit-name" title="编辑名称">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                </div>
                <div class="playlist-detail-meta">
                    <span>ID: ${playlist.id}</span>
                    <span>${playlist.list?.length || 0} 首歌曲</span>
                </div>
            </div>
        `;

        if (playlist.list && playlist.list.length) {
            content += `
                <div class="search-sort-bar">
                    <div class="search-box">
                        <input type="text" id="song-search" placeholder="搜索歌曲、歌手..." oninput="app.filterSongs()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                        </svg>
                    </div>
                    <select id="song-sort" onchange="app.sortSongs()" class="sort-select">
                        <option value="">默认排序</option>
                        <option value="name-asc">歌曲名 ↑</option>
                        <option value="name-desc">歌曲名 ↓</option>
                        <option value="artist-asc">歌手 ↑</option>
                        <option value="artist-desc">歌手 ↓</option>
                    </select>
                </div>
                <div class="batch-actions">
                    <div class="batch-select-btns">
                        <button onclick="app.selectAllSongs()" class="btn-batch">全选</button>
                        <button onclick="app.invertSelection()" class="btn-batch">反选</button>
                        <button onclick="app.clearSelection()" class="btn-batch">清空</button>
                    </div>
                    <button onclick="app.batchDeleteSongs()" class="btn-batch-delete" id="batch-delete-btn" disabled>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                        批量删除 (<span id="selected-count">0</span>)
                    </button>
                </div>
            `;
            content += '<div class="songs-table">';
            content += `
                <div class="songs-table-header with-checkbox">
                    <div class="song-col-checkbox">
                        <input type="checkbox" id="select-all-checkbox" onchange="app.toggleAllSongs(this.checked)">
                    </div>
                    <div class="song-col-index">#</div>
                    <div class="song-col-name">歌曲</div>
                    <div class="song-col-artist">歌手</div>
                    <div class="song-col-actions">操作</div>
                </div>
            `;

            playlist.list.forEach((song, songIndex) => {
                content += `
                    <div class="song-row with-checkbox">
                        <div class="song-col-checkbox">
                            <input type="checkbox" class="song-checkbox" data-index="${songIndex}" onchange="app.updateBatchDeleteBtn()">
                        </div>
                        <div class="song-col-index">${songIndex + 1}</div>
                        ${this.renderSongNameCell(song)}
                        <div class="song-col-artist">${this.escapeHtml(song.singer || '未知歌手')}</div>
                        <div class="song-col-actions">
                            <button class="btn-delete-song" onclick="app.deleteSong(${index}, ${songIndex})" title="删除歌曲">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                `;
            });

            content += '</div>';
        } else {
            content += '<p style="color: var(--text-secondary); padding: 2rem; text-align: center;">此歌单暂无歌曲</p>';
        }

        document.getElementById('data-content').innerHTML = content;
    }

    async deletePlaylist(index) {
        const playlist = this.currentUserData?.data?.userList?.[index];
        if (!playlist) return;

        if (!(await showSelect('删除歌单', `确定要删除歌单 "${playlist.name}" 吗？\n此操作将删除歌单及其中的所有歌曲！`, { danger: true }))) return;

        try {
            await this.request('/api/data/delete-playlist', {
                method: 'POST',
                body: JSON.stringify({
                    username: this.currentUserData.username,
                    playlistId: playlist.id
                })
            });

            showSuccess('删除成功！');
            this.loadUserData();
        } catch (err) {
            showError('删除失败: ' + err.message);
        }
    }

    async deleteSong(playlistIndexOrType, songIndex) {
        let playlist, song, playlistId, isSystemList = false;

        // 检查是否是系统列表
        if (typeof playlistIndexOrType === 'string') {
            isSystemList = true;
            const listType = playlistIndexOrType;
            const listMap = {
                'default': { list: this.currentUserData?.data?.defaultList, name: '试听列表', id: 'default' },
                'love': { list: this.currentUserData?.data?.loveList, name: '我的收藏', id: 'love' }
            };
            playlist = listMap[listType];
            song = playlist?.list?.[songIndex];
            playlistId = playlist?.id;
        } else {
            playlist = this.currentUserData?.data?.userList?.[playlistIndexOrType];
            song = playlist?.list?.[songIndex];
            playlistId = playlist?.id;
        }

        if (!song) return;

        if (!(await showSelect('删除歌曲', `确定要从 "${playlist.name}" 中删除歌曲 "${song.name}" 吗？`, { danger: true }))) return;

        try {
            await this.request('/api/data/delete-song', {
                method: 'POST',
                body: JSON.stringify({
                    username: this.currentUserData.username,
                    playlistId: playlistId,
                    songIndex: songIndex
                })
            });

            showSuccess('删除成功！');
            // 重新加载并显示当前列表
            await this.loadUserData();
            if (isSystemList) {
                this.viewSystemList(playlistIndexOrType);
            } else {
                this.viewPlaylistDetails(playlistIndexOrType);
            }
        } catch (err) {
            showError('删除失败: ' + err.message);
        }
    }

    viewSystemList(listType) {
        const data = this.currentUserData?.data;
        if (!data) return;

        const listMap = {
            'default': { list: data.defaultList, name: '试听列表', id: 'default' },
            'love': { list: data.loveList, name: '我的收藏', id: 'love' }
        };

        const systemList = listMap[listType];
        if (!systemList) return;

        this.currentPlaylistView = listType; // 存储当前查看的系统列表类型
        const tabsContainer = document.getElementById('data-tabs-container');
        if (tabsContainer) tabsContainer.classList.add('hidden');

        let content = `
            <div class="playlist-detail-header">
                <button onclick="app.renderCurrentDataTab()" class="btn-back">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
                    </svg>
                    返回列表
                </button>
                <h3>${systemList.name}</h3>
                <div class="playlist-detail-meta">
                    <span>系统列表</span>
                    <span>${systemList.list?.length || 0} 首歌曲</span>
                </div>
            </div>
        `;

        if (systemList.list && systemList.list.length) {
            content += '<div class="songs-table">';
            content += `
                <div class="songs-table-header">
                    <div class="song-col-index">#</div>
                    <div class="song-col-name">歌曲</div>
                    <div class="song-col-artist">歌手</div>
                    <div class="song-col-source">来源</div>
                    <div class="song-col-actions">操作</div>
                </div>
            `;

            systemList.list.forEach((song, songIndex) => {
                content += `
                    <div class="song-row">
                        <div class="song-col-index">${songIndex + 1}</div>
                        ${this.renderSongNameCell(song)}
                        <div class="song-col-artist">${this.escapeHtml(song.singer || '未知歌手')}</div>
                        <div class="song-col-actions">
                            <button class="btn-delete-song" onclick="app.deleteSong('${listType}', ${songIndex})" title="删除歌曲">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                `;
            });

            content += '</div>';
        } else {
            content += '<p style="color: var(--text-secondary); padding: 2rem; text-align: center;">此列表暂无歌曲</p>';
        }

        document.getElementById('data-content').innerHTML = content;
    }

    async editPlaylistName(index) {
        const playlist = this.currentUserData?.data?.userList?.[index];
        if (!playlist) return;

        const newName = await showInput('编辑歌单名称', '请输入新的歌单名称:', { defaultValue: playlist.name });
        if (!newName || newName === playlist.name) return;

        try {
            await this.request('/api/data/rename-playlist', {
                method: 'POST',
                body: JSON.stringify({
                    username: this.currentUserData.username,
                    playlistId: playlist.id,
                    newName: newName
                })
            });

            showSuccess('重命名成功！');
            await this.loadUserData();
            this.viewPlaylistDetails(index);
        } catch (err) {
            showError('重命名失败: ' + err.message);
        }
    }

    // 更新批量删除按钮状态
    updateBatchDeleteBtn() {
        const checkboxes = document.querySelectorAll('.song-checkbox:checked');
        const count = checkboxes.length;
        const btn = document.getElementById('batch-delete-btn');
        const countSpan = document.getElementById('selected-count');

        if (countSpan) countSpan.textContent = count;
        if (btn) btn.disabled = count === 0;

        // 更新全选复选框状态
        const allCheckboxes = document.querySelectorAll('.song-checkbox');
        const selectAllCheckbox = document.getElementById('select-all-checkbox');
        if (selectAllCheckbox && allCheckboxes.length > 0) {
            selectAllCheckbox.checked = count === allCheckboxes.length;
            selectAllCheckbox.indeterminate = count > 0 && count < allCheckboxes.length;
        }
    }

    // 全选/取消全选
    toggleAllSongs(checked) {
        document.querySelectorAll('.song-checkbox').forEach(cb => {
            cb.checked = checked;
        });
        this.updateBatchDeleteBtn();
    }

    // 全选
    selectAllSongs() {
        document.querySelectorAll('.song-checkbox').forEach(cb => {
            cb.checked = true;
        });
        this.updateBatchDeleteBtn();
    }

    // 反选
    invertSelection() {
        document.querySelectorAll('.song-checkbox').forEach(cb => {
            cb.checked = !cb.checked;
        });
        this.updateBatchDeleteBtn();
    }

    // 清空选择
    clearSelection() {
        document.querySelectorAll('.song-checkbox').forEach(cb => {
            cb.checked = false;
        });
        this.updateBatchDeleteBtn();
    }

    // 批量删除歌曲
    async batchDeleteSongs() {
        const checkboxes = document.querySelectorAll('.song-checkbox:checked');
        if (checkboxes.length === 0) return;

        const playlistIndex = this.currentPlaylistView;
        const playlist = this.currentUserData?.data?.userList?.[playlistIndex];
        if (!playlist) return;

        if (!(await showSelect('批量删除', `确定要删除选中的 ${checkboxes.length} 首歌曲吗？`, { danger: true }))) return;

        try {
            // 获取选中歌曲的索引（需要从大到小排序，避免删除时索引变化）
            const songIndices = Array.from(checkboxes)
                .map(cb => parseInt(cb.dataset.index))
                .sort((a, b) => b - a);

            await this.request('/api/data/batch-delete-songs', {
                method: 'POST',
                body: JSON.stringify({
                    username: this.currentUserData.username,
                    playlistId: playlist.id,
                    songIndices: songIndices
                })
            });

            showSuccess('批量删除成功！');
            await this.loadUserData();
            this.viewPlaylistDetails(playlistIndex);
        } catch (err) {
            showError('批量删除失败: ' + err.message);
        }
    }

    // 筛选歌曲
    filterSongs() {
        const searchText = document.getElementById('song-search')?.value.toLowerCase() || '';
        const rows = document.querySelectorAll('.song-row');

        rows.forEach(row => {
            const nameEl = row.querySelector('.song-col-name');
            const artistEl = row.querySelector('.song-col-artist');
            const name = nameEl?.textContent.toLowerCase() || '';
            const artist = artistEl?.textContent.toLowerCase() || '';

            if (name.includes(searchText) || artist.includes(searchText)) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    }

    // 排序歌曲
    sortSongs() {
        const sortValue = document.getElementById('song-sort')?.value;
        if (!sortValue) {
            // 恢复默认顺序 - 重新渲染
            if (typeof this.currentPlaylistView === 'number') {
                this.viewPlaylistDetails(this.currentPlaylistView);
            } else if (typeof this.currentPlaylistView === 'string') {
                this.viewSystemList(this.currentPlaylistView);
            }
            return;
        }

        const [field, order] = sortValue.split('-');
        const tbody = document.querySelector('.songs-table');
        const rows = Array.from(document.querySelectorAll('.song-row'));

        rows.sort((a, b) => {
            let aValue, bValue;

            if (field === 'name') {
                aValue = a.querySelector('.song-col-name')?.textContent || '';
                bValue = b.querySelector('.song-col-name')?.textContent || '';
            } else if (field === 'artist') {
                aValue = a.querySelector('.song-col-artist')?.textContent || '';
                bValue = b.querySelector('.song-col-artist')?.textContent || '';
            }

            const comparison = aValue.localeCompare(bValue, 'zh-CN');
            return order === 'asc' ? comparison : -comparison;
        });

        // 重新插入排序后的行
        const header = tbody.querySelector('.songs-table-header');
        rows.forEach(row => tbody.appendChild(row));
    }

    // 查看所有歌曲
    viewAllSongs() {
        const data = this.currentUserData?.data;
        if (!data) return;

        this.currentPlaylistView = 'all';
        const tabsContainer = document.getElementById('data-tabs-container');
        if (tabsContainer) tabsContainer.classList.add('hidden');

        // 收集所有歌曲
        let allSongs = [];

        // 添加试听列表
        if (data.defaultList && data.defaultList.length) {
            data.defaultList.forEach(song => {
                allSongs.push({ ...song, _source: '试听列表' });
            });
        }

        // 添加我的收藏
        if (data.loveList && data.loveList.length) {
            data.loveList.forEach(song => {
                allSongs.push({ ...song, _source: '我的收藏' });
            });
        }

        // 添加自定义列表中的歌曲
        if (data.userList && data.userList.length) {
            data.userList.forEach(list => {
                if (list.list && list.list.length) {
                    list.list.forEach(song => {
                        allSongs.push({ ...song, _source: list.name });
                    });
                }
            });
        }

        let content = `
            <div class="playlist-detail-header">
                <button onclick="app.renderCurrentDataTab()" class="btn-back">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
                    </svg>
                    返回列表
                </button>
                <h3>所有歌曲</h3>
                <div class="playlist-detail-meta">
                    <span>总计 ${allSongs.length} 首歌曲</span>
                </div>
            </div>
        `;

        if (allSongs.length) {
            content += `
                <div class="search-sort-bar">
                    <div class="search-box">
                        <input type="text" id="song-search" placeholder="搜索歌曲、歌手..." oninput="app.filterSongs()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                        </svg>
                    </div>
                    <select id="song-sort" onchange="app.sortSongs()" class="sort-select">
                        <option value="">默认排序</option>
                        <option value="name-asc">歌曲名 ↑</option>
                        <option value="name-desc">歌曲名 ↓</option>
                        <option value="artist-asc">歌手 ↑</option>
                        <option value="artist-desc">歌手 ↓</option>
                        <option value="source-asc">所属列表 ↑</option>
                        <option value="source-desc">所属列表 ↓</option>
                    </select>
                </div>
            `;
            content += '<div class="songs-table">';
            content += `
                <div class="songs-table-header">
                    <div class="song-col-index">#</div>
                    <div class="song-col-name">歌曲</div>
                    <div class="song-col-artist">歌手</div>
                    <div class="song-col-playlist">所属列表</div>
                </div>
            `;

            allSongs.forEach((song, songIndex) => {
                content += `
                    <div class="song-row">
                        <div class="song-col-index">${songIndex + 1}</div>
                        ${this.renderSongNameCell(song)}
                        <div class="song-col-artist" title="${this.escapeHtml(song.singer || '未知歌手')}">${this.escapeHtml(song.singer || '未知歌手')}</div>
                        <div class="song-col-playlist">${this.escapeHtml(song._source)}</div>
                    </div>
                `;
            });

            content += '</div>';
        } else {
            content += '<p style="color: var(--text-secondary); padding: 2rem; text-align: center;">暂无歌曲</p>';
        }

        document.getElementById('data-content').innerHTML = content;
    }

    async loadConfig() {
        try {
            const config = await this.request('/api/config');
            this.configLoaded = true;
            this.loadedConfig = config; // 保存原始配置，供 saveConfig 对比「需重启」字段是否变更
            const form = document.getElementById('config-form');
            this.populateBackupForms(config);

            if (form.elements['serverName']) form.elements['serverName'].value = config.serverName || '';
            if (form.elements['debug.enabled']) {
                form.elements['debug.enabled'].checked = config['debug.enabled'] || false;
            }
            if (form.elements['maxSnapshotNum']) form.elements['maxSnapshotNum'].value = config.maxSnapshotNum || 10;
            if (form.elements['list.addMusicLocationType']) form.elements['list.addMusicLocationType'].value = config['list.addMusicLocationType'] || 'top';
            if (form.elements['proxy.enabled']) form.elements['proxy.enabled'].checked = config['proxy.enabled'] || false;
            if (form.elements['proxy.header']) form.elements['proxy.header'].value = config['proxy.header'] || '';
            if (form.elements['proxy.all.enabled']) {
                form.elements['proxy.all.enabled'].checked = config['proxy.all.enabled'] || false;
            }
            if (form.elements['proxy.all.address']) {
                form.elements['proxy.all.address'].value = config['proxy.all.address'] || '';
            }
            // 细分代理：enabled 为 undefined -> 沿用统一代理
            ['music', 'customSource', 'app'].forEach(cat => {
                const modeSel = form.elements[`proxy.${cat}.mode`];
                if (modeSel) {
                    const enabled = config[`proxy.${cat}.enabled`];
                    modeSel.value = enabled === undefined || enabled === null ? 'inherit' : (enabled ? 'on' : 'off');
                }
                const addrEl = form.elements[`proxy.${cat}.address`];
                if (addrEl) addrEl.value = config[`proxy.${cat}.address`] || '';
            });
            this.updateProxyFieldsVisibility();
            if (form.elements['user.enablePath']) {
                form.elements['user.enablePath'].checked = config['user.enablePath'] !== false;
            }
            if (form.elements['user.enableRoot']) {
                form.elements['user.enableRoot'].checked = config['user.enableRoot'] === true;
            }
            if (form.elements['user.enablePublicRestriction']) {
                form.elements['user.enablePublicRestriction'].checked = config['user.enablePublicRestriction'] === true;
            }
            if (form.elements['user.enablePublicNonAdminLocalMusic']) {
                form.elements['user.enablePublicNonAdminLocalMusic'].checked = config['user.enablePublicNonAdminLocalMusic'] === true;
            }
            if (form.elements['user.enablePublicNonAdminBrowserDownload']) {
                form.elements['user.enablePublicNonAdminBrowserDownload'].checked = config['user.enablePublicNonAdminBrowserDownload'] !== false;
            }
            if (form.elements['user.enablePublicNonAdminServerCache']) {
                form.elements['user.enablePublicNonAdminServerCache'].checked = config['user.enablePublicNonAdminServerCache'] === true;
            }
            this.togglePublicNonAdminLocalMusicVisibility();
            if (form.elements['user.enablePublicFavorites']) {
                form.elements['user.enablePublicFavorites'].checked = config['user.enablePublicFavorites'] === true;
            }
            if (form.elements['user.enablePublicNonAdminAccess']) {
                form.elements['user.enablePublicNonAdminAccess'].checked = config['user.enablePublicNonAdminAccess'] === true;
            }
            this.togglePublicNonAdminAccessVisibility();
            if (form.elements['user.enableLoginCacheRestriction']) {
                form.elements['user.enableLoginCacheRestriction'].checked = config['user.enableLoginCacheRestriction'] === true;
            }
            if (form.elements['user.enableCacheSizeLimit']) {
                form.elements['user.enableCacheSizeLimit'].checked = config['user.enableCacheSizeLimit'] === true;
            }
            if (form.elements['user.cacheSizeLimit']) {
                form.elements['user.cacheSizeLimit'].value = config['user.cacheSizeLimit'] || 2000;
            }
            if (form.elements['cache.maxAgeDays']) {
                form.elements['cache.maxAgeDays'].value = config['cache.maxAgeDays'] ?? 14;
            }
            if (form.elements['system.allowUnsafeVM']) {
                form.elements['system.allowUnsafeVM'].checked = config['system.allowUnsafeVM'] === true;
            }

            if (form.elements['admin.password']) form.elements['admin.password'].value = config['admin.password'] || '';

            // Web播放器配置
            if (form.elements['player.name']) {
                form.elements['player.name'].value = config['player.name'] || 'LX Music Web';
            }
            if (form.elements['player.enableAuth']) {
                form.elements['player.enableAuth'].checked = config['player.enableAuth'] === true;
            }
            if (form.elements['player.password']) {
                form.elements['player.password'].value = config['player.password'] || '';
            }

            // URL路径配置
            if (form.elements['admin.path']) {
                form.elements['admin.path'].value = config['admin.path'] ?? '';
            }
            if (form.elements['player.path']) {
                const pPath = config['player.path'] ?? '/';
                form.elements['player.path'].value = pPath === '' ? '/' : pPath;
            }

            // 动态同步更新所有播放器链接 (侧边栏、登录面板等)
            this.updatePlayerLinks(config['player.path']);

            // 自定义歌曲目录配置
            if (form.elements['user.enableCustomMusicDir']) {
                form.elements['user.enableCustomMusicDir'].checked = config['user.enableCustomMusicDir'] === true;
            }
            const configJsPathRef = document.getElementById('config-js-path-ref');
            if (configJsPathRef && config.configFilePath) {
                configJsPathRef.textContent = config.configFilePath;
            }
            const configBackupJsPathRef = document.getElementById('config-backup-js-path-ref');
            if (configBackupJsPathRef && config.configFilePath) {
                configBackupJsPathRef.textContent = config.configFilePath;
            }
            this.initCustomSelects();
            this.syncCustomSelects();
        } catch (err) {
            console.error('Failed to load config:', err);
        }
    }

    toggleWebdavVisibility() {
        const webdavCb = document.querySelector('input[name="webdav.enable"]');
        const childWrapper = document.getElementById('webdav-options');
        const hintWrapper = document.getElementById('webdav-disabled-hint');
        const operations = document.getElementById('webdav-operation-panel');
        if (operations) operations.style.display = webdavCb?.checked && this.loadedConfig?.['webdav.enable'] === true ? '' : 'none';
        if (webdavCb && childWrapper && hintWrapper) {
            if (webdavCb.checked) {
                childWrapper.style.display = 'block';
                hintWrapper.style.display = 'none';
            } else {
                childWrapper.style.display = 'none';
                hintWrapper.style.display = 'block';
            }
        }
    }

    toggleSubsonicCustomPlaylistVisibility() {
        const panel = document.getElementById('subsonic-custom-playlist-options');
        const enabled = document.querySelector('input[name="subsonic.localPlaylist"]')?.checked;
        if (panel) panel.style.display = enabled ? '' : 'none';
    }

    toggleSubsonicLeaderboardVisibility() {
        const lbCb = document.querySelector('input[name="subsonic.publicLeaderboards"]');
        const childWrapper = document.getElementById('subsonic-leaderboard-options');
        if (lbCb && childWrapper) {
            childWrapper.style.display = lbCb.checked ? 'block' : 'none';
        }
    }

    updateTagGroupActive(groupId, value) {
        const container = document.getElementById(groupId);
        if (!container) return;
        container.querySelectorAll('.tag-select-item').forEach(i => {
            i.classList.toggle('active', i.getAttribute('data-value') === value);
        });
    }

    initTagSelectors() {
        // 排行榜平台单选
        const lbContainer = document.getElementById('tag-group-leaderboard-source');
        if (lbContainer) {
            lbContainer.querySelectorAll('.tag-select-item').forEach(item => {
                item.addEventListener('click', () => {
                    const val = item.getAttribute('data-value');
                    const hiddenInput = document.querySelector('input[name="subsonic.leaderboardSource"]');
                    if (hiddenInput) hiddenInput.value = val;
                    lbContainer.querySelectorAll('.tag-select-item').forEach(i => i.classList.remove('active'));
                    item.classList.add('active');
                });
            });
        }
        // 共享歌单内容三态
        const modeContainer = document.getElementById('tag-group-shared-mode');
        if (modeContainer) {
            modeContainer.querySelectorAll('.tag-select-item').forEach(item => {
                item.addEventListener('click', () => {
                    const val = item.getAttribute('data-value');
                    const hiddenInput = document.querySelector('input[name="subsonic.sharedListMode"]');
                    if (hiddenInput) hiddenInput.value = val;
                    modeContainer.querySelectorAll('.tag-select-item').forEach(i => i.classList.remove('active'));
                    item.classList.add('active');
                });
            });
        }
        // 共享歌单排序
        const sortContainer = document.getElementById('tag-group-shared-sort');
        if (sortContainer) {
            sortContainer.querySelectorAll('.tag-select-item').forEach(item => {
                item.addEventListener('click', () => {
                    const val = item.getAttribute('data-value');
                    const hiddenInput = document.querySelector('input[name="subsonic.sharedListSort"]');
                    if (hiddenInput) hiddenInput.value = val;
                    sortContainer.querySelectorAll('.tag-select-item').forEach(i => i.classList.remove('active'));
                    item.classList.add('active');
                });
            });
        }

        // 在线搜索平台多选
        const searchContainer = document.getElementById('tag-group-search-sources');
        if (searchContainer) {
            searchContainer.querySelectorAll('.tag-select-item').forEach(item => {
                item.addEventListener('click', () => {
                    const hiddenInput = document.querySelector('input[name="subsonic.onlineSearchSources"]');
                    let activeVals = [];
                    item.classList.toggle('active');

                    searchContainer.querySelectorAll('.tag-select-item.active').forEach(act => {
                        activeVals.push(act.getAttribute('data-value'));
                    });

                    // 至少保留一个平台
                    if (activeVals.length === 0) {
                        item.classList.add('active');
                        activeVals.push(item.getAttribute('data-value'));
                    }

                    if (hiddenInput) hiddenInput.value = activeVals.join(',');
                });
            });
        }

        // 初始化音质及源优选拖拽排序标签
        this.updateQualityPriorityTagUI('flac,320k,128k');
        this.updateSourcePriorityTagUI('kw,tx,wy,mg,kg');
    }

    updateLeaderboardSourceTagUI(val) {
        const container = document.getElementById('tag-group-leaderboard-source');
        if (!container) return;
        container.querySelectorAll('.tag-select-item').forEach(item => {
            if (item.getAttribute('data-value') === val) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    updateSearchSourcesTagUI(valStr) {
        const container = document.getElementById('tag-group-search-sources');
        if (!container) return;
        const set = new Set((valStr || '').split(',').map(s => s.trim()).filter(Boolean));
        container.querySelectorAll('.tag-select-item').forEach(item => {
            const v = item.getAttribute('data-value');
            if (set.has(v)) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    renderSortableTagGroup(containerId, hiddenInputName, orderList, labelMap, allItems, allowEmpty = false) {
        const container = document.getElementById(containerId);
        const hiddenInput = document.querySelector(`input[name="${hiddenInputName}"]`);
        if (!container) return;

        // 当前启用的项列表 (按照 orderList 顺序)
        const enabledOrder = [];
        const seen = new Set();
        (orderList || []).forEach(val => {
            val = String(val).trim();
            if (allItems.includes(val) && !seen.has(val)) {
                enabledOrder.push(val);
                seen.add(val);
            }
        });

        // 未在 orderList 中的项为禁用项，排在最后
        const disabledOrder = [];
        allItems.forEach(val => {
            if (!seen.has(val)) {
                disabledOrder.push(val);
            }
        });

        // 同步隐藏输入框值（仅启用的项参与配置与优选，逗号分隔）
        const syncHiddenInput = () => {
            const activeVals = [];
            container.querySelectorAll('.tag-sortable-item:not(.disabled)').forEach(el => {
                activeVals.push(el.getAttribute('data-value'));
            });
            if (hiddenInput) {
                hiddenInput.value = activeVals.join(',');
            }
        };

        const refreshBadgesAndOrder = () => {
            let activeIdx = 1;
            container.querySelectorAll('.tag-sortable-item').forEach(el => {
                const badge = el.querySelector('.tag-index-badge');
                if (el.classList.contains('disabled')) {
                    if (badge) badge.textContent = '-';
                    el.draggable = false;
                } else {
                    if (badge) badge.textContent = activeIdx++;
                    el.draggable = true;
                }
            });
            syncHiddenInput();
        };

        container.innerHTML = '';

        const createTagElement = (val, isDisabled) => {
            const tag = document.createElement('div');
            tag.className = `tag-select-item tag-sortable-item ${isDisabled ? 'disabled' : 'active'}`;
            tag.draggable = !isDisabled;
            tag.setAttribute('data-value', val);
            tag.innerHTML = `
                <span class="tag-index-badge">-</span>
                <svg class="tag-drag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="8" y1="6" x2="16" y2="6"></line>
                    <line x1="8" y1="12" x2="16" y2="12"></line>
                    <line x1="8" y1="18" x2="16" y2="18"></line>
                </svg>
                <span class="tag-text">${labelMap[val] || val}</span>
                <span class="tag-toggle-btn" title="${isDisabled ? '点击启用并加入优选' : '点击禁用并移至末尾'}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;">
                        ${isDisabled ? '<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>' : '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>'}
                    </svg>
                </span>
            `;

            // 点击整块或点击按钮切换启用/禁用
            tag.addEventListener('click', (e) => {
                // 如果是拖拽动作触发的 click，不处理
                if (tag.dataset.wasDragged === 'true') {
                    delete tag.dataset.wasDragged;
                    return;
                }

                if (tag.classList.contains('disabled')) {
                    // 从禁用 -> 启用：插入到所有启用项的后面（即第一个 disabled 项前面）
                    tag.classList.remove('disabled');
                    tag.classList.add('active');
                    const toggleBtn = tag.querySelector('.tag-toggle-btn');
                    if (toggleBtn) {
                        toggleBtn.title = '点击禁用并移至末尾';
                        toggleBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
                    }
                    const firstDisabled = container.querySelector('.tag-sortable-item.disabled');
                    if (firstDisabled && firstDisabled !== tag) {
                        container.insertBefore(tag, firstDisabled);
                    } else {
                        container.appendChild(tag);
                    }
                } else {
                    // 从启用 -> 禁用：直接移到最后变灰
                    // 至少保留一项可用（allowEmpty 时允许全部移除，例如 OpenList 用户备份可清空）
                    const remainingActive = container.querySelectorAll('.tag-sortable-item:not(.disabled)');
                    if (!allowEmpty && remainingActive.length <= 1) {
                        if (typeof this?.showToast === 'function') {
                            this.showToast('至少需要保留一个可用项', 'warning');
                        }
                        return;
                    }

                    tag.classList.remove('active');
                    tag.classList.add('disabled');
                    const toggleBtn = tag.querySelector('.tag-toggle-btn');
                    if (toggleBtn) {
                        toggleBtn.title = '点击启用并加入优选';
                        toggleBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
                    }
                    // 移到末尾
                    container.appendChild(tag);
                }
                refreshBadgesAndOrder();
            });

            // 拖拽处理
            tag.addEventListener('dragstart', (e) => {
                if (tag.classList.contains('disabled')) {
                    e.preventDefault();
                    return;
                }
                tag.dataset.wasDragged = 'true';
                tag.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', val);
            });

            tag.addEventListener('dragend', () => {
                tag.classList.remove('dragging');
                container.querySelectorAll('.tag-sortable-item').forEach(el => el.classList.remove('drag-over'));
                refreshBadgesAndOrder();
                setTimeout(() => { delete tag.dataset.wasDragged; }, 100);
            });

            tag.addEventListener('dragover', (e) => {
                e.preventDefault();
                const dragging = container.querySelector('.dragging');
                if (!dragging || dragging === tag) return;
                // 拖拽只能在启用项之间排序，不能插到禁用项后面
                if (tag.classList.contains('disabled')) {
                    const firstDisabled = container.querySelector('.tag-sortable-item.disabled');
                    if (firstDisabled) {
                        container.insertBefore(dragging, firstDisabled);
                    }
                    return;
                }
                e.dataTransfer.dropEffect = 'move';
                const rect = tag.getBoundingClientRect();
                const next = (e.clientX - rect.left) > (rect.width / 2);
                container.insertBefore(dragging, next ? tag.nextSibling : tag);
            });

            tag.addEventListener('dragenter', (e) => {
                e.preventDefault();
                if (!tag.classList.contains('dragging') && !tag.classList.contains('disabled')) {
                    tag.classList.add('drag-over');
                }
            });

            tag.addEventListener('dragleave', () => {
                tag.classList.remove('drag-over');
            });

            return tag;
        };

        // 先渲染启用项，再渲染禁用项
        enabledOrder.forEach(val => container.appendChild(createTagElement(val, false)));
        disabledOrder.forEach(val => container.appendChild(createTagElement(val, true)));

        refreshBadgesAndOrder();
    }

    updateQualityPriorityTagUI(valStr) {
        const list = (valStr || '').split(',').map(s => s.trim()).filter(Boolean);
        const labelMap = {
            'flac': '无损 (flac)',
            '320k': '高品 (320k)',
            '128k': '标准 (128k)'
        };
        const allItems = ['flac', '320k', '128k'];
        this.renderSortableTagGroup('tag-group-quality-priority', 'subsonic.quality.priority', list, labelMap, allItems);
    }

    updateSourcePriorityTagUI(valStr) {
        const list = (valStr || '').split(',').map(s => s.trim()).filter(Boolean);
        const labelMap = {
            'kw': '酷我音乐 (kw)',
            'tx': 'QQ 音乐 (tx)',
            'wy': '网易云 (wy)',
            'mg': '咪咕音乐 (mg)',
            'kg': '酷狗音乐 (kg)'
        };
        const allItems = ['kw', 'tx', 'wy', 'mg', 'kg'];
        this.renderSortableTagGroup('tag-group-source-priority', 'subsonic.source.priority', list, labelMap, allItems);
    }

    togglePublicNonAdminAccessVisibility() {
        const favCb = document.querySelector('input[name="user.enablePublicFavorites"]');
        const childWrapper = document.getElementById('public-non-admin-access-wrapper');
        if (favCb && childWrapper) {
            childWrapper.style.display = favCb.checked ? 'block' : 'none';
        }
    }

    togglePublicNonAdminLocalMusicVisibility() {
        const resCb = document.querySelector('input[name="user.enablePublicRestriction"]');
        const childWrapper = document.getElementById('public-non-admin-local-music-wrapper');
        if (resCb && childWrapper) {
            childWrapper.style.display = resCb.checked ? 'block' : 'none';
        }
    }

    toggleHelp(el) {
        const text = el.getAttribute('data-help') || ''
        const existing = document.querySelector('.help-pop')
        if (existing) {
            if (existing._owner === el) { existing.remove(); return }
            existing.remove()
        }
        if (!text) return
        const pop = document.createElement('div')
        pop.className = 'help-pop'
        pop._owner = el
        pop.textContent = text
        document.body.appendChild(pop)
        const r = el.getBoundingClientRect()
        pop.style.top = (window.scrollY + r.bottom + 6) + 'px'
        pop.style.left = (window.scrollX + r.left) + 'px'
        const pr = pop.getBoundingClientRect()
        if (pr.right > window.innerWidth - 8) pop.style.left = (window.scrollX + r.left - pr.width + r.width) + 'px'
        if (pr.bottom > window.innerHeight - 8) pop.style.top = (window.scrollY + r.top - pr.height - 6) + 'px'
        setTimeout(() => {
            const onDocClick = (e) => {
                if (!pop.contains(e.target) && e.target !== el) { pop.remove(); document.removeEventListener('click', onDocClick) }
            }
            document.addEventListener('click', onDocClick)
        }, 0)
    }

    async saveConfig(silent = false) {
        if (!this.configLoaded) return;
        const form = document.getElementById('config-form');
        const formData = new FormData(form);

        // 路径校验
        const adminPath = (formData.get('admin.path') || '').trim();
        const playerPath = (formData.get('player.path') || '').trim();
        const errEl = document.getElementById('path-conflict-error');
        let pathError = '';

        if (!playerPath) {
            pathError = '⚠️ 播放器路径不能为空';
        } else if (!playerPath.startsWith('/')) {
            pathError = '⚠️ 播放器路径必须以 / 开头';
        } else if (adminPath !== '' && !adminPath.startsWith('/')) {
            pathError = '⚠️ 后台路径必须以 / 开头（或留空表示根路径）';
        } else if ((adminPath || '/') === (playerPath === '/' ? '/' : playerPath.replace(/\/+$/, ''))) {
            pathError = '⚠️ 后台管理路径与播放器路径不能相同';
        } else if (adminPath.startsWith('/api') || playerPath.startsWith('/api')) {
            pathError = '⚠️ 路径不能以 /api 开头（与 API 路由冲突）';
        }

        if (errEl) {
            errEl.textContent = pathError;
            errEl.style.display = pathError ? 'block' : 'none';
        }
        if (pathError) return;

        // 备份相关字段已迁移至「备份管理」独立表单，此处仅提交「系统配置」表单自身字段，避免 FormData 缺失导致覆盖为默认值或 false
        const rawMaxAge = formData.get('cache.maxAgeDays');
        const parsedMaxAge = rawMaxAge !== null && rawMaxAge !== '' ? parseInt(rawMaxAge, 10) : NaN;
        const config = {
            serverName: formData.get('serverName'),
            'debug.enabled': formData.get('debug.enabled') === 'on',
            'list.addMusicLocationType': formData.get('list.addMusicLocationType'),
            'proxy.enabled': formData.get('proxy.enabled') === 'on',
            'proxy.header': formData.get('proxy.header'),
            'proxy.all.enabled': formData.get('proxy.all.enabled') === 'on',
            'proxy.all.address': formData.get('proxy.all.address'),
            ...(() => {
                const out = {};
                ['music', 'customSource', 'app'].forEach(cat => {
                    const mode = formData.get(`proxy.${cat}.mode`);
                    // null = 沿用统一代理（服务端写回 undefined）
                    out[`proxy.${cat}.enabled`] = (mode === 'inherit' || mode == null) ? null : (mode === 'on');
                    out[`proxy.${cat}.address`] = formData.get(`proxy.${cat}.address`) || '';
                });
                return out;
            })(),
            'user.enablePath': formData.get('user.enablePath') === 'on',
            'user.enableRoot': formData.get('user.enableRoot') === 'on',
            'user.enablePublicRestriction': formData.get('user.enablePublicRestriction') === 'on',
            'user.enablePublicNonAdminLocalMusic': formData.get('user.enablePublicNonAdminLocalMusic') === 'on',
            'user.enablePublicNonAdminBrowserDownload': formData.get('user.enablePublicNonAdminBrowserDownload') === 'on',
            'user.enablePublicNonAdminServerCache': formData.get('user.enablePublicNonAdminServerCache') === 'on',
            'user.enablePublicFavorites': formData.get('user.enablePublicFavorites') === 'on',
            'user.enablePublicNonAdminAccess': formData.get('user.enablePublicNonAdminAccess') === 'on',
            'user.enableCustomMusicDir': formData.get('user.enableCustomMusicDir') === 'on',
            'user.enableLoginCacheRestriction': formData.get('user.enableLoginCacheRestriction') === 'on',
            'user.enableCacheSizeLimit': formData.get('user.enableCacheSizeLimit') === 'on',
            'user.cacheSizeLimit': parseInt(formData.get('user.cacheSizeLimit')) || 2000,
            ...(Number.isFinite(parsedMaxAge) ? { 'cache.maxAgeDays': Math.max(0, parsedMaxAge) } : {}),
            'admin.password': formData.get('admin.password'),
            'player.name': (formData.get('player.name') || '').trim() || 'LX Music Web',
            'player.enableAuth': formData.get('player.enableAuth') === 'on',
            'player.password': formData.get('player.password'),
            'admin.path': adminPath,
            'player.path': playerPath,
            'system.allowUnsafeVM': formData.get('system.allowUnsafeVM') === 'on',
        };

        // [需要重启] 以下配置仅在进程启动时由 server.ts 读取
        // （startSubsonicStandaloneServer / handleStartServer），保存后不会即时生效，必须重启服务。
        // 检测本次保存是否实际修改了它们，若是则提示用户重启。
        const restartRequiredKeys = []; // Subsonic 重启检测已移至 saveSubsonicConfig
        const prevConfig = this.loadedConfig || {};
        const changedRestartKeys = restartRequiredKeys.filter(k => {
            if (k === 'subsonic.port') return Number(config[k]) !== Number(prevConfig[k]);
            return config[k] !== prevConfig[k];
        });
        const needRestart = changedRestartKeys.length > 0;

        try {
            const res = await this.request('/api/config', {
                method: 'POST',
                body: JSON.stringify(config)
            });

            // 如果密码改了，更新本地存储
            if (config['admin.password'] && config['admin.password'] !== this.password) {
                this.password = config['admin.password'];
                localStorage.setItem('lx_auth', config['admin.password']);
            }

            // 动态同步更新所有播放器链接
            this.updatePlayerLinks(playerPath);

            // 保存成功后同步「已加载配置」，供下次保存对比
            this.loadedConfig = config;

            if (!silent) {
                if (res.warning) {
                    showInfo('配置保存成功！\n\n⚠️ 警告：' + res.warning);
                } else {
                    showSuccess('配置保存成功！');
                }
            }
            // 即使静默保存（如「重载配置 / 刷新用户」调用 saveConfig(true)），
            // 只要改动了需重启才生效的配置（subsonic.standalone / subsonic.port 等），
            // 也必须提示重启，否则独立端口仍在监听而表单已显示关闭，造成状态不一致
            if (needRestart) {
                const ok = await showSelect(
                    '需要重启服务器',
                    `你修改了以下「需重启才能生效」的配置：\n\n• ${changedRestartKeys.join('\n• ')}\n\n` +
                    `当前修改已保存，但必须重启 lx-server 后才会生效（例如 Subsonic 独立端口）。\n是否立即重启服务器？`,
                    { danger: true, confirmText: '立即重启', cancelText: '稍后手动重启' }
                );
                if (ok) {
                    try {
                        const r = await this.request('/api/restart', { method: 'POST' });
                        if (r.success) {
                            showSuccess('服务器正在重启，新配置（如 Subsonic 独立端口）将在重启后生效。\n\n页面将在 5 秒后自动刷新。');
                            setTimeout(() => window.location.reload(), 5000);
                            return true;
                        } else {
                            showError('重启失败: ' + (r.message || '未知错误'));
                        }
                    } catch (e) {
                        showError('重启请求失败: ' + e.message);
                    }
                }
            }
        } catch (err) {
            if (!silent) showError('配置保存失败: ' + err.message);
            throw err;
        }
    }


    async loadSubsonicConfig() {
        const form = document.getElementById('subsonic-form');
        if (!form) return;
        try {
            const config = await this.request('/api/config');
            // 保存 Subsonic 专用基准配置，供 saveSubsonicConfig 对比「需重启」字段是否变更。
            // 不能复用 loadedConfig：它会被主表单 saveConfig 覆盖为不含 subsonic.* 的载荷。
            this.loadedSubsonicConfig = config;
            if (form.elements['singer.sourcePriority']) {
                form.elements['singer.sourcePriority'].value = config['singer.sourcePriority'] || 'tx,wy';
            }
            // Subsonic 配置
            if (form.elements['subsonic.enable']) {
                form.elements['subsonic.enable'].checked = config['subsonic.enable'] === true;
            }
            if (form.elements['subsonic.path']) {
                form.elements['subsonic.path'].value = config['subsonic.path'] || '/rest';
            }
            if (form.elements['subsonic.enableDebug']) {
                form.elements['subsonic.enableDebug'].checked = config['subsonic.enableDebug'] === true;
            }
            if (form.elements['subsonic.port']) {
                form.elements['subsonic.port'].value = config['subsonic.port'] || 0;
            }
            // Subsonic 独立端口开关：以 subsonic.standalone 独立开关为准，切换端口输入框显隐
            const standaloneToggle = document.getElementById('subsonic-standalone-toggle');
            const standaloneFields = document.getElementById('subsonic-standalone-fields');
            const portErrEl = document.getElementById('subsonic-port-error');
            if (standaloneToggle && standaloneFields) {
                // subsonic.standalone 为独立开关；旧配置无此键时按默认值(关闭)处理
                const enabled = config['subsonic.standalone'] !== undefined
                    ? !!config['subsonic.standalone']
                    : false;
                standaloneToggle.checked = enabled;
                standaloneFields.classList.toggle('hidden', !enabled);
                const portInput = form.elements['subsonic.port'];
                if (portInput) portInput.min = enabled ? '1' : '0';
                standaloneToggle.onchange = () => {
                    const on = standaloneToggle.checked;
                    standaloneFields.classList.toggle('hidden', !on);
                    const portInput = form.elements['subsonic.port'];
                    if (on && (!portInput.value || parseInt(portInput.value) === 0)) {
                        portInput.value = 4050;
                    }
                    // 独立监听关闭时端口最小值允许为 0，开启时最小为 1
                    portInput.min = on ? '1' : '0';
                    // 关闭开关不再清零端口：端口值保留，重新开启无需重填
                    if (portErrEl && !on) {
                        portErrEl.style.display = 'none';
                    }
                };
            }
            if (portErrEl) {
                const currentPort = parseInt(config['subsonic.port']) || 0;
                if (config.subsonicPortConflict && config.subsonicPortConflict.port === currentPort && currentPort > 0) {
                    portErrEl.textContent = `⚠️ 独立端口 ${currentPort} 启动失败（${config.subsonicPortConflict.error || '端口已被占用'}），配置未生效，请更换端口后保存并重启服务器。`;
                    portErrEl.style.display = 'block';
                } else {
                    portErrEl.style.display = 'none';
                }
            }
            if (form.elements['subsonic.onlineSearch']) {
                form.elements['subsonic.onlineSearch'].checked = config['subsonic.onlineSearch'] !== false;
            }
            if (form.elements['subsonic.onlineSearchMode']) {
                form.elements['subsonic.onlineSearchMode'].value = config['subsonic.onlineSearchMode'] || 'fallback';
            }
            if (form.elements['subsonic.onlineSearchSources']) {
                const searchSources = config['subsonic.onlineSearchSources'] || 'wy,tx,kw,kg,mg';
                form.elements['subsonic.onlineSearchSources'].value = searchSources;
                this.updateSearchSourcesTagUI(searchSources);
            }
            if (form.elements['subsonic.localPlaylist']) {
                form.elements['subsonic.localPlaylist'].checked = config['subsonic.localPlaylist'] !== false;
            }
            if (form.elements['subsonic.customPlaylist']) {
                form.elements['subsonic.customPlaylist'].checked = config['subsonic.customPlaylist'] !== false;
            }
            this.toggleSubsonicCustomPlaylistVisibility();
            if (form.elements['subsonic.publicLeaderboards']) {
                form.elements['subsonic.publicLeaderboards'].checked = config['subsonic.publicLeaderboards'] === true;
            }
            if (form.elements['subsonic.leaderboardSource']) {
                const lbSource = config['subsonic.leaderboardSource'] || 'tx';
                form.elements['subsonic.leaderboardSource'].value = lbSource;
                this.updateLeaderboardSourceTagUI(lbSource);
            }
            if (form.elements['subsonic.sharedListMode']) {
                const mode = config['subsonic.sharedListMode'] || 'leaderboard';
                form.elements['subsonic.sharedListMode'].value = mode;
                this.updateTagGroupActive('tag-group-shared-mode', mode);
            }
            if (form.elements['subsonic.sharedListSort']) {
                const sort = config['subsonic.sharedListSort'] || 'hot';
                form.elements['subsonic.sharedListSort'].value = sort;
                this.updateTagGroupActive('tag-group-shared-sort', sort);
            }
            this.toggleSubsonicLeaderboardVisibility();
            if (form.elements['subsonic.lyricTranslation']) {
                form.elements['subsonic.lyricTranslation'].checked = config['subsonic.lyricTranslation'] !== false;
            }
            if (form.elements['subsonic.cacheOnPlay']) {
                form.elements['subsonic.cacheOnPlay'].checked = config['subsonic.cacheOnPlay'] === true;
            }
            if (form.elements['subsonic.playCacheFirst']) {
                form.elements['subsonic.playCacheFirst'].checked = config['subsonic.playCacheFirst'] === true;
            }
            if (form.elements['subsonic.playCacheFirstUseOpenlist']) {
                form.elements['subsonic.playCacheFirstUseOpenlist'].checked = config['subsonic.playCacheFirstUseOpenlist'] === true;
            }
            if (form.elements['subsonic.openlistDelivery']) {
                form.elements['subsonic.openlistDelivery'].value = config['subsonic.openlistDelivery'] || 'direct';
            }


            // 不喜欢 / 评分联动
            if (form.elements['subsonic.dislikeRating'] !== undefined) {
                form.elements['subsonic.dislikeRating'].value = String(config['subsonic.dislikeRating'] ?? 1);
            }
            if (form.elements['subsonic.hideDisliked']) {
                form.elements['subsonic.hideDisliked'].checked = config['subsonic.hideDisliked'] !== false;
            }
            if (form.elements['subsonic.dislikeCrossSource']) {
                form.elements['subsonic.dislikeCrossSource'].checked = config['subsonic.dislikeCrossSource'] === true;
            }
            if (form.elements['subsonic.dislikeNoRecommend']) {
                form.elements['subsonic.dislikeNoRecommend'].checked = config['subsonic.dislikeNoRecommend'] !== false;
            }
            if (form.elements['subsonic.dislikeDuetMode']) {
                form.elements['subsonic.dislikeDuetMode'].value = config['subsonic.dislikeDuetMode'] || 'any';
            }
            if (form.elements['subsonic.dislikeNormalizeName']) {
                form.elements['subsonic.dislikeNormalizeName'].checked = config['subsonic.dislikeNormalizeName'] !== false;
            }
            if (form.elements['subsonic.dislikeRequireSinger']) {
                form.elements['subsonic.dislikeRequireSinger'].checked = config['subsonic.dislikeRequireSinger'] !== false;
            }
            if (form.elements['subsonic.ratingPlaylists']) {
                form.elements['subsonic.ratingPlaylists'].checked = config['subsonic.ratingPlaylists'] !== false;
            }
            if (form.elements['subsonic.linkRatingToDislike']) {
                form.elements['subsonic.linkRatingToDislike'].checked = config['subsonic.linkRatingToDislike'] === true;
            }

            // 音质 / 源优选
            if (form.elements['subsonic.quality.enabled']) {
                form.elements['subsonic.quality.enabled'].checked = config['subsonic.quality.enabled'] !== false;
            }
            if (form.elements['subsonic.quality.priority']) {
                const qVal = config['subsonic.quality.priority'] || 'flac,320k,128k';
                form.elements['subsonic.quality.priority'].value = qVal;
                this.updateQualityPriorityTagUI(qVal);
            }

            if (form.elements['subsonic.source.priority']) {
                const sVal = config['subsonic.source.priority'] || 'kw,tx,wy,mg,kg';
                form.elements['subsonic.source.priority'].value = sVal;
                this.updateSourcePriorityTagUI(sVal);
            }
            if (form.elements['subsonic.source.crossPlatform']) {
                form.elements['subsonic.source.crossPlatform'].checked = config['subsonic.source.crossPlatform'] !== false;
            }
            if (form.elements['subsonic.source.autoSwitchCustom']) {
                form.elements['subsonic.source.autoSwitchCustom'].checked = config['subsonic.source.autoSwitchCustom'] !== false;
            }

            this.initCustomSelects();
            this.syncCustomSelects();
            this.bindLinkSyncToggles();
            this.updateLinkSyncUI();
            void this.loadLinkSyncUsers();
        } catch (e) {
            console.error('Failed to load subsonic config:', e);
        }
    }

    async saveSubsonicConfig() {
        const form = document.getElementById('subsonic-form');
        if (!form) return;
        const formData = new FormData(form);
        const config = {
            'subsonic.enable': formData.get('subsonic.enable') === 'on',
            'subsonic.standalone': document.getElementById('subsonic-standalone-toggle')?.checked
                ?? false,
            'subsonic.path': (formData.get('subsonic.path') || '').trim() || '/rest',
            'subsonic.enableDebug': formData.get('subsonic.enableDebug') === 'on',
            'subsonic.port': parseInt(formData.get('subsonic.port')) || 0,
            'subsonic.onlineSearch': formData.get('subsonic.onlineSearch') === 'on',
            'subsonic.onlineSearchMode': formData.get('subsonic.onlineSearchMode') || 'fallback',
            'subsonic.onlineSearchSources': (formData.get('subsonic.onlineSearchSources') || '').trim() || 'wy,tx,kw,kg,mg',
            'subsonic.localPlaylist': formData.get('subsonic.localPlaylist') === 'on',
            'subsonic.customPlaylist': formData.get('subsonic.customPlaylist') === 'on',
            'subsonic.publicLeaderboards': formData.get('subsonic.publicLeaderboards') === 'on',
            'subsonic.leaderboardSource': (formData.get('subsonic.leaderboardSource') || '').trim() || 'tx',
            'subsonic.sharedListMode': (formData.get('subsonic.sharedListMode') || '').trim() || 'leaderboard',
            'subsonic.sharedListSort': (formData.get('subsonic.sharedListSort') || '').trim() || 'hot',
            'subsonic.lyricTranslation': formData.get('subsonic.lyricTranslation') === 'on',
            'subsonic.cacheOnPlay': formData.get('subsonic.cacheOnPlay') === 'on',
            'subsonic.playCacheFirst': formData.get('subsonic.playCacheFirst') === 'on',
            'subsonic.playCacheFirstUseOpenlist': formData.get('subsonic.playCacheFirstUseOpenlist') === 'on',
            'subsonic.openlistDelivery': (formData.get('subsonic.openlistDelivery') || 'direct').trim(),

            'subsonic.dislikeRating': Number(formData.get('subsonic.dislikeRating') || 1),
            'subsonic.hideDisliked': formData.get('subsonic.hideDisliked') === 'on',
            'subsonic.dislikeCrossSource': formData.get('subsonic.dislikeCrossSource') === 'on',
            'subsonic.dislikeNoRecommend': formData.get('subsonic.dislikeNoRecommend') === 'on',
            'subsonic.dislikeDuetMode': formData.get('subsonic.dislikeDuetMode') || 'any',
            'subsonic.dislikeNormalizeName': formData.get('subsonic.dislikeNormalizeName') === 'on',
            'subsonic.dislikeRequireSinger': formData.get('subsonic.dislikeRequireSinger') === 'on',
            'subsonic.ratingPlaylists': formData.get('subsonic.ratingPlaylists') === 'on',
            'subsonic.linkRatingToDislike': formData.get('subsonic.linkRatingToDislike') === 'on',
            'subsonic.quality.enabled': formData.get('subsonic.quality.enabled') === 'on',
            'subsonic.quality.priority': (formData.get('subsonic.quality.priority') || '').trim() || 'flac,320k,128k',

            'subsonic.source.priority': (formData.get('subsonic.source.priority') || '').trim() || 'kw,tx,wy,mg,kg',
            'subsonic.source.crossPlatform': formData.get('subsonic.source.crossPlatform') === 'on',
            'subsonic.source.autoSwitchCustom': formData.get('subsonic.source.autoSwitchCustom') === 'on',
            'singer.sourcePriority': formData.get('singer.sourcePriority'),
        };
        // [校验] 启用独立监听端口时，端口必须是 1-65535 的合法整数，否则独立监听无法启动；
        // 校验不通过则中止保存并提示，不再向服务端发送请求
        if (config['subsonic.standalone']) {
            const port = Number(config['subsonic.port']);
            if (!Number.isInteger(port) || port < 1 || port > 65535) {
                showError('已启用 Subsonic 独立监听端口，但端口号不合法（需为 1-65535 的整数）。请先填写合法端口再保存。');
                return;
            }
        }
        const restartRequiredKeys = ['subsonic.enable', 'subsonic.standalone', 'subsonic.port'];
        const prevConfig = this.loadedSubsonicConfig || {};
        const changedRestartKeys = restartRequiredKeys.filter(k => {
            if (k === 'subsonic.port') return Number(config[k]) !== Number(prevConfig[k]);
            return config[k] !== prevConfig[k];
        });
        const needRestart = changedRestartKeys.length > 0;
        try {
            const res = await this.request('/api/config', {
                method: 'POST',
                body: JSON.stringify(config)
            });
            this.loadedSubsonicConfig = Object.assign({}, this.loadedSubsonicConfig || {}, config);
            this.updateLinkSyncUI();
            if (res.warning) {
                showInfo('Subsonic 配置保存成功！\n\n⚠️ 警告：' + res.warning);
            } else {
                const linkChanged = ['subsonic.dislikeRating', 'subsonic.linkRatingToDislike'].some(k => config[k] !== prevConfig[k]);
                showSuccess('Subsonic 配置保存成功！' + (linkChanged ? '\n联动配置对后续操作生效，历史评分和不喜欢不会自动重算或删除。' : ''));
            }
            if (needRestart) {
                const ok = await showSelect(
                    '需要重启服务器',
                    '你修改了以下「需重启才能生效」的配置：\n\n• ' + changedRestartKeys.join('\n• ') + '\n\n' +
                    '当前修改已保存，但必须重启 lx-server 后才会生效（例如 Subsonic 独立端口）。\n是否立即重启服务器？',
                    { danger: true, confirmText: '立即重启', cancelText: '稍后手动重启' }
                );
                if (ok) {
                    try {
                        const r = await this.request('/api/restart', { method: 'POST' });
                        if (r.success) {
                            showSuccess('服务器正在重启，新配置（如 Subsonic 独立端口）将在重启后生效。\n\n页面将在 5 秒后自动刷新。');
                            setTimeout(() => window.location.reload(), 5000);
                        } else {
                            showError('重启失败: ' + (r.message || '未知错误'));
                        }
                    } catch (e) {
                        showError('重启请求失败: ' + e.message);
                    }
                }
            }
        } catch (err) {
            showError('Subsonic 配置保存失败: ' + err.message);
            throw err;
        }
    }

    // ---- Subsonic 联动数据手动同步（与导入 / 回滚链路解耦） ----

    bindLinkSyncToggles() {
        if (this._linkSyncBound) return;
        const form = document.getElementById('subsonic-form');
        if (!form) return;
        ['subsonic.linkRatingToDislike', 'subsonic.dislikeRating'].forEach(key => {
            const el = form.elements[key];
            if (el) el.addEventListener('change', () => this.updateLinkSyncUI());
        });
        this._linkSyncBound = true;
    }

    updateLinkSyncUI() {
        const form = document.getElementById('subsonic-form');
        [
            ['subsonic.linkRatingToDislike', 'sync-rating-to-dislike-btn'],
            ['subsonic.linkRatingToDislike', 'reconcile-rating-btn'],
        ].forEach(([key, btnId]) => {
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.classList.remove('hidden');
                const saved = this.loadedSubsonicConfig || {};
                btn.disabled = !form?.elements[key]?.checked || saved[key] !== true || Number(saved['subsonic.dislikeRating'] ?? 1) <= 0;
                btn.title = btn.disabled ? '请先开启并保存低分联动开关，且阈值大于 0' : btnId === 'reconcile-rating-btn' ? '先预览，再撤销失效评分原因；保留手动及其他有效原因' : '先预览，再补齐缺失的不喜欢规则';
            }
        });
        const manualButton = document.getElementById('sync-dislike-to-rating-btn');
        if (manualButton) { manualButton.classList.remove('hidden'); manualButton.disabled = this._linkSyncBusy === true; manualButton.title = '管理员预览并批量补1星，只补未评分歌曲；不依赖自动开关或阈值'; }
        const saved = this.loadedSubsonicConfig || {};
        const threshold = Number(saved['subsonic.dislikeRating'] ?? 1);
        const status = document.getElementById('subsonic-link-saved-status');
        if (status) status.textContent = '已保存：' + (threshold <= 0 ? '低分联动已暂停（阈值为 0）；用户自动补分及后台补分不受影响' : `低分阈值 ${threshold} 星；低分补不喜欢${saved['subsonic.linkRatingToDislike'] ? '开启' : '关闭'}；不喜欢自动补分由各用户独立设置`) + '。更改配置不会重算历史数据。';
    }

    async loadLinkSyncUsers() {
        const select = document.getElementById('subsonic-sync-user');
        if (!select) return;
        try {
            const users = await this.request('/api/users');
            const names = (Array.isArray(users) ? users : []).map(u => u.name).filter(Boolean);
            const wanted = this.pendingLinkSyncUser || select.value;
            select.innerHTML = '';
            names.forEach(n => {
                const opt = document.createElement('option');
                opt.value = n;
                opt.textContent = n;
                select.appendChild(opt);
            });
            if (names.includes(wanted)) select.value = wanted;
            else if (names.length) select.value = names[0];
            this.pendingLinkSyncUser = null;
            // 动态填充后同步自定义下拉显示（菜单在展开时会重新渲染）
            this.initCustomSelects();
            this.syncCustomSelects();
        } catch (e) {
            console.warn('[LinkSync] 加载用户列表失败:', e);
        }
    }

    async syncLink(direction, reconcile = false) {
        if (this._linkSyncBusy) return;
        const isRatingToDislike = direction === 'ratingToDislike';
        const key = 'subsonic.linkRatingToDislike';
        const label = reconcile ? '按当前阈值重算' : isRatingToDislike ? '低分补不喜欢' : '后台补分';
        const btn = document.getElementById(reconcile ? 'reconcile-rating-btn' : isRatingToDislike ? 'sync-rating-to-dislike-btn' : 'sync-dislike-to-rating-btn');
        const form = document.getElementById('subsonic-form');
        // 开关以服务端已保存的配置为准，避免「表单勾了但没保存」时后端拒绝
        const checked = !!form?.elements[key]?.checked;
        const saved = (this.loadedSubsonicConfig || {})[key] === true;
        if (isRatingToDislike && (!checked || !saved)) {
            showError(`请先开启「${label} 自动联动」并保存配置，再执行同步。`);
            return;
        }
        const user = document.getElementById('subsonic-sync-user')?.value || '';
        if (!user) {
            showError('请先选择联动同步目标用户');
            return;
        }
        let preview;
        try {
            preview = await this.request('/api/subsonic/sync-link', { method: 'POST', body: JSON.stringify({ user, direction, preview: true, reconcile }) });
        } catch (err) { showError('同步预览失败: ' + err.message); return; }
        const sample = (preview.candidates || []).slice(0, 20).map(x => `${x.name || x.id} [${x.source || '?'}]`).join('\n');
        const confirmed = await showSelect('手动联动同步',
            `扫描范围包含用户歌单、本地曲目及在线缓存。待新增 ${preview.candidates?.length || 0} 项；已有评分 ${preview.existing?.length || 0} 项；重复关联 ${preview.duplicates?.length || 0} 项；解析失败 ${preview.failures?.length || 0} 项（最多显示20项）：\n${this.escapeHtml(sample)}\n\n将对用户 ${this.escapeHtml(user)} 执行「${label}」补数据：${reconcile ? `将撤销 ${preview.removedReasons || 0} 个失效评分原因，移除 ${preview.removedRules || 0} 条无其他原因的规则；保留手动及来源不明规则，并补齐当前低分。` : '只补目标侧缺失的数据，不覆盖已有数据，也不会改动导入 / 回滚逻辑。'}\n\n确定继续吗？`,
            { confirmText: '开始同步', cancelText: '取消' });
        if (!confirmed) return;

        this._linkSyncBusy = true;
        const oldText = btn?.textContent;
        if (btn) { btn.disabled = true; btn.textContent = '同步中…'; }
        try {
            const res = await this.request('/api/subsonic/sync-link', {
                method: 'POST',
                body: JSON.stringify({ user, direction, reconcile, preview: false })
            });
            const text = `同步完成（${label} · 用户 ${user}）：扫描 ${res.scanned} 条，新增 ${res.added} 条，补全 ${res.updated || 0} 条，已存在 ${res.skipped} 条` +
                (res.failed ? `，失败 ${res.failed} 条` : '') +
                (res.batches > 1 ? `，分 ${res.batches} 批处理（全量）` : '') + (reconcile ? `，撤销原因 ${res.removedReasons || 0} 个、删除规则 ${res.removedRules || 0} 条` : '') + '。';
            const box = document.getElementById('link-sync-result');
            if (box) {
                box.textContent = text;
                box.classList.remove('hidden');
            }
            if (res.warning) showInfo(text + '\n' + res.warning); else showSuccess(text);
        } catch (err) {
            showError('同步失败: ' + err.message);
        } finally {
            this._linkSyncBusy = false;
            if (btn) btn.textContent = oldText || '同步';
            this.updateLinkSyncUI();
        }
    }

    async maybeOfferLinkSync(user, kindLabel) {
        try {
            // 用服务端已保存的配置校验开关，只提供手动操作入口，绝不自动执行联动
            const config = await this.request('/api/config');
            const ratingToDislike = config['subsonic.linkRatingToDislike'] === true;
            const dislikeToRating = true;
            const threshold = Number(config['subsonic.dislikeRating'] ?? 1);
            if ((!ratingToDislike && !dislikeToRating) || !(threshold > 0)) return;
            const dirs = [ratingToDislike ? '评星 → 不喜欢' : '', dislikeToRating ? '不喜欢 → 评星' : '']
                .filter(Boolean).join(' / ');
            const go = await showSelect('回滚完成，联动数据未自动同步',
                `已回滚用户 ${this.escapeHtml(user)} 的「${this.escapeHtml(kindLabel)}」数据。\n\n` +
                `检测到联动开关已开启（${dirs}）。导入 / 回滚不会自动补另一侧数据，如需对齐请前往 Subsonic 配置页手动点击「同步」。`,
                { confirmText: '前往配置', cancelText: '稍后处理' });
            if (go) await this.jumpToLinkSync(user);
        } catch (e) {
            console.warn('[LinkSync] 联动提示检查失败:', e);
        }
    }

    async jumpToLinkSync(user) {
        this.pendingLinkSyncUser = user;
        await this.switchView('subsonic');
        setTimeout(() => {
            const target = document.getElementById('link-sync-field');
            if (!target) return;
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.style.outline = '2px solid var(--accent-primary)';
            target.style.outlineOffset = '4px';
            setTimeout(() => { target.style.outline = 'none'; }, 2000);
        }, 350);
    }

    async loadLogs(isAuto = false) {
        const logType = document.getElementById('log-type-select')?.value || 'app';

        try {
            const data = await this.request(`/api/logs?type=${logType}&lines=200`);
            const container = document.getElementById('logs-content');
            if (!container) return;

            const titleEl = document.getElementById('terminal-active-type');
            if (titleEl) {
                const labelMap = { app: 'app.log', access: 'access.log', login: 'login.log', token: 'token.log', errors: 'error.log' };
                titleEl.textContent = labelMap[logType] || `${logType}.log`;
            }

            // 检查用户是否正处于向上滚动浏览历史状态
            const isNearBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 60;

            if (data.logs && data.logs.length) {
                const countEl = document.getElementById('terminal-line-count');
                if (countEl) countEl.textContent = `${data.logs.length} 行`;

                container.innerHTML = data.logs
                    .filter(line => line.trim())
                    .map(line => {
                        let formatted = this.escapeHtml(line);
                        // Highlight log levels
                        formatted = formatted
                            .replace(/\[(INFO|info)\]/g, '<span class="log-tag-info">INFO</span>')
                            .replace(/\[(WARN|warn|WARNING)\]/g, '<span class="log-tag-warn">WARN</span>')
                            .replace(/\[(ERROR|error|ERR)\]/g, '<span class="log-tag-error">ERROR</span>')
                            .replace(/^(\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{3})?)/, '<span class="log-time-tag">$1</span>');
                        return `<div class="log-line">${formatted}</div>`;
                    })
                    .join('');

                // 首次或者用户停留在底部时自动贴底
                if (!isAuto || isNearBottom) {
                    container.scrollTop = container.scrollHeight;
                }
            } else {
                container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">暂无日志数据</p>';
            }
        } catch (err) {
            if (!isAuto) {
                document.getElementById('logs-content').innerHTML = '<p style="color: var(--accent-error); text-align: center; padding: 2rem;">加载日志失败</p>';
            }
        }
    }

    startLogsAutoRefresh() {
        this.stopLogsAutoRefresh();
        this.logsRefreshTimer = setInterval(() => {
            const toggle = document.getElementById('logs-auto-refresh-toggle');
            if (this.currentView === 'logs' && (!toggle || toggle.checked)) {
                this.loadLogs(true);
            }
        }, 3000);
    }

    stopLogsAutoRefresh() {
        if (this.logsRefreshTimer) {
            clearInterval(this.logsRefreshTimer);
            this.logsRefreshTimer = null;
        }
    }

    closeModal() {
        document.getElementById('modal').classList.add('hidden');
    }


    // ===== OpenList 音频备份配置 =====
    renderBackupPolicy(config) {
        const target = document.getElementById('backup-policy-matrix');
        if (!target || !Array.isArray(config.backupTypeInfo)) return;
        this._backupTypesLoaded = true;
        target.innerHTML = '<div class="backup-table-wrapper"><table class="backup-policy-table"><thead><tr><th scope="col" class="backup-col-name">备份内容</th><th scope="col" class="backup-col-dest">WebDAV</th><th scope="col" class="backup-col-dest">OpenList</th></tr></thead><tbody>' + config.backupTypeInfo.map(type => {
            const cells = ['webdav', 'openlist'].map(destination => {
                const isChecked = (config['backup.' + destination + '.types'] || []).includes(type.id);
                return '<td class="backup-col-dest">' +
                    '<label class="toggle-switch backup-toggle" title="' + this.escapeHtml(type.label + ' 备份到 ' + (destination === 'webdav' ? 'WebDAV' : 'OpenList')) + '">' +
                    '<input type="checkbox" name="backup.' + destination + '.types" value="' + this.escapeHtml(type.id) + '" aria-label="' + this.escapeHtml(type.label + ' 备份到 ' + destination) + '"' + (isChecked ? ' checked' : '') + ' />' +
                    '<span class="toggle-track"><span class="toggle-thumb"></span></span>' +
                    '</label>' +
                    '</td>';
            }).join('');
            return '<tr>' +
                '<td class="backup-col-name">' +
                '<div class="backup-type-title">' + this.escapeHtml(type.label) + '</div>' +
                '<div class="backup-type-desc">' + this.escapeHtml(type.description) + '</div>' +
                '</td>' +
                cells +
                '</tr>';
        }).join('') + '</tbody></table></div>';
        const webdavForm = document.getElementById('webdav-form') || document.getElementById('config-form');
        ['backup.webdav.mirrorDeletes', 'backup.webdav.restoreOnStartup'].forEach(key => {
            if (webdavForm && webdavForm.elements[key]) {
                webdavForm.elements[key].checked = config[key] === true;
            }
        });
    }

    collectBackupPolicy() {
        if (!this._backupTypesLoaded) return {};
        const policyForm = document.getElementById('backup-policy-form') || document.getElementById('config-form');
        if (!policyForm) return {};
        const fd = new FormData(policyForm);
        return {
            'backup.webdav.types': fd.getAll('backup.webdav.types'),
            'backup.openlist.types': fd.getAll('backup.openlist.types'),
        };
    }

    async saveBackupPolicy() {
        if (!this._backupTypesLoaded) return;
        const status = document.getElementById('backup-policy-status');
        try {
            const payload = this.collectBackupPolicy();
            const result = await this.request('/api/config', { method: 'POST', body: JSON.stringify(payload) });
            if (this.loadedConfig) Object.assign(this.loadedConfig, payload);
            this.markBackupDirty('backup-policy-form', false);
            if (status) {
                status.classList.remove('is-error', 'is-dirty');
                status.textContent = result.warning || '备份范围已写入 config.js。云端已有副本保持不变。';
            }
            if (window.showSuccess) window.showSuccess('云端备份范围已保存');
        } catch (e) {
            if (status) {
                status.classList.add('is-error');
                status.textContent = '保存失败：' + e.message;
            }
            if (window.showError) window.showError('保存失败：' + e.message);
        }
    }

    async restoreOpenlistBackup() {
        await this.openBackupCenter('restore', 'openlist');
    }

    initOpenlistRestore(config) {
        const form = document.getElementById('openlist-restore-form');
        if (!form) return;
        this._openlistRestoreSupported = config.openlistRestoreVersion >= 2;
        const sourceText = (config['openlist.root'] || '/lx_music').replace(/\/+$/, '') + '/_data';
        const sourceEl = document.getElementById('openlist-restore-source');
        if (sourceEl) sourceEl.textContent = sourceText;
        if (this._openlistRestoreInitialized) return;
        const types = config.backupTypeInfo || [];
        const saved = config['backup.openlist.types'] || [];
        const typeMeta = {
            music: {
                bg: 'rgba(139, 92, 246, 0.14)',
                color: '#a78bfa',
                svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>'
            },
            userFiles: {
                bg: 'rgba(6, 182, 212, 0.14)',
                color: '#38bdf8',
                svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>'
            },
            snapshots: {
                bg: 'rgba(16, 185, 129, 0.14)',
                color: '#34d399',
                svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>'
            },
            userData: {
                bg: 'rgba(99, 102, 241, 0.14)',
                color: '#818cf8',
                svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>'
            },
            system: {
                bg: 'rgba(245, 158, 11, 0.14)',
                color: '#fbbf24',
                svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>'
            }
        };

        const typesContainer = document.getElementById('openlist-restore-types');
        if (typesContainer) {
            typesContainer.innerHTML = types.map(type => {
                const meta = typeMeta[type.id] || { bg: 'rgba(99, 102, 241, 0.14)', color: '#818cf8', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon></svg>' };
                const isChecked = saved.includes(type.id);
                return '<label class="ol-restore-type' + (isChecked ? ' is-checked' : '') + '">' +
                    '<input type="checkbox" class="lx-checkbox" name="types" value="' + this.escapeHtml(type.id) + '"' + (isChecked ? ' checked' : '') + '>' +
                    '<div class="ol-restore-type-icon" style="background:' + meta.bg + ';color:' + meta.color + ';">' + meta.svg + '</div>' +
                    '<div class="ol-restore-type-info">' +
                    '<strong class="ol-restore-type-title">' + this.escapeHtml(type.label) + '</strong>' +
                    (type.description ? '<small class="ol-restore-type-desc">' + this.escapeHtml(type.description) + '</small>' : '') +
                    '</div>' +
                    '</label>';
            }).join('');
        }

        form.addEventListener('input', () => this.invalidateOpenlistRestore());
        form.addEventListener('change', () => this.invalidateOpenlistRestore());
        this._openlistRestoreInitialized = true;
    }

    invalidateOpenlistRestore() {
        this._openlistRestorePlan = null;
        const button = document.getElementById('openlist-restore-run');
        if (button) button.disabled = true;
        const result = document.getElementById('openlist-restore-preview');
        if (result) {
            result.innerHTML = '<div class="ol-preview-empty">' +
                '<div class="ol-preview-empty-icon">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">' +
                '<circle cx="12" cy="12" r="10"></circle>' +
                '<polyline points="12 6 12 12 16 14"></polyline>' +
                '</svg>' +
                '</div>' +
                '<div class="ol-preview-empty-text">' +
                '<strong>恢复设置已改变，请先扫描预览</strong>' +
                '<p>选项发生变动，请点击「扫描并预览差异」重新生成文件比对分析与恢复计划。</p>' +
                '</div>' +
                '</div>';
        }
    }

    collectOpenlistRestore() {
        const fd = new FormData(document.getElementById('openlist-restore-form'));
        const types = fd.getAll('types');
        if (!types.length) throw new Error('请至少勾选一种要恢复的内容分类');
        return { types, mode: fd.get('mode'), backupBeforeRestore: fd.get('backupBeforeRestore') === 'on', snapshotId: fd.get('snapshotId') || undefined };
    }

    async previewOpenlistRestore() {
        if (this._openlistRestoreBusy) return;
        this.invalidateOpenlistRestore();
        const box = document.getElementById('openlist-restore-preview');
        try {
            if (!this._openlistRestoreSupported) throw new Error('当前服务仍是旧版恢复接口，请重启服务后重新加载本页。尚未执行任何恢复。');
            const options = this.collectOpenlistRestore();
            this._openlistRestoreBusy = true;
            box.innerHTML = '<div class="ol-preview-loading">' +
                '<div class="task-spinner" style="width:26px;height:26px;"></div>' +
                '<div>' +
                '<strong>正在扫描云端备份清单与文件指纹...</strong>' +
                '<p>正在比对本地现有数据与云端差异，此操作为只读安全预检，绝不改动任何本地文件。</p>' +
                '</div>' +
                '</div>';
            const result = await this.request('/api/openlist/restore', { method: 'POST', body: JSON.stringify({ ...options, preview: true }) });
            if (!result.success) throw new Error((result.errors || []).join('；') || result.error || '云端没有所选类型的文件');
            if (JSON.stringify(options) !== JSON.stringify(this.collectOpenlistRestore())) throw new Error('扫描期间设置已变化，请重新扫描');
            this._openlistRestorePlan = { options, token: result.planToken };
            const esc = value => this.escapeHtml(String(value));
            const actions = { add: '新增', overwrite: '覆盖', skip: '跳过', merge: '合并索引' };
            const actionClasses = { add: 'is-add', overwrite: 'is-overwrite', skip: 'is-skip', merge: 'is-merge' };

            box.innerHTML = '<div class="ol-preview-summary-grid">' +
                '<div class="ol-summary-stat is-add">' +
                '<span class="ol-stat-num">' + result.added + '</span>' +
                '<span class="ol-stat-label">将新增文件</span>' +
                '</div>' +
                '<div class="ol-summary-stat is-overwrite">' +
                '<span class="ol-stat-num">' + result.overwritten + '</span>' +
                '<span class="ol-stat-label">将覆盖替换</span>' +
                '</div>' +
                '<div class="ol-summary-stat is-merge">' +
                '<span class="ol-stat-num">' + (result.merged || 0) + '</span>' +
                '<span class="ol-stat-label">合并索引</span>' +
                '</div>' +
                '<div class="ol-summary-stat is-skip">' +
                '<span class="ol-stat-num">' + result.skipped + '</span>' +
                '<span class="ol-stat-label">安全跳过</span>' +
                '</div>' +
                '</div>' +
                '<div class="ol-summary-note-strip">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>' +
                '<span>预检完成：共比对 ' + result.files.length + ' 个文件。本地独有文件均安全保留，不会向云端写回。</span>' +
                '</div>' +
                (result.warnings || []).map(w => '<div class="ol-preview-alert is-warn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg><span>' + esc(w) + '</span></div>').join('') +
                '<div class="ol-restore-files">' +
                '<table class="olb-detail-table">' +
                '<thead><tr><th style="width:100px;">操作类型</th><th>备份文件相对路径</th></tr></thead>' +
                '<tbody>' +
                result.files.map(file => '<tr><td><span class="ol-restore-act-badge ' + (actionClasses[file.action] || '') + '">' + (actions[file.action] || esc(file.action)) + '</span></td><td><code class="ol-file-code">' + esc(file.path) + '</code></td></tr>').join('') +
                '</tbody></table></div>';
            document.getElementById('openlist-restore-run').disabled = result.added + result.overwritten === 0;
        } catch (e) {
            box.innerHTML = '<div class="ol-preview-alert is-error">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>' +
                '<div><strong>扫描预检失败</strong><p>' + this.escapeHtml(e.message) + '</p></div>' +
                '</div>';
        }
        finally { this._openlistRestoreBusy = false; }
    }

    async executeOpenlistRestore() {
        if (this._openlistRestoreBusy || !this._openlistRestorePlan) return;
        const plan = this._openlistRestorePlan;
        if (JSON.stringify(plan.options) !== JSON.stringify(this.collectOpenlistRestore())) { this.invalidateOpenlistRestore(); return; }
        const modeText = plan.options.mode === 'missing' ? '补回缺失文件，并合并新增歌曲/快照的索引，保留已有业务条目。' : '整份替换同名文件，不合并 JSON 或歌单内容。';
        const backupText = plan.options.backupBeforeRestore ? '成功后保留恢复前副本，可在任务记录中随时一键回退。' : '成功后不再保留回退副本。';
        if (!(await showSelect('确认从 OpenList 恢复', modeText + '\n' + backupText + '\n\n全部文件下载校验后再提交；提交失败会自动尝试回退。提交后服务端将进入维护状态，需重启服务生效。', { danger: true }))) return;
        if (plan !== this._openlistRestorePlan || this._openlistRestoreBusy) return;
        this._openlistRestoreBusy = true;
        const box = document.getElementById('openlist-restore-preview');
        document.getElementById('openlist-restore-run').disabled = true;
        box.innerHTML = '<div class="ol-preview-loading">' +
            '<div class="task-spinner" style="width:26px;height:26px;"></div>' +
            '<div><strong>正在初始化恢复任务并拉取文件清单...</strong><p>任务由后台托管，请勿重复操作</p></div>' +
            '</div>';
        try {
            const result = await this.request('/api/openlist/restore/jobs/start', { method: 'POST', body: JSON.stringify({ ...plan.options, planToken: plan.token }) });
            if (!result.success) throw new Error(result.error || '创建恢复任务失败');
            box.innerHTML = '<div class="ol-preview-alert is-success">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>' +
                '<div><strong>恢复任务已提交并启动</strong><p>正在后台下载校验文件，请在下方实时查看任务进度与本地副本状态。任务生效后请重启服务。</p></div>' +
                '</div>';
            await this.loadOpenlistRecoveryHistory();
            this.startOpenlistRestorePolling();
        } catch (e) {
            box.innerHTML = '<div class="ol-preview-alert is-error">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>' +
                '<div><strong>创建恢复任务失败</strong><p>' + this.escapeHtml(e.message) + '</p></div>' +
                '</div>';
            showError('恢复失败：' + e.message);
        }
        finally { this._openlistRestoreBusy = false; this._openlistRestorePlan = null; }
    }

    async loadOpenlistRecoveryHistory() {
        if (!this._openlistRestoreSupported || this._openlistHistoryLoading) return;
        this._openlistHistoryLoading = true;
        const box = document.getElementById('openlist-restore-tasks');
        const esc = value => this.escapeHtml(String(value));
        const labels = {
            pending: '等待扫描',
            downloading: '正在下载校验',
            ready: '校验就绪 · 等待提交',
            committing: '正在提交写入',
            completed: '已完成 · 请重启服务',
            failed: '恢复失败 · 可重试',
            cancelled: '已取消',
            interrupted: '进程中断 · 可续传',
            'recovery-required': '提交中断 · 需先回退',
            'rolled-back': '已回退副本 · 请重启'
        };
        const badgeClasses = {
            pending: 'is-pending',
            downloading: 'is-running',
            ready: 'is-ready',
            committing: 'is-committing',
            completed: 'is-completed',
            failed: 'is-failed',
            cancelled: 'is-cancelled',
            interrupted: 'is-interrupted',
            'recovery-required': 'is-danger',
            'rolled-back': 'is-rolled-back'
        };
        const badgeIcons = {
            completed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>',
            downloading: '<span class="ol-task-spinner-sm"></span>',
            committing: '<span class="ol-task-spinner-sm"></span>',
            failed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></polyline><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
            'recovery-required': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
            'rolled-back': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><polyline points="3 3 3 8 8 8"></polyline></svg>'
        };

        try {
            const result = await this.request('/api/openlist/restore/history');
            const select = document.getElementById('openlist-restore-version');
            const selected = select.value;
            select.innerHTML = '<option value="">最近一次成功备份</option>' + (result.versions || []).map(v => '<option value="' + esc(v.id) + '">' + esc(new Date(v.modified).toLocaleString()) + ' · 快照 ' + esc(v.id.slice(0, 8)) + '</option>').join('');
            if ([...select.options].some(o => o.value === selected)) select.value = selected;
            else if (selected) this.invalidateOpenlistRestore();
            const tasks = result.tasks || [];

            if (!tasks.length) {
                box.innerHTML = (result.warning ? '<div class="ol-preview-alert is-warn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg><span>' + esc(result.warning) + '</span></div>' : '') +
                    '<div class="ol-tasks-empty">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>' +
                    '<span>暂无历史恢复任务。执行恢复后，本地副本状态与进度将在此集中管理。</span>' +
                    '</div>';
            } else {
                box.innerHTML = (result.warning ? '<div class="ol-preview-alert is-warn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg><span>' + esc(result.warning) + '</span></div>' : '') +
                    tasks.map(t => {
                        const active = ['pending', 'downloading', 'ready', 'committing'].includes(t.state);
                        const bClass = badgeClasses[t.state] || 'is-pending';
                        const bIcon = badgeIcons[t.state] || '';
                        const total = t.total || 0;
                        const downloaded = t.downloaded || 0;
                        const applied = t.applied || 0;
                        const percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : (t.state === 'completed' ? 100 : 0);

                        let actionsHtml = '';
                        if (active && t.state !== 'committing') {
                            actionsHtml += '<button type="button" class="btn-secondary ol-task-btn is-cancel" onclick="app.openlistRestoreTaskAction(\'' + esc(t.id) + '\',\'cancel\')">' +
                                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>' +
                                '<span>取消下载</span></button>';
                        }
                        if (['failed', 'cancelled', 'interrupted'].includes(t.state)) {
                            actionsHtml += '<button type="button" class="btn-primary ol-task-btn is-resume" onclick="app.openlistRestoreTaskAction(\'' + esc(t.id) + '\',\'resume\')">' +
                                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>' +
                                '<span>按文件继续</span></button>';
                        }
                        if (t.canRollback || t.state === 'recovery-required') {
                            actionsHtml += '<button type="button" class="btn-secondary ol-task-btn is-rollback" onclick="app.openlistRestoreTaskAction(\'' + esc(t.id) + '\',\'rollback\')" title="恢复被替换文件，并移除本次新增文件">' +
                                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><polyline points="3 3 3 8 8 8"></polyline></svg>' +
                                '<span>回退本次恢复</span></button>';
                        }
                        if (!active && t.state !== 'recovery-required') {
                            actionsHtml += '<button type="button" class="btn-secondary ol-task-btn is-delete" onclick="app.openlistRestoreTaskAction(\'' + esc(t.id) + '\',\'delete\')" title="删除此条任务记录及保留的本地副本">' +
                                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>' +
                                '<span>删除任务及本地副本</span></button>';
                        }

                        const errorsHtml = (t.errors || []).length ? '<div class="ol-task-errors">' +
                            t.errors.map(e => '<p class="ol-task-error-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>' + esc(e) + '</p>').join('') +
                            '</div>' : '';

                        return '<div class="ol-task-card ' + bClass + '">' +
                            '<div class="ol-task-header">' +
                            '<div class="ol-task-meta">' +
                            '<div class="ol-task-time">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>' +
                            '<span>' + esc(new Date(t.createdAt).toLocaleString()) + '</span>' +
                            '</div>' +
                            '<span class="ol-task-id-badge" title="任务 ID: ' + esc(t.id) + '">ID: ' + esc(t.id.slice(0, 8)) + '</span>' +
                            '</div>' +
                            '<div class="ol-task-badge ' + bClass + '">' +
                            bIcon +
                            '<span>' + esc(labels[t.state] || t.state) + '</span>' +
                            '</div>' +
                            '</div>' +
                            '<div class="ol-task-body">' +
                            '<div class="ol-task-progress-box">' +
                            '<div class="ol-task-progress-head">' +
                            '<span class="ol-task-progress-label">下载校验进度</span>' +
                            '<span class="ol-task-progress-num"><strong>' + esc(downloaded) + '</strong> / ' + esc(total) + ' 文件 <small>(' + percent + '%)</small></span>' +
                            '</div>' +
                            '<div class="ol-task-progress-track">' +
                            '<div class="ol-task-progress-fill ' + bClass + '" style="width:' + percent + '%;"></div>' +
                            '</div>' +
                            '</div>' +
                            '<div class="ol-task-metrics-grid">' +
                            '<div class="ol-task-metric-pill">' +
                            '<span class="ol-metric-title">已提交生效</span>' +
                            '<strong class="ol-metric-value">' + esc(applied) + ' 个文件</strong>' +
                            '</div>' +
                            (t.canRollback ? '<div class="ol-task-metric-pill is-safe">' +
                                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>' +
                                '<span>已保留本地快照副本（支持一键回退）</span>' +
                                '</div>' : '') +
                            '</div>' +
                            errorsHtml +
                            '</div>' +
                            (actionsHtml ? '<div class="ol-task-actions">' + actionsHtml + '</div>' : '') +
                            '</div>';
                    }).join('');
            }

            if (tasks.some(t => ['pending', 'downloading', 'ready', 'committing'].includes(t.state))) this.startOpenlistRestorePolling();
            else { clearInterval(this._openlistRestoreTimer); this._openlistRestoreTimer = null; }
        } catch (e) {
            box.innerHTML = '<div class="ol-preview-alert is-error"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg><div><strong>加载恢复任务失败</strong><p>' + this.escapeHtml(e.message) + '</p></div></div>';
        }
        finally { this._openlistHistoryLoading = false; }
    }

    startOpenlistRestorePolling() {
        if (this._openlistRestoreTimer) return;
        this._openlistRestoreTimer = setInterval(() => {
            if (this.currentView !== 'backups') { clearInterval(this._openlistRestoreTimer); this._openlistRestoreTimer = null; return; }
            this.loadOpenlistRecoveryHistory();
        }, 2000);
    }

    async openlistRestoreTaskAction(id, action) {
        if (['delete', 'rollback'].includes(action) && !(await showSelect(action === 'delete' ? '删除本地任务及副本' : '回退本次恢复', action === 'delete' ? '删除后不能再使用此任务继续或回退。不删除云端历史备份。' : '恢复被替换文件，并移除本次新增文件。文件有后续修改时会阻止自动回退。完成后需重启服务。', { danger: true }))) return;
        try {
            await this.request('/api/openlist/restore/jobs/' + encodeURIComponent(id) + (action === 'delete' ? '' : '/' + action), { method: action === 'delete' ? 'DELETE' : 'POST' });
            await this.loadOpenlistRecoveryHistory();
        } catch (e) { showError(e.message); }
    }

    async loadOpenlistConfig() {
        await this.loadBackupSettings(false);
    }

    async saveOpenlistConfig() {
        await this.saveOpenlistConnection();
    }

    toggleOpenlistVisibility() {
        const form = document.getElementById('openlist-form')
        const enabled = !!(form && form.elements['openlist.enable'] && form.elements['openlist.enable'].checked)
        const opts = document.getElementById('openlist-options')
        const hint = document.getElementById('openlist-disabled-hint')
        const cacheHint = document.getElementById('openlist-cache-disabled-hint')
        if (opts) opts.style.display = enabled ? 'block' : 'none'
        if (hint) hint.style.display = enabled ? 'none' : 'block'
        if (cacheHint) cacheHint.style.display = enabled ? 'none' : 'block'
        const active = enabled && this.loadedConfig?.['openlist.enable'] === true
        for (const id of ['openlist-operation-panel', 'openlist-cache-form', 'openlist-cache-shortcut']) {
            const element = document.getElementById(id)
            if (element) element.style.display = active ? '' : 'none'
        }
        if (hint && !enabled) hint.textContent = this.loadedConfig?.['openlist.enable'] === true
            ? '尚未保存关闭操作，后台仍按已保存设置运行。点击“保存 OpenList 设置”后才会停止服务；已有连接与缓存规则会保留。'
            : 'OpenList 备份服务已关闭。连接参数、立即操作和播放缓存设置已隐藏；原有设置保留，开启并保存后可继续使用。'

    }

    renderOpenlistUserConfig(users, userBackupsRaw) {
        let backups = []
        try { backups = JSON.parse(userBackupsRaw || '[]') } catch { }
        const selected = backups.map(b => b.user)
        const labelMap = {}
        users.forEach(u => { labelMap[u] = u })
        this.renderSortableTagGroup('tag-group-openlist-users', 'openlist.userBackupUsers', selected, labelMap, users, true)
        const container = document.getElementById('tag-group-openlist-users')
        if (container) container.onclick = () => setTimeout(() => {
            this.renderOpenlistUserDirs(backups)
            this.markBackupDirty('openlist-cache-form', true)
        }, 0)
        this.renderOpenlistUserDirs(backups)
    }

    renderOpenlistUserDirs(backups) {
        const hidden = document.querySelector('input[name="openlist.userBackupUsers"]')
        const selected = (hidden && hidden.value ? hidden.value.split(',').map(s => s.trim()).filter(Boolean) : [])
        const dirsContainer = document.getElementById('openlist-user-dirs')
        if (!dirsContainer) return
        const map = {}
            ; (backups || []).forEach(b => { map[b.user] = b })
        const prev = {}
        selected.forEach(u => {
            const d = document.getElementById('openlist-dl-sw-' + u)
            const c = document.getElementById('openlist-ca-sw-' + u)
            const s = document.getElementById('openlist-snap-sw-' + u)
            const m = document.getElementById('openlist-mode-' + u)
            prev[u] = { download: d ? d.checked : null, cache: c ? c.checked : null, snapshot: s ? s.checked : null, mode: m ? m.value : '' }
        })
        const modeOptions = (sel) => ([
            ['upload', '缓存上传到 OpenList，保留本地'],
            ['upload-delete', '缓存上传并校验后，删除本地缓存'],
            ['download', '从 OpenList 下载缓存到本地'],
            ['sync', '本地缓存与 OpenList 双向同步'],
        ]).map(([v, t]) => '<option value="' + v + '"' + (v === sel ? ' selected' : '') + '>' + t + '</option>').join('')
        const modeShortLabel = {
            'upload': '仅上传保留本地',
            'upload-delete': '上传后删本地',
            'download': '仅下载到本地',
            'sync': '双向同步'
        }
        const modeHelp = '仅对该用户服务器上的播放缓存生效。上传：复制到 OpenList 并保留本地；上传并删除：校验内容后删除本地缓存及已上传附件；下载：只从 OpenList 取回缓存，不上传；双向同步：两边补齐并同步变化。本地缓存被清理不会删除远端副本。不会自动下载所有歌单歌曲，也不影响配置、歌单、用户数据等常规备份。'
        const toggleHtml = (id, checked) =>
            '<label class="toggle-switch">' +
            '<input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '>' +
            '<span class="toggle-track"><span class="toggle-thumb"></span></span>' +
            '</label>'
        const escU = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        dirsContainer.innerHTML = selected.map(u => {
            const tpl = map[u] || {}
            const caOn = (prev[u] && prev[u].cache !== null) ? prev[u].cache : (tpl.backupCache === true)
            const md = (prev[u] && prev[u].mode) ? prev[u].mode : (tpl.mode || 'upload')
            return '<div class="openlist-user-card">' +
                '<div class="openlist-user-header">' +
                '<div class="openlist-user-badge">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>' +
                '<span><b>' + escU(u) + '</b> 的播放缓存同步</span>' +
                '</div>' +
                '<div class="openlist-user-toggle-wrap">' +
                '<span class="openlist-user-toggle-label">启用该用户的缓存同步</span>' +
                '<span class="help-icon" role="button" tabindex="0" onclick="app.toggleHelp(this)" data-help="只处理该用户已在服务器落盘的播放缓存。关闭后，该用户缓存不上传也不下载；不影响歌曲、歌单和配置等常规数据备份。不会自动下载所有歌单歌曲，也不会阻止本地缓存被清理。">?</span>' +
                toggleHtml('openlist-ca-sw-' + u, caOn) +
                '</div>' +
                '</div>' +
                '<div class="openlist-user-body">' +
                '<div class="config-field" style="margin-bottom:0;">' +
                '<label class="config-label">' +
                '<span>缓存传输方式</span>' +
                '<span class="help-icon" role="button" tabindex="0" onclick="app.toggleHelp(this)" data-help="' + modeHelp + '">?</span>' +
                '<span class="openlist-mode-pill" data-mode="' + escU(md) + '">' + (modeShortLabel[md] || '仅上传保留本地') + '</span>' +
                '</label>' +
                '<select id="openlist-mode-' + u + '" class="form-input config-input" title="' + modeHelp + '" onchange="app.onOpenlistModeChange(this)">' + modeOptions(md) + '</select>' +
                '</div>' +
                '</div>' +
                '</div>'
        }).join('')
        this.initCustomSelects()
    }

    /** 用户在 OpenList 备份里把某用户模式改为「上传后删除本地」时给出强提示：
     *  该模式只删「下载 / 缓存」目录里的歌曲及其歌词、封面等附件，并清除本地缓存索引，
     *  不会删除系统配置、歌单与不喜欢快照、用户数据；下次播放将无本地缓存；
     *  为保证直接命中 OpenList 直链（而非回源重下），保存时会自动开启 Subsonic 的
     *  「缓存优先时优先使用 OpenList」（见 saveOpenlistConfig）。 */
    onOpenlistModeChange(sel) {
        if (!sel) return
        const modeShortLabel = {
            'upload': '仅上传保留本地',
            'upload-delete': '上传后删本地',
            'download': '仅下载到本地',
            'sync': '双向同步'
        }
        const card = sel.closest('.openlist-user-card')
        const pill = card ? card.querySelector('.openlist-mode-pill') : null
        if (pill) {
            pill.dataset.mode = sel.value
            pill.textContent = modeShortLabel[sel.value] || sel.value
        }
        if (sel.value !== 'upload-delete') return
        if (window.showInfo) {
            window.showInfo('已选择「缓存上传并校验后，删除本地缓存」：\n上传并完整内容校验成功后，会删除该用户本地缓存歌曲及已上传、校验通过的歌词和封面，并清除本地缓存索引。\n配置、歌单、不喜欢规则、用户数据和常规歌曲备份不受影响。\n若需直接播放已上传到 OpenList 的缓存，请确保开启本页「允许 OpenList 作为播放来源（本地优先）」，并在 Web 播放器或 Subsonic 配置中开启对应缓存优先选项（不会自动修改 Subsonic 开关）。')
        }
    }

    collectOpenlistUserBackups() {
        const hidden = document.querySelector('input[name="openlist.userBackupUsers"]')
        const selected = (hidden && hidden.value ? hidden.value.split(',').map(s => s.trim()).filter(Boolean) : [])
        return JSON.stringify(selected.map(u => {
            const d = document.getElementById('openlist-dl-sw-' + u)
            const c = document.getElementById('openlist-ca-sw-' + u)
            const s = document.getElementById('openlist-snap-sw-' + u)
            const m = document.getElementById('openlist-mode-' + u)
            return { user: u, enabled: true, backupDownload: false, backupCache: c ? !!c.checked : false, backupSnapshot: false, mode: (m ? m.value : 'upload') }
        }))
    }

    async testOpenlistConnection() {
        const form = document.getElementById('openlist-form')
        if (!form) return
        const fd = new FormData(form)
        const payload = {
            endpoint: (fd.get('openlist.endpoint') || '').trim(),
            token: fd.get('openlist.token'),
            root: (fd.get('openlist.root') || '').trim() || '/lx_music',
        }
        if (!payload.endpoint) {
            if (window.showError) window.showError('请先填写 OpenList 服务器地址')
            return
        }
        try {
            const r = await this.request('/api/openlist/test', { method: 'POST', body: JSON.stringify(payload) })
            if (r && r.success && r.ok) {
                if (window.showSuccess) window.showSuccess('OpenList 连接成功')
            } else {
                if (window.showError) window.showError('连接失败: ' + ((r && r.error) || '未知错误'))
            }
        } catch (e) {
            console.error(e)
            if (window.showError) window.showError('测试连接出错: ' + (e && e.message || e))
        }
    }

    async runOpenlistSync() {
        try {
            if (window.showInfo) window.showInfo('正在同步，请稍候…')
            const r = await this.request('/api/openlist/sync', { method: 'POST', body: JSON.stringify({}) })
            if (r && r.success) {
                const s = r.summary || {}
                const msg = '同步完成：上传 ' + (s.uploaded || 0) + '，下载 ' + (s.downloaded || 0) + '，删除 ' + (s.deleted || 0) +
                    ((s.errors && s.errors.length) ? ('，错误 ' + s.errors.length + ' 项') : '')
                if (window.showSuccess) window.showSuccess(msg)
                if (s.errors && s.errors.length) console.warn('OpenList 同步错误', s.errors)
                this.loadOpenlistBackups()
            } else {
                if (window.showError) window.showError('同步失败: ' + ((r && r.error) || (r.summary?.errors || []).join('；') || '未知错误'))
            }
        } catch (e) {
            console.error(e)
            if (window.showError) window.showError('同步出错: ' + (e && e.message || e))
        }
    }

    filterOpenlistRecords(records, ignoreStatus = false) {
        const value = id => (document.getElementById(id)?.value || '').trim();
        const user = value('olb-filter-user'), folder = value('olb-filter-folder'), status = value('olb-filter-status');
        const local = value('olb-filter-local'), subtype = value('olb-filter-type');
        const localState = value('olb-filter-local-state'), remoteState = value('olb-filter-remote-state'), integrity = value('olb-filter-integrity');
        const words = value('olb-filter-name').toLowerCase().split(/\s+/).filter(Boolean);
        const pathQuery = value('olb-filter-path').toLowerCase();
        const from = value('olb-filter-from'), to = value('olb-filter-to');
        const fromDate = from ? new Date(from + 'T00:00:00') : null;
        const toDate = to ? new Date(to + 'T00:00:00') : null;
        if (toDate) toDate.setDate(toDate.getDate() + 1);
        const result = records.filter(file => {
            if (user && file.user !== user || folder && file.folder_type !== folder || !ignoreStatus && status && file.status !== status) return false;
            if (local && file.local_exists !== (local === 'yes')) return false;
            if (localState && file.local_state !== localState || remoteState && (file.remote_state || 'unchecked') !== remoteState) return false;
            const checkState = file.verification_stale ? 'stale' : file.content_verification || 'unchecked';
            if (integrity && checkState !== integrity) return false;
            if (subtype && this.olbSnapshotType(file) !== subtype) return false;
            const updated = Number(file.updated_at);
            if (fromDate && !(updated >= fromDate.getTime()) || toDate && !(updated < toDate.getTime())) return false;
            const paths = `${file.local_path || ''} ${file.remote_path || ''}`.toLowerCase();
            if (pathQuery && !paths.includes(pathQuery)) return false;
            const haystack = `${file.name || ''} ${file.user || ''} ${file.source || ''} ${file.songmid || ''} ${paths} ${typeof file.cache_metadata === 'object' ? JSON.stringify(file.cache_metadata) : file.cache_metadata || ''}`.toLowerCase();
            return words.every(word => haystack.includes(word));
        });
        const sort = value('olb-filter-sort') || 'time-desc';
        return result.sort((a, b) => {
            const field = sort.slice(0, sort.lastIndexOf('-'));
            const text = file => field === 'name' ? String(file.name || file.local_path || '').split(/[\\/]/).pop()
                : field === 'user' ? file.user : field === 'type' ? file.backup_type || file.folder_type
                    : field === 'status' ? file.status : field === 'error' ? file.error : '';
            let comparison = ['name', 'user', 'type', 'status', 'error'].includes(field) ? String(text(a) || '').localeCompare(String(text(b) || ''), 'zh-CN', { numeric: true })
                : field === 'local' ? Number(a.local_exists ?? -1) - Number(b.local_exists ?? -1)
                    : sort.startsWith('size') ? (Number(a.size) || 0) - (Number(b.size) || 0)
                        : (Number(a.updated_at) || 0) - (Number(b.updated_at) || 0);
            if (sort.endsWith('desc')) comparison = -comparison;
            return comparison || (Number(a.id) || 0) - (Number(b.id) || 0);
        });
    }

    sortOpenlistColumn(field) {
        const select = document.getElementById('olb-filter-sort');
        if (!select) return;
        select.value = select.value === field + '-asc' ? field + '-desc' : field + '-asc';
        this.syncCustomSelects();
        this.applyOpenlistFilter();
    }

    renderOpenlistFilterFeedback(count) {
        const box = document.getElementById('olb-filter-feedback');
        if (!box) return;
        const conditions = [['bm-rec-type', '数据类型'], ['olb-filter-user', '用户'], ['olb-filter-folder', '类别'], ['olb-filter-status', '状态'], ['olb-filter-local', '本地'], ['olb-filter-local-state', '本地变化'], ['olb-filter-remote-state', '云端检查'], ['olb-filter-integrity', '内容校验'], ['olb-filter-name', '搜索'], ['olb-filter-path', '路径'], ['olb-filter-type', '快照'], ['olb-filter-from', '日期从'], ['olb-filter-to', '日期至']];
        box.textContent = `匹配 ${count} 条记录`;
        for (const [id, label] of conditions) {
            const control = document.getElementById(id);
            if (!control?.value) continue;
            const text = control.options?.[control.selectedIndex]?.textContent || control.value;
            const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'olb-active-filter';
            chip.textContent = `${label}：${text} ×`; chip.setAttribute('aria-label', `移除${label}筛选`);
            chip.onclick = () => { control.value = ''; this.syncCustomSelects(); id === 'bm-rec-type' ? this.selectRecordsType('') : this.applyOpenlistFilter(); };
            box.appendChild(chip);
        }
        const from = document.getElementById('olb-filter-from')?.value, to = document.getElementById('olb-filter-to')?.value;
        if (from && to && from > to) box.appendChild(document.createTextNode(' 起始日期不能晚于结束日期。'));
    }

    async openOpenlistMetadataCheck(preferredScope) {
        let total;
        try { total = (await this.request('/api/openlist/metadata')).total; }
        catch (error) { window.showError?.('无法获取检查范围：' + error.message); return; }
        const selected = Array.from(this._olbSelected || []);
        if (preferredScope === 'selected' && !selected.length) { window.showError?.('请先勾选要检查的文件'); return; }
        const filtered = this.filterOpenlistRecords(this._olbCurrentList || []).map(file => file.id);
        this._olMetadataScopes = { selected, filtered };
        const modal = document.getElementById('modal');
        document.getElementById('modal-title').textContent = '检查文件';
        document.getElementById('modal-body').innerHTML = `
            <p class="config-hint">只检查存在性、大小和修改时间，不上传、不下载正文、不删除文件，也不进行 SHA-256 内容校验。云端每项会产生 API 请求。</p>
            <div class="form-group"><label for="ol-metadata-target">检查位置</label><select id="ol-metadata-target" class="form-input"><option value="both">本地与云端</option><option value="local">仅本地</option><option value="remote">仅云端</option></select></div>
            <div class="form-group"><label for="ol-metadata-scope">检查范围</label><select id="ol-metadata-scope" class="form-input"><option value="filtered">当前筛选结果（${filtered.length} 项）</option><option value="selected" ${selected.length ? '' : 'disabled'}>已选记录（${selected.length} 项）</option><option value="all">当前连接的全部备份记录（${Number(total) || 0} 项）</option></select></div>
            <p class="config-hint">逐项后台执行；停止后保留已完成的结果。文件范围按打开窗口时的筛选确定，仅检查记录主文件，绑定附件请使用内容校验入口；历史版本对象不在检查范围。</p>
            <div class="form-actions"><button type="button" class="btn-primary" id="ol-metadata-submit" onclick="app.startOpenlistMetadataCheck()">开始检查</button><button type="button" class="btn-secondary" onclick="app.closeModal()">取消</button></div>`;
        if (preferredScope === 'selected') document.getElementById('ol-metadata-scope').value = 'selected';
        modal.classList.remove('hidden');
        this.initCustomSelects();
    }

    async startOpenlistMetadataCheck() {
        const button = document.getElementById('ol-metadata-submit');
        if (button.disabled) return;
        const target = document.getElementById('ol-metadata-target').value;
        const scope = document.getElementById('ol-metadata-scope').value;
        const ids = scope === 'all' ? undefined : this._olMetadataScopes?.[scope];
        if (scope !== 'all' && !ids?.length) { window.showError?.('所选范围没有文件'); return; }
        button.disabled = true;
        try {
            await this.request('/api/openlist/metadata/start', { method: 'POST', body: JSON.stringify({ target, ids }) });
            this.closeModal();
            await this.loadOpenlistMetadataStatus();
        } catch (error) { window.showError?.('检查启动失败：' + error.message); }
        finally { button.disabled = false; }
    }

    async cancelOpenlistMetadataCheck() {
        try { await this.request('/api/openlist/metadata/cancel', { method: 'POST', body: '{}' }); await this.loadOpenlistMetadataStatus(); }
        catch (error) { window.showError?.('停止失败：' + error.message); }
    }

    async loadOpenlistMetadataStatus() {
        const box = document.getElementById('ol-metadata-progress');
        if (!box) return;
        try {
            const { job } = await this.request('/api/openlist/metadata');
            if (!job) { box.textContent = ''; return; }
            const labels = { running: '检查中', paused: '等待连接恢复', completed: '检查完成', cancelled: '已停止', interrupted: '进程中断', failed: '检查失败' };
            const targets = { local: '本地', remote: '云端', both: '本地与云端' };
            box.textContent = `${targets[job.target] || ''} · ${labels[job.state] || '未知'} · ${job.done}/${job.total} 项 · 异常 ${job.failed} 项 · ${new Date(job.finishedAt || job.startedAt).toLocaleString('zh-CN')}`;
            if (['running', 'paused'].includes(job.state)) {
                const stop = document.createElement('button'); stop.type = 'button'; stop.className = 'btn-secondary olb-act-btn'; stop.textContent = '停止检查'; stop.onclick = () => this.cancelOpenlistMetadataCheck(); box.appendChild(stop);
                clearTimeout(this._olMetadataTimer);
                if (this.currentView === 'backups') this._olMetadataTimer = setTimeout(() => this.loadOpenlistMetadataStatus(), 1500);
            } else {
                clearTimeout(this._olMetadataTimer);
                if (this._olMetadataFinished !== job.id + job.state) { this._olMetadataFinished = job.id + job.state; await this.loadOpenlistBackups(true); }
            }
        } catch { box.textContent = '无法读取文件检查进度，请重新刷新记录。'; }
    }

    renderOpenlistConnection(connection) {
        if (connection) this._olbConnection = connection;
        const c = this._olbConnection, box = document.getElementById('olb-connection');
        if (!box || !c) return;
        const esc = value => this.escapeHtml(String(value));
        const time = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '暂无';
        const titles = { online: 'OpenList 连接正常', unavailable: 'OpenList 暂时无法访问', auth_error: 'OpenList 认证或权限异常', unknown: 'OpenList 连接待探测', disabled: 'OpenList 未启用' };
        const busy = !!this._olbProbeBusy;
        box.dataset.state = c.state;
        box.innerHTML = '<div class="olb-connection-symbol" aria-hidden="true">☁</div><div class="olb-connection-copy"><strong>' +
            esc(titles[c.state] || titles.unknown) + '</strong><p>' + esc(c.message) +
            '。历史备份记录保留，连接状态不代表文件内容校验结果。</p><div class="olb-connection-meta">最近探测：' +
            esc(time(c.checkedAt)) + (c.checking ? ' · 正在重新检查文件' : '') + ' · 最近成功：' + esc(time(c.lastSuccessAt)) +
            (c.nextProbeAt ? ' · 下次自动探测：' + esc(time(c.nextProbeAt)) : '') +
            '</div></div><button type="button" class="btn-secondary olb-probe-button" onclick="app.probeOpenlistConnection()" ' +
            (busy || !c.enabled ? 'disabled' : '') + '>' + (busy ? '正在探测…' : '探测连接') + '</button>';
        if (!this._olbConnectionTimer) this._olbConnectionTimer = setInterval(async () => {
            const el = document.getElementById('olb-connection');
            if (!el || !el.getClientRects().length) return;
            try {
                const r = await this.request('/api/openlist/connection');
                const changed = this._olbConnection?.state !== r.connection?.state;
                this.renderOpenlistConnection(r.connection);
                if (changed) await this.loadOpenlistBackups(true);
            } catch { /* Keep the last observation; a failed admin request is not OpenList health. */ }
        }, 15000);
    }

    async probeOpenlistConnection() {
        if (this._olbProbeBusy) return;
        this._olbProbeBusy = true;
        this.renderOpenlistConnection();
        try {
            const r = await this.request('/api/openlist/connection', { method: 'POST' });
            this.renderOpenlistConnection(r.connection);
            await this.loadOpenlistBackups(true);
        } catch (error) {
            if (window.showError) window.showError('无法完成连接探测：' + error.message);
        } finally {
            this._olbProbeBusy = false;
            this.renderOpenlistConnection();
        }
    }

    renderOpenlistCheckTimes(records) {
        const format = n => new Date(n).toLocaleString('zh-CN', { hour12: false });
        for (const [side, field] of [['local', 'local_checked_at'], ['remote', 'remote_checked_at']]) {
            const box = document.getElementById('olb-' + side + '-check-time');
            if (!box) continue;
            const times = records.map(file => Number(file[field])).filter(n => n > 0);
            box.textContent = times.length ? `已检查 ${times.length}/${records.length} 项 · 最近 ${format(times.reduce((a, b) => Math.max(a, b), 0))}` : '此范围暂无检查记录';
            box.title = times.length ? `本范围最早检查：${format(times.reduce((a, b) => Math.min(a, b), Infinity))}；最近：${format(times.reduce((a, b) => Math.max(a, b), 0))}。部分文件的检查时间可能不同，详见记录详情。` : '检查结果绑定当前连接和已登记备份版本。';
        }
    }

    openlistStateTags(file) {
        const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        const icons = {
            local: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18M7 17h.01M11 17h.01"/>',
            remote: '<path d="M6 19a4 4 0 0 1-.7-7.94A7 7 0 0 1 19 9a5 5 0 0 1 0 10Z"/>'
        };
        const states = {
            same: ['上次未变', 'success'], changed: ['有变化', 'warning'], missing: ['缺失', 'danger'],
            unavailable: ['暂无法检查', 'warning'], error: ['检查失败', 'danger'], unknown: ['信息不全', 'neutral'],
            untracked: ['版本未知', 'neutral'], unchecked: ['未检查', 'neutral']
        };
        const badges = ['local', 'remote'].map(side => {
            const state = file[side + '_state'] || 'unchecked';
            const [label, tone] = states[state] || states.unknown;
            const name = side === 'local' ? '本地' : '云端';
            const time = file[side + '_checked_at'];
            const tip = `${name}：${label}（历史观察结果）。只检查存在性、大小与修改时间，不代表内容一致。${time ? '最近检查：' + new Date(time).toLocaleString('zh-CN') : '暂无检查时间。'}`;
            return `<span class="olb-state-tag olb-observation-tag is-${tone}" title="${esc(tip)}" aria-label="${esc(tip)}"><svg class="olb-state-icon is-${side}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[side]}</svg>${label}</span>`;
        });
        // 本地变化或待传输时，旧的内容通过结果只留在详情，避免掩盖当前任务。
        if (file.local_state !== 'changed' && !['pending', 'download', 'uploading'].includes(file.status)) {
            const check = file.verification_stale ? 'stale' : file.content_verification;
            const labels = { matched: '曾校验通过', stale: '需重新校验', mismatch: '内容不一致', missing: '校验时缺失', error: '校验失败', unavailable: '缺少校验基线' };
            if (labels[check]) {
                const tone = check === 'matched' ? 'success' : ['stale', 'unavailable'].includes(check) ? 'warning' : 'danger';
                const time = file.content_verified_at ? new Date(file.content_verified_at).toLocaleString('zh-CN') : '';
                badges.push(`<span class="olb-state-tag is-${tone}" title="历史内容校验结果${time ? '：' + esc(time) : ''}，不保证当前内容始终一致">${labels[check]}</span>`);
            }
        }
        return badges.join('');
    }

    async loadOpenlistBackups(silent, fromCache = false) {
        const box = document.getElementById('openlist-backups-list')
        if (!box) return
        if (!silent) box.innerHTML = '<div class="config-hint">加载中…</div>'
        try {
            const r = fromCache && this._olbRawRecords ? { list: this._olbRawRecords } : await this.request('/api/openlist/backups')
            this.renderOpenlistConnection(r.connection);
            this._olbRawRecords = r.list || []
            let list = ((r && r.list) || []).map(f => ({ ...f, status: f.task_state || (['completed', 'verified'].includes(f.status) ? 'completed' : f.status) }))
            // 先按当前 tab 的 folder scope 过滤（媒体文件记录=cache,music；系统配置=system；歌单快照=list），统计卡与下方列表口径一致
            const scope = this._olbFolderScope
            if (scope) {
                const allowed = scope.split(',')
                list = list.filter(f => {
                    if (allowed.includes(f.folder_type)) return true
                    // 歌单快照 tab：selectedData 模式下歌单/不喜欢快照记在 folder_type='data'，路径含 /(list|dislike)/snapshot，需纳入展示
                    if (f.folder_type === 'data') {
                        if (f.backup_type === 'music' && allowed.includes('music')) return true
                        if (f.backup_type === 'system' && allowed.includes('system')) return true
                        if (f.backup_type === 'snapshots' && allowed.includes('list')) return true
                        if (['userFiles', 'userData'].includes(f.backup_type) && allowed.includes(f.backup_type)) return true
                    }
                    return false
                })
            }
            // 歌单快照页：按「我的歌单 / 我不喜欢」类型下拉过滤
            const inSnapshot = scope && scope.split(',').includes('list')
            const tfEl = document.getElementById('olb-filter-type')
            const tf = tfEl ? tfEl.value : ''
            if (inSnapshot && tf) {
                list = list.filter(f => this.olbSnapshotType(f) === tf)
            }
            list = this.filterOpenlistRecords(list, true)
            this._olbCurrentList = list
            // 状态指标卡：基于当前页签过滤后的列表统计各状态数量（deleted 不计入 list，通常为 0）
            const STATUS_LABEL = { pending: '待上传', download: '待下载', uploading: '传输中', completed: '已备份', attention: '需处理', paused: '已暂停', failed: '失败', deleted: '已删除' }
            const STATUS_COLOR = { pending: '#64748b', uploading: '#3b82f6', completed: '#0ea5e9', download: '#a78bfa', attention: '#f59e0b', paused: '#94a3b8', failed: '#ef4444', deleted: '#94a3b8' }
            const statusOrder = ['pending', 'download', 'uploading', 'completed', 'attention', 'failed', 'paused']
            const statusCounts = {}
            for (const s of statusOrder) statusCounts[s] = 0
            for (const f of list) { if (f && f.status && statusCounts[f.status] !== undefined) statusCounts[f.status]++ }
            const cardsBox = document.getElementById('openlist-status-cards')
            if (cardsBox) {
                const activeStatus = (document.getElementById('olb-filter-status') || {}).value || ''
                cardsBox.innerHTML = statusOrder.map((st) => {
                    const n = statusCounts[st] || 0
                    const color = STATUS_COLOR[st] || '#64748b'
                    const label = STATUS_LABEL[st] || st
                    const isActive = activeStatus === st ? ' active' : ''
                    return '<button type="button" class="olb-stat-card' + isActive + '" aria-pressed="' + (activeStatus === st) + '" data-status="' + st + '" title="点击按「' + label + '」筛选" onclick="app.filterOpenlistByStatus(\'' + st + '\')" style="--stat-color:' + color + ';">' +
                        '<div class="olb-stat-header">' +
                        '<span class="olb-stat-dot" style="background:' + color + ';"></span>' +
                        '<span class="olb-stat-label">' + label + '</span>' +
                        '</div>' +
                        '<div class="olb-stat-num" style="color:' + color + ';">' + n + '</div>' +
                        '</button>'
                }).join('')
            }
            // 用户候选来自完整缓存，不受当前类型和其他筛选条件限制。
            const userSel = document.getElementById('olb-filter-user')
            if (userSel) {
                const previous = userSel.value
                const users = [...new Set(this._olbRawRecords.map(f => f.user).filter(Boolean))].sort()
                if (previous && !users.includes(previous)) users.push(previous)
                userSel.innerHTML = '<option value="">全部用户</option>'
                users.forEach(u => { const o = document.createElement('option'); o.value = u; o.textContent = u; userSel.appendChild(o) })
                userSel.value = previous
            }
            this.initCustomSelects()
            const summaryBox = document.getElementById('openlist-records-summary')
            if (summaryBox) {
                const completedTotal = statusCounts.completed || 0
                const verifiedTotal = list.filter(f => f.status === 'completed' && f.content_verification === 'matched' && !f.verification_stale && f.local_state !== 'changed').length
                const failedTotal = statusCounts.failed || 0
                summaryBox.innerHTML =
                    '<span class="olb-summary-pill">共 <b>' + list.length + '</b> 条</span>' +
                    '<span class="olb-summary-pill">已备份 <b>' + completedTotal + '</b></span>' +
                    '<span class="olb-summary-pill is-verified">内容曾校验通过 <b>' + verifiedTotal + '</b></span>' +
                    (failedTotal > 0 ? '<span class="olb-summary-pill is-failed">失败 <b>' + failedTotal + '</b></span>' : '')
            }
            const selectedStatus = document.getElementById('olb-filter-status')?.value || ''
            if (selectedStatus) list = list.filter(file => file.status === selectedStatus)
            this.renderOpenlistFilterFeedback(list.length)
            this.renderOpenlistCheckTimes(list)
            void this.loadOpenlistMetadataStatus()
            const pageSize = this._olbPageSize || 50
            const total = list.length
            const totalPages = Math.max(1, Math.ceil(total / pageSize))
            this._olbTotalPages = totalPages
            if (!this._olbPage || this._olbPage < 1) this._olbPage = 1
            if (this._olbPage > totalPages) this._olbPage = totalPages
            const start = (this._olbPage - 1) * pageSize
            if (!total) {
                box.innerHTML = '<div class="olb-empty-state">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="olb-empty-icon">' +
                    '<path d="M19 11H5m14 0a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2m14 0V9a2 2 0 0 0-2-2M5 11V9a2 2 0 0 1 2-2m0 0V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2M7 7h10"></path>' +
                    '</svg>' +
                    '<div class="olb-empty-title">暂无符合条件的备份记录</div>' +
                    '<div class="olb-empty-desc">可尝试调整或清除上方筛选条件，或点击「立即备份并同步缓存」触发新同步</div>' +
                    '</div>'
                return
            }
            const statusMap = { pending: '待上传', download: '待下载', uploading: '传输中', completed: '已备份', attention: '需处理', paused: '已暂停', failed: '失败', deleted: '已删除' }
            const badgeColor = { pending: '#64748b', uploading: '#3b82f6', completed: '#0ea5e9', download: '#a78bfa', attention: '#f59e0b', paused: '#94a3b8', failed: '#ef4444', deleted: '#94a3b8' }
            const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
            const fmtName = (f) => {
                const nm = (f.name || '').toString().trim()
                const base = nm ? nm.split(/[\\/]/).pop() : ((f.local_path ? f.local_path.split(/[\\/]/).pop() : '') || '(未知)')
                return esc(base)
            }
            const fmtSize = (n) => {
                n = Number(n) || 0
                if (n < 1024) return n + ' B'
                if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
                return (n / 1024 / 1024).toFixed(1) + ' MB'
            }
            this._olbPageIds = list.slice(start, start + pageSize).map(f => f.id)
            const rows = list.slice(start, start + pageSize).map(f => {
                const d = new Date(f.updated_at || f.created_at || Date.now())
                const color = badgeColor[f.status] || '#64748b'
                const label = statusMap[f.status] || f.status || ''
                let typeLabel
                if (this._olbFolderScope && this._olbFolderScope.split(',').includes('list')) {
                    const st = this.olbSnapshotType(f)
                    typeLabel = st === 'dislike' ? '我不喜欢' : (st === 'list' ? '我的歌单' : (f.folder_type === 'list' ? '我的歌单' : '数据备份'))
                } else {
                    typeLabel = f.folder_type === 'data' ? ({ music: '歌曲与歌词', system: '系统与账户', userFiles: '用户音源文件', userData: '用户数据', snapshots: '快照' }[f.backup_type] || '数据备份') : f.folder_type === 'music' ? '下载' : (f.folder_type === 'cache' ? '缓存' : (f.folder_type === 'list' ? '快照' : (f.folder_type || '')))
                }
                const canRetry = ['failed', 'pending', 'download', 'attention'].includes(f.status)
                const retryBtn = canRetry
                    ? '<button type="button" class="olb-act-btn is-retry" title="按配置重新上传或下载此记录" onclick="app.retryOpenlistBackup(' + f.id + ')">' + (f.direction === 'download' || f.sync_mode === 'download' ? '重试下载' : '重试上传') + '</button>'
                    : ''
                const hasLocal = !!f.local_exists
                const localMark = f.local_exists == null ? '<span class="olb-local-badge" title="无法检查本地文件，请检查服务端文件权限">未知</span>' : hasLocal
                    ? '<span class="olb-local-badge is-yes" title="本地文件存在">✓ 存在</span>'
                    : '<span class="olb-local-badge is-no" title="本地文件不存在或已被清理">✗ 已删</span>'
                const errStr = f.remote_state === 'unavailable' ? '等待 OpenList 连接恢复，历史备份记录保留' : f.error || f.remote_error || ''
                const errCell = errStr
                    ? '<span class="olb-err-text" title="' + esc(errStr) + '">' + esc(errStr.length > 46 ? errStr.slice(0, 46) + '…' : errStr) + '</span>'
                    : '<span class="olb-muted-dash">—</span>'
                const sel = this._olbSelected || (this._olbSelected = new Set())
                const isSelected = sel.has(f.id)
                const checked = isSelected ? 'checked' : ''
                return '<tr class="' + (isSelected ? 'is-selected' : '') + '">' +
                    '<td class="olb-col-check"><input type="checkbox" class="lx-checkbox olb-sel" data-id="' + f.id + '" ' + checked + ' onchange="app.toggleOpenlistSelect(this)"></td>' +
                    '<td><span class="olb-user-tag">' + esc(f.user || '') + '</span></td>' +
                    '<td><span class="olb-type-badge">' + esc(typeLabel) + '</span></td>' +
                    '<td class="olb-col-name" title="' + esc(f.name || f.local_path || '') + '"><span class="olb-filename-text">' + fmtName(f) + '</span></td>' +
                    '<td class="olb-col-state"><div class="olb-status-line"><span class="olb-badge" style="--badge-color:' + color + ';"><span class="olb-badge-dot"></span>' + label + '</span>' + this.openlistStateTags(f) + '</div></td>' +
                    '<td class="olb-col-size">' + fmtSize(f.size) + '</td>' +
                    '<td style="text-align:center;white-space:nowrap;">' + localMark + '</td>' +
                    '<td class="olb-col-err">' + errCell + '</td>' +
                    '<td class="olb-col-time">' + d.toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '</td>' +
                    '<td class="olb-col-actions"><div class="olb-row-actions"><button type="button" class="olb-act-btn" title="只检查元信息，不上传或下载文件" onclick="app.checkOpenlistBackup(' + f.id + ')">检查</button>' + retryBtn + '<button type="button" class="olb-act-btn" onclick="app.showOpenlistDetail(' + f.id + ')">详情</button><button type="button" class="olb-act-btn is-delete" title="删除此项云端备份（将先显示删除范围）" onclick="app.deleteSelectedOpenlist(' + f.id + ')">删除</button></div></td>' +
                    '</tr>'
            }).join('')
            const pager = '<div class="olb-pager">' +
                '<div class="olb-pager-left">' +
                '<span class="olb-pager-info">显示第 <b>' + (start + 1) + '–' + Math.min(start + pageSize, total) + '</b> 条，共 <b>' + total + '</b> 条记录（第 ' + this._olbPage + ' / ' + totalPages + ' 页）</span>' +
                '</div>' +
                '<div class="olb-pager-right">' +
                '<button type="button" class="btn-secondary olb-pager-btn" ' + (this._olbPage <= 1 ? 'disabled' : '') + ' onclick="app.gotoOpenlistPage(1)">« 首页</button>' +
                '<button type="button" class="btn-secondary olb-pager-btn" ' + (this._olbPage <= 1 ? 'disabled' : '') + ' onclick="app.gotoOpenlistPage(Math.max(1,(app._olbPage||1)-1))">‹ 上一页</button>' +
                '<span class="olb-pager-page-pill">' + this._olbPage + ' / ' + totalPages + '</span>' +
                '<button type="button" class="btn-secondary olb-pager-btn" ' + (this._olbPage >= totalPages ? 'disabled' : '') + ' onclick="app.gotoOpenlistPage(Math.min(' + totalPages + ',(app._olbPage||1)+1))">下一页 ›</button>' +
                '<button type="button" class="btn-secondary olb-pager-btn" ' + (this._olbPage >= totalPages ? 'disabled' : '') + ' onclick="app.gotoOpenlistPage(' + totalPages + ')">末页 »</button>' +
                '<select class="form-input config-input olb-select olb-pagesize-select" onchange="app.setOpenlistPageSize(this.value)">' +
                '<option value="50"' + (pageSize === 50 ? ' selected' : '') + '>50 条/页</option>' +
                '<option value="100"' + (pageSize === 100 ? ' selected' : '') + '>100 条/页</option>' +
                '<option value="200"' + (pageSize === 200 ? ' selected' : '') + '>200 条/页</option>' +
                '</select>' +
                '</div></div>'
            const currentSort = document.getElementById('olb-filter-sort')?.value || 'time-desc';
            const heading = (field, label, width) => {
                const active = currentSort.startsWith(field + '-');
                const direction = currentSort.endsWith('-asc') ? 'ascending' : 'descending';
                return '<th style="width:' + width + 'px;" aria-sort="' + (active ? direction : 'none') + '"><button type="button" class="olb-sort-heading" onclick="app.sortOpenlistColumn(\'' + field + '\')">' + label + '<span aria-hidden="true">' + (active ? direction === 'ascending' ? ' ↑' : ' ↓' : ' ↕') + '</span></button></th>';
            };
            box.innerHTML = '<div class="backup-table-wrapper olb-table-wrapper">' +
                '<table class="backup-policy-table olb-records-table olb-file-records">' +
                '<thead><tr>' +
                '<th style="width:44px;text-align:center;"><input type="checkbox" class="lx-checkbox" id="olb-selall" onchange="app.toggleOpenlistSelectAll(this)"></th>' +
                heading('user', '用户', 88) +
                heading('type', '类型', 96) +
                heading('name', '文件名', 260) +
                heading('status', '任务状态 / 文件检查 / 内容校验', 340) +
                heading('size', '大小', 88) +
                heading('local', '本地', 76) +
                heading('error', '异常原因', 160) +
                heading('time', '更新时间', 152) +
                '<th style="width:250px;text-align:center;">操作</th>' +
                '</tr></thead><tbody>' + rows + '</tbody></table></div>' + pager
            this.initCustomSelects()
            this.updateOlbSelCount()
        } catch (e) {
            console.error(e)
            box.innerHTML = '<div class="config-hint" style="color:var(--danger);">加载失败: ' + (e && e.message || e) + '</div>'
        }
    }

    async checkOpenlistBackup(id) {
        try {
            await this.request('/api/openlist/metadata/start', { method: 'POST', body: JSON.stringify({ target: 'both', ids: [id] }) });
            await this.loadOpenlistMetadataStatus();
        } catch (error) {
            if (window.showError) window.showError('无法开始检查：' + error.message);
        }
    }

    async retryOpenlistBackup(id) {
        try {
            const r = await this.request('/api/openlist/retry', { method: 'POST', body: JSON.stringify({ id }) })
            if (r && r.success) {
                if (window.showInfo) window.showInfo('已提交重试')
                this.loadOpenlistBackups(true)
            } else if (window.showError) {
                window.showError('重试失败: ' + ((r && (r.message || r.error)) || '未知错误'))
            }
        } catch (e) {
            console.error(e)
            if (window.showError) window.showError('重试失败: ' + (e && e.message || e))
        }
    }

    async retrySelectedOpenlist() {
        if (this._olbRetryBusy || !this._olbSelected || !this._olbSelected.size) return
        const ids = Array.from(this._olbSelected)
        this._olbRetryBusy = true
        this.updateOlbSelCount?.()
        try {
            if (!(await showSelect('批量重试 OpenList 文件', '将对选中的 ' + ids.length + ' 条记录按已保存规则重新上传、下载或检查。\n\n选择上传后清理模式的播放缓存，安全校验通过后可能删除本地副本。', { danger: true, confirmText: '确认重试', cancelText: '取消' }))) return
            const r = await this.request('/api/openlist/retry-batch', { method: 'POST', body: JSON.stringify({ ids }) })
            if (r && r.success) {
                if (window.showInfo) window.showInfo('已提交 ' + (r.retried || 0) + ' 条重试' + ((r.failed ? ('，' + r.failed + ' 条失败') : '')))
                this.loadOpenlistBackups(true)
            } else if (window.showError) {
                window.showError('批量重试失败: ' + ((r && (r.error || r.message)) || '未知错误'))
            }
        } catch (e) {
            console.error(e)
            if (window.showError) window.showError('批量重试失败: ' + (e && e.message || e))
        } finally {
            this._olbRetryBusy = false
            this.updateOlbSelCount?.()
        }
    }

    async showOpenlistDetail(id) {
        const requestToken = this._olbDetailRequest = (this._olbDetailRequest || 0) + 1
        let response
        try { response = await this.request('/api/openlist/backups') }
        catch { if (window.showError) window.showError('无法获取最新文件状态，请稍后重试'); return }
        if (requestToken !== this._olbDetailRequest) return
        this._olbRawRecords = response.list || []
        await this.loadOpenlistBackups(true, true)
        const f = this._olbRawRecords.find(x => x.id === id)
        if (f) f.status = f.task_state || (['completed', 'verified'].includes(f.status) ? 'completed' : f.status)
        if (!f) { if (window.showError) window.showError('未找到该记录详情'); return }
        const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        const fmtSize = (n) => { n = Number(n) || 0; if (n < 1024) return n + ' B'; if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'; return (n / 1024 / 1024).toFixed(1) + ' MB' }
        const row = (k, v) => '<tr><td class="olb-detail-key">' + esc(k) + '</td><td class="olb-detail-val">' + (v === '' || v == null ? '<span style="color:var(--text-secondary)">—</span>' : esc(v)) + '</td></tr>'
        const optional = (k, v) => v == null || String(v).trim() === '' ? '' : row(k, v)
        const fmtTime = value => {
            if (value == null || value === '') return ''
            const numeric = Number(value)
            const date = new Date(Number.isFinite(numeric) ? (Math.abs(numeric) < 1e11 ? numeric * 1000 : numeric) : value)
            if (!Number.isFinite(date.getTime())) return ''
            const pad = n => String(n).padStart(2, '0')
            return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds()) + '（本地时间）'
        }
        const statusLabels = { pending: '待上传', download: '待下载', uploading: '传输中', completed: '已备份', attention: '需处理', paused: '已暂停', failed: '失败', deleted: '已删除' }
        const folderLabels = { data: '数据备份', cache: '播放缓存', music: '用户下载', list: '歌单快照' }
        const sourceLabels = { wy: '网易云音乐', tx: 'QQ 音乐', kw: '酷我音乐', kg: '酷狗音乐', mg: '咪咕音乐' }
        const filename = String(f.name || f.local_path || '').split(/[\\/]/).pop() || ''
        const isAudio = /\.(mp3|flac|m4a|aac|ogg|opus|wav|wma|ape|alac|aiff|aif|dsf|dff)$/i.test(filename)
        const fileKind = isAudio ? '音频文件' : /\.lrc$/i.test(filename) ? '歌词文件' : /\.json$/i.test(filename) ? 'JSON 数据文件' : /\.(jpg|jpeg|png|webp|gif|avif)$/i.test(filename) ? '图片文件' : '普通文件'

        let metaObj = null
        if (f.cache_metadata) {
            try {
                metaObj = typeof f.cache_metadata === 'string' ? JSON.parse(f.cache_metadata) : f.cache_metadata
            } catch { metaObj = null }
        }

        // 提取封面图片 URL (网易/QQ 等常为 img 或 pic，或本地缓存封面)
        const coverUrl = metaObj && (metaObj.img || metaObj.pic || metaObj.cover || metaObj.albumCover)

        // 渲染缓存元数据为现代 Tag 风格
        let metaHtml = ''
        if (metaObj && typeof metaObj === 'object' && Object.keys(metaObj).length) {
            const tagEntries = []
            // 常见核心字段优先展示
            const keyLabelMap = {
                id: '歌曲 ID',
                songmid: '平台 MID',
                name: '歌名',
                singer: '歌手',
                album: '专辑',
                albumId: '专辑 ID',
                interval: '时长',
                source: '来源',
                quality: '音质',
                bitrate: '比特率',
                sampleRate: '采样率',
                audioContainer: '格式',
                ext: '扩展名',
                size: '大小',
                hasCover: '含封面',
                hasLyric: '含歌词',
                hasEmbedLyric: '内嵌歌词',
                lyricFilename: '歌词文件',
                coverType: '封面来源',
                mtime: '修改时间',
                subPath: '相对子路径',
            }

            // 按类型赋予不同颜色的 tag 样式
            const getTagColorClass = (k, v) => {
                if (typeof v === 'boolean') return v ? 'ol-meta-tag-bool-true' : 'ol-meta-tag-bool-false'
                if (['source', 'quality', 'bitrate', 'audioContainer'].includes(k)) return 'ol-meta-tag-tech'
                if (['singer', 'album', 'name'].includes(k)) return 'ol-meta-tag-primary'
                if (['interval', 'size'].includes(k)) return 'ol-meta-tag-info'
                return 'ol-meta-tag-default'
            }

            // 去重：与上方表格重复或内部冗余的字段不再以 tag 展示
            const skipKeys = new Set(['img', 'pic', 'cover', 'albumCover', 'size', 'filename', 'folder', 'mtime', 'subPath', 'ext', 'coverCheckedVersion', 'coverCheckedMtime', 'coverCheckedSize', 'metadataWritable', 'lyricFilename', 'nativeIds'])
            if (metaObj.songmid === metaObj.id || !metaObj.id) skipKeys.add('songmid')
            if (metaObj.requestedSource === metaObj.source) skipKeys.add('requestedSource')
            if (metaObj.downloadSource === metaObj.source) skipKeys.add('downloadSource')
            if (metaObj.quality === f.quality) skipKeys.add('quality')
            if (metaObj.source === f.source) skipKeys.add('source')
            if (metaObj.id === f.songmid) skipKeys.add('id')
            keyLabelMap.requestedSource = '请求来源'
            keyLabelMap.downloadSource = '下载来源'
            keyLabelMap.coverCheckedVersion = '封面校验版本'
            for (const [key, val] of Object.entries(metaObj)) {
                if (skipKeys.has(key) || val === '' || val == null) continue
                if (key === 'hasLyric' && metaObj.hasEmbedLyric && val === true) continue
                const displayKey = keyLabelMap[key] || key
                let displayVal = val
                if (typeof val === 'boolean') displayVal = val ? '是' : '否'
                else if (typeof val === 'object' && val !== null) displayVal = JSON.stringify(val)
                else if (key === 'size') displayVal = fmtSize(val)
                else if (key === 'bitrate' && typeof val === 'number') displayVal = val + ' kbps'
                else if (key === 'sampleRate' && typeof val === 'number') displayVal = val + ' Hz'

                const colorCls = getTagColorClass(key, val)
                tagEntries.push(`<div class="ol-meta-tag ${colorCls}"><span class="ol-meta-tag-key">${esc(displayKey)}</span><span class="ol-meta-tag-val" title="${esc(val)}">${esc(displayVal)}</span></div>`)
            }

            metaHtml = `
            <div class="ol-meta-tags-wrapper">
                ${coverUrl ? `
                <div class="ol-meta-cover-preview">
                    <img src="${esc(coverUrl)}" alt="封面预览" class="ol-meta-cover-img" onerror="this.parentElement.style.display='none'" />
                    <span class="ol-meta-cover-label">封面预览</span>
                </div>` : ''}
                <div class="ol-meta-tags-grid">
                    ${tagEntries.join('')}
                </div>
            </div>`
        }

        // 无缓存元数据的音频（如数据备份里的 flac）：由记录字段与文件名推导 tag
        if (!metaHtml && isAudio) {
            const ext = (filename.match(/\.([^.]+)$/) || [])[1] || ''
            const stem = filename.replace(/\.[^.]+$/, '').replace(/\s*\([a-z]{2}_[^)]+\)\s*$/i, '')
            const parts = stem.split(' - ')
            const tags = []
            const mk = (cls, k, v) => v ? `<div class="ol-meta-tag ${cls}"><span class="ol-meta-tag-key">${esc(k)}</span><span class="ol-meta-tag-val" title="${esc(v)}">${esc(v)}</span></div>` : ''
            if (parts.length >= 2) {
                tags.push(mk('ol-meta-tag-primary', '歌名', parts[0]), mk('ol-meta-tag-primary', '歌手', parts[1]))
                if (parts.length >= 4) tags.push(mk('ol-meta-tag-primary', '专辑', parts.slice(3).join(' - ')))
                if (parts.length >= 3) tags.push(mk('ol-meta-tag-tech', '音质', parts[2]))
            }
            tags.push(mk('ol-meta-tag-tech', '格式', ext.toUpperCase()))
            const idm = filename.match(/\(([a-z]{2}_[^)]+)\)\.[^.]+$/i)
            if (idm) tags.push(mk('ol-meta-tag-default', '歌曲 ID', idm[1]))
            const t = tags.filter(Boolean)
            if (t.length) metaHtml = '<div class="ol-meta-tags-wrapper"><div class="ol-meta-tags-grid">' + t.join('') + '</div></div>'
        }

        const html = '<table class="olb-detail-table olb-record-detail-table">' +
            row('记录 ID', f.id) +
            row('所属用户', f.user === '_system' ? '系统公共数据' : f.user === '_open' ? '开放接口公共数据' : f.user) +
            row('备份类型', folderLabels[f.folder_type] || f.folder_type) +
            row('文件类型', fileKind) +
            row('文件名', f.name) +
            row('状态', statusLabels[f.status] || f.status) +
            row('大小', f.size == null ? null : fmtSize(f.size)) +
            (isAudio ? optional('来源平台', sourceLabels[f.source] || f.source) + optional('音质', f.quality) + optional('歌曲 ID', f.songmid) : '') +
            row('状态说明', ({ same: '本地大小和修改时间未变', changed: '本地有变化，等待备份', missing: '本地不存在', untracked: '缺少本地版本基线', error: '本地无法检查' })[f.local_state] || '未检查') +
            row('云端检查', ({ unavailable: 'OpenList 暂时无法访问，保留历史备份结果', same: '大小和修改时间未变（非内容校验）', changed: '云端有变化，需重新校验', missing: '云端文件缺失', error: '检查失败', unchecked: '尚未检查', unknown: '云端未提供完整元信息' })[f.remote_state] || '尚未检查') +
            optional('本地检查时间', fmtTime(f.local_checked_at)) +
            optional('上次手动本地检查', fmtTime(f.last_manual_local_check)) +
            optional('云端检查时间', fmtTime(f.remote_checked_at)) +
            row('本地存在', f.local_exists == null ? '无法检查（请检查文件权限）' : f.local_exists ? '是' : '否') +
            row('原始错误', f.error_raw || '—') +
            row('重试次数', f.retry_count) +
            row('本地路径', f.local_path) +
            row('云端路径', f.remote_path) +
            (f.remote_size == null ? '' : row('远端大小', fmtSize(f.remote_size))) +
            optional('本地 SHA-256', f.local_hash) +
            optional('更新时间', fmtTime(f.updated_at)) +
            optional('内容校验时间', fmtTime(f.content_verified_at)) +
            optional('错误信息', f.error) +
            (metaHtml ? '<tr><td class="olb-detail-key">缓存元数据</td><td class="olb-detail-val">' + metaHtml + '</td></tr>' : '') +
            '</table>'
        const modal = document.getElementById('modal')
        const title = document.getElementById('modal-title')
        const body = document.getElementById('modal-body')
        if (modal && title && body) {
            const nmBase = String(f.name || '').trim().split(/[\\/]/).pop() || ''
            title.replaceChildren(document.createTextNode('记录详情 #' + f.id))
            if (nmBase) {
                const subtitle = document.createElement('span')
                subtitle.className = 'olb-detail-subtitle'
                subtitle.textContent = nmBase
                title.appendChild(subtitle)
            }
            body.innerHTML = html
            modal.classList.remove('hidden')
        } else {
            window.showError?.('详情窗口未加载，请刷新后台页面后重试')
        }
    }

    toggleOpenlistSelect(el) {
        const id = parseInt(el.dataset.id)
        if (!this._olbSelected) this._olbSelected = new Set()
        if (el.checked) this._olbSelected.add(id); else this._olbSelected.delete(id)
        const tr = el.closest('tr')
        if (tr) tr.classList.toggle('is-selected', el.checked)
        this.updateOlbSelCount()
    }

    toggleOpenlistSelectAll(el) {
        if (!this._olbSelected) this._olbSelected = new Set()
        const ids = this._olbPageIds || []
        ids.forEach(id => { if (el.checked) this._olbSelected.add(id); else this._olbSelected.delete(id) })
        document.querySelectorAll('.olb-sel').forEach(cb => {
            const id = parseInt(cb.dataset.id)
            const isChecked = this._olbSelected.has(id)
            cb.checked = isChecked
            const tr = cb.closest('tr')
            if (tr) tr.classList.toggle('is-selected', isChecked)
        })
        this.updateOlbSelCount()
    }

    updateOlbSelCount() {
        const n = this._olbSelected ? this._olbSelected.size : 0
        const span = document.getElementById('olb-selcount')
        if (span) {
            span.textContent = n ? ('已选 ' + n + ' 项') : ''
            span.classList.toggle('has-selection', n > 0)
        }
        const checkBtn = document.getElementById('olb-bulkcheck')
        if (checkBtn) checkBtn.disabled = n === 0
        const btn = document.getElementById('olb-bulkdel')
        if (btn) btn.disabled = n === 0
        const rbtn = document.getElementById('olb-bulkretry')
        if (rbtn) rbtn.disabled = n === 0 || !!this._olbRetryBusy
        const selAll = document.getElementById('olb-selall')
        if (selAll) {
            const pageIds = this._olbPageIds || []
            const selOnPage = pageIds.filter(id => this._olbSelected && this._olbSelected.has(id)).length
            selAll.checked = pageIds.length > 0 && selOnPage === pageIds.length
            selAll.indeterminate = selOnPage > 0 && selOnPage < pageIds.length
        }
    }

    async deleteSelectedOpenlist(singleId) {
        const ids = singleId == null ? Array.from(this._olbSelected || []) : [singleId]
        if (!ids.length) return
        const message = `将处理选中的 ${ids.length} 条备份记录。\n\n云端：尝试删除对应的当前文件及绑定附件；其他有效记录仍引用的文件会保留。历史版本不在本次删除范围，由保留策略管理。\n\n本地：播放缓存音频和未被其他记录引用的绑定附件可能一并删除；常规备份原文件（歌曲、音源、配置等）保留。\n\n注意：云端删除失败时文件可能残留，但备份记录仍可能隐藏。此操作不是只清空列表，也不是自动镜像清理。`
        if (!(await showSelect('删除 OpenList 云端备份', message, { danger: true, confirmText: '确认删除', cancelText: '保留备份' }))) return
        try {
            const r = await this.request('/api/openlist/delete', { method: 'POST', body: JSON.stringify({ ids }) })
            if (r && r.success) {
                ids.forEach(id => this._olbSelected?.delete(id))
                if (r.remoteFailed?.length) {
                    window.showError?.('已移除 ' + (r.deleted || 0) + ' 条记录，但有 ' + r.remoteFailed.length + ' 项云端删除失败或未执行，文件可能仍保留在 OpenList。请检查连接、权限及云端目录。')
                } else {
                    window.showInfo?.('已移除 ' + (r.deleted || 0) + ' 条记录，删除 ' + (r.remoteRemoved || 0) + ' 个云端文件；共享文件及历史版本可能保留。')
                }
                this.loadOpenlistBackups()
            } else if (window.showError) {
                window.showError('删除失败: ' + ((r && r.error) || '未知错误'))
            }
        } catch (e) {
            if (window.showError) window.showError('删除失败: ' + (e && e.message || e))
        }
    }

    invalidateOpenlistIntegrity() {
        this._olIntegrityPlan = null;
        document.getElementById('ol-integrity-start').disabled = true;
        document.getElementById('ol-integrity-estimate').textContent = '范围已变化，请重新统计文件数量与预计读取量。';
    }

    async previewOpenlistIntegrity() {
        this.invalidateOpenlistIntegrity();
        try {
            const options = { type: document.getElementById('ol-integrity-type').value, user: document.getElementById('ol-integrity-user').value, scope: document.getElementById('ol-integrity-scope').value };
            const plan = await this.request('/api/openlist/integrity/preview', { method: 'POST', body: JSON.stringify(options) });
            // Ignore a response if the user changed the range while it was loading.
            if (JSON.stringify(options) !== JSON.stringify({ type: document.getElementById('ol-integrity-type').value, user: document.getElementById('ol-integrity-user').value, scope: document.getElementById('ol-integrity-scope').value })) return;
            this._olIntegrityPlan = plan;
            document.getElementById('ol-integrity-estimate').textContent = '待检查 ' + plan.total + ' 个文件，预计最多读取正文 ' + this.openlistIntegritySize(plan.bytes) + '。' + (plan.unknown ? '其中 ' + plan.unknown + ' 个文件缺少上传指纹，只报告无法比对，不读取正文。' : '') + ' 云端提供 SHA-256 时可减少下载量。';
            document.getElementById('ol-integrity-start').disabled = !plan.total;
        } catch (e) { window.showError?.('统计失败：' + e.message); }
    }

    openlistIntegritySize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB', 'TB']; let value = Number(bytes) || 0, unit = 0;
        while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
        return value.toFixed(unit ? 1 : 0) + ' ' + units[unit];
    }

    async startOpenlistIntegrity() {
        const plan = this._olIntegrityPlan;
        if (!plan) return;
        document.getElementById('ol-integrity-start').disabled = true;
        try {
            await this.request('/api/openlist/integrity/start', { method: 'POST', body: JSON.stringify({ token: plan.token }) });
            this._olIntegrityPlan = null;
            await this.loadOpenlistIntegrity();
        } catch (e) { this.invalidateOpenlistIntegrity(); window.showError?.('启动失败：' + e.message); }
    }

    async cancelOpenlistIntegrity() {
        try { await this.request('/api/openlist/integrity/cancel', { method: 'POST' }); await this.loadOpenlistIntegrity(); }
        catch (e) { window.showError?.('停止失败：' + e.message); }
    }

    changeOpenlistIntegrityPage(page) {
        this._olIntegrityPage = Math.max(1, page);
        this.loadOpenlistIntegrity();
    }

    async loadOpenlistIntegrity() {
        if (this._olIntegrityLoading) return;
        this._olIntegrityLoading = true;
        const esc = value => this.escapeHtml(String(value == null ? '' : value));
        try {
            const state = await this.request('/api/openlist/integrity');
            const userSelect = document.getElementById('ol-integrity-user');
            if (userSelect.options.length <= 1) {
                const backups = await this.request('/api/openlist/backups');
                for (const user of [...new Set((backups.list || []).map(f => f.user))].sort()) {
                    const option = document.createElement('option'); option.value = user; option.textContent = user === '_system' ? '系统公共数据' : user; userSelect.appendChild(option);
                }
            }
            const job = state.job, active = job?.state === 'running';
            const jobLabels = { running: '正在校验', completed: '校验结束', cancelled: '已停止', interrupted: '进程中断，可重新统计并继续', failed: '任务失败' };
            document.getElementById('ol-integrity-cancel').disabled = !active;
            document.getElementById('ol-integrity-start').disabled = active || !this._olIntegrityPlan?.total;
            document.getElementById('ol-integrity-progress').innerHTML = job ? '<p>' + esc(jobLabels[job.state] || job.state) + ' · ' + job.done + ' / ' + job.total + ' 个文件，实际读取 ' + esc(this.openlistIntegritySize(job.bytes)) + (job.current ? ' · ' + esc(job.current) : '') + '</p><progress style="width:100%" max="' + Math.max(1, job.total) + '" value="' + job.done + '"></progress>' : '';
            const labels = { stale: '需重新校验', matched: '曾校验通过', mismatch: '内容不一致', missing: '云端缺失', error: '读取失败', unavailable: '缺少上传指纹' };
            const resultBadgeCls = {
                matched: 'ol-integrity-badge-matched',
                mismatch: 'ol-integrity-badge-mismatch',
                missing: 'ol-integrity-badge-missing',
                error: 'ol-integrity-badge-error',
                unavailable: 'ol-integrity-badge-unavailable'
            };
            const filter = document.getElementById('ol-integrity-result-filter').value;
            const query = document.getElementById('ol-integrity-search').value.trim().toLowerCase();
            const rows = (state.results || []).filter(row => (!filter || row.result === filter) && (!document.getElementById('ol-integrity-user').value || row.user === document.getElementById('ol-integrity-user').value) && (!document.getElementById('ol-integrity-type').value || row.type === document.getElementById('ol-integrity-type').value) && (!query || (row.name + ' ' + row.remote).toLowerCase().includes(query)));
            const pages = Math.max(1, Math.ceil(rows.length / 50));
            const page = this._olIntegrityPage = Math.min(pages, this._olIntegrityPage || 1);
            const counts = rows.reduce((counts, row) => { counts[row.result] = (counts[row.result] || 0) + 1; return counts; }, {});
            const countPills = Object.entries(counts).map(([key, n]) => {
                const cls = resultBadgeCls[key] || '';
                return `<span class="ol-integrity-stat-pill ${cls}"><b>${esc(labels[key] || key)}</b> ${n}</span>`;
            }).join('');
            document.getElementById('ol-integrity-results').innerHTML = rows.length ? '<div class="ol-integrity-summary-line">' + countPills + '<span class="config-hint" style="margin:0 0 0 auto;">当前备份版本的全部最近校验结果（包含历史任务，不受上方校验范围限制）</span></div><table class="backup-policy-table olb-records-table"><thead><tr><th style="min-width:320px;">文件名 / 云端路径</th><th style="width:120px;text-align:center;">校验结果</th><th style="width:170px;">最近校验时间</th><th>说明</th></tr></thead><tbody>' + rows.slice((page - 1) * 50, page * 50).map(row => '<tr><td style="overflow-wrap:anywhere"><div class="ol-integrity-filename">' + esc(row.name) + '</div><div class="config-hint" style="font-size:0.75rem;font-family:monospace;opacity:0.8;">' + esc(row.remote) + '</div></td><td style="text-align:center;"><span class="ol-integrity-badge ' + (resultBadgeCls[row.result] || '') + '">' + esc(labels[row.result] || row.result) + '</span></td><td style="white-space:nowrap;font-size:0.78rem;color:var(--text-secondary);font-family:monospace;">' + esc(new Date(row.checkedAt).toLocaleString()) + '</td><td style="font-size:0.8rem;color:var(--text-secondary);">' + esc(row.result === 'stale' ? '云端状态在上次校验后发生变化，请重新校验' : (row.error || (row.result === 'matched' ? '匹配该次备份的 SHA-256' : '暂无详细说明'))) + '</td></tr>').join('') + '</tbody></table><div class="backup-policy-actions olb-pager" style="margin-top:0.75rem;"><button type="button" class="btn-secondary olb-pager-btn" ' + (page <= 1 ? 'disabled' : '') + ' onclick="app.changeOpenlistIntegrityPage(' + (page - 1) + ')">上一页</button><span class="olb-pager-info">' + page + ' / ' + pages + ' 页，共 ' + rows.length + ' 条</span><button type="button" class="btn-secondary olb-pager-btn" ' + (page >= pages ? 'disabled' : '') + ' onclick="app.changeOpenlistIntegrityPage(' + (page + 1) + ')">下一页</button></div>' : '<div class="olb-empty-state"><div class="olb-empty-title">暂无符合条件的校验结果</div><div class="olb-empty-desc">历史版本生成与普通后台检查不会自动触发完整校验</div></div>';
            if (active && !this._olIntegrityTimer) this._olIntegrityTimer = setInterval(() => {
                if (this.currentView !== 'backups' || !document.getElementById('openlist-pane-integrity')?.classList.contains('active')) { clearInterval(this._olIntegrityTimer); this._olIntegrityTimer = null; return; }
                this.loadOpenlistIntegrity();
            }, 2000);
            if (!active) { clearInterval(this._olIntegrityTimer); this._olIntegrityTimer = null; }
            this.initCustomSelects();
        } catch (e) { document.getElementById('ol-integrity-progress').textContent = '加载失败：' + e.message; }
        finally { this._olIntegrityLoading = false; }
    }

    switchOpenlistTab(name) {
        // 兼容旧入口：转向新「备份管理」对应页签与筛选
        if (name === 'config') {
            this.openBackupCenter('cloud', 'openlist')
            return
        }
        if (name === 'restore') {
            this.openBackupCenter('restore', 'openlist')
            return
        }
        if (name === 'integrity') {
            this.openBackupCenter('records', 'openlist-integrity')
            return
        }
        this.openBackupCenter('records', 'openlist-records:' + (name || ''))
    }

    scheduleOpenlistReload() {
        if (this._olbReloadTimer) clearTimeout(this._olbReloadTimer)
        this._olbReloadTimer = setTimeout(() => { this._olbPage = 1; this.loadOpenlistBackups(true, true) }, 300)
    }

    clearOpenlistFilters() {
        if (this._olbReloadTimer) clearTimeout(this._olbReloadTimer)
        ['olb-filter-user', 'olb-filter-folder', 'olb-filter-status', 'olb-filter-type', 'olb-filter-name', 'olb-filter-path', 'olb-filter-local', 'olb-filter-local-state', 'olb-filter-remote-state', 'olb-filter-integrity', 'olb-filter-from', 'olb-filter-to', 'bm-rec-type'].forEach((id) => {
            const el = document.getElementById(id); if (el) el.value = ''
        })
        const sort = document.getElementById('olb-filter-sort'); if (sort) sort.value = 'time-desc'
        this.syncCustomSelects()
        this.selectRecordsType('')
    }

    applyOpenlistFilter() {
        if (this._olbReloadTimer) clearTimeout(this._olbReloadTimer)
        this.syncCustomSelects()
        this._olbPage = 1
        this.loadOpenlistBackups(true, true)
    }

    filterOpenlistByStatus(status) {
        const el = document.getElementById('olb-filter-status')
        if (!el) return
        // 再次点击当前已选状态则取消筛选
        el.value = (el.value === status) ? '' : status
        this.syncCustomSelects()
        if (this._olbReloadTimer) clearTimeout(this._olbReloadTimer)
        this.syncCustomSelects()
        this._olbPage = 1
        this.loadOpenlistBackups(true, true)
    }

    // 判断 OpenList 同步记录属于「我的歌单」还是「我不喜欢」（仅歌单快照页有意义）
    olbSnapshotType(f) {
        const name = String(f.name || '') + '/' + String(f.local_path || '') + '/' + String(f.remote_path || '');
        const normalized = name.replace(/\\/g, '/');
        if (/(^|\/)dislike\/snapshot(\/|Info\.json|$)/i.test(normalized)) return 'dislike';
        if (f.folder_type === 'list' || f.backup_type === 'snapshots' || /(^|\/)list\/snapshot(\/|Info\.json|$)/i.test(normalized)) return 'list';
        return '';
    }

    gotoOpenlistPage(n) {
        const tp = this._olbTotalPages || 1
        n = Math.max(1, Math.min(tp, parseInt(n) || 1))
        this._olbPage = n
        this.loadOpenlistBackups(true, true)
    }

    setOpenlistPageSize(v) {
        this._olbPageSize = parseInt(v) || 50
        this._olbPage = 1
        this.loadOpenlistBackups(true, true)
    }


    async request(url, options = {}) {
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
                'X-Frontend-Auth': this.password
            }
        };

        const response = await fetch(API_BASE + url, { ...defaultOptions, ...options });

        if (response.status === 401) {
            this.logout();
            throw new Error('Unauthorized');
        }

        if (!response.ok) {
            const text = await response.text();
            let errMsg = text || 'Request failed';
            try {
                const json = JSON.parse(text);
                if (json && (json.error || json.message)) {
                    errMsg = json.error || json.message;
                }
            } catch { }
            throw new Error(errMsg);
        }

        return response.json();
    }

    formatUptime(seconds) {
        if (!seconds) return '0h';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 24) {
            const days = Math.floor(hours / 24);
            return `${days}d ${hours % 24}h`;
        }
        return `${hours}h ${minutes}m`;
    }

    formatMemory(bytes) {
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    // ========== WebDAV 功能 ==========

    async testWebDAV() {
        const button = document.getElementById('test-webdav-btn');
        if (button?.disabled) return;
        let report = document.getElementById('webdav-test-result');
        if (!report && button) {
            report = document.createElement('div');
            report.id = 'webdav-test-result';
            report.setAttribute('role', 'status');
            report.setAttribute('aria-live', 'polite');
            report.style.cssText = 'grid-column:1/-1;flex-basis:100%;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.7;margin-top:12px;';
            button.parentElement.appendChild(report);
        }
        if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
        if (report) report.textContent = '正在检查已保存的同步目录和备份目录，请稍候…';
        try {
            const result = await this.request('/api/webdav/test', { method: 'POST' });
            const details = (result.checks || []).map(check =>
                `${check.name} ${check.path}：${check.success ? '通过' : '未通过'}，${check.message}`
            );
            if (report) report.textContent = [result.message, ...details].join('\n');
            if (result.success) {
                showSuccess('WebDAV 目录读取检查通过，详情见测试按钮下方');
            } else {
                showError('WebDAV 检查有未通过项，详情见测试按钮下方');
            }
        } catch (err) {
            if (report) report.textContent = '无法完成 WebDAV 检查：' + err.message;
            showError('无法完成 WebDAV 检查，详情见测试按钮下方');
        } finally {
            if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
        }
    }

    // 代理地址输入框只在真正需要填地址时出现：
    // - 统一代理开关关闭 -> 隐藏统一代理地址
    // - 细分选「沿用统一代理」或「直连」 -> 隐藏该类的地址
    updateProxyFieldsVisibility() {
        const form = document.getElementById('config-form');
        if (!form) return;
        const allField = document.getElementById('proxy-all-address-field');
        if (allField) {
            allField.style.display = form.elements['proxy.all.enabled']?.checked ? '' : 'none';
        }
        ['music', 'customSource', 'app'].forEach(cat => {
            const field = document.getElementById(`proxy-${cat}-address-field`);
            if (!field) return;
            field.style.display = form.elements[`proxy.${cat}.mode`]?.value === 'on' ? '' : 'none';
        });
    }

    async testProxy(addressOverride) {
        const address = addressOverride !== undefined
            ? addressOverride
            : (document.querySelector('input[name="proxy.all.address"]')?.value || '');
        if (!address) {
            showInfo('请输入代理地址');
            return;
        }

        showInfo('正在测试代理，请稍候...');
        try {
            const result = await this.request('/api/config/test-proxy', {
                method: 'POST',
                body: JSON.stringify({ address })
            });

            if (result.success) {
                showSuccess('✅ ' + result.message);
            } else {
                showError('❌ ' + result.message);
            }
        } catch (err) {
            showError('❌ 测试失败: ' + err.message);
        }
    }

    async backupToWebDAV() {
        if (!(await showSelect('WebDAV 备份', '确定要创建全量备份并上传到 WebDAV 吗？\n\n系统将自动扫描本地数据、压缩打包为 ZIP 并流式传输至云端。'))) return;

        const statusEl = document.getElementById('sync-status-content');
        if (statusEl) {
            statusEl.innerHTML = '<div style="display:flex;align-items:center;gap:0.6rem;color:var(--accent-primary);"><span class="task-spinner" style="width:18px;height:18px;"></span><span>正在扫描本地文件并打包上传...</span></div>';
        }
        this.showProgress(true, '全量 ZIP 备份与云端归档', '正在扫描并打包服务器数据...');

        try {
            const result = await this.request('/api/webdav/backup', {
                method: 'POST',
                body: JSON.stringify({ force: true })
            });
            if (result.success) {
                if (statusEl) {
                    statusEl.innerHTML = '<p style="color: var(--accent-success); font-weight: 600;">✅ 全量备份已成功上传至 WebDAV 云端！</p>';
                }
                this.loadSyncLogs();
            } else {
                if (statusEl) {
                    statusEl.innerHTML = '<p style="color: var(--accent-error);">❌ 备份失败: 服务器返回异常</p>';
                }
            }
        } catch (err) {
            if (statusEl) {
                statusEl.innerHTML = '<p style="color: var(--accent-error);">❌ 备份失败: ' + this.escapeHtml(err.message) + '</p>';
            }
        }
    }

    async restoreFromWebDAV() {
        const modal = document.getElementById('restore-choice-modal');
        if (modal) {
            modal.classList.remove('hidden');
            this.switchRestoreTab('zip');
        } else {
            // 降级兼容
            this.executeZipRestore();
        }
    }

    closeRestoreModal() {
        document.getElementById('restore-choice-modal')?.classList.add('hidden');
    }

    switchRestoreTab(tab) {
        const zipBtn = document.getElementById('tab-btn-zip');
        const filesBtn = document.getElementById('tab-btn-files');
        const zipPanel = document.getElementById('restore-panel-zip');
        const filesPanel = document.getElementById('restore-panel-files');

        if (tab === 'zip') {
            zipBtn?.classList.add('active');
            filesBtn?.classList.remove('active');
            zipPanel?.classList.remove('hidden');
            filesPanel?.classList.add('hidden');
            this.loadBackupList();
        } else {
            filesBtn?.classList.add('active');
            zipBtn?.classList.remove('active');
            filesPanel?.classList.remove('hidden');
            zipPanel?.classList.add('hidden');
        }
    }

    async loadBackupList() {
        const container = document.getElementById('backup-list-container');
        if (!container) return;

        container.innerHTML = `
            <div style="text-align:center; padding: 2rem; color: var(--text-muted);">
                <span class="task-spinner" style="width:20px;height:20px;display:inline-block;vertical-align:middle;margin-right:6px;"></span>
                正在获取云端备份列表...
            </div>
        `;

        try {
            const res = await this.request('/api/webdav/backups', { method: 'GET' });
            if (res.success && res.backups && res.backups.length > 0) {
                let html = '<div class="backup-zip-list">';
                res.backups.forEach((item, index) => {
                    const isLatest = index === 0;
                    const sizeStr = item.size ? (item.size / (1024 * 1024)).toFixed(1) + ' MB' : '大小未知';
                    const timeStr = item.timeStr || (item.time ? new Date(item.time).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '未知时间');
                    const escapedFilename = this.escapeHtml(item.filename || item.basename);
                    const escapedBasename = this.escapeHtml(item.basename);

                    html += `
                        <div class="backup-zip-card ${isLatest ? 'latest' : ''}">
                            <div class="backup-zip-info">
                                <div class="backup-zip-name">
                                    <span>📦 ${escapedBasename}</span>
                                    ${isLatest ? '<span class="backup-latest-tag">最新快照</span>' : ''}
                                </div>
                                <div class="backup-zip-meta">
                                    <span>🕒 备份时间: ${this.escapeHtml(timeStr)}</span>
                                    <span>💾 体积: ${sizeStr}</span>
                                </div>
                            </div>
                            <div class="backup-zip-actions">
                                <button type="button" class="btn-primary restore-btn-single" onclick="app.executeZipRestore('${escapedFilename}', '${escapedBasename}')">
                                    恢复此快照
                                </button>
                                <button type="button" class="btn-danger-outline backup-del-btn" title="删除此备份" onclick="app.executeDeleteBackup('${escapedFilename}', '${escapedBasename}')">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 15px; height: 15px;">
                                        <polyline points="3 6 5 6 21 6"></polyline>
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                    </svg>
                                    删除
                                </button>
                            </div>
                        </div>
                    `;
                });
                html += '</div>';
                container.innerHTML = html;
            } else {
                container.innerHTML = `
                    <div style="text-align:center; padding: 2rem; color: var(--text-muted); background: rgba(0,0,0,0.2); border-radius: 12px;">
                        <p style="margin: 0; font-size: 0.9rem;">⚠️ 云端备份目录暂无可恢复的 ZIP 备份文件</p>
                        <p style="margin: 6px 0 0 0; font-size: 0.78rem;">您可以先点击主页的「立即全量备份」进行首次归档。</p>
                    </div>
                `;
            }
        } catch (err) {
            container.innerHTML = `
                <div style="text-align:center; padding: 1.5rem; color: var(--accent-error);">
                    获取云端备份列表失败: ${this.escapeHtml(err.message)}
                </div>
            `;
        }
    }

    async executeDeleteBackup(targetFilename, targetBasename) {
        const displayName = targetBasename || targetFilename;
        if (!(await showSelect('删除云端备份', `确定要从 WebDAV 云端永久删除备份快照「${displayName}」吗？\n\n此操作不可撤销！`, { danger: true }))) return;

        try {
            showInfo(`正在删除备份: ${displayName}...`);
            const res = await this.request('/api/webdav/backup', {
                method: 'DELETE',
                body: JSON.stringify({ filename: targetFilename })
            });

            if (res.success) {
                showSuccess(`已成功删除备份: ${displayName}`);
                // 重新刷新备份列表
                this.loadBackupList();
                this.loadSyncLogs();
            } else {
                showError(`删除失败: ${res.message || '未知错误'}`);
            }
        } catch (err) {
            showError(`删除失败: ${err.message}`);
        }
    }

    async executeZipRestore(targetFilename) {
        await this.executeWebdavRestore({ mode: 'zip', targetFilename });
    }

    async executeScatteredRestore() {
        await this.executeWebdavRestore({ mode: 'files' });
    }

    async executeWebdavRestore(options) {
        if (this._webdavRestoreBusy) return;
        this._webdavRestoreBusy = true;
        const status = document.getElementById('sync-status-content');
        try {
            const preview = await this.request('/api/webdav/restore', {
                method: 'POST', body: JSON.stringify({
                    ...options, preview: true,
                    strategy: document.getElementById('webdav-restore-strategy')?.value || 'missing',
                    keepCopies: document.getElementById('webdav-restore-copies')?.checked !== false,
                })
            });
            if (!preview.success) throw new Error(preview.message || '预览失败');
            const actions = { add: '新增', overwrite: '覆盖', skip: '跳过', merge: '合并索引' };
            const examples = preview.files.slice(0, 20).map(file => `${actions[file.action]}：${file.path}`).join('\n');
            const summary = `新增 ${preview.added}，覆盖 ${preview.overwritten}，合并索引 ${preview.merged}，跳过 ${preview.skipped}。\n${(preview.warnings || []).join('\n')}\n\n${examples}${preview.files.length > 20 ? '\n…仅展示前 20 项' : ''}\n\n确认后进入维护状态，完成后需重启服务。`;
            if (!(await showSelect('确认 WebDAV 恢复范围', summary, { danger: preview.overwritten > 0 }))) {
                await this.request('/api/webdav/restore', { method: 'POST', body: JSON.stringify({ cancel: true, token: preview.token }) });
                return;
            }
            const result = await this.request('/api/webdav/restore', { method: 'POST', body: JSON.stringify({ token: preview.token }) });
            if (!result.success) throw new Error(result.message || '恢复失败，请查看恢复记录');
            this.closeRestoreModal();
            if (status) status.textContent = '恢复完成，请重启服务加载数据。恢复记录中可以回退保留的本地副本。';
            showSuccess('恢复完成，请重启服务');
        } catch (error) {
            if (status) status.textContent = error.message + '；若已进入维护状态，请查看恢复记录后重启服务。';
            showError(error.message);
        } finally { this._webdavRestoreBusy = false; }
    }

    async loadWebdavRestoreTasks() {
        const container = document.getElementById('webdav-restore-tasks');
        if (!container) return;
        const esc = value => this.escapeHtml(String(value));
        try {
            const result = await this.request('/api/webdav/restore/tasks');
            const states = {
                completed: '已完成 · 请重启服务',
                downloading: '正在下载',
                committing: '正在写入',
                failed: '恢复失败',
                interrupted: '已中断',
                'recovery-required': '异常中断 · 需回退',
                'rolled-back': '已回退副本',
                cancelled: '已取消',
                ready: '待写入'
            };
            const badgeClasses = {
                completed: 'is-completed',
                downloading: 'is-running',
                committing: 'is-committing',
                failed: 'is-failed',
                interrupted: 'is-interrupted',
                'recovery-required': 'is-danger',
                'rolled-back': 'is-rolled-back',
                cancelled: 'is-cancelled',
                ready: 'is-ready'
            };
            const badgeIcons = {
                completed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>',
                downloading: '<span class="ol-task-spinner-sm"></span>',
                committing: '<span class="ol-task-spinner-sm"></span>',
                failed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></polyline><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
                'recovery-required': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
                'rolled-back': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><polyline points="3 3 3 8 8 8"></polyline></svg>'
            };

            const tasks = result.tasks || [];
            if (!tasks.length) {
                container.innerHTML = '<div class="ol-tasks-empty">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>' +
                    '<span>暂无 WebDAV 恢复记录。</span>' +
                    '</div>';
                return;
            }

            container.innerHTML = tasks.map(task => {
                const bClass = badgeClasses[task.state] || 'is-pending';
                const bIcon = badgeIcons[task.state] || '';
                const total = task.total || 0;
                const downloaded = task.downloaded || 0;
                const applied = task.applied || 0;
                const percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : (task.state === 'completed' ? 100 : 0);

                let actionsHtml = '';
                if (task.canRollback || task.state === 'recovery-required') {
                    actionsHtml += '<button type="button" class="btn-secondary ol-task-btn is-rollback" onclick="app.webdavRestoreTaskAction(\'' + esc(task.id) + '\', \'rollback\')">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><polyline points="3 3 3 8 8 8"></polyline></svg>' +
                        '<span>回退本次恢复</span></button>';
                }
                actionsHtml += '<button type="button" class="btn-secondary ol-task-btn is-delete" onclick="app.webdavRestoreTaskAction(\'' + esc(task.id) + '\', \'delete\')">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>' +
                    '<span>删除记录与副本</span></button>';

                const errorsHtml = (task.errors || []).length ? '<div class="ol-task-errors">' +
                    task.errors.map(e => '<p class="ol-task-error-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>' + esc(e) + '</p>').join('') +
                    '</div>' : '';

                return '<div class="ol-task-card ' + bClass + '" style="margin-top:0.75rem;">' +
                    '<div class="ol-task-header">' +
                    '<div class="ol-task-meta">' +
                    '<div class="ol-task-time">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>' +
                    '<span>' + esc(new Date(task.createdAt).toLocaleString()) + '</span>' +
                    '</div>' +
                    '<span class="ol-task-id-badge">ID: ' + esc(task.id.slice(0, 8)) + '</span>' +
                    '</div>' +
                    '<div class="ol-task-badge ' + bClass + '">' +
                    bIcon +
                    '<span>' + esc(states[task.state] || task.state) + '</span>' +
                    '</div>' +
                    '</div>' +
                    '<div class="ol-task-body">' +
                    '<div class="ol-task-progress-box">' +
                    '<div class="ol-task-progress-head">' +
                    '<span class="ol-task-progress-label">传输进度</span>' +
                    '<span class="ol-task-progress-num"><strong>' + esc(downloaded) + '</strong> / ' + esc(total) + ' 文件 <small>(' + percent + '%)</small></span>' +
                    '</div>' +
                    '<div class="ol-task-progress-track">' +
                    '<div class="ol-task-progress-fill ' + bClass + '" style="width:' + percent + '%;"></div>' +
                    '</div>' +
                    '</div>' +
                    '<div class="ol-task-metrics-grid">' +
                    '<div class="ol-task-metric-pill">' +
                    '<span class="ol-metric-title">已写入文件</span>' +
                    '<strong class="ol-metric-value">' + esc(applied) + ' 个</strong>' +
                    '</div>' +
                    '</div>' +
                    errorsHtml +
                    '</div>' +
                    '<div class="ol-task-actions">' + actionsHtml + '</div>' +
                    '</div>';
            }).join('');
        } catch (error) { container.innerHTML = '<div class="ol-preview-alert is-error"><span>' + this.escapeHtml(error.message) + '</span></div>'; }
    }

    async webdavRestoreTaskAction(id, action) {
        if (!(await showSelect(action === 'rollback' ? '回退恢复' : '删除恢复副本', action === 'rollback' ? '确认回退本次已写入文件？恢复后又被修改的文件会拒绝自动回退。完成后需重启服务。' : '确认删除这条记录及其暂存文件、恢复前副本？删除后无法通过此记录回退。', { danger: true }))) return;
        try {
            await this.request(`/api/webdav/restore/tasks/${id}${action === 'rollback' ? '/rollback' : ''}`, { method: action === 'rollback' ? 'POST' : 'DELETE' });
            await this.loadWebdavRestoreTasks();
        } catch (error) { showError(error.message); }
    }

    async syncFilesToWebDAV() {
        if (!(await showSelect('同步文件', '确定要强制同步所有本地文件到 WebDAV 吗？\n\n系统将自动检测文件变动并进行多线程增量传输。'))) return;

        const statusEl = document.getElementById('sync-status-content');
        if (statusEl) {
            statusEl.innerHTML = '<div style="display:flex;align-items:center;gap:0.6rem;color:var(--accent-primary);"><span class="task-spinner" style="width:18px;height:18px;"></span><span>正在比对本地与云端散文件...</span></div>';
        }
        this.showProgress(true, '批量文件多线程同步', '正在比对本地散文件并同步至云端...');

        try {
            const result = await this.request('/api/webdav/sync', { method: 'POST' });
            if (result.success) {
                if (statusEl) {
                    statusEl.innerHTML = '<p style="color: var(--accent-success); font-weight: 600;">✅ 散文件已全部同步至云端！</p>';
                }
                this.loadSyncLogs();
            } else {
                if (statusEl) {
                    statusEl.innerHTML = '<p style="color: var(--accent-error);">❌ 同步失败</p>';
                }
            }
        } catch (err) {
            if (statusEl) {
                statusEl.innerHTML = '<p style="color: var(--accent-error);">❌ 同步失败: ' + this.escapeHtml(err.message) + '</p>';
            }
        }
    }

    showProgress(show, title = '任务进行中', subtext = '正在与存储系统交互...') {
        const container = document.getElementById('sync-progress-container');
        if (!container) return;
        if (show) {
            container.classList.remove('hidden');
            const titleEl = document.getElementById('progress-title');
            const subtextEl = document.getElementById('progress-subtext');
            if (titleEl) titleEl.textContent = title;
            if (subtextEl) subtextEl.textContent = subtext;
            this.setTaskStep(1);
            this.updateProgress(0, '正在初始化...', '');
        } else {
            container.classList.add('hidden');
        }
    }

    setTaskStep(stepNumber) {
        const steps = ['prepare', 'pack', 'transfer', 'finish'];
        steps.forEach((stepName, idx) => {
            const stepIndex = idx + 1;
            const el = document.getElementById(`step-${stepName}`);
            const line = document.getElementById(`stepline-${stepIndex}`);
            if (el) {
                el.classList.remove('active', 'done');
                if (stepIndex < stepNumber) {
                    el.classList.add('done');
                } else if (stepIndex === stepNumber) {
                    el.classList.add('active');
                }
            }
            if (line) {
                line.classList.remove('active', 'done');
                if (stepIndex < stepNumber) {
                    line.classList.add('done');
                } else if (stepIndex === stepNumber) {
                    line.classList.add('active');
                }
            }
        });
    }

    updateProgress(percent, text, meta = '') {
        const bar = document.getElementById('progress-bar');
        const textEl = document.getElementById('progress-text');
        const badgeEl = document.getElementById('progress-percent-badge');
        const metaEl = document.getElementById('progress-meta');

        const clampedPercent = Math.max(0, Math.min(100, Math.round(percent)));
        if (bar) bar.style.width = `${clampedPercent}%`;
        if (textEl && text) textEl.textContent = text;
        if (badgeEl) badgeEl.textContent = `${clampedPercent}%`;
        if (metaEl && meta !== undefined) metaEl.textContent = meta;
    }

    // 辅助方法：生成歌曲标签 HTML
    renderSongTags(song) {
        let html = '<div class="song-meta-tags">';

        // 来源标签
        if (song.source) {
            html += `<span class="tag tag-source ${song.source}">${this.escapeHtml(song.source)}</span>`;
        }

        // 音质标签
        const qualitys = song.meta ? (song.meta._qualitys || song.meta.qualitys) : null;
        if (qualitys) {
            if (Array.isArray(qualitys)) {
                if (qualitys.some(q => q.type === 'flac24bit')) {
                    html += '<span class="tag tag-quality hr">Hi-Res</span>';
                } else if (qualitys.some(q => q.type === 'flac')) {
                    html += '<span class="tag tag-quality lossless">SQ</span>';
                } else if (qualitys.some(q => q.type === '320k')) {
                    html += '<span class="tag tag-quality high">HQ</span>';
                }
            } else {
                if (qualitys.flac24bit) {
                    html += '<span class="tag tag-quality hr">Hi-Res</span>';
                } else if (qualitys.flac) {
                    html += '<span class="tag tag-quality lossless">SQ</span>';
                } else if (qualitys['320k']) {
                    html += '<span class="tag tag-quality high">HQ</span>';
                }
            }
        }

        // 时长
        if (song.interval) {
            html += `<span class="tag tag-interval">${this.escapeHtml(song.interval)}</span>`;
        }

        html += '</div>';
        return html;
    }

    // 辅助方法：生成歌曲名称列 HTML（包含封面）
    renderSongNameCell(song, defaultCover = '') {
        const picUrl = song.img || song.picUrl || song.cover || song.meta?.picUrl || defaultCover || '';
        const coverHtml = picUrl
            ? `<img src="${this.escapeHtml(picUrl)}" class="song-cover" loading="lazy" referrerpolicy="no-referrer" alt="cover" onerror="this.onerror=null; this.style.display='none'; this.parentElement.insertAdjacentHTML('afterbegin', '<div class=\\'song-cover\\' style=\\'background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center;\\'>🎵</div>');">`
            : `<div class="song-cover" style="background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center;">🎵</div>`;

        const singerHtml = song.singer
            ? `<span class="song-singer-mobile">${this.escapeHtml(song.singer)}</span>`
            : '';

        return `
            <div class="song-col-name">
                ${coverHtml}
                <div class="song-info-wrapper min-w-0">
                    <span class="song-title-text dynamic-marquee truncate" title="${this.escapeHtml(song.name)}">${this.escapeHtml(song.name || '未知歌曲')}</span>
                    ${singerHtml}
                    ${this.renderSongTags(song)}
                </div>
            </div>
        `;
    }

    initSSE() {
        if (this.sseSource) return;

        const auth = this.password || localStorage.getItem('lx_auth');
        if (!auth) return;

        this.sseSource = new EventSource(`/api/webdav/progress?auth=${encodeURIComponent(auth)}`);

        this.sseSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                // 1. 实时日志推送
                if (data.type === 'sync_log' && data.log) {
                    this.appendLiveSyncLog(data.log);
                    return;
                }

                // 2. 备份进度处理
                if (data.type === 'backup') {
                    this.showProgress(true, '全量 ZIP 备份进行中', '正在将数据压缩并上传至云端');
                    if (data.status === 'preparing') {
                        this.setTaskStep(1);
                        this.updateProgress(2, data.message || '正在扫描与准备数据...', '');
                    } else if (data.status === 'packing') {
                        this.setTaskStep(2);
                        const percent = data.percent || (data.current && data.total ? Math.min(48, Math.round(5 + (data.current / data.total) * 43)) : 15);
                        const meta = data.total ? `打包进度: ${data.current || 0}/${data.total} 文件` : '';
                        this.updateProgress(percent, data.message || `正在压缩文件: ${data.file || ''}`, meta);
                    } else if (data.status === 'packed') {
                        this.setTaskStep(3);
                        this.updateProgress(50, data.message || '压缩包创建完成，准备传输...', '');
                    } else if (data.status === 'uploading') {
                        this.setTaskStep(3);
                        // 上传占用 50% ~ 98%
                        const uploadRatio = data.total > 0 ? (data.current / data.total) : 0;
                        const percent = Math.min(98, Math.round(50 + uploadRatio * 48));
                        const meta = `${this.formatFileSize(data.current)} / ${this.formatFileSize(data.total)}`;
                        this.updateProgress(percent, `正在上传云端: ${data.file || 'backup.zip'}`, meta);
                    } else if (data.status === 'success') {
                        this.setTaskStep(4);
                        this.updateProgress(100, '✅ 全量备份并上传完成！', '云端归档成功');
                        setTimeout(() => this.showProgress(false), 3500);
                        this.loadSyncLogs();
                    } else if (data.status === 'error') {
                        this.updateProgress(0, `❌ 备份失败: ${data.error || '未知错误'}`, '');
                        setTimeout(() => this.showProgress(false), 5000);
                    }
                } else if (data.type === 'sync') {
                    this.showProgress(true, '文件多线程同步中', '正在与 WebDAV 云端比对并同步变化');
                    if (data.status === 'start') {
                        this.setTaskStep(1);
                        this.updateProgress(5, `开始同步，共 ${data.total || 0} 个文件...`, '');
                    } else if (data.status === 'processing') {
                        this.setTaskStep(3);
                        const percent = data.total > 0 ? Math.min(99, Math.round((data.current / data.total) * 100)) : 50;
                        const meta = `已完成: ${data.current}/${data.total}`;
                        this.updateProgress(percent, `正在同步文件: ${data.file || ''}`, meta);
                    } else if (data.status === 'finish') {
                        this.setTaskStep(4);
                        const msg = data.message || (data.failCount > 0 ? `同步完成: ${data.successCount}成功，${data.failCount}失败/跳过` : '✅ 全部文件同步完成！');
                        const meta = `共处理 ${data.total || 0} 个文件`;
                        this.updateProgress(100, msg, meta);
                        setTimeout(() => this.showProgress(false), 3500);
                        this.loadSyncLogs();
                    } else if (data.status === 'error') {
                        this.updateProgress(0, `❌ 同步失败: ${data.message || '未知错误'}`, '');
                        setTimeout(() => this.showProgress(false), 6000);
                    }
                } else if (data.type === 'restore') {
                    this.showProgress(true, '从云端恢复数据中', '正在拉取云端快照并还原本地');
                    if (data.status === 'start') {
                        this.setTaskStep(1);
                        this.updateProgress(5, data.message || '正在检索云端数据列表...', '');
                    } else if (data.status === 'downloading') {
                        this.setTaskStep(3);
                        this.updateProgress(35, data.message || '正在从云端下载备份包...', '');
                    } else if (data.status === 'extracting') {
                        this.setTaskStep(2);
                        this.updateProgress(75, data.message || '正在解压并恢复数据文件...', '');
                    } else if (data.status === 'processing') {
                        this.setTaskStep(3);
                        const percent = data.total > 0 ? Math.min(95, Math.round((data.current / data.total) * 100)) : 50;
                        this.updateProgress(percent, `正在还原: ${data.file || ''}`, `进度: ${data.current}/${data.total}`);
                    } else if (data.status === 'finish') {
                        this.setTaskStep(4);
                        this.updateProgress(100, '✅ 数据恢复完成！', '页面即将刷新生效');
                        setTimeout(() => this.showProgress(false), 3500);
                        this.loadSyncLogs();
                    } else if (data.status === 'error') {
                        this.updateProgress(0, `❌ 恢复失败: ${data.message || '未知错误'}`, '');
                        setTimeout(() => this.showProgress(false), 6000);
                    }
                }
            } catch (e) {
                console.error('SSE Parse Error:', e);
            }
        };

        this.sseSource.onerror = (err) => {
            // 连接失败不报错，静默重试
        };
    }

    appendLiveSyncLog(log) {
        const container = document.getElementById('sync-logs-content');
        if (!container) return;

        // 清理“暂无日志”提示
        const emptyTip = container.querySelector('.sync-empty-tip');
        if (emptyTip) emptyTip.remove();

        const logItem = document.createElement('div');
        logItem.className = 'sync-log-item new-log-flash';
        logItem.innerHTML = `
            <div class="log-info">
                <span class="log-type log-type-${log.type}">${this.getLogTypeText(log.type)}</span>
                <span class="log-file">${this.escapeHtml(log.file)}</span>
                ${log.message ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">${this.escapeHtml(log.message)}</div>` : ''}
            </div>
            <div style="display: flex; align-items: center; gap: 1rem;">
                <span class="log-status log-status-${log.status}">${log.status === 'success' ? '成功' : '失败'}</span>
                <span class="log-time">${this.formatTime(log.timestamp)}</span>
            </div>
        `;

        container.insertBefore(logItem, container.firstChild);

        // 限制最大保留 100 条
        while (container.children.length > 100) {
            container.removeChild(container.lastChild);
        }
    }

    async loadSyncLogs() {
        try {
            const data = await this.request('/api/webdav/logs');
            const container = document.getElementById('sync-logs-content');
            if (!container) return;

            if (!data.logs || data.logs.length === 0) {
                container.innerHTML = '<p class="sync-empty-tip" style="color: var(--text-secondary); padding: 2.5rem; text-align: center;">暂无同步日志</p>';
                return;
            }

            container.innerHTML = data.logs.map(log => `
            <div class="sync-log-item">
                <div class="log-info">
                    <span class="log-type log-type-${log.type}">${this.getLogTypeText(log.type)}</span>
                    <span class="log-file">${this.escapeHtml(log.file)}</span>
                    ${log.message ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">${this.escapeHtml(log.message)}</div>` : ''}
                </div>
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <span class="log-status log-status-${log.status}">${log.status === 'success' ? '成功' : '失败'}</span>
                    <span class="log-time">${this.formatTime(log.timestamp)}</span>
                </div>
            </div>
        `).join('');
        } catch (err) {
            console.error('Failed to load sync logs:', err);
        }
    }

    getLogTypeText(type) {
        const types = {
            upload: '上传',
            download: '下载',
            backup: '备份',
            restore: '恢复'
        };
        return types[type] || type;
    }

    formatTime(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        const minute = 60 * 1000;
        const hour = 60 * minute;
        const day = 24 * hour;

        if (diff < minute) return '刚刚';
        if (diff < hour) return Math.floor(diff / minute) + '分钟前';
        if (diff < day) return Math.floor(diff / hour) + '小时前';

        const date = new Date(timestamp);
        return date.toLocaleString('zh-CN', { hour12: false });
    }

    // ========== 文件管理器功能 ==========

    currentPath = '';

    async loadFiles(path = '') {
        this.currentPath = path;

        try {
            const data = await this.request(`/api/files?path=${encodeURIComponent(path)}`);
            this.renderFileList(data.items || []);
            this.updateBreadcrumb(path);
        } catch (err) {
            console.error('Failed to load files:', err);
            document.getElementById('file-items').innerHTML = '<p style="padding: 2rem; text-align: center; color: var(--accent-error);">加载文件失败</p>';
        }
    }

    renderFileList(items) {
        const container = document.getElementById('file-items');

        if (items.length === 0) {
            container.innerHTML = '<p style="padding: 2rem; text-align: center; color: var(--text-secondary);">此文件夹为空</p>';
            return;
        }

        // 排序：文件夹在前
        items.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });

        container.innerHTML = items.map(item => `
        <div class="file-item">
            <div class="file-name" onclick="app.${item.isDirectory ? `loadFiles('${item.path}')` : `viewFile('${item.path}')`}">
                <span class="file-icon">${item.isDirectory ? '📁' : this.getFileIcon(item.name)}</span>
                <span>${item.name}</span>
            </div>
            <div class="file-size">${item.isDirectory ? '-' : this.formatFileSize(item.size)}</div>
            <div class="file-date">${this.formatDate(item.mtime)}</div>
            <div class="file-item-actions">
                ${!item.isDirectory ? `<button onclick="app.editFile('${item.path}')">编辑</button>` : ''}
                <button onclick="app.downloadFile('${item.path}')">下载</button>
                <button onclick="app.deleteFile('${item.path}', ${item.isDirectory})" style="color: var(--accent-error);">删除</button>
            </div>
        </div>
    `).join('');
    }

    getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const icons = {
            json: '📄',
            txt: '📝',
            log: '📋',
            js: '📜',
            css: '🎨',
            html: '🌐',
            md: '📖',
        };
        return icons[ext] || '📄';
    }

    updateBreadcrumb(path) {
        const parts = path ? path.split('/').filter(p => p) : [];
        const breadcrumb = document.getElementById('file-breadcrumb');

        let html = '<a href="#" onclick="app.loadFiles(\'\'); return false;">根目录</a>';

        let currentPath = '';
        parts.forEach((part, index) => {
            currentPath += (index > 0 ? '/' : '') + part;
            html += `<a href="#" onclick="app.loadFiles('${currentPath}'); return false;">${part}</a>`;
        });

        breadcrumb.innerHTML = html;
    }

    async createNewFile() {
        const filename = await showInput('创建文件', '请输入文件名：');
        if (!filename) return;

        const path = this.currentPath ? `${this.currentPath}/${filename}` : filename;

        try {
            await this.request('/api/files', {
                method: 'POST',
                body: JSON.stringify({ path, content: '', isDirectory: false })
            });
            this.loadFiles(this.currentPath);
            showSuccess('文件创建成功');
        } catch (err) {
            showError('创建文件失败: ' + err.message);
        }
    }

    async createNewFolder() {
        const foldername = await showInput('创建文件夹', '请输入文件夹名：');
        if (!foldername) return;

        const path = this.currentPath ? `${this.currentPath}/${foldername}` : foldername;

        try {
            await this.request('/api/files', {
                method: 'POST',
                body: JSON.stringify({ path, isDirectory: true })
            });
            this.loadFiles(this.currentPath);
            showSuccess('文件夹创建成功');
        } catch (err) {
            showError('创建文件夹失败: ' + err.message);
        }
    }

    async editFile(filePath) {
        // 简单的编辑：使用 showInput
        const newContent = await showInput('编辑文件', '编辑文件内容（简易编辑器）：\n\n提示：输入新内容后点击确定', { defaultValue: '' });
        if (newContent === null) return;

        try {
            await this.request('/api/files', {
                method: 'PUT',
                body: JSON.stringify({ path: filePath, content: newContent })
            });
            showSuccess('保存成功！');
        } catch (err) {
            showError('保存失败: ' + err.message);
        }
    }

    viewFile(filePath) {
        showInfo('文件查看功能：' + filePath + '\n\n可以通过下载按钮下载文件后查看');
    }

    async downloadFile(filePath) {
        const url = `/api/files/download?path=${encodeURIComponent(filePath)}`;
        const a = document.createElement('a');
        a.href = url;
        a.download = filePath.split('/').pop();
        a.click();
    }

    async deleteFile(filePath, isDirectory) {
        const type = isDirectory ? '文件夹' : '文件';
        if (!(await showSelect('删除文件', `确定要删除${type} "${filePath}" 吗？\n\n${isDirectory ? '⚠️ 文件夹内的所有内容也会被删除！' : ''}`, { danger: true }))) return;

        try {
            await this.request('/api/files', {
                method: 'DELETE',
                body: JSON.stringify({ path: filePath })
            });
            this.loadFiles(this.currentPath);
            showSuccess('删除成功');
        } catch (err) {
            showError('删除失败: ' + err.message);
        }
    }

    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    formatDate(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleString('zh-CN', { hour12: false });
    }

    formatUptime(seconds) {
        const d = Math.floor(seconds / (3600 * 24));
        const h = Math.floor((seconds % (3600 * 24)) / 3600);
        const m = Math.floor((seconds % 3600) / 60);

        const parts = [];
        if (d > 0) parts.push(`${d}d`);
        if (h > 0) parts.push(`${h}h`);
        if (m > 0) parts.push(`${m}m`);
        if (parts.length === 0) parts.push('0m');

        return parts.join(' ');
    }

    // ========== 初始化事件绑定 ==========

    bindWebDAVEvents() {
        document.getElementById('test-webdav-btn')?.addEventListener('click', () => this.testWebDAV());
        document.getElementById('backup-webdav-btn')?.addEventListener('click', () => this.backupToWebDAV());
        document.getElementById('restore-webdav-btn')?.addEventListener('click', () => this.restoreFromWebDAV());
        document.getElementById('sync-files-btn')?.addEventListener('click', () => this.syncFilesToWebDAV());
        document.getElementById('refresh-sync-logs-btn')?.addEventListener('click', () => this.loadSyncLogs());
        document.getElementById('test-proxy-btn')?.addEventListener('click', () => this.testProxy());
        // 细分代理：各分类地址旁的「测试」按钮，测的是该分类自己的地址
        document.querySelectorAll('.test-proxy-btn-cat')?.forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.getAttribute('data-target');
                const input = document.querySelector(`input[name="${target}"]`);
                this.testProxy(input ? input.value : '');
            });
        });
        // 代理地址框按需显示
        const cfgForm = document.getElementById('config-form');
        cfgForm?.elements['proxy.all.enabled']?.addEventListener('change', () => this.updateProxyFieldsVisibility());
        ['music', 'customSource', 'app'].forEach(cat => {
            cfgForm?.elements[`proxy.${cat}.mode`]?.addEventListener('change', () => this.updateProxyFieldsVisibility());
        });

        // [新增] 本地备份/还原事件绑定
        document.getElementById('backup-local-btn')?.addEventListener('click', () => this.downloadLocalBackup());
        document.getElementById('restore-local-btn')?.addEventListener('click', () => document.getElementById('local-backup-input').click());
        document.getElementById('local-backup-input')?.addEventListener('change', (e) => this.handleLocalRestore(e));

        // [新增] 进度卡片主动关闭/隐藏按钮
        document.getElementById('btn-close-progress')?.addEventListener('click', () => this.showProgress(false));

        this.initSSE();
    }

    bindFileManagerEvents() {
        document.getElementById('new-file-btn')?.addEventListener('click', () => this.createNewFile());
        document.getElementById('new-folder-btn')?.addEventListener('click', () => this.createNewFolder());
        document.getElementById('refresh-files-btn')?.addEventListener('click', () => this.loadFiles(this.currentPath));
    }

    switchBackupTab(tab) {
        this.currentBackupTab = tab;
        const configBtn = document.getElementById('tab-btn-config-backup');
        const snapshotBtn = document.getElementById('tab-btn-snapshot-backup');
        const configPane = document.getElementById('backup-pane-config');
        const snapshotPane = document.getElementById('backup-pane-snapshot');

        if (tab === 'snapshot') {
            snapshotBtn?.classList.add('active');
            configBtn?.classList.remove('active');
            snapshotPane?.classList.add('active');
            configPane?.classList.remove('active');
            this.loadSnapshots();
        } else {
            configBtn?.classList.add('active');
            snapshotBtn?.classList.remove('active');
            configPane?.classList.add('active');
            snapshotPane?.classList.remove('active');
            this.loadConfigBackups();
        }
    }

    async loadConfigBackups() {
        const container = document.getElementById('config-backups-list');
        if (!container) return;

        container.classList.add('content-loading');

        try {
            const data = await this.request('/api/config/backups');
            const list = data.list || [];

            // 更新状态卡片与徽标
            const statusDot = document.getElementById('config-backup-status-dot');
            const tabLocalDot = document.getElementById('bm-tab-dot-local');
            const modeBadge = document.getElementById('config-backup-mode-badge');
            const retentionText = document.getElementById('config-backup-retention-text');
            const dirText = document.getElementById('config-backup-dir-text');

            if (data.autoBackupEnabled) {
                statusDot?.classList.add('dot-active');
                tabLocalDot?.classList.add('dot-active');
                if (modeBadge) {
                    modeBadge.innerHTML = `<span class="badge-dot dot-emerald"></span><span>已开启 (每 ${data.intervalHours || 24} 小时)</span>`;
                }
            } else {
                statusDot?.classList.remove('dot-active');
                tabLocalDot?.classList.remove('dot-active');
                if (modeBadge) {
                    modeBadge.innerHTML = '<span class="badge-dot dot-red"></span><span>已停用</span>';
                }
            }

            if (retentionText) {
                retentionText.textContent = `${data.retentionDays || 7} 天`;
            }
            if (dirText) {
                dirText.textContent = data.backupDir || 'backups';
                dirText.title = data.backupDir || 'backups';
            }
            const nextText = document.getElementById('config-backup-next-text');
            if (nextText) {
                if (data.autoBackupEnabled && data.nextBackupAt) {
                    nextText.textContent = new Date(data.nextBackupAt).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
                } else if (data.autoBackupEnabled) {
                    nextText.textContent = '计算中…';
                } else {
                    nextText.textContent = '已停用';
                }
            }
            const lastText = document.getElementById('config-backup-last-text');
            if (lastText) {
                lastText.textContent = data.lastBackupAt ? new Date(data.lastBackupAt).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '暂无';
            }

            if (!list.length) {
                container.innerHTML = '<div style="padding: 2.5rem; text-align: center; color: var(--text-secondary);">暂无系统配置备份文件。可点击上方【立即备份配置】手动创建第一份备份。</div>';
                container.classList.remove('content-loading');
                return;
            }

            container.innerHTML = list.map(item => {
                const isManual = item.type === 'manual';
                const typeTag = isManual
                    ? '<span class="backup-type-tag tag-manual"><span class="badge-dot dot-purple" style="width:6px;height:6px;"></span>手动备份</span>'
                    : '<span class="backup-type-tag tag-auto"><span class="badge-dot dot-blue" style="width:6px;height:6px;"></span>每日自动</span>';

                return `
                <div class="snapshot-row">
                    <div class="col-time">${new Date(item.time).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
                    <div class="col-id" title="${item.name}">
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <span style="font-family:monospace; font-weight:600;">${item.name}</span>
                            ${typeTag}
                        </div>
                    </div>
                    <div class="col-size">${this.formatFileSize(item.size)}</div>
                    <div class="col-actions snapshot-actions">
                        <button class="btn-download" onclick="app.downloadConfigBackup('${item.name}')" title="下载此配置备份文件到电脑">
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                            下载
                        </button>
                        <button class="btn-restore" onclick="app.restoreConfigBackup('${item.name}')" title="恢复此配置并热重载">
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="1 4 1 10 7 10"></polyline>
                                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
                            </svg>
                            恢复
                        </button>
                        <button class="btn-delete" onclick="app.deleteConfigBackup('${item.name}')" title="删除此备份文件">
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                            删除
                        </button>
                    </div>
                </div>
                `;
            }).join('');

            container.classList.remove('content-loading');
            container.classList.add('fade-in');
            setTimeout(() => container.classList.remove('fade-in'), 400);

        } catch (err) {
            console.error(err);
            showError('加载配置备份列表失败: ' + err.message);
            container.classList.remove('content-loading');
        }
    }

    async backupConfigNow() {
        const btn = document.getElementById('btn-backup-config-now');
        if (btn) btn.disabled = true;

        try {
            const res = await this.request('/api/config/backup-now', { method: 'POST' });
            if (res.success) {
                showSuccess(`✅ 备份创建成功：${res.filename}`);
                this.loadConfigBackups();
            } else {
                showError('创建备份失败: ' + (res.error || '未知错误'));
            }
        } catch (err) {
            showError('创建备份请求失败: ' + err.message);
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    downloadConfigBackup(filename) {
        if (!filename) return;
        const url = `/api/config/backups/download?file=${encodeURIComponent(filename)}&auth=${encodeURIComponent(this.password)}`;
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
    }

    async deleteConfigBackup(filename) {
        if (!filename) return;
        if (!(await showSelect('删除配置备份', `确定要删除备份文件 ${filename} 吗？\n\n删除后不可恢复。`, { danger: true }))) return;

        try {
            const res = await this.request(`/api/config/backups/${encodeURIComponent(filename)}`, { method: 'DELETE' });
            if (res.success) {
                showSuccess(`已成功删除备份 ${filename}`);
                this.loadConfigBackups();
            } else {
                showError('删除失败: ' + (res.error || '未知错误'));
            }
        } catch (err) {
            showError('删除请求失败: ' + err.message);
        }
    }

    async restoreConfigBackup(filename) {
        if (!filename) return;
        if (!(await showSelect('恢复配置文件', `警告：确定要从备份 ${filename} 还原系统配置吗？\n\n1. 系统将自动为当前配置额外创建一份安全备份以防失误。\n2. 还原后将立即热重载配置生效。\n\n确定要继续恢复吗？`, { danger: true }))) {
            return;
        }

        try {
            const res = await this.request('/api/config/backups/restore', {
                method: 'POST',
                body: JSON.stringify({ fileName: filename })
            });
            if (res.success) {
                showSuccess(res.message || '✅ 配置已成功恢复并热加载！');
                this.loadConfigBackups();
                this.loadConfig(); // 刷新配置视图中的表单值
            } else {
                showError('恢复失败: ' + (res.error || '未知错误'));
            }
        } catch (err) {
            showError('恢复请求失败: ' + err.message);
        }
    }

    async loadSnapshots() {
        const username = document.getElementById('snapshot-user-select')?.value;
        const container = document.getElementById('snapshots-list');

        if (!username) {
            this.renderUserSelectionGrid('snapshot');
            return;
        }

        // 确保「类型 / 来源」筛选条件存在
        this.ensureSnapshotKindTabs();
        const kind = this._snapshotKind || 'all';
        const origin = this._snapshotOrigin || 'all';

        // 添加加载状态
        container.classList.add('content-loading');

        try {
            // 添加 user 参数
            const all = await this.request(`/api/data/snapshots?user=${encodeURIComponent(username)}`);
            const list = all.filter(i =>
                (kind === 'all' || (i.kind || 'list') === kind) &&
                (origin === 'all' || (i.origin || 'auto') === origin));

            if (!list.length) {
                const emptyText = origin === 'imported' ? '该用户暂无导入的备份快照'
                    : kind === 'dislike' ? '该用户暂无「不喜欢」快照'
                        : kind === 'rating' ? '该用户暂无「我的评分」快照' : '暂无快照';
                container.innerHTML = `<div style="padding: 2rem; text-align: center; color: var(--text-secondary);">${emptyText}</div>`;
                container.classList.remove('content-loading');
                return;
            }

            container.innerHTML = list.map(item => {
                const imported = item.origin === 'imported';
                const originTag = imported
                    ? '<span class="kind-tag" style="color:#a78bfa;font-size:.7rem;border:1px solid #a78bfa;border-radius:4px;padding:0 .3rem;vertical-align:middle;margin-left:.25rem;" title="用户上传导入的备份；列表时间取自该文件原始修改时间">导入备份</span>'
                    : '<span class="kind-tag" style="color:#94a3b8;font-size:.7rem;border:1px solid #94a3b8;border-radius:4px;padding:0 .3rem;vertical-align:middle;margin-left:.25rem;" title="服务端在数据变更时自动生成">系统快照</span>';
                const kindTag = item.kind === 'dislike'
                    ? '<span class="kind-tag" style="color:#ef4444;font-size:.7rem;border:1px solid #ef4444;border-radius:4px;padding:0 .3rem;vertical-align:middle;">我不喜欢</span>'
                    : item.kind === 'rating'
                        ? '<span class="kind-tag" style="color:#f59e0b;font-size:.7rem;border:1px solid #f59e0b;border-radius:4px;padding:0 .3rem;vertical-align:middle;">我的评分</span>'
                        : '<span class="kind-tag" style="color:#3b82f6;font-size:.7rem;border:1px solid #3b82f6;border-radius:4px;padding:0 .3rem;vertical-align:middle;">我的歌单</span>';
                return `
            <div class="snapshot-row">
                <div class="col-time"${imported ? ' title="时间取自备份文件的原始修改时间"' : ''}>${new Date(item.time).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
                <div class="col-id"><span class="col-id-text" title="snapshot_${item.id}">snapshot_${item.id}</span>${kindTag}${originTag}</div>
                <div class="col-size">${this.formatFileSize(item.size)}</div>
                <div class="col-actions snapshot-actions">
                    <button class="btn-download" onclick="app.downloadSnapshot('${item.id}', '${item.kind || 'list'}')">
                        <!-- 下载图标 -->
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        下载备份
                    </button>
                    <button class="btn-restore" onclick="app.restoreSnapshot('${item.id}', '${item.kind || 'list'}')">
                        <!-- 恢复图标 -->
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="1 4 1 10 7 10"></polyline>
                            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
                        </svg>
                        回滚
                    </button>
                    <!-- [新增] 删除按钮 -->
                    <button class="btn-delete" onclick="app.deleteSnapshot('${item.id}', '${item.kind || 'list'}')">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                        删除
                    </button>
                </div>
            </div>
        `; }).join('');

            // 移除加载状态并添加淡入动画
            container.classList.remove('content-loading');
            container.classList.add('fade-in');

            // 动画完成后移除类
            setTimeout(() => {
                container.classList.remove('fade-in');
            }, 400);

        } catch (err) {
            console.error(err);
            showError('加载快照列表失败: ' + err.message);
            container.classList.remove('content-loading');
        }
    }

    // 在「歌单快照」面板顶部注入「类型 / 来源」两个下拉查询条件
    ensureSnapshotKindTabs() {
        const container = document.getElementById('snapshots-list');
        const toolbar = document.getElementById('snapshot-toolbar-actions');
        if (!container || !toolbar) return;
        // loadSnapshots 会被反复调用（切用户 / 上传 / 删除后），避免重复注入多个筛选框
        if (document.getElementById('snapshot-kind-filter')) return;
        const sel = document.createElement('select');
        sel.id = 'snapshot-kind-filter';
        sel.className = 'form-input config-input olb-select';
        sel.setAttribute('aria-label', '快照类型');
        sel.style.width = 'auto';
        const cur = this._snapshotKind || 'all';
        sel.innerHTML = '<option value="all">全部类型</option><option value="list">我的歌单</option><option value="dislike">我不喜欢</option><option value="rating">我的评分</option>';
        sel.value = cur;
        sel.addEventListener('change', () => {
            this._snapshotKind = sel.value;
            this.loadSnapshots();
        });
        toolbar.insertBefore(sel, toolbar.firstChild);
        this.initCustomSelects();
    }

    triggerUploadSnapshot() {
        const username = document.getElementById('snapshot-user-select')?.value;
        if (!username) {
            showInfo('请先选择用户');
            return;
        }
        document.getElementById('snapshot-upload-input').click();
    }

    // 导入时由超管从用户清单显式选择目标用户，选择结果即最终目标
    async showImportTargetDialog({ filename, kindLabel, defaultUser }) {
        let users = this.allUsers;
        if (!Array.isArray(users) || !users.length) {
            try {
                users = await this.request('/api/users');
                this.allUsers = users;
            } catch (err) {
                showError('获取用户清单失败: ' + err.message);
                return null;
            }
        }
        if (!users.length) {
            showError('用户清单为空，无法导入');
            return null;
        }
        const options = users.map(u => {
            const label = u.name === '_open' ? '公开用户 (_open)' : u.name;
            return `<option value="${this.escapeHtml(u.name)}"${u.name === defaultUser ? ' selected' : ''}>${this.escapeHtml(label)}</option>`;
        }).join('');
        return new Promise(resolve => {
            const modal = document.createElement('div');
            modal.id = 'snapshot-import-target-modal';
            modal.className = 'fixed inset-0 z-[3000] flex items-center justify-center p-6 animate-fade-in';
            modal.innerHTML = `
                <div class="absolute inset-0 bg-black/40 backdrop-blur-[4px]"></div>
                <div class="lx-glass rounded-[28px] w-full max-w-md overflow-hidden relative shadow-2xl">
                    <div class="p-8">
                        <h3 class="text-xl font-bold text-white mb-4">选择导入目标用户</h3>
                        <p class="text-sm text-white/60 leading-relaxed mb-5">
                            备份文件：${this.escapeHtml(filename)}<br>
                            备份类型：${kindLabel}
                        </p>
                        <label class="text-sm text-white/70" for="snapshot-import-target-user">导入到用户</label>
                        <select id="snapshot-import-target-user" class="lx-input w-full px-4 py-3 rounded-2xl mt-2">${options}</select>
                    </div>
                    <div class="p-5 flex gap-3">
                        <button id="snapshot-import-target-cancel" class="lx-btn flex-1 py-3.5 text-sm font-bold text-white/50 hover:text-white bg-white/5 hover:bg-white/10 rounded-2xl">取消</button>
                        <button id="snapshot-import-target-ok" class="lx-btn flex-1 py-3.5 text-sm font-bold text-white bg-gradient-to-br from-emerald-400 to-teal-500 rounded-2xl">继续</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            const close = (result) => { modal.remove(); resolve(result); };
            modal.querySelector('#snapshot-import-target-ok').onclick = () => close(modal.querySelector('#snapshot-import-target-user').value);
            modal.querySelector('#snapshot-import-target-cancel').onclick = () => close(null);
            modal.querySelector('.absolute.inset-0').onclick = () => close(null);
        });
    }

    // [新增] 处理快照上传
    async handleSnapshotUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        // 重置 input，允许重复上传同名文件
        event.target.value = '';

        const panelUser = document.getElementById('snapshot-user-select')?.value || '';
        let content;
        try {
            content = await file.text();
        } catch (err) {
            showError('读取备份文件失败: ' + err.message);
            return;
        }
        let jsonData = null;
        try { jsonData = JSON.parse(content); } catch { /* 非 JSON 也可按原生歌单快照导入 */ }
        const isRatingBackup = jsonData && (jsonData.type === 'lxRating_v1' || (
            jsonData.ratings && typeof jsonData.ratings === 'object' && !Array.isArray(jsonData.ratings) &&
            !Array.isArray(jsonData.dislikeList) && !Array.isArray(jsonData.defaultList) && !Array.isArray(jsonData.userList)
        ));
        const kindLabel = isRatingBackup ? '我的评分'
            : jsonData && Array.isArray(jsonData.dislikeList) &&
                !Array.isArray(jsonData.defaultList) && !Array.isArray(jsonData.userList) ? '我不喜欢' : '我的歌单';

        // 目标用户由超管在清单中选择，选择结果即最终目标
        const targetUser = await this.showImportTargetDialog({ filename: file.name, kindLabel, defaultUser: panelUser });
        if (!targetUser) return;

        // 「导入后立即恢复」默认开启：回滚会覆盖目标用户的数据，操作前二次确认
        const restore = document.getElementById('snapshot-upload-restore')?.checked !== false;
        if (restore) {
            const safeTarget = this.escapeHtml(targetUser);
            const confirmed = await showSelect('导入并恢复备份',
                `导入到用户：${safeTarget}\n\n导入后将以该文件覆盖 ${safeTarget} 当前的对应数据。\n系统会自动把导入前的状态保存为一份「系统快照」，之后可随时回滚。是否继续？`,
                { danger: true, confirmText: '导入并恢复' });
            if (!confirmed) return;
        }

        try {
            const time = file.lastModified;
            const response = await fetch(`/api/data/upload-snapshot?user=${encodeURIComponent(targetUser)}&time=${time}&filename=${encodeURIComponent(file.name)}&restore=${restore ? 1 : 0}`, {
                method: 'POST',
                headers: {
                    'X-Frontend-Auth': this.password
                },
                body: content
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(text || 'Upload failed');
            }

            const result = await response.json().catch(() => ({}));
            const resultKindLabel = result.kind === 'rating' ? '我的评分' : result.kind === 'dislike' ? '我不喜欢' : '我的歌单';
            showSuccess(result.restored
                ? `已导入「${resultKindLabel}」备份到用户 ${targetUser} 并恢复成功${result.safetySnapshot ? '（已自动保存导入前快照）' : ''}`
                : `已导入「${resultKindLabel}」备份到用户 ${targetUser}（仅保存为快照，可稍后手动恢复）`);
            // 仅提示 + 提供手动操作入口，不在此处调用联动同步
            if (result.restored) void this.maybeOfferLinkSync(targetUser, resultKindLabel);
            // 目标用户与面板用户不同时切换面板，便于立刻看到导入结果（selectUser 内部会刷新列表）
            if (targetUser !== panelUser) this.selectUser('snapshot', targetUser);
            else this.loadSnapshots();
        } catch (err) {
            console.error(err);
            showError('上传失败: ' + err.message);
        }
    }

    // [新增] 删除快照
    async deleteSnapshot(id, kind) {
        if (!(await showSelect('删除快照', '确定要删除这个快照吗？', { danger: true }))) return;

        const username = document.getElementById('snapshot-user-select')?.value;
        if (!username) return;

        try {
            const response = await fetch(`/api/data/delete-snapshot?user=${encodeURIComponent(username)}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Frontend-Auth': this.password
                },
                body: JSON.stringify({ id, kind })
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(text || 'Delete failed');
            }

            this.loadSnapshots();
            showSuccess('删除成功');
        } catch (err) {
            console.error(err);
            showError('删除失败: ' + err.message);
        }
    }
    async downloadSnapshot(id, kind) {
        const username = document.getElementById('snapshot-user-select')?.value;
        if (!username) {
            showInfo('请先选择用户');
            return;
        }

        try {
            const data = await this.request(`/api/data/snapshot?id=${encodeURIComponent(id)}&kind=${kind || 'list'}&user=${encodeURIComponent(username)}`);

            let backupData, fname;
            if (kind === 'rating') {
                // 评分快照导出为 lxRating_v1（含完整 subsonic-meta 结构），导入时按 type 识别
                backupData = { ...data, type: 'lxRating_v1' };
                fname = `lx_rating_${username}_${id.substring(0, 8)}.json`;
            } else if (kind === 'dislike') {
                // 不喜欢快照直接导出原始规则（{ dislikeList: [...] }），不要套 playList_v2（否则内容会被清空成空壳）
                backupData = data;
                fname = `lx_dislike_${username}_${id.substring(0, 8)}.json`;
            } else {
                // 转换为 LX Music 备份格式
                const defaultList = { id: 'default', name: 'list__name_default' };
                const loveList = { id: 'love', name: 'list__name_love' };

                backupData = {
                    type: 'playList_v2',
                    data: [
                        { ...defaultList, list: data.defaultList || [] },
                        { ...loveList, list: data.loveList || [] },
                        ...(data.userList || []),
                    ],
                };
                fname = `lx_backup_${username}_${id.substring(0, 8)}.json`;
            }

            const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fname;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error(err);
            showError('导出快照失败: ' + err.message);
        }
    }

    // [新增] 本地备份下载
    async downloadLocalBackup() {
        if (!(await showSelect('本地备份', '按「备份管理 → 云端备份」中 WebDAV 已保存的类型打包本地 ZIP。不会上传到云端，也不包含 cache。确定下载吗？'))) return;

        this.showProgress(true, '本地 ZIP 备份下载', '正在打包服务器数据，请稍候...');
        this.setTaskStep(1);
        this.updateProgress(10, '正在准备打包环境...', '');

        try {
            // 直接通过 URL 下载，后端会处理 ZIP 创建并流式传输
            const url = `/api/backup/download?auth=${encodeURIComponent(this.password)}`;
            const a = document.createElement('a');
            a.href = url;
            const dateStr = new Date().toISOString().split('T')[0];
            a.download = `lx-sync-backup-local-${dateStr}.zip`;
            a.click();

            this.setTaskStep(3);
            this.updateProgress(60, '正在生成并下载 ZIP 压缩包...', '');
            setTimeout(() => {
                this.setTaskStep(4);
                this.updateProgress(100, '✅ 本地备份已发送到浏览器下载！', '');
                setTimeout(() => this.showProgress(false), 3000);
            }, 1200);
        } catch (err) {
            this.updateProgress(0, `❌ 下载失败: ${err.message}`, '');
            showError('下载本地备份失败: ' + err.message);
            setTimeout(() => this.showProgress(false), 4000);
        }
    }

    // [新增] 本地备份还原处理
    async handleLocalRestore(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (!(await showSelect('还原数据', '按「备份管理 → 云端备份」中 WebDAV 已保存的类型恢复 ZIP：覆盖同名本地文件，保留其他文件，不恢复 cache。恢复后需重启服务。请先保存当前数据的副本。', { danger: true }))) {
            event.target.value = '';
            return;
        }

        const formData = new FormData();
        formData.append('backup', file);

        // 创建临时加载提示
        const loadingOverlay = document.createElement('div');
        loadingOverlay.className = 'overlay';
        loadingOverlay.style.background = 'rgba(0,0,0,0.8)';
        loadingOverlay.innerHTML = `
            <div class="login-box glass" style="padding: 3rem;">
                <div class="status-dot" style="margin: 0 auto 1.5rem; width: 12px; height: 12px;"></div>
                <h2>正在还原数据...</h2>
                <p style="color: var(--text-secondary); margin-top: 1rem;">正在解压并恢复文件，请勿关闭或刷新页面。</p>
            </div>
        `;
        document.body.appendChild(loadingOverlay);

        try {
            const response = await fetch('/api/backup/upload', {
                method: 'POST',
                headers: {
                    'X-Frontend-Auth': this.password
                },
                body: formData
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(text || 'Restore failed');
            }

            const result = await response.json();
            showSuccess(result.message || '还原成功，请重启服务完整加载数据。');
            loadingOverlay.remove();
        } catch (err) {
            console.error(err);
            showError('本地还原失败: ' + err.message);
            loadingOverlay.remove();
        } finally {
            event.target.value = '';
        }
    }

    async restoreSnapshot(id, kind) {
        const username = document.getElementById('snapshot-user-select')?.value;
        if (!username) {
            showInfo('请先选择用户');
            return;
        }

        if (!(await showSelect('回滚快照', (kind === 'rating' ? '评分恢复范围：分数、来源与备份中的歌曲描述。保留当前收藏及本地文件关联；关联参照不会恢复旧关联。\n\n' : '') + '警告：此操作将把服务器数据回滚到选定的快照状态！\n\n1. 当前所有未保存的更改将丢失。\n2. 所有客户端的同步状态将被重置。\n3. 客户端连接后，请务必选择【远程覆盖本地】以获取回滚后的数据。\n\n确定要继续吗？', { danger: true }))) {
            return;
        }

        try {
            // 通用回滚入口：list / dislike 共用，按 kind 分流到后端对应快照恢复
            await this.request(`/api/data/restore-snapshot?user=${encodeURIComponent(username)}`, {
                method: 'POST',
                body: JSON.stringify({ id, kind })
            });
            showSuccess('回滚成功！请重启客户端或重新连接同步服务。');
            // 仅提示 + 提供手动操作入口，不在此处调用联动同步
            void this.maybeOfferLinkSync(username, kind === 'rating' ? '我的评分' : kind === 'dislike' ? '我不喜欢' : '我的歌单');
            this.loadDashboard(); // 刷新数据概览
        } catch (err) {
            showError('回滚失败: ' + err.message);
        }
    }
    async restartServer() {
        if (!(await showSelect('重启服务器', '确定要重启服务器吗？\n\n重启后所有连接的客户端将断开，大约需要几秒钟时间。', { danger: true }))) {
            return;
        }

        try {
            const result = await this.request('/api/restart', { method: 'POST' })
            if (result.success) {
                showSuccess('服务器正在重启，请稍候...\n\n页面将在 5 秒后自动刷新。');
                // 5秒后刷新页面
                setTimeout(() => {
                    window.location.reload()
                }, 5000)
            } else {
                showError('重启失败: ' + (result.message || '未知错误'))
            }
        } catch (err) {
            showError('重启请求失败: ' + err.message)
        }
    }

    checkWebDAVConfig(isConfigured) {
        const cloudGroup = document.getElementById('webdav-cloud-group');
        const guideCard = document.getElementById('webdav-config-guide');
        const statusSection = document.getElementById('webdav-status-section');
        const logsSection = document.getElementById('webdav-logs-section');

        if (isConfigured) {
            cloudGroup?.classList.remove('hidden');
            guideCard?.classList.add('hidden');
            statusSection?.classList.remove('hidden');
            logsSection?.classList.remove('hidden');
        } else {
            cloudGroup?.classList.add('hidden');
            guideCard?.classList.remove('hidden');
            statusSection?.classList.add('hidden');
            logsSection?.classList.add('hidden');
        }
    }

    jumpToWebDAVConfig() {
        this.openBackupCenter('cloud', 'webdav');
    }

    // =============== 备份管理（统一备份中心） ===============
    async openBackupCenter(tab = 'overview', sub = '') {
        if (this.currentView !== 'backups') {
            this._bmPendingTab = tab;
            this._bmPendingSub = sub;
            await this.switchView('backups');
            return;
        }
        await this.enterBackupCenter(tab, sub);
    }

    async enterBackupCenter(tab = 'overview', sub = '') {
        this.bindBackupDirtyTrackers();
        await this.loadBackupSettings(false);
        this.switchBackupCenterTab(tab || 'overview', sub);
    }

    switchBackupCenterTab(tab = 'overview', sub = '') {
        // Retain old playback-cache shortcuts while selecting the cloud tab.
        if (tab === 'playcache') { tab = 'cloud'; sub = 'playcache'; }
        const tabs = ['overview', 'local', 'cloud', 'restore', 'records'];
        const activeTab = tabs.includes(tab) ? tab : 'overview';
        this.currentBackupCenterTab = activeTab;
        tabs.forEach(id => {
            document.getElementById(`bm-tab-btn-${id}`)?.classList.toggle('active', id === activeTab);
            document.getElementById(`bm-pane-${id}`)?.classList.toggle('active', id === activeTab);
        });

        if (activeTab === 'overview') {
            this.loadBackupOverview();
        } else if (activeTab === 'local') {
            this.switchBackupTab(sub === 'snapshot' ? 'snapshot' : (this.currentBackupTab || 'config'));
        } else if (activeTab === 'cloud') {
            if (sub === 'webdav') this.scrollBackupCenter('webdav-form');
            else if (sub === 'openlist') this.scrollBackupCenter('openlist-form');
            else if (sub === 'policy') this.scrollBackupCenter('backup-policy-form');
            else if (sub === 'playcache') this.scrollBackupCenter('openlist-cache-form');
        } else if (activeTab === 'restore') {
            const source = ['local', 'webdav', 'openlist'].includes(sub) ? sub : (this._bmRestoreSource || 'local');
            this.selectRestoreSource(source);
        } else if (activeTab === 'records') {
            let recSource = this._bmRecSource || 'openlist-records';
            let recType = '';
            if (sub) {
                if (sub.startsWith('openlist-records:')) {
                    recSource = 'openlist-records';
                    recType = sub.split(':')[1] || '';
                } else if (['openlist-records', 'openlist-integrity', 'webdav', 'local'].includes(sub)) {
                    recSource = sub;
                }
            }
            const srcSel = document.getElementById('bm-rec-source');
            if (srcSel) srcSel.value = recSource;
            if (recType) {
                const typeSel = document.getElementById('bm-rec-type');
                if (typeSel) typeSel.value = recType;
            }
            this.syncCustomSelects();
            this.selectRecordsSource(recSource);
        }
        setTimeout(() => this.initCustomSelects(), 30);
    }

    scrollBackupCenter(elementId) {
        setTimeout(() => {
            const target = document.getElementById(elementId);
            if (!target) return;
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            target.style.outline = '2px solid var(--accent-primary)';
            target.style.outlineOffset = '4px';
            setTimeout(() => { target.style.outline = 'none'; }, 1800);
        }, 80);
    }

    selectRestoreSource(source = 'local') {
        const valid = ['local', 'webdav', 'openlist'].includes(source) ? source : 'local';
        this._bmRestoreSource = valid;
        document.querySelectorAll('.bm-source-card').forEach(card => {
            const isSel = card.dataset.source === valid;
            card.classList.toggle('is-selected', isSel);
            const radio = card.querySelector('input[type="radio"]');
            if (radio) radio.checked = isSel;
        });
        ['local', 'webdav', 'openlist'].forEach(key => {
            document.getElementById(`bm-restore-panel-${key}`)?.classList.toggle('active', key === valid);
        });
        if (valid === 'webdav') {
            this.loadWebdavRestoreTasks();
        } else if (valid === 'openlist') {
            this.loadOpenlistRecoveryHistory();
        }
    }

    selectRecordsSource(source = 'openlist-records') {
        const valid = ['openlist-records', 'openlist-integrity', 'webdav', 'local'].includes(source) ? source : 'openlist-records';
        this._bmRecSource = valid;
        const map = {
            'openlist-records': 'bm-rec-openlist-records',
            'openlist-integrity': 'openlist-pane-integrity',
            webdav: 'bm-rec-webdav',
            local: 'bm-rec-local',
        };
        Object.entries(map).forEach(([key, id]) => {
            document.getElementById(id)?.classList.toggle('active', key === valid);
        });
        const hintEl = document.getElementById('bm-rec-hint');
        const hints = {
            'openlist-records': '主状态表示任务进度；内容校验是独立的历史结果。本地变化等待后台备份，云端变化后需重新校验；详细观察信息见详情和高级筛选。',
            'openlist-integrity': '完整内容校验会比对云端 SHA-256 或流式读取文件正文（可能消耗下载流量），与普通后台大小检查相互独立。',
            webdav: 'WebDAV 仅支持查看同步状态与日志，不提供单文件重试或 SHA-256 内容校验；上传后仅核对大小。',
            local: '本地配置备份与歌单快照记录在“本地备份”页签查看与管理。',
        };
        if (hintEl) hintEl.textContent = hints[valid] || '';

        if (valid === 'openlist-records') {
            this._olbRawRecords = null; // Re-entering after verification must fetch the latest results.
            this.selectRecordsType(document.getElementById('bm-rec-type')?.value || '');
        } else if (valid === 'openlist-integrity') {
            this.loadOpenlistIntegrity();
        } else if (valid === 'webdav') {
            const isConfigured = !!(this.loadedConfig?.['webdav.enable'] && (this.loadedConfig?.['webdav.url'] || '').trim());
            this.checkWebDAVConfig(isConfigured);
            if (isConfigured) this.loadSyncLogs();
        }
    }

    selectRecordsType(type = '') {
        const selected = document.getElementById('bm-rec-type'); if (selected) selected.value = type;
        document.querySelectorAll?.('[data-record-type]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.recordType === type)));
        const scopeMap = { media: 'cache,music', system: 'system', snapshot: 'list', userFiles: 'userFiles', userData: 'userData' };
        const headerMeta = {
            '': ['全部文件同步记录', '查看 OpenList 所有类型文件的上传状态、大小检查结果与失败重试'],
            media: ['歌曲与播放缓存同步记录', '查看已下载歌曲、播放缓存及歌词封面的上传状态、大小检查与失败重试'],
            system: ['系统与账户同步记录', '查看系统设置与账户配置（_system）的上传状态、大小检查与失败重试'],
            snapshot: ['歌单与不喜欢快照同步记录', '查看各用户的我的歌单与我不喜欢快照上传状态、大小检查与失败重试'],
            userFiles: ['用户音源同步记录', '查看用户音源文件的上传与校验状态'],
            userData: ['用户数据同步记录', '查看用户设置、播放历史等数据的上传与校验状态'],
        };
        this._olbFolderScope = scopeMap[type] || '';
        const meta = headerMeta[type] || headerMeta[''];
        const titleEl = document.getElementById('openlist-records-title');
        const descEl = document.getElementById('openlist-records-desc');
        if (titleEl) titleEl.textContent = meta[0];
        if (descEl) descEl.textContent = meta[1];
        this._olbPage = 1;
        this.loadOpenlistBackups(true, true);
    }

    bindBackupDirtyTrackers() {
        if (this._bmDirtyTrackersBound) return;
        this._bmDirtyTrackersBound = true;
        this._bmDirty = new Set();
        const forms = ['local-backup-form', 'backup-policy-form', 'webdav-form', 'openlist-form', 'openlist-cache-form'];
        forms.forEach(formId => {
            const form = document.getElementById(formId);
            if (!form) return;
            const onEdit = () => {
                if (this._bmSuppressDirty) return;
                this.markBackupDirty(formId, true);
            };
            form.addEventListener('input', onEdit);
            form.addEventListener('change', onEdit);
        });
        document.getElementById('openlist-enable')?.addEventListener('change', () => this.toggleOpenlistVisibility());
    }

    markBackupDirty(formId, dirty) {
        if (!this._bmDirty) this._bmDirty = new Set();
        if (dirty) this._bmDirty.add(formId);
        else this._bmDirty.delete(formId);

        const statusMap = {
            'local-backup-form': 'bm-status-local',
            'backup-policy-form': 'backup-policy-status',
            'webdav-form': 'bm-status-webdav',
            'openlist-form': 'bm-status-openlist',
            'openlist-cache-form': 'bm-status-playcache',
        };
        const statusEl = document.getElementById(statusMap[formId]);
        if (statusEl && dirty) {
            statusEl.classList.remove('is-error');
            statusEl.classList.add('is-dirty');
            statusEl.textContent = '有未保存的更改，点击本卡片的保存按钮后生效。';
        }
        document.getElementById('bm-tab-btn-local')?.classList.toggle('bm-tab-unsaved', this._bmDirty.has('local-backup-form'));
        document.getElementById('bm-tab-btn-cloud')?.classList.toggle('bm-tab-unsaved', this._bmDirty.has('backup-policy-form') || this._bmDirty.has('webdav-form') || this._bmDirty.has('openlist-form') || this._bmDirty.has('openlist-cache-form'));
    }

    clearBackupDirty() {
        if (!this._bmDirty) return;
        ['local-backup-form', 'backup-policy-form', 'webdav-form', 'openlist-form', 'openlist-cache-form'].forEach(id => {
            this.markBackupDirty(id, false);
            const statusMap = {
                'local-backup-form': 'bm-status-local',
                'backup-policy-form': 'backup-policy-status',
                'webdav-form': 'bm-status-webdav',
                'openlist-form': 'bm-status-openlist',
                'openlist-cache-form': 'bm-status-playcache',
            };
            const el = document.getElementById(statusMap[id]);
            if (el) { el.classList.remove('is-dirty', 'is-error'); el.textContent = ''; }
        });
    }

    hasBackupUnsaved() {
        return !!(this._bmDirty && this._bmDirty.size > 0);
    }

    backupUnsavedLabels() {
        const names = {
            'local-backup-form': '本地备份设置',
            'backup-policy-form': '云端备份范围',
            'webdav-form': 'WebDAV 设置',
            'openlist-form': 'OpenList 连接与周期',
            'openlist-cache-form': 'OpenList 播放缓存设置',
        };
        return Array.from(this._bmDirty || []).map(k => names[k] || k);
    }

    async loadBackupSettings(forceDiscard = false) {
        if (forceDiscard) this.clearBackupDirty();
        try {
            const config = await this.request('/api/config');
            this.configLoaded = true;
            this.loadedConfig = config;
            document.getElementById('bm-maintenance-banner')?.classList.toggle('hidden', !config.restoreMaintenance);
            await this.populateBackupForms(config, forceDiscard);
        } catch (e) {
            console.error('Failed to load backup settings:', e);
            if (/维护状态|503/.test(String(e?.message || e))) {
                document.getElementById('bm-maintenance-banner')?.classList.remove('hidden');
            }
        }
    }

    async populateBackupForms(config, forceDiscard = false) {
        if (!config) return;
        this._bmSuppressDirty = true;
        try {
            const dirty = this._bmDirty || new Set();
            // 1. 备份范围矩阵
            if (forceDiscard || !dirty.has('backup-policy-form')) {
                this.renderBackupPolicy(config);
            }
            // 2. 本地备份表单
            const localForm = document.getElementById('local-backup-form');
            if (localForm && (forceDiscard || !dirty.has('local-backup-form'))) {
                if (localForm.elements['maxSnapshotNum']) localForm.elements['maxSnapshotNum'].value = config.maxSnapshotNum ?? 10;
                if (localForm.elements['configBackup.enable']) localForm.elements['configBackup.enable'].checked = config['configBackup.enable'] !== false;
                if (localForm.elements['configBackup.retentionDays']) localForm.elements['configBackup.retentionDays'].value = config['configBackup.retentionDays'] ?? 7;
                if (localForm.elements['configBackup.dir']) localForm.elements['configBackup.dir'].value = config['configBackup.dir'] || '';
                if (localForm.elements['configBackup.intervalHours']) localForm.elements['configBackup.intervalHours'].value = config['configBackup.intervalHours'] ?? 24;
                if (localForm.elements['configBackup.scheduleTime']) localForm.elements['configBackup.scheduleTime'].value = config['configBackup.scheduleTime'] ?? '00:00';
                if (localForm.elements['snapshot.backupPath']) localForm.elements['snapshot.backupPath'].value = config['snapshot.backupPath'] || '';
            }
            const configBackupJsPathRef = document.getElementById('config-backup-js-path-ref');
            if (configBackupJsPathRef && config.configFilePath) {
                configBackupJsPathRef.textContent = config.configFilePath;
            }
            // 3. WebDAV 表单
            const webdavForm = document.getElementById('webdav-form');
            if (webdavForm && (forceDiscard || !dirty.has('webdav-form'))) {
                if (webdavForm.elements['webdav.enable']) webdavForm.elements['webdav.enable'].checked = config['webdav.enable'] === true;
                if (webdavForm.elements['webdav.url']) webdavForm.elements['webdav.url'].value = config['webdav.url'] || '';
                if (webdavForm.elements['webdav.username']) webdavForm.elements['webdav.username'].value = config['webdav.username'] || '';
                if (webdavForm.elements['webdav.password']) webdavForm.elements['webdav.password'].value = config['webdav.password'] || '';
                if (webdavForm.elements['webdav.syncPath']) webdavForm.elements['webdav.syncPath'].value = config['webdav.syncPath'] || '/lx-sync';
                if (webdavForm.elements['webdav.backupPath']) webdavForm.elements['webdav.backupPath'].value = config['webdav.backupPath'] || '/lx-sync-backups';
                if (webdavForm.elements['sync.interval']) webdavForm.elements['sync.interval'].value = config['sync.interval'] || 60;
                if (webdavForm.elements['sync.backupInterval']) webdavForm.elements['sync.backupInterval'].value = config['sync.backupInterval'] || 24;
                if (webdavForm.elements['webdav.retentionCount']) webdavForm.elements['webdav.retentionCount'].value = config['webdav.retentionCount'] ?? 5;
                if (webdavForm.elements['webdav.retentionDays']) webdavForm.elements['webdav.retentionDays'].value = config['webdav.retentionDays'] ?? 0;
                if (webdavForm.elements['backup.webdav.mirrorDeletes']) webdavForm.elements['backup.webdav.mirrorDeletes'].checked = config['backup.webdav.mirrorDeletes'] === true;
                if (webdavForm.elements['backup.webdav.restoreOnStartup']) webdavForm.elements['backup.webdav.restoreOnStartup'].checked = config['backup.webdav.restoreOnStartup'] === true;
                this.toggleWebdavVisibility();
            }
            // 4. OpenList 连接与周期表单
            const olForm = document.getElementById('openlist-form');
            if (olForm && (forceDiscard || !dirty.has('openlist-form'))) {
                if (olForm.elements['openlist.enable']) olForm.elements['openlist.enable'].checked = config['openlist.enable'] === true;
                if (olForm.elements['openlist.endpoint']) olForm.elements['openlist.endpoint'].value = config['openlist.endpoint'] || '';
                if (olForm.elements['openlist.token']) olForm.elements['openlist.token'].value = config['openlist.token'] || '';
                if (olForm.elements['openlist.externalUrl']) olForm.elements['openlist.externalUrl'].value = config['openlist.externalUrl'] || '';
                if (olForm.elements['openlist.root']) olForm.elements['openlist.root'].value = config['openlist.root'] || '/lx_music';
                if (olForm.elements['openlist.syncInterval']) olForm.elements['openlist.syncInterval'].value = config['openlist.syncInterval'] || 60;
                if (olForm.elements['openlist.verifyInterval']) olForm.elements['openlist.verifyInterval'].value = config['openlist.verifyInterval'] || 5;
                if (olForm.elements['openlist.historyRetentionDays']) olForm.elements['openlist.historyRetentionDays'].value = config['openlist.historyRetentionDays'] || 7;
                this.toggleOpenlistVisibility();
            }
            this.initOpenlistRestore(config);
            // 5. OpenList 播放缓存表单
            const cacheForm = document.getElementById('openlist-cache-form');
            if (cacheForm && (forceDiscard || !dirty.has('openlist-cache-form'))) {
                if (cacheForm.elements['openlist.playback.enable']) cacheForm.elements['openlist.playback.enable'].checked = config['openlist.playback.enable'] === true;
                if (cacheForm.elements['openlist.includeNonAudio']) cacheForm.elements['openlist.includeNonAudio'].checked = config['openlist.includeNonAudio'] === true;
                let users = [];
                this._olbUsersLoaded = true;
                try {
                    const ulist = await this.request('/api/users');
                    users = (ulist || []).map(u => u.name).filter(Boolean);
                } catch {
                    this._olbUsersLoaded = false;
                }
                if (this._olbUsersLoaded) {
                    this.renderOpenlistUserConfig(users, config['openlist.userBackups']);
                }
            }
        } finally {
            this._bmSuppressDirty = false;
        }
    }

    async saveLocalBackupSettings() {
        const form = document.getElementById('local-backup-form');
        if (!form) return;
        const fd = new FormData(form);
        const status = document.getElementById('bm-status-local');
        const payload = {
            maxSnapshotNum: Math.max(1, parseInt(fd.get('maxSnapshotNum'), 10) || 10),
            'configBackup.enable': fd.get('configBackup.enable') === 'on',
            'configBackup.retentionDays': Math.max(1, Math.min(365, parseInt(fd.get('configBackup.retentionDays'), 10) || 7)),
            'configBackup.dir': (fd.get('configBackup.dir') || '').trim(),
            'configBackup.intervalHours': Math.max(1, Math.min(8760, parseInt(fd.get('configBackup.intervalHours'), 10) || 24)),
            'configBackup.scheduleTime': (fd.get('configBackup.scheduleTime') || '').trim(),
            'snapshot.backupPath': (fd.get('snapshot.backupPath') || '').trim(),
        };
        try {
            const res = await this.request('/api/config', { method: 'POST', body: JSON.stringify(payload) });
            if (this.loadedConfig) Object.assign(this.loadedConfig, payload);
            this.markBackupDirty('local-backup-form', false);
            if (status) {
                status.classList.remove('is-error', 'is-dirty');
                status.textContent = res.warning || '本地备份设置已保存并生效。';
            }
            showSuccess('本地备份设置已保存');
            this.loadConfigBackups();
        } catch (err) {
            if (status) {
                status.classList.add('is-error');
                status.textContent = '保存失败：' + err.message;
            }
            showError('保存本地备份设置失败: ' + err.message);
        }
    }

    async saveWebdavSettings() {
        const form = document.getElementById('webdav-form');
        if (!form) return;
        const fd = new FormData(form);
        const status = document.getElementById('bm-status-webdav');
        const payload = {
            'webdav.enable': fd.get('webdav.enable') === 'on',
            'webdav.url': (fd.get('webdav.url') || '').trim(),
            'webdav.username': fd.get('webdav.username') || '',
            'webdav.password': fd.get('webdav.password') || '',
            'webdav.syncPath': (fd.get('webdav.syncPath') || '').trim() || '/lx-sync',
            'webdav.backupPath': (fd.get('webdav.backupPath') || '').trim() || '/lx-sync-backups',
            'sync.interval': Math.max(1, parseInt(fd.get('sync.interval'), 10) || 60),
            'sync.backupInterval': Math.max(1, parseInt(fd.get('sync.backupInterval'), 10) || 24),
            'webdav.retentionCount': Math.max(1, Math.min(1000, Number(fd.get('webdav.retentionCount')) || 5)),
            'webdav.retentionDays': Math.max(0, Math.min(3650, Number(fd.get('webdav.retentionDays')) || 0)),
            'backup.webdav.mirrorDeletes': fd.get('backup.webdav.mirrorDeletes') === 'on',
            'backup.webdav.restoreOnStartup': fd.get('backup.webdav.restoreOnStartup') === 'on',
        };
        try {
            const res = await this.request('/api/config', { method: 'POST', body: JSON.stringify(payload) });
            if (this.loadedConfig) Object.assign(this.loadedConfig, payload);
            this.markBackupDirty('webdav-form', false);
            if (status) {
                status.classList.remove('is-error', 'is-dirty');
                status.textContent = res.warning || 'WebDAV 设置已保存。';
            }
            this.toggleWebdavVisibility();
            showSuccess('WebDAV 设置已保存');
        } catch (err) {
            if (status) {
                status.classList.add('is-error');
                status.textContent = '保存失败：' + err.message;
            }
            showError('保存 WebDAV 设置失败: ' + err.message);
        }
    }

    async saveOpenlistConnection() {
        const form = document.getElementById('openlist-form');
        if (!form) return;
        const fd = new FormData(form);
        const status = document.getElementById('bm-status-openlist');
        const payload = {
            'openlist.enable': fd.get('openlist.enable') === 'on',
            'openlist.endpoint': (fd.get('openlist.endpoint') || '').trim(),
            'openlist.token': fd.get('openlist.token') || '',
            'openlist.externalUrl': (fd.get('openlist.externalUrl') || '').trim(),
            'openlist.root': (fd.get('openlist.root') || '').trim() || '/lx_music',
            'openlist.syncInterval': Math.max(1, parseInt(fd.get('openlist.syncInterval'), 10) || 60),
            'openlist.verifyInterval': Math.max(1, parseInt(fd.get('openlist.verifyInterval'), 10) || 5),
            'openlist.historyRetentionDays': Math.max(1, Math.min(3650, parseInt(fd.get('openlist.historyRetentionDays'), 10) || 7)),
        };
        try {
            const res = await this.request('/api/config', { method: 'POST', body: JSON.stringify(payload) });
            if (this.loadedConfig) Object.assign(this.loadedConfig, payload);
            this.markBackupDirty('openlist-form', false);
            this.toggleOpenlistVisibility();
            this.initOpenlistRestore(this.loadedConfig || payload);
            if (status) {
                status.classList.remove('is-error', 'is-dirty');
                status.textContent = res.warning || 'OpenList 连接与周期设置已保存。';
            }
            if (res.warning) showInfo(res.warning);
            else showSuccess('OpenList 设置已保存');
        } catch (err) {
            if (status) {
                status.classList.add('is-error');
                status.textContent = '保存失败：' + err.message;
            }
            showError('保存 OpenList 设置失败: ' + err.message);
        }
    }

    async saveOpenlistPlaycache() {
        const form = document.getElementById('openlist-cache-form');
        if (!form) return;
        const fd = new FormData(form);
        const status = document.getElementById('bm-status-playcache');
        const userBackupsRaw = this.collectOpenlistUserBackups();
        const payload = {
            'openlist.playback.enable': fd.get('openlist.playback.enable') === 'on',
            'openlist.includeNonAudio': fd.get('openlist.includeNonAudio') === 'on',
            'openlist.userBackups': this._olbUsersLoaded ? userBackupsRaw : undefined,
        };
        try {
            const res = await this.request('/api/config', { method: 'POST', body: JSON.stringify(payload) });
            if (this.loadedConfig) Object.assign(this.loadedConfig, payload);
            this.markBackupDirty('openlist-cache-form', false);
            if (status) {
                status.classList.remove('is-error', 'is-dirty');
                status.textContent = res.warning || 'OpenList 播放缓存设置已保存。';
            }
            if (res.warning) showInfo(res.warning);
            else showSuccess('OpenList 播放缓存设置已保存');
        } catch (err) {
            if (status) {
                status.classList.add('is-error');
                status.textContent = '保存失败：' + err.message;
            }
            showError('保存播放缓存设置失败: ' + err.message);
        }
    }

    async loadBackupOverview() {
        const cfg = this.loadedConfig || {};
        const isEnabled = key => key === 'local' ? cfg['configBackup.enable'] !== false : cfg[key + '.enable'] === true;
        const showDetails = (key, enabled) => {
            const card = document.getElementById(`bm-ov-${key}`);
            const list = card?.querySelector('.bm-ov-list');
            if (list) list.hidden = !enabled;
            const extra = card?.querySelector('.bm-ov-details');
            if (extra) extra.hidden = !enabled;
            card?.querySelectorAll('.bm-ov-actions button').forEach((button, index) => { if (index !== 1) button.hidden = !enabled; });
        };
        ['local', 'webdav', 'openlist'].forEach(key => showDetails(key, isEnabled(key)));
        let runtime = {}, runtimeError = '';
        if (isEnabled('webdav') || isEnabled('openlist')) {
            try { runtime = await this.request('/api/backup/status'); if (!runtime.success) throw new Error(runtime.message || '调度状态读取失败'); }
            catch (error) { runtimeError = error.message; }
        }
        const time = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未执行';
        const nextTime = value => runtime.maintenance ? '恢复维护中，已暂停' : runtimeError ? '读取失败：' + runtimeError : value ? time(value) + '（调度检查）' : '未安排（检查启用状态与连接）';
        const escOverview = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const tagValues = (values, tone = '') => '<span class="bm-ov-tags">' + values.map(value => '<span class="bm-ov-tag ' + tone + '">' + escOverview(value) + '</span>').join('') + '</span>';
        const addDetails = (key, entries) => {
            const card = document.getElementById(`bm-ov-${key}`);
            const list = card?.querySelector('.bm-ov-extra-list') || card?.querySelector('.bm-ov-list');
            if (!list) return;
            list.querySelectorAll('[data-overview-extra]').forEach(row => row.remove());
            for (const [label, value] of entries) {
                const row = document.createElement('div'); row.className = 'bm-ov-metric'; row.dataset.overviewExtra = 'true';
                const title = document.createElement('dt'), detail = document.createElement('dd');
                title.textContent = label; detail.textContent = String(value);
                if (['备份范围', '文件记录', 'ZIP 保留', '删除 / 启动恢复'].includes(label)) {
                    detail.innerHTML = tagValues(String(value).split(label === '备份范围' ? '、' : ' / '));
                } else if (['当前任务', '云端历史保留', '用户缓存规则', '播放来源', '最大快照数', '锚点时间'].includes(label)) {
                    detail.innerHTML = tagValues([value], label === '当前任务' && value === '空闲' ? 'is-good' : '');
                } else if (label.includes('目录') || label === '配置来源') detail.className = 'bm-ov-path';
                row.append(title, detail); list.appendChild(row);
            }
        };
        const scopeNames = key => (cfg[`backup.${key}.types`] || []).map(type => ({ music: '歌曲与歌词', userFiles: '用户音源', snapshots: '歌单/不喜欢快照', userData: '用户数据', system: '系统与账户' }[type] || type)).join('、') || '未选择数据类型';
        const setCard = (key, { badge, badgeCls, last, next, scope, error }) => {
            const card = document.getElementById(`bm-ov-${key}`);
            if (!card) return;
            const badgeEl = card.querySelector('[data-role="badge"]');
            if (badgeEl) {
                badgeEl.className = 'bm-ov-badge' + (badgeCls ? ' ' + badgeCls : '');
                badgeEl.textContent = badge || '暂无记录';
            }
            const setRole = (r, val) => {
                const el = card.querySelector(`[data-role="${r}"]`);
                if (el) {
                    el.textContent = val || '暂无记录';
                    if (r === 'scope' && val) el.innerHTML = tagValues(val.split(/ [·/] /));
                    if (r === 'last' && val?.includes(' · ')) {
                        const [stamp, ...notes] = val.split(' · ');
                        el.innerHTML = '<span class="bm-ov-time">' + escOverview(stamp) + '</span><span class="bm-ov-note">' + escOverview(notes.join(' · ')) + '</span>';
                    }
                }
            };
            setRole('last', last);
            setRole('next', next);
            setRole('scope', scope);
            setRole('error', error);
        };

        if (cfg.restoreMaintenance) {
            document.getElementById('bm-maintenance-banner')?.classList.remove('hidden');
        }

        // 1. 本地配置备份概览
        try {
            const localData = await this.request('/api/config/backups');
            const enabled = localData.autoBackupEnabled !== false;
            const latestFile = (localData.list || [])[0];
            const lastStr = localData.lastBackupAt
                ? new Date(localData.lastBackupAt).toLocaleString('zh-CN', { hour12: false })
                : (latestFile ? `${new Date(latestFile.time).toLocaleString('zh-CN', { hour12: false })}（${latestFile.name}）` : '暂无记录');
            const nextStr = enabled
                ? (localData.nextBackupAt ? new Date(localData.nextBackupAt).toLocaleString('zh-CN', { hour12: false }) : '暂无记录')
                : '已停用';
            setCard('local', {
                badge: enabled ? '已启用' : '已停用',
                badgeCls: enabled ? 'is-on' : '',
                last: lastStr,
                next: nextStr,
                scope: `每 ${localData.intervalHours || 24} 小时 · 保留 ${localData.retentionDays || 7} 天 · 现有 ${(localData.list || []).length} 份副本`,
                error: localData.lastError || '尚无已记录的备份错误（不代表已验证恢复）',
            });
        } catch (err) {
            setCard('local', {
                badge: cfg['configBackup.enable'] !== false ? '已启用' : '已停用',
                badgeCls: 'is-warn',
                last: '暂无记录',
                next: '暂无记录',
                scope: `每 ${cfg['configBackup.intervalHours'] || 24} 小时 · 保留 ${cfg['configBackup.retentionDays'] || 7} 天`,
                error: err.message || '读取失败',
            });
        }

        // 2. WebDAV 概览
        const wdEnabled = cfg['webdav.enable'] === true;
        const wdHasUrl = !!((cfg['webdav.url'] || '').trim());
        const wdTypesCount = (cfg['backup.webdav.types'] || []).length;
        if (wdEnabled) {
            try {
                const logsRes = await this.request('/api/webdav/logs');
                const logs = logsRes.logs || [];
                const latest = logs[0];
                const latestErr = logs.find(l => l.status && l.status !== 'success');
                setCard('webdav', {
                    badge: wdEnabled ? (wdHasUrl ? '已启用' : '未填地址') : '未启用',
                    badgeCls: wdEnabled ? (wdHasUrl ? 'is-on' : 'is-warn') : '',
                    last: latest ? `${this.formatTime(latest.timestamp)} · ${this.getLogTypeText(latest.type)}（${latest.status === 'success' ? '成功' : '失败'}）` : '暂无记录',
                    next: nextTime(runtime.webdav?.nextSyncAt),
                    scope: `增量 ${cfg['sync.interval'] || 60} 分钟 / ZIP ${cfg['sync.backupInterval'] || 24} 小时 · 已选 ${wdTypesCount} 类数据`,
                    error: latestErr ? `${this.formatTime(latestErr.timestamp)}：${latestErr.message || latestErr.file || '执行失败'}` : '本次启动尚无失败记录',
                });
            } catch (err) {
                setCard('webdav', {
                    badge: wdEnabled ? '已启用' : '未启用',
                    badgeCls: 'is-warn',
                    last: '暂无记录',
                    next: '暂无记录',
                    scope: `已选 ${wdTypesCount} 类数据`,
                    error: err.message || '读取失败',
                });
            }

            addDetails('webdav', [
                ['当前任务', runtime.maintenance ? '恢复维护中' : runtime.webdav?.restoring ? '恢复中' : runtime.webdav?.running ? '备份中' : runtimeError ? '读取失败' : '空闲'],
                ['下次 ZIP 检查', nextTime(runtime.webdav?.nextZipAt)],
                ['备份范围', scopeNames('webdav')],
                ['增量目录', cfg['webdav.syncPath'] || '/lx-sync'],
                ['ZIP 目录', cfg['webdav.backupPath'] || '/lx-sync-backups'],
                ['ZIP 保留', `最多 ${cfg['webdav.retentionCount'] || 5} 份 / ${cfg['webdav.retentionDays'] ? cfg['webdav.retentionDays'] + ' 天' : '不限天数'}`],
                ['删除 / 启动恢复', `${cfg['backup.webdav.mirrorDeletes'] ? '传播本地删除' : '保留云端副本'} / ${cfg['backup.webdav.restoreOnStartup'] ? '每次启动恢复' : '仅手动恢复'}`],
            ]);
        } else setCard('webdav', { badge: '未启用' });

        // 3. OpenList 概览
        const olEnabled = cfg['openlist.enable'] === true;
        const olHasUrl = !!((cfg['openlist.endpoint'] || '').trim());
        const olTypesCount = (cfg['backup.openlist.types'] || []).length;
        if (olEnabled) {
            try {
                const olRes = await this.request('/api/openlist/backups');
                const rows = olRes.list || [];
                const completed = rows.filter(r => ['completed', 'verified'].includes(r.status)).length;
                const failedRows = rows.filter(r => r.status === 'failed');
                const latestTs = rows.reduce((max, r) => Math.max(max, Number(r.updated_at) || 0), 0);
                setCard('openlist', {
                    badge: olEnabled ? (olHasUrl ? (failedRows.length ? '有失败项' : '已启用') : '未填地址') : '未启用',
                    badgeCls: olEnabled ? (failedRows.length ? 'is-error' : (olHasUrl ? 'is-on' : 'is-warn')) : '',
                    last: runtime.openlist?.lastRun ? `${time(runtime.openlist.lastRun.at)} · 上传 ${runtime.openlist.lastRun.uploaded} / 下载 ${runtime.openlist.lastRun.downloaded} / 删除 ${runtime.openlist.lastRun.deleted} / 错误 ${runtime.openlist.lastRun.errors.length}` : latestTs ? `${time(latestTs)} · 文件记录更新（上传完成 ${completed} 项，非整轮执行结果）` : '暂无记录',
                    next: nextTime(runtime.openlist?.nextSyncAt),
                    scope: `备份 ${cfg['openlist.syncInterval'] || 60} 分钟 / 检查 ${cfg['openlist.verifyInterval'] || 5} 分钟 · 已选 ${olTypesCount} 类数据`,
                    error: failedRows.length ? `${failedRows.length} 个文件上传或校验失败（${failedRows[0].error || failedRows[0].name}）` : runtime.openlist?.lastRun?.errors?.join('；') || '当前无失败文件记录',
                });
            } catch (err) {
                setCard('openlist', {
                    badge: olEnabled ? '已启用' : '未启用',
                    badgeCls: 'is-warn',
                    last: '暂无记录',
                    next: '暂无记录',
                    scope: `已选 ${olTypesCount} 类数据`,
                    error: err.message || '读取失败',
                });
            }
            let rules = [];
            try { rules = JSON.parse(cfg['openlist.userBackups'] || '[]').filter(rule => rule.enabled !== false && rule.backupCache === true); } catch { }
            const counts = runtime.openlist?.counts;
            addDetails('openlist', [
                ['当前任务', runtime.maintenance ? '恢复维护中' : runtime.openlist?.running ? '同步中' : runtime.openlist?.checking ? '后台检查中' : runtimeError ? '读取失败' : '空闲'],
                ['下次后台检查', nextTime(runtime.openlist?.nextCheckAt)],
                ['文件记录', counts ? `待上传 ${counts.pending} / 进行中 ${counts.uploading} / 上传完成 ${counts.completed} / 失败 ${counts.failed}` : '状态读取失败'],
                ['备份范围', scopeNames('openlist')],
                ['数据目录', (cfg['openlist.root'] || '/lx_music').replace(/\/$/, '') + '/_data'],
                ['云端历史保留', `${cfg['openlist.historyRetentionDays'] || 7} 天`],
                ['用户缓存规则', `${rules.length} 个用户启用缓存同步`],
                ['播放来源', cfg['openlist.playback.enable'] ? '允许（另需用户端配置）' : '未开启'],
            ]);
        } else setCard('openlist', { badge: '未启用' });
        if (isEnabled('local')) addDetails('local', [
            ['配置来源', cfg.configPath || '当前生效的 config.js'],
            ['保存目录', cfg['configBackup.dir'] || '数据目录/backups'],
            ['锚点时间', cfg['configBackup.scheduleTime'] || '从启动/重新设置后计时'],
            ['最大快照数', cfg.maxSnapshotNum || 10],
            ['额外快照目录', cfg['snapshot.backupPath'] || '未设置，使用用户原快照目录'],
        ]);
    }

    openOpenlistUsageModal() {
        const modal = document.getElementById('openlist-usage-modal');
        if (!modal) return;
        this._openlistUsageOrigin = document.activeElement;
        modal.classList.remove('hidden');
        document.getElementById('openlist-usage-close')?.focus();
        this._openlistUsageKeydown ??= event => {
            if (event.key === 'Escape') this.closeOpenlistUsageModal();
        };
        document.addEventListener('keydown', this._openlistUsageKeydown);
    }

    closeOpenlistUsageModal() {
        document.getElementById('openlist-usage-modal')?.classList.add('hidden');
        if (this._openlistUsageKeydown) document.removeEventListener('keydown', this._openlistUsageKeydown);
        this._openlistUsageOrigin?.focus();
        this._openlistUsageOrigin = null;
    }

    openWebdavUsageModal() {
        const modal = document.getElementById('webdav-usage-modal');
        if (modal) {
            modal.classList.remove('hidden');
        }
    }

    closeWebdavUsageModal() {
        const modal = document.getElementById('webdav-usage-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    initCustomSelects() {
        const selects = document.querySelectorAll('select.config-input, select.form-input, .config-field select, select.olb-select');
        selects.forEach(sel => {
            if (sel._lxInit) {
                sel._lxRender?.();
                sel._lxSync?.();
                return;
            }
            sel._lxInit = true;

            const wrap = document.createElement('div');
            const isSm = sel.classList.contains('olb-select');
            const isPager = sel.classList.contains('olb-pagesize-select');
            wrap.className = 'lx-select' + (isSm ? ' select-sm' : '') + (isPager ? ' select-pager' : '');
            sel.parentNode.insertBefore(wrap, sel);
            wrap.appendChild(sel);
            sel.classList.add('lx-select-native');

            const trigger = document.createElement('div');
            trigger.className = 'lx-select-trigger';
            const text = document.createElement('span');
            text.className = 'lx-select-text';
            const arrow = document.createElement('div');
            arrow.className = 'lx-select-arrow';
            arrow.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;display:block;"><polyline points="6 9 12 15 18 9"/></svg>';
            trigger.appendChild(text);
            trigger.appendChild(arrow);
            wrap.appendChild(trigger);

            const menu = document.createElement('div');
            menu.className = 'lx-select-menu';
            wrap.appendChild(menu);

            const checkSvg = '<svg class="lx-select-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';

            const sync = () => {
                const opt = sel.options[sel.selectedIndex] || sel.options[0];
                text.textContent = opt ? opt.textContent : '';
                wrap.classList.toggle('is-disabled', !!sel.disabled);
                menu.querySelectorAll('.lx-select-item').forEach(it => {
                    it.classList.toggle('is-selected', it.dataset.value === (opt ? opt.value : ''));
                });
            };

            const render = () => {
                menu.innerHTML = '';
                Array.from(sel.options).forEach(opt => {
                    const item = document.createElement('div');
                    item.className = 'lx-select-item' + (opt.value === sel.value ? ' is-selected' : '');
                    item.dataset.value = opt.value;
                    const labelSpan = document.createElement('span');
                    labelSpan.className = 'lx-select-item-label';
                    labelSpan.textContent = opt.textContent;
                    item.appendChild(labelSpan);
                    item.insertAdjacentHTML('beforeend', checkSvg);
                    item.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (sel.value !== opt.value) {
                            sel.value = opt.value;
                            sel.dispatchEvent(new Event('change', { bubbles: true }));
                            sel.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                        sync();
                        wrap.classList.remove('is-open');
                    });
                    menu.appendChild(item);
                });
            };

            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                if (sel.disabled) return;
                const isOpen = wrap.classList.contains('is-open');
                document.querySelectorAll('.lx-select.is-open').forEach(el => el.classList.remove('is-open'));
                if (!isOpen) {
                    render();
                    sync();
                    const rect = wrap.getBoundingClientRect();
                    const spaceBelow = window.innerHeight - rect.bottom;
                    if (spaceBelow < 220 && rect.top > 200) {
                        wrap.classList.add('drop-up');
                    } else {
                        wrap.classList.remove('drop-up');
                    }
                    wrap.classList.add('is-open');
                }
            });

            sel.addEventListener('change', sync);
            sel._lxRender = render;
            sel._lxSync = sync;
            render();
            sync();
        });
    }

    syncCustomSelects() {
        document.querySelectorAll('select.lx-select-native').forEach(sel => {
            sel._lxRender?.();
            sel._lxSync?.();
        });
    }
}

// 监听点击外部关闭下拉菜单与自定义选择器
document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-user-selector')) {
        document.querySelectorAll('.selector-dropdown').forEach(d => d.classList.add('hidden'));
        document.querySelectorAll('.custom-user-selector').forEach(s => s.classList.remove('open'));
    }
    if (!e.target.closest('.lx-select')) {
        document.querySelectorAll('.lx-select.is-open').forEach(el => el.classList.remove('is-open'));
    }
});

// 初始化应用
const app = new App();

// Shared overflow handling for admin list labels. Keep existing nodes and events.
(() => {
    const selectors = [
        '.olb-filename-text', '.olb-err-text', '.user-name-text', '.col-id-text',
        '.playlist-name', '.playlist-id', '.song-title-text', '.song-singer-mobile',
        '.song-col-album', '.song-col-playlist', '.song-col-source',
        '.album-title', '.artist-name', '.lx-select-text', '.lx-select-item-label'
    ].join(',');
    let pending = false;
    function refresh() {
        pending = false;
        document.querySelectorAll(selectors).forEach(el => {
            if (!el.clientWidth || el.querySelector('button, input, select')) return;
            let track = el.querySelector(':scope > .admin-overflow-track');
            if (!track) {
                if (el.scrollWidth <= el.clientWidth + 1) return;
                track = document.createElement('span');
                track.className = 'admin-overflow-track';
                track.append(...el.childNodes);
                el.appendChild(track);
                el.classList.add('admin-overflow-label');
            }
            const distance = Math.max(0, track.scrollWidth - el.clientWidth);
            el.style.setProperty('--admin-overflow-distance', `-${distance}px`);
            el.style.setProperty('--admin-overflow-duration', `${Math.max(5, distance / 30 + 3)}s`);
            const overflowing = distance > 1;
            if (el.classList.contains('admin-is-overflowing') !== overflowing) {
                el.classList.toggle('admin-is-overflowing', overflowing);
            }
        });
    }
    function schedule() {
        if (pending) return;
        pending = true;
        requestAnimationFrame(refresh);
    }
    new MutationObserver(schedule).observe(document.body, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['class', 'hidden']
    });
    window.addEventListener('resize', schedule);
    document.fonts?.ready.then(schedule);
    schedule();
})();
