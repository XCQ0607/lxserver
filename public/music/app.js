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

function checkForUpdates() {
    if (window.LxNotification && window.LxNotification.checkUpdates) {
        window.LxNotification.checkUpdates(true);
    } else {
        showinfo('通知服务未就绪，请稍后重试');
    }
}

const API_BASE = '/api/music';
let currentPage = 1;
window.currentPage = 1;
let currentSearch = { name: '', source: 'kw' };
let currentPlaylist = [];
let currentIndex = -1;
let preSelectedNextIndex = null; // 预先选定的下一首索引 (用于确保随机模式下的预读一致性)
window.viewingPlaylist = []; // Currently displayed list in UI
let currentPlayingScope = 'network'; // Scope for active playback
window.currentSearchScope = 'network'; // 'network', 'local_list', 'local_all' - Scope for UI view
let currentPlayingSong = null; // Track currently playing song independently of view
window.batchCollectSongs = null; // Store songs for batch collection modal
window.playlistAddTargetSong = null; // Explicit single-song target from any song list
const audio = document.getElementById('audio-player');
let currentPlaybackRate = 1.0;

// Initialize Unified Search for Global (Favorites/Search)
window.goToPage = function (page) {
    currentPage = page;
    window.currentPage = page;
    if (typeof doSearch === 'function') doSearch(page);
};

function initGlobalListSearch() {
    if (window.ListSearch) {
        window.ListSearch.init('global', {
            renderCallback: () => renderResults(window.viewingPlaylist),
            paginationCallback: (page, index) => {
                window.goToPage(page);
                setTimeout(() => window.ListSearch.scrollToMatch(index), 300);
            },
            getList: () => window.viewingPlaylist,
            itemsPerPage: settings.itemsPerPage === 'all' ? 999999 : parseInt(settings.itemsPerPage)
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initGlobalListSearch();
});

// Settings & Batch Selection
const DEFAULT_SETTINGS = {
    itemsPerPage: 20, // Default 20 items per page, can be 'all'
    defaultEntry: 'favorites', // 默认入口: 'search' | 'songlist' | 'leaderboard' | 'favorites' | 'localmusic'
    preferredQuality: 'flac', // 默认音质偏好
    enablePublicSources: true, // 是否显示公开源
    enableProxyPlayback: false, // 播放音乐代理
    enableProxyDownload: false, // 下载音乐代理
    enableAutoProxy: true, // 自动代理
    enableCustomProxy: false, // 是否启用自定义代理
    customProxyUrl: '', // 自定义代理URL模板，使用 {url} 作为原始URL占位符
    enableOnlyDownloadMode: true, // 仅下载模式
    downloadConcurrency: 3, // 缓存并发量 (1-5)
    hotSearchLimit: 20, // 热搜显示数量
    lyricFontSize: 1.25, // 歌词字体大小 (rem)
    lyricFontFamily: '', // 词字体
    switchPlaylistOnSearchPlay: true, // 播放搜索歌曲时切换歌单 (默认开启)
    switchPlaylistOnSongListPlay: true, // 播放歌单/排行榜歌曲时切换歌单 (默认开启)
    autoResume: true, // 自动恢复进度 (默认开启)
    showSidebarSongInfo: false, // 展示侧边栏封面
    enableCrossfade: true, // 音频淡入淡出
    keepScreenAwake: true, // 保持屏幕唤醒设置
    enableKeyboardShortcuts: true, // 按键快捷方式 (默认开启)
    showLyricTranslation: true, // 显示歌词翻译
    showLyricRoma: false, // 显示歌词罗马音
    swapLyricTransRoma: false, // 交换翻译与罗马音位置
    autoCompactPlaybar: true, // 自动精简控制栏 (默认开启)
    enableAutoSwitchSource: true, // 自动尝试换源 (默认开启)
    enableAutoSwitchApiSource: true, // 自动解析换源 (默认开启)
    enableAutoSkipOnError: true, // 失败自动下一曲 (默认开启)
    enableAutoDegradeQuality: true, // 自动降低音质 (默认开启)
    playbackErrorPriority: 'platform,quality,next', // 播放失败处理优先级
    enablePreloader: true, // 预读机制 (默认开启)
    enableSmtcLyric: true, // SMTC 歌词显示 (默认开启)
    // Visualizer Settings (Refactored)
    showFooterVisualizer: true,
    footerVisualizerStyle: 'bars',
    showDetailVisualizer: false,
    detailVisualizerStyle: 'pulse',
    visualizerOpacity: 0.5,
    visualizerGlobalStyle: 'blocks',
    // Cache Settings
    enableServerCache: true, // 开启服务器缓存
    enableServerLyricCache: true, // 开启服务器歌词文件缓存
    embedLyricToFile: true, // 下载时将歌词嵌入文件（标签+.lrc）
    serverCacheLocation: 'root', // 缓存位置: 'data' (synced) or 'root' (local)
    serverCacheNamingPattern: 'simple', // 缓存命名规则: standard | simple
    enableRemaster: false, // 启用下载目录歌曲洗版
    enableLyricCache: true,
    enableSongUrlCache: true,
    enableLyricGlow: true, // 歌词荧光效果 (默认开启)
    enablePersistentToken: false, // 启用持久化 Token 验证
    playerBackground: 'blur', // 播放页背景: 'blur', 'solid', 'dark'
    saveAccountSettingsToFile: true, // 同步账号设置到文件 (默认开启)
    autoUpdateNetworkList: false, // 自动更新网络歌单 (默认关闭)
    networkListAutoCheckInterval: '6h', // 网络歌单自动检测间隔
    favoriteSidebarOrder: [], // 我的收藏侧边栏子项排序
    preferServerCache: true, // 优先播放缓存歌曲 (默认开启)
    remoteSyncUrl: '', // 远程同步地址
    remoteSyncCode: '', // 远程同步连接码
    enableClientModeSync: false, // 客户端模式: 每次登陆本地账户都会模拟客户端向远程服务器发起同步请求
    lastRemoteSyncMode: 'merge_remote_local', // 上次使用的远程同步模式
    deduplicatePlaylistByQuality: true, // 同 ID 歌曲仅加入最高音质 (默认开启)
};

function normalizeDownloadConcurrency(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.downloadConcurrency;
    return Math.min(5, Math.max(1, parsed));
}

function normalizeStoredSettings(nextSettings) {
    if (!nextSettings || typeof nextSettings !== 'object') return nextSettings;
    delete nextSettings.remasterRetryManifest;
    if (nextSettings.downloadConcurrency !== undefined) {
        nextSettings.downloadConcurrency = normalizeDownloadConcurrency(nextSettings.downloadConcurrency);
    }
    const validPatterns = ['standard', 'simple', 'singer_name_quality_album', 'singer_name', 'name_singer'];
    nextSettings.serverCacheNamingPattern = validPatterns.includes(nextSettings.serverCacheNamingPattern)
        ? nextSettings.serverCacheNamingPattern
        : 'simple';
    return nextSettings;
}

let settings = { ...DEFAULT_SETTINGS };

// 歌词原始数据，用于设置切换时重新渲染
let currentRawLrc = '';
let currentRawTlrc = '';
let currentRawRlrc = '';
let currentRawKlrc = ''; // 逐词歌词 (klyric/lxlyric)
let lastLyricSongId = null; // 追踪上次加载歌词的歌曲ID

let currentRecoveryState = null; // 播放失败自动恢复状态管理
let currentPlaybackErrorHandler = null; // 当前音频地址的错误恢复监听器
let shouldAutoRecoverPlayback = false;
let playbackRecoveryTriggeredForRequestId = 0;

function handleUnexpectedPlaybackPause() {
    const requestId = currentRecoveryState?.thisRequestId;
    if (!shouldAutoRecoverPlayback || !requestId || audio.ended || !audio.src) return false;
    if (playbackRecoveryTriggeredForRequestId === requestId) return false;

    shouldAutoRecoverPlayback = false;
    playbackRecoveryTriggeredForRequestId = requestId;
    if (currentPlaybackErrorHandler && typeof audio.removeEventListener === 'function') {
        audio.removeEventListener('error', currentPlaybackErrorHandler);
        currentPlaybackErrorHandler = null;
    }
    void runRecoveryFlow(new Error('播放链接意外暂停'));
    return true;
}

// 从 localStorage 加载设置
try {
    const saved = localStorage.getItem('lx_settings');
    if (saved) {
        settings = normalizeStoredSettings({ ...settings, ...JSON.parse(saved) });
    }
} catch (e) {
    console.error('[Settings] 加载设置失败:', e);
}
window.settings = settings; // 显式挂载到 window
window.networkListUpdateMap = new Set();
let networkListAutoCheckTimer = null;

function escapeHtmlText(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    })[ch]);
}

function parseNetworkListAutoCheckInterval(value) {
    const minIntervalMs = 30 * 1000;
    if (value === undefined || value === null) return 0;
    const raw = String(value).trim().toLowerCase();
    if (raw === '' || raw === '0' || raw === 'off' || raw === 'none' || raw === 'disable') return 0;
    const matched = raw.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/);
    if (!matched) return null;
    const count = parseFloat(matched[1]);
    const unit = matched[2] || 'h';
    if (!Number.isFinite(count) || count < 0) return null;
    let intervalMs = null;
    switch (unit) {
        case 'ms': intervalMs = count; break;
        case 's': intervalMs = count * 1000; break;
        case 'm': intervalMs = count * 60 * 1000; break;
        case 'h': intervalMs = count * 60 * 60 * 1000; break;
        case 'd': intervalMs = count * 24 * 60 * 60 * 1000; break;
        default: return null;
    }
    return Math.max(intervalMs, minIntervalMs);
}

function setupNetworkListAutoCheck() {
    if (networkListAutoCheckTimer) {
        clearInterval(networkListAutoCheckTimer);
        networkListAutoCheckTimer = null;
    }
    if (!settings.autoUpdateNetworkList) {
        return;
    }
    const intervalMs = parseNetworkListAutoCheckInterval(settings.networkListAutoCheckInterval);
    if (intervalMs === null || intervalMs <= 0) {
        return;
    }
    networkListAutoCheckTimer = setInterval(() => {
        checkNetworkListUpdates().catch(err => console.error('[AutoCheck] 网络歌单检测失败:', err));
    }, intervalMs);
    console.log('[AutoCheck] 已设置网络歌单自动检测间隔：', settings.networkListAutoCheckInterval, '(', intervalMs, 'ms )');
}

async function checkNetworkListUpdates(manual = false) {
    if (!currentListData || !Array.isArray(currentListData.userList) || currentListData.userList.length === 0) {
        if (manual && window.showToast) showToast('info', '当前没有可检查的网络歌单', 3000);
        return;
    }

    const targetLists = currentListData.userList.filter(l => l && l.sourceListId && l.source);
    if (targetLists.length === 0) {
        if (manual && window.showToast) showToast('info', '当前没有可检查的网络歌单', 3000);
        return;
    }

    const changedLists = [];
    const failedLists = [];

    for (const list of targetLists) {
        try {
            const url = `${API_BASE}/songList/detail?source=${encodeURIComponent(list.source)}&id=${encodeURIComponent(list.sourceListId)}&page=1`;
            const res = await fetch(url);
            const data = await res.json();
            if (!data || !Array.isArray(data.list)) {
                throw new Error('远端歌单数据不完整');
            }

            const remoteList = data.list.map(item => {
                const formatted = formatSongToLxMusicStandard(item);
                if (!formatted.source) formatted.source = list.source;
                return formatted;
            });

            const localList = Array.isArray(list.list) ? list.list : [];
            const sameLength = localList.length === remoteList.length;
            const sameIds = sameLength && localList.every((item, index) => item && remoteList[index] && String(item.id || '') === String(remoteList[index].id || '') && String(item.source || '') === String(remoteList[index].source || ''));
            if (!sameIds) {
                window.networkListUpdateMap.add(list.id);
                changedLists.push(list.name || list.id || list.sourceListId);
            } else {
                window.networkListUpdateMap.delete(list.id);
            }
        } catch (err) {
            console.error('[CheckNetworkListUpdates] 检查失败:', list.name || list.id || list.sourceListId, err);
            failedLists.push(list.name || list.id || list.sourceListId);
        }
    }

    if (typeof renderMyLists === 'function') {
        renderMyLists(currentListData);
    }

    if (manual) {
        const changedListNames = changedLists.map(escapeHtmlText);
        const failedListNames = failedLists.map(escapeHtmlText);
        if (changedLists.length > 0) {
            showSuccess(`检测到 ${changedLists.length} 个歌单已更新：${changedListNames.join('、')}`);
        } else if (failedLists.length === 0) {
            showSuccess('所有网络歌单均为最新状态');
        }
        if (failedLists.length > 0) {
            showError(`部分歌单检测失败：${failedListNames.join('、')}`);
        }
    } else if (changedLists.length > 0 && window.showToast) {
        showToast('info', `检测到 ${changedLists.length} 个网络歌单有更新`, 5000);
    }
}

window.checkNetworkListUpdates = checkNetworkListUpdates;



// Initial Sync for Server Cache Config
setTimeout(() => {
    if (settings.serverCacheLocation && window.updateServerCacheConfig) {
        console.log('[ServerCache] Syncing config:', settings.serverCacheLocation, settings.serverCacheNamingPattern);
        window.updateServerCacheConfig(settings.serverCacheLocation, settings.serverCacheNamingPattern);
    }
}, 2000);

window.batchMode = false;
window.selectedItems = new Set();
window.selectedSongObjects = new Map();
let expandBtnTimeout = null; // 展开按钮淡化计时器
let toggleLyricsBtnTimeout = null; // 歌词按钮淡化计时器

// ===== 认证相关代码 (Player Cookie Session + User Token) =====
let authEnabled = false;
// authToken 保留用于播放器登录 (player.password) 颁发的 session
let authToken = sessionStorage.getItem('lx_player_auth');
// 用户 Token：将明文密码传输改为 Token 验证
let userToken = localStorage.getItem('lx_user_token');

/**
 * 生成用户 API 请求所需的认证 Headers。
 * 优先使用 Token，若无 Token 则兼容旧的 x-user-password 方式。
 * 注意：此函数总是返回"真实用户"的凭证，不受 isViewingPublicFavorites 影响。
 * 若需要 _open 头，请在调用处手动覆盖 x-user-name。
 */
function getUserAuthHeaders() {
    // 始终优先使用已登录的真实用户
    let username = localStorage.getItem('lx_sync_user') || '';
    // 过滤掉 _open 假用户
    if (username === '_open') username = '';

    const adminPass = localStorage.getItem('lx_admin_password');

    const headers = {};
    if (userToken) {
        headers['x-user-name'] = username;
        headers['x-user-token'] = userToken;
    } else {
        const pass = localStorage.getItem('lx_sync_pass');
        if (username && pass) {
            headers['x-user-name'] = username;
            headers['x-user-password'] = pass;
        } else if (username) {
            headers['x-user-name'] = username;
        }
    }
    if (adminPass) {
        headers['x-frontend-auth'] = adminPass;
    }
    return headers;
}
window.getUserAuthHeaders = getUserAuthHeaders;

function isUserLoggedIn() {
    const user = localStorage.getItem('lx_sync_user');
    const token = localStorage.getItem('lx_user_token');
    const pass = localStorage.getItem('lx_sync_pass');
    return !!user && user !== '_open' && !!(token || pass);
}
window.isUserLoggedIn = isUserLoggedIn;

/**
 * 判断当前 library（收藏歌手/专辑）操作是否应该指向 _open 公开用户
 * 如果已经登录了普通账号，任何 Library 操作（歌手/专辑）始终属于个人账户，不属于 _open
 * 只有在未登录普通账号时，指向 _open 公开空间
 */
function isPublicLibraryContext() {
    if (isUserLoggedIn()) return false;
    return true;
}
window.isPublicLibraryContext = isPublicLibraryContext;



async function fetchPublicListData() {
    const enablePublicFavorites = !!window.lx_config?.['user.enablePublicFavorites'];
    const enablePublicNonAdminAccess = !!window.lx_config?.['user.enablePublicNonAdminAccess'];
    const isAdmin = !!localStorage.getItem('lx_admin_password');
    const isUserLoggedIn = typeof window.isUserLoggedIn === 'function' ? window.isUserLoggedIn() : false;

    if (!enablePublicFavorites) return false;

    // 如果开启了公开收藏，但没开启非管理员访问，且既没登录个人账号也没登录管理员，则不可访问公开收藏
    if (!enablePublicNonAdminAccess && !isAdmin && !isUserLoggedIn) {
        console.log('[PublicList] 未开启非管理员访问且未登录管理员/个人账号，禁止加载公开歌单');
        return false;
    }

    try {
        console.log('[PublicList] 正在获取 _open 公共歌单数据...');
        const headers = {};
        const adminPass = localStorage.getItem('lx_admin_password');
        if (adminPass) headers['x-frontend-auth'] = adminPass;
        headers['x-user-name'] = '_open';
        const res = await fetch('/api/user/list?user=_open', {
            headers,
            cache: 'no-store'
        });
        if (res.ok) {
            const listData = await res.json();
            if (listData) {
                listData.username = '_open';
                // 将公共列表保存为 window.publicListData，切换展示用
                window.publicListData = listData;
                currentListData = listData;
                window.currentListData = listData;
                renderMyLists(listData);
                console.log('[PublicList] 公共歌单数据加载成功');
                if (typeof loadLibraryData === 'function') {
                    await loadLibraryData();
                }
                return true;
            }
        }
    } catch (err) {
        console.warn('[PublicList] 加载公共歌单失败:', err);
    }
    return false;
}
window.fetchPublicListData = fetchPublicListData;

async function reloadUserFavorites() {
    try {
        if (!isUserLoggedIn()) {
            // 未登录个人账号时，加载 _open 公开歌单
            const loaded = await fetchPublicListData();
            if (loaded) return;
            currentListData = null;
            window.currentListData = null;
            renderMyLists(null);
            return;
        }

        // 1. 先恢复已缓存的个人数据（避免切换时白屏）
        if (window.myPersonalListData) {
            currentListData = window.myPersonalListData;
            window.currentListData = window.myPersonalListData;
            renderMyLists(window.myPersonalListData);
        } else {
            currentListData = null;
            window.currentListData = null;
        }

        // 2. 再从服务器拉最新数据
        const headers = typeof getUserAuthHeaders === 'function' ? getUserAuthHeaders() : {};
        delete headers['x-user-name'];
        const syncUser = localStorage.getItem('lx_sync_user');
        if (syncUser && syncUser !== '_open') {
            headers['x-user-name'] = syncUser;
        }
        const res = await fetch('/api/user/list', {
            headers,
            cache: 'no-store'
        });
        if (res.ok) {
            const listData = await res.json();
            if (listData) {
                currentListData = listData;
                window.currentListData = listData;
                window.myPersonalListData = listData;
                renderMyLists(listData);
                await window.ListStore.set(listData).catch(e => console.error('[IDBStore] 保存失败:', e));
                if (typeof loadLibraryData === 'function') {
                    await loadLibraryData();
                }
            }
        }
    } catch (e) {
        console.error('[ReloadFavorites] Error:', e);
    }
}
window.reloadUserFavorites = reloadUserFavorites;

window.isViewingPublicFavorites = false;

async function handleTogglePublicFavorites() {
    window.isViewingPublicFavorites = !window.isViewingPublicFavorites;
    if (window.isViewingPublicFavorites) {
        // 切换到公开列表之前，先保存当前个人数据
        if (currentListData && currentListData.username !== '_open') {
            window.myPersonalListData = currentListData;
        }
        showInfo('已切换至【公开收藏】列表 (_open)');
        const loaded = await fetchPublicListData();
        if (!loaded) {
            showError('加载公开收藏失败');
            window.isViewingPublicFavorites = false;
            // 恢复个人列表
            if (window.myPersonalListData) {
                currentListData = window.myPersonalListData;
                window.currentListData = window.myPersonalListData;
                renderMyLists(window.myPersonalListData);
            }
        } else {
            if (typeof loadLibraryData === 'function') {
                await loadLibraryData();
            }
        }
    } else {
        showInfo('已切换至【个人收藏】列表');
        await reloadUserFavorites();
        if (typeof loadLibraryData === 'function') {
            await loadLibraryData();
        }
    }
}
window.handleTogglePublicFavorites = handleTogglePublicFavorites;

let userTokenRefreshPromise = null;

async function ensureUserAuthToken(options = {}) {
    const force = options.force === true;
    const username = localStorage.getItem('lx_sync_user') || '';
    const password = localStorage.getItem('lx_sync_pass') || '';

    if (!username || !password) {
        if (force) {
            userToken = null;
            localStorage.removeItem('lx_user_token');
            if (typeof updateUserUI === 'function') updateUserUI();
        }
        return false;
    }
    if (userToken && !force) return true;
    if (userTokenRefreshPromise) return userTokenRefreshPromise;

    userTokenRefreshPromise = (async () => {
        if (force) {
            userToken = null;
            localStorage.removeItem('lx_user_token');
        }
        try {
            const response = await fetch('/api/user/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            if (!response.ok) return false;

            const result = await response.json();
            if (!result.success || !result.token) return false;

            userToken = result.token;
            localStorage.setItem('lx_user_token', userToken);
            if (typeof updateUserUI === 'function') updateUserUI();
            return true;
        } catch (error) {
            console.warn('[Auth] Token 自动续签失败:', error);
            return false;
        } finally {
            userTokenRefreshPromise = null;
        }
    })();

    return userTokenRefreshPromise;
}
window.ensureUserAuthToken = ensureUserAuthToken;

/**
 * 更新顶部栏的用户状态显示 (登录按钮/用户名)
 */
function updateUserUI() {
    const loginBtn = document.getElementById('header-login-btn');
    const userDisplay = document.getElementById('header-user-display');
    const usernameEl = document.getElementById('header-username');

    if (!loginBtn || !userDisplay || !usernameEl) return;

    const username = localStorage.getItem('lx_sync_user');
    const token = localStorage.getItem('lx_user_token');

    if (token && username) {
        // 已登录
        loginBtn.classList.add('hidden');
        loginBtn.classList.remove('flex');
        userDisplay.classList.add('flex');
        userDisplay.classList.remove('hidden');
        usernameEl.innerText = username;
    } else {
        // 未登录
        loginBtn.classList.add('flex');
        loginBtn.classList.remove('hidden');
        userDisplay.classList.add('hidden');
        userDisplay.classList.remove('flex');
    }

    // 更新自定义目录开关显示状态
    if (typeof checkAndUpdateCustomDirUI === 'function') {
        checkAndUpdateCustomDirUI();
    }
}
window.updateUserUI = updateUserUI;

/**
 * 检查并更新「本地音乐」Tab 旁的自定义目录开关状态
 */
async function checkAndUpdateCustomDirUI() {
    let userEnableCustomDir = false;
    let localUserToken = typeof userToken !== 'undefined' ? userToken : localStorage.getItem('lx_user_token');
    
    if (localUserToken) {
        try {
            const vRes = await fetch('/api/user/auth/verify', {
                headers: { 'x-user-token': localUserToken }
            });
            const vData = await vRes.json();
            if (!vData.valid) {
                if (typeof ensureUserAuthToken === 'function') {
                    const refreshed = await ensureUserAuthToken({ force: true });
                    if (refreshed) {
                        console.log('[Auth] 用户 Token 已失效，已自动续签。');
                    }
                }
            } else {
                userEnableCustomDir = !!vData.enableCustomMusicDir;
                window.userAllowOperateCustomDir = !!vData.allowOperateCustomMusicDir;
            }
        } catch (e) {
            console.warn('[Auth] Token 验证失败:', e);
        }
    }

    const switchContainer = document.getElementById('custom-dir-switch-container');
    const customDirSwitch = document.getElementById('user-custom-dir-switch');
    if (switchContainer) {
        const isUser = !!localUserToken;
        if (isUser && userEnableCustomDir) {
            switchContainer.classList.remove('hidden');
            switchContainer.classList.add('flex');

            const cachedActive = localStorage.getItem('lx_custom_dir_active') === 'true';
            if (customDirSwitch) {
                customDirSwitch.checked = cachedActive;
                if (cachedActive) {
                    if (window.CustomDirManager && typeof window.CustomDirManager.setActive === 'function') {
                        window.CustomDirManager.setActive(true);
                    } else if (window.LocalMusicManager && typeof window.LocalMusicManager.toggleCustomDirMode === 'function') {
                        window.LocalMusicManager.toggleCustomDirMode(true);
                    }
                }
            }
        } else {
            switchContainer.classList.add('hidden');
            switchContainer.classList.remove('flex');
            
            // 如果用户注销，则取消激活状态
            if (!isUser || !userEnableCustomDir) {
                if (customDirSwitch && customDirSwitch.checked) {
                    customDirSwitch.checked = false;
                    localStorage.setItem('lx_custom_dir_active', 'false');
                    if (window.CustomDirManager && typeof window.CustomDirManager.setActive === 'function') {
                        window.CustomDirManager.setActive(false);
                    } else if (window.LocalMusicManager && typeof window.LocalMusicManager.toggleCustomDirMode === 'function') {
                        window.LocalMusicManager.toggleCustomDirMode(false);
                    }
                }
            }
        }
    }
}
window.checkAndUpdateCustomDirUI = checkAndUpdateCustomDirUI;

/**
 * 顶部栏退出登录处理 (带确认弹窗与全量缓存清理)
 */
async function handleHeaderLogout(e) {
    if (e) e.stopPropagation();
    if (typeof handleSyncLogout === 'function') {
        await handleSyncLogout(false);
    } else {
        const confirmed = typeof showSelect === 'function'
            ? await showSelect('退出同步账号', '确定要退出当前账号并清除同步凭证？', { danger: true })
            : confirm('确定要退出当前账号并清除同步凭证？');
        if (confirmed) {
            try {
                if (window.ListStore && typeof window.ListStore.remove === 'function') {
                    await window.ListStore.remove().catch(() => { });
                }
                if ('caches' in window) {
                    const keys = await caches.keys();
                    await Promise.all(keys.map(k => caches.delete(k)));
                }
            } catch (err) { }
            const agreementAccepted = localStorage.getItem('lx_agreement_accepted');
            localStorage.clear();
            sessionStorage.clear();
            if (agreementAccepted) localStorage.setItem('lx_agreement_accepted', agreementAccepted);
            window.location.reload();
        }
    }
}
window.handleHeaderLogout = handleHeaderLogout;

// 页面加载时：检查是否开启认证，若开启则显示登出按钮
(async () => {
    try {
        const response = await fetch('/api/music/config');
        const config = await response.json();
        window.lx_config = config; // 获取公共配置供权限模块使用
        authEnabled = config['player.enableAuth'] === true;

        // 若开启认证，显示登出按钮
        if (authEnabled) {
            const logoutBtn = document.getElementById('logout-btn');
            if (logoutBtn) {
                logoutBtn.classList.remove('hidden');
                logoutBtn.classList.add('flex');
            }
        }

        // 获取到公共配置后，立即刷新一次 UI 状态 (管理员按钮/设置项禁用等)
        if (typeof syncSettingsUI === 'function') syncSettingsUI();
        else if (typeof updateAdminUI === 'function') updateAdminUI();

        // 更新自定义目录开关显示状态
        await checkAndUpdateCustomDirUI();

        const customDirSwitch = document.getElementById('user-custom-dir-switch');

        if (customDirSwitch) {
            customDirSwitch.addEventListener('change', (e) => {
                const isChecked = e.target.checked;
                if (window.CustomDirManager && typeof window.CustomDirManager.setActive === 'function') {
                    window.CustomDirManager.setActive(isChecked);
                } else if (window.LocalMusicManager && typeof window.LocalMusicManager.toggleCustomDirMode === 'function') {
                    window.LocalMusicManager.toggleCustomDirMode(isChecked);
                }
            });
        }

        // [新增] 公开受限用户自动尝试从服务器拉取配置 (_open)
        if (config['user.enablePublicRestriction']) {
            console.log('[Auth] 检测到公开限制已开启，尝试拉取公共配置...');
            if (typeof fetchSettingsFromServer === 'function') {
                await fetchSettingsFromServer();
            }
        }

        // [新增] 检查公开收藏功能：若无账号登录且开启了公开收藏，尝试拉取公共歌单
        if (config['user.enablePublicFavorites'] && !isUserLoggedIn()) {
            console.log('[Auth] 检测到已开启公开收藏且无账号登录，正在拉取公共歌单...');
            const loaded = await fetchPublicListData();
            if (!loaded) {
                renderMyLists(null);
            }
        }

        // [新增] 客户端模式自动连接远程同步 (仅在已登录到本地账户时触发，防止 _open 访客同步)
        if (userToken && settings.enableClientModeSync && settings.remoteSyncUrl && settings.remoteSyncCode) {
            console.info('[Sync] Client mode enabled, auto-connecting to remote server...');
            // 降低延迟，只要认证完成后即可触发
            setTimeout(() => {
                if (typeof handleRemoteOverwriteConnect === 'function') {
                    handleRemoteOverwriteConnect(true);
                }
            }, 500);
        }

        // [新增] 更新 UI 上的用户名状态
        updateUserUI();

    } catch (error) {
        console.error('[Auth] 初始化检查失败:', error);
    }
})();

// 登出：调用服务端清除 Session，清除本地全量缓存，跳转到登录页
async function handleLogout() {
    try {
        await fetch('/api/music/auth/logout', { method: 'POST' });
    } catch (e) {
        console.error('[Auth] 登出请求失败:', e);
    }

    try {
        if (typeof audio !== 'undefined' && audio) {
            shouldAutoRecoverPlayback = false;
            audio.pause();
            audio.currentTime = 0;
            audio.src = '';
        }
        if (window.ListStore && typeof window.ListStore.remove === 'function') {
            await window.ListStore.remove().catch(() => { });
        }
        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
        }
    } catch (e) { }

    const agreementAccepted = localStorage.getItem('lx_agreement_accepted');
    localStorage.clear();
    sessionStorage.clear();
    if (agreementAccepted) localStorage.setItem('lx_agreement_accepted', agreementAccepted);

    const playerPath = (window.CONFIG && window.CONFIG['player.path']) || (window.lx_config && window.lx_config['player.path']) || '/';
    const normalizedPlayerPath = (playerPath === '/' || playerPath === '') ? '' : playerPath.replace(/\/+$/, '');
    window.location.replace(`${normalizedPlayerPath}/login`);
}
// ===== 认证代码结束 =====

// 音质选择器初始化
document.addEventListener('DOMContentLoaded', () => {
    // 音质选择器初始化
    const qualitySelect = document.getElementById('quality-select');
    if (qualitySelect && settings.preferredQuality) {
        qualitySelect.value = settings.preferredQuality;
    }

    // Initialize Proxy Settings UI
    const proxyPlayback = document.getElementById('toggle-proxy-playback');
    if (proxyPlayback) proxyPlayback.checked = settings.enableProxyPlayback;

    const proxyDownload = document.getElementById('toggle-proxy-download');
    if (proxyDownload) proxyDownload.checked = settings.enableProxyDownload;

    const autoProxy = document.getElementById('toggle-auto-proxy');
    if (autoProxy) autoProxy.checked = settings.enableAutoProxy;

    // Initialize Custom Proxy UI
    const customProxyToggle = document.getElementById('toggle-custom-proxy');
    if (customProxyToggle) customProxyToggle.checked = settings.enableCustomProxy;
    const customProxyInput = document.getElementById('custom-proxy-url-input');
    if (customProxyInput) customProxyInput.value = settings.customProxyUrl || '';
    const customProxyRow = document.getElementById('custom-proxy-url-row');
    if (customProxyRow) customProxyRow.classList.toggle('hidden', !settings.enableCustomProxy);

    const hotSearchLimitInput = document.getElementById('hot-search-limit-input');
    if (hotSearchLimitInput) {
        hotSearchLimitInput.value = (settings.hotSearchLimit !== undefined && settings.hotSearchLimit !== null) ? settings.hotSearchLimit : 20;
    }

    // Initialize SongList Manager
    if (window.SongListManager) {
        window.SongListManager.init();
    }

    // Initialize Lyric Font Size UI
    const lyricFontSizeSlider = document.getElementById('lyric-font-size-slider');
    const lyricFontSizeValue = document.getElementById('lyric-font-size-value');
    if (lyricFontSizeSlider && lyricFontSizeValue) {
        const size = settings.lyricFontSize || 1.25;
        lyricFontSizeSlider.value = size;
        lyricFontSizeValue.innerText = size;
        document.documentElement.style.setProperty('--lyric-font-size', `${size}rem`);
    }

    // Initialize Lyric Font Family UI
    const lyricFontFamilySelect = document.getElementById('lyric-font-family-select');
    if (lyricFontFamilySelect) {
        const fontFamily = settings.lyricFontFamily || '';
        // Check if value exists in default options, if not create it (unless empty)
        if (fontFamily) {
            let exists = Array.from(lyricFontFamilySelect.options).some(opt => opt.value === fontFamily);
            if (!exists) {
                const option = document.createElement('option');
                option.value = fontFamily;
                option.textContent = fontFamily; // Fallback display name
                lyricFontFamilySelect.add(option, null);
            }
            lyricFontFamilySelect.value = fontFamily;
            document.documentElement.style.setProperty('--lyric-font-family', fontFamily);
        }
    }

    // Initialize Progress & Volume Dragging
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
        progressContainer.addEventListener('mousedown', (e) => startDragging(e, 'progress'));
        progressContainer.addEventListener('touchstart', (e) => startDragging(e, 'progress'), { passive: false });
    }

    const volumeContainer = document.getElementById('volume-container');
    if (volumeContainer) {
        volumeContainer.addEventListener('mousedown', (e) => startDragging(e, 'volume'));
        volumeContainer.addEventListener('touchstart', (e) => startDragging(e, 'volume'), { passive: false });
    }

    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('touchmove', handleDragMove, { passive: false });
    window.addEventListener('mouseup', stopDragging);
    window.addEventListener('touchend', stopDragging);

    // 同步所有设置 UI
    syncSettingsUI();
    updateUserUI();
});

// Dragging Logic
let isDragging = null; // 'progress' or 'volume'
let dragPercentage = 0; // Temp value for progress smoothing
let lastSeekTime = 0; // Throttling for live seeking
let lastSeekPct = -1; // 上次执行 seek 时的进度百分比，用于避免原地抖动
const SEEK_THROTTLE_MS = 100; // How often to update audio position while dragging (ms)

function startDragging(e, type) {
    if (e.type === 'touchstart') e.preventDefault(); // Prevent scrolling while seeking
    isDragging = type;
    if (type === 'progress') lastSeekPct = -1; // 重置
    handleDragMove(e);
}

function stopDragging() {
    if (isDragging === 'progress' && Number.isFinite(dragPercentage)) {
        // 只有当最终位置与上次 seek 的位置差异较大时，才执行最后一次 seek
        if (Math.abs(dragPercentage - lastSeekPct) > 0.001) {
            audio.currentTime = dragPercentage * audio.duration;
            if (typeof lyricPlayer !== 'undefined' && lyricPlayer) {
                lyricPlayer.play(audio.currentTime * 1000);
            }
        }
    }
    isDragging = null;
    lastSeekPct = -1;
}

function handleDragMove(e) {
    if (!isDragging) return;

    if (e.type === 'touchmove') e.preventDefault(); // Prevent scrolling

    const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;

    if (isDragging === 'progress') {
        const container = document.getElementById('progress-container');
        if (!container || !audio.duration || !Number.isFinite(audio.duration)) return;
        const rect = container.getBoundingClientRect();
        const x = clientX - rect.left;
        const pct = Math.max(0, Math.min(1, x / rect.width));

        dragPercentage = pct;

        // 1. Update UI immediately (Always smooth)
        document.getElementById('progress-bar').style.width = `${pct * 100}%`;
        document.getElementById('time-current').innerText = formatTime(pct * audio.duration);

        // 2. Throttled update of audio position (Live Seeking)
        const now = Date.now();
        if (now - lastSeekTime > SEEK_THROTTLE_MS) {
            // 只有当进度百分比发生较明显变化（大于 0.1%）时才执行 seek
            // 这可以防止鼠标微小抖动导致的“原地复读”感，并允许停下时正常播放（预览）
            if (Math.abs(pct - lastSeekPct) > 0.001) {
                audio.currentTime = pct * audio.duration;

                // 同步更新歌词进度
                if (typeof lyricPlayer !== 'undefined' && lyricPlayer) {
                    lyricPlayer.play(audio.currentTime * 1000);
                    // 强制歌词对齐但不等待平滑滚动，保持灵敏度
                    scrollToActiveLine(true);
                }

                lastSeekTime = now;
                lastSeekPct = pct;
            }
        }
    } else if (isDragging === 'volume') {
        const container = document.getElementById('volume-container');
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const x = clientX - rect.left;
        const pct = Math.max(0, Math.min(1, x / rect.width));
        currentVolume = pct;
        audio.volume = pct;
        isMuted = false;
        updateVolumeUI();
        // Debounce saving if needed, but simple localstorage here
        localStorage.setItem('lx_volume', currentVolume.toString());
    }
}

// 切换代理设置
function changeProxyPlayback(enabled) {
    updateSetting('enableProxyPlayback', enabled);
}

function changeProxyDownload(enabled) {
    updateSetting('enableProxyDownload', enabled);
}

function changeAutoProxy(enabled) {
    updateSetting('enableAutoProxy', enabled);
}

function changeHotSearchLimit(value) {
    const limit = parseInt(value);
    // [Fix] Allow 0, Check Range 0-50
    if (!isNaN(limit) && limit >= 0 && limit <= 50) {
        updateSetting('hotSearchLimit', limit);
    } else {
        showError('请输入 0 到 50 之间的数字');
        // Reset input
        const input = document.getElementById('hot-search-limit-input');
        if (input) input.value = settings.hotSearchLimit || 20;
    }
}

function changeLyricFontSize(value) {
    const size = parseFloat(value);
    if (!isNaN(size)) {
        updateSetting('lyricFontSize', size);
    }
}

// 读取本地字体
/**
 * 通用加载本地字体逻辑
 * @param {string} targetSelectId - 目标下拉框的 ID，默认为设置页的 'lyric-font-family-select'
 * @param {HTMLElement} btnEl - 触发按钮的引用，用于显示加载动画
 */
async function loadLocalFonts(targetSelectId = 'lyric-font-family-select', btnEl = null) {
    if (!('queryLocalFonts' in window)) {
        showError('抱歉，您的浏览器不支持读取本地字体功能 (Local Font Access API)。\n建议使用 Chrome / Edge 浏览器，并确保在 HTTPS 环境下使用。');
        return;
    }

    const btn = btnEl || document.querySelector('button[onclick="loadLocalFonts()"]');
    const originalText = btn ? btn.innerHTML : '';

    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>读取中...';
        }

        const fonts = await window.queryLocalFonts();
        const fontSelect = document.getElementById(targetSelectId);
        if (!fontSelect) return;

        // Use a set to store unique families
        const fontFamilies = new Set();
        fonts.forEach(font => fontFamilies.add(font.family));

        // Sort alphabetically
        const sortedFamilies = Array.from(fontFamilies).sort();

        if (sortedFamilies.length === 0) {
            showError('未能获取到字体列表');
            return;
        }

        // Remove existing local fonts group if exists
        const oldGroup = fontSelect.querySelector('optgroup[data-source="local"]');
        if (oldGroup) {
            oldGroup.remove();
        }

        // Create a single group for local fonts
        const group = document.createElement('optgroup');
        group.dataset.source = 'local';
        group.label = `本地已安装字体 (${sortedFamilies.length})`;

        sortedFamilies.forEach(family => {
            const option = document.createElement('option');
            // 如果是歌词卡片，保持带引号格式；如果是设置页，保持原样（lyric-card.js 会处理字体族名称）
            option.value = targetSelectId === 'lc-font-select' ? `"${family}", sans-serif` : family;
            option.textContent = family;
            group.appendChild(option);
        });
        fontSelect.appendChild(group);

        showSuccess(`成功获取 ${sortedFamilies.length} 个本地字体！`);

    } catch (err) {
        console.error('[Font] Error loading fonts:', err);
        showError('获取字体失败: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

function changeLyricFontFamily(value) {
    updateSetting('lyricFontFamily', value.trim());
}

// 切换音质偏好
function changeQualityPreference(quality) {
    updateSetting('preferredQuality', quality);
}


// Tab Switching
function switchTab(tabId) {
    // Favorites is a sidebar group toggle, not a main content view.
    if (tabId === 'favorites') {
        handleFavoritesClick();
        return;
    }

    document.querySelectorAll('[id^="view-"]').forEach(el => {
        el.classList.add('hidden');
        el.classList.remove('opacity-100');
        el.classList.add('opacity-0');
    });

    const activeView = document.getElementById(`view-${tabId}`);
    if (!activeView) return;

    activeView.classList.remove('hidden');
    // small delay to allow display block to apply before opacity transition
    setTimeout(() => {
        activeView.classList.remove('opacity-0');
        activeView.classList.add('opacity-100');
        // [新增] 切换 Tab 时顺便检查并更新一次用户状态
        if (typeof updateUserUI === 'function') updateUserUI();
    }, 10);

    // [新增] 切换到设置页面时刷新一次管理员状态和设置项 UI
    if (tabId === 'settings') {
        if (typeof syncSettingsUI === 'function') syncSettingsUI();
        else if (typeof updateAdminUI === 'function') updateAdminUI();
    }

    // Reset Sidebar Highlight
    document.querySelectorAll('[id^="tab-"]').forEach(el => {
        el.classList.remove('active-tab', 'text-emerald-600');
        el.classList.add('t-text-muted');
    });
    const activeTab = document.getElementById(`tab-${tabId}`);
    if (activeTab) {
        activeTab.classList.add('active-tab');
        activeTab.classList.remove('t-text-muted');
    }

    // Clear any pending timeouts
    if (expandBtnTimeout) clearTimeout(expandBtnTimeout);
    if (toggleLyricsBtnTimeout) clearTimeout(toggleLyricsBtnTimeout);

    // Auto-exit secondary modes (search/batch) when switching tabs
    exitListSecondaryModes();

    // Mobile: Close sidebar when switching tabs except for favorites (which should show sub-lists)
    if (window.innerWidth <= 1024 && tabId !== 'favorites') {
        const sidebar = document.getElementById('main-sidebar');
        if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
            toggleSidebar();
        }
    }

    // Always clear sub-item highlight when switching top-level tabs
    document.querySelectorAll('[data-sidebar-list-id]').forEach(el => {
        el.classList.remove('active-sub-item');
        el.classList.add('t-text-muted');
    });

    // Reset Search Scope if switching to search/settings explicitly
    if (tabId === 'search') {
        initGlobalListSearch(); // [New] 强制重置 ListSearch 为 'global' 模式
        currentSearchScope = 'network';
        document.getElementById('search-source').classList.remove('hidden');
        document.getElementById('search-type').classList.remove('hidden');
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.placeholder = "搜索歌曲、歌手...";
            // 如果搜索框内容为空，则展示初始热搜状态，避免由于重用搜索界面展示本地列表导致的残留
            if (!searchInput.value.trim()) {
                showInitialSearchState();
            }
        }
        document.getElementById('page-title').innerText = "搜索音乐";
    }

    if (tabId === 'songlist') {
        document.getElementById('page-title').innerText = "歌单";
    }

    if (tabId === 'leaderboard') {
        document.getElementById('page-title').innerText = "排行榜";
        if (window.LeaderboardManager && !window.LeaderboardManager.initialized) {
            window.LeaderboardManager.init();
        }
    }

    if (tabId === 'localmusic') {
        document.getElementById('page-title').innerText = "本地音乐";
    }

    // Collapse Favorites if leaving
    if (tabId !== 'favorites') {
        const favList = document.getElementById('favorites-children');
        const arrow = document.getElementById('favorites-arrow');
        if (favList && favList.style.height !== '0px') {
            favList.style.height = '0px';
            if (arrow) arrow.style.transform = 'rotate(-90deg)';
        }
    }

    // Title update (handled above for search, others here)
    if (tabId === 'settings') {
        document.getElementById('page-title').innerText = '设置';
        // 确保设置界面的自定义源列表是最新的
        if (typeof loadCustomSources === 'function') {
            loadCustomSources();
        }
    }

    if (tabId === 'about') {
        document.getElementById('page-title').innerText = '关于';
        loadAboutContent();
    }

    // Auto-exit batch mode when switching tabs (Redundant but safe)
    if (window.batchMode && typeof toggleBatchMode === 'function') {
        toggleBatchMode();
    }
}

/**
 * 退出列表的二级模式（搜索框和批量模式）
 */
function exitListSecondaryModes() {
    if (window.ListSearch && window.ListSearch.state.active) {
        window.ListSearch.resetState();
    }
    if (window.batchMode) {
        // 搜索/歌单界面退出
        const batchToolbar = document.getElementById('batch-toolbar');
        const slBatchToolbar = document.getElementById('sl-batch-toolbar');
        if ((batchToolbar && !batchToolbar.classList.contains('hidden')) || (slBatchToolbar && !slBatchToolbar.classList.contains('hidden'))) {
            if (typeof toggleBatchMode === 'function') toggleBatchMode();
        }

        // 排行榜界面退出
        const lbBatchToolbar = document.getElementById('lb-batch-toolbar');
        if (lbBatchToolbar && !lbBatchToolbar.classList.contains('hidden')) {
            if (typeof toggleLbBatchMode === 'function') toggleLbBatchMode();
        }
    }
}

// Load About Content
async function loadAboutContent() {
    const aboutContainer = document.getElementById('about-content');
    if (!aboutContainer) return;

    try {
        const response = await fetch('/music/about.md');
        if (!response.ok) throw new Error('Failed to load about.md');
        const text = await response.text();

        // Render Markdown
        if (window.marked) {
            // Replace {{version}} and {{buildHash}} placeholder
            const version = (window.CONFIG && window.CONFIG.version) || 'v1.0.0';
            const buildHash = (window.CONFIG && window.CONFIG.buildHash) || 'unknown';
            let content = text.replace(/{{version}}/g, version);
            content = content.replace(/{{buildHash}}/g, buildHash);
            aboutContainer.innerHTML = window.marked.parse(content);
        } else {
            aboutContainer.innerText = text; // Fallback
        }
        aboutContainer.classList.remove('animate-pulse');
    } catch (e) {
        console.error('Failed to load about content:', e);
        aboutContainer.innerHTML = '<p class="text-red-500">加载关于页面失败，请稍后重试。</p>';
    }
}

// Set Version on Load
document.addEventListener('DOMContentLoaded', () => {
    if (window.CONFIG && window.CONFIG.version) {
        const versionEl = document.getElementById('app-version');
        if (versionEl) {
            versionEl.innerText = window.CONFIG.version + ' Web';
        }
    }

    // 恢复搜索来源缓存
    const cachedSearchSource = localStorage.getItem('search-source');
    if (cachedSearchSource) {
        const searchSourceEl = document.getElementById('search-source');
        if (searchSourceEl) searchSourceEl.value = cachedSearchSource;
    }

    // 为展开按钮添加悬放恢复逻辑
    const expandBtn = document.getElementById('btn-expand-panel');
    if (expandBtn) {
        expandBtn.addEventListener('mouseenter', () => {
            if (expandBtnTimeout) clearTimeout(expandBtnTimeout);
            expandBtn.classList.remove('faint');
        });
        expandBtn.addEventListener('mouseleave', () => {
            const footer = document.getElementById('player-footer');
            if (footer && footer.classList.contains('translate-y-[110%]')) {
                startExpandBtnTimer();
            }
        });
    }

    // 为歌词按钮添加悬停恢复逻辑
    const toggleLyricsBtn = document.getElementById('btn-toggle-lyrics');
    if (toggleLyricsBtn) {
        toggleLyricsBtn.addEventListener('mouseenter', () => {
            if (toggleLyricsBtnTimeout) clearTimeout(toggleLyricsBtnTimeout);
            toggleLyricsBtn.classList.remove('faint');
        });
        toggleLyricsBtn.addEventListener('mouseleave', () => {
            const view = document.getElementById('view-player-detail');
            if (view && !view.classList.contains('translate-y-[100%]')) {
                startToggleLyricsBtnTimer();
            }
        });
    }
});

// ==================== 播放队列 (Queue) 逻辑 ====================
let isQueueRendered = false;

function toggleQueueDrawer() {
    const drawer = document.getElementById('queue-drawer');
    if (!drawer) return;

    const isHidden = drawer.classList.contains('translate-x-full');
    if (isHidden) {
        renderQueue();
        drawer.classList.remove('translate-x-full');
        // 自动定位当前歌曲
        setTimeout(() => {
            scrollToCurrentSongInQueue(false);
        }, 350); // 等待抽屉打开动画完成

        // Hide sidebar if open on mobile
        if (window.innerWidth <= 1024) {
            const sidebar = document.getElementById('main-sidebar');
            if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
                toggleSidebar();
            }
        }
    } else {
        drawer.classList.add('translate-x-full');
    }
}
window.toggleQueueDrawer = toggleQueueDrawer;

/**
 * 定位播放队列中当前播放的歌曲
 * @param {boolean} flash 是否显示闪烁提醒效果
 */
function scrollToCurrentSongInQueue(flash = true) {
    const listContainer = document.getElementById('queue-list');
    if (!listContainer) return;

    // 根据 renderQueue 中的 active 状态类名进行查找
    const activeItem = listContainer.querySelector('.border-emerald-500');
    if (activeItem) {
        activeItem.scrollIntoView({ behavior: 'smooth', block: 'center' });

        if (flash) {
            // 闪烁高亮提醒
            activeItem.classList.add('ring-2', 'ring-emerald-500', 'ring-inset', 'ring-opacity-50');
            setTimeout(() => {
                activeItem.classList.remove('ring-2', 'ring-emerald-500', 'ring-inset', 'ring-opacity-50');
            }, 1000);
        }
    } else if (flash) {
        showInfo('当前播放歌曲不在队列中或尚未渲染');
    }
}
window.scrollToCurrentSongInQueue = scrollToCurrentSongInQueue;


function renderQueue() {
    const listContainer = document.getElementById('queue-list');
    const countEl = document.getElementById('queue-count');
    if (!listContainer) return;

    if (!currentPlaylist || currentPlaylist.length === 0) {
        listContainer.innerHTML = `
            <div class="flex flex-col items-center justify-center py-20 opacity-30 select-none">
                <i class="fas fa-music text-4xl mb-4"></i>
                <p class="text-xs font-bold uppercase tracking-widest">队列为空</p>
            </div>
        `;
        if (countEl) countEl.innerText = '0 SONGS';
        return;
    }

    if (countEl) countEl.innerText = `${currentPlaylist.length} SONGS`;

    listContainer.innerHTML = currentPlaylist.map((song, index) => {
        const isActive = index === currentIndex;
        return `
            <div class="group flex items-center gap-3 p-3 rounded-xl transition-all hover:t-bg-item-hover cursor-pointer relative ${isActive ? 't-bg-item-hover border-l-4 border-emerald-500 pl-2' : ''}"
                 onclick="playSongFromQueue(${index})">
                
                <div class="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 relative">
                    <img src="${getImgUrl(song)}" 
                         onerror="this.src='/music/assets/logo.svg'" 
                         loading="lazy" fetchpriority="low"
                         class="w-full h-full object-cover">
                    ${isActive ? '<div class="absolute inset-0 bg-emerald-500/20 flex items-center justify-center"><div class="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></div></div>' : ''}
                </div>
                
                <div class="flex-1 min-w-0">
                    ${createMarqueeHtml(song.name, 'text-sm font-bold ' + (isActive ? 'text-emerald-500' : 't-text-main'))}
                    <div class="flex items-center gap-1 mt-0.5 overflow-hidden whitespace-nowrap">
                        ${getSourceTag(song.source)}
                        ${getQualityTags(song)}
                        ${createMarqueeHtml(song.singer, 'text-[10px] t-text-muted flex-1')}
                    </div>
                </div>

                <div class="flex items-center gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onclick="event.stopPropagation(); openPlaylistAddModalForSongObject(currentPlaylist[${index}])" class="p-2 text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors" title="添加到歌单">
                        <i class="fas fa-plus text-xs"></i>
                    </button>
                    <button onclick="event.stopPropagation(); removeFromQueue(${index})" class="p-2 text-gray-400 hover:text-red-500 transition-colors">
                        <i class="fas fa-trash-alt text-xs"></i>
                    </button>
                    <div class="p-2 text-gray-400 cursor-grab active:cursor-grabbing queue-drag-handle">
                        <i class="fas fa-grip-lines text-xs"></i>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Initialize/Update Sortable (Supports Mobile Touch)
    if (typeof Sortable !== 'undefined' && listContainer) {
        try {
            const oldSortable = Sortable.get(listContainer);
            if (oldSortable) oldSortable.destroy();
        } catch (e) { }

        Sortable.create(listContainer, {
            animation: 200,
            handle: '.queue-drag-handle',
            ghostClass: 'sortable-ghost-solid',
            chosenClass: 'sortable-chosen-item',
            dragClass: 'sortable-drag-item',
            forceFallback: true,
            fallbackOnBody: true,
            delay: 100,
            delayOnTouchOnly: true,
            touchStartThreshold: 3,
            onStart: () => {
                document.body.classList.add('select-none');
            },
            onEnd: (evt) => {
                document.body.classList.remove('select-none');
                const oldIndex = evt.oldIndex;
                const newIndex = evt.newIndex;
                if (oldIndex === newIndex) return;

                // Reorder currentPlaylist
                const movedItem = currentPlaylist.splice(oldIndex, 1)[0];
                currentPlaylist.splice(newIndex, 0, movedItem);

                // Update currentIndex if it was affected
                if (currentIndex === oldIndex) {
                    currentIndex = newIndex;
                } else if (oldIndex < currentIndex && newIndex >= currentIndex) {
                    currentIndex--;
                } else if (oldIndex > currentIndex && newIndex <= currentIndex) {
                    currentIndex++;
                }

                renderQueue();
                savePlaybackState();
                showInfo('播放顺序已更新');
            }
        });
    }

    // Update status to show hint if more than 1 item
    const tip = document.getElementById('queue-tip');
    if (tip) {
        if (currentPlaylist.length > 1) tip.classList.remove('hidden');
        else tip.classList.add('hidden');
    }

    // Apply dynamic marquee checks for the queue list
    applyMarqueeChecks();
}

function playSongFromQueue(index) {
    if (!currentPlaylist[index]) return;
    playSong(currentPlaylist[index], index);
}
window.playSongFromQueue = playSongFromQueue;

function removeFromQueue(index) {
    if (!currentPlaylist || index < 0 || index >= currentPlaylist.length) return;

    const removedId = currentPlaylist[index].id;
    currentPlaylist.splice(index, 1);

    // If we removed the currently playing song's index, we need to adjust currentIndex
    if (index === currentIndex) {
        // [Optional] Auto-play next or just stop? Here we just adjust index for next song
        // Typically people expect it to stay at same index but if it was last, wrap around
        if (currentPlaylist.length === 0) {
            currentIndex = -1;
            shouldAutoRecoverPlayback = false;
            try { audio.pause(); } catch (e) { }
        } else if (currentIndex >= currentPlaylist.length) {
            currentIndex = 0; // Wrap to start
        }
        // [Think] Should we auto-play next? Usually delete means "remove but keep playing current"
        // But if user clicks delete on current, maybe skip to next.
        // For now, let's keep playing but adjust index.
    } else if (index < currentIndex) {
        currentIndex--;
    }

    renderQueue();
    savePlaybackState(); // Save state after removal
    showSuccess('已从队列移除');
}
window.removeFromQueue = removeFromQueue;

async function clearQueue() {
    if (!currentPlaylist || currentPlaylist.length === 0) return;
    if (await showSelect('清空队列', '确定要清空当前播放队列吗？', { danger: true })) {
        currentPlaylist = [];
        currentIndex = -1;
        shouldAutoRecoverPlayback = false;
        try { audio.pause(); } catch (e) { }
        renderQueue();
        savePlaybackState(); // Save empty state
        showInfo('队列已清空');
    }
}
window.clearQueue = clearQueue;

// --- Native Drag & Drop Handlers (Removed, replaced by SortableJS) ---
// ===============================================

// Search Logic
function handleSearchKeyPress(e) {
    if (e.key === 'Enter') {
        if (typeof hideSearchSuggestions === 'function') hideSearchSuggestions();
        doSearch();
    }
}

/**
 * 快速跳转到搜索页并执行查询
 * @param {string} query 搜索关键词
 * @param {string} source 可选，切换到指定搜索源
 */
function performSearch(query, source = null) {
    if (!query || query === '暂无播放' || query === '选择一首歌曲播放') return;

    // 预处理：移除括号及其内容 (支持中英文括号)，通常用于移除“歌曲名 (DJ版)”中的补充信息
    let cleanedQuery = query.replace(/\s*[\(\uff08].*?[\)\uff09]\s*/g, ' ').trim();
    // 避免因为移除内容导致的连续多余空格
    cleanedQuery = cleanedQuery.replace(/\s+/g, ' ');

    // 切换到搜索页
    switchTab('search');

    // 如果指定了源且属于支持的源，则更新选择框
    const sourceEl = document.getElementById('search-source');
    const validSources = ['kw', 'kg', 'tx', 'wy', 'mg'];
    if (source && sourceEl && validSources.includes(source)) {
        sourceEl.value = source;
    }

    // 重置搜索范围到全网搜索
    if (typeof currentSearchScope !== 'undefined') {
        currentSearchScope = 'network';
    }

    // 设置搜索框内容
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = cleanedQuery || query; // 如果清理后为空，回退到原查询
        // 触发搜索
        doSearch();
    }
}
window.performSearch = performSearch;

let lastSearchResultList = null;
let lastSearchType = null;

function handleSearchTypeChange() {
    const typeSelect = document.getElementById('search-type');
    const sourceSelect = document.getElementById('search-source');
    if (!typeSelect || !sourceSelect) return;

    if (typeSelect.value === 'singer' || typeSelect.value === 'album') {
        // 只有 wy 和 tx 支持歌手/专辑搜索
        if (sourceSelect.value !== 'wy' && sourceSelect.value !== 'tx') {
            sourceSelect.value = 'wy';
        }
        // 禁用不支持的选项
        Array.from(sourceSelect.options).forEach(opt => {
            opt.disabled = (opt.value !== 'wy' && opt.value !== 'tx');
        });
    } else {
        Array.from(sourceSelect.options).forEach(opt => { opt.disabled = false; });
    }
    doSearch();
}
window.handleSearchTypeChange = handleSearchTypeChange;

const SOURCES = ['kw', 'kg', 'tx', 'wy', 'mg'];


//搜索歌曲
async function doSearch(page = 1, append = false, prefetch = false) {
    const typeEl = document.getElementById('search-type');
    const type = typeEl ? typeEl.value : 'song';

    // 触发搜索时隐藏联想词
    if (typeof hideSearchSuggestions === 'function') hideSearchSuggestions();

    // 新搜索开始，隐藏返回按钮并清空记录
    const backBtn = document.getElementById('search-back-btn');
    if (backBtn) backBtn.classList.add('hidden');
    lastSearchResultList = null;
    lastSearchType = null;

    // 只有在开启全新搜索（第一页且非追加模式）时才重置局部过滤状态
    if (window.ListSearch && page === 1 && !append) window.ListSearch.resetState();

    const input = document.getElementById('search-input').value.trim();
    const resultsContainer = document.getElementById('search-results');

    // Local Search Logic
    const isLibrarySearch = currentSearchScope === 'lib_artists' || currentSearchScope === 'lib_albums';
    const isLocalSongSearch = type === 'song' && (currentSearchScope === 'local_list' || currentSearchScope === 'local_all');

    if (isLibrarySearch || isLocalSongSearch) {
        if (!input) {
            if (currentSearchScope === 'lib_artists') renderLibraryArtists(window.libraryData.artists);
            else if (currentSearchScope === 'lib_albums') renderLibraryAlbums(window.libraryData.albums);
            else renderResults(viewingPlaylist);
            return;
        }

        let targets = [];
        if (currentSearchScope === 'lib_artists') targets = window.libraryData.artists;
        else if (currentSearchScope === 'lib_albums') targets = window.libraryData.albums;
        else if (currentSearchScope === 'local_list') {
            const listId = window.currentViewingListId || 'default';
            if (currentListData) {
                if (listId === 'default') targets = currentListData.defaultList;
                else if (listId === 'love') targets = currentListData.loveList;
                else {
                    const uList = currentListData.userList.find(l => l.id === listId);
                    if (uList) targets = uList.list;
                }
            }
        } else {
            if (currentListData) {
                targets = [
                    ...(currentListData.defaultList || []),
                    ...(currentListData.loveList || []),
                    ...(currentListData.userList || []).flatMap(l => l.list)
                ];
            }
        }

        const lower = input.toLowerCase();
        const filtered = targets.filter(item =>
            (item.name && item.name.toLowerCase().includes(lower)) ||
            (item.singer && item.singer.toLowerCase().includes(lower)) ||
            (item.artistName && item.artistName.toLowerCase().includes(lower)) ||
            (item.id && String(item.id).toLowerCase().includes(lower))
        );

        if (currentSearchScope === 'lib_artists') renderLibraryArtists(filtered);
        else if (currentSearchScope === 'lib_albums') renderLibraryAlbums(filtered);
        else renderResults(filtered);
        return;
    }

    // Network Search Logic
    const source = document.getElementById('search-source').value;
    //翻页步长
    const FETCH_PAGES_STEP = 1;

    // 保存到缓存
    localStorage.setItem('search-source', source);

    if (!input) {
        showInitialSearchState();
        return;
    }

    if (!append) {
        currentSearch = { name: input, source };
        currentPage = 1;
        window.currentNetworkPage = page;
        resultsContainer.innerHTML = '<div class="flex items-center justify-center h-full"><i class="fas fa-spinner fa-spin text-4xl text-emerald-500"></i></div>';
    } else {
        window.currentNetworkPage = page;
    }

    try {
        const headers = {};
        if (typeof authToken !== 'undefined' && authToken) headers['x-user-token'] = authToken;
        Object.assign(headers, getUserAuthHeaders());

        let list = [];
        if (source === 'all') {
            // Aggregate Search (Only supported for songs)
            const pageInfoEl = document.getElementById('page-info');
            if (pageInfoEl) pageInfoEl.innerText = `聚合搜索 (前20条/源)`;

            const promises = SOURCES.map(s =>
                fetch(`${API_BASE}/search?name=${encodeURIComponent(input)}&source=${s}&page=1&type=${type}`, { headers })
                    .then(res => res.json())
                    .then(data => data.map(item => ({ ...item, source: s })))
                    .catch(e => {
                        console.warn(`[聚合搜索] ${s} 源失败:`, e);
                        return [];
                    })
            );
            const results = await Promise.all(promises);
            list = results.flat();
        } else {
            // Single Source Search — 支持前端决定拉取多少页
            const res = await fetch(`${API_BASE}/search?name=${encodeURIComponent(input)}&source=${source}&type=${type}&page=${page}&pages=${FETCH_PAGES_STEP}`, { headers });

            if (!res.ok) {
                throw new Error(`搜索请求失败: ${res.status} ${res.statusText}`);
            }

            const data = await res.json();

            // 检查返回的数据是否为数组
            if (!Array.isArray(data)) {
                console.error('[Search] 后端返回非数组数据:', data);
                throw new Error(data.error || data.message || '搜索返回的数据格式错误');
            }

            list = data.map(item => ({ ...item, source }));
        }

        // song/singer/album 统一支持 append 追加翻页
        if (append && (type === 'song' || type === 'singer' || type === 'album')) {
            // [Fix] Ensure each new song has unique ID
            if (list && list.length > 0) {
                list.forEach((item, idx) => {
                    if (!item.id || item.id === 'undefined') {
                        item.id = item.songmid || item.songId || item.hash || item.copyrightId || item.mid || item.mediaMid || `temp_${Date.now()}_${idx}_append`;
                    }
                });
            }
            const existingIds = new Set((window.viewingPlaylist || []).map(item => String(item.id)));
            const newItems = list.filter(item => !existingIds.has(String(item.id)));

            if (newItems.length > 0) {
                const combinedList = [...(window.viewingPlaylist || []), ...newItems];
                if (!prefetch) currentPage++;
                if (type === 'singer') renderSingerResults(combinedList);
                else if (type === 'album') renderAlbumResults(combinedList);
                else renderResults(combinedList);
            } else {
                showInfo('没有更多搜索结果了');
            }
        } else {
            if (type === 'singer') renderSingerResults(list);
            else if (type === 'album') renderAlbumResults(list);
            else renderResults(list);
        }
    } catch (e) {
        console.error('[Search] 搜索失败:', e);
        if (append) {
            try {
                showError(`搜索追加出错: ${e.message}`);
            } catch (err) {
                showError(`搜索追加出错: ${e.message}`);
            }
        } else {
            resultsContainer.innerHTML = `<div class="text-center text-red-500 p-8">搜索出错: ${e.message}</div>`;
        }
    }
}

function changePage(delta) {
    const source = document.getElementById('search-source').value;
    if (source === 'all') {
        showInfo('聚合搜索模式暂不支持翻页');
        return;
    }
    const newPage = currentPage + delta;
    if (newPage < 1) return;
    doSearch(newPage);
}

// ========== 热搜功能 ==========
let hotSearchCache = null;
let hotSearchCacheTime = 0;
const HOT_SEARCH_CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

async function fetchHotSearch(source = 'mg') {
    // 检查缓存（必须匹配 source）
    if (hotSearchCache &&
        hotSearchCache.source === source && // Add checking source
        Date.now() - hotSearchCacheTime < HOT_SEARCH_CACHE_DURATION) {
        return hotSearchCache;
    }

    try {
        // [优化] 使用低优先级 fetch 获取热搜，避免阻塞主加载
        const res = await fetch(`${API_BASE}/hotSearch?source=${source}`, { priority: 'low' });
        if (!res.ok) {
            throw new Error(`获取热搜失败: ${res.status}`);
        }
        const data = await res.json();

        // 更新缓存
        hotSearchCache = data;
        // Ensure data also carries the source info if not present
        if (!hotSearchCache.source) hotSearchCache.source = source;

        hotSearchCacheTime = Date.now();

        return data;
    } catch (e) {
        console.error('[HotSearch] 获取热搜失败:', e);
        return null;
    }
}

function renderHotSearch(data) {
    const container = document.getElementById('search-results');
    const header = document.getElementById('search-results-header');

    // 隐藏表头
    if (header) {
        header.classList.add('hidden');
    }

    // [Fix] If limit is 0, treat as disabled and show default state
    if (!container || !data || !data.list || data.list.length === 0 || settings.hotSearchLimit === 0) {
        // 显示默认空白状态
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full t-text-muted space-y-4">
                <i class="fas fa-music text-6xl opacity-20"></i>
                <p>输入关键词开始搜索音乐</p>
            </div>
        `;
        return;
    }

    const sourceTag = getSourceTag(data.source);
    // [Fix] Correctly handle 0, do not fall back to 20 if 0 is set
    const limit = (settings.hotSearchLimit !== undefined && settings.hotSearchLimit !== null) ? settings.hotSearchLimit : 20;
    const keywords = data.list.slice(0, limit); // 使用设置的数量

    container.innerHTML = `
        <div class="hot-search-container px-4 py-8 md:p-8">
            <div class="flex items-center mb-6">
                <i class="fas fa-fire text-orange-500 text-2xl mr-3"></i>
                <h3 class="text-xl font-bold t-text-main">热门搜索</h3>
                <span class="ml-3">${sourceTag}</span>
            </div>
            <div class="hot-search-list grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-3">
                ${keywords.map((keyword, index) => `
                    <button onclick="handleHotSearchClick('${keyword.replace(/'/g, "\\'")}')" 
                            class="hot-search-item group flex items-center px-2.5 py-3 md:p-3 t-bg-panel hover:bg-emerald-50 border t-border-main hover:border-emerald-400 rounded-lg transition-all shadow-sm hover:shadow-md overflow-hidden h-14">
                        <span class="rank flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold mr-3 ${index < 3 ? 'bg-gradient-to-r from-orange-400 to-red-500 text-white' : 'bg-gray-100 text-gray-500'
        }">
                            ${index + 1}
                        </span>
                        <span class="keyword flex-1 text-left text-sm font-medium t-text-main group-hover:text-emerald-600 truncate">
                            ${keyword}
                        </span>
                        <i class="fas fa-search text-xs text-gray-300 group-hover:text-emerald-500 transition-colors ml-2"></i>
                    </button>
                `).join('')}
            </div>
            <div class="mt-6 text-center">
                <button onclick="showInitialSearchState()" 
                        class="text-sm t-text-muted hover:text-emerald-500 transition-colors">
                    <i class="fas fa-sync-alt mr-1"></i>
                    刷新热搜
                </button>
            </div>
        </div>
    `;

    // 动态检测溢出并应用滚动效果
    setTimeout(() => {
        const items = container.querySelectorAll('.hot-search-item .keyword');
        items.forEach(el => {
            if (el.scrollWidth > el.clientWidth) {
                const text = el.textContent.trim();
                el.classList.remove('truncate');
                // 使用 mask-image 实现渐变列表
                el.innerHTML = `
                    <div class="w-full overflow-hidden relative" style="mask-image: linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%); -webkit-mask-image: linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%);">
                        <div class="inline-block whitespace-nowrap animate-marquee hover-scroll-paused" style="will-change: transform;">
                             <span>${text}</span>
                             <span class="mx-8"></span>
                             <span>${text}</span>
                             <span class="mx-8"></span>
                        </div>
                    </div>
                `;
            }
        });
    }, 0);
}

function handleHotSearchClick(keyword) {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = keyword;
        doSearch();
    }
}

function showInitialSearchState() {
    const container = document.getElementById('search-results');
    const header = document.getElementById('search-results-header');

    // 隐藏表头
    if (header) {
        header.classList.add('hidden');
    }

    // 显示加载状态
    container.innerHTML = `
        <div class="flex flex-col items-center justify-center h-full t-text-muted space-y-4">
            <i class="fas fa-spinner fa-spin text-4xl text-emerald-500"></i>
            <p>正在加载热门搜索...</p>
        </div>
    `;

    // 异步获取并显示热搜
    const sourceSelect = document.getElementById('search-source');
    const source = sourceSelect ? sourceSelect.value : 'wy';

    fetchHotSearch(source).then(data => {
        renderHotSearch(data);
    }).catch(err => {
        console.error('[HotSearch] 显示热搜失败:', err);
        // 失败时显示默认状态
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full t-text-muted space-y-4">
                <i class="fas fa-music text-6xl opacity-20"></i>
                <p>输入关键词开始搜索音乐</p>
            </div>
        `;
    });
}


function getQualityTags(item) {
    const tags = [];
    // 兼容多种音质字段位置:
    // 1. types / _types (旧版/部分源)
    // 2. qualitys / _qualitys (新版/标准)
    // 3. meta.qualitys (收藏列表)
    const rawTypes = item.types || item._types ||
        item.qualitys || item._qualitys ||
        (item.meta && (item.meta.qualitys || item.meta._qualitys)) ||
        {};

    // Normalize types check
    let has320 = false;
    let hasFlac = false;
    let hasHiRes = false;
    let hasAtmos = false;
    let hasMaster = false;

    if (Array.isArray(rawTypes)) {
        const isConcrete = t => !(t && t.isPlatformQuality);
        has320 = rawTypes.some(t => t.type === '320k');
        hasFlac = rawTypes.some(t => t.type === 'flac');
        hasHiRes = rawTypes.some(t => (t.type === 'flac24bit' || t.type === 'hires') && isConcrete(t));
        hasAtmos = rawTypes.some(t => (t.type === 'atmos' || t.type === 'atmos_plus') && isConcrete(t));
        hasMaster = rawTypes.some(t => t.type === 'master' && isConcrete(t));
    } else {
        has320 = !!rawTypes['320k'];
        hasFlac = !!rawTypes['flac'];
        hasHiRes = !!(rawTypes['flac24bit'] && !rawTypes['flac24bit'].isPlatformQuality) || !!(rawTypes.hires && !rawTypes.hires.isPlatformQuality);
        hasAtmos = !!(rawTypes.atmos && !rawTypes.atmos.isPlatformQuality) || !!(rawTypes.atmos_plus && !rawTypes.atmos_plus.isPlatformQuality);
        hasMaster = !!(rawTypes.master && !rawTypes.master.isPlatformQuality);
    }

    // [New] 额外检查具体音质字段 (适用于本地歌曲或已确定音质的播放中歌曲)
    const q = item.quality || item.type;
    if (q) {
        if (q === 'master') hasMaster = true;
        else if (q === 'atmos' || q === 'atmos_plus') hasAtmos = true;
        else if (q === 'flac24bit' || q === 'hires') hasHiRes = true;
        else if (q === 'flac') hasFlac = true;
        else if (q === '320k') has320 = true;
    }

    if (hasMaster) tags.push('<span class="flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-purple border border-purple-200 dark:border-purple-500/30 transition-colors">Master</span>');
    else if (hasAtmos) tags.push('<span class="flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-blue border border-cyan-200 dark:border-cyan-500/30 transition-colors">Atmos</span>');
    else if (hasHiRes) tags.push('<span class="flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-yellow border border-yellow-200 dark:border-yellow-500/30 transition-colors">Hi-Res</span>');
    else if (hasFlac) tags.push('<span class="flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-green border border-emerald-200 dark:border-emerald-500/30 transition-colors">无损</span>');
    else if (has320) tags.push('<span class="flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-blue border border-blue-200 dark:border-blue-500/30 transition-colors">高品质</span>');

    return tags.join('');
}
window.getQualityTags = getQualityTags;

function getSourceTag(source) {
    const colors = {
        kw: 't-badge-yellow border-yellow-200 dark:border-yellow-500/30',
        kg: 't-badge-blue border-blue-200 dark:border-blue-500/30',
        tx: 't-badge-green border-green-200 dark:border-emerald-500/30',
        wy: 't-badge-red border-red-200 dark:border-red-500/30',
        mg: 't-badge-pink border-pink-200 dark:border-pink-500/30'
    };
    const names = { kw: '酷我', kg: '酷狗', tx: 'QQ', wy: '网易', mg: '咪咕' };
    const color = colors[source] || 't-bg-main t-text-muted t-border-main';
    const name = names[source] || source.toUpperCase();
    return `<span class="flex-shrink-0 px-1 py-0 rounded text-[10px] font-bold border ${color} mr-1">${name}</span>`;
}
window.getSourceTag = getSourceTag;



function renderSingerResults(list) {
    const container = document.getElementById('search-results');
    const header = document.getElementById('search-results-header');
    if (header) header.classList.add('hidden');
    // 搜索歌手时隐藏底部分页栏
    const paginationBar = document.getElementById('search-pagination-bar');
    if (paginationBar) paginationBar.classList.add('hidden');

    window.viewingPlaylist = list;

    container.innerHTML = '<div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 md:gap-4 p-3 md:p-6"></div>';
    const grid = container.querySelector('div');
    list.forEach((singer, idx) => {
        const div = document.createElement('div');
        div.className = 'group flex flex-col items-center p-2 md:p-4 rounded-2xl transition-all hover:t-bg-panel hover:shadow-md cursor-pointer border border-transparent hover:border-emerald-500/30';
        div.dataset.singerId = singer.id;
        div.dataset.singerSource = singer.source || 'wy';
        div.onclick = () => enterArtist(singer.id, singer.source || 'wy');
        const aliasHtml = singer.alias && singer.alias.length
            ? `<span class="text-[9px] md:text-[10px] t-text-muted text-center truncate w-full mt-0.5 md:mt-1">${singer.alias[0]}</span>`
            : '';
        div.innerHTML = `
            <div class="relative mb-2 md:mb-3">
                <div class="w-16 h-16 sm:w-24 sm:h-24 md:w-32 md:h-32 rounded-full overflow-hidden shadow-sm">
                    <img src="${singer.picUrl || '/music/assets/logo.svg'}"
                         onerror="this.src='/music/assets/logo.svg'"
                         class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500">
                </div>
                <button id="singer-fav-${singer.id}" class="absolute -top-1 -right-1 w-6 h-6 md:w-7 md:h-7 rounded-full flex items-center justify-center transition-all shadow-md z-10 ${isArtistFavorited(singer.id, singer.source || 'wy') ? 'bg-rose-500 text-white opacity-100' : 'bg-black/30 text-white opacity-0 group-hover:opacity-100'}"
                        title="${isArtistFavorited(singer.id, singer.source || 'wy') ? '取消收藏' : '收藏歌手'}"
                        onclick="event.stopPropagation(); (async () => { const favd = await toggleArtistFavorite('${singer.id}', '${singer.source || 'wy'}', '${singer.name.replace(/'/g, "\\'")}', '${(singer.picUrl || '').replace(/'/g, "\\'")}'); const btn = document.getElementById('singer-fav-${singer.id}'); if(btn){ btn.className = 'absolute -top-1 -right-1 w-6 h-6 md:w-7 md:h-7 rounded-full flex items-center justify-center transition-all shadow-md z-10 ' + (favd ? 'bg-rose-500 text-white opacity-100' : 'bg-black/30 text-white opacity-0 group-hover:opacity-100'); btn.title = favd ? '取消收藏' : '收藏歌手'; } })()">
                    <i class="fas fa-heart text-[10px]"></i>
                </button>
            </div>
            <span class="text-[11px] md:text-sm font-bold t-text-main text-center truncate w-full" title="${singer.name}">${singer.name}</span>
            <div class="flex flex-col items-center mt-1">
                ${aliasHtml}
                <div class="mt-1">${getSourceTag ? getSourceTag(singer.source || 'wy') : (singer.source || 'wy').toUpperCase()}</div>
            </div>
            <span class="hidden md:inline-block text-[10px] px-2 py-0.5 mt-2 rounded bg-emerald-500 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                ${singer.albumSize || 0} 专辑
            </span>
        `;
        grid.appendChild(div);
    });
}

function renderAlbumResults(list) {
    const container = document.getElementById('search-results');
    const header = document.getElementById('search-results-header');
    if (header) header.classList.add('hidden');
    // 搜索专辑时隐藏底部分页栏
    const paginationBar = document.getElementById('search-pagination-bar');
    if (paginationBar) paginationBar.classList.add('hidden');

    window.viewingPlaylist = list;

    container.innerHTML = '<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 p-6"></div>';
    const grid = container.querySelector('div');
    list.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'group flex flex-col p-3 rounded-2xl transition-all hover:t-bg-panel hover:shadow-lg cursor-pointer border border-transparent hover:border-emerald-500/20';
        div.onclick = () => enterAlbum(item.id, item.source || 'wy');
        const publishDate = item.publishTime ? new Date(item.publishTime).toLocaleDateString() : '';
        div.innerHTML = `
            <div class="aspect-square rounded-xl overflow-hidden shadow-md mb-3 relative">
                <img src="${item.picUrl || '/music/assets/logo.svg'}"
                     onerror="this.src='/music/assets/logo.svg'"
                     class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
                <button id="album-fav-${item.id}" class="absolute top-1.5 right-1.5 w-7 h-7 rounded-full flex items-center justify-center transition-all shadow-sm ${isAlbumFavorited(item.id, item.source || 'wy') ? 'bg-rose-500 text-white opacity-100' : 'bg-black/30 text-white opacity-0 group-hover:opacity-100'}"
                        title="${isAlbumFavorited(item.id, item.source || 'wy') ? '取消收藏' : '收藏专辑'}"
                        onclick="event.stopPropagation(); (async () => { const favd = await toggleAlbumFavorite('${item.id}', '${item.source || 'wy'}', '${item.name.replace(/'/g, "\\'")}', '${(item.picUrl || '').replace(/'/g, "\\'")}', '${(item.artistName || '').replace(/'/g, "\\'")}'); const btn = document.getElementById('album-fav-${item.id}'); if(btn){ btn.className = 'absolute top-1.5 right-1.5 w-7 h-7 rounded-full flex items-center justify-center transition-all shadow-sm ' + (favd ? 'bg-rose-500 text-white opacity-100' : 'bg-black/30 text-white opacity-0 group-hover:opacity-100'); btn.title = favd ? '取消收藏' : '收藏专辑'; } })()">
                    <i class="fas fa-heart text-xs"></i>
                </button>
            </div>
            <span class="text-sm font-bold t-text-main line-clamp-2 h-10 leading-5 mb-1" title="${item.name}">${item.name}</span>
            <div class="flex items-center justify-between mt-1">
                <span class="text-[10px] t-text-muted truncate flex-1">${item.artistName || '未知歌手'}</span>
                <span class="text-[10px] t-text-muted ml-2">${publishDate}</span>
            </div>
        `;
        grid.appendChild(div);
    });
}

function formatPlayCount(count) {
    if (!count) return '0';
    if (count > 100000000) return (count / 100000000).toFixed(1) + '亿';
    if (count > 10000) return (count / 10000).toFixed(1) + '万';
    return count;
}

function searchBySinger(name) {
    const input = document.getElementById('search-input');
    const type = document.getElementById('search-type');
    if (input && type) {
        input.value = name;
        type.value = 'song';
        handleSearchTypeChange();
    }
}
window.searchBySinger = searchBySinger;

let currentArtistId = null;
let currentArtistSource = 'wy';
let currentArtistInfo = null;
window.currentArtistId = null;
window.currentArtistSource = 'wy';
window.currentArtistOrder = 'hot';

async function enterArtist(id, source = 'wy', order = 'hot', tab = 'songs', isBack = false) {
    const typeEl = document.getElementById('search-type');

    // 记录返回状态 (仅当从非歌手列表进入 且 不是从子页面返回时)
    if (!isBack && document.getElementById('artist-detail-header') === null) {
        lastSearchType = typeEl ? typeEl.value : 'singer';
        lastSearchResultList = [...(window.viewingPlaylist || [])];
        currentArtistInfo = null; // 重置缓存
        window.history.pushState({ page: 'search-detail' }, '');
    }

    const previousArtistOrder = window.currentArtistOrder || 'hot';
    const isDifferentArtist = String(currentArtistId || '') !== String(id) || currentArtistSource !== source;
    const isDifferentOrder = previousArtistOrder !== order;
    if (isDifferentArtist || (tab === 'songs' && isDifferentOrder)) {
        window.currentArtistSongsCache = null;
        window.artistSongsPage = 1;
        if (window.ListSearch) window.ListSearch.resetState();
    }
    if (isDifferentArtist) {
        window.currentArtistAlbumsCache = null;
    }

    currentArtistId = id;
    currentArtistSource = source;
    window.currentArtistId = id;
    window.currentArtistSource = source;
    window.currentArtistOrder = order;
    window.currentArtistTab = tab;
    const resultsContainer = document.getElementById('search-results');
    const header = document.getElementById('search-results-header');
    if (header) header.classList.add('hidden');

    // 只有在没有缓存或者 ID 变化时才获取详情
    if (!currentArtistInfo || String(currentArtistInfo.id) !== String(id) || currentArtistInfo.source !== source) {
        // 如果还没有头部，显示加载
        if (!document.getElementById('artist-detail-header')) {
            resultsContainer.innerHTML = '<div class="flex items-center justify-center h-full"><i class="fas fa-spinner fa-spin text-4xl text-emerald-500"></i></div>';
        }

        try {
            const detailRes = await fetch(`${API_BASE}/artistDetail?id=${id}&source=${source}`);
            if (!detailRes.ok) throw new Error('Failed to fetch artist detail');
            currentArtistInfo = await detailRes.json();
        } catch (e) {
            showError(`获取歌手详情失败: ${e.message}`);
            goBackToSearch();
            return;
        }
    }

    // 渲染头部
    renderArtistHeader(currentArtistInfo, tab, order);

    // 加载具体内容
    if (tab === 'songs') {
        await loadArtistSongs(id, source, order);
    } else if (tab === 'albums') {
        await loadArtistAlbums(id, source);
    }

    const backBtn = document.getElementById('search-back-btn');
    if (backBtn) backBtn.classList.remove('hidden');
}

let isArtistFolded = false;

function renderArtistHeader(info, activeTab, order) {
    const container = document.getElementById('search-results');
    const isMobile = window.innerWidth < 768;

    // 计算各状态下的样式类和内联样式，确保与 toggleArtistFold 完全一致
    const headerPadding = isArtistFolded ? 'p-3 md:p-4' : 'p-6 md:p-8';
    const nameTransform = isArtistFolded
        ? (isMobile ? 'translate(40px, -30px) scale(0.65)' : 'translate(30px, 0px) scale(0.65)')
        : 'translate(0, 0) scale(1)';
    const tabsClass = isArtistFolded ? 'mt-1 pt-2' : 'mt-8 pt-6';

    let headerHtml = `
        <div id="artist-detail-header" class="relative ${headerPadding} is-folded t-bg-panel/50 border-b t-border-main transition-all duration-500 ease-in-out overflow-hidden group/header" style="${isArtistFolded ? 'min-height: ' + (isMobile ? '0px' : '90px') + ';' : ''}">
            <!-- Small Absolute Back Button -->
            <button onclick="goBackToSearch()" class="absolute top-2 left-2 md:top-4 md:left-4 w-8 h-8 md:w-10 md:h-10 flex items-center justify-center rounded-full bg-emerald-500/80 hover:bg-emerald-500 text-white transition-all z-30 shadow-md active:scale-90" title="返回搜索">
                <i class="fas fa-arrow-left"></i>
            </button>
            <!-- Favorite Button (Artist) -->
            <button id="artist-header-fav-btn"
                onclick="(async () => { 
                    const favd = await toggleArtistFavorite('${info.id}', '${info.source}', '${info.name.replace(/'/g, "\\'")}', '${(info.avatar || '').replace(/'/g, "\\'")}'); 
                    const btn = document.getElementById('artist-header-fav-btn'); 
                    if(btn){ 
                        const base = 'absolute top-2 right-12 md:top-4 md:right-16 w-8 h-8 md:w-10 md:h-10 flex items-center justify-center rounded-full transition-all z-30 shadow-sm active:scale-90';
                        const favedCls = 'bg-rose-500 text-white';
                        const normalCls = 'bg-black/10 hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/20 t-text-main';
                        btn.className = base + ' ' + (favd ? favedCls : normalCls);
                        btn.title = favd ? '取消收藏' : '收藏歌手';
                    } 
                })()"
                class="absolute top-2 right-12 md:top-4 md:right-16 w-8 h-8 md:w-10 md:h-10 flex items-center justify-center rounded-full ${isArtistFavorited(info.id, info.source) ? 'bg-rose-500 text-white' : 'bg-black/10 hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/20 t-text-main'} transition-all z-30 shadow-sm active:scale-90"
                title="${isArtistFavorited(info.id, info.source) ? '取消收藏' : '收藏歌手'}">
                <i class="fas fa-heart"></i>
            </button>

            <!-- Fold Toggle Button -->
            <button id="artist-fold-btn" onclick="toggleArtistFold()" class="absolute top-2 right-2 md:top-4 md:right-4 w-8 h-8 md:w-10 md:h-10 flex items-center justify-center rounded-full bg-black/10 hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/20 t-text-main transition-all z-30 shadow-sm active:scale-90" title="折叠/展开">
                <i class="fas fa-chevron-up transition-transform duration-500 ${isArtistFolded ? 'rotate-180' : ''}" id="artist-fold-icon"></i>
            </button>

            <div id="artist-main-layout" class="flex flex-col md:flex-row gap-6 md:gap-8 ${isArtistFolded && isMobile ? 'items-start text-left' : 'items-center md:items-start text-center md:text-left'} transition-all duration-500">
                <div id="artist-avatar-container" class="w-32 h-32 md:w-40 md:h-40 rounded-full overflow-hidden shadow-2xl ring-4 ring-emerald-500/20 flex-shrink-0 transition-all duration-500 origin-center" style="${isArtistFolded ? 'transform: scale(0); opacity: 0; width: 0; height: 0; margin: 0;' : ''}">
                    <img src="${info.avatar || '/music/assets/logo.svg'}" 
                         onerror="this.src='/music/assets/logo.svg'"
                         class="w-full h-full object-cover">
                </div>
                <div class="flex-1 min-w-0">
                    <h2 id="artist-name-display" class="text-3xl md:text-4xl font-black t-text-main mb-2 transition-all duration-500 origin-left pointer-events-none" style="transform: ${nameTransform}; margin-bottom: ${isArtistFolded ? '0' : ''};">${info.name}</h2>
                    <div id="artist-collapsible-section" class="transition-all duration-500 ${isArtistFolded ? 'opacity-0 max-h-0' : 'opacity-100 max-h-[500px]'}">
                        <div id="artist-stats-bar" class="flex flex-wrap justify-center md:justify-start gap-3 mb-3 text-sm font-medium transition-all duration-500">
                            <span class="px-3 py-1 rounded-full t-bg-main t-text-muted border t-border-main">
                                <i class="fas fa-music mr-1.5 text-emerald-500"></i>${info.musicSize} 歌曲
                            </span>
                            <span class="px-3 py-1 rounded-full t-bg-main t-text-muted border t-border-main">
                                <i class="fas fa-compact-disc mr-1.5 text-blue-500"></i>${info.albumSize} 专辑
                            </span>
                        </div>
                        <div class="relative group">
                            <p id="artist-bio-text" class="text-sm t-text-muted leading-relaxed line-clamp-3 overflow-y-auto max-h-32 transition-all cursor-pointer bg-black/5 dark:bg-white/5 p-3 rounded-lg custom-scrollbar" 
                            onclick="this.classList.toggle('line-clamp-3')" title="点击展开/收回详情">
                                ${info.desc || '暂无简介'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
            
            <div id="artist-tabs-bar" class="flex items-end justify-between ${tabsClass} border-t t-border-main transition-all duration-500 relative z-40" style="min-height: 48px;">
                <div class="flex gap-8">
                    <button onclick="enterArtist('${info.id}', '${info.source}', '${order}', 'songs')" 
                            class="pb-2 text-sm font-bold transition-all relative ${activeTab === 'songs' ? 't-text-main' : 't-text-muted hover:t-text-main'}">
                        所有歌曲
                        ${activeTab === 'songs' ? '<div class="absolute bottom-0 left-0 right-0 h-1 bg-emerald-500 rounded-full"></div>' : ''}
                    </button>
                    <button onclick="enterArtist('${info.id}', '${info.source}', '${order}', 'albums')" 
                            class="pb-2 text-sm font-bold transition-all relative ${activeTab === 'albums' ? 't-text-main' : 't-text-muted hover:t-text-main'}">
                        所有专辑
                        ${activeTab === 'albums' ? '<div class="absolute bottom-0 left-0 right-0 h-1 bg-emerald-500 rounded-full"></div>' : ''}
                    </button>
                </div>
                
                ${activeTab === 'songs' ? `
                <div class="flex p-1 mb-1 t-bg-main rounded-lg border t-border-main shadow-sm relative z-50">
                    <button onclick="enterArtist('${info.id}', '${info.source}', 'hot', 'songs')" 
                            class="px-4 py-1.5 text-xs font-bold rounded-md transition-all ${order === 'hot' ? 'bg-emerald-500 text-white shadow-sm' : 't-text-muted hover:t-bg-track'}">
                        热门
                    </button>
                    <button onclick="enterArtist('${info.id}', '${info.source}', 'time', 'songs')" 
                            class="px-4 py-1.5 text-xs font-bold rounded-md transition-all ${order === 'time' ? 'bg-emerald-500 text-white shadow-sm' : 't-text-muted hover:t-bg-track'}">
                        最新
                    </button>
                </div>
                ` : ''}
            </div>
        </div>
        <div id="artist-detail-content" class="flex-1 overflow-y-auto p-2 md:p-4">
            <div class="flex items-center justify-center py-10">
                <i class="fas fa-spinner fa-spin text-2xl text-emerald-500"></i>
            </div>
        </div>
    `;
    container.innerHTML = headerHtml;
}

function toggleArtistFold() {
    const header = document.getElementById('artist-detail-header');
    const avatar = document.getElementById('artist-avatar-container');
    const collapsible = document.getElementById('artist-collapsible-section');
    const name = document.getElementById('artist-name-display');
    const tabsBar = document.getElementById('artist-tabs-bar');
    const foldIcon = document.getElementById('artist-fold-icon');
    const mainLayout = document.getElementById('artist-main-layout');

    if (!header) return;

    isArtistFolded = header.classList.toggle('is-folded');
    const isMobile = window.innerWidth < 768;

    if (isArtistFolded) {
        // 折叠状态
        header.classList.remove('p-6', 'md:p-8');
        header.classList.add('p-3', 'md:p-4');
        header.style.minHeight = isMobile ? '0px' : '90px';

        // 手机版强制左对齐，方便定位到返回键右侧
        if (isMobile) {
            mainLayout.classList.remove('items-center', 'text-center');
            mainLayout.classList.add('items-start', 'text-left');
        }

        avatar.style.transform = 'scale(0)';
        avatar.style.opacity = '0';
        avatar.style.width = '0';
        avatar.style.height = '0';
        avatar.style.margin = '0';

        collapsible.style.maxHeight = '0';
        collapsible.style.opacity = '0';
        collapsible.style.marginTop = '0';

        tabsBar.classList.remove('mt-8', 'pt-6');
        tabsBar.classList.add('mt-1', 'pt-2');

        // 响应式偏移
        if (isMobile) {
            name.style.transform = 'translate(40px, -30px) scale(0.65)';
        } else {
            name.style.transform = 'translate(30px, 0px) scale(0.65)';
        }
        name.style.marginBottom = '0';

        foldIcon.style.transform = 'rotate(180deg)';
    } else {
        // 展开状态
        header.classList.add('p-6', 'md:p-8');
        header.classList.remove('p-3', 'md:p-4');
        header.style.minHeight = '';

        if (isMobile) {
            mainLayout.classList.add('items-center', 'text-center');
            mainLayout.classList.remove('items-start', 'text-left');
        }

        avatar.style.transform = 'scale(1)';
        avatar.style.opacity = '1';
        avatar.style.width = '';
        avatar.style.height = '';
        avatar.style.margin = '';

        collapsible.style.maxHeight = '500px';
        collapsible.style.opacity = '1';
        collapsible.style.marginTop = '';

        tabsBar.classList.add('mt-8', 'pt-6');
        tabsBar.classList.remove('mt-1', 'pt-2');

        name.style.transform = 'translate(0, 0) scale(1)';
        name.style.marginBottom = '';

        foldIcon.style.transform = 'rotate(0deg)';
    }
}
window.toggleArtistFold = toggleArtistFold;

async function loadArtistSongs(id, source, order, forceFetch = false) {
    // Check if we can use cache to speed up UI transitions (like batch mode toggle)
    if (!forceFetch && window.currentArtistSongsCache && window.currentArtistId === id && window.currentArtistOrder === order && window.currentArtistSource === source) {
        renderArtistSongsUI(window.currentArtistSongsCache);
        return;
    }

    renderArtistSongsLoading();

    try {
        const res = await fetch(`${API_BASE}/artistSongs?id=${id}&source=${source}&order=${order}`);
        if (!res.ok) throw new Error('Failed to fetch songs');
        const list = await res.json();

        const isCurrentRequest = String(window.currentArtistId) === String(id)
            && window.currentArtistSource === source
            && window.currentArtistOrder === order
            && window.currentArtistTab === 'songs';
        if (!isCurrentRequest) return;

        // [Fix] 唯一 ID
        list.forEach((item, idx) => {
            if (!item.id || item.id === 'undefined') {
                item.id = item.songmid || item.songId || item.hash || item.copyrightId || item.mid || item.mediaMid || `art_${id}_${idx}`;
            }
        });

        // 缓存当前结果
        window.currentArtistSongsCache = list;
        window.currentArtistId = id;
        window.currentArtistSource = source;
        window.currentArtistOrder = order;
        window.artistSongsPage = 1; // 重置到第1页

        renderArtistSongsUI(list, 1);
    } catch (e) {
        showError(`加载歌曲失败: ${e.message}`);
        goBackToSearch();
    }
}

function renderArtistSongsLoading() {
    const content = document.getElementById('artist-detail-content');
    if (!content) return;
    window.viewingPlaylist = [];
    content.innerHTML = `
        <div class="flex items-center justify-center py-12 t-text-muted">
            <i class="fas fa-spinner fa-spin text-2xl text-emerald-500 mr-3"></i>
            <span class="text-sm font-medium">正在加载歌曲...</span>
        </div>
    `;
}

function renderArtistSongsUI(list, page) {
    const content = document.getElementById('artist-detail-content');
    if (!content) return;

    window.viewingPlaylist = list;

    if (!list || list.length === 0) {
        content.innerHTML = '<div class="text-center py-10 t-text-muted">暂无歌曲</div>';
        return;
    }

    // 前端分页逻辑
    const totalItems = list.length;
    let itemsPerPage = (settings && settings.itemsPerPage === 'all') ? totalItems : parseInt((settings && settings.itemsPerPage) || 20);
    if (!itemsPerPage || itemsPerPage <= 0) itemsPerPage = 20;
    const totalPages = Math.ceil(totalItems / itemsPerPage);

    // 使用传入的 page 或者全局 artistSongsPage，默认第1页
    if (page !== undefined) window.artistSongsPage = page;
    if (!window.artistSongsPage || window.artistSongsPage < 1) window.artistSongsPage = 1;
    if (window.artistSongsPage > totalPages) window.artistSongsPage = totalPages;

    const currentPage = window.artistSongsPage;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);

    // Apply filtering logic from ListSearch
    const fullIndexedList = window.ListSearch ? window.ListSearch.getDisplayList(list) : list.map((item, index) => ({ item, originalIndex: index }));
    const indexedDisplayList = fullIndexedList.slice(startIndex, endIndex);

    let html = `
        <!-- 表头 -->
        <div class="grid grid-cols-12 gap-2 md:gap-4 p-3 md:p-4 border-b t-border-main t-bg-main text-gray-500 text-sm font-medium sticky top-0 z-10 rounded-t-2xl overflow-hidden shadow-sm">
            <div class="col-span-3 sm:col-span-1 text-center flex items-center justify-center gap-1 sm:gap-2">
                <span>#</span>
                <div class="flex items-center gap-1">
                    <button onclick="toggleBatchMode()"
                        class="text-[10px] text-emerald-600 hover:text-emerald-700" title="批量操作">
                        <i class="fas fa-tasks"></i>
                    </button>
                    <button onclick="window.ListSearch.toggleBar()"
                        class="text-[10px] text-emerald-600 hover:text-emerald-700" title="内搜索 (/)">
                        <i class="fas fa-search"></i>
                    </button>
                </div>
            </div>
            <div class="col-span-7 sm:col-span-7 md:col-span-6 lg:col-span-4">歌曲标题</div>
            <div class="hidden sm:block sm:col-span-3 md:col-span-3 lg:col-span-3 text-right md:text-left">歌手</div>
            <div class="hidden lg:block lg:col-span-2">专辑</div>
            <div class="hidden md:block md:col-span-1 text-center md:text-left">时长</div>
            <div class="hidden sm:block sm:col-span-1 text-right">操作</div>
            <div class="col-span-2 sm:hidden text-right">操作</div>
        </div>
        
        <div class="space-y-1 mt-2">
            ${indexedDisplayList.map((obj) => {
        const { item, originalIndex: index } = obj;
        const isSelected = window.selectedItems.has(String(item.id));
        const isMatched = window.ListSearch && window.ListSearch.isMatched(index);
        const isCurrentMatch = window.ListSearch && window.ListSearch.isCurrentMatch(index);

        let rowClass = 'grid grid-cols-12 gap-2 md:gap-4 p-3 rounded-xl hover:t-bg-panel transition-all group cursor-pointer border border-transparent ';
        if (isCurrentMatch) rowClass += 'search-current ';
        else if (isMatched) rowClass += 'search-match ';
        if (isSelected) rowClass += 'row-selected ring-1 ring-emerald-500/30 ';

        return `
                <div class="${rowClass}" data-song-id="${item.id}" onclick="window.batchMode ? handleBatchSelect('${item.id}', !window.selectedItems.has('${item.id}')) : playFromView(${index})">
                    <!-- Index -->
                    <div class="col-span-1 sm:col-span-1 text-center flex items-center justify-center font-mono text-xs t-text-muted group-hover:t-text-main">
                        ${window.batchMode ? `
                            <input type="checkbox" 
                                   class="batch-checkbox w-4 h-4 text-emerald-600 rounded" 
                                   data-song-id="${item.id}"
                                   ${isSelected ? 'checked' : ''}
                            onclick="event.stopPropagation(); handleBatchSelect('${String(item.id)}', this.checked);">
                        ` : `<span class="index-num group-hover:hidden">${index + 1}</span><i class="fas fa-play text-emerald-500 hidden group-hover:block text-[10px]"></i>`}
                    </div>

                    <!-- Title -->
                    <div class="col-span-9 sm:col-span-7 md:col-span-6 lg:col-span-4 flex items-center gap-3 min-w-0">
                        <div class="w-10 h-10 md:w-12 md:h-12 rounded-lg overflow-hidden flex-shrink-0 shadow-sm relative">
                            <img src="${item.img || '/music/assets/logo.svg'}" 
                                 onerror="this.src='/music/assets/logo.svg'" 
                                 class="w-full h-full object-cover">
                            <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <i class="fas fa-play text-white text-xs"></i>
                            </div>
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="font-bold t-text-main text-sm md:text-base leading-tight truncate group-hover:text-emerald-600 transition-colors">${item.name}</div>
                            <div class="flex items-center gap-1 mt-1">
                                ${getSourceTag ? getSourceTag(item.source) : ''}
                                ${getQualityTags ? getQualityTags(item) : ''}
                            </div>
                        </div>
                    </div>

                    <!-- Artist -->
                    <div class="hidden sm:flex sm:col-span-3 md:col-span-3 lg:col-span-3 text-sm t-text-muted items-center truncate">
                        ${item.singer}
                    </div>

                    <!-- Album -->
                    <div class="hidden lg:flex lg:col-span-2 text-sm t-text-muted items-center truncate">
                        ${item.albumName || '-'}
                    </div>

                    <!-- Duration -->
                    <div class="hidden md:flex md:col-span-1 items-center justify-center text-xs font-mono t-text-muted">
                        ${item.interval || '--:--'}
                    </div>

                    <!-- Actions -->
                    <div class="col-span-2 sm:col-span-1 flex items-center justify-end gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                        <button class="p-0.5 sm:p-1.5 hover:bg-emerald-50 rounded-lg text-emerald-600 transition-colors" title="播放" onclick="event.stopPropagation(); playFromView(${index})">
                            <i class="fas fa-play w-3.5 h-3.5"></i>
                        </button>
                        <button class="p-0.5 sm:p-1.5 hover:bg-blue-50 rounded-lg text-blue-600 transition-colors" title="下载" onclick="event.stopPropagation(); downloadSong(${JSON.stringify(item).replace(/"/g, '&quot;')})">
                            <i class="fas fa-download w-3.5 h-3.5"></i>
                        </button>
                        <button class="p-0.5 sm:p-1.5 hover:bg-emerald-50 rounded-lg text-emerald-500 transition-colors" title="添加到歌单" onclick="event.stopPropagation(); openPlaylistAddModalForSong(${index})">
                            <i class="fas fa-plus w-3.5 h-3.5"></i>
                        </button>
                    </div>
                </div>
            `;
    }).join('')}
        </div>

        <!-- 歌手详情内部分页控件 -->
        <div class="mt-2 flex-shrink-0 flex items-center justify-center gap-2 md:gap-4">
            <button onclick="artistSongsFirstPage()" title="首页"
                class="text-gray-500 hover:text-emerald-600 disabled:opacity-30 transition-colors ${currentPage <= 1 ? 'opacity-30 pointer-events-none' : ''}">
                <i class="fas fa-angles-left"></i><span class="hidden md:inline ml-1">首页</span>
            </button>
            <button onclick="artistSongsPrevPage()"
                class="text-gray-500 hover:text-emerald-600 disabled:opacity-30 transition-colors ${currentPage <= 1 ? 'opacity-30 pointer-events-none' : ''}">
                <i class="fas fa-chevron-left"></i> 上一页
            </button>
            <span class="text-xs t-text-muted font-mono">显示 ${startIndex + 1}-${endIndex} 首，共 ${totalItems} 首</span>
            <button onclick="artistSongsNextPage()"
                class="text-gray-500 hover:text-emerald-600 disabled:opacity-30 transition-colors ${currentPage >= totalPages ? 'opacity-30 pointer-events-none' : ''}">
                下一页 <i class="fas fa-chevron-right"></i>
            </button>
            <button onclick="artistSongsLastPage()" title="末页"
                class="text-gray-500 hover:text-emerald-600 disabled:opacity-30 transition-colors ${currentPage >= totalPages ? 'opacity-30 pointer-events-none' : ''}">
                <span class="hidden md:inline mr-1">末页</span><i class="fas fa-angles-right"></i>
            </button>
        </div>
    `;
    content.innerHTML = html;

    // Init Marquee if needed (though we use truncate here)
    if (window.applyMarqueeChecks) applyMarqueeChecks();
}
window.renderArtistSongsUI = renderArtistSongsUI;

// 歌手详情页内部翻页函数
function artistSongsPrevPage() {
    const list = window.currentArtistSongsCache;
    if (!list) return;
    if (!window.artistSongsPage || window.artistSongsPage <= 1) return;
    renderArtistSongsUI(list, window.artistSongsPage - 1);
}
function artistSongsFirstPage() {
    const list = window.currentArtistSongsCache;
    if (list && (window.artistSongsPage || 1) !== 1) renderArtistSongsUI(list, 1);
}
function artistSongsNextPage() {
    const list = window.currentArtistSongsCache;
    if (!list) return;
    const totalItems = list.length;
    let itemsPerPage = (settings && settings.itemsPerPage === 'all') ? totalItems : parseInt((settings && settings.itemsPerPage) || 20);
    if (!itemsPerPage || itemsPerPage <= 0) itemsPerPage = 20;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    if ((window.artistSongsPage || 1) >= totalPages) return;
    renderArtistSongsUI(list, (window.artistSongsPage || 1) + 1);
}
function artistSongsLastPage() {
    const list = window.currentArtistSongsCache;
    if (!list) return;
    const totalItems = list.length;
    let itemsPerPage = (settings && settings.itemsPerPage === 'all') ? totalItems : parseInt((settings && settings.itemsPerPage) || 20);
    if (!itemsPerPage || itemsPerPage <= 0) itemsPerPage = 20;
    renderArtistSongsUI(list, Math.max(1, Math.ceil(totalItems / itemsPerPage)));
}
window.artistSongsPrevPage = artistSongsPrevPage;
window.artistSongsNextPage = artistSongsNextPage;
window.artistSongsFirstPage = artistSongsFirstPage;
window.artistSongsLastPage = artistSongsLastPage;

const ARTIST_ALBUM_PAGE_SIZE = 50;
const ARTIST_ALBUM_MAX_PAGES = 100;

function renderArtistAlbumsLoading(loaded = 0, total = 0) {
    const content = document.getElementById('artist-detail-content');
    if (!content) return;
    const progressText = loaded > 0
        ? '正在加载全部专辑，已读取 ' + loaded + (total > 0 ? '/' + total : '') + ' 张...'
        : '正在加载全部专辑...';
    const wrapper = document.createElement('div');
    const icon = document.createElement('i');
    const label = document.createElement('span');
    wrapper.className = 'flex items-center justify-center py-12 t-text-muted';
    icon.className = 'fas fa-spinner fa-spin text-2xl text-emerald-500 mr-3';
    label.className = 'text-sm font-medium';
    label.textContent = progressText;
    wrapper.append(icon, label);
    content.replaceChildren(wrapper);
}

async function fetchAllArtistAlbums(id, source, signal, onProgress) {
    const albums = [];
    const albumKeys = new Set();
    let total = 0;

    for (let page = 1; page <= ARTIST_ALBUM_MAX_PAGES; page++) {
        const query = new URLSearchParams({ id: String(id), source, page: String(page) });
        const res = await fetch(API_BASE + '/artistAlbums?' + query.toString(), { signal });
        if (!res.ok) throw new Error('Failed to fetch artist albums page ' + page);

        const data = await res.json();
        const pageList = Array.isArray(data.list) ? data.list : [];
        const previousCount = albums.length;
        total = Math.max(total, Number(data.total) || 0);

        pageList.forEach((album, index) => {
            const albumId = album.id ?? album.mid;
            const key = albumId !== undefined && albumId !== null && albumId !== ''
                ? source + ':' + albumId
                : source + ':page:' + page + ':index:' + index;
            if (albumKeys.has(key)) return;
            albumKeys.add(key);
            albums.push({ ...album, source: album.source || source });
        });

        if (typeof onProgress === 'function') onProgress(albums.length, total);

        const reachedTotal = total > 0 && albums.length >= total;
        const pageExhausted = pageList.length < ARTIST_ALBUM_PAGE_SIZE;
        const noNewAlbums = albums.length === previousCount;
        if (pageList.length === 0 || reachedTotal || pageExhausted || noNewAlbums) break;
    }

    return { list: albums, total: total || albums.length };
}



async function loadArtistAlbums(id, source, forceFetch = false) {
    if (!forceFetch && window.currentArtistAlbumsCache && String(window.currentArtistId) === String(id) && window.currentArtistSource === source) {
        renderArtistAlbumsUI(window.currentArtistAlbumsCache);
        return;
    }

    renderArtistAlbumsLoading();

    try {
        const data = await fetchAllArtistAlbums(id, source, undefined, (loaded, total) => {
            const stillViewingArtist = String(window.currentArtistId) === String(id) && window.currentArtistSource === source;
            if (window.currentArtistTab === 'albums' && stillViewingArtist) {
                renderArtistAlbumsLoading(loaded, total);
            }
        });
        const list = data.list;
        const stillViewingArtist = String(window.currentArtistId) === String(id) && window.currentArtistSource === source;
        if (!stillViewingArtist) return;

        window.currentArtistAlbumsCache = list;
        window.currentArtistAlbumsTotal = data.total;

        if (window.currentArtistTab === 'albums') {
            renderArtistAlbumsUI(list);
        }
    } catch (e) {
        const stillViewingArtist = String(window.currentArtistId) === String(id) && window.currentArtistSource === source;
        if (stillViewingArtist) {
            showError(`加载专辑失败: ${e.message}`);
            goBackToSearch();
        } else {
            console.warn('[ArtistAlbums] 已离开歌手页，忽略专辑加载失败:', e);
        }
    }
}

function renderArtistAlbumsUI(list) {
    const content = document.getElementById('artist-detail-content');
    if (!content) return;

    if (!list || list.length === 0) {
        content.innerHTML = '<div class="text-center py-10 t-text-muted">暂无专辑</div>';
        return;
    }

    const artistName = currentArtistInfo?.name || '';
    const html = `
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6 p-2 md:p-4 animate-in fade-in duration-300">
            ${list.map((album, index) => {
        const albumId = album.id ?? album.mid;
        const albumSource = album.source || window.currentArtistSource || 'wy';
        const albumName = album.name || '未知专辑';
        const favorited = isAlbumFavorited(albumId, albumSource);
        return `
                <div class="artist-album-card group flex flex-col p-3 rounded-2xl transition-all hover:t-bg-panel hover:shadow-lg cursor-pointer border border-transparent hover:border-emerald-500/20" data-album-index="${index}">
                    <div class="aspect-square rounded-xl overflow-hidden shadow-md mb-3 relative bg-gray-100 dark:bg-gray-800">
                        <img src="${escapeHtmlText(getImgUrl(album))}"
                             onerror="this.src='/music/assets/logo.svg'" 
                             class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
                        <div class="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                             <div class="w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-lg transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
                                <i class="fas fa-play"></i>
                             </div>
                        </div>
                        <div class="absolute top-1.5 right-1.5 flex gap-1.5">
                            <button type="button" class="artist-album-download-btn w-8 h-8 rounded-full bg-black/45 hover:bg-emerald-500 text-white flex items-center justify-center opacity-100 sm:opacity-0 group-hover:opacity-100 transition-all shadow-sm disabled:opacity-60 disabled:cursor-wait" data-album-index="${index}" title="下载本专辑全部歌曲">
                                <i class="fas fa-download text-xs"></i>
                            </button>
                            <button type="button" class="artist-album-favorite-btn w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-sm ${favorited ? 'bg-rose-500 text-white opacity-100' : 'bg-black/45 hover:bg-rose-500 text-white opacity-100 sm:opacity-0 group-hover:opacity-100'}" data-album-index="${index}" title="${favorited ? '取消收藏' : '收藏专辑'}">
                                <i class="fas fa-heart text-xs"></i>
                            </button>
                        </div>
                    </div>
                    <span class="text-sm font-bold t-text-main line-clamp-2 h-10 leading-5 mb-1 group-hover:text-emerald-600 transition-colors" title="${escapeHtmlText(albumName)}">${escapeHtmlText(albumName)}</span>
                    <div class="flex items-center justify-between mt-1">
                        <span class="text-[10px] t-text-muted">${escapeHtmlText(album.publishTime || '')}</span>
                        <span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 font-bold">${album.total ?? album.count ?? album.size ?? album.songCount ?? 0} 首</span>
                    </div>
                </div>
            `;
    }).join('')}
        </div>
    `;
    content.innerHTML = html;

    content.querySelectorAll('.artist-album-card').forEach(card => {
        card.addEventListener('click', () => {
            const album = list[Number(card.dataset.albumIndex)];
            if (album) enterAlbum(album.id ?? album.mid, album.source || window.currentArtistSource || 'wy');
        });
    });
    content.querySelectorAll('.artist-album-download-btn').forEach(button => {
        button.addEventListener('click', async event => {
            event.stopPropagation();
            const album = list[Number(button.dataset.albumIndex)];
            if (album) await downloadArtistAlbumSongs(album, button);
        });
    });
    content.querySelectorAll('.artist-album-favorite-btn').forEach(button => {
        button.addEventListener('click', async event => {
            event.stopPropagation();
            const album = list[Number(button.dataset.albumIndex)];
            if (!album) return;
            const albumId = album.id ?? album.mid;
            const albumSource = album.source || window.currentArtistSource || 'wy';
            const favorited = await toggleAlbumFavorite(albumId, albumSource, album.name || '未知专辑', getImgUrl(album), album.artistName || album.singer || artistName);
            button.className = 'artist-album-favorite-btn w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-sm ' + (favorited ? 'bg-rose-500 text-white opacity-100' : 'bg-black/45 hover:bg-rose-500 text-white opacity-100 sm:opacity-0 group-hover:opacity-100');
            button.title = favorited ? '取消收藏' : '收藏专辑';
        });
    });
}
window.renderArtistAlbumsUI = renderArtistAlbumsUI;

async function downloadArtistAlbumSongs(album, button) {
    if (typeof window.batchDownloadSongs !== 'function') {
        showError('批量下载功能未就绪');
        return;
    }

    const albumId = album.id ?? album.mid;
    const albumSource = album.source || window.currentArtistSource || 'wy';
    const albumName = album.name || '未知专辑';
    if (albumId === undefined || albumId === null || albumId === '') {
        showError(`专辑「${albumName}」缺少有效 ID，无法下载`);
        return;
    }
    const icon = button?.querySelector('i');
    if (button) button.disabled = true;
    if (icon) icon.className = 'fas fa-spinner fa-spin text-xs';

    try {
        const query = new URLSearchParams({ id: String(albumId), source: albumSource });
        const res = await fetch(API_BASE + '/albumSongs?' + query.toString());
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const rawSongs = Array.isArray(data.list) ? data.list : (Array.isArray(data) ? data : []);
        if (rawSongs.length === 0) {
            showError(`专辑「${albumName}」没有可下载的歌曲`);
            return;
        }

        const songs = rawSongs.map(song => ({
            ...song,
            source: song.source || albumSource,
            albumName: song.albumName || albumName,
            meta: {
                ...(song.meta || {}),
                albumId: song.meta?.albumId || song.albumId || albumId,
                albumName: song.meta?.albumName || albumName
            }
        }));
        await window.batchDownloadSongs(songs, {
            clearSelection: false,
            selectionLabel: `专辑「${albumName}」共 ${songs.length} 首歌曲`
        });
    } catch (e) {
        console.error('[ArtistAlbums] 读取专辑歌曲失败:', albumName, e);
        showError(`读取专辑「${albumName}」失败: ${e.message}`);
    } finally {
        if (button) button.disabled = false;
        if (icon) icon.className = 'fas fa-download text-xs';
    }
}
window.downloadArtistAlbumSongs = downloadArtistAlbumSongs;

async function enterAlbum(id, source = 'wy') {
    // 保存进入专辑前的上下文，如果是从歌手页进入，则记录歌手 ID
    const artistHeader = document.getElementById('artist-detail-header');
    if (artistHeader) {
        window.tempArtistContext = {
            id: window.currentArtistId,
            source: window.currentArtistSource,
            tab: window.currentArtistTab || 'albums',
            order: window.currentArtistOrder || 'hot'
        };
        artistHeader.remove(); // 进入专辑详情时移除歌手头部，保持界面整洁
    } else {
        window.tempArtistContext = null;
    }

    const typeEl = document.getElementById('search-type');
    if (!artistHeader) {
        lastSearchType = typeEl ? typeEl.value : 'album';
        lastSearchResultList = [...(window.viewingPlaylist || [])];
    }
    window.history.pushState({ page: 'search-detail' }, '');

    const resultsContainer = document.getElementById('search-results');
    resultsContainer.innerHTML = '<div class="flex items-center justify-center h-full"><i class="fas fa-spinner fa-spin text-4xl text-emerald-500"></i></div>';

    try {
        const res = await fetch(`${API_BASE}/albumSongs?id=${id}&source=${source}`);
        if (!res.ok) throw new Error('Failed to fetch album songs');
        const data = await res.json();
        const songList = data.list || (Array.isArray(data) ? data : []);
        renderResults(songList);
        const pageInfoEl = document.getElementById('page-info');
        if (pageInfoEl) pageInfoEl.innerText = `专辑歌曲列表`;

        // [新增] 如果该专辑已收藏，则异步丰富其元数据
        if (isAlbumFavorited(id, source)) {
            updateAlbumLibraryMeta(id, source, data);
        }

        const backBtn = document.getElementById('search-back-btn');
        if (backBtn) backBtn.classList.remove('hidden');
    } catch (e) {
        showError(`获取专辑歌曲失败: ${e.message}`);
        goBackToSearch();
    }
}

function goBackToSearch(fromPopState = false) {
    if (!fromPopState) {
        if (window.history.state && window.history.state.page === 'search-detail') {
            window.history.back();
            return;
        }
    }

    // 如果有暂存的歌手上下文，优先返回歌手页
    if (window.tempArtistContext) {
        const ctx = window.tempArtistContext;
        window.tempArtistContext = null; // 用完即弃
        enterArtist(ctx.id, ctx.source, ctx.order, ctx.tab, true);
        return;
    }

    if (!lastSearchResultList) return;

    const container = document.getElementById('search-results');
    const header = document.getElementById('search-results-header');

    // 清除详情页专用头部
    const detailHeader = document.getElementById('artist-detail-header');
    if (detailHeader) detailHeader.remove();

    // 恢复搜索结果列表头部
    if (header) header.classList.remove('hidden');

    if (currentSearchScope === 'lib_artists') {
        renderLibraryArtists(lastSearchResultList);
    } else if (currentSearchScope === 'lib_albums') {
        renderLibraryAlbums(lastSearchResultList);
    } else if (lastSearchType === 'singer') {
        renderSingerResults(lastSearchResultList);
    } else if (lastSearchType === 'album') {
        renderAlbumResults(lastSearchResultList);
    } else {
        renderResults(lastSearchResultList);
    }

    const backBtn = document.getElementById('search-back-btn');
    if (backBtn) backBtn.classList.add('hidden');

    const pageInfoEl = document.getElementById('page-info');
    if (pageInfoEl) {
        if (currentSearchScope === 'lib_artists') pageInfoEl.innerText = `收藏歌手`;
        else if (currentSearchScope === 'lib_albums') pageInfoEl.innerText = `收藏专辑`;
        else pageInfoEl.innerText = `搜索结果`;
    }

    lastSearchResultList = null;
    lastSearchType = null;
    currentArtistId = null;
}
window.goBackToSearch = goBackToSearch;

window.enterArtist = enterArtist;

// Helper for loose image paths
function getImgUrl(item) {
    if (!item) return '/music/assets/logo.svg';
    const s = item;
    // 优先从标准 meta 获取
    if (s.meta && s.meta.picUrl) return s.meta.picUrl;
    // 兼容各种 SDK 的原始字段
    return s.img || s.pic || s.picUrl || s.picture ||
        (s.album && (s.album.picUrl || s.album.img || s.album.pic)) ||
        (s.al && (s.al.picUrl || s.al.img)) ||
        (s.meta && (s.meta.img || s.meta.pic)) ||
        '/music/assets/logo.svg';
}

// List search logic is now handled by ListSearch service in list_search.js
function renderResults(list) {
    const container = document.getElementById('search-results');
    const header = document.getElementById('search-results-header');
    if (header) header.classList.remove('hidden');
    // 搜索歌曲时恢复底部分页栏显示
    const paginationBar = document.getElementById('search-pagination-bar');
    if (paginationBar) paginationBar.classList.remove('hidden');
    // 重置歌手详情分页（进入歌曲搜索视图时清空）
    window.artistSongsPage = 1;
    const headerTitle = document.getElementById('header-title');
    const headerAlbum = document.getElementById('header-album');

    // Determine if we should show the album column
    // Search results (network) show album, collections (local) do not
    const showAlbum = currentSearchScope === 'network';


    // Update Header
    if (header) {
        header.classList.remove('hidden');
    }
    if (headerTitle) {
        if (showAlbum) {
            headerTitle.classList.remove('lg:col-span-6');
            headerTitle.classList.add('lg:col-span-4');
        } else {
            headerTitle.classList.remove('lg:col-span-4');
            headerTitle.classList.add('lg:col-span-6');
        }
    }
    if (headerAlbum) {
        if (showAlbum) {
            headerAlbum.classList.add('hidden');
            headerAlbum.classList.add('lg:block');
        } else {
            headerAlbum.classList.add('hidden');
            headerAlbum.classList.remove('lg:block');
        }
    }

    container.innerHTML = '';

    // [Fix] 确保每个歌曲都有唯一的 ID，防止批量操作时因为 ID 缺失(undefined)导致只能选中一个
    // 很多源(如酷狗、咪咕)返回的原始数据可能只有 hash 或 copyrightsId 而没有 id 字段
    if (list && list.length > 0) {
        list.forEach((item, idx) => {
            if (!item.id || item.id === 'undefined') {
                item.id = item.songmid || item.songId || item.hash || item.copyrightId || item.mid || item.mediaMid || `temp_${Date.now()}_${idx}`;
            }
        });
    }

    window.viewingPlaylist = list;

    if (!list || list.length === 0) {
        container.innerHTML = '<div class="text-center t-text-muted p-8">未找到相关结果</div>';
        updatePaginationInfo(0, 0, 0, 1, 1);
        return;
    }

    // Applying Unified Filter with original index preservation BEFORE pagination
    const indexedDisplayList = window.ListSearch.getDisplayList(list);

    // Pagination
    const totalItems = indexedDisplayList.length;
    let itemsPerPage = settings.itemsPerPage === 'all' ? totalItems : parseInt(settings.itemsPerPage);
    if (itemsPerPage <= 0) itemsPerPage = 20;
    const totalPages = Math.ceil(totalItems / (itemsPerPage || 1));

    // Bounds check
    if (currentPage > totalPages) currentPage = totalPages || 1;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);

    const pageList = indexedDisplayList.slice(startIndex, endIndex);

    pageList.forEach((obj, pageIndex) => {
        const { item, originalIndex: actualIndexInOriginal } = obj;
        const row = document.createElement('div');
        row.id = `gl-row-${actualIndexInOriginal}`;
        row.dataset.songId = String(item.id);

        const isMatched = window.ListSearch.isMatched(actualIndexInOriginal);
        const isCurrentMatch = window.ListSearch.isCurrentMatch(actualIndexInOriginal);
        const isSelected = window.selectedItems.has(String(item.id));

        let rowClass = 'grid grid-cols-12 gap-4 p-3 rounded-xl hover:t-bg-panel group transition-colors cursor-pointer ';
        if (isCurrentMatch) rowClass += 'search-current ';
        else if (isMatched) rowClass += 'search-match ';
        if (isSelected) rowClass += 'row-selected ring-1 ring-emerald-500/30 ';

        row.className = rowClass;

        // Add click listener for the row
        row.onclick = (e) => {
            if (window.batchMode) {
                const id = String(item.id);
                const isChecked = !window.selectedItems.has(id);
                window.handleBatchSelect(id, isChecked);
            } else {
                // If not in batch mode, clicking row plays the song
                playFromView(actualIndexInOriginal);
            }
        };

        // Image
        const imgUrl = getImgUrl(item);

        // Grid Layout Adjustment
        const titleLgSpan = showAlbum ? 'lg:col-span-4' : 'lg:col-span-6';

        row.innerHTML = `
            <!-- Index -->
            <div class="col-span-1 sm:col-span-1 text-center font-mono t-text-muted text-xs md:text-sm flex items-center justify-center">
                ${window.batchMode ? `
                    <input type="checkbox" 
                           class="batch-checkbox w-4 h-4 text-emerald-600 rounded" 
                           data-song-id="${item.id}"
                           ${isSelected ? 'checked' : ''}
                    onclick="event.stopPropagation(); handleBatchSelect('${String(item.id)}', this.checked);">
                ` : `<span class="index-num">${actualIndexInOriginal + 1}</span>`}
            </div>

            <!-- Title (Image + Text) -->
            <div class="col-span-9 sm:col-span-7 md:col-span-6 ${titleLgSpan} flex items-center overflow-hidden pr-2">
                <div class="relative w-10 h-10 md:w-12 md:h-12 mr-3 md:mr-4 flex-shrink-0 group cursor-pointer">
                     <img data-src="${imgUrl}" src="/music/assets/logo.svg" 
                          loading="lazy" fetchpriority="low"
                          class="lazy-image w-full h-full rounded-lg object-cover shadow-sm group-hover:shadow-md transition-all group-hover:scale-105 duration-300 dynamic-logo is-placeholder" 
                          alt="${item.name}"
                          onerror="this.src='/music/assets/logo.svg'; this.classList.add('is-placeholder');">
                     <div class="absolute inset-0 bg-black/20 rounded-lg hidden group-hover:flex items-center justify-center transition-all">
                        <i class="fas fa-play text-white text-xs md:text-sm"></i>
                     </div>
                </div>
                <div class="min-w-0 flex-1 flex flex-col justify-center overflow-hidden">
                    <div class="font-bold t-text-main text-sm md:text-base leading-tight hover:text-emerald-600 transition-colors">
                         ${createMarqueeHtml(item.name)}
                    </div>
                    <div class="flex items-center gap-1 mt-0.5 md:mt-1 pr-2 overflow-hidden">
                         ${getSourceTag(item.source)}
                         ${getQualityTags(item)}
                         <div class="sm:hidden flex-1 min-w-0">
                            ${createMarqueeHtml(item.singer, 'text-[10px] t-text-muted')}
                         </div>
                    </div>
                </div>
            </div>

            <!-- Artist (Hidden on Mobile) -->
            <div class="hidden sm:flex sm:col-span-3 md:col-span-3 lg:col-span-3 t-text-muted text-sm md:text-base items-center hover:text-emerald-600 transition-colors cursor-pointer overflow-hidden"
                 title="${item.singer}"
                 onclick="event.stopPropagation(); document.getElementById('search-input').value = '${item.singer.replace(/'/g, "\\'")}'; doSearch();">
                ${createMarqueeHtml(item.singer)}
            </div>

            <!-- Album (Hidden until LG) -->
            ${showAlbum ? `
            <div class="hidden lg:block lg:col-span-2 t-text-muted text-sm truncate flex items-center" title="${item.albumName || ''}">
                ${item.albumName || '-'}
            </div>
            ` : ''}

            <!-- Duration (Hidden until MD) -->
            <div class="hidden md:block md:col-span-1 t-text-muted text-sm font-mono text-center flex items-center justify-center">
                ${item.interval || '--:--'}
            </div>

            <!-- Actions -->
            <div class="col-span-2 sm:col-span-1 flex items-center justify-end gap-0.5 sm:gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                <button class="p-1 sm:p-1.5 hover:bg-emerald-50 rounded-lg text-emerald-600 transition-colors" 
                        title="播放" 
                        onclick="event.stopPropagation(); playFromView(${actualIndexInOriginal})">
                    <i class="fas fa-play w-3 h-3 sm:w-4 sm:h-4"></i>
                </button>
                <button class="p-1 sm:p-1.5 hover:bg-blue-50 rounded-lg text-blue-600 transition-colors" 
                        title="下载" 
                        onclick="event.stopPropagation(); downloadSong(${JSON.stringify(item).replace(/"/g, '&quot;')})">
                    <i class="fas fa-download w-3 h-3 sm:w-4 sm:h-4"></i>
                </button>
                <button class="add-to-playlist-btn p-1 sm:p-1.5 hover:bg-emerald-50 rounded-lg text-emerald-500 transition-colors"
                        title="添加到歌单">
                    <i class="fas fa-plus w-3 h-3 sm:w-4 sm:h-4"></i>
                </button>
                ${currentSearchScope !== 'network' ? `
                <button class="delete-song-btn p-1 sm:p-1.5 hover:bg-red-50 rounded-lg text-red-600 transition-colors"
                        title="删除">
                    <i class="fas fa-trash w-3 h-3 sm:w-4 sm:h-4"></i>
                </button>
                ` : ''}
            </div>
        `;

        const addToPlaylistBtn = row.querySelector('.add-to-playlist-btn');
        if (addToPlaylistBtn) {
            addToPlaylistBtn.onclick = (event) => {
                event.stopPropagation();
                openPlaylistAddModalForSong(actualIndexInOriginal);
            };
        }
        const deleteSongBtn = row.querySelector('.delete-song-btn');
        if (deleteSongBtn) {
            deleteSongBtn.onclick = (event) => {
                event.stopPropagation();
                deleteSingleSong(String(item.id));
            };
        }

        container.appendChild(row);
    });

    // Update pagination info
    updatePaginationInfo(startIndex + 1, endIndex, totalItems, currentPage, totalPages);

    // Init Lazy Loader
    lazyLoadImages(container);
    applyMarqueeChecks(container);

    // [Prefetch] 自动后台预加载逻辑
    if (currentSearchScope === 'network' && currentPage === totalPages) {
        const FETCH_PAGES_STEP = 3;
        const nextNetPage = (window.currentNetworkPage || 1) + FETCH_PAGES_STEP;

        // 避免重复触发
        if (!window._prefetchingPending || window._prefetchingPending !== nextNetPage) {
            window._prefetchingPending = nextNetPage;
            console.log(`[Prefetch] 触及本地末页 (${totalPages})，自动拉取后续 ${FETCH_PAGES_STEP} 页... (Next URL Page: ${nextNetPage})`);

            // 延迟一点触发，确保 UI 先更新
            setTimeout(() => {
                doSearch(nextNetPage, true, true).finally(() => {
                    // 完成后清除标志，但不再主动重置，防止同一页重复触发
                });
            }, 500);
        }
    }
}

// Generic Marquee Helper
function createMarqueeHtml(text, className = '') {
    // Return a container marked for dynamic checking
    // different screens are different, so we check overflow after render
    // Added min-w-0 to prevent flex item from expanding beyond parent
    const safeText = escapeHtmlText(text);
    return `<div class="truncate dynamic-marquee min-w-0 ${className}" data-text="${safeText}">${safeText}</div>`;
}
//滚动显示
function applyMarqueeChecks(root = document) {
    // Wait for render
    setTimeout(() => {
        const scope = root || document;
        const elements = scope.querySelectorAll('.dynamic-marquee.truncate');
        elements.forEach(el => {
            if (el.scrollWidth > el.clientWidth) {
                const text = el.getAttribute('data-text') || el.innerText;

                // 必须保留 overflow-hidden 以限制宽度
                el.classList.remove('truncate');
                el.classList.add('overflow-hidden');

                // 使用 mask-image 实现边缘渐隐效果
                const maskStyle = 'mask-image: linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%); -webkit-mask-image: linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%);';

                const wrapper = document.createElement('div');
                wrapper.className = 'w-full relative';
                wrapper.setAttribute('style', maskStyle);
                const track = document.createElement('div');
                track.className = 'inline-block whitespace-nowrap animate-marquee hover:pause-animation';
                const firstText = document.createElement('span');
                firstText.textContent = text;
                const firstGap = document.createElement('span');
                firstGap.className = 'mx-8';
                const secondText = document.createElement('span');
                secondText.textContent = text;
                const secondGap = document.createElement('span');
                secondGap.className = 'mx-8';
                track.append(firstText, firstGap, secondText, secondGap);
                wrapper.appendChild(track);
                el.replaceChildren(wrapper);
            }
        });
    }, 50);
}

// Re-check marquees on resize
window.addEventListener('resize', () => {
    clearTimeout(window._marqueeResizeTimer);
    window._marqueeResizeTimer = setTimeout(applyMarqueeChecks, 300);
});

// Lazy Loading Logic
let imageObserver;

function lazyLoadImages(root = document) {
    const scope = root || document;
    const loadImage = (img) => {
        const src = img.getAttribute('data-src');
        if (!src) return;
        if (img.src.includes('logo.svg')) {
            img.classList.add('is-placeholder');
        }
        img.src = src;
        img.onload = () => {
            img.classList.remove('is-placeholder', 'opacity-0');
            img.removeAttribute('data-src');
        };
        img.onerror = () => {
            img.src = '/music/assets/logo.svg';
            img.classList.add('is-placeholder');
            img.removeAttribute('data-src');
        };
    };

    if ('IntersectionObserver' in window) {
        if (!imageObserver) {
            imageObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        loadImage(entry.target);
                        observer.unobserve(entry.target);
                    }
                });
            }, {
                rootMargin: '100px 0px', // Load before it comes into view
                threshold: 0.01
            });
        }

        const images = scope.querySelectorAll('img.lazy-image[data-src]');
        images.forEach(img => {
            imageObserver.observe(img);
        });
    } else {
        // Fallback for older browsers
        const images = scope.querySelectorAll('img.lazy-image[data-src]');
        images.forEach(loadImage);
    }
}
window.lazyLoadImages = lazyLoadImages;
window.unobserveLazyImages = function (root = document) {
    if (!imageObserver) return;
    const scope = root || document;
    scope.querySelectorAll('img.lazy-image').forEach(img => imageObserver.unobserve(img));
};

// List search logic is now handled by ListSearch service


// Playback Logic
let currentLoadingSongId = null; // Track currently loading song
let loadingRequestCounter = 0;   // To identify unique play requests
let currentLoadingRequestId = 0; // Track latest request ID

let currentQuality = null; // 当前播放音质 (从 settings.preferredQuality 动态获取)
let currentSourceType = 'normal'; // 当前链接来源类型: 'normal' | 'cache' | 'server_cache'
let hintTimeout = null;

// 获取来源类型的中文描述
function getSourceTypeText(sourceType) {
    const map = {
        'server_cache': '服务器本地缓存',
        'cache': '浏览器链接缓存',
        'normal': '在线解析'
    };
    return map[sourceType] || '解析成功';
}

// --- Expiration & Prefetch Management ---
/**
 * 探活 URL 是否依然有效 (不下载数据，仅检查响应状态)
 * @param {string} url 
 * @returns {Promise<boolean>}
 */
async function probeUrl(url) {
    if (!url) return false;
    // 本地 API 或 代理路径通常被认为有效
    if (url.startsWith('/') || url.includes(window.location.host)) return true;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时

        // 使用 Range 请求 0-1 字节，以最小代价触发 CORS 检查和链接有效性验证
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Range': 'bytes=0-1' },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        // 返回 200 或 206 表示链接依然可用
        return response.ok;
    } catch (e) {
        console.warn(`[Probe] URL probe failed: ${url.substring(0, 40)}...`, e.message);
        return false;
    }
}

const prefetchManager = {
    cache: new Map(), // Map<songId, {url, quality, sourceType, timestamp}>
    bufferer: new Audio(), // 隐藏的缓冲器，用于预加载数据流

    init() {
        this.bufferer.muted = true;
        this.bufferer.preload = 'auto'; // 强制浏览器尽可能多地预缓冲
    },

    set(songId, data) {
        this.cache.set(songId, { ...data, timestamp: Date.now() });

        // 核心升级：触发数据流预加载
        if (data.url) {
            console.log(`[Prefetch] Pre-loading data stream for ID: ${songId}`);
            this.bufferer.src = data.url;
            this.bufferer.load(); // 诱导浏览器开始填充缓冲区
        }

        if (this.cache.size > 5) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }
    },
    get(songId) {
        const data = this.cache.get(songId);
        if (data && (Date.now() - data.timestamp < 30 * 60 * 1000)) {
            return data;
        }
        return null;
    },
    clear() {
        this.cache.clear();
        this.bufferer.src = '';
    }
};
prefetchManager.init(); // 立即初始化缓冲器

// --- URL Fetching Logic (Unified Resolution) ---

/**
 * 统一的歌曲解析入口，支持播放和预读调用
 * 包含：本地/服务器缓存检查、在线解析、自动降级逻辑
 */
async function resolveSongUrl(song, quality, isSilent = false, isRetry = false, disableFallback = false) {
    try {
        const result = await fetchSongUrl(song, quality, isRetry, isSilent);
        if (result.errorMsg) throw new Error(result.errorMsg);
        return result;
    } catch (error) {
        if (disableFallback) {
            throw error;
        }

        // 默认降级/换源的 fallback 逻辑 (用于预读或下载等不直接受播放器重试接管的场景)
        const isPlatformNotSupported = error.message && (
            error.message.includes('未找到支持') ||
            error.message.includes('not supported')
        );

        // 解析降级/换源优先级
        const order = (settings.playbackErrorPriority || 'platform,quality,next').split(',');
        const steps = [];
        for (const key of order) {
            if (key === 'quality' && settings.enableAutoDegradeQuality !== false) {
                steps.push('degrade');
            } else if (key === 'platform' && settings.enableAutoSwitchSource !== false) {
                steps.push('switch_platform');
            }
        }

        const fallbackRetryMode = (isRetry === 'local_retry' || isRetry === 'download') ? isRetry : true;

        for (const step of steps) {
            if (step === 'degrade') {
                const nextQuality = isPlatformNotSupported ? null : window.QualityManager.getNextLowerQuality(quality, song);
                if (nextQuality) {
                    if (!isSilent) {
                        const fromName = window.QualityManager.getQualityDisplayName(quality);
                        const toName = window.QualityManager.getQualityDisplayName(nextQuality);
                        RecoveryToast.show(song, `从 ${fromName} 降级到 ${toName} 播放...`, {
                            triedPlatform: song.source,
                            quality: nextQuality,
                            status: 'trying'
                        });
                    }
                    return await resolveSongUrl(song, nextQuality, isSilent, fallbackRetryMode, false);
                }
            } else if (step === 'switch_platform') {
                if (!isSilent) {
                    console.log(`[AutoSource] 原始源解析失败，准备尝试全网匹配: ${song.name}`);
                    RecoveryToast.show(song, '原始源解析失败，正在全网搜索备选源...');
                }
                const matchedSong = await findOtherSourceMatch(song, isSilent);
                if (matchedSong) {
                    const targetPlatform = getSourceName(matchedSong.source);
                    if (!isSilent) {
                        RecoveryToast.show(matchedSong, `找到备选源，尝试从 [${targetPlatform}] 播放...`, {
                            triedPlatform: matchedSong.source,
                            status: 'trying'
                        });
                    }
                    const bestNextQuality = window.QualityManager.getBestQuality(matchedSong, settings.preferredQuality || 'flac');
                    const matchedResult = await fetchSongUrl(matchedSong, bestNextQuality, fallbackRetryMode, isSilent);
                    return {
                        ...matchedResult,
                        songInfo: matchedSong,
                        switchedSource: true,
                        originalSource: song.source
                    };
                }
            }
        }

        throw error;
    }
}

async function resolveDownloadSongUrl(song, quality, isSilent = true) {
    const tried = new Set();
    let lastError = null;

    const tryResolveCandidate = async (candidateSong, preferredQuality) => {
        const requestedQuality = preferredQuality || settings.preferredQuality || 'flac';
        let candidateQuality = window.QualityManager?.QUALITY_PRIORITY?.includes(requestedQuality)
            ? requestedQuality
            : (window.QualityManager
                ? window.QualityManager.getBestQuality(candidateSong, requestedQuality)
                : requestedQuality);

        while (candidateQuality) {
            const candidateId = candidateSong.id || candidateSong.songmid || candidateSong.songId || candidateSong.hash || candidateSong.copyrightId || candidateSong.mid || candidateSong.mediaMid || `${candidateSong.name || ''}_${candidateSong.singer || ''}_${candidateSong.interval || ''}`;
            const key = `${candidateSong.source || ''}_${candidateId}_${candidateQuality}`;
            if (tried.has(key)) break;
            tried.add(key);

            try {
                const result = await fetchSongUrl(candidateSong, candidateQuality, 'download', isSilent);
                if (result.errorMsg) throw new Error(result.errorMsg);
                return result;
            } catch (err) {
                lastError = err;
                console.warn(`[DownloadResolve] 解析失败: ${candidateSong.name} via ${candidateSong.source} (${candidateQuality})`, err);
                if (!window.QualityManager || settings.enableAutoDegradeQuality === false) break;
                candidateQuality = window.QualityManager.getNextLowerQuality(candidateQuality, candidateSong);
            }
        }

        return null;
    };

    const originalResult = await tryResolveCandidate(song, quality);
    if (originalResult) return originalResult;

    if (settings.enableAutoSwitchSource === false) {
        throw lastError || new Error('解析失败');
    }

    const matches = await findOtherSourceMatches(song, isSilent, { ignoreSupportedFilter: true });
    for (const matchedSong of matches) {
        const matchedResult = await tryResolveCandidate(matchedSong, quality);
        if (matchedResult) {
            return {
                ...matchedResult,
                songInfo: matchedSong,
                switchedSource: true,
                originalSource: song.source
            };
        }
    }

    throw lastError || new Error('未找到可下载的备选源');
}

function normalizeSongMatchText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[（(].*?[）)]/g, '')
        .replace(/[\s·・,，.。!！?？:：;；'"‘’“”《》<>【】[\]()（）\-_/\\]/g, '');
}

function isSingerMatch(sourceSinger, targetSinger) {
    const sourceText = normalizeSongMatchText(sourceSinger);
    const targetText = normalizeSongMatchText(targetSinger);
    if (!targetText) return true;
    if (!sourceText) return false;
    if (sourceText.includes(targetText) || targetText.includes(sourceText)) return true;

    const splitSinger = value => String(value || '')
        .toLowerCase()
        .split(/[、,，/&／|;；]+/)
        .map(normalizeSongMatchText)
        .filter(Boolean);
    const sourceParts = splitSinger(sourceSinger);
    const targetParts = splitSinger(targetSinger);
    return sourceParts.some(sourcePart => targetParts.some(targetPart => sourcePart.includes(targetPart) || targetPart.includes(sourcePart)));
}

function getSongMatchScore(item, song) {
    const targetName = normalizeSongMatchText(song.name);
    const itemName = normalizeSongMatchText(item.name);
    if (!targetName || !itemName) return -1;
    if (!itemName.includes(targetName) && !targetName.includes(itemName)) return -1;

    if (!isSingerMatch(item.singer, song.singer)) return -1;

    const targetDuration = timeToSeconds(song.interval);
    const itemDuration = timeToSeconds(item.interval);
    let durationScore = 0;
    if (targetDuration > 0 && itemDuration > 0) {
        const durationDiff = Math.abs(targetDuration - itemDuration);
        if (durationDiff > 8) return -1;
        durationScore = 8 - durationDiff;
    }

    let nameScore = 0;
    if (itemName === targetName) nameScore = 20;
    else if (itemName.includes(targetName) || targetName.includes(itemName)) nameScore = 10;

    const sameAlbum = item.albumName && song.albumName && normalizeSongMatchText(item.albumName) === normalizeSongMatchText(song.albumName);
    return nameScore + durationScore + (sameAlbum ? 3 : 0);
}

function getSongDurationDiff(item, song) {
    const targetDuration = timeToSeconds(song.interval);
    const itemDuration = timeToSeconds(item.interval);
    if (targetDuration <= 0 || itemDuration <= 0) return null;
    return Math.abs(targetDuration - itemDuration);
}

/**
 * 跨平台寻找相同歌曲的匹配逻辑
 * 基本规则：歌名+歌手+时长匹配
 */
async function findOtherSourceMatch(song, isSilent = false) {
    const matches = await findOtherSourceMatches(song, isSilent);
    return matches[0] || null;
}

async function findOtherSourceMatches(song, isSilent = false, options = {}) {
    if (!song.name || !song.singer) return [];

    try {
        // 1. 获取当前自定义源支持解析的平台（支持的平台）
        const list = await fetchCustomSources();
        let supportedPlatforms = null;
        if (Array.isArray(list)) {
            supportedPlatforms = new Set();
            list.forEach(src => {
                if (src.enabled && src.status === 'success' && Array.isArray(src.supportedSources)) {
                    src.supportedSources.forEach(platform => {
                        supportedPlatforms.add(platform);
                    });
                }
            });
        }

        // 2. 切换到和当前不同源，并且根据优先级排列 (网易、QQ、酷我、酷狗、咪咕)
        const baseOrder = ['wy', 'tx', 'kw', 'kg', 'mg'];
        const searchSourcesOrdered = baseOrder.filter(s => s !== song.source);

        // 3. 过滤出自定义源支持解析的平台
        let searchSources = searchSourcesOrdered;
        if (supportedPlatforms && !options.ignoreSupportedFilter) {
            searchSources = searchSourcesOrdered.filter(s => supportedPlatforms.has(s));
        }

        // 4. 如果发现没有其他支持的平台可供切换
        if (searchSources.length === 0) {
            console.log(`[AutoSource] 换源跳过：没有其他自定义源支持的平台。当前源: ${song.source}`);
            if (!isSilent) showError('未找到自定义源下支持的平台下的对应歌曲');
            return [];
        }

        const query = `${song.name} ${song.singer}`;
        const headers = { 'Content-Type': 'application/json' };
        Object.assign(headers, getUserAuthHeaders());

        if (!isSilent) showInfo('正在自动尝试换源匹配...');

        const searchPromises = searchSources.map(s =>
            fetch(`${API_BASE}/search?name=${encodeURIComponent(query)}&source=${s}&page=1`, { headers })
                .then(res => res.json())
                .then(data => Array.isArray(data) ? data.map(item => ({ ...item, source: s })) : [])
                .catch(() => [])
        );

        const allResults = await Promise.all(searchPromises);
        const flatResults = allResults.flat();

        if (flatResults.length === 0) return [];

        const matches = [];

        // 匹配算法
        for (const item of flatResults) {
            const score = getSongMatchScore(item, song);
            if (score < 0) continue;

            const durationDiff = getSongDurationDiff(item, song);
            console.log(`[AutoSource] 匹配成功: ${item.name} via ${item.source} (score: ${score}, 时长误差: ${durationDiff === null ? '未知' : `${durationDiff}s`})`);
            matches.push({ ...item, _matchScore: score });
        }

        if (matches.length === 0) {
            console.log(`[AutoSource] 未找到合适的匹配结果 (Total searched: ${flatResults.length})`);
        }
        return matches.sort((a, b) => (b._matchScore || 0) - (a._matchScore || 0));
    } catch (e) {
        console.warn('[AutoSource] 匹配逻辑执行出错:', e);
        return [];
    }
}

/**
 * 辅助：将 mm:ss 转换为秒数
 */
function timeToSeconds(timeStr) {
    if (!timeStr || !timeStr.includes(':')) return 0;
    const parts = timeStr.split(':');
    if (parts.length === 2) {
        return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    }
    return 0;
}

/**
 * 辅助：获取源名称
 */
function getSourceName(source) {
    const names = { kw: '酷我', kg: '酷狗', tx: 'QQ', wy: '网易', mg: '咪咕' };
    return names[source] || source.toUpperCase();
}

/**
 * 统一应用代理逻辑，处理 HTTPS 环境下的 HTTP 链接及跨域限制 (CORS) 问题
 * 增强：开启自动代理后，通过探测链接可用性（包括跨域兼容性）来自动决定是否启用服务器代理
 */
async function applyAutoProxy(url, song) {
    if (!url) return url;

    // 已经过代理或为本地路径的无需处理
    if (url.startsWith('/api/music/download') || url.startsWith('/') || url.includes(window.location.host)) {
        return url;
    }

    // 优先级 1：如果手动开启了“播放音乐代理”，则无条件走代理 (用于解决 IP 封锁或跨域限制)
    if (settings.enableProxyPlayback) {
        console.log(`[Proxy] Forced proxy enabled for: ${song.name}`);
        // 如果同时启用了自定义代理，优先使用（客户端直接请求，不经服务器中转）
        if (settings.enableCustomProxy && settings.customProxyUrl) {
            const proxyUrl = settings.customProxyUrl.replace('{url}', url);
            console.log(`[Proxy] Custom proxy applied (forced): ${song.name} -> ${proxyUrl}`);
            return proxyUrl;
        }
        const filename = `${song.singer} - ${song.name}.mp3`;
        return `/api/music/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}&inline=1`;
    }

    const isHttpsEnv = window.location.protocol === 'https:';
    const isHttpLink = url.startsWith('http://');

    // 优先级 2：自动检测并处理跨域风险 (CORS) 或 混合内容 (Mixed Content)
    if (settings.enableAutoProxy) {
        // 探测流程：检测该 URL 是否能被当前浏览器直接访问
        // 如果是 HTTPS 环境下的 HTTP 链接，先尝试升级 https 探测，否则直接探测原链接
        const probeUrl = (isHttpsEnv && isHttpLink) ? url.replace('http://', 'https://') : url;

        console.log(`[Proxy] Auto-proxy evaluating (CORS/Safety probe): ${song.name}`);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000); // 2秒探测超时

            // 如果此处 fetch 报错（如 CORS policy block），则会进入 catch
            const response = await fetch(probeUrl, {
                method: 'GET',
                headers: { 'Range': 'bytes=0-1' }, // 轻量探测
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (response.ok) {
                console.log(`[Proxy] Probe Success (Direct Play): ${song.name} via ${probeUrl}`);
                return probeUrl;
            }
        } catch (e) {
            // 探测失败：可能是跨域拦截、证书错误、或者源不支持 HTTPS
            console.warn(`[Proxy] Probe failed (CORS risk or unreachable), falling back to server proxy: ${song.name}`, e.message);
        }

        // 回退逻辑：探测失败后根据设置启用自定义代理或服务器代理
        if (settings.enableCustomProxy && settings.customProxyUrl) {
            const proxyUrl = settings.customProxyUrl.replace('{url}', url);
            console.log(`[Proxy] Custom proxy fallback: ${song.name} -> ${proxyUrl}`);
            return proxyUrl;
        }

        console.log(`[Proxy] Server proxy fallback: ${song.name}`);
        const filename = `${song.singer} - ${song.name}.mp3`;
        return `/api/music/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}&inline=1`;
    }

    return url;
}

async function fetchSongUrl(song, quality, isRetry = false, isSilent = false, options = {}) {
    const cleanedSong = cleanSongData(song);
    const cacheKey = `lx_url_${cleanedSong.id}_${quality}`;

    // 0. 本地文件/带有本地播放 URL 的歌曲：直接播放本地文件，无需走在线 API 解析
    if ((song.isLocal || song.url?.startsWith('/api/music/cache/file/')) && song.url && !isRetry) {
        console.log(`[Cache] Direct Local File Hit: ${song.name}`);
        let localUrl = await applyAutoProxy(song.url, song);
        return { url: localUrl, sourceType: 'server_cache', quality: song.quality || quality };
    }

    const shouldBypassServerCache = isRetry === 'local_retry' || isRetry === 'download';

    const allowServerCache = settings.preferServerCache !== false && !shouldBypassServerCache;
    if (allowServerCache) {
        let cacheResult = await checkServerCache(cleanedSong, quality, !!isRetry);
        if (cacheResult.exists && !cacheResult.isCollision) {
            const actualQuality = cacheResult.quality || quality;
            console.log(`[Cache] Server Hit: ${cleanedSong.name} (${actualQuality})`);
            let serverCacheUrl = cacheResult.url;
            // 应用代理逻辑 (以防服务器缓存返回的是原始 HTTP 链接)
            serverCacheUrl = await applyAutoProxy(serverCacheUrl, song);
            return { url: serverCacheUrl, sourceType: 'server_cache', quality: actualQuality };
        }
    }

    const allowLinkCache = !isRetry && settings.enableSongUrlCache !== false;
    if (allowLinkCache) {
        let cachedUrl = localStorage.getItem(cacheKey);
        if (cachedUrl) {
            console.log(`[Cache] Link Hit: ${cleanedSong.name} (${quality})`);
            // 核心修复：命中本地缓存时也必须应用代理逻辑，否则 HTTPS 下无法播放 HTTP 缓存链接
            cachedUrl = await applyAutoProxy(cachedUrl, song);
            return { url: cachedUrl, sourceType: 'cache', quality };
        }
    }

    const reqId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    let progressEs = null;
    try {
        progressEs = new EventSource(`/api/music/progress?reqId=${reqId}`);
        progressEs.onmessage = (e) => {
            if (isSilent) return;
            try {
                const attempt = JSON.parse(e.data);
                const songNamePrefix = attempt.name || song.name || '';
                const msg = `[${songNamePrefix}] ${attempt.message || (attempt.status === 'success' ? '解析成功' : '解析失败')}`;

                // 若处于换源试错常驻提示中，将进度同步至常驻卡片，避免底层露出绿色普通 Toast
                if (typeof RecoveryToast !== 'undefined' && RecoveryToast.isActive()) {
                    const sourceName = attempt.sourceName || attempt.name;
                    if (sourceName && sourceName !== song.name) {
                        RecoveryToast.show(song, `[${sourceName}] ${attempt.status === 'success' ? '解析成功' : '尝试失败'}...`, {
                            triedPlatform: sourceName,
                            quality: quality,
                            status: attempt.status === 'success' ? 'success' : (attempt.status === 'fail' ? 'failed' : 'trying')
                        });
                    } else if (attempt.status === 'success') {
                        RecoveryToast.updateStatusText(`[${sourceName || '备选源'}] 解析成功，准备播放...`);
                    } else if (attempt.status === 'fail') {
                        RecoveryToast.updateStatusText(`[${sourceName || '备选源'}] 解析失败`);
                    }
                    return;
                }

                if (attempt.status === 'success') showSuccess(msg);
                else showError(msg);
            } catch (_) { }
        };
    } catch (_) { }

    const headers = { 'Content-Type': 'application/json' };
    // 携带认证信息 (Token 或密码)
    Object.assign(headers, getUserAuthHeaders());
    headers['x-req-id'] = reqId;

    // [Fix] 给予 SSE 连接极短的建连时间，确保并发请求下后端能优先捕获到 SSE 客户端
    await new Promise(r => setTimeout(r, 50));

    try {
        const currentPlatform = song.source;
        let excludeApiSources = options?.excludeApiSources;
        if (!excludeApiSources && currentRecoveryState && currentRecoveryState.currentSong?.source === currentPlatform) {
            excludeApiSources = currentRecoveryState.triedApiSourcesByPlatform?.[currentPlatform] || [];
        }

        const res = await fetch(`${API_BASE}/url`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                songInfo: song,
                quality,
                enableAutoSwitchApiSource: settings.enableAutoSwitchApiSource !== false,
                excludeApiSources: Array.isArray(excludeApiSources) ? excludeApiSources : []
            })
        });

        if (!res.ok) {
            let errorMsg = `HTTP ${res.status}`;
            let result = {};
            try {
                result = await res.json();
                if (result.error) errorMsg = result.error;
            } catch (e) { }
            throw { message: errorMsg, attempts: result.attempts };
        }

        const result = await res.json();
        if (result.url) {
            // 使用异步统一代理函数
            const finalUrl = await applyAutoProxy(result.url, song);

            if (settings.enableSongUrlCache !== false) {
                try {
                    localStorage.setItem(cacheKey, finalUrl);
                    updateStorageStatsUI();
                } catch (e) { }
            }
            if (settings.enableServerCache && isRetry !== 'download' && !finalUrl.includes('/api/music/cache/file/')) {
                // [Fix] 传递原始 result.url 而非经过 applyAutoProxy 处理后的相对代理路径，
                // 否则后端下载器会因无法识别相对路径而报 ERR_INVALID_URL 错误。
                triggerServerCache(song, result.url, quality);
            }
            console.log(`[Resolve] Online Success: ${song.name} via ${result.sourceName || 'Unknown'}`);
            return {
                url: finalUrl,
                sourceType: 'normal',
                quality: result.type || quality,
                sourceName: result.sourceName,
                sourceId: result.sourceId,
                hasMoreSources: !!result.hasMoreSources,
                requestedSource: result.requestedSource || song.source,
                downloadSource: result.downloadSource || song.source,
                songInfo: song,
                errorMsg: result.errorMsg
            };
        }
        throw new Error('服务器未返回播放链接');
    } finally {
        if (progressEs) { progressEs.close(); progressEs = null; }
    }
}

function getNextIndex() {
    if (!currentPlaylist || currentPlaylist.length === 0) return -1;

    // [Random Prefetch Fix] 如果处于随机播放模式，且已有预选内容，优先返回预选
    if (playMode === 'random' && preSelectedNextIndex !== null) {
        if (preSelectedNextIndex >= 0 && preSelectedNextIndex < currentPlaylist.length) {
            return preSelectedNextIndex;
        }
        preSelectedNextIndex = null; // 重置失效索引
    }

    let nextIndex;
    switch (playMode) {
        case 'single':
            nextIndex = currentIndex;
            break;
        case 'random':
            if (currentPlaylist.length === 1) {
                nextIndex = 0;
            } else {
                do {
                    nextIndex = Math.floor(Math.random() * currentPlaylist.length);
                } while (nextIndex === currentIndex);
            }
            break;
        case 'order':
            nextIndex = currentIndex + 1;
            if (nextIndex >= currentPlaylist.length) return -1;
            break;
        case 'list':
        default:
            nextIndex = currentIndex + 1;
            if (nextIndex >= currentPlaylist.length) nextIndex = 0;
            break;
    }
    return nextIndex;
}

// Prefetch next song helper (Recursive Discovery)
async function prefetchNextSong(startFromIndex = null, depth = 0) {
    if (settings.enablePreloader === false || depth > 5) return;

    let targetIndex = startFromIndex;
    if (targetIndex === null) {
        targetIndex = getNextIndex();
        // [Random Prefetch Fix] 如果是随机模式，且尚未有预选结果，将本次生成的索引存入预选
        if (playMode === 'random' && preSelectedNextIndex === null) {
            preSelectedNextIndex = targetIndex;
        }
    }
    if (targetIndex === -1 || targetIndex === currentIndex) return;

    const nextSong = currentPlaylist[targetIndex];
    if (!nextSong) return;

    // 如果这首已经被标记为不可播放，拉下一首
    if (nextSong._unplayable) {
        const followingIndex = (targetIndex + 1) >= currentPlaylist.length ? 0 : targetIndex + 1;
        return prefetchNextSong(followingIndex, depth + 1);
    }

    try {
        const targetQual = window.QualityManager.getBestQuality(nextSong, settings.preferredQuality || 'flac');

        // 1. 检查内存缓存
        let result = prefetchManager.get(nextSong.id);
        if (result) {
            if (await probeUrl(result.url)) return;
            prefetchManager.cache.delete(nextSong.id);
        }

        // 2. 复用统一解析逻辑 (resolveSongUrl)，且开启静默模式
        result = await resolveSongUrl(nextSong, targetQual, true);

        // 3. 探活获取到的链接
        if (!(await probeUrl(result.url))) {
            localStorage.removeItem(`lx_url_${cleanSongData(nextSong).id}_${targetQual}`);
            result = await resolveSongUrl(nextSong, targetQual, true, true);
        }

        prefetchManager.set(nextSong.id, result);
        const sourceDesc = getSourceTypeText(result.sourceType);
        console.log(`[Prefetch] Readied: ${nextSong.name} (${result.quality} / ${sourceDesc})`);

    } catch (e) {
        console.warn(`[Prefetch] Skip unplayable [${nextSong.name}]:`, e.message);
        nextSong._unplayable = true; // 标记

        // 递归探测
        const followingIndex = (targetIndex + 1) >= currentPlaylist.length ? 0 : targetIndex + 1;
        if (followingIndex !== currentIndex) {
            return prefetchNextSong(followingIndex, depth + 1);
        }
    }
}

// --- Server Cache Helpers ---
async function checkServerCache(song, quality, exactQuality = false) {
    try {
        const username = currentListData?.username || '';
        const params = new URLSearchParams({
            name: song.name,
            singer: song.singer,
            source: song.source,
            songmid: song.songmid || (song.meta && (song.meta.songmid || song.meta.songId)) || '',
            songId: song.songId || (song.meta && song.meta.songId) || song.id,
            quality: quality || ''
        });
        if (exactQuality) params.append('exactQuality', '1');
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());

        const res = await fetch(`/api/music/cache/check?${params}`, { headers });
        if (res.ok) {
            const data = await res.json();
            return data; // 返回完整数据对象，包含 exists, isCollision, url 等
        }
    } catch (e) { console.error('[ServerCache] Check failed:', e); }
    return { exists: false };
}

/**
 * 管理员权限验证通用处理逻辑
 * 如果检测到 403 错误，弹出密码输入框并保存密码后重试
 */
async function handleAdminAuth(message) {
    const pass = await showInput('管理员身份验证', message, {
        placeholder: '请输入后台管理密码',
        inputType: 'password'
    });
    if (pass) {
        try {
            const response = await fetch('/api/admin/verify', {
                method: 'POST',
                headers: { 'x-frontend-auth': pass }
            });

            if (response.ok) {
                localStorage.setItem('lx_admin_password', pass);
                updateAdminUI(); // 更新 UI 状态
                return true;
            } else {
                const result = await response.json();
                showError(result.error || '密码验证失败');
                return false;
            }
        } catch (err) {
            console.error('Admin verification error:', err);
            showError('服务器验证出错，请稍后重试');
            return false;
        }
    }
    return false;
}
window.handleAdminAuth = handleAdminAuth;

/**
 * 如果当前正在操作 _open 公开用户数据，且未登录管理员，则弹出登录设置并返回 false。
 * 已登录管理员返回 true，允许继续操作。
 */
async function requireAdminForOpenWrite(action) {
    const isOpen = currentListData?.username === '_open' || window.isViewingPublicFavorites;
    if (!isOpen) return true; // 不是 _open 数据，无需验证
    if (localStorage.getItem('lx_admin_password')) return true; // 已登录管理员
    // 弹出管理员登录弹窗
    const authorized = await handleAdminAuth(`该操作需要管理员权限：${action || '修改公开内容'}`);
    return authorized;
}
window.requireAdminForOpenWrite = requireAdminForOpenWrite;

// 管理员登录处理
async function handleAdminLogin() {
    const authorized = await handleAdminAuth('请输入管理员密码进行登录验证');
    if (authorized) {
        showSuccess('管理员已登录');
        updateAdminUI();
        syncSettingsUI();
        if (typeof renderCustomSources === 'function') renderCustomSources();

        // 未登录用户账号时：管理员应载入 _open 公开列表并对其操作
        if (!isUserLoggedIn()) {
            const loaded = await fetchPublicListData();
            if (loaded) {
                await loadLibraryData();
            }
        }
        if (typeof window.LocalMusicManager?.fetchData === 'function') {
            window.LocalMusicManager.fetchData(true);
        }
        // 已登录用户账号时：不改变当前展示列表，管理员密码仅用于操作授权
    }
}
window.handleAdminLogin = handleAdminLogin;

// 管理员退出登录处理
async function handleAdminLogout() {
    if (!(await showSelect('管理员登出', '确定要退出管理员身份吗？'))) return;
    localStorage.removeItem('lx_admin_password');
    updateAdminUI();
    syncSettingsUI();

    // [核心新增] 如果当前使用的是 _open 公共列表，登出管理员后锁定列表显示
    if (window.lx_config?.['user.enablePublicFavorites'] && (!userToken || !localStorage.getItem('lx_sync_user'))) {
        const enablePublicNonAdminAccess = !!window.lx_config?.['user.enablePublicNonAdminAccess'];
        if (!enablePublicNonAdminAccess) {
            currentListData = null;
            window.currentListData = null;
            if (typeof renderMyLists === 'function') {
                renderMyLists(null);
            }
        } else {
            fetchPublicListData();
        }
    }
    if (typeof window.LocalMusicManager?.fetchData === 'function') {
        window.LocalMusicManager.fetchData(true);
    }

    showSuccess('管理员已登出');
}
window.handleAdminLogout = handleAdminLogout;

// 更新管理员相关 UI 元素
function updateAdminUI() {
    const isAdmin = !!localStorage.getItem('lx_admin_password');
    const isPublic = !currentListData?.username || currentListData?.username === 'default';

    // 自定义源部分的标签和按钮
    const adminTag = document.getElementById('settings-admin-tag');
    const loginBtn = document.getElementById('btn-admin-login');
    const logoutBtn = document.getElementById('btn-admin-logout');
    const scopeTag = document.getElementById('settings-source-scope-tag');

    if (adminTag) adminTag.classList.toggle('hidden', !isAdmin);
    if (logoutBtn) logoutBtn.classList.toggle('hidden', !isAdmin);
    if (loginBtn) {
        // 只要未登录管理员，就显示「管理员登录」按钮
        loginBtn.classList.toggle('hidden', isAdmin);
    }
    const manageBtn = document.getElementById('btn-custom-source-manage');
    if (manageBtn) {
        const isPublicRestrictionEnabled = !!window.lx_config?.['user.enablePublicRestriction'];
        const isUser = !!userToken;
        // 如果开启了公开限制，且既不是管理员也不是登录用户，则隐藏管理入口（或之后显示锁定界面）
        // 这里根据用户要求，只要登录了就不隐藏
        const isRestricted = isPublicRestrictionEnabled && !isAdmin && !isUser;
        manageBtn.classList.toggle('hidden', isRestricted);
    }
    if (scopeTag) {
        scopeTag.classList.toggle('hidden', !isPublic);
    }

    // [新增] 处于登录/同步状态时，将相关输入框和连接按钮变灰防止重复操作
    const isLocalLoggedIn = !!userToken && !isPublic;
    const isRemoteConnected = (window.SyncManager && window.SyncManager.mode === 'remote' && window.SyncManager.client?.isConnected) ||
        (window.currentRemoteOverwriteClient && window.currentRemoteOverwriteClient.isConnected);

    // 情况 A: 本地登录框 - 只要本地已登录，就禁用本地输入框和登录按钮 (必须要先退出登录才能换号)
    const loginInputIds = ['sync-local-user', 'sync-local-pass'];
    loginInputIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = isLocalLoggedIn;
            if (isLocalLoggedIn) {
                el.classList.add('opacity-40', 'cursor-not-allowed', 'grayscale');
                el.parentElement?.classList.add('pointer-events-none');
            } else {
                el.classList.remove('opacity-40', 'cursor-not-allowed', 'grayscale');
                el.parentElement?.classList.remove('pointer-events-none');
            }
        }
    });

    const localLoginBtn = document.querySelector('#sync-form-local button');
    if (localLoginBtn) {
        localLoginBtn.disabled = isLocalLoggedIn;
        if (isLocalLoggedIn) localLoginBtn.classList.add('opacity-30', 'pointer-events-none', 'grayscale');
        else localLoginBtn.classList.remove('opacity-30', 'pointer-events-none', 'grayscale');
    }

    const disableMainRemote = isRemoteConnected || isLocalLoggedIn;
    ['sync-remote-url', 'sync-remote-code'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = disableMainRemote;
            if (disableMainRemote) {
                el.classList.add('opacity-40', 'cursor-not-allowed', 'grayscale');
                el.parentElement?.classList.add('pointer-events-none');
            } else {
                el.classList.remove('opacity-40', 'cursor-not-allowed', 'grayscale');
                el.parentElement?.classList.remove('pointer-events-none');
            }
        }
    });

    // 2. 弹窗内的远程同步输入框及客户端模式勾选框：仅在远程已连或开启了客户端模式时才禁用
    // (勾选客户端模式后锁定输入，防止在自动同步流程中改动配置)
    const disableModalRemote = isRemoteConnected || settings.enableClientModeSync;
    const modalInputIds = ['remote-overwrite-url', 'remote-overwrite-code', 'setting-client-mode-sync'];
    modalInputIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = disableModalRemote;
            if (disableModalRemote) {
                el.classList.add('opacity-40', 'cursor-not-allowed', 'grayscale');
                // 注意：勾选框的父级不要加 pointer-events-none，否则无法取消
                if (id !== 'setting-client-mode-sync') el.parentElement?.classList.add('pointer-events-none');
            } else {
                el.classList.remove('opacity-40', 'cursor-not-allowed', 'grayscale');
                if (id !== 'setting-client-mode-sync') el.parentElement?.classList.remove('pointer-events-none');
            }
        }
    });


    const modeBtnIds = ['btn-mode-local', 'btn-mode-remote'];
    modeBtnIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (isLocalLoggedIn || isRemoteConnected) {
                el.style.opacity = '0.5';
                el.style.pointerEvents = 'none';
                el.classList.add('grayscale');
            } else {
                el.style.opacity = '1';
                el.style.pointerEvents = 'auto';
                el.classList.remove('grayscale');
            }
        }
    });

    // 3. 处理操作按钮的禁用状态 (分为主界面按钮和弹窗按钮)
    const mainActionButtons = [
        document.querySelector('#sync-remote-step1 button'),
        document.querySelector('#sync-remote-step2 button')
    ];
    mainActionButtons.forEach(btn => {
        if (btn) {
            btn.disabled = disableMainRemote;
            if (disableMainRemote) btn.classList.add('opacity-30', 'pointer-events-none', 'grayscale');
            else btn.classList.remove('opacity-30', 'pointer-events-none', 'grayscale');
        }
    });

    const modalActionButtons = [
        document.querySelector('#remote-overwrite-step1 button'),
        document.querySelector('button[onclick^="handleRemoteOverwriteConnect"]')
    ];
    modalActionButtons.forEach(btn => {
        if (btn) {
            btn.disabled = disableModalRemote;
            if (disableModalRemote) btn.classList.add('opacity-30', 'pointer-events-none', 'grayscale');
            else btn.classList.remove('opacity-30', 'pointer-events-none', 'grayscale');
        }
    });
}

async function triggerServerCache(song, url, quality) {
    try {
        console.log('[ServerCache] Triggering background download for:', song.name);
        const username = currentListData?.username || '';
        const headers = { 'Content-Type': 'application/json' };
        Object.assign(headers, getUserAuthHeaders());

        // 添加管理员验证 Header (如果已登录)
        const adminPass = localStorage.getItem('lx_admin_password');
        if (adminPass) headers['x-frontend-auth'] = adminPass;

        const coverUrl = typeof getImgUrl === 'function' ? getImgUrl(song) : (song.img || song.meta?.picUrl || '');
        const songInfoForCache = {
            ...song,
            img: song.img || coverUrl,
            meta: {
                ...(song.meta || {}),
                picUrl: song.meta?.picUrl || coverUrl
            }
        };

        await fetch('/api/music/cache/download', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                songInfo: songInfoForCache,
                url,
                quality,
                namingPattern: window.settings?.serverCacheNamingPattern || 'simple',
                embedLyric: !!(window.settings?.embedLyricToFile ?? true)
            })
        });
        // 移除 403 自动重试逻辑，API 不再报 403
    } catch (e) { console.error('[ServerCache] Trigger failed:', e); }
}

let lastNamingPattern = window.settings?.serverCacheNamingPattern || 'simple';

async function updateServerCacheConfig(location, pattern) {
    const loc = location || window.settings?.serverCacheLocation || 'root';
    const pat = pattern || window.settings?.serverCacheNamingPattern || 'simple';
    const oldPattern = lastNamingPattern;

    const headers = { 'Content-Type': 'application/json' };
    // 携带 Token（或兼容旧密码），让服务端正确识别身份
    Object.assign(headers, getUserAuthHeaders());
    const adminPass = localStorage.getItem('lx_admin_password');
    if (adminPass) headers['x-frontend-auth'] = adminPass;

    try {
        const response = await fetch('/api/music/cache/config', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                location: loc,
                namingPattern: pat
            })
        });
        if (!response.ok) {
            console.warn('[ServerCache] Config update failed:', response.status);
            // 失败时回滚 UI
            if (typeof syncSettingsUI === 'function') {
                if (location) syncSettingsUI('serverCacheLocation', settings.serverCacheLocation);
                if (pattern) syncSettingsUI('serverCacheNamingPattern', settings.serverCacheNamingPattern);
            }
        } else {
            console.log('[Cache] 服务器配置已同步:', loc, pat);

            // 如果命名模式真的发生了变化（且不是初始化同步）
            if (pattern && oldPattern && pattern !== oldPattern) {
                const confirmed = await showSelect('歌曲命名格式变更', `检测到命名方式已更改为 "${pat}"。是否将服务器上已下载的本地歌曲重新命名为新的格式？<br><br><span class="text-xs opacity-70">注：这会同时移动对应的歌词文件，确保播放器能正常识别。</span>`, {
                    confirmText: '现在重命名',
                    cancelText: '保持现状',
                    confirmColor: 'bg-emerald-500'
                });

                if (confirmed) {
                    showLoading('正在重命名服务器文件...');
                    try {
                        const renameRes = await fetch('/api/music/cache/rename', {
                            method: 'POST',
                            headers: headers
                        });
                        const renameData = await renameRes.json();
                        hideLoading();
                        if (renameData.success) {
                            showToast(`重命名完成！成功: ${renameData.successCount}, 跳过: ${renameData.skipCount}, 失败: ${renameData.failCount}`, 'success');
                            // 刷新可能的列表显示
                            if (typeof refreshCacheList === 'function') refreshCacheList();
                        } else {
                            showToast('重命名操作失败: ' + (renameData.message || '未知错误'), 'error');
                        }
                    } catch (e) {
                        hideLoading();
                        showToast('重命名请求异常', 'error');
                        console.error(e);
                    }
                }
            }
            lastNamingPattern = pat; // 更新最后同步的模式
        }
    } catch (e) {
        console.error('[ServerCache] Config update failed:', e);
    }
}
window.updateServerCacheConfig = updateServerCacheConfig; // Expose global

/**
 * 查看服务端当前真实存储目录 (综合缓存位置与仅下载模式)
 */
async function showServerDirectories() {
    showLoading('正在获取服务器目录信息...');
    try {
        const loc = window.settings?.serverCacheLocation || 'root';
        const onlyDownload = !!window.settings?.enableOnlyDownloadMode;

        const headers = { 'Content-Type': 'application/json' };
        Object.assign(headers, getUserAuthHeaders());

        const url = `/api/music/cache/directories?location=${encodeURIComponent(loc)}&onlyDownload=${onlyDownload ? '1' : '0'}`;
        const res = await fetch(url, { headers });
        const json = await res.json();
        hideLoading();

        if (!json.success || !json.data) {
            showToast('获取服务器目录失败: ' + (json.message || '未知错误'), 'error');
            return;
        }

        const data = json.data;
        const isWindows = data.cacheDirectory.includes('\\');
        const sep = isWindows ? '\\' : '/';
        const isSeparated = !data.isSameDirectory;

        const modal = document.createElement('div');
        modal.className = "fixed inset-0 z-[200] flex items-center justify-center p-4 animate-fade-in";
        modal.innerHTML = `
            <div class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"></div>
            <div class="t-bg-panel rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden transform transition-all animate-slide-up relative z-10 border t-border-main">
                <!-- Header -->
                <div class="px-5 py-4 border-b border-emerald-100/50 flex justify-between items-center bg-emerald-50/50 dark:bg-emerald-950/20">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                            <i class="fas fa-folder-open text-base"></i>
                        </div>
                        <div>
                            <h3 class="text-sm font-bold t-text-main">当前存储目录 (绝对路径)</h3>
                            <p class="text-[11px] t-text-muted">运行环境当前物理存储位置</p>
                        </div>
                    </div>
                    <button id="server-dir-close-x" class="t-text-muted hover:text-emerald-500 transition-colors">
                        <i class="fas fa-times text-lg"></i>
                    </button>
                </div>

                <!-- Body -->
                <div class="p-5 space-y-4 max-h-[75vh] overflow-y-auto custom-scrollbar">
                    <!-- Current Status Badges -->
                    <div class="flex flex-wrap gap-2 text-xs">
                        <span class="px-2.5 py-1 rounded-md font-medium ${data.isWebDAVSynced ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700'} flex items-center gap-1.5">
                            <i class="fas ${data.isWebDAVSynced ? 'fa-cloud' : 'fa-laptop'} text-xs"></i>
                            位置: ${data.rootType}
                        </span>
                        <span class="px-2.5 py-1 rounded-md font-medium ${isSeparated ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900' : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900'} flex items-center gap-1.5">
                            <i class="fas ${isSeparated ? 'fa-layer-group' : 'fa-folder'} text-xs"></i>
                            模式: ${isSeparated ? '仅下载已开启 (缓存与下载已分离)' : '仅下载未开启 (缓存与下载合并)'}
                        </span>
                        <span class="px-2.5 py-1 rounded-md font-medium bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-900 flex items-center gap-1.5">
                            <i class="fas fa-user text-xs"></i>
                            空间: ${data.username === '_open' ? '公开空间 (_open)' : data.username}
                        </span>
                    </div>

                    <!-- 缓存目录 -->
                    <div class="p-3.5 rounded-xl border t-border-main bg-gray-50/70 dark:bg-gray-800/40 space-y-2">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-bold t-text-main flex items-center gap-1.5">
                                <i class="fas fa-bolt text-amber-500"></i>
                                歌曲缓存目录
                            </span>
                            <button class="copy-dir-btn text-xs text-emerald-500 hover:underline flex items-center gap-1 cursor-pointer" data-path="${data.cacheDirectory.replace(/"/g, '&quot;')}">
                                <i class="far fa-copy"></i>
                                复制路径
                            </button>
                        </div>
                        <div class="p-2.5 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 select-all font-mono text-xs break-all text-gray-800 dark:text-gray-200 shadow-sm leading-relaxed">
                            ${data.cacheDirectory}
                        </div>
                        <p class="text-[11px] t-text-muted">播放时在线流式预加载及临时缓存文件存放处，受 LRU 容量自动限制与清理。</p>
                    </div>

                    <!-- 下载目录 -->
                    <div class="p-3.5 rounded-xl border t-border-main bg-gray-50/70 dark:bg-gray-800/40 space-y-2">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-bold t-text-main flex items-center gap-1.5">
                                <i class="fas fa-arrow-circle-down text-emerald-500"></i>
                                歌曲下载目录
                            </span>
                            <button class="copy-dir-btn text-xs text-emerald-500 hover:underline flex items-center gap-1 cursor-pointer" data-path="${data.downloadDirectory.replace(/"/g, '&quot;')}">
                                <i class="far fa-copy"></i>
                                复制路径
                            </button>
                        </div>
                        <div class="p-2.5 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 select-all font-mono text-xs break-all text-gray-800 dark:text-gray-200 shadow-sm leading-relaxed">
                            ${data.downloadDirectory}
                        </div>
                        <p class="text-[11px] t-text-muted">
                            ${isSeparated
                                ? '开启“仅下载模式”时，歌曲将独立持久保存在此目录，不参与缓存容量淘汰，洗版功能仅针对此目录生效。'
                                : '未开启“仅下载模式”时，下载歌曲与缓存歌曲合并存储在同一目录下。'}
                        </p>
                    </div>

                    <!-- 提示说明 -->
                    <div class="text-xs text-gray-500 dark:text-gray-400 p-3 rounded-lg bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 flex items-start gap-2">
                        <i class="fas fa-info-circle text-amber-500 mt-0.5 shrink-0"></i>
                        <div class="space-y-1">
                            <div>• <strong>缓存位置</strong>：选择「DATA_PATH」会将文件存放于 WebDAV 同步目录下，备份时可一并打包；选择「运行目录」则仅保存在当前服务器本地。</div>
                            <div>• <strong>仅下载模式</strong>：开启后下载路径变更为 <code class="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/60 font-mono text-[11px]">music${sep}${data.username}</code>；关闭时统一保存在 <code class="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/60 font-mono text-[11px]">cache${sep}${data.username}</code>。</div>
                        </div>
                    </div>
                </div>

                <!-- Footer -->
                <div class="p-4 t-bg-main/50 border-t t-border-main/50 flex justify-end">
                    <button id="server-dir-confirm" class="px-5 py-2 text-sm font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl shadow-lg transition-all active:scale-95">
                        我知道了
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const close = () => {
            const content = modal.querySelector('.max-w-lg');
            if (content) {
                content.classList.add('scale-95', 'opacity-0');
            }
            modal.classList.add('opacity-0');
            setTimeout(() => modal.remove(), 200);
        };

        modal.querySelector('#server-dir-close-x').onclick = close;
        modal.querySelector('#server-dir-confirm').onclick = close;
        modal.querySelector('div:first-child').onclick = close;

        modal.querySelectorAll('.copy-dir-btn').forEach(btn => {
            btn.onclick = async () => {
                const pathText = btn.getAttribute('data-path');
                if (!pathText) return;
                try {
                    await navigator.clipboard.writeText(pathText);
                    showToast('已复制绝对路径到剪贴板', 'success');
                } catch (e) {
                    showToast('复制失败，请手动全选复制', 'error');
                }
            };
        });
    } catch (err) {
        hideLoading();
        showToast('请求目录发生异常', 'error');
        console.error(err);
    }
}
window.showServerDirectories = showServerDirectories;


/**
 * playFromView handles user click on a song in the search/list view.
 * It ensures the playback queue is updated to match the viewed list.
 */
function playFromView(index) {
    if (!viewingPlaylist || !viewingPlaylist[index]) return;
    // Update playlist and scope when user explicitly clicks a song to play
    updatePlaylist(viewingPlaylist, index, currentSearchScope);
}
window.playFromView = playFromView;

async function runRecoveryFlow(error, state = currentRecoveryState) {
    if (!state) return;

    if (state !== currentRecoveryState) {
        console.log('[Recovery] Aborted because user played another song.');
        return;
    }

    const currentPlatform = state.currentSong?.source || state.originalSong?.source;

    // 1. 记录当前失败的音源脚本
    if (!state.triedApiSourcesByPlatform) {
        state.triedApiSourcesByPlatform = {};
    }
    if (!state.triedApiSourcesByPlatform[currentPlatform]) {
        state.triedApiSourcesByPlatform[currentPlatform] = [];
    }
    if (state.currentApiSourceName && !state.triedApiSourcesByPlatform[currentPlatform].includes(state.currentApiSourceName)) {
        state.triedApiSourcesByPlatform[currentPlatform].push(state.currentApiSourceName);
    }

    // 把第一个失败的源（无论是自定义源还是平台名）加到尝试轨迹里
    const firstFailedName = state.currentApiSourceName || currentPlatform;
    if (firstFailedName) {
        RecoveryToast.show(state.currentSong, '播放失败，启动智能换源...', {
            triedPlatform: firstFailedName,
            quality: state.currentQuality,
            status: 'failed'
        });
    }

    // 标记上一尝试失败 (兜底)
    if (state.currentSong) {
        RecoveryToast.markStepFailed(state.currentSong.source, state.currentQuality);
    }

    // 2. 优先尝试当前平台下的其它备选自定义源 (需开启「自动切换自定义源」设置)
    if (settings.enableAutoSwitchApiSource !== false && !state.samePlatformExhausted) {
        const triedSources = state.triedApiSourcesByPlatform[currentPlatform] || [];
        const platformName = typeof getSourceName === 'function' ? getSourceName(currentPlatform) : currentPlatform.toUpperCase();
        const failedName = state.currentApiSourceName || '当前自定义源';

        console.log(`[Recovery] [${platformName}] 音源 [${failedName}] 播放失败，尝试同平台其他备选源... 已排除:`, triedSources);
        // 这里不再传入 details 参数，避免将 QQ 作为多余的一项强行加入轨迹
        RecoveryToast.show(state.currentSong, `[${platformName}] ${failedName} 链接失效，正在尝试同平台其他备选源...`);

        try {
            const nextResult = await fetchSongUrl(
                state.currentSong,
                state.currentQuality,
                true, // isRetry
                false, // isSilent
                { excludeApiSources: triedSources }
            );

            if (state !== currentRecoveryState) {
                console.log('[Recovery] Aborted because user played another song during fetchSongUrl.');
                return;
            }

            if (nextResult && nextResult.url && !nextResult.errorMsg) {
                console.log(`[Recovery] ✓ 命中同平台备选源 [${nextResult.sourceName}]，准备重新缓冲播放`);
                state.currentApiSourceName = nextResult.sourceName || '';
                state.currentApiSourceId = nextResult.sourceId || '';
                state.currentHasMoreSources = !!nextResult.hasMoreSources;

                RecoveryToast.show(state.currentSong, `已切换至备选源 [${nextResult.sourceName || '备选源'}]，重新缓冲播放...`, {
                    triedPlatform: currentPlatform,
                    quality: state.currentQuality,
                    status: 'trying'
                });

                playSong(state.currentSong, state.currentIndex, state.currentQuality, false, true);
                return;
            }
        } catch (candidateErr) {
            console.warn(`[Recovery] [${platformName}] 所有备选自定义源均已尝试完毕:`, candidateErr.message || candidateErr);
            state.samePlatformExhausted = true;
        }
    }

    const { steps, currentStepIndex } = state;
    if (currentStepIndex >= steps.length) {
        // All recovery steps exhausted
        setPlayerStatus('播放失败');
        RecoveryToast.error(`所有备选源均无法播放: ${error.message || '未知错误'}`);
        updatePlayButton(false);
        return;
    }

    const currentStep = steps[currentStepIndex];
    console.log(`[Recovery] Executing recovery step: ${currentStep} (${currentStepIndex + 1}/${steps.length})`);

    if (currentStep === 'degrade') {
        const nextQuality = window.QualityManager.getNextLowerQuality(state.currentQuality, state.currentSong);
        if (nextQuality && !state.triedQualities.includes(nextQuality)) {
            state.currentQuality = nextQuality;
            state.triedQualities.push(nextQuality);
            state.samePlatformExhausted = false; // 新音质重新允许探测可用源

            const fromName = window.QualityManager.getQualityDisplayName(state.triedQualities[state.triedQualities.length - 2]);
            const toName = window.QualityManager.getQualityDisplayName(nextQuality);
            RecoveryToast.show(state.currentSong, `音质从 ${fromName} 降级至 ${toName} 播放...`, {
                triedPlatform: state.currentSong.source,
                quality: nextQuality,
                status: 'trying'
            });

            // Re-invoke playSong with isRetry = true so we don't reset recovery state
            playSong(state.currentSong, state.currentIndex, nextQuality, false, true);
        } else {
            // Quality degradation failed/exhausted, move to next recovery step
            state.currentStepIndex++;
            await runRecoveryFlow(error, state);
        }
    } else if (currentStep === 'switch_platform') {
        RecoveryToast.show(state.originalSong, '原平台所有音源均无法播放，正在全网搜索备选源...');
        const matches = await findOtherSourceMatches(state.originalSong);
        
        if (state !== currentRecoveryState) {
            console.log('[Recovery] Aborted because user played another song during findOtherSourceMatches.');
            return;
        }
        
        const matchedSong = matches.find(song => !state.triedPlatforms.includes(song.source));
        if (matchedSong) {
            state.currentSong = matchedSong;
            state.triedPlatforms.push(matchedSong.source);
            if (!state.triedApiSourcesByPlatform[matchedSong.source]) {
                state.triedApiSourcesByPlatform[matchedSong.source] = [];
            }
            state.currentApiSourceName = '';
            state.samePlatformExhausted = false; // 新平台重置源耗尽状态
            const bestNextQuality = window.QualityManager.getBestQuality(matchedSong, settings.preferredQuality || 'flac');
            state.currentQuality = bestNextQuality;
            state.triedQualities = [bestNextQuality];

            const platformName = getSourceName(matchedSong.source);
            const qualityName = window.QualityManager.getQualityDisplayName(bestNextQuality);
            RecoveryToast.show(matchedSong, `找到备选源，尝试从 [${platformName}] (${qualityName}) 播放...`, {
                triedPlatform: matchedSong.source,
                quality: bestNextQuality,
                status: 'trying'
            });
            // Keep this recovery step active so another platform can be tried if needed.
            playSong(matchedSong, state.currentIndex, bestNextQuality, false, true);
        } else {
            // No untried source remains, move to the next recovery strategy.
            state.currentStepIndex++;
            await runRecoveryFlow(error, state);
        }
    } else if (currentStep === 'skip_next') {
        const isPlatformNotSupported = error && error.message && (
            error.message.includes('未找到支持') ||
            error.message.includes('not supported')
        );
        RecoveryToast.error(`无法播放${isPlatformNotSupported ? '（不支持该平台）' : ''}，即将自动跳过`);
        setPlayerStatus('播放失败，即将跳过', null, true);
        if (window._autoSkipTimer) clearTimeout(window._autoSkipTimer);
        window._autoSkipTimer = setTimeout(() => playNext(), isPlatformNotSupported ? 2000 : 3000);
    }
}

async function playSong(song, index, forceQuality = null, noPlay = false, isRetry = false, shouldAddToDefault = null) {
    // 1. Debounce / Lock: If already loading this song, ignore click
    // [Fix] Allow retry to bypass this check
    if (currentLoadingSongId === song.id && !isRetry) {
        console.log(`[Player] Already loading ${song.name}, ignoring request.`);
        return;
    }

    // 2. New Song Request: Update target
    const thisRequestSongId = song.id;
    // Clear any pending auto-skip timer
    if (window._autoSkipTimer) {
        clearTimeout(window._autoSkipTimer);
        window._autoSkipTimer = null;
    }

    const thisRequestId = ++loadingRequestCounter;
    currentLoadingSongId = thisRequestSongId;
    currentLoadingRequestId = thisRequestId;
    shouldAutoRecoverPlayback = false;
    playbackRecoveryTriggeredForRequestId = 0;

    if (currentPlaybackErrorHandler) {
        audio.removeEventListener('error', currentPlaybackErrorHandler);
        currentPlaybackErrorHandler = null;
    }

    if (!isRetry) {
        const order = (settings.playbackErrorPriority || 'platform,quality,next').split(',');
        const steps = [];
        for (const key of order) {
            if (key === 'quality' && settings.enableAutoDegradeQuality !== false) {
                steps.push('degrade');
            } else if (key === 'platform' && settings.enableAutoSwitchSource !== false) {
                steps.push('switch_platform');
            } else if (key === 'next' && settings.enableAutoSkipOnError !== false) {
                steps.push('skip_next');
            }
        }

        const startQuality = forceQuality || window.QualityManager.getBestQuality(song, settings.preferredQuality || 'flac');

        currentRecoveryState = {
            originalSong: song,
            currentIndex: index,
            currentSong: song,
            originalQuality: startQuality,
            currentQuality: startQuality,
            triedQualities: [startQuality],
            triedPlatforms: [song.source],
            triedApiSourcesByPlatform: { [song.source]: [] },
            currentApiSourceName: '',
            samePlatformExhausted: false,
            steps: steps,
            currentStepIndex: 0,
            thisRequestId: thisRequestId
        };
    } else {
        if (currentRecoveryState) {
            currentRecoveryState.thisRequestId = thisRequestId;
        }
    }

    currentIndex = index;
    // [Random Prefetch Fix] 一旦开始正式播放一首歌曲，清除之前的预选索引，以便下一轮重新生成
    preSelectedNextIndex = null;

    currentPlayingSong = song;
    window.currentPlayingSong = song; // expose for lyric-card.js
    // The advertised quality is not necessarily the quality that will be played.
    // Clear the previous song's quality until URL resolution confirms the actual one.
    updatePlayerInfo(song, null);
    updateMediaSessionMetadata(song);
    // 异步触发歌词抓取，初步尝试（此时音质可能尚未最终确定，但在 playSong 后续逻辑中会再次同步）
    fetchLyric(song);

    // Refresh queue UI if drawer is open to update active indicator
    const queueDrawer = document.getElementById('queue-drawer');
    if (queueDrawer && !queueDrawer.classList.contains('translate-x-full')) {
        renderQueue();
    }

    // [Fix] 切换歌曲前强制重置手动滚动状态
    isUserScrolling = false;
    if (scrollLockTimeout) {
        clearTimeout(scrollLockTimeout);
        scrollLockTimeout = null;
    }
    const indicator = document.getElementById('lyric-scroll-indicator');
    if (indicator) {
        indicator.classList.add('hidden');
        indicator.style.display = 'none';
    }

    // Show persistent loading toast
    if (!isRetry) {
        RecoveryToast.dismiss();
        showInfo(`正在加载: ${song.name}...`);
    } else if (isRetry === true) {
        if (!RecoveryToast.isActive()) {
            showInfo(`链接过期或失效，正在为您重新在线解析: ${song.name}...`);
        }
    }

    // 处理切换提示的显示与隐藏
    const hint = document.getElementById('toggle-hint');
    if (hint) {
        // 重置为可见：清理内联样式，恢复 CSS 类定义的默认状态 (opacity-80, max-h-8, mt-2)
        hint.style.opacity = '';
        hint.style.maxHeight = '';
        hint.style.marginTop = '';
        hint.classList.remove('opacity-0');

        if (hintTimeout) clearTimeout(hintTimeout);
        hintTimeout = setTimeout(() => {
            // 强制使用内联样式隐藏并收起占位
            hint.style.opacity = '0';
            hint.style.maxHeight = '0px';
            hint.style.marginTop = '0px';
        }, 5000);
    }

    // 显示加载状态
    setPlayerStatus('正在准备播放', null, true);

    let targetQuality = forceQuality;
    let isPrefetchFound = false;
    let urlResult = null;

    // 提前检查预读缓存，以便淡出逻辑使用
    if (!targetQuality && !isRetry) {
        urlResult = prefetchManager.get(song.id);
        if (urlResult) {
            urlResult.isPrefetch = true;
            isPrefetchFound = true;

            // [Optimize] 既然主播放器即将接管该 URL，立即清空缓冲器 src 以停止其后台加载
            prefetchManager.bufferer.src = '';
        }
    }

    // [Crossfade] 如果开启了淡入淡出，则先执行淡出
    if (settings.enableCrossfade && !noPlay && audio && !audio.paused && !audio.ended && audio.src) {
        await fadeVolume(0, 300);
    }

    if (!noPlay) {
        try { audio.pause(); } catch (e) { }
    }
    updatePlayButton(false);

    try {
        // 1. 智能音质选择与 URL 解析
        if (!urlResult) {
            if (!targetQuality) {
                targetQuality = window.QualityManager.getBestQuality(song, settings.preferredQuality || 'flac');
            }
            setPlayerStatus('正在获取播放链接', null, true);
            urlResult = await resolveSongUrl(song, targetQuality, false, isRetry, !noPlay);
        }

        // 2. Stale Check
        if (currentLoadingRequestId !== thisRequestId) return;

        if (currentRecoveryState) {
            currentRecoveryState.currentApiSourceName = urlResult.sourceName || '';
            currentRecoveryState.currentApiSourceId = urlResult.sourceId || '';
            currentRecoveryState.currentHasMoreSources = !!urlResult.hasMoreSources;
        }

        // [Fix] 移除 dismissAllToasts()，允许成功/失败/尝试信息的 Toast 共存堆叠

        // Display attempts / success message
        const sourceText = getSourceTypeText(urlResult.sourceType);
        const sourceName = urlResult.sourceName || '';

        if (urlResult.isPrefetch) {
            let detail = '解析成功';
            if (urlResult.sourceType === 'cache') detail = '命中缓存链接';
            else if (urlResult.sourceType === 'server_cache') detail = '命中本地文件';
            else if (sourceName) detail = `${sourceName} 解析成功`;
            showSuccess(`[预读] ${song.name} ${detail}`);
        } else if (urlResult.sourceType !== 'normal') {
            // 非在线解析（如命中本地/服务器缓存），WebSocket 进度不会触发，需手动显示
            if (!RecoveryToast.isActive()) {
                showSuccess(`[${song.name}] 命中${sourceText}`);
            }
        }
        // 在线解析 (sourceType === 'normal') 的成功提示已由 fetchSongUrl 中的进度监听处理，此处不再重复显示

        // [Real-time Progress handles attempts now via WebSocket]

        if (urlResult.errorMsg) {
            showError(urlResult.errorMsg);
        }

        let finalUrl = urlResult.url;
        currentQuality = urlResult.quality;
        currentSourceType = urlResult.sourceType;
        const playbackSong = (urlResult.switchedSource && urlResult.songInfo) ? urlResult.songInfo : song;
        if (playbackSong !== song) {
            currentPlayingSong = playbackSong;
            window.currentPlayingSong = playbackSong;
            if (currentRecoveryState) {
                currentRecoveryState.currentSong = playbackSong;
                if (playbackSong.source && !currentRecoveryState.triedPlatforms.includes(playbackSong.source)) {
                    currentRecoveryState.triedPlatforms.push(playbackSong.source);
                }
            }
            updateMediaSessionMetadata(playbackSong);
            fetchLyric(playbackSong, currentQuality);
        }
        // Always refresh the bottom-player badge, including cache hits that keep the same song object.
        updatePlayerInfo(playbackSong, currentQuality);

        // [Sync] 确定了最终播放音质后，直接以正确音质重写服务器端歌词缓存文件名
        // 注意：不能再调用 fetchLyric(song)，因为歌词已就绪时 fetchLyric 会提前返回，
        // 永远不会走到写入服务器缓存的逻辑，导致文件名停留在音质未确定时的错误值。
        if (settings.enableServerLyricCache !== false && currentRawLrc) {
            try {
                const _lyricHeaders = { 'Content-Type': 'application/json' };
                Object.assign(_lyricHeaders, getUserAuthHeaders());
                // x-user-token 现在由 getUserAuthHeaders 统一管理
                fetch(`${API_BASE}/cache/lyric`, {
                    method: 'POST',
                    headers: _lyricHeaders,
                    body: JSON.stringify({
                        songInfo: { ...playbackSong, quality: currentQuality },
                        lyricsObj: { lyric: currentRawLrc, tlyric: currentRawTlrc, rlyric: currentRawRlrc, lxlyric: currentRawKlrc }
                    })
                }).catch(e => console.warn('[Lyric] 音质确定后重写服务端缓存失败:', e));
            } catch (e) { }
        }

        // [Removed] 这里的代理逻辑已统一移动至 fetchSongUrl 阶段处理，确保预加载地址一致性

        // Media errors happen asynchronously after play() resolves, so every source
        // needs an explicit recovery entry point.
        currentPlaybackErrorHandler = () => {
            if (!currentRecoveryState || currentRecoveryState.thisRequestId !== thisRequestId) return;
            currentPlaybackErrorHandler = null;

            if (currentSourceType !== 'normal') {
                shouldAutoRecoverPlayback = false;
                console.warn(`[Player] ${currentSourceType} link failed, retrying online...`);
                if (currentSourceType === 'cache') localStorage.removeItem(`lx_url_${cleanSongData(playbackSong).id}_${currentQuality || targetQuality}`);
                playSong(playbackSong, index, targetQuality, noPlay, currentSourceType === 'server_cache' ? 'local_retry' : true);
                return;
            }

            playbackRecoveryTriggeredForRequestId = thisRequestId;
            shouldAutoRecoverPlayback = false;
            try {
                localStorage.removeItem(`lx_url_${cleanSongData(playbackSong).id}_${currentQuality || targetQuality}`);
            } catch (e) { }
            const mediaError = audio.error || new Error('媒体播放失败');
            void runRecoveryFlow(mediaError);
        };
        audio.addEventListener('error', currentPlaybackErrorHandler, { once: true });

        audio.src = finalUrl;

        if (noPlay) {
            setPlayerStatus('', false);
            updatePlayButton(false);
            if (window._resumeInfo && window._resumeInfo.time > 0) {
                audio.addEventListener('loadedmetadata', () => {
                    audio.currentTime = window._resumeInfo.time;
                    delete window._resumeInfo;
                }, { once: true });
            }
            return;
        }

        try {
            if (settings.enableCrossfade) audio.volume = 0;
            else audio.volume = typeof currentVolume !== 'undefined' ? currentVolume : 1;

            shouldAutoRecoverPlayback = true;
            await audio.play();

            if (settings.enableCrossfade) fadeVolume(typeof currentVolume !== 'undefined' ? currentVolume : 1, 1000);

            setPlayerStatus('', true);
            updatePlayButton(true);

            if (RecoveryToast.isActive()) {
                const targetPlatform = typeof getSourceName === 'function' ? getSourceName(playbackSong.source) : playbackSong.source.toUpperCase();
                const targetQualityName = currentQuality && window.QualityManager ? window.QualityManager.getQualityDisplayName(currentQuality) : (currentQuality || '').toUpperCase();
                RecoveryToast.success(`已成功换至 [${targetPlatform}] ${targetQualityName} 播放`);
            }

            // Save history and handle list logic
            savePlayHistory(playbackSong, currentQuality);
            const finalAdd = shouldAddToDefault !== null ? shouldAddToDefault : (currentPlayingScope === 'network' || currentPlayingScope === 'songlist' || currentPlayingScope === 'leaderboard');
            if (finalAdd) {
                addToDefaultList(playbackSong);
                // 切换逻辑说明：
                // - 搜索结果(network)：updatePlaylist 把队列设为搜索结果，开启设置才把队列切换到 defaultList
                // - 歌单/排行榜(songlist/leaderboard)：updatePlaylist 已把队列设为歌单/排行榜，
                //   开启设置=保持歌单/排行榜队列(do nothing)，关闭设置=退回 defaultList
                const isSongListOrLeaderboard = currentPlayingScope === 'songlist' || currentPlayingScope === 'leaderboard';
                if (isSongListOrLeaderboard) {
                    // 歌单/排行榜：关闭"切换歌单"时，才退回 defaultList
                    const shouldFallback = settings.switchPlaylistOnSongListPlay === false;
                    if (shouldFallback && typeof currentListData !== 'undefined' && currentListData.defaultList) {
                        currentPlaylist = currentListData.defaultList;
                        currentIndex = 0;
                        currentPlayingScope = 'local_list';
                        window.currentViewingListId = 'default';
                    }
                } else {
                    // 搜索结果：关闭"切换歌单"时，才退回 defaultList
                    const shouldSearchFallback = settings.switchPlaylistOnSearchPlay === false;
                    if (shouldSearchFallback && typeof currentListData !== 'undefined' && currentListData.defaultList) {
                        currentPlaylist = currentListData.defaultList;
                        currentIndex = 0;
                        currentPlayingScope = 'local_list';
                        window.currentViewingListId = 'default';
                    }
                }
            }
        } catch (playError) {
            // Only browser autoplay blocking needs a manual click. Decode, network,
            // and unsupported-source failures should continue through auto recovery.
            if (currentLoadingRequestId !== thisRequestId) return;
            const isAbort = playError && (playError.name === 'AbortError' || playError.code === 20);
            if (isAbort) {
                shouldAutoRecoverPlayback = false;
                return;
            }

            const isAutoplayBlocked = playError && playError.name === 'NotAllowedError';
            if (isAutoplayBlocked) {
                shouldAutoRecoverPlayback = false;
                console.warn('[Player] Playback blocked by browser autoplay policy:', playError);
                setPlayerStatus('请点击播放按钮');
            } else if (currentRecoveryState && currentRecoveryState.thisRequestId === thisRequestId) {
                shouldAutoRecoverPlayback = false;
                playbackRecoveryTriggeredForRequestId = thisRequestId;
                console.error('[Player] Playback failed:', playError);
                await runRecoveryFlow(playError);
            }
        }

        // [Trigger Prefetch] 确保即便 play() 被拦截也尝试发起下一首预读
        prefetchNextSong();

    } catch (error) {
        if (currentLoadingRequestId !== thisRequestId) return;
        console.error('[Player] Error:', error);

        if (currentRecoveryState && currentRecoveryState.thisRequestId === thisRequestId && !noPlay) {
            await runRecoveryFlow(error);
        } else {
            setPlayerStatus('播放失败');
            showError(`播放失败: ${error.message || '未知错误'}`);
            updatePlayButton(false);
        }
    } finally {
        if (currentLoadingRequestId === thisRequestId) {
            currentLoadingRequestId = 0;
            currentLoadingSongId = null;
        }
    }
}

// 设置播放器状态文本
/**
 * 设置播放器状态文本
 * @param {string} status 状态文本
 * @param {boolean|null} isPlaying 播放状态
 * @param {boolean} isLoading 是否显示加载/缓冲动画
 */
function setPlayerStatus(status, isPlaying = null, isLoading = false) {
    const statusEl = document.getElementById('player-status');
    if (!statusEl) return;

    // 如果指定了加载状态，自动应用跳动动画
    if (isLoading && typeof status === 'string') {
        statusEl.innerHTML = `<span class="animate-loading-dots">${status}<span>.</span><span>.</span><span>.</span></span>`;
        return;
    }

    // 处理其他固定文本状态
    if (typeof status === 'string' && (status.includes('请点击') || status.includes('即将跳过'))) {
        // [Fix] 如果音频已经在播放，忽略“请点击”提示，直接落入下方获取实时状态逻辑，避免 UI 冲突
        if (status.includes('请点击') && audio && !audio.paused) {
            // Fall through to show real playStatus
        } else {
            statusEl.innerText = status;
            return;
        }
    }

    // 构建状态文本
    let statusText = '';

    // 确定播放状态
    if (isPlaying === null) {
        // 从 audio 元素获取当前状态
        isPlaying = !audio.paused;
    }

    const playStatus = isPlaying ? '播放中' : '暂停中';


    // 获取音质显示名称
    const qualityName = currentQuality ? window.QualityManager.getQualityDisplayName(currentQuality) : '';

    // 组合状态文本
    if (qualityName) {
        statusText = `${playStatus} (${qualityName})`;
    } else {
        statusText = playStatus;
    }

    // 根据链接来源添加提示
    if (currentSourceType === 'cache') {
        statusText += ' 【缓存链接】';
    } else if (currentSourceType === 'server_cache') {
        statusText += ' 【服务器缓存】';
    }

    statusEl.innerText = statusText;
}


// 保存播放历史
function savePlayHistory(song, quality) {
    try {
        const history = JSON.parse(localStorage.getItem('play_history') || '[]');
        history.unshift({
            ...song,
            quality,
            playedAt: Date.now()
        });
        // 只保留最近 50 条
        localStorage.setItem('play_history', JSON.stringify(history.slice(0, 50)));
    } catch (e) {
        console.error('[Player] 保存播放历史失败:', e);
    }
}

function getConfiguredAddMusicLocationType() {
    return window.CONFIG && window.CONFIG['list.addMusicLocationType'] === 'bottom' ? 'bottom' : 'top';
}

function addMusicByConfiguredLocation(list, music) {
    const addMusicLocationType = getConfiguredAddMusicLocationType();
    if (addMusicLocationType === 'bottom') {
        list.push(music);
    } else {
        list.unshift(music);
    }
    return addMusicLocationType;
}

// 添加到默认列表 (试听列表)
async function addToDefaultList(song) {
    if (!currentListData || !currentListData.defaultList) return;

    try {
        const cleanedData = cleanSongData(song);
        const targetId = cleanedData.id;
        const list = currentListData.defaultList;

        // Check if exists
        const idx = list.findIndex(s => s.id === targetId);

        if (idx !== -1) {
            // Already exists, move to top
            list.splice(idx, 1);
        }

        const addMusicLocationType = addMusicByConfiguredLocation(list, cleanedData);

        // Limit size to avoid bloat (e.g., 200 songs)
        if (list.length > 200) {
            if (addMusicLocationType === 'bottom') {
                list.splice(0, list.length - 200);
            } else {
                list.length = 200;
            }
        }

        // Sync
        await pushDataChange();

        // Refresh sidebar to update count
        renderMyLists(currentListData);
    } catch (e) {
        console.error('[DefaultList] 添加失败:', e);
    }
}

/**
 * 更新当前播放列表并开始播放指定歌曲
 * @param {Array} list 歌曲列表
 * @param {number} startIndex 开始播放的索引 (默认 0)
 * @param {string} scope 搜索范围/来源 (用于播放逻辑识别)
 * @param {boolean} shouldAddToDefault 是否加入默认(试听)列表
 */
function updatePlaylist(list, startIndex = 0, scope = 'local_list', shouldAddToDefault = null) {
    if (!list || list.length === 0) {
        showError('播放列表为空');
        return;
    }

    // [New] Deduplicate by quality if setting enabled
    if (settings.deduplicatePlaylistByQuality && window.QualityManager) {
        const targetSong = list[startIndex];
        const targetId = targetSong ? (targetSong.songmid || targetSong.id) : null;

        const deduplicated = [];
        const seenIds = new Map(); // id -> index in deduplicated

        list.forEach((song) => {
            const id = song.songmid || song.id;
            if (!id) {
                deduplicated.push(song);
                return;
            }

            const qualityAttr = song.quality || song.type || '128k';

            if (seenIds.has(id)) {
                const existingIdx = seenIds.get(id);
                const existingSong = deduplicated[existingIdx];
                const existingQuality = existingSong.quality || existingSong.type || '128k';

                const p1 = window.QualityManager.QUALITY_PRIORITY.indexOf(existingQuality);
                const p2 = window.QualityManager.QUALITY_PRIORITY.indexOf(qualityAttr);

                // Priority index: smaller means better quality.
                // Lower index is higher quality
                if (p2 !== -1 && (p1 === -1 || p2 < p1)) {
                    deduplicated[existingIdx] = song;
                }
            } else {
                seenIds.set(id, deduplicated.length);
                deduplicated.push(song);
            }
        });

        // Find new startIndex based on targetId (identity matching)
        if (targetId) {
            const newIndex = deduplicated.findIndex(s => (s.songmid || s.id) === targetId);
            if (newIndex !== -1) startIndex = newIndex;
        }

        list = deduplicated;
    }

    // [New] Use a shallow copy to prevent mutations from affecting the source list
    currentPlaylist = [...list];
    currentPlayingScope = scope;

    // 如果是从网络搜索或歌单来源，确保 playSong 能识别并更新 UI/历史
    playSong(currentPlaylist[startIndex], startIndex, null, false, false, shouldAddToDefault);

    console.log(`[Queue] 播放列表已更新 (${currentPlaylist.length} 首), 来源: ${scope}, 加入默认列表: ${shouldAddToDefault}`);

    // Refresh queue UI if it's open
    if (!document.getElementById('queue-drawer').classList.contains('translate-x-full')) {
        renderQueue();
    }
}
window.updatePlaylist = updatePlaylist;

// 显示错误提示（现代化 Toast）
// 移除旧版 showError，由后文统一的 showToast 驱动
// 占位图片变色

// 全局图片设置助手，处理占位图逻辑
window.setImg = (id, src) => {
    const el = document.getElementById(id);
    if (el) {
        // 如果是从占位图切换到真实图片，保留滤镜直到加载完成
        if (el.src.includes('logo.svg') && src && !src.includes('logo.svg')) {
            el.classList.add('is-placeholder');
            const handleLoad = () => {
                el.classList.remove('is-placeholder');
                el.removeEventListener('load', handleLoad);
                el.removeEventListener('error', handleLoad); // 失败也移除
            };
            el.addEventListener('load', handleLoad);
            el.addEventListener('error', handleLoad);
        } else if (src && src.includes('logo.svg')) {
            el.classList.add('is-placeholder');
        } else {
            el.classList.remove('is-placeholder');
        }

        if (src) el.src = src;
        el.onerror = () => {
            el.src = '/music/assets/logo.svg';
            el.classList.add('is-placeholder');
        };
    }
};

function updatePlayerInfo(song, actualQuality) {
    // Bottom Player - 更新标题
    const titleEl = document.getElementById('player-title');
    if (titleEl) {
        titleEl.innerText = song.name;
        titleEl.setAttribute('data-text', song.name);
        titleEl.classList.add('truncate');
        titleEl.classList.remove('overflow-hidden');

        // 点击搜索此歌曲
        titleEl.onclick = (e) => {
            e.stopPropagation();
            performSearch(song.name, song.source);
        };
        titleEl.classList.add('hover:text-emerald-500', 'cursor-pointer', 'transition-colors');
    }

    // Bottom Player - 更新来源标签
    const sourceEl = document.getElementById('player-source');
    if (sourceEl) {
        if (song.source) {
            // Without an explicitly resolved quality, only show the source.
            // This prevents the player's badge from claiming a higher advertised quality.
            const resolvedQuality = actualQuality === undefined
                ? (song === currentPlayingSong ? currentQuality : null)
                : actualQuality;
            const qualityTags = resolvedQuality ? getQualityTags({ quality: resolvedQuality }) : '';
            sourceEl.innerHTML = getSourceTag(song.source) + qualityTags;
            sourceEl.classList.remove('hidden');
        } else {
            sourceEl.innerHTML = '';
            sourceEl.classList.add('hidden');
        }
    }

    // Bottom Player - 更新艺术家
    const artistEl = document.getElementById('player-artist');
    if (artistEl) {
        artistEl.innerText = song.singer;
        artistEl.setAttribute('data-text', song.singer);
        artistEl.classList.add('truncate');
        artistEl.classList.remove('overflow-hidden');

        // 点击搜索此歌手
        artistEl.onclick = async (e) => {
            e.stopPropagation();
            const singers = song.singer.split(/[、&,，]| \/ /).map(s => s.trim()).filter(s => s);
            if (singers.length > 1) {
                const selected = await showOptions('搜索歌手', '识别到多个歌手，请选择要搜索的对象：', singers);
                if (selected) performSearch(selected, song.source);
            } else {
                performSearch(song.singer, song.source);
            }
        };
        artistEl.classList.add('hover:text-emerald-500', 'cursor-pointer', 'transition-colors');
    }

    // 触发滚动检测
    applyMarqueeChecks();

    const imgUrl = getImgUrl(song);

    setImg('player-cover', imgUrl);
    setImg('sidebar-cover', imgUrl);
    setImg('detail-cover', imgUrl);

    // Sidebar Mini Info
    document.getElementById('sidebar-song-info').classList.remove('hidden');
    const sideSongName = document.getElementById('sidebar-song-name');
    if (sideSongName) {
        sideSongName.innerText = song.name;
        sideSongName.onclick = (e) => {
            e.stopPropagation();
            performSearch(song.name, song.source);
        };
        sideSongName.classList.add('hover:text-emerald-500', 'cursor-pointer', 'transition-colors');
    }
    const sideSinger = document.getElementById('sidebar-singer');
    if (sideSinger) {
        sideSinger.innerText = song.singer;
        sideSinger.onclick = (e) => {
            e.stopPropagation();
            performSearch(song.singer, song.source);
        };
        sideSinger.classList.add('hover:text-emerald-500', 'cursor-pointer', 'transition-colors');
    }

    // Detail View Info (Lyrics Page)
    const detailTitle = document.getElementById('detail-title');
    const detailContainer = document.getElementById('detail-title-container');

    if (detailTitle && detailContainer) {
        // 直接设置文本，由 CSS 处理双行换行和省略号
        detailTitle.innerText = song.name;
        detailTitle.classList.remove('animate-marquee');
        detailTitle.onclick = (e) => {
            e.stopPropagation();
            if (window.innerWidth < 1025) {
                toggleDetailCover();
            } else {
                performSearch(song.name, song.source);
            }
        };
        detailTitle.classList.add('hover:text-emerald-500', 'cursor-pointer', 'transition-colors');
    }

    const detailArtist = document.getElementById('detail-artist');
    if (detailArtist) {
        detailArtist.innerText = song.singer;
        detailArtist.onclick = async (e) => {
            e.stopPropagation();
            if (window.innerWidth < 1025) {
                toggleDetailCover();
            } else {
                // 处理多个歌手的情况
                const singers = song.singer.split(/[、&,，]| \/ /).map(s => s.trim()).filter(s => s);
                if (singers.length > 1) {
                    const selected = await showOptions('搜索歌手', '识别到多个歌手，请选择要搜索的对象：', singers);
                    if (selected) performSearch(selected, song.source);
                } else {
                    performSearch(song.singer, song.source);
                }
            }
        };
        detailArtist.classList.add('hover:text-emerald-500', 'cursor-pointer', 'transition-colors');
    }


    // Update Like Button State (Collection Status)
    const btnLike = document.getElementById('player-like-btn');

    let isCollected = false;
    const activeListData = isUserLoggedIn() ? (window.myPersonalListData || currentListData) : currentListData;
    if (activeListData && song) {
        // 使用与添加时一致的标准化 ID 进行检查
        const cleanedSong = cleanSongData(song);
        if (cleanedSong) {
            const targetId = cleanedSong.id;
            if (activeListData.loveList && activeListData.loveList.some(s => s.id === targetId)) isCollected = true;
            if (!isCollected && activeListData.userList && activeListData.userList.some(ul => ul.list.some(s => s.id === targetId))) isCollected = true;
        }
    }

    // Bind click to Open Modal
    btnLike.onclick = (e) => {
        e.stopPropagation();
        openPlaylistAddModal();
    };

    if (isCollected) {
        btnLike.classList.add('text-red-500');
        btnLike.classList.remove('text-gray-300');
    } else {
        btnLike.classList.remove('text-red-500');
        btnLike.classList.add('text-gray-300');
    }
}

async function togglePlay() {
    // 忽略因为长按触发的 click 事件
    if (window.playBtnIsLongPress) {
        window.playBtnIsLongPress = false;
        return;
    }

    if (audio.paused) {
        try {
            // [Crossfade] 如果开启了淡入淡出，先将进度置为 0，播放后再淡入
            if (settings.enableCrossfade) {
                audio.volume = 0;
            }
            shouldAutoRecoverPlayback = true;
            await audio.play();
            updatePlayButton(true);

            if (settings.enableCrossfade) {
                fadeVolume(typeof currentVolume !== 'undefined' ? currentVolume : 1, 600);
            }
        } catch (e) {
            shouldAutoRecoverPlayback = false;
            console.error("[Player] Play blocked:", e);
        }
    } else {
        // [Crossfade] 如果开启了淡入淡出，先淡出再暂停
        if (settings.enableCrossfade) {
            await fadeVolume(0, 600);
        }
        shouldAutoRecoverPlayback = false;
        audio.pause();
        if (window._autoSkipTimer) {
            clearTimeout(window._autoSkipTimer);
            window._autoSkipTimer = null;
        }
        updatePlayButton(false);
    }
}

function updatePlayButton(isPlaying) {
    const btn = document.getElementById('btn-play');
    btn.innerHTML = isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play ml-1"></i>';
}

/**
 * 播放下一首。具备自动跳过被预读器标记为“不可解析”的歌曲的能力。
 * @param {Number} depth 递归尝试深度，防止死循环
 */
function playNext(depth = 0) {
    if (depth > 10) {
        console.warn('[Queue] Too many unplayable songs skipped, stopping.');
        return;
    }

    const nextIndex = getNextIndex();
    if (nextIndex !== -1 && currentPlaylist[nextIndex]) {
        const nextSong = currentPlaylist[nextIndex];

        // [Logic Fix] 如果这首歌在预读中已经被确认不可解析，直接跳过到再下一首
        if (nextSong._unplayable && nextIndex !== currentIndex) {
            console.log(`[Queue] Auto-skipping unplayable song [${nextIndex}]: ${nextSong.name}`);
            currentIndex = nextIndex; // 更新当前索引以便 getNextIndex() 能找到下一首
            return playNext(depth + 1);
        }

        playSong(nextSong, nextIndex);
    } else {
        console.log('[Queue] No next song or reached end of order playlist');
    }
}

function playPrev() {
    if (currentPlaylist.length === 0) return;

    let prevIndex;

    switch (playMode) {
        case 'single':
            // 单曲循环：继续播放当前歌曲
            prevIndex = currentIndex;
            break;

        case 'random':
            // 随机播放：随机选择一首（避免重复播放当前歌曲）
            if (currentPlaylist.length === 1) {
                prevIndex = 0;
            } else {
                do {
                    prevIndex = Math.floor(Math.random() * currentPlaylist.length);
                } while (prevIndex === currentIndex);
            }
            break;

        case 'order':
        case 'list':
        default:
            // 列表循环 & 顺序播放：播放上一首
            prevIndex = currentIndex - 1;
            if (prevIndex < 0) prevIndex = currentPlaylist.length - 1;
            break;
    }

    playSong(currentPlaylist[prevIndex], prevIndex);
}

// 音量淡入淡出辅助函数
let volumeFadeInterval = null;
function fadeVolume(targetVolume, duration = 800) {
    if (volumeFadeInterval) clearInterval(volumeFadeInterval);

    const startVolume = audio.volume;
    const steps = 20;
    const increment = (targetVolume - startVolume) / steps;
    const stepTime = duration / steps;
    let currentStep = 0;

    return new Promise((resolve) => {
        volumeFadeInterval = setInterval(() => {
            currentStep++;
            let nextVolume = startVolume + (increment * currentStep);

            // 边界检查
            if (nextVolume < 0) nextVolume = 0;
            if (nextVolume > 1) nextVolume = 1;

            audio.volume = nextVolume;

            if (currentStep >= steps) {
                clearInterval(volumeFadeInterval);
                audio.volume = targetVolume;
                resolve();
            }
        }, stepTime);
    });
}

// Audio Events
audio.addEventListener('timeupdate', () => {
    if (isDragging === 'progress') return; // Skip updating UI while user is dragging

    const current = audio.currentTime;
    const duration = audio.duration;

    // [Crossfade] 自然播放接近结束时提前淡出
    if (settings.enableCrossfade && duration > 5 && (duration - current < 1.0)) {
        if (!window._isFadingOut) {
            window._isFadingOut = true;
            fadeVolume(0, 1000);
        }
    } else if (duration - current > 1.5) {
        window._isFadingOut = false;
    }

    document.getElementById('time-current').innerText = formatTime(current);
    document.getElementById('time-total').innerText = formatTime(duration);

    const pct = (current / duration) * 100;
    document.getElementById('progress-bar').style.width = `${pct}%`;

    // [iOS Fix] Throttled Media Session Position update for Dynamic Island / Lock Screen
    // 每秒同步一次进度，防止 iOS 将 Web Audio 桥接流识别为不可拖拽的“直播”
    const now = Date.now();
    if ('mediaSession' in navigator && (!window._lastMedPosUpdate || now - window._lastMedPosUpdate > 1000)) {
        updatePositionState();
        window._lastMedPosUpdate = now;
    }

    // 自动恢复：保存播放进度 (节流)
    if (settings.autoResume && (!window._lastStateSave || now - window._lastStateSave > 5000)) {
        savePlaybackState();
        window._lastStateSave = now;
    }
});

// Screen Wake Lock (NoSleep.js) Wrapper
let noSleepInstance = null;
function toggleNoSleep(enable) {
    if (typeof NoSleep === 'undefined') return;
    if (!noSleepInstance) {
        noSleepInstance = new NoSleep();
    }
    if (enable && settings.keepScreenAwake) {
        if (!noSleepInstance.isEnabled) {
            noSleepInstance.enable().catch(e => console.warn('[NoSleep] 启用失败:', e));
        }
    } else {
        if (noSleepInstance && noSleepInstance.isEnabled) {
            noSleepInstance.disable();
        }
    }
}

// Update Media Session State on Play/Pause
audio.addEventListener('play', () => {
    toggleNoSleep(true);
    // 确保播放时应用设置的倍速
    audio.playbackRate = currentPlaybackRate;

    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
        updatePositionState(); // 恢复调用，防止播放瞬间系统推断的外插值错误飞越到最后
    }

    // [Fix] 这里的状态更新确保 UI 与实际播放状态同步 (e.g. 键盘媒体键控制)
    setPlayerStatus('', true); // 使用智能状态显示
    updatePlayButton(true);

    // [Notice] 我们不再在这里调用 lyricPlayer.play，而是等待 'playing' 事件
    // 这样可以避免在网络缓冲时歌词就开始跑
    if (lyricPlayer) {
        isUserScrolling = false; // 切回自动滚动模式

        // 隐藏滚动指示器
        const indicator = document.getElementById('lyric-scroll-indicator');
        if (indicator) {
            indicator.classList.add('hidden');
            indicator.style.display = 'none';
        }
    }
});

audio.addEventListener('playing', () => {
    // [Fix] 'playing' 事件表示音频真正开始震动输出，此时同步最准确
    setPlayerStatus('', true); // 恢复正常播放状态
    if ('mediaSession' in navigator) {
        updatePositionState(); // 立即同步

        // [iOS Stability Fix] 针对 iOS 刷新后失效的问题，在 500ms 和 1200ms 再次强制刷新
        // 确保系统在处理完 Web Audio 桥接流后，能再次接收到正确、有时长的 PositionState
        setTimeout(updatePositionState, 500);
        setTimeout(updatePositionState, 1200);
    }
    if (lyricPlayer) {
        lyricPlayer.play(audio.currentTime * 1000);
        isUserScrolling = false;
        scrollToActiveLine(true); // 强制对齐
    }
});

audio.addEventListener('pause', () => {
    toggleNoSleep(false);
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
    }

    // [Fix] 这里的状态更新确保 UI 与实际播放状态同步
    setPlayerStatus('', false); // 使用智能状态显示
    updatePlayButton(false);
    handleUnexpectedPlaybackPause();

    if (lyricPlayer) {
        lyricPlayer.pause();
    }
    if (wordAnimationId) cancelAnimationFrame(wordAnimationId); // 立即停止行动画
    if (settings.autoResume) savePlaybackState();
});

// ========================================
// Auto-Resume State Logic
// ========================================

function savePlaybackState() {
    if (!currentPlayingSong) return;
    try {
        const state = {
            song: currentPlayingSong,
            index: currentIndex,
            time: audio.currentTime,
            scope: currentPlayingScope,
            listId: window.currentViewingListId,
            // [Fix] 保存整个当前播放队列副本。
            // 限制长度为 300 首以兼顾性能和容量（通常足够临时列表使用）
            playlist: currentPlaylist ? currentPlaylist.slice(0, 300) : null,
            playMode: playMode,
            quality: currentQuality,
            timestamp: Date.now()
        };
        localStorage.setItem('lx_playback_state', JSON.stringify(state));
    } catch (e) {
        console.error('[Resume] 无法保存播放状态:', e);
    }
}

async function restorePlaybackState() {
    if (!settings.autoResume) {
        return;
    }

    try {
        const saved = localStorage.getItem('lx_playback_state');
        if (!saved) {
            return;
        }

        const state = JSON.parse(saved);
        if (!state || !state.song) {
            return;
        }

        console.log('[Resume] 正在恢复上次内容:', state.song.name, '队列长度:', state.playlist ? state.playlist.length : 0);

        // 1. 恢复播放模式
        if (state.playMode) {
            playMode = state.playMode;
            updatePlayModeUI();
        }

        // 2. 恢复播放列表 (优先从持久化队列恢复)
        if (state.playlist && state.playlist.length > 0) {
            currentPlaylist = state.playlist;
            currentPlayingScope = state.scope || 'network';
        } else if (['local_list', 'local_all', 'songlist'].includes(state.scope)) {
            // 回退逻辑：如果队列没存，根据作用域恢复
            currentPlayingScope = state.scope;
            window.currentViewingListId = state.listId || 'default';
        }

        currentIndex = state.index >= 0 ? state.index : 0;
        currentPlayingSong = state.song;
        window.currentPlayingSong = state.song;
        currentQuality = state.quality || null;

        // 3. 更新 UI (静默更新)
        updatePlayerInfo(state.song, currentQuality);
        updateMediaSessionMetadata(state.song);
        renderQueue(); // 提前渲染队列 UI

        // 4. 设置恢复时间点
        const resumeTime = state.time || 0;
        window._resumeInfo = {
            time: resumeTime,
            song: state.song
        };

        // 5. 延迟加载播放源（静默模式）但不强制切换 Tab 破坏默认入口设置
        setTimeout(() => {
            if (state.scope === 'network') {
                renderResults(currentPlaylist);
            } else if (state.scope === 'local_list' || state.scope === 'local_all') {
                window._pendingResumeListId = state.listId || 'default';
            }

            // 初始化音频源但不立即播放（除非设置了自动播放，当前 playSong handles resumeTime）
            playSong(state.song, currentIndex, null, true);
        }, 800);

    } catch (e) {
        console.error('[Resume] 恢复播放状态失败:', e);
    }
}

// 辅助函数：根据 ID 查找列表内容
function findListById(data, id) {
    if (!data) return null;
    if (id === 'default') return data.defaultList;
    if (id === 'love') return data.loveList;
    const ul = data.userList.find(l => l.id === id);
    return ul ? ul.list : null;
}

// 辅助函数：获取所有歌曲（我的收藏）
function getAllSongs(data) {
    if (!data) return [];
    let all = [...data.defaultList, ...data.loveList];
    data.userList.forEach(l => {
        all = all.concat(l.list);
    });
    // 去重
    const seen = new Set();
    return all.filter(s => {
        const sid = s.id || s.songmid;
        if (seen.has(sid)) return false;
        seen.add(sid);
        return true;
    });
}

function updatePositionState() {
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
        const duration = audio.duration;
        const currentTime = audio.currentTime;
        // 确保当 duration 有效，避免传入 NaN/Infinity
        if (Number.isFinite(duration) && duration > 0) {
            try {
                const pos = Math.max(0, Math.min(currentTime, duration));
                // 显式同步播放状态，解决 iOS UI 有时出现的按钮与实际状态不同步的问题
                if (audio.paused) {
                    navigator.mediaSession.playbackState = 'paused';
                } else {
                    navigator.mediaSession.playbackState = 'playing';
                }

                navigator.mediaSession.setPositionState({
                    duration: duration,
                    playbackRate: audio.playbackRate || 1,
                    position: pos
                });
            } catch (e) {
                console.warn('[MediaSession] Failed to update position state:', e);
            }
        }
    }
}
window.updatePositionState = updatePositionState; // 暴露给保活模块调用

// 歌曲播放结束时根据播放模式处理
audio.addEventListener('ended', () => {
    shouldAutoRecoverPlayback = false;
    playNext();
});

audio.addEventListener('canplay', () => {
    if ('mediaSession' in navigator) {
        updatePositionState();
    }
});

// Additional events to sync progress
audio.addEventListener('loadedmetadata', updatePositionState);
audio.addEventListener('ratechange', updatePositionState);
audio.addEventListener('seeked', () => {
    updatePositionState();
    setTimeout(updatePositionState, 200); // 针对跳转后的 iOS 二次确认
    if (lyricPlayer) {
        if (!audio.paused) {
            lyricPlayer.play(audio.currentTime * 1000);
        } else {
            // 如果处于暂停状态，只同步位置不启动计时器
            lyricPlayer.pause();
            const time = audio.currentTime * 1000;
            // 找到当前行并高亮
            const lineNum = lyricPlayer._findCurLineNum(time);
            if (lineNum !== undefined && lineNum >= 0) {
                syncLyricByLineNum(lineNum);
            }
        }
    }
});
audio.addEventListener('waiting', () => {
    setPlayerStatus('缓冲歌曲中', null, true);
    if (lyricPlayer) {
        lyricPlayer.pause();
    }
});

audio.addEventListener('stalled', () => {
    setPlayerStatus('缓冲歌曲中', null, true);
});

// Initialize Media Session Actions
if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => {
        togglePlay();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
        togglePlay();
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
        playPrev();
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
        playNext();
    });

    // Support seeking (Bidirectional Progress Control)
    navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime != null) {
            audio.currentTime = details.seekTime;
            updatePositionState();
        }
    });

    /* 
    // 注释掉以下两个 Handler 以确保 iOS 优先显示“上一曲/下一曲”按钮
    // 进度条的拖动由上面的 'seekto' 处理，不依赖这两个按钮
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const skipTime = details.seekOffset || 10;
        audio.currentTime = Math.max(audio.currentTime - skipTime, 0);
        updatePositionState();
    });
 
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const skipTime = details.seekOffset || 10;
        audio.currentTime = Math.min(audio.currentTime + skipTime, audio.duration);
        updatePositionState();
    });
    */
}

function updateMediaSessionMetadata(song) {
    if (!('mediaSession' in navigator)) return;

    const imgUrl = getImgUrl(song);
    // Ensure absolute URL if possible
    const fullImgUrl = new URL(imgUrl, window.location.href).href;

    try {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: song.name,
            artist: song.singer,
            album: song.albumName || '',
            artwork: [
                { src: fullImgUrl, sizes: '96x96', type: 'image/jpeg' },
                { src: fullImgUrl, sizes: '128x128', type: 'image/jpeg' },
                { src: fullImgUrl, sizes: '192x192', type: 'image/jpeg' },
                { src: fullImgUrl, sizes: '256x256', type: 'image/jpeg' },
                { src: fullImgUrl, sizes: '384x384', type: 'image/jpeg' },
                { src: fullImgUrl, sizes: '512x512', type: 'image/jpeg' }
            ]
        });
        // Reset playback state logic is handled by event listeners, but metadata update often implies new song start
        // updatePositionState() will be called when loadedmetadata fires for new source
    } catch (e) {
        console.warn('[MediaSession] Failed to update metadata:', e);
    }
}


function seek(e) {
    // Prevent seek if audio is not ready or has infinite duration (live stream)
    if (!audio.duration || !Number.isFinite(audio.duration)) return;

    const container = document.getElementById('progress-container');
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width)); // Clamp between 0 and 1
    const time = pct * audio.duration;

    // Ensure time is valid
    if (Number.isFinite(time)) {
        audio.currentTime = time;
    }
}

// ========== 音量控制 ==========
let currentVolume = 0.75; // 默认音量 75%
let isMuted = false;

// 初始化音量
audio.volume = currentVolume;
updateVolumeUI();

// 设置音量
function setVolume(e) {
    const container = document.getElementById('volume-container');
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width)); // 限制在 0-1 之间

    currentVolume = pct;
    audio.volume = currentVolume;
    isMuted = false;

    updateVolumeUI();

    // 保存到本地存储
    try {
        localStorage.setItem('lx_volume', currentVolume.toString());
    } catch (e) {
        console.error('[Volume] 保存音量失败:', e);
    }
}

// 切换静音
function toggleMute() {
    isMuted = !isMuted;
    audio.muted = isMuted;
    updateVolumeUI();
}

// 更新音量 UI
function updateVolumeUI() {
    const volumeBar = document.getElementById('volume-bar');
    const volumeIcon = document.getElementById('volume-icon');

    if (volumeBar) {
        const displayVolume = isMuted ? 0 : currentVolume;
        volumeBar.style.width = `${displayVolume * 100}%`;
    }

    if (volumeIcon) {
        if (isMuted || currentVolume === 0) {
            volumeIcon.className = 'fas fa-volume-mute w-4';
        } else if (currentVolume < 0.5) {
            volumeIcon.className = 'fas fa-volume-down w-4';
        } else {
            volumeIcon.className = 'fas fa-volume-up w-4';
        }
    }
}

// ========== 播放模式 ==========
let playMode = 'list'; // 'list': 列表循环, 'single': 单曲循环, 'random': 随机播放, 'order': 顺序播放

// 设置播放模式
function setPlayMode(mode) {
    playMode = mode;
    // [Random Prefetch Fix] 切换模式时清空预读预选索引
    preSelectedNextIndex = null;
    updatePlayModeUI();

    // 保存到本地存储
    try {
        localStorage.setItem('lx_play_mode', mode);
    } catch (e) {
        console.error('[PlayMode] 保存播放模式失败:', e);
    }

    // Close menu (Mobile/Click mode)
    const menu = document.getElementById('play-mode-menu');
    if (menu) menu.classList.remove('force-visible');

    // 使用统一的 Toast 系统显示提示
    showSuccess(`播放模式：${getPlayModeName(mode)}`);
}

// 切换播放模式菜单（适配移动端点击）
function togglePlayModeMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('play-mode-menu');
    if (menu) {
        menu.classList.toggle('force-visible');
    }
}

// 切换播放倍速菜单（适配移动端点击）
function togglePlaybackRateMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('playback-rate-menu');
    if (menu) {
        menu.classList.toggle('force-visible');
    }
}

// 设置播放倍速
function setPlaybackRate(rate) {
    currentPlaybackRate = parseFloat(rate);
    audio.playbackRate = currentPlaybackRate;
    if (lyricPlayer) {
        lyricPlayer.setPlaybackRate(currentPlaybackRate);
        // 强制同步当前音频时间，确保位置严格匹配
        lyricPlayer.play(audio.currentTime * 1000);
        isUserScrolling = false; // 重置手动滚动模式，进入自动跟随
        scrollToActiveLine(true); // 立即对齐并滚动到当前行
    }
    updatePlaybackRateUI();

    // 关闭菜单
    const menu = document.getElementById('playback-rate-menu');
    if (menu) menu.classList.remove('force-visible');

    // 增加提示
    showInfo(`播放速度：${rate}x`);
}

// 更新播放倍速 UI
function updatePlaybackRateUI() {
    const btn = document.getElementById('playback-rate-btn');
    if (btn) {
        btn.innerText = currentPlaybackRate === 1.0 ? '1.0x' : `${currentPlaybackRate}x`;
        btn.classList.toggle('text-emerald-500', currentPlaybackRate !== 1.0);
    }

    const options = document.querySelectorAll('.playback-rate-option');
    options.forEach(opt => {
        const rate = parseFloat(opt.dataset.rate);
        if (rate === currentPlaybackRate) {
            opt.classList.add('active-option', 'font-bold');
        } else {
            opt.classList.remove('active-option', 'font-bold');
        }
    });
}

// 监听全局点击，关闭菜单
document.addEventListener('click', (e) => {
    // 关闭播放模式菜单
    const pmMenu = document.getElementById('play-mode-menu');
    const pmBtn = document.getElementById('play-mode-btn');
    if (pmMenu && pmBtn && !pmMenu.contains(e.target) && !pmBtn.contains(e.target)) {
        pmMenu.classList.remove('force-visible');
    }

    // 关闭倍速菜单
    const prMenu = document.getElementById('playback-rate-menu');
    const prBtn = document.getElementById('playback-rate-btn');
    if (prMenu && prBtn && !prMenu.contains(e.target) && !prBtn.contains(e.target)) {
        prMenu.classList.remove('force-visible');
    }
});

// 更新播放模式 UI
function updatePlayModeUI() {
    const btn = document.getElementById('play-mode-btn');
    const options = document.querySelectorAll('.play-mode-option');

    // 更新按钮图标和颜色
    if (btn) {
        const icons = {
            'list': 'fa-redo',
            'single': 'fa-redo-alt',
            'random': 'fa-random',
            'order': 'fa-play'
        };
        const colors = {
            'list': 'text-emerald-500',
            'single': 'text-blue-500',
            'random': 'text-purple-500',
            'order': 'text-gray-500'
        };

        const icon = btn.querySelector('i');
        if (icon) {
            icon.className = `fas ${icons[playMode]}`;
            btn.className = `${colors[playMode]} hover:opacity-80 transition-colors`;
            btn.title = getPlayModeName(playMode);
        }
    }

    // 高亮当前选中的选项
    options.forEach(opt => {
        if (opt.dataset.mode === playMode) {
            opt.classList.add('active-option', 'font-bold');
        } else {
            opt.classList.remove('active-option', 'font-bold');
        }
    });
}

function getPlayModeName(mode) {
    const names = {
        'list': '列表循环',
        'single': '单曲循环',
        'random': '随机播放',
        'order': '顺序播放'
    };
    return names[mode] || '未知';
}

function formatTime(s) {
    if (!s || isNaN(s)) return '00:00';
    const min = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${min < 10 ? '0' + min : min}:${sec < 10 ? '0' + sec : sec}`;
}


// Load settings from localStorage
function loadSettings() {
    try {
        const saved = localStorage.getItem('lx_settings');
        if (saved) {
            const loaded = JSON.parse(saved);
            settings = normalizeStoredSettings({ ...settings, ...loaded });
            console.log('[Settings] 加载设置成功:', settings);
        }
    } catch (e) {
        console.error('[Settings] 加载设置失败:', e);
    }

    // 同步 UI 状态
    syncSettingsUI();
    setupNetworkListAutoCheck();
}

// ========== 键盘快捷键逻辑 ==========
let seekTimer = null;
let isLongPress = false;

function handleSeekKey(direction, action) {
    if (action === 'down') {
        if (seekTimer) return; // 已经在处理中

        // 初始步长跳转 (默认 5% 长度)
        let delta = direction === 'forward' ? 10 : -10;
        if (audio.duration && Number.isFinite(audio.duration)) {
            delta = audio.duration * (direction === 'forward' ? 0.05 : -0.05);
        }

        audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + delta));

        // 设置长按逻辑 (500ms 后进入连续推进模式)
        seekTimer = setTimeout(() => {
            isLongPress = true;
            seekTimer = setInterval(() => {
                const step = direction === 'forward' ? 2 : -2; // 每 100ms 推进 2s = 20s/s
                audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + step));
            }, 100);
        }, 500);
    } else {
        // 松开按键，重置状态
        if (seekTimer) {
            if (isLongPress) clearInterval(seekTimer);
            else clearTimeout(seekTimer);
            seekTimer = null;
            isLongPress = false;
        }
    }
}

function changeVolume(delta) {
    currentVolume = Math.max(0, Math.min(1, currentVolume + delta));
    audio.volume = currentVolume;
    isMuted = false;
    updateVolumeUI();
    try {
        localStorage.setItem('lx_volume', currentVolume.toString());
    } catch (e) { }
}

// 注册全局键盘监听
document.addEventListener('keydown', (e) => {
    if (!settings.enableKeyboardShortcuts) return;

    // 如果焦点在输入框中，忽略快捷键
    const target = e.target;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
    }

    switch (e.code) {
        case 'Space':
            e.preventDefault();
            togglePlay();
            break;
        case 'ArrowUp':
            e.preventDefault();
            changeVolume(0.05);
            break;
        case 'ArrowDown':
            e.preventDefault();
            changeVolume(-0.05);
            break;
        case 'ArrowLeft':
            e.preventDefault();
            handleSeekKey('backward', 'down');
            break;
        case 'ArrowRight':
            e.preventDefault();
            handleSeekKey('forward', 'down');
            break;
        case 'BracketLeft': // '['
            playPrev();
            break;
        case 'BracketRight': // ']'
            playNext();
            break;
        case 'KeyL':
            toggleLyrics();
            break;
        case 'Digit1':
            if (e.altKey) switchTab('search');
            break;
        case 'Digit2':
            if (e.altKey) switchTab('songlist');
            break;
        case 'Digit3':
            if (e.altKey) switchTab('leaderboard');
            break;
        case 'Digit4':
            if (e.altKey) switchTab('favorites');
            break;
        case 'Digit5':
            if (e.altKey) switchTab('settings');
            break;
        case 'Digit6':
            if (e.altKey) switchTab('about');
            break;
        case 'KeyF':
            updateSetting('showFooterVisualizer', !settings.showFooterVisualizer);
            break;
        case 'KeyG':
            updateSetting('showDetailVisualizer', !settings.showDetailVisualizer);
            break;
        case 'KeyH':
            if (typeof toggleCacheDrawer === 'function') toggleCacheDrawer();
            break;
        case 'KeyJ':
            if (typeof toggleDownloadDrawer === 'function') toggleDownloadDrawer();
            break;
    }
});

document.addEventListener('keyup', (e) => {
    if (!settings.enableKeyboardShortcuts) return;
    if (e.code === 'ArrowLeft') handleSeekKey('backward', 'up');
    if (e.code === 'ArrowRight') handleSeekKey('forward', 'up');
});

function getRemasterStorageUsername() {
    const username = currentListData?.username || localStorage.getItem('lx_sync_user') || '_open';
    return !username || username === 'default' ? '_open' : username;
}

async function toggleRemasterFeature(enabled) {
    const toggle = document.getElementById('setting-enable-remaster');
    try {
        await updateSetting('enableRemaster', !!enabled);
        if (toggle) toggle.checked = !!window.settings?.enableRemaster;
        window.LocalMusicManager?.syncRemasterVisibility();
    } catch (e) {
        if (toggle) toggle.checked = !!window.settings?.enableRemaster;
        showError(e.message || '更新洗版设置失败');
    }
}

window.getRemasterStorageUsername = getRemasterStorageUsername;
window.toggleRemasterFeature = toggleRemasterFeature;

async function updateSetting(key, value) {
    if (SETTINGS_UI_MAP[key]?.normalize) {
        value = SETTINGS_UI_MAP[key].normalize(value);
    }
    const restrictedKeys = ['enableServerCache', 'enableServerLyricCache', 'serverCacheLocation', 'serverCacheNamingPattern', 'downloadConcurrency', 'enableOnlyDownloadMode', 'enableRemaster', 'preferredQuality', 'enablePublicSources', 'embedLyricToFile', 'preferServerCache'];
    const isPublic = !isUserLoggedIn() || currentListData?.username === '_open' || currentListData?.username === 'default' || window.isViewingPublicFavorites;
    const enablePublicRestriction = window.lx_config?.['user.enablePublicRestriction'];
    const enableLoginCacheRestriction = window.lx_config?.['user.enableLoginCacheRestriction'];
    const isAdmin = !!localStorage.getItem('lx_admin_password');

    // 权限校验：针对不同用户类型的受限设置项校验 (置灰逻辑由 syncSettingsUI 同步)
    const isRestricted = !isAdmin && (
        (isPublic && enablePublicRestriction) ||
        (!isPublic && enableLoginCacheRestriction)
    );

    if (restrictedKeys.includes(key) && isRestricted) {
        showError('权限不足：公开受限模式下修改该设置项受限，请先验证管理员身份。');
        const authorized = await handleAdminAuth('该设置项受限，请输入管理员密码以修改');
        if (!authorized) {
            syncSettingsUI(key, settings[key]); // 还原 UI
            return;
        }
    }

    if (key === 'networkListAutoCheckInterval') {
        const intervalMs = parseNetworkListAutoCheckInterval(value);
        if (intervalMs === null) {
            showError('无效的自动检测间隔，请使用 30m / 6h / 1d 等格式');
            syncSettingsUI(key, settings[key]);
            return;
        }
    }

    settings[key] = value;
    window.settings = settings; // 确保全局引用同步
    try {
        localStorage.setItem('lx_settings', JSON.stringify(settings));
        console.log(`[Settings] ${key} 已更新为:`, value);
    } catch (e) {
        console.error('[Settings] 保存设置失败:', e);
    }
    // 实时同步 UI 并应用效果
    syncSettingsUI(key, value);
    if (key === 'networkListAutoCheckInterval' || key === 'autoUpdateNetworkList') {
        setupNetworkListAutoCheck();
    }

    // [New] Push to server if enabled
    if (settings.saveAccountSettingsToFile) {
        pushSettingsToServer();
    }

    // Special handlers for visual changes
    if (key.includes('Visualizer') || key.startsWith('visualizer')) {
        if (window.musicVisualizer) {
            // 如果正在播放且开启了开关，尝试强制初始化 (防止第一次点击开关没反应)
            if (typeof audio !== 'undefined' && !audio.paused && (settings.showFooterVisualizer || settings.showDetailVisualizer)) {
                window.musicVisualizer.init();
            }
            window.musicVisualizer.applySettings();
        }

        // 更新透明度数值显示
        if (key === 'visualizerOpacity') {
            const el = document.getElementById('visualizer-opacity-value');
            if (el) el.innerText = value;
        }
    }

    if (key === 'playerBackground') {
        applyPlayerBackground(value);
    }

    if (key === 'enablePublicSources') {
        if (typeof updateSourceScopeUI === 'function') updateSourceScopeUI();
        if (typeof renderCustomSources === 'function') renderCustomSources();
    }
}
//缓存设置
// 核心设置项映射表: [key]: { id: 'element-id', type: 'checkbox|value|custom', action: (val) => { ... } }
const SETTINGS_UI_MAP = {
    // 逻辑 (Logic)
    defaultEntry: { id: 'setting-default-entry', type: 'value' },
    switchPlaylistOnSearchPlay: { id: 'setting-switch-playlist-search', type: 'checkbox' },
    switchPlaylistOnSongListPlay: { id: 'setting-switch-playlist-songlist', type: 'checkbox' },
    autoResume: { id: 'setting-auto-resume', type: 'checkbox' },
    autoCompactPlaybar: { id: 'setting-auto-compact-playbar', type: 'checkbox' },
    enableAutoSwitchSource: { id: 'setting-auto-switch-source', type: 'checkbox' },
    enableAutoSwitchApiSource: { id: 'setting-auto-switch-api-source', type: 'checkbox' },
    enableAutoSkipOnError: { id: 'setting-auto-skip-on-error', type: 'checkbox' },
    enableAutoDegradeQuality: { id: 'setting-auto-degrade-quality', type: 'checkbox' },
    playbackErrorPriority: { id: 'setting-playback-error-priority', type: 'value' },
    enablePreloader: { id: 'setting-enable-preloader', type: 'checkbox' },
    deduplicatePlaylistByQuality: { id: 'setting-deduplicate-playlist', type: 'checkbox' },
    enableSmtcLyric: {
        id: 'setting-enable-smtc-lyric',
        type: 'checkbox',
        action: (v) => {
            // 关闭时立即恢复 MediaSession title / artist 为歌曲名 / 歌手名
            if (!v && 'mediaSession' in navigator && navigator.mediaSession.metadata && currentPlayingSong) {
                try {
                    navigator.mediaSession.metadata.title = currentPlayingSong.name;
                    navigator.mediaSession.metadata.artist = currentPlayingSong.singer;
                } catch (e) { /* ignore */ }
            }
        }
    },
    downloadConcurrency: {
        id: 'setting-download-concurrency',
        type: 'value',
        normalize: normalizeDownloadConcurrency,
        action: (v) => {
            if (window.SystemDownloadManager) {
                window.SystemDownloadManager.updateMaxConcurrent(v);
            }
        }
    },
    enableRemaster: {
        id: 'setting-enable-remaster',
        type: 'checkbox',
        action: () => window.LocalMusicManager?.syncRemasterVisibility()
    },
    enableKeyboardShortcuts: { id: 'setting-enable-shortcuts', type: 'checkbox' },
    enableCrossfade: { id: 'setting-enable-crossfade', type: 'checkbox' },
    keepScreenAwake: {
        id: 'setting-keep-screen-awake',
        type: 'checkbox',
        action: (v) => toggleNoSleep(v && !audio.paused)
    },
    enablePersistentToken: {
        id: 'setting-enable-persistent-token',
        type: 'checkbox',
        action: (v) => {
            const container = document.getElementById('token-list-container');
            if (container) {
                if (v) {
                    container.classList.remove('hidden', 'opacity-50', 'pointer-events-none');
                } else {
                    container.classList.add('hidden', 'opacity-50', 'pointer-events-none');
                }
            }
        }
    },

    // 显示 (Display)
    showSidebarSongInfo: {
        id: 'setting-show-sidebar-info',
        type: 'checkbox',
        action: (v) => {
            const sidebarInfo = document.querySelector('.sidebar-song-info-wrapper');
            if (sidebarInfo) v ? sidebarInfo.classList.add('md:block') : sidebarInfo.classList.remove('md:block');
        }
    },
    showLyricTranslation: {
        id: 'setting-show-lyric-translation',
        type: 'checkbox',
        action: () => (lyricPlayer && currentRawLrc) && applyLyricUpdate()
    },
    showLyricRoma: {
        id: 'setting-show-lyric-roma',
        type: 'checkbox',
        action: () => (lyricPlayer && currentRawLrc) && applyLyricUpdate()
    },
    swapLyricTransRoma: {
        id: 'setting-swap-lyric-trans-roma',
        type: 'checkbox',
        action: () => (lyricPlayer && currentRawLrc) && applyLyricUpdate()
    },
    enableLyricGlow: {
        id: 'setting-enable-lyric-glow',
        type: 'checkbox',
        action: (v) => {
            // 同时更新歌词详情容器和歌词内容容器，实现实时生效
            const dv = document.getElementById('view-player-detail');
            if (dv) v ? dv.classList.add('enable-lyric-glow') : dv.classList.remove('enable-lyric-glow');
            const lc = document.getElementById('lyric-content');
            if (lc) v ? lc.classList.add('enable-lyric-glow') : lc.classList.remove('enable-lyric-glow');
        }
    },
    playerBackground: {
        id: 'setting-player-background',
        type: 'value',
        action: (v) => applyPlayerBackground(v)
    },
    lyricFontSize: {
        id: 'lyric-font-size-slider',
        type: 'value',
        action: (v) => {
            const valEl = document.getElementById('lyric-font-size-value');
            if (valEl) valEl.innerText = v;
            document.documentElement.style.setProperty('--lyric-font-size', `${v}rem`);
        }
    },
    lyricFontFamily: {
        id: 'lyric-font-family-select',
        type: 'value',
        action: (v) => document.documentElement.style.setProperty('--lyric-font-family', v || 'inherit')
    },

    // 视觉效果 (Visualizer)
    showFooterVisualizer: { id: 'setting-show-footer-visualizer', type: 'checkbox' },
    footerVisualizerStyle: { id: 'setting-footer-visualizer-style', type: 'value' },
    showDetailVisualizer: { id: 'setting-show-detail-visualizer', type: 'checkbox' },
    detailVisualizerStyle: { id: 'setting-detail-visualizer-style', type: 'value' },
    visualizerGlobalStyle: { id: 'setting-visualizer-global-style', type: 'value' },
    visualizerOpacity: {
        id: 'setting-visualizer-opacity',
        type: 'value',
        action: (v) => {
            const valEl = document.getElementById('visualizer-opacity-value');
            if (valEl) valEl.innerText = v;
        }
    },

    // 系统 & 网络 (System & Network)
    autoUpdateNetworkList: { id: 'setting-auto-update-list', type: 'checkbox' },
    networkListAutoCheckInterval: { id: 'setting-network-list-auto-check-interval', type: 'value' },
    saveAccountSettingsToFile: { id: 'setting-save-settings-to-file', type: 'checkbox' },
    enableLyricCache: { id: 'setting-enable-lyric-cache', type: 'checkbox' },
    enableSongUrlCache: { id: 'setting-enable-url-cache', type: 'checkbox' },
    enableServerCache: { id: 'setting-enable-server-cache', type: 'checkbox' },
    enableServerLyricCache: { id: 'setting-enable-server-lyric-cache', type: 'checkbox' },
    embedLyricToFile: { id: 'setting-embed-lyric-to-file', type: 'checkbox' },
    preferServerCache: { id: 'setting-prefer-server-cache', type: 'checkbox' },
    enableOnlyDownloadMode: { id: 'setting-only-download-mode', type: 'checkbox' },
    serverCacheLocation: { id: 'setting-server-cache-location', type: 'value' },
    serverCacheNamingPattern: {
        id: 'setting-server-cache-naming',
        type: 'value',
        normalize: value => value === 'standard' ? 'standard' : 'simple'
    },
    enableProxyPlayback: { id: 'toggle-proxy-playback', type: 'checkbox' },
    enableProxyDownload: { id: 'toggle-proxy-download', type: 'checkbox' },
    enableAutoProxy: { id: 'toggle-auto-proxy', type: 'checkbox' },
    enableCustomProxy: {
        id: 'toggle-custom-proxy',
        type: 'checkbox',
        action: (v) => {
            const row = document.getElementById('custom-proxy-url-row');
            if (row) row.classList.toggle('hidden', !v);
        }
    },
    customProxyUrl: { id: 'custom-proxy-url-input', type: 'value' },
    enablePublicSources: { id: 'toggle-public-sources', type: 'checkbox' },
    preferredQuality: {
        id: 'quality-select',
        type: 'value',
        action: (v, isSingle) => {
            if (isSingle && window.showSuccess && window.QualityManager) {
                window.showSuccess(`默认音质已设置为: ${window.QualityManager.getQualityDisplayName(v)}`);
            }
        }
    },
    hotSearchLimit: {
        id: 'hot-search-limit-input',
        type: 'value',
        action: () => document.getElementById('search-results-header')?.classList.contains('hidden') && showInitialSearchState()
    },
    itemsPerPage: { id: 'items-per-page-select', type: 'value' },
    enableClientModeSync: { id: 'setting-client-mode-sync', type: 'checkbox' }
};

//缓存设置项
function syncSettingsUI(key = null, value = null) {
    const isPublic = !isUserLoggedIn() || currentListData?.username === '_open' || currentListData?.username === 'default' || window.isViewingPublicFavorites;
    const enablePublicRestriction = window.lx_config?.['user.enablePublicRestriction'];
    const enableLoginCacheRestriction = window.lx_config?.['user.enableLoginCacheRestriction'];
    const isAdmin = !!localStorage.getItem('lx_admin_password');
    const restrictedKeys = ['enableServerCache', 'enableServerLyricCache', 'serverCacheLocation', 'serverCacheNamingPattern', 'downloadConcurrency', 'enableOnlyDownloadMode', 'enableRemaster', 'preferredQuality', 'enablePublicSources', 'embedLyricToFile', 'preferServerCache'];

    const updateItem = (itemKey, itemValue, isSingle) => {
        const config = SETTINGS_UI_MAP[itemKey];
        if (!config) return;

        if (config.normalize) itemValue = config.normalize(itemValue);
        if (settings[itemKey] !== itemValue) {
            settings[itemKey] = itemValue;
            window.settings = settings;
        }
        const el = document.getElementById(config.id);
        if (el) {
            if (config.type === 'checkbox') el.checked = !!itemValue;
            else el.value = itemValue;

            // 禁用受限设置项 (针对公开受限或登录用户受限)
            const isRestricted = !isAdmin && (
                (isPublic && enablePublicRestriction) ||
                (!isPublic && enableLoginCacheRestriction)
            );

            if (restrictedKeys.includes(itemKey) && isRestricted) {
                el.disabled = true;
                const container = el.closest('.flex.items-center.justify-between') || el.closest('.setting-item') || el.parentElement;
                if (container) container.classList.add('opacity-40', 'pointer-events-none');
            } else if (restrictedKeys.includes(itemKey)) {
                el.disabled = false;
                const container = el.closest('.flex.items-center.justify-between') || el.closest('.setting-item') || el.parentElement;
                if (container) container.classList.remove('opacity-40', 'pointer-events-none');
            }
        }

        if (config.action) config.action(itemValue, isSingle);
    };

    // [新增] 更新管理员 UI 状态 (标签、按钮)
    if (typeof updateAdminUI === 'function') updateAdminUI();

    if (key !== null && value !== null) {
        // 单项更新
        updateItem(key, value, true);
    } else {
        // 全局同步
        Object.keys(SETTINGS_UI_MAP).forEach(itemKey => {
            const val = settings[itemKey];
            // 处理默认值逻辑 (如果 settings 中没有，则可能需要 fallback 或跳过)
            if (val !== undefined) {
                updateItem(itemKey, val, false);
            }
        });
    }

    // 更新存储统计与缓存大小
    updateStorageStatsUI();
    updateServerCacheSize();
}

/**
 * 应用播放页背景样式
 * @param {string} mode - 'blur', 'solid', 'dark'
 */
function applyPlayerBackground(mode) {
    const detailBg = document.getElementById('view-player-detail');
    const bgCover = document.getElementById('detail-bg-cover');
    const bgOverlay = document.getElementById('player-detail-bg-overlay');
    if (!detailBg || !bgCover || !bgOverlay) return;

    console.log(`[PlayerBackground] Applying style: ${mode}`);

    // 重置默认状态
    bgCover.style.display = 'block';
    bgOverlay.className = 'absolute inset-0 t-bg-panel/30 backdrop-blur-3xl';
    bgOverlay.style.backgroundColor = '';
    bgOverlay.style.backdropFilter = '';
    detailBg.style.backgroundColor = '';

    if (mode === 'solid') {
        bgCover.style.display = 'none';
        bgOverlay.className = 'absolute inset-0 t-bg-panel';
        bgOverlay.style.backdropFilter = 'none';
    } else if (mode === 'dark') {
        bgCover.style.display = 'none';
        bgOverlay.className = 'absolute inset-0';
        bgOverlay.style.backgroundColor = '#000000';
        bgOverlay.style.backdropFilter = 'none';
    }
    // 'blur' 模式由上面的重置逻辑处理
}

// ========== 缓存统计与重置逻辑 ==========

async function calcStorageUsage() {
    try {
        // 1. 优先使用原生 API 获取包含 IndexedDB 的准确占用
        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            const total = estimate.usage || 0;
            if (total > 0) {
                if (total < 1024) return total + ' B';
                if (total < 1024 * 1024) return (total / 1024).toFixed(2) + ' KB';
                return (total / (1024 * 1024)).toFixed(2) + ' MB';
            }
        }
    } catch (e) {
        console.warn('[Storage] 无法使用 Storage Estimate API:', e);
    }

    // 2. 回退到手动计算 localStorage (兜底)
    let total = 0;
    for (let x in localStorage) {
        if (!localStorage.hasOwnProperty(x)) continue;
        const val = localStorage.getItem(x);
        if (val) total += (x.length + val.length) * 2;
    }
    if (total < 1024) return total + ' B';
    if (total < 1024 * 1024) return (total / 1024).toFixed(2) + ' KB';
    return (total / (1024 * 1024)).toFixed(2) + ' MB';
}

async function updateStorageStatsUI() {
    const el = document.getElementById('storage-usage-info');
    if (el) {
        el.innerText = await calcStorageUsage();
    }
}

async function resetAllSettings() {
    const ok = await showSelect('重置所有设置', '确定要重置吗？这不会删除您的歌单，但会恢复音质、列表显示、主题等设置到默认状态。 (Restore all settings to default?)', { danger: true });
    if (!ok) return;
    try {
        // Reset to default
        settings = { ...DEFAULT_SETTINGS };
        window.settings = settings;
        localStorage.setItem('lx_settings', JSON.stringify(settings));
        localStorage.removeItem('lx_playback_state'); // 同时重置播放进度记忆

        // If sync enabled, push to server
        if (settings.saveAccountSettingsToFile) {
            await pushSettingsToServer();
        }

        showSuccess('设置已重置，正在重新加载页面...');
        setTimeout(() => {
            window.location.reload();
        }, 1500);
    } catch (e) {
        showError('重置失败: ' + e.message);
    }
}

async function clearCache(type) {
    if (!(await showSelect('清除缓存', '确定要清除本地缓存吗？', { danger: true }))) return;

    let clearServerLyric = false;
    if (type === 'lyric') {
        clearServerLyric = await showSelect('清除缓存', '是否同时清除本地缓存文件夹内的歌词LRC文件？', { danger: true });

        if (clearServerLyric) {
            const isLogined = !!localStorage.getItem('lx_user_token');
            const isPublicUser = !window.currentListData || !window.currentListData.username || window.currentListData.username === 'default';
            if (isPublicUser && window.lx_config && window.lx_config['user.enablePublicRestriction'] && !isLogined) {
                const isAdminSession = localStorage.getItem('lx_admin_password');
                const enableServerLyricCache = window.settings && window.settings.enableServerLyricCache === true;
                if (!enableServerLyricCache && !isAdminSession) {
                    if (typeof window.handleAdminAuth === 'function') {
                        const authorized = await window.handleAdminAuth('清除服务器歌词缓存需要管理员身份');
                        if (!authorized) {
                            // 验证失败或取消时，只取消服务端歌词清理，不影响浏览器层面的缓存清理
                            clearServerLyric = false;
                        }
                    } else {
                        showError('清除服务器歌词缓存受限，需要管理员身份');
                        clearServerLyric = false;
                    }
                }
            }
        }
    }

    let count = 0;
    const keysToRemove = [];

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        // [Fix] 统一使用 lx_lyric_ 和 lx_url_ 前缀进行清理
        if (type === 'lyric' && key.startsWith('lx_lyric_')) {
            keysToRemove.push(key);
        } else if (type === 'url' && key.startsWith('lx_url_')) {
            keysToRemove.push(key);
        }
    }

    keysToRemove.forEach(k => {
        localStorage.removeItem(k);
        count++;
    });

    updateStorageStatsUI();
    const mapFromName = { 'lyric': '歌词', 'url': '链接' };
    showSuccess(`已清除 ${count} 条${mapFromName[type] || ''}本地缓存`);

    if (clearServerLyric) {
        try {
            const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '';
            const headers = {};
            Object.assign(headers, getUserAuthHeaders());

            const res = await fetch('/api/music/cache/lyric/clear', { method: 'POST', headers });
            const data = await res.json();
            if (data.success) {
                showSuccess(`已同时清除 ${data.data.deletedCount} 个本地LRC文件`);
                // 刷新缓存列表（如果在看列表的话）
                const drawer = document.getElementById('cache-drawer');
                if (drawer && !drawer.classList.contains('translate-x-full')) {
                    refreshCacheList();
                }
                updateServerCacheSize();
            } else {
                throw new Error(data.message || '清除失败');
            }
        } catch (e) {
            showError('清除本地LRC文件失败: ' + e.message);
        }
    }
}

// 更新服务器缓存大小统计
async function updateServerCacheSize() {
    const cacheEl = document.getElementById('server-cache-info');
    const musicEl = document.getElementById('server-music-info');
    if (!cacheEl && !musicEl) return;

    const formatSize = (size) => {
        if (size >= 1024 * 1024 * 1024) return (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
        if (size >= 1024 * 1024) return (size / (1024 * 1024)).toFixed(2) + ' MB';
        if (size >= 1024) return (size / 1024).toFixed(2) + ' KB';
        return size + ' B';
    };

    try {
        if (cacheEl) cacheEl.textContent = '计算中...';
        if (musicEl) musicEl.textContent = '计算中...';

        const headers = getUserAuthHeaders();
        const response = await fetch('/api/music/cache/stats', { headers });
        if (!response.ok) throw new Error('获取缓存统计失败');

        const data = await response.json();
        if (data.success && data.data) {
            const stats = data.data;

            if (musicEl && stats.music) {
                musicEl.textContent = `音乐: ${formatSize(stats.music.totalSize)} (${stats.music.fileCount} 首)`;
            }
            if (cacheEl && stats.cache) {
                cacheEl.textContent = `缓存: ${formatSize(stats.cache.totalSize)} (${stats.cache.fileCount} 首)`;
            }
        } else {
            throw new Error(data.message || '获取失败');
        }
    } catch (e) {
        console.warn('[Cache] 更新服务端统计失败:', e);
        if (cacheEl) cacheEl.textContent = '获取失败';
        if (musicEl) musicEl.textContent = '获取失败';
    }
}

// --- 服务器缓存管理 (Server Cache Management) ---
let currentCacheList = [];
let selectedCacheFiles = new Set();
let cacheBatchMode = false;

function getCacheItemKey(item) {
    return `${item.folder}\u0000${item.filename}`;
}

function getSelectedCacheItems() {
    return currentCacheList.filter(item => selectedCacheFiles.has(getCacheItemKey(item)));
}

function toggleCacheDrawer() {
    const drawer = document.getElementById('cache-drawer');
    if (drawer) {
        const isHidden = drawer.classList.contains('translate-x-full');
        if (isHidden) {
            drawer.classList.remove('translate-x-full');
            document.body.style.overflow = 'hidden';
            refreshCacheList();
        } else {
            drawer.classList.add('translate-x-full');
            document.body.style.overflow = '';
            exitCacheBatchMode(); // 关闭时重置状态
        }
    }
}

async function refreshCacheList() {
    const container = document.getElementById('cache-list-container');
    container.innerHTML = window.SystemDownloadManager.getStatusHtml('fa-spinner', '正在重新扫描文件并刷新列表...', true);

    try {
        const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '';
        const headers = getUserAuthHeaders();

        // 刷新前先强制触发服务器端的磁盘同步/索引重建
        await fetch('/api/music/cache/sync', { method: 'POST', headers });

        const res = await fetch('/api/music/cache/list', { headers });
        const data = await res.json();

        if (data.success) {
            currentCacheList = data.data;
            renderCacheList();
            updateCacheHeaderStats();
        } else {
            throw new Error(data.message || '加载列表失败');
        }
    } catch (e) {
        container.innerHTML = `<div class="p-10 text-center t-text-muted text-sm">${e.message}</div>`;
    }
}

function updateCacheHeaderStats() {
    const countEl = document.getElementById('cache-list-count');
    const sizeEl = document.getElementById('cache-total-size');
    if (countEl) countEl.textContent = `${currentCacheList.length} CACHED FILES`;

    const totalSize = currentCacheList.reduce((acc, curr) => acc + (curr.size || 0), 0);
    if (sizeEl) sizeEl.textContent = (totalSize / (1024 * 1024)).toFixed(2) + ' MB';

    // 更新设置页面的简易统计（如果有）
    updateServerCacheSize();
}

function renderCacheList() {
    const container = document.getElementById('cache-list-container');
    if (currentCacheList.length === 0) {
        container.innerHTML = window.SystemDownloadManager.getStatusHtml('fa-cloud-download-alt', '暂无服务器缓存歌曲');
        return;
    }

    container.innerHTML = currentCacheList.map((item, idx) => {
        const isSelected = selectedCacheFiles.has(getCacheItemKey(item));

        // 样式同步：使用主列表的来源标签生成函数
        const sourceTagHtml = window.getSourceTag ? window.getSourceTag(item.source) : `<span class="px-1 py-0 rounded text-[10px] font-bold border t-badge-red mr-1">${item.source.toUpperCase()}</span>`;

        // 样式同步：匹配 getQualityTags 的逻辑
        let qTagHtml = '';
        const q = (item.quality || '').toLowerCase();
        const qName = window.QualityManager?.getQualityDisplayName(q) || q.toUpperCase();

        if (q === 'master') {
            qTagHtml = `<span class="flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-purple border border-purple-200 dark:border-purple-500/30 transition-colors">${qName}</span>`;
        } else if (q === 'atmos' || q === 'atmos_plus') {
            qTagHtml = `<span class="flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-blue border border-cyan-200 dark:border-cyan-500/30 transition-colors">${qName}</span>`;
        } else if (q === 'flac24bit' || q === 'hires' || q === 'hr') {
            qTagHtml = `<span class="flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-yellow border border-yellow-200 dark:border-yellow-500/30 transition-colors">${qName}</span>`;
        } else if (q === 'flac' || q === 'sq' || q === 'ape') {
            qTagHtml = `<span class="flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-green border border-emerald-200 dark:border-emerald-500/30 transition-colors">${qName}</span>`;
        } else if (q === '320k' || q === 'hq') {
            qTagHtml = `<span class="flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-blue border border-blue-200 dark:border-blue-500/30 transition-colors">${qName}</span>`;
        } else if (q === '128k' || q === 'mq' || q === 'standard') {
            qTagHtml = `<span class="flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-gray border t-border-main transition-colors">${qName}</span>`;
        } else {
            qTagHtml = `<span class="flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-red border border-red-200 dark:border-red-500/30 transition-colors">${qName}</span>`;
        }

        const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '';
        // <img src> 无法携带自定义请求头，将 token 附到 URL 以通过服务端认证
        const authToken = (window.getUserAuthHeaders ? window.getUserAuthHeaders()['x-user-token'] : null)
            || localStorage.getItem('lx_user_token') || '';
        const coverUrl = item.hasCover
            ? `/api/music/cache/cover?filename=${encodeURIComponent(item.filename)}&user=${encodeURIComponent(username)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}`
            : '/music/assets/logo.svg';

        return `
            <div class="group flex items-center p-2.5 rounded-2xl hover:t-bg-panel-light transition-all duration-300 gap-3 border border-transparent 
                ${isSelected ? 't-bg-panel-light border-blue-500/30 ring-1 ring-blue-500/10' : ''}" 
                onclick="${cacheBatchMode ? `toggleCacheSelection(${idx})` : ''}">
                
                ${cacheBatchMode ? `
                <div class="flex-shrink-0 w-5 flex items-center justify-center">
                    <div class="w-4 h-4 rounded border-2 transition-all flex items-center justify-center
                        ${isSelected ? 'bg-blue-500 border-blue-500 shadow-sm' : 'border-gray-300 dark:border-gray-600'}">
                        ${isSelected ? '<i class="fas fa-check text-[8px] text-white"></i>' : ''}
                    </div>
                </div>
                ` : ''}

                <div class="relative w-12 h-12 flex-shrink-0 group-hover:scale-105 transition-transform duration-500">
                    <img class="w-full h-full object-cover rounded-xl shadow-md bg-gray-100" 
                         src="${coverUrl}" 
                         onerror="this.src='/music/assets/logo.svg'">
                    <div class="absolute inset-0 bg-black/5 rounded-xl"></div>
                </div>

                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                        <span class="text-sm font-black t-text-main truncate tracking-tight">${item.name}</span>
                    </div>
                    <div class="flex items-center flex-wrap gap-1 mt-0.5">
                        ${sourceTagHtml}
                        ${qTagHtml}
                        <span class="text-[10px] font-bold t-text-muted truncate opacity-60">${item.singer}</span>
                        ${item.album ? `<span class="text-[10px] t-text-muted opacity-40 ml-1 truncate">· ${item.album}</span>` : ''}
                    </div>
                    ${item.hasLyric === true ? `
                        <div class="mt-1">
                            <span class="text-[9px] bg-emerald-500 text-white px-1.5 py-0.5 rounded font-black shadow-sm inline-flex items-center" title="歌词已同步">LRC</span>
                        </div>
                    ` : `
                        <div class="mt-1">
                            <button onclick="event.stopPropagation(); retryCacheLyric(this, ${JSON.stringify(item).replace(/"/g, '&quot;')})" 
                                    class="text-[9px] bg-red-400 hover:bg-red-500 text-white px-1.5 py-0.5 rounded font-black shadow-sm inline-flex items-center gap-1 transition-colors" title="歌词缺失，点击尝试补全">
                                <span>LRC+</span>
                                <i class="fas fa-redo-alt text-[7px]"></i>
                            </button>
                        </div>
                    `}
                </div>

                <div class="flex items-center gap-2 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                    ${!cacheBatchMode ? `
                        <button onclick="event.stopPropagation(); openCacheItemPlaylist(${idx})"
                                class="p-2 text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors" title="添加到歌单">
                            <i class="fas fa-plus text-xs"></i>
                        </button>
                        <button onclick="event.stopPropagation(); removeCacheItem(${idx})"
                                class="p-2 t-text-muted hover:text-red-500 transition-colors" title="删除">
                            <i class="fas fa-trash-alt text-xs"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function openCacheItemPlaylist(index) {
    const item = currentCacheList[index];
    if (!item) return;
    openPlaylistAddModalForSongObject({
        ...item,
        songmid: item.songmid || item.songId || item.id,
        albumName: item.albumName || item.album || ''
    });
}
window.openCacheItemPlaylist = openCacheItemPlaylist;

/**
 * 缓存列表专用的歌词重试逻辑
 */
async function retryCacheLyric(btn, item) {
    if (!window.requestServerLyricCache) return;

    // 改变按钮状态
    const originalContent = btn.innerHTML;
    const originalBg = btn.className;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin text-[8px]"></i>';
    btn.disabled = true;

    try {
        // 构造 song 格式以适配 requestServerLyricCache
        const songData = {
            id: item.id,
            songmid: item.id, // 兼容性
            name: item.name,
            singer: item.singer,
            source: item.source,
            albumName: item.album || ''
        };

        const synced = await window.requestServerLyricCache(songData, item.quality, true); // 强制补齐
        if (!synced) throw new Error('No lyric data available');

        showSuccess(`已成功补齐歌词: ${item.name}`);
        // 成功后给予反馈并刷新列表
        btn.innerHTML = 'OK';
        btn.className = btn.className.replace('bg-red-400', 'bg-emerald-500');
        setTimeout(() => refreshCacheList(), 1500);
    } catch (e) {
        btn.innerHTML = originalContent;
        btn.disabled = false;
        console.error('[Cache] Retry lyric failed:', e);
    }
}

/**
 * 缓存管理界面：一键补全所有缺失的歌词
 */
async function downloadAllCacheLyrics() {
    if (!currentCacheList || currentCacheList.length === 0) return;

    const missingItems = currentCacheList.filter(item => !item.hasLyric);
    if (missingItems.length === 0) {
        showInfo('没有缺失歌词的缓存文件');
        return;
    }

    showInfo(`正在尝试补全 ${missingItems.length} 个缓存文件的歌词...`);

    // 我们不需要 UI 上的按钮引用，直接调用逻辑
    for (const item of missingItems) {
        try {
            const songData = {
                id: item.id,
                songmid: item.id,
                name: item.name,
                singer: item.singer,
                source: item.source,
                albumName: item.album || ''
            };
            if (window.requestServerLyricCache) {
                const synced = await window.requestServerLyricCache(songData, item.quality, true); // 强制补全
                if (!synced) throw new Error('No lyric data available');
            }
            // 每首之间稍作停顿
            await new Promise(r => setTimeout(r, 500));
        } catch (e) {
            console.warn('[Cache] Batch lyric sync error:', e);
        }
    }

    showSuccess('补全流程执行完毕');
    refreshCacheList();
}


function toggleCacheBatchMode() {
    cacheBatchMode = true;
    selectedCacheFiles.clear();
    document.getElementById('cache-batch-toolbar').classList.remove('hidden');
    document.getElementById('cache-manage-btn').classList.add('hidden');
    document.getElementById('cache-exit-batch-btn').classList.remove('hidden');
    renderCacheList();
    updateCacheBatchCount();
}

function exitCacheBatchMode() {
    cacheBatchMode = false;
    selectedCacheFiles.clear();
    document.getElementById('cache-batch-toolbar').classList.add('hidden');
    document.getElementById('cache-manage-btn').classList.remove('hidden');
    document.getElementById('cache-exit-batch-btn').classList.add('hidden');
    renderCacheList();
}

function toggleCacheSelection(index) {
    const item = currentCacheList[index];
    if (!item) return;
    const key = getCacheItemKey(item);
    if (selectedCacheFiles.has(key)) {
        selectedCacheFiles.delete(key);
    } else {
        selectedCacheFiles.add(key);
    }
    renderCacheList();
    updateCacheBatchCount();
}

function selectAllCache() {
    currentCacheList.forEach(item => selectedCacheFiles.add(getCacheItemKey(item)));
    renderCacheList();
    updateCacheBatchCount();
}

function deselectAllCache() {
    selectedCacheFiles.clear();
    renderCacheList();
    updateCacheBatchCount();
}

function updateCacheBatchCount() {
    const el = document.getElementById('cache-selected-count');
    if (el) el.textContent = selectedCacheFiles.size;
}

async function removeCacheItem(index) {
    const item = currentCacheList[index];
    if (!item) {
        showError('文件信息已失效，请刷新后重试');
        return;
    }
    const isLogined = !!localStorage.getItem('lx_user_token');
    const isPublicUser = !window.currentListData || !window.currentListData.username || window.currentListData.username === 'default';
    if (isPublicUser && window.lx_config && window.lx_config['user.enablePublicRestriction'] && !isLogined) {
        const isAdminSession = localStorage.getItem('lx_admin_password');
        const enableServerCache = window.settings && window.settings.enableServerCache === true;
        if (!enableServerCache && !isAdminSession) {
            if (typeof window.handleAdminAuth === 'function') {
                const authorized = await window.handleAdminAuth('删除服务器缓存文件需要需要管理员身份');
                if (!authorized) return;
            } else {
                showError('删除服务器缓存文件受限，需要管理员身份');
                return;
            }
        }
    }

    if (!(await showSelect('确定删除', '确认从服务器永久删除此缓存文件吗？', { danger: true }))) return;

    try {
        const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '';
        const headers = { 'Content-Type': 'application/json' };
        Object.assign(headers, getUserAuthHeaders());

        const res = await fetch('/api/music/cache/remove', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ items: [{ filename: item.filename, folder: item.folder }] })
        });

        const result = await res.json();
        if (res.ok && result.success) {
            showSuccess('已删除');
            refreshCacheList();
        } else {
            throw new Error(result.message || '删除失败');
        }
    } catch (e) {
        showError(e.message);
    }
}

async function batchDeleteCache() {
    const deleteItems = getSelectedCacheItems();
    if (deleteItems.length === 0) {
        showError('请先选择文件');
        return;
    }

    if ((!window.currentListData || !window.currentListData.username || window.currentListData.username === 'default') && window.lx_config && window.lx_config['user.enablePublicRestriction']) {
        const isAdminSession = localStorage.getItem('lx_admin_password');
        const enableServerCache = window.settings && window.settings.enableServerCache === true;
        if (!enableServerCache && !isAdminSession) {
            if (typeof window.handleAdminAuth === 'function') {
                const authorized = await window.handleAdminAuth('批量删除服务器缓存需要需要管理员身份');
                if (!authorized) return;
            } else {
                showError('批量删除服务器缓存受限，需要管理员身份');
                return;
            }
        }
    }

    if (!(await showSelect('批量删除', `确定要删除这 ${deleteItems.length} 个缓存文件吗？`, { danger: true }))) return;

    try {
        const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '';
        const headers = { 'Content-Type': 'application/json' };
        Object.assign(headers, getUserAuthHeaders());

        const res = await fetch('/api/music/cache/remove', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                items: deleteItems.map(item => ({ filename: item.filename, folder: item.folder }))
            })
        });

        const result = await res.json();
        if (result.deletedCount > 0) {
            exitCacheBatchMode();
            await refreshCacheList();
        }
        if (!res.ok || !result.success) throw new Error(result.message || '删除失败');
        showSuccess(`成功删除 ${result.deletedCount} 个文件`);
    } catch (e) {
        showError(e.message);
    }
}

async function clearServerCache() {
    if ((!window.currentListData || !window.currentListData.username || window.currentListData.username === 'default') && window.lx_config && window.lx_config['user.enablePublicRestriction']) {
        const isAdminSession = localStorage.getItem('lx_admin_password');
        const enableServerCache = window.settings && window.settings.enableServerCache === true;
        if (!enableServerCache && !isAdminSession) {
            if (typeof window.handleAdminAuth === 'function') {
                const authorized = await window.handleAdminAuth('完全清理服务器缓存需要需要管理员身份');
                if (!authorized) return;
            } else {
                showError('完全清理服务器缓存受限，需要管理员身份');
                return;
            }
        }
    }

    if (!(await showSelect('完全清理', '确定要清除所有服务器缓存吗？', { danger: true }))) return;

    try {
        const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '';
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());

        const res = await fetch('/api/music/cache/clear', { method: 'POST', headers });
        if (res.ok) {
            const data = await res.json();
            showSuccess(`清理完成，释放 ${(data.data.freedSize / (1024 * 1024)).toFixed(2)} MB`);
            refreshCacheList();
            if (cacheBatchMode) exitCacheBatchMode();
        }
    } catch (e) { showError(e.message); }
}


// Expose functions to window for HTML access
window.switchTab = switchTab;
window.handleSearchKeyPress = handleSearchKeyPress;
window.doSearch = doSearch;
window.changePage = changePage;
window.toggleCacheDrawer = toggleCacheDrawer;
window.refreshCacheList = refreshCacheList;
window.toggleCacheBatchMode = toggleCacheBatchMode;
window.exitCacheBatchMode = exitCacheBatchMode;
window.selectAllCache = selectAllCache;
window.deselectAllCache = deselectAllCache;
window.batchDeleteCache = batchDeleteCache;
window.toggleCacheSelection = toggleCacheSelection;
window.removeCacheItem = removeCacheItem;
window.clearServerCache = clearServerCache;
window.handleHotSearchClick = handleHotSearchClick;
window.playSong = playSong;
window.resolveSongUrl = resolveSongUrl;
window.resolveDownloadSongUrl = resolveDownloadSongUrl;
window.togglePlay = togglePlay;
window.playNext = playNext;
window.changeProxyPlayback = changeProxyPlayback;
window.changeProxyDownload = changeProxyDownload;
window.changeAutoProxy = changeAutoProxy;
window.changeHotSearchLimit = changeHotSearchLimit;
window.resetAllSettings = resetAllSettings;
window.clearCache = clearCache;
window.updateServerCacheSize = updateServerCacheSize;
window.clearServerCache = clearServerCache;
window.playPrev = playPrev;
window.seek = seek;
window.changeLyricFontSize = changeLyricFontSize;
// 音量控制
window.setVolume = setVolume;
window.toggleMute = toggleMute;
// 播放模式
window.setPlayMode = setPlayMode;
// --- Lyrics & Detail View Logic ---

let currentLyricLines = [];
let isLyricViewOpen = false;
let currentLyricIndex = -1;
let wordAnimationId = null; // 用于逐词歌词动画
let lyricPlayer = null; // LinePlayer instance for parsing and syncing
let isUserScrolling = false; // 用户是否正在手动滚动
let scrollLockTimeout = null; // 滚动锁定计时器
let isProgrammaticScroll = false; // 标记是否为程序自动滚动
const SCROLL_LOCK_DURATION = 5000; // 5秒后解除锁定

function toggleLyrics(fromPopState = false) {
    if (!fromPopState && isLyricViewOpen) {
        if (window.history.state && window.history.state.page === 'player-detail') {
            window.history.back();
        }
    }
    if (!fromPopState && !isLyricViewOpen) {
        window.history.pushState({ page: 'player-detail' }, '');
    }

    isLyricViewOpen = !isLyricViewOpen;
    const view = document.getElementById('view-player-detail');

    if (isLyricViewOpen) {
        view.classList.remove('hidden');
        // Trigger reflow
        void view.offsetWidth;
        view.classList.remove('translate-y-[100%]', 'opacity-0');

        // 开始歌词按钮淡化倒计时
        startToggleLyricsBtnTimer();

        // Update UI
        if (currentPlayingSong) {
            updateDetailInfo(currentPlayingSong);
            // If no lyrics yet, try fetch
            if (currentLyricLines.length === 0) {
                fetchLyric(currentPlayingSong);
            }
            // 仅在音频正在播放时才启动歌词滚动，防止暂停时打开详情页歌词自走
            if (lyricPlayer && !audio.paused) {
                lyricPlayer.play(audio.currentTime * 1000);
            }
            setTimeout(() => scrollToActiveLine(true), 100);
        }

        // Notify visualizer to switch canvas
        setTimeout(() => {
            if (window.musicVisualizer) window.musicVisualizer.applySettings();
        }, 300);

        // 如果开启了自动精简，且在手机端进入详情页，则自动精简
        if (settings.autoCompactPlaybar !== false && window.innerWidth < 1025) {
            window.setCompactPlaybar(true);
        }
    } else {
        view.classList.add('translate-y-[100%]', 'opacity-0');
        setTimeout(() => {
            view.classList.add('hidden');
            // Notify visualizer to switch back to footer
            if (window.musicVisualizer) window.musicVisualizer.applySettings();
        }, 600); // match transition duration

        // 关闭详情页自动展开控制栏
        if (settings.autoCompactPlaybar !== false && window.innerWidth < 1025) {
            window.setCompactPlaybar(false);
        }
    }
}

// 监听浏览器返回，用于在移动端通过物理返回键/手势关闭歌词详情页
window.addEventListener('popstate', (e) => {
    // 1. 优先处理歌词页
    if (isLyricViewOpen) {
        toggleLyrics(true);
        return;
    }

    // 2. 处理搜索详情 (歌手/专辑)
    const backBtn = document.getElementById('search-back-btn');
    if (backBtn && !backBtn.classList.contains('hidden')) {
        goBackToSearch(true);
    }
});

function updateDetailInfo(song) {
    document.getElementById('detail-title').innerText = song.name;
    document.getElementById('detail-artist').innerText = song.singer;
    const imgUrl = getImgUrl(song);
    // Use high res image if possible or same URL
    setImg('detail-cover', imgUrl);
    setImg('detail-bg-cover', imgUrl);
}

async function fetchLyric(song, quality = null) {
    if (!song) {
        return;
    }

    // 支持两种数据结构:
    // 1. 搜索结果: song.songmid, song.source 在顶层
    // 2. 收藏列表: song.songmid, song.source 可能在 meta 中
    // 3. 不同平台字段名差异: songmid vs songId
    let songmid = song.songmid || song.songId;
    let source = song.source;

    // 如果顶层没有,尝试从 meta 中获取
    if (!songmid && song.meta) {
        songmid = song.meta.songmid || song.meta.songId;
    }
    if (!source && song.meta) {
        source = song.meta.source;
    }

    // 如果还是没有必要的数据,退出
    if (!songmid || !source) {
        console.warn('[Lyric] 歌曲缺少必要的字段 songmid/songId 或 source:', song);
        return;
    }

    // [Optimize] 如果歌曲未变化且已有歌词，跳过完整加载流程逻辑
    const currentLyricKey = `${source}_${songmid} `;
    if (lastLyricSongId === currentLyricKey && currentLyricLines.length > 0) {
        console.log(`[Lyric] 歌词已就绪(${currentLyricKey})，同步播放状态`);
        if (lyricPlayer) {
            applyLyricUpdate();
        }
        return;
    }
    lastLyricSongId = currentLyricKey;

    document.getElementById('lyric-content').innerHTML = '<p class="t-text-muted text-lg animate-pulse">正在加载歌词...</p>';
    currentLyricLines = [];

    // ===== 1. 尝试读取浏览器本地缓存 (最高优先级) =====
    const cacheKey = `lx_lyric_${source}_${songmid} `;
    if (settings.enableLyricCache !== false) {
        try {
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const data = JSON.parse(cached);
                currentRawLrc = data.lrc || '';
                currentRawTlrc = data.tlyric || '';
                currentRawRlrc = data.rlyric || '';
                currentRawKlrc = data.klyric || data.lxlyric || '';

                console.log(`[Lyric] 使用浏览器本地缓存歌词: ${songmid} `);
                initLyricPlayer();
                applyLyricUpdate();
                return; // 命中缓存，直接返回
            }
        } catch (e) {
            console.warn('[Lyric] 读取浏览器本地缓存失败:', e);
            localStorage.removeItem(cacheKey);
        }
    }

    // ===== 2. 尝试读取服务器端缓存歌词 =====
    const username = currentListData?.username || '';
    const headers = {};
    Object.assign(headers, getUserAuthHeaders());

    if (settings.enableServerLyricCache !== false) {
        try {
            const serverCacheUrl = `${API_BASE}/cache/lyric?source=${source}&songmid=${songmid}&songId=${encodeURIComponent(song.id || '')}&name=${encodeURIComponent(song.name || '')}&singer=${encodeURIComponent(song.singer || '')}`;
            const scRes = await fetch(serverCacheUrl, { headers });
            if (scRes.ok) {
                const scData = await scRes.json();
                if (scData.success && scData.data) {
                    currentRawLrc = scData.data.lyric || scData.data.lrc || '';
                    currentRawTlrc = scData.data.tlyric || '';
                    currentRawRlrc = scData.data.rlyric || '';
                    currentRawKlrc = scData.data.klyric || scData.data.lxlyric || '';

                    console.log(`[Lyric] 使用服务器端缓存歌词: ${source}_${songmid} `);

                    // 同步到浏览器本地缓存
                    if (settings.enableLyricCache !== false && currentRawLrc) {
                        localStorage.setItem(cacheKey, JSON.stringify({
                            lrc: currentRawLrc, tlyric: currentRawTlrc, rlyric: currentRawRlrc, klyric: currentRawKlrc
                        }));
                    }

                    initLyricPlayer();
                    applyLyricUpdate();
                    return;
                }
            }
        } catch (e) {
            console.warn('[Lyric] 读取服务器端缓存失败:', e);
        }
    }

    // ===== 3. 从网络抓取最新歌词 =====
    try {
        const params = new URLSearchParams({
            source,
            songmid,
            name: song.name || song.songname || '',
            singer: song.singer || song.singername || '',
            hash: song.hash || '',
            interval: song.interval || song.duration || '',
            copyrightId: song.copyrightId || '',
            albumId: song.albumId || '',
            lrcUrl: song.lrcUrl || '',
            mrcUrl: song.mrcUrl || '',
            trcUrl: song.trcUrl || ''
        });

        const url = `${API_BASE}/lyric?${params.toString()}`;
        // [优化] 使用低优先级 fetch 获取歌词，避免阻塞主进程加载和 PWA 安装按钮出现
        const res = await fetch(url, { headers, priority: 'low' });

        if (!res.ok) {
            throw new Error(`Fetch lyric failed: ${res.status}`);
        }

        const data = await res.json();
        currentRawLrc = data.lyric || data.lrc || '';
        currentRawTlrc = data.tlyric || '';
        currentRawRlrc = data.rlyric || '';
        currentRawKlrc = data.klyric || data.lxlyric || '';

        const isFromLocal = !!data._fromLocalCache;
        console.log(`[Lyric] ${isFromLocal ? '使用服务器本地缓存歌词' : '获取到网络歌词'}:`, { source, songmid });

        // ===== 4. 写入缓存 (浏览器本地 + 服务器端) =====
        if (currentRawLrc) {
            const cacheData = {
                lrc: currentRawLrc,
                tlyric: currentRawTlrc,
                rlyric: currentRawRlrc,
                klyric: currentRawKlrc
            };

            // 写入浏览器本地
            if (settings.enableLyricCache !== false) {
                try {
                    localStorage.setItem(cacheKey, JSON.stringify(cacheData));
                    updateStorageStatsUI();
                } catch (e) {
                    console.warn('[Lyric] 写入本地缓存失败:', e);
                }
            }

            // 写入服务器端 (如果不是已经来自服务器缓存，且启用了服务端缓存)
            if (settings.enableServerLyricCache !== false && !isFromLocal) {
                try {
                    fetch(`${API_BASE}/cache/lyric`, {
                        method: 'POST',
                        headers: {
                            ...headers,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            songInfo: { ...song, quality: (typeof quality !== 'undefined' ? quality : (typeof currentQuality !== 'undefined' ? currentQuality : null)) },
                            lyricsObj: {
                                lyric: currentRawLrc,
                                tlyric: currentRawTlrc,
                                rlyric: currentRawRlrc,
                                lxlyric: currentRawKlrc
                            }
                        })
                    }).catch(e => console.warn('[Lyric] 上传服务端缓存失败:', e));
                } catch (e) { }
            }
        }

        if (!currentRawLrc) {
            renderLyric([]);
            return;
        }

        // Initialize LinePlayer
        initLyricPlayer();
        applyLyricUpdate();

    } catch (e) {
        console.error(`[Lyric] Failed (${source}_${songmid}):`, e);
        renderLyric([], `暂无歌词 (${source}: ${songmid})`);
    }
}

// 辅助函数：根据当前设置应用歌词更新
function applyLyricUpdate() {
    if (!lyricPlayer || !currentRawLrc) return;

    const extendedLyrics = [];
    const showTrans = settings.showLyricTranslation !== false;
    const showRoma = settings.showLyricRoma === true;
    const isSwap = settings.swapLyricTransRoma === true;

    if (showTrans && currentRawTlrc && showRoma && currentRawRlrc) {
        if (isSwap) {
            extendedLyrics.push(currentRawRlrc);
            extendedLyrics.push(currentRawTlrc);
        } else {
            extendedLyrics.push(currentRawTlrc);
            extendedLyrics.push(currentRawRlrc);
        }
    } else if (showTrans && currentRawTlrc) {
        extendedLyrics.push(currentRawTlrc);
    } else if (showRoma && currentRawRlrc) {
        extendedLyrics.push(currentRawRlrc);
    }

    // 优先使用逐字歌词 (klyric/lxlyric)，如果不存在则使用普通歌词
    const mainLyric = currentRawKlrc || currentRawLrc;
    lyricPlayer.setLyric(mainLyric, extendedLyrics);

    // [Fix] 仅在音频真正播放时才启动歌词滚动
    if (!audio.paused) {
        lyricPlayer.play(audio.currentTime * 1000);
    } else {
        lyricPlayer.pause(); // 确保强制同步到暂停状态
    }
}

// 辅助函数：初始化歌词播放器
function initLyricPlayer() {
    if (!window.LinePlayer) {
        console.error('[Lyric] LinePlayer not loaded');
        return;
    }

    if (!lyricPlayer) {
        lyricPlayer = new window.LinePlayer({
            offset: 0,
            rate: currentPlaybackRate || 1,
            onPlay: (lineNum, text, curTime) => {
                syncLyricByLineNum(lineNum);
            },
            onSetLyric: (lines, offset) => {
                currentLyricLines = lines;
                window.currentLyricLines = lines; // expose for lyric-card.js
                renderLyric(lines);
            }
        });
    }
}

// Helper function to calculate lyric offset (Center Line)
function getLyricOffset() {
    const containerBox = document.getElementById('lyric-container');
    if (!containerBox) return 0;

    // 无论桌面还是移动端，显示还是隐藏封面，统一使用固定比例参考线
    // 这样可以保证指示器(indicator)高度在切换模式时保持绝对稳定
    const footer = document.getElementById('player-footer');
    const isFooterHidden = footer && footer.classList.contains('translate-y-[110%]');

    // 使用 0.35 作为黄金分割参考线位置 [lyric-scroll-indicator]
    const ratio = isFooterHidden ? 0.25 : 0.25;
    return containerBox.clientHeight * ratio;
}

// Helper to scroll to active line
function scrollToActiveLine(force = false) {
    if (isUserScrolling && !force) return;

    const containerBox = document.getElementById('lyric-container');
    const lyricContent = document.getElementById('lyric-content');
    if (!containerBox || !lyricContent) return;

    const lines = lyricContent.children;
    if (lines.length === 0) return;

    // Use currentLyricIndex, default to 0 if invalid
    let targetIndex = currentLyricIndex;
    if (targetIndex < 0 || targetIndex >= lines.length) targetIndex = 0;

    const currentLine = lines[targetIndex];
    if (!currentLine) return;

    const lineTop = currentLine.offsetTop;

    // 计算目标参考线位置
    const offsetInContainer = getLyricOffset();

    const targetScroll = lineTop - offsetInContainer;

    // 标记为程序滚动
    isProgrammaticScroll = true;

    // Clear any existing forced cleanup timer
    if (window.programmaticScrollTimer) clearTimeout(window.programmaticScrollTimer);

    containerBox.scrollTo({
        top: targetScroll,
        behavior: 'smooth'
    });

    // 1500ms 后清除标记 (给予平滑滚动足够的时间)
    window.programmaticScrollTimer = setTimeout(() => {
        isProgrammaticScroll = false;
        window.programmaticScrollTimer = null;
    }, 1500);
}

// Sync lyric by line number (called by LinePlayer)
function syncLyricByLineNum(lineNum) {
    // Always update the highlight classes regardless of scroll
    const container = document.getElementById('lyric-content');
    if (!container) return;

    const lines = container.children;

    // Check if index actually changed to update classes
    if (lineNum !== currentLyricIndex) {
        currentLyricIndex = lineNum;
        window.currentLyricIndex = lineNum;   // expose for lyric-card.js
        window.currentLyricLines = currentLyricLines; // expose for lyric-card.js

        // Remove active class from previous line
        const prev = container.querySelector('.active');
        if (prev) prev.classList.remove('active');

        // Add active class to current line
        if (lineNum >= 0 && lineNum < lines.length) {
            lines[lineNum].classList.add('active');
        }

        // SMTC 歌词显示：将当前歌词行写入 MediaSession metadata.title，artist 显示「歌曲名 - 歌手名」
        if ('mediaSession' in navigator && navigator.mediaSession.metadata && settings.enableSmtcLyric) {
            try {
                const lyricText = (lineNum >= 0 && currentLyricLines && currentLyricLines[lineNum])
                    ? currentLyricLines[lineNum].text
                    : '';
                const song = currentPlayingSong;
                const songTitle = song ? song.name : '';
                navigator.mediaSession.metadata.title = lyricText || songTitle;
                // artist 字段保留「歌曲名 - 歌手名」，让用户知道当前播放的歌曲
                if (song) {
                    navigator.mediaSession.metadata.artist = `${song.name} - ${song.singer}`;
                }
            } catch (e) {
                // ignore
            }
        }
    }

    // 仅在正在播放且有逐字歌词时，才启动动画循环
    if (wordAnimationId) cancelAnimationFrame(wordAnimationId);
    if (!audio.paused && lineNum >= 0 && lineNum < lines.length) {
        const lineData = currentLyricLines[lineNum];
        if (lineData && lineData.words && lineData.words.length > 0) {
            startWordProgressUpdate(lineNum, lines[lineNum], lineData);
        }
    }

    // Perform scroll (scrollToActiveLine handles isUserScrolling check)
    scrollToActiveLine();
}

/**
 * 启动逐字动画更新循环 (仅针对有逐字数据的行)
 */
function startWordProgressUpdate(lineIndex, lineEl, lineData) {
    const wordSpans = lineEl.querySelectorAll('.word-item');
    if (!wordSpans.length) return;

    const lineStartTime = lineData.time;

    // 获取该行最后一个字结束的真实时长作为整行时长
    let lineDuration = 5000;
    const lastWord = lineData.words[lineData.words.length - 1];
    if (lastWord) {
        lineDuration = lastWord.startTime + lastWord.duration;
    }
    if (lineDuration <= 0) lineDuration = 5000;

    // 提前计算本行所有字的总演唱时长，用于翻译进度的精准映射
    let totalWordsDuration = 0;
    wordSpans.forEach(span => {
        totalWordsDuration += parseInt(span.dataset.duration) || 0;
    });

    function update() {
        // 如果当前播放行已改变，或音频暂停，停止动画
        if (currentLyricIndex !== lineIndex || audio.paused) {
            return;
        }

        const curTimeMs = audio.currentTime * 1000;
        const relativeTime = curTimeMs - lineStartTime;

        let sungDuration = 0;

        // 2. 更新逐字进度
        wordSpans.forEach(span => {
            const start = parseInt(span.dataset.start);
            const duration = parseInt(span.dataset.duration);

            if (relativeTime >= start + duration) {
                // 已播放完
                sungDuration += duration;
                span.style.setProperty('--word-progress', '100%');
                span.classList.add('passed');
                span.classList.remove('playing');
            } else if (relativeTime >= start) {
                // 正在播放中
                sungDuration += (relativeTime - start);
                const progress = Math.min(100, Math.max(0, ((relativeTime - start) / duration) * 100));
                span.style.setProperty('--word-progress', `${progress}%`);
                span.classList.add('playing');
                span.classList.remove('passed');
            } else {
                // 尚未播放
                span.style.setProperty('--word-progress', '0%');
                span.classList.remove('passed', 'playing');
            }
        });

        // 1. 更新整行进度 (用于带有逐字数据的翻译/罗马音平滑扫过)
        // 通过 实际已唱时长 / 总发声时长，实现翻译和原词进度严丝合缝对齐，消除"晚来早走"现象
        const lineProgress = totalWordsDuration > 0 ? (sungDuration / totalWordsDuration) * 100 : Math.min(100, Math.max(0, (relativeTime / lineDuration) * 100));
        lineEl.style.setProperty('--line-progress', `${lineProgress}%`);

        // 2. 更新扩展歌词逐字类 (翻译/罗马音) - 实现与主词同步的平滑“染色”
        const extSpans = lineEl.querySelectorAll('.extended');
        extSpans.forEach(ext => {
            const items = ext.querySelectorAll('.ext-item');
            const itemCount = items.length;
            if (itemCount > 0) {
                const perItemWeight = 100 / itemCount;
                items.forEach((item, idx) => {
                    const itemStart = idx * perItemWeight;
                    const itemEnd = (idx + 1) * perItemWeight;

                    if (lineProgress >= itemEnd) {
                        item.style.setProperty('--word-progress', '100%');
                        item.classList.add('passed');
                        item.classList.remove('playing');
                    } else if (lineProgress >= itemStart) {
                        // 正在该字符/单词内平滑填充
                        const progress = ((lineProgress - itemStart) / perItemWeight) * 100;
                        item.style.setProperty('--word-progress', `${progress}%`);
                        item.classList.add('playing');
                        item.classList.remove('passed');
                    } else {
                        item.style.setProperty('--word-progress', '0%');
                        item.classList.remove('passed', 'playing');
                    }
                });
            }
        });

        wordAnimationId = requestAnimationFrame(update);
    }

    wordAnimationId = requestAnimationFrame(update);
}

// 节流函数
let scrollThrottleTimer = null;

// 用户手动滚动歌词
function handleLyricScroll() {
    // 忽略程序自动滚动
    if (isProgrammaticScroll) {
        return;
    }

    // 标记用户正在滚动
    isUserScrolling = true;

    // 显示指示器
    const indicator = document.getElementById('lyric-scroll-indicator');
    const container = document.getElementById('lyric-container');
    if (indicator && container) {
        // [Fix] 每次显示时动态更新高度，确保与自动滚动对齐点一致
        // indicator 是绝对定位在 lyrics-wrapper 内 (父容器)
        // offset 是相对于 lyric-container 顶部的距离 (子容器)
        // lyric-container 顶部可能有 Title 占据空间，因此需要加上 container.offsetTop
        const offset = getLyricOffset();
        indicator.style.top = `${container.offsetTop + offset}px`;

        indicator.classList.remove('hidden');
        indicator.style.display = 'flex';
    }

    // 清除之前的计时器
    if (scrollLockTimeout) {
        clearTimeout(scrollLockTimeout);
    }

    // 优化：如果有正在等待的帧，直接返回，不重复计算 (Leading throttle behavior)
    if (scrollThrottleTimer) {
        return;
    }

    // 使用 requestAnimationFrame 实时更新（约16ms一次，流畅无延迟）
    scrollThrottleTimer = requestAnimationFrame(() => {
        updateScrollIndicator();
        scrollThrottleTimer = null;
    });

    // 5秒后恢复自动滚动并隐藏指示器
    scrollLockTimeout = setTimeout(() => {
        isUserScrolling = false;
        scrollLockTimeout = null;

        // 隐藏指示器
        if (indicator) {
            indicator.classList.add('hidden');
            indicator.style.display = 'none';
        }

        // 清除滚动目标高亮
        const lyricContent = document.getElementById('lyric-content');
        if (lyricContent) {
            const lines = lyricContent.children;
            for (let i = 0; i < lines.length; i++) {
                lines[i].classList.remove('scroll-target');
            }
        }

        // 恢复后立即同步到当前播放位置
        if (lyricPlayer && !audio.paused) {
            // 确保内部状态同步
            lyricPlayer.play(audio.currentTime * 1000);
        }

        // [Fix] 立即滚动回当前歌词，不等待下一句更新
        scrollToActiveLine(true);

    }, SCROLL_LOCK_DURATION);
}

// 更新滚动指示器（显示当前对准的歌词时间）
function updateScrollIndicator() {
    const container = document.getElementById('lyric-container');
    const indicator = document.getElementById('lyric-scroll-indicator');
    const lyricContent = document.getElementById('lyric-content');

    // 如果不在滚动状态，清除所有高亮并返回
    if (!container || !indicator || !lyricContent || !isUserScrolling) {
        if (lyricContent) {
            const lines = lyricContent.children;
            for (let i = 0; i < lines.length; i++) {
                lines[i].classList.remove('scroll-target');
            }
        }
        return;
    }


    // [Refactor] 虚线位置已在 handleLyricScroll 中动态设置，这里不再需要一次性初始化
    // 且现在完全依赖 getLyricOffset() 保证位置统一

    // 直接获取虚线的实际屏幕位置
    const indicatorRect = indicator.getBoundingClientRect();
    const referenceY = indicatorRect.top + indicatorRect.height / 2;

    const lines = lyricContent.children;
    let overlapIndex = -1;
    let closestIndex = -1;
    let minDist = Infinity;

    // 遍历查找重叠或最近的歌词行
    // 改为纯几何碰撞检测，比 elementFromPoint 更可靠
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const rect = line.getBoundingClientRect();

        // 1. 检查是否重叠 (Green line inside the rect)
        if (referenceY >= rect.top && referenceY <= rect.bottom) {
            overlapIndex = i;
        }

        // 2. 检查距离 (Fallback)
        const center = rect.top + rect.height / 2;
        const dist = Math.abs(center - referenceY);
        if (dist < minDist) {
            minDist = dist;
            closestIndex = i;
        }
    }

    // 优先使用重叠的行，其次使用距离最近的行
    const targetIndex = overlapIndex !== -1 ? overlapIndex : closestIndex;

    let targetTime = 0;
    if (targetIndex !== -1 && lines[targetIndex]) {
        targetTime = parseFloat(lines[targetIndex].dataset.time) / 1000;
    }

    // 高亮对应的歌词行
    for (let i = 0; i < lines.length; i++) {
        if (i === targetIndex) {
            lines[i].classList.add('scroll-target');
        } else {
            lines[i].classList.remove('scroll-target');
        }
    }

    // 更新时间显示
    const timeDisplay = indicator.querySelector('.time-display');
    if (timeDisplay && targetTime > 0) {
        const minutes = Math.floor(targetTime / 60);
        const seconds = Math.floor(targetTime % 60);
        timeDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
}

// renderLyric function - generates DOM elements for each lyric line
function renderLyric(lines, emptyMsg = '暂无歌词') {
    const container = document.getElementById('lyric-content');
    container.innerHTML = '';

    if (lines.length === 0) {
        container.innerHTML = `<p class="t-text-muted text-lg font-medium">${emptyMsg}</p>`;
        return;
    }

    // 根据设置决定是否开启荧光效果
    if (settings.enableLyricGlow !== false) {
        container.classList.add('enable-lyric-glow');
    } else {
        container.classList.remove('enable-lyric-glow');
    }

    // Create fragment for better performance
    const frag = document.createDocumentFragment();

    lines.forEach((line, idx) => {
        const div = document.createElement('div');
        div.className = `lyric-line relative py-2 px-1 text-center md:text-left transition-all duration-300`;
        div.dataset.time = line.time;
        div.dataset.index = idx;

        // Click to seek
        div.onclick = () => {
            // line.time 是毫秒，audio.currentTime 需要秒
            audio.currentTime = line.time / 1000;

            // 立即更新 UI 高亮和位置，提供即时反馈
            syncLyricByLineNum(idx);
            scrollToActiveLine(true);

            // 解除滚动锁定
            isUserScrolling = false;
            if (scrollLockTimeout) {
                clearTimeout(scrollLockTimeout);
                scrollLockTimeout = null;
            }

            // 隐藏指示器
            const indicator = document.getElementById('lyric-scroll-indicator');
            if (indicator) {
                indicator.classList.add('hidden');
                indicator.style.display = 'none';
            }

            // [Fix] 清除所有的高亮样式 (scroll-target)
            const allLines = document.querySelectorAll('.lyric-line');
            allLines.forEach(l => l.classList.remove('scroll-target'));


        };

        // Inner content wrapper
        const contentDiv = document.createElement('div');
        contentDiv.className = 'line-content';

        // Main lyric text
        const span = document.createElement('span');
        span.className = 'font-lrc text-gray-500 transition-all block w-fit mx-auto md:ml-0';

        if (line.words && line.words.length > 0) {
            div.classList.add('has-words');
            line.words.forEach(word => {
                const wordSpan = document.createElement('span');
                wordSpan.className = 'word-item';
                wordSpan.textContent = word.text;
                wordSpan.dataset.start = word.startTime;
                wordSpan.dataset.duration = word.duration;
                span.appendChild(wordSpan);
            });
        } else {
            span.textContent = line.text;
            span.classList.add('plain-lyric');
        }

        contentDiv.appendChild(span);

        // Extended Lyrics (Translation, Romanization, etc.)
        if (line.extendedLyrics && line.extendedLyrics.length > 0) {
            line.extendedLyrics.forEach(extText => {
                if (!extText) return;
                const extSpan = document.createElement('span');
                extSpan.className = 'extended t-text-muted block w-fit mx-auto md:ml-0';

                // 逐字/逐字符拆分：中日韩按字符，其他按空格
                const hasCJK = /[\u4e00-\u9fa5]|[\u3040-\u309f]|[\u30a0-\u30ff]/.test(extText);
                const segments = hasCJK ? extText.split('') : extText.split(/(\s+)/).filter(s => s.length > 0);

                segments.forEach(seg => {
                    const s = document.createElement('span');
                    s.className = 'ext-item';
                    s.textContent = seg;
                    extSpan.appendChild(s);
                });

                contentDiv.appendChild(extSpan);
            });
        }

        div.appendChild(contentDiv);
        frag.appendChild(div);
    });

    container.appendChild(frag);

    // [Fix] Ensure we are in auto-scroll mode and centered on load
    isUserScrolling = false;

    // If audio is already playing, sync the player immediately to highlight the right line
    if (lyricPlayer && !audio.paused) {
        lyricPlayer.play(audio.currentTime * 1000);
    }

    // Force a scroll update after a short delay to ensure layout is ready
    setTimeout(() => {
        scrollToActiveLine(true);
    }, 100);
}


// syncLyric removed - LinePlayer handles all syncing via syncLyricByLineNum callback
// Audio timeupdate listener removed - LinePlayer automatically syncs lyrics

// Hook into PlaySong to clear/fetch lyrics
const originalPlaySong = window.playSong;
// We need to intercept playSong call in some way or just update playSong function?
// Since I can't override const declared in file easily without redefining,
// I will just modify the `playSong` function inside `app.js` using replace, OR
// I can just rely on `updatePlayerInfo` which is called by `playSong`.

// Let's modify `updatePlayerInfo` to also trigger generic 'song changed' event logic?
// No, I'll modify `playSong` via Replace.
// Wait, I can't easily replace the whole `playSong` as it's big.
// I will just Hook into `updatePlayerInfo` as it is called when song starts.
// Actually `updatePlayerInfo` is perfect.

const _originalUpdatePlayerInfo = updatePlayerInfo;
updatePlayerInfo = function (song, actualQuality) {
    _originalUpdatePlayerInfo(song, actualQuality);
    // Detail View update
    updateDetailInfo(song);
    // fetchLyric(song); // [Moved] 移至 playSong 中精确控制时机
};

window.toggleLyrics = toggleLyrics;

// Initial
console.log('App.js loaded successfully');

// Initialize Favorites as hidden (collapsed)
const favList = document.getElementById('favorites-children');
if (favList) {
    favList.style.height = '0px';
    // favList.classList.add('hidden'); // using height transition instead
}

function refreshFavoritesChildrenHeight() {
    const list = document.getElementById('favorites-children');
    if (!list || list.style.height === '0px' || list.style.height === '') return;

    const currentHeight = list.getBoundingClientRect().height;
    list.style.height = 'auto';
    const targetHeight = list.scrollHeight;
    list.style.height = currentHeight + 'px';

    requestAnimationFrame(() => {
        list.style.height = targetHeight + 'px';
    });
}

function toggleFavorites() {
    const list = document.getElementById('favorites-children');
    const arrow = document.getElementById('favorites-arrow');
    if (!list) return;

    // Toggle logic
    if (list.style.height === '0px' || list.style.height === '') {
        list.style.height = 'auto';
        const targetHeight = list.scrollHeight;
        list.style.height = '0px';
        requestAnimationFrame(() => {
            list.style.height = targetHeight + 'px';
        });
        if (arrow) arrow.style.transform = 'rotate(0deg)'; // Arrow down
    } else {
        list.style.height = '0px';
        if (arrow) arrow.style.transform = 'rotate(-90deg)'; // Arrow right
    }
}

// Initial rotate for collapsed state
const favArrow = document.getElementById('favorites-arrow');
if (favArrow) favArrow.style.transform = 'rotate(-90deg)';

// ========== Library 收藏歌手/专辑 ==========

/** 全局 library 数据 */
window.libraryData = { artists: [], albums: [] };

/** 批量选中的 library 条目（id 集合） */
window.libraryBatchSelected = new Set();
window.libraryBatchMode = false; // 'artist' | 'album' | false

/** 从后端加载两个 library 文件（自动感知公开收藏状态） */
async function loadLibraryData() {
    try {
        const isPublic = window.isViewingPublicFavorites === true || !isUserLoggedIn();
        let headers = {};
        let artistsUrl = '/api/user/library/artists';
        let albumsUrl = '/api/user/library/albums';

        if (isPublic) {
            // 公开收藏模式：拉 _open 的歌手/专辑库
            const adminPass = localStorage.getItem('lx_admin_password');
            if (adminPass) headers['x-frontend-auth'] = adminPass;
            headers['x-user-name'] = '_open';
            artistsUrl += '?user=_open';
            albumsUrl += '?user=_open';
        } else {
            headers = getUserAuthHeaders();
        }

        const [ar, al] = await Promise.all([
            fetch(artistsUrl, { headers }).then(r => r.ok ? r.json() : []),
            fetch(albumsUrl, { headers }).then(r => r.ok ? r.json() : [])
        ]);
        window.libraryData.artists = Array.isArray(ar) ? ar : [];
        window.libraryData.albums = Array.isArray(al) ? al : [];

        if (!isPublic && isUserLoggedIn()) {
            window.myPersonalLibraryData = {
                artists: [...window.libraryData.artists],
                albums: [...window.libraryData.albums]
            };
        }

        // 刷新侧边栏数量
        refreshLibrarySidebarCount();
        if (window.currentViewingListId === '__lib_artists__' && typeof renderLibraryArtists === 'function') {
            renderLibraryArtists(window.libraryData.artists);
        } else if (window.currentViewingListId === '__lib_albums__' && typeof renderLibraryAlbums === 'function') {
            renderLibraryAlbums(window.libraryData.albums);
        }
    } catch (e) {
        console.warn('[Library] 加载失败:', e);
    }
}
window.loadLibraryData = loadLibraryData;


/** 刷新侧边栏常驻项的数量徽标 */
function refreshLibrarySidebarCount() {
    const artCount = document.getElementById('lib-artist-count');
    const albCount = document.getElementById('lib-album-count');
    if (artCount) artCount.textContent = window.libraryData.artists.length;
    if (albCount) albCount.textContent = window.libraryData.albums.length;
}

/** 持久化 artists 到后端（自动感知公开收藏状态） */
async function saveLibraryArtists(customList = null) {
    try {
        const isPublic = !isUserLoggedIn() || (!customList && window.isViewingPublicFavorites);
        const listToSave = customList || window.libraryData.artists;
        let headers = { 'Content-Type': 'application/json' };
        let url = '/api/user/library/artists';
        if (isPublic) {
            const adminPass = localStorage.getItem('lx_admin_password');
            if (adminPass) headers['x-frontend-auth'] = adminPass;
            headers['x-user-name'] = '_open';
            url += '?user=_open';
        } else {
            headers = { 'Content-Type': 'application/json', ...getUserAuthHeaders() };
        }
        await fetch(url, { method: 'POST', headers, body: JSON.stringify(listToSave) });
        refreshLibrarySidebarCount();
    } catch (e) { console.error('[Library] 保存歌手失败:', e); }
}

/** 持久化 albums 到后端（自动感知公开收藏状态） */
async function saveLibraryAlbums(customList = null) {
    try {
        const isPublic = !isUserLoggedIn() || (!customList && window.isViewingPublicFavorites);
        const listToSave = customList || window.libraryData.albums;
        let headers = { 'Content-Type': 'application/json' };
        let url = '/api/user/library/albums';
        if (isPublic) {
            const adminPass = localStorage.getItem('lx_admin_password');
            if (adminPass) headers['x-frontend-auth'] = adminPass;
            headers['x-user-name'] = '_open';
            url += '?user=_open';
        } else {
            headers = { 'Content-Type': 'application/json', ...getUserAuthHeaders() };
        }
        await fetch(url, { method: 'POST', headers, body: JSON.stringify(listToSave) });
        refreshLibrarySidebarCount();
    } catch (e) { console.error('[Library] 保存专辑失败:', e); }
}


/** 切换歌手收藏；返回最新收藏状态 true/false */
async function toggleArtistFavorite(id, source, name, picUrl) {
    if (isUserLoggedIn()) {
        const targetList = (window.isViewingPublicFavorites && window.myPersonalLibraryData)
            ? window.myPersonalLibraryData.artists
            : window.libraryData.artists;

        const idx = targetList.findIndex(a => String(a.id) === String(id) && a.source === source);
        if (idx >= 0) {
            targetList.splice(idx, 1);
            await saveLibraryArtists(targetList);
            showInfo(`已取消收藏歌手「${name}」`);
            return false;
        } else {
            targetList.push({ id, source, name, picUrl: picUrl || '' });
            await saveLibraryArtists(targetList);
            showSuccess(`已收藏歌手「${name}」`);
            return true;
        }
    } else {
        if (!(await requireAdminForOpenWrite('修改公开收藏歌手'))) return false;
        const list = window.libraryData.artists;
        const idx = list.findIndex(a => String(a.id) === String(id) && a.source === source);
        if (idx >= 0) {
            list.splice(idx, 1);
            await saveLibraryArtists(list);
            showInfo(`已取消公开收藏歌手「${name}」`);
            return false;
        } else {
            list.push({ id, source, name, picUrl: picUrl || '' });
            await saveLibraryArtists(list);
            showSuccess(`已收藏公开歌手「${name}」`);
            return true;
        }
    }
}
window.toggleArtistFavorite = toggleArtistFavorite;

/** 检查歌手是否已收藏 */
function isArtistFavorited(id, source) {
    const list = (isUserLoggedIn() && window.isViewingPublicFavorites && window.myPersonalLibraryData)
        ? window.myPersonalLibraryData.artists
        : window.libraryData.artists;
    return list.some(a => String(a.id) === String(id) && a.source === source);
}
window.isArtistFavorited = isArtistFavorited;

/** 切换专辑收藏；返回最新收藏状态 true/false */
async function toggleAlbumFavorite(id, source, name, picUrl, artistName) {
    if (isUserLoggedIn()) {
        const targetList = (window.isViewingPublicFavorites && window.myPersonalLibraryData)
            ? window.myPersonalLibraryData.albums
            : window.libraryData.albums;

        const idx = targetList.findIndex(a => String(a.id) === String(id) && a.source === source);
        if (idx >= 0) {
            targetList.splice(idx, 1);
            await saveLibraryAlbums(targetList);
            showInfo(`已取消收藏专辑「${name}」`);
            return false;
        } else {
            targetList.push({
                id,
                source,
                name,
                picUrl: picUrl || '',
                artistName: artistName || '',
                interval: '00:00',
                meta: { albumId: id, picUrl: picUrl || '', albumName: name }
            });
            await saveLibraryAlbums(targetList);
            showSuccess(`已收藏专辑「${name}」`);
            return true;
        }
    } else {
        if (!(await requireAdminForOpenWrite('修改公开收藏专辑'))) return false;
        const list = window.libraryData.albums;
        const idx = list.findIndex(a => String(a.id) === String(id) && a.source === source);
        if (idx >= 0) {
            list.splice(idx, 1);
            await saveLibraryAlbums(list);
            showInfo(`已取消公开收藏专辑「${name}」`);
            return false;
        } else {
            list.push({
                id,
                source,
                name,
                picUrl: picUrl || '',
                artistName: artistName || '',
                interval: '00:00',
                meta: { albumId: id, picUrl: picUrl || '', albumName: name }
            });
            await saveLibraryAlbums(list);
            showSuccess(`已收藏公开专辑「${name}」`);
            return true;
        }
    }
}
window.toggleAlbumFavorite = toggleAlbumFavorite;


/**
 * [新增] 当加载专辑详情后，更新收藏库中该专辑的元数据（如音质列表、时长等）
 */
async function updateAlbumLibraryMeta(id, source, data) {
    if (!window.libraryData || !window.libraryData.albums) return;
    const album = window.libraryData.albums.find(a => String(a.id) === String(id) && a.source === source);
    if (!album) return;

    const info = data.info || {};
    const songList = data.list || [];

    // [核心修改] 将完整的歌曲列表保存到 album.list 字段下
    if (songList.length > 0) {
        album.list = songList;

        // 补充专辑本身的展示元数据和时长
        const first = songList[0];
        album.interval = first.interval || album.interval || '00:00';

        album.meta = album.meta || {};
        album.meta.albumId = id;
        album.meta.picUrl = album.picUrl || info.img || info.pic || first.meta?.picUrl;
        album.meta.albumName = album.name || info.name || first.meta?.albumName;

        // 兼容性字段：取第一首歌的 meta 信息（对应用户示例）
        if (first.meta) {
            album.meta.qualitys = first.meta.qualitys;
            album.meta._qualitys = first.meta._qualitys;
            album.meta.songId = first.meta.songId;
        }
    }

    try {
        await saveLibraryAlbums();
        console.log(`[Library] 已成功丰富专辑「${album.name}」的歌曲列表 (${songList.length} 首)`);
    } catch (e) {
        console.error('[Library] 自动更新专辑元数据失败:', e);
    }
}
window.updateAlbumLibraryMeta = updateAlbumLibraryMeta;

/**
 * [新增] 一键同步所有收藏专辑的歌曲列表
 */
async function syncAllLibraryAlbums() {
    if (!window.libraryData || !window.libraryData.albums.length) return;
    const list = window.libraryData.albums;

    const btn = document.getElementById('sync-all-albums-btn');
    if (!btn) return;

    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('opacity-50', 'cursor-not-allowed');

    let successCount = 0;
    try {
        for (let i = 0; i < list.length; i++) {
            const album = list[i];
            btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-1"></i> ${i + 1}/${list.length}`;

            try {
                const res = await fetch(`${API_BASE}/albumSongs?id=${album.id}&source=${album.source || 'wy'}`);
                if (res.ok) {
                    const data = await res.json();
                    await updateAlbumLibraryMeta(album.id, album.source || 'wy', data);
                    successCount++;
                }
            } catch (err) {
                console.error(`[Library] 同步专辑「${album.name}」失败:`, err);
            }
            // 避免请求过快
            if (list.length > 3) await new Promise(r => setTimeout(r, 200));
        }
        showSuccess(`同步完成！成功更新 ${successCount} 个专辑的数据。`);
        // 重新渲染当前视图
        if (currentSearchScope === 'lib_albums') {
            renderLibraryAlbums(window.libraryData.albums);
        }
    } catch (err) {
        showError('全量同步过程中发生异常');
    } finally {
        btn.disabled = false;
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
        btn.innerHTML = originalContent;
    }
}
window.syncAllLibraryAlbums = syncAllLibraryAlbums;

/** 检查专辑是否已收藏 */
function isAlbumFavorited(id, source) {
    const list = (isUserLoggedIn() && window.isViewingPublicFavorites && window.myPersonalLibraryData)
        ? window.myPersonalLibraryData.albums
        : window.libraryData.albums;
    return list.some(a => String(a.id) === String(id) && a.source === source);
}
window.isAlbumFavorited = isAlbumFavorited;

/**
 * 渲染收藏歌手列表（带批量操作支持）
 * 直接复用搜索结果容器
 */
function renderLibraryArtists(list) {
    const container = document.getElementById('search-results');
    const header = document.getElementById('search-results-header');
    const paginationBar = document.getElementById('search-pagination-bar');
    if (header) header.classList.add('hidden');
    if (paginationBar) paginationBar.classList.add('hidden');

    window.libraryBatchMode = false;
    window.libraryBatchSelected.clear();
    window.viewingPlaylist = list;

    if (!list || list.length === 0) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full t-text-muted space-y-4">
                <i class="fas fa-user-slash text-6xl opacity-20"></i>
                <p>还没有收藏任何歌手</p>
                <p class="text-xs">在搜索结果中点击 ♥ 收藏歌手</p>
            </div>`;
        return;
    }

    container.innerHTML = `
        <div class="p-3 md:p-4 border-b t-border-main t-bg-main flex items-center justify-between">
            <span class="text-sm font-bold t-text-main">收藏歌手 <span class="text-emerald-500">${list.length}</span> 位</span>
            <div class="flex items-center gap-2">
                <button onclick="enterLibraryArtistBatch()" class="text-xs px-3 py-1.5 border t-border-main rounded-lg t-text-muted hover:text-emerald-600 hover:border-emerald-400 transition-all flex items-center gap-1">
                    <i class="fas fa-tasks"></i> 批量管理
                </button>
            </div>
        </div>
        <div id="lib-artist-batch-bar" class="hidden bg-emerald-50 border-b border-emerald-200 p-3 flex items-center justify-between">
            <div class="flex items-center gap-3">
                <span class="text-sm text-emerald-700">已选: <span id="lib-artist-sel-count" class="font-bold">0</span></span>
                <button onclick="libSelectAllArtists()" class="text-xs px-3 py-1 t-bg-panel border border-emerald-300 rounded hover:bg-emerald-50 text-emerald-700">全选</button>
                <button onclick="libDeselectAllArtists()" class="text-xs px-3 py-1 t-bg-panel border t-border-main rounded hover:t-bg-track t-text-muted">清空</button>
                <button onclick="exitLibraryArtistBatch()" class="text-xs px-3 py-1 t-bg-panel border border-red-300 rounded hover:bg-red-50 text-red-600">退出</button>
            </div>
            <button onclick="libDeleteSelectedArtists()" class="text-xs px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded transition-colors flex items-center gap-1">
                <i class="fas fa-trash"></i> 删除所选
            </button>
        </div>
        <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 md:gap-4 p-3 md:p-6" id="lib-artist-grid"></div>`;

    const grid = container.querySelector('#lib-artist-grid');
    list.forEach(singer => {
        const div = document.createElement('div');
        div.className = 'group relative flex flex-col items-center p-2 md:p-4 rounded-2xl transition-all hover:t-bg-panel hover:shadow-md cursor-pointer border border-transparent hover:border-emerald-500/30';
        div.dataset.libArtistId = singer.id;
        div.dataset.libArtistSource = singer.source;
        div.onclick = (e) => {
            if (e.target.closest('.lib-batch-check') || e.target.closest('.lib-fav-btn')) return;
            if (window.libraryBatchMode === 'artist') {
                toggleLibArtistBatchSelect(singer.id);
                return;
            }
            enterArtist(singer.id, singer.source || 'wy');
        };
        div.innerHTML = `
            <div class="relative mb-2 md:mb-3">
                <div class="w-16 h-16 sm:w-24 sm:h-24 md:w-32 md:h-32 rounded-full overflow-hidden shadow-sm">
                    <img src="${singer.picUrl || '/music/assets/logo.svg'}"
                         onerror="this.src='/music/assets/logo.svg'"
                         class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500">
                </div>
                <div class="lib-batch-check absolute inset-0 bg-black/40 hidden items-center justify-center rounded-full">
                    <i class="fas fa-check-circle text-white text-2xl"></i>
                </div>
                <button class="lib-fav-btn absolute -top-1 -right-1 w-6 h-6 md:w-7 md:h-7 rounded-full bg-red-400/80 hover:bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md z-10"
                        title="取消收藏"
                        onclick="event.stopPropagation(); removeLibraryArtist('${singer.id}', '${singer.source}')">
                    <i class="fas fa-times text-[10px]"></i>
                </button>
            </div>
            <span class="text-[11px] md:text-sm font-bold t-text-main text-center truncate w-full" title="${singer.name}">${singer.name}</span>
            <div class="mt-1">${getSourceTag ? getSourceTag(singer.source || 'wy') : (singer.source || 'wy').toUpperCase()}</div>`;
        grid.appendChild(div);
    });
}
window.renderLibraryArtists = renderLibraryArtists;

/** 渲染收藏专辑列表（带批量操作支持） */
function renderLibraryAlbums(list) {
    const container = document.getElementById('search-results');
    const header = document.getElementById('search-results-header');
    const paginationBar = document.getElementById('search-pagination-bar');
    if (header) header.classList.add('hidden');
    if (paginationBar) paginationBar.classList.add('hidden');

    window.libraryBatchMode = false;
    window.libraryBatchSelected.clear();
    window.viewingPlaylist = list;

    if (!list || list.length === 0) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full t-text-muted space-y-4">
                <i class="fas fa-compact-disc text-6xl opacity-20"></i>
                <p>还没有收藏任何专辑</p>
                <p class="text-xs">在搜索结果中点击 ♥ 收藏专辑</p>
            </div>`;
        return;
    }

    container.innerHTML = `
        <div class="p-3 md:p-4 border-b t-border-main t-bg-main flex items-center justify-between">
            <span class="text-sm font-bold t-text-main">收藏专辑 <span class="text-emerald-500">${list.length}</span> 张</span>
            <div class="flex items-center gap-2">
                <button id="sync-all-albums-btn" onclick="syncAllLibraryAlbums()" class="text-xs px-3 py-1.5 border t-border-main rounded-lg t-text-muted hover:text-blue-500 hover:border-blue-400 transition-all flex items-center gap-1">
                    <i class="fas fa-sync-alt"></i> 同步所有
                </button>
                <button onclick="enterLibraryAlbumBatch()" class="text-xs px-3 py-1.5 border t-border-main rounded-lg t-text-muted hover:text-emerald-600 hover:border-emerald-400 transition-all flex items-center gap-1">
                    <i class="fas fa-tasks"></i> 批量管理
                </button>
            </div>
        </div>
        <div id="lib-album-batch-bar" class="hidden bg-emerald-50 border-b border-emerald-200 p-3 flex items-center justify-between">
            <div class="flex items-center gap-3">
                <span class="text-sm text-emerald-700">已选: <span id="lib-album-sel-count" class="font-bold">0</span></span>
                <button onclick="libSelectAllAlbums()" class="text-xs px-3 py-1 t-bg-panel border border-emerald-300 rounded hover:bg-emerald-50 text-emerald-700">全选</button>
                <button onclick="libDeselectAllAlbums()" class="text-xs px-3 py-1 t-bg-panel border t-border-main rounded hover:t-bg-track t-text-muted">清空</button>
                <button onclick="exitLibraryAlbumBatch()" class="text-xs px-3 py-1 t-bg-panel border border-red-300 rounded hover:bg-red-50 text-red-600">退出</button>
            </div>
            <button onclick="libDeleteSelectedAlbums()" class="text-xs px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded transition-colors flex items-center gap-1">
                <i class="fas fa-trash"></i> 删除所选
            </button>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 p-6" id="lib-album-grid"></div>`;

    const grid = container.querySelector('#lib-album-grid');
    list.forEach(item => {
        const div = document.createElement('div');
        div.className = 'group relative flex flex-col p-3 rounded-2xl transition-all hover:t-bg-panel hover:shadow-lg cursor-pointer border border-transparent hover:border-emerald-500/20';
        div.dataset.libAlbumId = item.id;
        div.dataset.libAlbumSource = item.source;
        div.onclick = (e) => {
            if (e.target.closest('.lib-batch-check') || e.target.closest('.lib-fav-btn') || e.target.closest('.lib-album-download-btn')) return;
            if (window.libraryBatchMode === 'album') {
                toggleLibAlbumBatchSelect(item.id);
                return;
            }
            enterAlbum(item.id, item.source || 'wy');
        };
        div.innerHTML = `
            <div class="aspect-square rounded-xl overflow-hidden shadow-md mb-3 relative">
                <img src="${item.picUrl || '/music/assets/logo.svg'}"
                     onerror="this.src='/music/assets/logo.svg'"
                     class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
                <div class="lib-batch-check absolute inset-0 bg-black/40 hidden items-center justify-center rounded-xl">
                    <i class="fas fa-check-circle text-white text-3xl"></i>
                </div>
                <div class="absolute top-1.5 right-1.5 flex gap-1.5">
                    <button type="button" class="lib-album-download-btn w-8 h-8 rounded-full bg-black/45 hover:bg-emerald-500 text-white flex items-center justify-center opacity-100 sm:opacity-0 group-hover:opacity-100 transition-all shadow-sm disabled:opacity-60 disabled:cursor-wait" title="下载本专辑全部歌曲">
                        <i class="fas fa-download text-xs"></i>
                    </button>
                    <button type="button" class="lib-fav-btn w-8 h-8 rounded-full bg-red-400/80 hover:bg-red-500 text-white flex items-center justify-center opacity-100 sm:opacity-0 group-hover:opacity-100 transition-all shadow-sm" title="取消收藏"
                            onclick="event.stopPropagation(); removeLibraryAlbum('${item.id}', '${item.source}')">
                        <i class="fas fa-times text-xs"></i>
                    </button>
                </div>
            </div>
            <span class="text-sm font-bold t-text-main line-clamp-2 h-10 leading-5 mb-1" title="${item.name}">${item.name}</span>
            <div class="flex items-center justify-between mt-1">
                <span class="text-[10px] t-text-muted truncate flex-1">
                    ${item.artistName || '未知歌手'}
                    ${item.list && item.list.length ? `<span class="ml-1 text-emerald-500 font-bold">(${item.list.length} 首)</span>` : ''}
                </span>
                <span class="text-[10px] t-text-muted ml-2">${getSourceTag ? getSourceTag(item.source) : ''}</span>
            </div>`;
        const downloadButton = div.querySelector('.lib-album-download-btn');
        downloadButton?.addEventListener('click', async event => {
            event.stopPropagation();
            await downloadArtistAlbumSongs(item, downloadButton);
        });
        grid.appendChild(div);
    });
}
window.renderLibraryAlbums = renderLibraryAlbums;

/** 点击侧边栏"收藏歌手"，切换到展示视图 */
function handleArtistLibraryClick() {
    exitListSecondaryModes && exitListSecondaryModes();
    document.querySelectorAll('[id^="view-"]').forEach(el => el.classList.add('hidden'));
    const activeView = document.getElementById('view-search');
    activeView.classList.remove('hidden');
    setTimeout(() => activeView.classList.remove('opacity-0'), 10);

    document.querySelectorAll('[id^="tab-"]').forEach(el => {
        el.classList.remove('active-tab', 'text-emerald-600');
        el.classList.add('t-text-muted');
    });
    const favTab = document.getElementById('tab-favorites');
    if (favTab) { favTab.classList.add('active-tab'); favTab.classList.remove('t-text-muted'); }

    document.querySelectorAll('[data-sidebar-list-id]').forEach(el => { el.classList.remove('active-sub-item'); el.classList.add('t-text-muted'); });
    const subItem = document.querySelector('[data-sidebar-list-id="__lib_artists__"]');
    if (subItem) { subItem.classList.add('active-sub-item'); subItem.classList.remove('t-text-muted'); }

    document.getElementById('page-title').innerText = '收藏歌手';
    document.getElementById('search-input').value = '';
    document.getElementById('search-input').placeholder = '搜索收藏歌手...';
    document.getElementById('search-source').classList.add('hidden');
    document.getElementById('search-type').classList.add('hidden');

    currentSearchScope = 'lib_artists';
    window.currentViewingListId = '__lib_artists__';
    renderLibraryArtists(window.libraryData.artists);
}
window.handleArtistLibraryClick = handleArtistLibraryClick;

/** 点击侧边栏"收藏专辑"，切换到展示视图 */
function handleAlbumLibraryClick() {
    exitListSecondaryModes && exitListSecondaryModes();
    document.querySelectorAll('[id^="view-"]').forEach(el => el.classList.add('hidden'));
    const activeView = document.getElementById('view-search');
    activeView.classList.remove('hidden');
    setTimeout(() => activeView.classList.remove('opacity-0'), 10);

    document.querySelectorAll('[id^="tab-"]').forEach(el => {
        el.classList.remove('active-tab', 'text-emerald-600');
        el.classList.add('t-text-muted');
    });
    const favTab = document.getElementById('tab-favorites');
    if (favTab) { favTab.classList.add('active-tab'); favTab.classList.remove('t-text-muted'); }

    document.querySelectorAll('[data-sidebar-list-id]').forEach(el => { el.classList.remove('active-sub-item'); el.classList.add('t-text-muted'); });
    const subItem = document.querySelector('[data-sidebar-list-id="__lib_albums__"]');
    if (subItem) { subItem.classList.add('active-sub-item'); subItem.classList.remove('t-text-muted'); }

    document.getElementById('page-title').innerText = '收藏专辑';
    document.getElementById('search-input').value = '';
    document.getElementById('search-input').placeholder = '搜索收藏专辑...';
    document.getElementById('search-source').classList.add('hidden');
    document.getElementById('search-type').classList.add('hidden');

    currentSearchScope = 'lib_albums';
    window.currentViewingListId = '__lib_albums__';
    renderLibraryAlbums(window.libraryData.albums);
}
window.handleAlbumLibraryClick = handleAlbumLibraryClick;

// ---- 批量操作：歌手 ----

function enterLibraryArtistBatch() {
    window.libraryBatchMode = 'artist';
    window.libraryBatchSelected.clear();
    const bar = document.getElementById('lib-artist-batch-bar');
    if (bar) bar.classList.remove('hidden');
    updateLibArtistBatchCount();
}
function exitLibraryArtistBatch() {
    window.libraryBatchMode = false;
    window.libraryBatchSelected.clear();
    const bar = document.getElementById('lib-artist-batch-bar');
    if (bar) bar.classList.add('hidden');
    // 取消所有选中视觉效果
    document.querySelectorAll('#lib-artist-grid .lib-batch-check').forEach(el => el.classList.remove('flex'));
    document.querySelectorAll('#lib-artist-grid .lib-batch-check').forEach(el => el.classList.add('hidden'));
}
function toggleLibArtistBatchSelect(id) {
    if (window.libraryBatchSelected.has(String(id))) {
        window.libraryBatchSelected.delete(String(id));
    } else {
        window.libraryBatchSelected.add(String(id));
    }
    // 更新视觉状态
    document.querySelectorAll('#lib-artist-grid [data-lib-artist-id]').forEach(card => {
        const check = card.querySelector('.lib-batch-check');
        if (!check) return;
        if (window.libraryBatchSelected.has(card.dataset.libArtistId)) {
            check.classList.remove('hidden'); check.classList.add('flex');
        } else {
            check.classList.add('hidden'); check.classList.remove('flex');
        }
    });
    updateLibArtistBatchCount();
}
function libSelectAllArtists() {
    window.libraryData.artists.forEach(a => window.libraryBatchSelected.add(String(a.id)));
    document.querySelectorAll('#lib-artist-grid .lib-batch-check').forEach(el => { el.classList.remove('hidden'); el.classList.add('flex'); });
    updateLibArtistBatchCount();
}
function libDeselectAllArtists() {
    window.libraryBatchSelected.clear();
    document.querySelectorAll('#lib-artist-grid .lib-batch-check').forEach(el => { el.classList.add('hidden'); el.classList.remove('flex'); });
    updateLibArtistBatchCount();
}
function updateLibArtistBatchCount() {
    const el = document.getElementById('lib-artist-sel-count');
    if (el) el.textContent = window.libraryBatchSelected.size;
}
async function libDeleteSelectedArtists() {
    if (window.libraryBatchSelected.size === 0) { showInfo('请先选择要删除的歌手'); return; }
    if (window.isViewingPublicFavorites || !isUserLoggedIn()) {
        if (!(await requireAdminForOpenWrite('删除公开收藏歌手'))) return;
    }
    const confirmed = await showSelect('删除收藏歌手', `确定删除选中的 ${window.libraryBatchSelected.size} 位歌手吗？`, { danger: true });
    if (!confirmed) return;
    window.libraryData.artists = window.libraryData.artists.filter(a => !window.libraryBatchSelected.has(String(a.id)));
    await saveLibraryArtists();
    exitLibraryArtistBatch();
    renderLibraryArtists(window.libraryData.artists);
    showSuccess('已删除所选歌手');
}
async function removeLibraryArtist(id, source) {
    if (window.isViewingPublicFavorites || !isUserLoggedIn()) {
        if (!(await requireAdminForOpenWrite('删除公开收藏歌手'))) return;
    }
    window.libraryData.artists = window.libraryData.artists.filter(a => !(String(a.id) === String(id) && a.source === source));
    await saveLibraryArtists();
    renderLibraryArtists(window.libraryData.artists);
    showInfo('已取消收藏');
}
window.enterLibraryArtistBatch = enterLibraryArtistBatch;
window.exitLibraryArtistBatch = exitLibraryArtistBatch;
window.libSelectAllArtists = libSelectAllArtists;
window.libDeselectAllArtists = libDeselectAllArtists;
window.libDeleteSelectedArtists = libDeleteSelectedArtists;
window.removeLibraryArtist = removeLibraryArtist;

// ---- 批量操作：专辑 ----

function enterLibraryAlbumBatch() {
    window.libraryBatchMode = 'album';
    window.libraryBatchSelected.clear();
    const bar = document.getElementById('lib-album-batch-bar');
    if (bar) bar.classList.remove('hidden');
    updateLibAlbumBatchCount();
}
function exitLibraryAlbumBatch() {
    window.libraryBatchMode = false;
    window.libraryBatchSelected.clear();
    const bar = document.getElementById('lib-album-batch-bar');
    if (bar) bar.classList.add('hidden');
    document.querySelectorAll('#lib-album-grid .lib-batch-check').forEach(el => { el.classList.add('hidden'); el.classList.remove('flex'); });
}
function toggleLibAlbumBatchSelect(id) {
    if (window.libraryBatchSelected.has(String(id))) {
        window.libraryBatchSelected.delete(String(id));
    } else {
        window.libraryBatchSelected.add(String(id));
    }
    document.querySelectorAll('#lib-album-grid [data-lib-album-id]').forEach(card => {
        const check = card.querySelector('.lib-batch-check');
        if (!check) return;
        if (window.libraryBatchSelected.has(card.dataset.libAlbumId)) {
            check.classList.remove('hidden'); check.classList.add('flex');
        } else {
            check.classList.add('hidden'); check.classList.remove('flex');
        }
    });
    updateLibAlbumBatchCount();
}
function libSelectAllAlbums() {
    window.libraryData.albums.forEach(a => window.libraryBatchSelected.add(String(a.id)));
    document.querySelectorAll('#lib-album-grid .lib-batch-check').forEach(el => { el.classList.remove('hidden'); el.classList.add('flex'); });
    updateLibAlbumBatchCount();
}
function libDeselectAllAlbums() {
    window.libraryBatchSelected.clear();
    document.querySelectorAll('#lib-album-grid .lib-batch-check').forEach(el => { el.classList.add('hidden'); el.classList.remove('flex'); });
    updateLibAlbumBatchCount();
}
function updateLibAlbumBatchCount() {
    const el = document.getElementById('lib-album-sel-count');
    if (el) el.textContent = window.libraryBatchSelected.size;
}
async function libDeleteSelectedAlbums() {
    if (window.libraryBatchSelected.size === 0) { showInfo('请先选择要删除的专辑'); return; }
    if (window.isViewingPublicFavorites || !isUserLoggedIn()) {
        if (!(await requireAdminForOpenWrite('删除公开收藏专辑'))) return;
    }
    const confirmed = await showSelect('删除收藏专辑', `确定删除选中的 ${window.libraryBatchSelected.size} 张专辑吗？`, { danger: true });
    if (!confirmed) return;
    window.libraryData.albums = window.libraryData.albums.filter(a => !window.libraryBatchSelected.has(String(a.id)));
    await saveLibraryAlbums();
    exitLibraryAlbumBatch();
    renderLibraryAlbums(window.libraryData.albums);
    showSuccess('已删除所选专辑');
}
async function removeLibraryAlbum(id, source) {
    if (window.isViewingPublicFavorites || !isUserLoggedIn()) {
        if (!(await requireAdminForOpenWrite('删除公开收藏专辑'))) return;
    }
    window.libraryData.albums = window.libraryData.albums.filter(a => !(String(a.id) === String(id) && a.source === source));
    await saveLibraryAlbums();
    renderLibraryAlbums(window.libraryData.albums);
    showInfo('已取消收藏');
}

window.enterLibraryAlbumBatch = enterLibraryAlbumBatch;
window.exitLibraryAlbumBatch = exitLibraryAlbumBatch;
window.libSelectAllAlbums = libSelectAllAlbums;
window.libDeselectAllAlbums = libDeselectAllAlbums;
window.libDeleteSelectedAlbums = libDeleteSelectedAlbums;
window.removeLibraryAlbum = removeLibraryAlbum;


// Link SyncManager from user_sync.js
// Link SyncManager from user_sync.js
const syncManager = window.SyncManager;
let currentListData = null;
let syncModeResolve = null;

function switchSyncMode(mode) {
    const btnLocal = document.getElementById('btn-mode-local');
    const btnRemote = document.getElementById('btn-mode-remote');
    const formLocal = document.getElementById('sync-form-local');
    const formRemote = document.getElementById('sync-form-remote');

    if (mode === 'local') {
        btnLocal.className = "px-4 py-2 rounded-lg text-sm font-medium bg-emerald-100 text-emerald-700 ring-2 ring-emerald-500 transition-all";
        btnRemote.className = "px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 t-text-muted hover:bg-gray-200 transition-all";
        formLocal.classList.remove('hidden');
        formRemote.classList.add('hidden');
    } else {
        btnLocal.className = "px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 t-text-muted hover:bg-gray-200 transition-all";
        btnRemote.className = "px-4 py-2 rounded-lg text-sm font-medium bg-blue-100 text-blue-700 ring-2 ring-blue-500 transition-all";
        formLocal.classList.add('hidden');
        formRemote.classList.remove('hidden');
        // Reset Remote Flow
        handleRemoteBack();
    }
}

//同步设置
async function pushSettingsToServer(force = false) {
    if (!force && !settings.saveAccountSettingsToFile) return;
    // Only local sync mode supports this for now
    if (localStorage.getItem('lx_sync_mode') !== 'local' && !window.lx_config?.['user.enablePublicRestriction'] && !force) return;

    const user = localStorage.getItem('lx_sync_user');
    const isPublicMode = !user && window.lx_config?.['user.enablePublicRestriction'];
    if (!user && !isPublicMode && !force) return;

    try {
        const headers = { 'Content-Type': 'application/json' };
        if (isPublicMode) {
            // 公开受限用户：不需账号认证，但需要管理员密码
            headers['x-user-name'] = 'default';
            const adminPass = localStorage.getItem('lx_admin_password');
            if (adminPass) headers['x-frontend-auth'] = adminPass;
        } else {
            // 已登录用户：使用 Token（或兼容旧密码）
            Object.assign(headers, getUserAuthHeaders());
            const adminPass = localStorage.getItem('lx_admin_password');
            if (adminPass) headers['x-frontend-auth'] = adminPass;
        }

        const res = await fetch('/api/user/settings', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(settings)
        });
        if (res.ok) {
            console.log('[Settings] 已成功同步到服务器');
        }

        // 同时同步音质配置
        if (window.soundEffects && typeof window.soundEffects.pushToServer === 'function') {
            window.soundEffects.pushToServer();
        }
    } catch (e) {
        console.error('[Settings] 同步到服务器失败:', e);
        if (force) throw e;
    }
}

async function manualSaveSettings(btn) {
    const originalText = btn.innerHTML;
    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> 正在处理...';

        // 1. Sync to localStorage
        localStorage.setItem('lx_settings', JSON.stringify(settings));

        // 2. Force push to server (settings.json)
        await pushSettingsToServer(true);

        btn.innerHTML = '<i class="fas fa-check mr-2"></i> 保存成功 (已同步到服务器)';
        btn.classList.add('bg-emerald-50', 'dark:bg-emerald-500/10', 'text-emerald-600', 'dark:text-emerald-400', 'border-emerald-200');
        btn.classList.remove('bg-blue-50', 'dark:bg-blue-500/10', 'text-blue-600', 'dark:text-blue-400', 'border-blue-100');

        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.classList.remove('bg-emerald-50', 'dark:bg-emerald-500/10', 'text-emerald-600', 'dark:text-emerald-400', 'border-emerald-200');
            btn.classList.add('bg-blue-50', 'dark:bg-blue-500/10', 'text-blue-600', 'dark:text-blue-400', 'border-blue-100');
            btn.disabled = false;
        }, 2000);
        showSuccess('配置已成功保存并同步至服务器');
    } catch (e) {
        console.error('[Settings] 手动保存失败:', e);
        btn.innerHTML = '<i class="fas fa-times mr-2"></i> 保存失败';
        btn.classList.add('text-red-500', 'border-red-200');
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.classList.remove('text-red-500', 'border-red-200');
            btn.disabled = false;
        }, 2000);
        showError('同步失败，请检查网络或登录状态');
    }
}

async function fetchSettingsFromServer() {
    if (!settings.saveAccountSettingsToFile) return;

    const user = localStorage.getItem('lx_sync_user');
    const isPublicMode = !user && window.lx_config?.['user.enablePublicRestriction'];
    if (!user && !isPublicMode) return;

    try {
        console.log('[Settings] 正在从服务器尝试加载设置...');
        const headers = {};
        if (isPublicMode) {
            headers['x-user-name'] = 'default';
            const adminPass = localStorage.getItem('lx_admin_password');
            if (adminPass) headers['x-frontend-auth'] = adminPass;
        } else {
            Object.assign(headers, getUserAuthHeaders());
            const adminPass = localStorage.getItem('lx_admin_password');
            if (adminPass) headers['x-frontend-auth'] = adminPass;
        }

        const res = await fetch('/api/user/settings', {
            headers: headers
        });

        if (res.ok) {
            const serverSettings = await res.json();
            console.log('[Settings] 从服务器加载设置成功:', serverSettings);
            // Merge settings
            settings = normalizeStoredSettings({ ...settings, ...serverSettings });
            // Save to local
            localStorage.setItem('lx_settings', JSON.stringify(settings));
            // Update UI
            syncSettingsUI();
            setupNetworkListAutoCheck();
            if (typeof showSuccess === 'function') {
                showSuccess('已从服务器恢复设置');
            }

            // 同时加载音效设置
            if (window.soundEffects && typeof window.soundEffects.fetchFromServer === 'function') {
                window.soundEffects.fetchFromServer();
            }
        } else {
            console.log('[Settings] 服务器无设置文件或加载失败');
        }
    } catch (e) {
        console.error('[Settings] 从服务器加载设置失败:', e);
    }
}


function updateSyncStatus(html, showLogout = true) {
    const statusEl = document.getElementById('sync-status');
    const settingsOption = document.getElementById('sync-settings-file-option');
    if (!statusEl) return;

    let fullHtml = html;
    // Show logout button if requested AND we have active data or connection
    const hasActiveLogin = currentListData || (syncManager && syncManager.client && syncManager.client.isConnected);
    if (showLogout && hasActiveLogin) {
        fullHtml += ` <button onclick="handleSyncLogout()" class="ml-2 text-red-500 hover:text-red-600 text-[10px] md:text-xs font-bold px-2 py-0.5 rounded border border-red-200 hover:bg-red-300/10 transition-all inline-flex items-center gap-1" title="退出登录"><i class="fas fa-sign-out-alt"></i><span class="hidden sm:inline">退出登录</span></button>`;

        // Add "Sync from Remote" button if in LOCAL mode
        if (localStorage.getItem('lx_sync_mode') === 'local') {
            const username = localStorage.getItem('lx_sync_user') || '该用户';
            fullHtml += ` <button onclick="showRemoteOverwriteModal('${username}')" class="ml-2 text-emerald-500 hover:text-emerald-600 text-[10px] md:text-xs font-bold px-2 py-0.5 rounded border border-emerald-200 hover:bg-emerald-300/10 transition-all inline-flex items-center gap-1" title="连接远程服务器"><i class="fas fa-satellite-dish"></i><span class="hidden sm:inline">连接远程服务器</span></button>`;
        }
    }
    statusEl.innerHTML = fullHtml;
    // [新增] 状态变化后刷新登录界面禁用状态
    if (typeof updateAdminUI === 'function') updateAdminUI();
}

async function handleSyncLogout(skipConfirm = false) {
    if (!skipConfirm) {
        const confirmed = typeof showSelect === 'function'
            ? await showSelect('退出同步账号', '确定要退出当前账号并清除同步凭证？', { danger: true })
            : confirm('确定要退出当前账号并清除同步凭证？');
        if (!confirmed) return;
    }

    try {
        // 1. 服务端注销 Token
        if (userToken) {
            try {
                await fetch('/api/user/logout', {
                    method: 'POST',
                    headers: { 'x-user-token': userToken }
                });
            } catch (e) { console.warn('[Auth] Token 注销失败:', e); }
            userToken = null;
        }

        // 2. 关闭 WebSocket 同步连接
        if (syncManager && syncManager.client && typeof syncManager.client.close === 'function') {
            syncManager.client.close();
        }

        // 3. 停止音频播放及歌词，清空内存播放状态
        if (typeof audio !== 'undefined' && audio) {
            try {
                shouldAutoRecoverPlayback = false;
                audio.pause();
                audio.currentTime = 0;
                audio.src = '';
            } catch (e) { }
        }
        if (typeof lyricPlayer !== 'undefined' && lyricPlayer && typeof lyricPlayer.stop === 'function') {
            try { lyricPlayer.stop(); } catch (e) { }
        }

        window.currentSong = null;
        if (typeof currentSong !== 'undefined') currentSong = null;
        window.playlist = [];
        if (typeof playlist !== 'undefined') playlist = [];
        if (typeof playHistory !== 'undefined') playHistory = [];

        // 4. 重置内存歌单数据
        currentListData = null;
        window.currentListData = null;
        window.myPersonalListData = null;
        window.publicListData = null;
        window.isViewingPublicFavorites = false;

        // 5. 清理 IndexedDB 数据
        if (window.ListStore && typeof window.ListStore.remove === 'function') {
            await window.ListStore.remove().catch(e => console.warn('[IDBStore] 清除失败:', e));
        }

        // 6. 清理 CacheStorage 物理缓存 (如 Service Worker / Audio Cache)
        if ('caches' in window) {
            try {
                const keys = await caches.keys();
                await Promise.all(keys.map(key => caches.delete(key)));
            } catch (e) {
                console.warn('[Cache] 物理缓存删除失败:', e);
            }
        }

        // 7. 彻底清空 localStorage & sessionStorage
        const agreementAccepted = localStorage.getItem('lx_agreement_accepted');
        localStorage.clear();
        sessionStorage.clear();
        if (agreementAccepted) {
            localStorage.setItem('lx_agreement_accepted', agreementAccepted);
        }

        // Clear forms if they exist in DOM
        const localUser = document.getElementById('sync-local-user');
        const localPass = document.getElementById('sync-local-pass');
        const remoteUrl = document.getElementById('sync-remote-url');
        const remoteCode = document.getElementById('sync-remote-code');
        if (localUser) localUser.value = '';
        if (localPass) localPass.value = '';
        if (remoteUrl) remoteUrl.value = '';
        if (remoteCode) remoteCode.value = '';

        if (typeof showSuccess === 'function') {
            showSuccess('已安全退出登录并清除所有缓存，正在刷新页面...');
        }

        // 8. 自动刷新网页
        setTimeout(() => {
            window.location.reload();
        }, 300);

    } catch (err) {
        console.error('[Logout] 清除缓存或退出过程出错:', err);
        window.location.reload();
    }
}

async function handleLocalLogin() {
    const user = document.getElementById('sync-local-user').value;
    const pass = document.getElementById('sync-local-pass').value;
    const statusEl = document.getElementById('sync-status');

    if (!user || !pass) {
        showError('请输入用户名和密码');
        return;
    }

    statusEl.innerHTML = '<i class="fas fa-spinner fa-spin text-emerald-500"></i> 正在登录...';

    try {
        syncManager.initLocal(user, pass);
        const success = await syncManager.client.login();

        if (success) {
            statusEl.innerHTML = '<i class="fas fa-check-circle text-emerald-500"></i> 登录成功，正在同步...';

            // [核心优化] 如果已有有效 Token，则不用再请求 /api/user/login 获取新 Token
            if (userToken) {
                console.log('[Auth] 检测到现有的 User Token，跳过登录接口直接尝试数据同步。');
            } else {
                try {
                    const tokenRes = await fetch('/api/user/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username: user, password: pass })
                    });
                    if (tokenRes.ok) {
                        const tokenData = await tokenRes.json();
                        if (tokenData.token) {
                            userToken = tokenData.token;
                            localStorage.setItem('lx_user_token', userToken);
                            console.log('[Auth] 新用户 Token 已获取并保存');
                        }
                    }
                } catch (e) {
                    console.warn('[Auth] Token 获取失败，回退到旧式认证方式:', e);
                }
            }

            // [新增] 显示并加载 Token 管理面板
            const tokenSection = document.getElementById('token-management-section');
            if (tokenSection) {
                tokenSection.classList.remove('hidden');
                loadTokenConfig();
            }

            // Fetch List
            const listData = await syncManager.sync();
            currentListData = listData;
            if (currentListData) currentListData.username = user; // Attach username
            window.myPersonalListData = currentListData; // [个人数据缓存]
            renderMyLists(listData);

            // [Library] 登录后加载收藏歌手/专辑
            loadLibraryData();

            // [Cache] Save list data immediately for offline availability / quick load
            await window.ListStore.set(listData).catch(e => console.error('[IDBStore] 保存失败:', e));

            updateSyncStatus(`<i class="fas fa-check-circle text-emerald-500"></i> 已同步 (用户: ${user})`);
            // Save credentials to localStorage (Simple version)
            localStorage.setItem('lx_sync_mode', 'local'); // [Fix] Save mode
            localStorage.setItem('lx_sync_user', user);
            localStorage.setItem('lx_sync_pass', pass);

            // [新增] 成功登录后立即更新顶部栏 UI
            if (typeof updateUserUI === 'function') updateUserUI();

            // [New] Fetch settings from server if enabled
            if (settings.saveAccountSettingsToFile) {
                fetchSettingsFromServer();
            }

            // [新增] 客户端模式：登录本地服务器后自动触发远程同步
            if (settings.enableClientModeSync && settings.remoteSyncUrl && settings.remoteSyncCode) {
                console.info('[Sync] Client mode auto-triggering remote sync after local login...');
                setTimeout(() => {
                    handleRemoteOverwriteConnect(true);
                }, 1000);
            }
        } else {
            statusEl.innerHTML = '<i class="fas fa-times-circle text-red-500"></i> 登录失败: 用户名或密码错误';
        }
    } catch (e) {
        statusEl.innerHTML = `<i class="fas fa-exclamation-circle text-red-500"></i> 错误: ${e.message}`;
    }
}

function showSyncModeModal() {
    const modal = document.getElementById('sync-auth-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('sync-connect-form').classList.add('hidden');
    document.getElementById('sync-mode-selection').classList.remove('hidden');
}
window.showSyncModeModal = showSyncModeModal;


function closeSyncModal() {
    const modal = document.getElementById('sync-auth-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    // Reset views
    document.getElementById('sync-connect-form').classList.remove('hidden');
    document.getElementById('sync-mode-selection').classList.add('hidden');

    if (syncModeResolve) {
        syncModeResolve('cancel');
        syncModeResolve = null;
    }
}

function selectSyncMode(mode) {
    const fullOverwrite = document.getElementById('sync-full-overwrite').checked;
    if (fullOverwrite && mode.startsWith('overwrite')) {
        mode += '_full';
    }

    const translatedMode = mode;

    if (syncModeResolve) {
        syncModeResolve(translatedMode);
        syncModeResolve = null;
    }
    closeSyncModal();
}

function cancelSyncMode() {
    if (syncModeResolve) {
        syncModeResolve('cancel');
        syncModeResolve = null;
    }
    closeSyncModal();
}

function handleRemoteStep1() {
    const url = document.getElementById('sync-remote-url').value.trim();
    if (!url) {
        showError('请输入链接地址');
        return;
    }
    // Basic validation
    if (!url.match(/^(ws|http)s?:\/\//)) {
        showError('链接格式错误，应以 http://, https://, ws:// 或 wss:// 开头');
        return;
    }

    document.getElementById('sync-remote-step1').classList.add('hidden');
    document.getElementById('sync-remote-step2').classList.remove('hidden');
}

function handleRemoteBack() {
    document.getElementById('sync-remote-step1').classList.remove('hidden');
    document.getElementById('sync-remote-step2').classList.add('hidden');
    document.getElementById('sync-remote-code').value = ''; // Optional clear
}

function handleRemoteConnect() {
    const url = document.getElementById('sync-remote-url').value;
    const code = document.getElementById('sync-remote-code').value;
    const statusEl = document.getElementById('sync-status');

    if (!code) {
        showError('请输入连接码');
        return;
    }

    statusEl.innerHTML = '<i class="fas fa-spinner fa-spin text-blue-500"></i> 正在连接远程服务器...';

    try {
        let authInfo = null;
        if (localStorage.getItem('lx_sync_url') === url && localStorage.getItem('lx_sync_code') === code) {
            try {
                const savedStr = localStorage.getItem('lx_ws_auth');
                if (savedStr) authInfo = JSON.parse(savedStr);
            } catch (e) { }
        }

        syncManager.initRemote(url, code, {
            getData: async () => {
                // Try to load from cache first
                const cachedData = await window.ListStore.get().catch(() => null);
                if (cachedData) {
                    console.log('[Cache] 从缓存加载列表数据');
                    return cachedData;
                }
                return currentListData || { defaultList: [], loveList: [], userList: [] };
            },
            setData: async (data) => {
                console.log('[Sync] 远程数据已同步:', data);
                // Save to cache
                await window.ListStore.set(data).catch(e => console.error('[IDBStore] 保存失败:', e));
                // Update global
                const oldUsername = currentListData ? currentListData.username : null;
                currentListData = data;
                if (oldUsername) currentListData.username = oldUsername; // Preserve username

                // Render UI
                renderMyLists(data);
                updateSyncStatus('<i class="fas fa-check-circle text-blue-500"></i> 数据已同步');
            },
            getSyncMode: async () => {
                return new Promise((resolve) => {
                    syncModeResolve = resolve;
                    showSyncModeModal();
                });
            }
        }, authInfo);

        // Setup Callbacks
        syncManager.client.onLogin = async (success, msg) => {
            if (success) {
                updateSyncStatus('<i class="fas fa-check-circle text-green-500"></i> 已连接 (等待同步...)');
                // Remove manual sync() call. Let the server drive the sync via RPC.

                // Save connection info and authInfo to localStorage
                localStorage.setItem('lx_sync_mode', 'remote');
                localStorage.setItem('lx_sync_url', url);
                localStorage.setItem('lx_sync_code', code);

                // Save authInfo for reconnection
                if (syncManager.client.authInfo) {
                    localStorage.setItem('lx_ws_auth', JSON.stringify(syncManager.client.authInfo));
                    console.log('[Cache] WS认证信息已保存');
                }
            } else {
                statusEl.innerHTML = `<i class="fas fa-times-circle text-red-500"></i> 连接失败: ${msg || '未知错误'}`;
            }
        };

        syncManager.client.connect();

    } catch (e) {
        statusEl.innerHTML = `<i class="fas fa-exclamation-circle text-red-500"></i> 错误: ${e.message}`;
    }
}

// --- Remote Overwrite Modal Logic ---

let currentRemoteOverwriteClient = null;

function switchRemoteModalStep(stepId) {
    const steps = ['remote-overwrite-step1', 'remote-overwrite-mode-selection', 'remote-overwrite-step2', 'remote-overwrite-result'];
    steps.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (id === stepId) el.classList.remove('hidden');
            else el.classList.add('hidden');
        }
    });
}

function showRemoteOverwriteModal(username) {
    const modal = document.getElementById('modal-remote-overwrite');
    const content = document.getElementById('modal-remote-overwrite-content');
    if (!modal) return;

    // Reset state and cleanup previous client if any
    if (currentRemoteOverwriteClient) {
        currentRemoteOverwriteClient.close();
        currentRemoteOverwriteClient = null;
    }

    switchRemoteModalStep('remote-overwrite-step1');
    document.getElementById('remote-overwrite-status').innerHTML = '';
    remoteSyncModeResolve = null;
    lastSelectedRemoteSyncMode = null;

    // Pre-fill from settings
    const urlInput = document.getElementById('remote-overwrite-url');
    const codeInput = document.getElementById('remote-overwrite-code');
    if (urlInput && settings.remoteSyncUrl) urlInput.value = settings.remoteSyncUrl;
    else if (urlInput) {
        const savedUrl = localStorage.getItem('lx_sync_url');
        if (savedUrl) urlInput.value = savedUrl;
    }
    if (codeInput && settings.remoteSyncCode) codeInput.value = settings.remoteSyncCode;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
    }, 10);
}

function closeRemoteOverwriteModal(refresh = false) {
    const modal = document.getElementById('modal-remote-overwrite');
    const content = document.getElementById('modal-remote-overwrite-content');
    if (!modal) return;

    if (currentRemoteOverwriteClient) {
        currentRemoteOverwriteClient.close();
        currentRemoteOverwriteClient = null;
    }

    content.classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 300);
}

let remoteSyncModeResolve = null;
let lastSelectedRemoteSyncMode = null;

function selectRemoteOverwriteMode(mode) {
    if (remoteSyncModeResolve) {
        lastSelectedRemoteSyncMode = mode;
        // 保存上次选择的同步模式到设置中，以便客户端模式自动使用
        if (settings.lastRemoteSyncMode !== mode) {
            updateSetting('lastRemoteSyncMode', mode);
        }
        remoteSyncModeResolve(mode);
        remoteSyncModeResolve = null;
    }
}

async function handleRemoteOverwriteConnect(silent = false) {
    let url = settings.remoteSyncUrl || '';
    let code = settings.remoteSyncCode || '';

    // If not silent or inputs are accessible, try to get from DOM
    const urlInput = document.getElementById('remote-overwrite-url');
    const codeInput = document.getElementById('remote-overwrite-code');
    if (urlInput && urlInput.value.trim()) url = urlInput.value.trim();
    if (codeInput && codeInput.value.trim()) code = codeInput.value.trim();

    const statusEl = document.getElementById('remote-overwrite-status');

    if (!url || !code) {
        if (!silent && statusEl) statusEl.innerText = '请输入完整的连接信息';
        return;
    }

    if (!silent && statusEl) {
        statusEl.innerHTML = '<i class="fas fa-spinner fa-spin text-emerald-500"></i> 正在建立安全连接...';
    }

    if (currentRemoteOverwriteClient) currentRemoteOverwriteClient.close();
    currentRemoteOverwriteClient = new RemoteClient(url, code);
    const tempRemoteClient = currentRemoteOverwriteClient;

    tempRemoteClient.listHandlers = {
        getData: async () => {
            return currentListData || { defaultList: [], loveList: [], userList: [] };
        },
        setData: async (data) => {
            console.log('[RemoteOverwrite] 收到远程数据，准备覆盖本地...');
            try {
                // 1. Update UI and global memory (Preserve username)
                const oldUsername = currentListData ? currentListData.username : localStorage.getItem('lx_sync_user');
                currentListData = data;
                if (oldUsername) currentListData.username = oldUsername;

                await window.ListStore.set(data).catch(e => console.error('[IDBStore] 保存失败:', e));
                renderMyLists(data);

                // 2. Push to local server (important!)
                if (syncManager && syncManager.mode === 'local') {
                    await syncManager.push(data);
                    console.log('[RemoteOverwrite] 已推送到本地服务器');
                }
            } catch (err) {
                console.error('[RemoteOverwrite] 覆盖应用失败:', err);
            }
        },
        getSyncMode: async () => {
            console.log('[RemoteOverwrite] Server requested sync mode');
            // 如果开启了客户端模式且有上次选择的模式，则自动选择
            if (settings.enableClientModeSync && settings.lastRemoteSyncMode) {
                console.log('[RemoteOverwrite] Client mode: auto-selecting mode:', settings.lastRemoteSyncMode);
                lastSelectedRemoteSyncMode = settings.lastRemoteSyncMode;
                return settings.lastRemoteSyncMode;
            }

            return new Promise((resolve) => {
                remoteSyncModeResolve = resolve;
                // If silent and no mode saved, we might have to show the modal anyway
                switchRemoteModalStep('remote-overwrite-mode-selection');
                if (silent) {
                    // Force show modal if it's hidden during silent sync but needs interaction
                    const modal = document.getElementById('modal-remote-overwrite');
                    if (modal && modal.classList.contains('hidden')) {
                        showRemoteOverwriteModal();
                    }
                }
            });
        }
    };

    tempRemoteClient.onLogin = (success, msg) => {
        if (success) {
            // Save address and code to settings and sync to server
            settings.remoteSyncUrl = url;
            settings.remoteSyncCode = code;
            localStorage.setItem('lx_settings', JSON.stringify(settings));
            if (settings.saveAccountSettingsToFile) {
                pushSettingsToServer();
            }
            if (!silent && statusEl) {
                statusEl.innerHTML = '<i class="fas fa-check-circle text-emerald-500"></i> 已连通，等待同步指令...';
            }
        } else {
            if (!silent && statusEl) {
                statusEl.classList.remove('t-text-muted');
                statusEl.classList.add('text-red-500');
                statusEl.innerText = '连接失败: ' + (msg || '未知错误');
            } else if (silent) {
                console.warn('[Sync] Silent connect failed:', msg);
            }
        }
    };

    tempRemoteClient.onSync = (status) => {
        if (status === 'finished') {
            if (!silent) {
                switchRemoteModalStep('remote-overwrite-result');
            } else {
                console.info('[Sync] Silent sync finished.');
                if (window.showInfo) showInfo('远程同步成功');
            }
            tempRemoteClient.close();
            currentRemoteOverwriteClient = null;

            // Updated result text logic below...
            const titleEl = document.getElementById('remote-overwrite-result-title');
            const textEl = document.getElementById('remote-overwrite-result-text');
            const username = localStorage.getItem('lx_sync_user') || '该用户';

            if (lastSelectedRemoteSyncMode === 'overwrite_local_remote_full') {
                if (titleEl) titleEl.innerText = '推送同步成功！';
                if (textEl) textEl.innerText = '当前本地账户歌单已成功覆盖至远程服务器。';
            } else if (lastSelectedRemoteSyncMode === 'merge_local_remote') {
                if (titleEl) titleEl.innerText = '合并同步成功！';
                if (textEl) textEl.innerText = '当前本地账户歌单已成功合并至远程服务器。';
            } else if (lastSelectedRemoteSyncMode === 'overwrite_remote_local_full') {
                if (titleEl) titleEl.innerText = '拉取覆盖成功！';
                if (textEl) textEl.innerText = '远程服务器歌单已成功覆盖至当前本地账户。';
            } else if (lastSelectedRemoteSyncMode === 'merge_remote_local') {
                if (titleEl) titleEl.innerText = '拉取合并成功！';
                if (textEl) textEl.innerText = '远程服务器歌单已成功合并至当前本地账户。';
            } else {
                if (titleEl) titleEl.innerText = '连接成功';
                if (textEl) textEl.innerText = '远程服务器已连接，当前数据内容与本地完全一致。';
            }

            // Update the status on the main settings page too
            updateSyncStatus(`<i class="fas fa-check-circle text-emerald-500"></i> 远程同步任务已完成 (${username})`);
        } else if (status === 'started' || status === 'syncing') {
            if (!silent) {
                switchRemoteModalStep('remote-overwrite-step2');
            }
        }
    };

    try {
        await tempRemoteClient.connect();
    } catch (err) {
        if (!silent && statusEl) statusEl.innerText = '初始化失败: ' + err.message;
        else console.error('[Sync] Silent connect failed:', err);
    }
}

async function handleRemoveList(listId, event) {
    event.stopPropagation();
    if (!(await showSelect('删除歌单', '确定要删除歌单吗？', { danger: true }))) return;

    // 公开歌单需要管理员权限
    if (!(await requireAdminForOpenWrite('删除公开歌单'))) return;

    if (currentListData) {
        const index = currentListData.userList.findIndex(l => l.id === listId);
        if (index >= 0) {
            currentListData.userList.splice(index, 1);
            try {
                await pushDataChange();
                renderMyLists(currentListData);
            } catch (e) {
                showError('删除同步失败');
            }
        }
    }
}

function buildPlaylistExport(listId, exportedAt = new Date().toISOString()) {
    if (!currentListData) return null;

    let playlist;
    if (listId === 'default') {
        playlist = { id: 'default', name: '默认列表', source: 'lxserver', list: currentListData.defaultList || [] };
    } else if (listId === 'love') {
        playlist = { id: 'love', name: '我的收藏', source: 'lxserver', list: currentListData.loveList || [] };
    } else {
        playlist = currentListData.userList?.find(item => item.id === listId);
    }
    if (!playlist) return null;

    const safeName = String(playlist.name || '未命名歌单')
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
        .replace(/[. ]+$/g, '') || '未命名歌单';
    const payload = {
        type: 'lxserver-playlist',
        version: 1,
        exportedAt,
        playlist: { ...playlist, list: Array.isArray(playlist.list) ? playlist.list : [] }
    };
    return {
        fileName: `${safeName}.json`,
        json: JSON.stringify(payload, null, 2)
    };
}

function exportPlaylistToLocal(listId, event) {
    if (event) event.stopPropagation();
    const exported = buildPlaylistExport(listId);
    if (!exported) {
        showError('未找到要导出的歌单');
        return;
    }

    const url = URL.createObjectURL(new Blob([exported.json], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = exported.fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showSuccess(`歌单已导出: ${exported.fileName}`);
}

function getFavoriteSidebarOrder() {
    return Array.isArray(settings.favoriteSidebarOrder) ? settings.favoriteSidebarOrder : [];
}

function getOrderedFavoriteSidebarItems(items) {
    const order = getFavoriteSidebarOrder();
    if (!order.length) return items;

    const itemMap = new Map(items.map(item => [item.id, item]));
    const orderedItems = [];
    order.forEach(id => {
        const item = itemMap.get(id);
        if (!item) return;
        orderedItems.push(item);
        itemMap.delete(id);
    });
    return [...orderedItems, ...itemMap.values()];
}

function persistFavoriteSidebarOrder(ids) {
    settings.favoriteSidebarOrder = ids;
    window.settings = settings;
    try {
        localStorage.setItem('lx_settings', JSON.stringify(settings));
    } catch (e) {
        console.error('[Settings] 保存收藏侧边栏排序失败:', e);
    }
    if (settings.saveAccountSettingsToFile) {
        pushSettingsToServer();
    }
}

async function persistUserListOrderFromSidebar(ids) {
    if (!currentListData || !Array.isArray(currentListData.userList)) return;

    const currentUserIds = currentListData.userList.map(list => list.id);
    const userOrder = ids.filter(id => currentUserIds.includes(id));
    if (userOrder.length !== currentUserIds.length) return;
    if (userOrder.every((id, index) => id === currentUserIds[index])) return;

    const listMap = new Map(currentListData.userList.map(list => [list.id, list]));
    currentListData.userList = userOrder.map(id => listMap.get(id)).filter(Boolean);
    try {
        await pushDataChange();
    } catch (e) {
        console.error('[Playlist] 保存歌单排序失败:', e);
        showError('保存歌单排序失败，请稍后重试');
    }
}

function initFavoriteSidebarSortable(container) {
    if (typeof Sortable === 'undefined' || !container) return;

    try {
        const oldSortable = Sortable.get(container);
        if (oldSortable) oldSortable.destroy();
    } catch (e) {
        console.warn('[Playlist] 重置侧边栏排序失败:', e);
    }

    Sortable.create(container, {
        animation: 150,
        handle: '.favorite-sidebar-drag-handle',
        ghostClass: 'opacity-50',
        chosenClass: 'bg-emerald-50',
        onEnd: () => {
            const ids = Array.from(container.querySelectorAll('[data-sidebar-sort-id]'))
                .map(el => el.getAttribute('data-sidebar-sort-id'))
                .filter(Boolean);
            persistFavoriteSidebarOrder(ids);
            persistUserListOrderFromSidebar(ids);
        }
    });
}

function renderMyLists(data) {
    const container = document.getElementById('my-lists-container');
    container.innerHTML = '';

    if (!data) {
        container.innerHTML = '<div class="px-6 py-2 text-sm t-text-muted">请先在设置中登录</div>';
        refreshFavoritesChildrenHeight();
        return;
    }

    // Helper to create list item
    const createItem = (listObj, name, icon, count) => {
        const id = typeof listObj === 'string' ? listObj : listObj.id;
        const displayName = String(name || '未命名歌单');
        const div = document.createElement('div');
        div.className = "px-6 py-2 text-sm t-text-muted hover:t-bg-main cursor-pointer flex items-center group transition-colors overflow-hidden";
        div.setAttribute('data-sidebar-list-id', id);
        div.setAttribute('data-sidebar-sort-id', id);
        div.onclick = () => handleListClick(id);

        // Use createMarqueeHtml for list name
        const nameHtml = displayName.length > 8
            ? createMarqueeHtml(displayName, 'flex-1')
            : `<span class="ml-2 flex-1 truncate">${escapeHtmlText(displayName)}</span>`;

        // Buttons logic (for collected external playlists)
        const showExternalOps = listObj && listObj.sourceListId && listObj.source;
        let opsHtml = '';
        if (showExternalOps) {
            const updateBadge = window.networkListUpdateMap && window.networkListUpdateMap.has(id)
                ? `<span class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] font-bold mr-2" title="歌单有更新">!</span>`
                : '';
            opsHtml = `
                <i class="fas fa-sync-alt refresh-btn text-gray-400 hover:text-emerald-500 hidden group-hover:block flex-shrink-0 text-[10px] mr-2 transition-all active:rotate-180" 
                   title="更新歌单内容" 
                   onclick="event.stopPropagation(); handleRefreshList('${id}', event)"></i>
                <i class="fas fa-external-link-alt jump-btn text-gray-400 hover:text-emerald-500 hidden group-hover:block flex-shrink-0 text-[10px] mr-2 transition-all" 
                   title="打开原始歌单" 
                   onclick="event.stopPropagation(); handleJumpToOriginalList('${id}', event)"></i>
                ${updateBadge}
            `;
        }

        div.innerHTML = `
            <span class="favorite-sidebar-drag-handle cursor-grab t-text-muted/60 hover:text-emerald-500 mr-2 flex-shrink-0 touch-none" title="拖拽排序">
                <i class="fas fa-grip-vertical text-xs"></i>
            </span>
            ${opsHtml}
            <i class="fas ${icon} w-5 t-text-muted group-hover:text-emerald-500 transition-colors flex-shrink-0"></i>
            ${displayName.length > 8 ? `<div class="ml-2 flex-1 overflow-hidden">${nameHtml}</div>` : nameHtml}
            <span class="text-xs text-gray-300 group-hover:t-text-muted mr-2 flex-shrink-0">${count}</span>
            <button type="button" class="text-gray-300 hover:text-emerald-500 flex-shrink-0 mr-2 transition-colors" title="导出歌单到本地" aria-label="导出歌单到本地" onclick="exportPlaylistToLocal('${id}', event)"><i class="fas fa-download text-[10px]"></i></button>
            ${typeof listObj !== 'string' ? `<button type="button" class="text-gray-300 hover:text-emerald-500 flex-shrink-0 mr-2 transition-colors" title="重命名歌单" aria-label="重命名歌单" onclick="handleRenameList('${id}', event)"><i class="fas fa-pen text-[10px]"></i></button>` : ''}
            ${id !== 'default' && id !== 'love' ? `<i class="fas fa-trash text-gray-300 hover:text-red-500 hidden group-hover:block flex-shrink-0" onclick="handleRemoveList('${id}', event)"></i>` : ''}
        `;
        return div;
    };

    // ---- 常驻：收藏歌手 / 收藏专辑 ----
    const createLibItem = (id, name, icon, countId, clickFn) => {
        const div = document.createElement('div');
        div.className = "px-6 py-2 text-sm t-text-muted hover:t-bg-main cursor-pointer flex items-center group transition-colors overflow-hidden";
        div.setAttribute('data-sidebar-list-id', id);
        div.setAttribute('data-sidebar-sort-id', id);
        div.onclick = clickFn;
        div.innerHTML = `
            <span class="favorite-sidebar-drag-handle cursor-grab t-text-muted/60 hover:text-emerald-500 mr-2 flex-shrink-0 touch-none" title="拖拽排序">
                <i class="fas fa-grip-vertical text-xs"></i>
            </span>
            <i class="fas ${icon} w-5 t-text-muted group-hover:text-emerald-500 transition-colors flex-shrink-0"></i>
            <span class="ml-2 flex-1 truncate">${name}</span>
            <span id="${countId}" class="text-xs text-gray-300 group-hover:t-text-muted mr-2 flex-shrink-0">0</span>
        `;
        return div;
    };
    const sidebarItems = [];

    // [新增] 当开启了 enablePublicFavorites 且已登录账号时，在侧边栏第一行添加“公开收藏”
    const enablePublicFavorites = !!window.lx_config?.['user.enablePublicFavorites'];
    const isUserLoggedIn = typeof window.isUserLoggedIn === 'function' ? window.isUserLoggedIn() : false;

    if (enablePublicFavorites && isUserLoggedIn) {
        const isPublicActive = window.isViewingPublicFavorites === true;
        const publicFavItem = document.createElement('div');
        publicFavItem.className = `px-6 py-2 text-sm cursor-pointer flex items-center group transition-colors overflow-hidden ${isPublicActive ? 'text-emerald-500 font-bold bg-emerald-500/10' : 't-text-muted hover:t-bg-main'}`;
        publicFavItem.setAttribute('data-sidebar-list-id', '__public_favorites__');
        publicFavItem.setAttribute('data-sidebar-sort-id', '__public_favorites__');
        publicFavItem.onclick = () => handleTogglePublicFavorites();
        publicFavItem.innerHTML = `
            <span class="favorite-sidebar-drag-handle cursor-grab t-text-muted/60 hover:text-emerald-500 mr-2 flex-shrink-0 touch-none" title="拖拽排序">
                <i class="fas fa-grip-vertical text-xs"></i>
            </span>
            <i class="fas fa-globe w-5 ${isPublicActive ? 'text-emerald-500' : 't-text-muted group-hover:text-emerald-500'} transition-colors flex-shrink-0"></i>
            <span class="ml-2 flex-1 truncate">公开收藏</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded-full ${isPublicActive ? 'bg-emerald-500 text-white font-bold' : 'bg-gray-200 dark:bg-gray-700 text-gray-500'}">${isPublicActive ? '已开启' : '切换'}</span>
        `;
        sidebarItems.push({ id: '__public_favorites__', type: 'system', el: publicFavItem });
    }

    sidebarItems.push(
        { id: '__lib_artists__', type: 'lib', el: createLibItem('__lib_artists__', '收藏歌手', 'fa-user', 'lib-artist-count', handleArtistLibraryClick) },
        { id: '__lib_albums__', type: 'lib', el: createLibItem('__lib_albums__', '收藏专辑', 'fa-compact-disc', 'lib-album-count', handleAlbumLibraryClick) }
    );

    if (data.defaultList) {
        sidebarItems.push({ id: 'default', type: 'system', el: createItem('default', '默认列表', 'fa-list', data.defaultList.length) });
    }
    if (data.loveList) {
        sidebarItems.push({ id: 'love', type: 'system', el: createItem('love', '我的收藏', 'fa-heart', data.loveList.length) });
    }
    if (data.userList) {
        data.userList.forEach(l => {
            const listLen = l.list ? l.list.length : 0;
            sidebarItems.push({ id: l.id, type: 'user', el: createItem(l, l.name, 'fa-music', listLen) });
        });
    }

    getOrderedFavoriteSidebarItems(sidebarItems).forEach(item => container.appendChild(item.el));
    refreshLibrarySidebarCount();
    initFavoriteSidebarSortable(container);
    refreshFavoritesChildrenHeight();

    // [Resume] 处理本地列表的自动恢复跳转
    if (window._pendingResumeListId) {
        const listId = window._pendingResumeListId;
        delete window._pendingResumeListId;
        console.log('[Resume] 正在同步本地播放列表上下文:', listId);
        // 调用 handleListClick 以加载真实的列表数据并应用高亮
        handleListClick(listId);
    }
}

function handleListClick(listId, skipAutoUpdate = false, preservePage = false) {
    exitListSecondaryModes();

    if (!currentListData) return;

    if (!skipAutoUpdate) {
        // Selections belong to the previously rendered list. Keeping them here makes
        // the toolbar count include invisible songs after opening another favorite list.
        window.selectedItems?.clear();
        window.selectedSongObjects?.clear();
        if (typeof updateBatchToolbar === 'function') updateBatchToolbar();
    }

    // Mobile: Close sidebar when a list is selected
    if (window.innerWidth < 1025) {
        const sidebar = document.getElementById('main-sidebar');
        // If sidebar is open (class removed), close it
        if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
            toggleSidebar();
        }
    }

    // Set current viewing list ID for batch operations
    window.currentViewingListId = listId;
    currentSearchScope = 'local_list';

    let list = [];
    let title = '';

    if (listId === 'default') {
        list = currentListData.defaultList;
        title = '默认列表';
    } else if (listId === 'love') {
        list = currentListData.loveList;
        title = '我的收藏';
    } else {
        const uList = currentListData.userList.find(l => l.id === listId);
        if (uList) {
            list = uList.list;
            title = uList.name;
        }
    }

    // Switch to Search View (as List View)
    // Manually handle tab switch to avoid 'network' reset
    document.querySelectorAll('[id^="view-"]').forEach(el => el.classList.add('hidden'));
    const activeView = document.getElementById('view-search');
    activeView.classList.remove('hidden');

    // [New] 为歌单搜索视图重新初始化 ListSearch
    initGlobalListSearch();

    setTimeout(() => {
        activeView.classList.remove('opacity-0');
        activeView.classList.add('opacity-100');
    }, 10);

    // UI Updates
    document.getElementById('page-title').innerText = title;
    document.getElementById('search-input').value = '';
    document.getElementById('search-input').placeholder = `在 ${title} 中搜索...`;

    // Set Scope
    currentSearchScope = 'local_list';
    document.getElementById('search-source').classList.add('hidden'); // Hide selector
    document.getElementById('search-type').classList.add('hidden');

    // Reset all tabs to muted, then highlight Favorites as the parent
    document.querySelectorAll('[id^="tab-"]').forEach(el => {
        el.classList.remove('active-tab', 'text-emerald-600');
        el.classList.add('t-text-muted');
    });
    const favTab = document.getElementById('tab-favorites');
    if (favTab) {
        favTab.classList.add('active-tab');
        favTab.classList.remove('t-text-muted');
    }

    // Highlight Child List
    document.querySelectorAll('[data-sidebar-list-id]').forEach(el => {
        el.classList.remove('active-sub-item');
        el.classList.add('t-text-muted');
    });
    const subItem = document.querySelector(`[data-sidebar-list-id="${listId}"]`);
    if (subItem) {
        subItem.classList.add('active-sub-item');
        subItem.classList.remove('t-text-muted');
    }

    // Render
    if (!preservePage) {
        currentPage = 1;
        window.currentPage = 1;
    }
    renderResults(list);

    // [New] Auto Update Logic: If it's a network playlist (has sourceListId) and setting is ON, refresh background
    const uList = currentListData.userList ? currentListData.userList.find(l => l.id === listId) : null;
    if (!skipAutoUpdate && settings.autoUpdateNetworkList && uList && uList.sourceListId && uList.source) {
        console.log('[AutoUpdate] Triggering background refresh for list:', listId);
        handleRefreshList(listId, null, true); // true means silent/no-confirm
    }
}

function handleFavoritesClick() {
    exitListSecondaryModes();

    // Highlight Header
    document.querySelectorAll('[id^="tab-"]').forEach(el => {
        el.classList.remove('active-tab', 'text-emerald-600');
        el.classList.add('t-text-muted');
    });
    const favTab = document.getElementById('tab-favorites');
    if (favTab) {
        favTab.classList.add('active-tab');
        favTab.classList.remove('t-text-muted');
    }

    toggleFavorites();
}

async function handleCreateList() {
    const name = await showInput("新建歌单", "请输入新歌单的名称：", {
        placeholder: "歌单名称"
    });

    if (name && currentListData) {
        const activeListData = (window.isViewingPublicFavorites && window.myPersonalListData) ? window.myPersonalListData : currentListData;

        // 公开列表新建歌单需要管理员权限
        if (activeListData.username === '_open') {
            if (!(await requireAdminForOpenWrite('公开列表中新建歌单'))) return;
        }
        const newList = {
            id: 'webplayer_' + Date.now(),
            name: name,
            source: 'webplayer',
            list: []
        };
        activeListData.userList.push(newList);
        // Sync
        try {
            await pushDataChange(activeListData);
            renderMyLists(currentListData);
            // Re-render the add modal grid if it is open (or just to keep it fresh)
            if (typeof renderPlaylistAddGrid === 'function') {
                renderPlaylistAddGrid();
            }
            showSuccess('歌单创建成功');
        } catch (e) {
            console.error('Create list failed:', e);
            showError('创建失败，请重试');
        }
    }
}

async function handleRenameList(listId, event) {
    if (event) event.stopPropagation();
    if (!currentListData?.userList) return;

    const list = currentListData.userList.find(item => item.id === listId);
    if (!list) {
        showError('未找到要重命名的歌单');
        return;
    }

    const input = await showInput('重命名歌单', '请输入新的歌单名称：', {
        placeholder: '歌单名称',
        defaultValue: list.name || ''
    });
    if (input === null || input === undefined) return;

    const nextName = String(input).trim();
    if (!nextName) {
        showError('歌单名称不能为空');
        return;
    }
    if (nextName === list.name) return;

    if (!(await requireAdminForOpenWrite('重命名公开歌单'))) return;

    list.name = nextName;
    try {
        await pushDataChange();
        renderMyLists(currentListData);

        if (typeof renderPlaylistAddGrid === 'function' && !document.getElementById('playlist-add-modal')?.classList.contains('hidden')) {
            renderPlaylistAddGrid();
        }
        if (window.currentSearchScope === 'local_list' && window.currentViewingListId === listId) {
            handleListClick(listId, true);
        }
        showSuccess('歌单名称已更新');
    } catch (e) {
        console.error('Rename list failed:', e);
        showError('重命名失败，请重试');
    }
}

function formatSongToLxMusicStandard(item) {
    if (!item) return item;
    const s = JSON.parse(JSON.stringify(item));

    // 获取封面地址 (兼容各种 SDK 原始字段和 meta 字段)
    const picUrl = s.img || s.pic || s.picUrl ||
        (s.meta && (s.meta.picUrl || s.meta.img || s.meta.pic)) ||
        (s.album && (s.album.picUrl || s.album.img)) ||
        (s.al && s.al.picUrl) || null;

    // 如果已经包含合法的 meta 且有 songId，且 ID 符合规范，可能是已格式化的
    if (s.meta && s.meta.songId && s.id && (String(s.id).includes('_') || s.source === 'mg')) {
        // 确保 picUrl 存在
        if (!s.meta.picUrl && picUrl) s.meta.picUrl = picUrl;
        return s;
    }

    const source = s.source || '';
    const songmid = s.songmid || s.id || '';

    // 1. 提取核心元数据
    const albumName = s.albumName ||
        (s.album && s.album.name) ||
        (s.al && s.al.name) ||
        (s.meta && s.meta.albumName) || '';

    const albumId = s.albumId ||
        (s.album && s.album.id) ||
        (s.al && s.al.id) ||
        (s.meta && s.meta.albumId) || null;

    // 2. 构造干净的 meta 对象（只保留标准字段）
    let meta = {
        songId: String(songmid),
        songmid: String(songmid),
        albumName: albumName,
        picUrl: picUrl,
        qualitys: s.qualitys || s.types || (s.meta && (s.meta.qualitys || s.meta.types)) || [],
        _qualitys: s._qualitys || s._types || (s.meta && (s.meta._qualitys || s.meta._types)) || {}
    };

    if (albumId) meta.albumId = String(albumId);

    // 3. 构造标准 root 对象
    const rootItem = {
        name: s.name || '',
        singer: s.singer || '',
        source: source,
        interval: s.interval || s.time || '',
        meta: meta
    };

    // 4. 针对各平台源的特殊 ID 处理
    switch (source) {
        case 'tx':
            if (s.strMediaMid || (s.meta && s.meta.strMediaMid))
                meta.strMediaMid = s.strMediaMid || s.meta.strMediaMid;
            if (s.albumMid || (s.meta && s.meta.albumMid))
                meta.albumMid = s.albumMid || s.meta.albumMid;
            if (s.songId || (s.meta && s.meta.songId))
                meta.songId = String(s.songId || s.meta.songId);
            rootItem.id = `tx_${songmid}`;
            break;
        case 'wy':
            rootItem.id = `wy_${songmid}`;
            break;
        case 'kg':
            let hash = s.hash || (s.meta && s.meta.hash) || '';
            if (!hash && String(songmid).includes('_')) {
                hash = String(songmid).split('_')[1];
            } else if (!hash && String(songmid).length === 32) {
                hash = songmid;
            }

            let kgSongId = s.songId || (s.meta && s.meta.songId) || (String(songmid).includes('_') ? String(songmid).split('_')[0] : songmid);
            if (kgSongId === hash) kgSongId = '';

            meta.songId = String(kgSongId || '');
            meta.hash = hash;

            if (kgSongId && hash) {
                rootItem.id = `${kgSongId}_${hash}`;
            } else if (hash) {
                rootItem.id = hash;
            } else {
                rootItem.id = `kg_${kgSongId}`;
            }
            break;
        case 'mg':
            if (s.copyrightId || (s.meta && s.meta.copyrightId))
                meta.copyrightId = s.copyrightId || s.meta.copyrightId;
            if (s.lrcUrl || (s.meta && s.meta.lrcUrl))
                meta.lrcUrl = s.lrcUrl || s.meta.lrcUrl;
            rootItem.id = String(songmid);
            break;
        case 'kw':
            rootItem.id = `kw_${songmid}`;
            break;
        default:
            rootItem.id = songmid;
            break;
    }

    return rootItem;
}

function collectCurrentSongList() {
    const activeListData = isUserLoggedIn() ? (window.myPersonalListData || currentListData) : currentListData;
    if (!activeListData || typeof window.SongListManager === 'undefined') return;
    const detail = window.SongListManager.getCurrentDetail();
    if (!detail || !detail.id || !detail.list || detail.list.length === 0) {
        if (window.showToast) window.showToast('error', '歌单数据不完整或为空');
        return;
    }

    if (!isUserLoggedIn() && activeListData.username === '_open') {
        requireAdminForOpenWrite('收藏歌单到公开列表').then(ok => {
            if (ok) _executeCollectSongList(activeListData, detail);
        });
        return;
    }

    _executeCollectSongList(activeListData, detail);
}

function _executeCollectSongList(activeListData, detail) {
    const existingIndex = activeListData.userList.findIndex(l => String(l.sourceListId) === String(detail.id) && l.source === detail.source);
    if (existingIndex >= 0) {
        if (window.showToast) window.showToast('info', '该歌单已在您的收藏中');
        return;
    }

    const randomHex = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
    const newId = `${detail.source}_${randomHex()}${randomHex()}${randomHex()}${randomHex()}`;

    const listWithSource = detail.list.map(s => {
        const item = formatSongToLxMusicStandard(s);
        if (!item.source) item.source = detail.source;
        return item;
    });

    const newList = {
        id: newId,
        name: detail.info.name || '未命名歌单',
        source: detail.source,
        sourceListId: String(detail.id),
        Album: detail.info.img || detail.info.pic || null,
        locationUpdateTime: null,
        list: listWithSource
    };

    activeListData.userList.push(newList);

    pushDataChange(activeListData).then(() => {
        renderMyLists(currentListData);
        if (window.showToast) window.showToast('success', '歌单收藏成功！');
    }).catch(err => {
        console.error('收藏失败:', err);
        if (window.showToast) window.showToast('error', '收藏失败，请重试');
    });
}

async function toggleLove() {
    const activeListData = isUserLoggedIn() ? (window.myPersonalListData || currentListData) : currentListData;
    if (!activeListData || currentIndex < 0) return;

    if (!isUserLoggedIn() && activeListData.username === '_open') {
        if (!(await requireAdminForOpenWrite('收藏歌曲到公开列表'))) return;
    }

    const song = currentPlaylist[currentIndex];
    const formattedSong = formatSongToLxMusicStandard(song);
    let targetId = formattedSong.id || song.id;

    const index = activeListData.loveList.findIndex(s => s.id === targetId || s.id === song.id);
    if (index >= 0) {
        activeListData.loveList.splice(index, 1);
    } else {
        addMusicByConfiguredLocation(activeListData.loveList, formattedSong);
    }

    updatePlayerInfo(song);
    await pushDataChange(activeListData);
}

async function handleRefreshList(listId, event, silent = false) {
    if (event) event.stopPropagation();
    if (!currentListData) return;

    const list = currentListData.userList.find(l => l.id === listId);
    if (!list || !list.sourceListId || !list.source) {
        if (!silent && window.showToast) window.showToast('info', '该歌单不支持在线刷新');
        return;
    }

    if (!silent) {
        const safeListName = escapeHtmlText(list.name || list.id || list.sourceListId || '');
        const confirmed = await showSelect('更新歌单', `是否更新当前歌单 "${safeListName}"？\n(确认后将重新从服务器拉取歌单并覆盖当前内容)`, {
            confirmText: '确定更新',
            confirmColor: 'bg-emerald-500'
        });

        if (!confirmed) return;
    }

    if (window.showToast) window.showToast('info', '正在同步最新歌单内容...');

    try {
        const url = `${API_BASE}/songList/detail?source=${encodeURIComponent(list.source)}&id=${encodeURIComponent(list.sourceListId)}&page=1`;
        const res = await fetch(url);
        const data = await res.json();

        if (!data || !data.list) throw new Error('数据拉取失败');

        // 格式化新歌曲列表
        const newList = data.list.map(s => {
            const item = formatSongToLxMusicStandard(s);
            if (!item.source) item.source = list.source;
            return item;
        });

        // 更新列表模型
        list.list = newList;
        if (data.info) {
            if (data.info.name) list.name = data.info.name;
            if (data.info.img || data.info.pic) list.Album = data.info.img || data.info.pic;
        }

        // 清除该列表的更新标记
        if (window.networkListUpdateMap) {
            window.networkListUpdateMap.delete(listId);
        }

        // 推送同步并重绘 UI
        await pushDataChange();
        renderMyLists(currentListData);

        // 如果当前正处于该列表视图，刷新结果列表显示
        if (window.currentViewingListId === listId) {
            handleListClick(listId, true); // Skip auto-update to avoid loop
        }

        if (window.showToast) window.showToast('success', '歌单内容已同步至最新状态');
    } catch (e) {
        console.error('[Refresh] Failed:', e);
        if (window.showToast) window.showToast('error', '歌单同步失败: ' + e.message);
    }
}

async function handleJumpToOriginalList(listId, event) {
    if (event) event.stopPropagation();
    if (!currentListData) return;

    const list = currentListData.userList.find(l => l.id === listId);
    if (!list || !list.sourceListId || !list.source) {
        if (window.showToast) window.showToast('info', '该歌单不支持跳转到原始页');
        return;
    }

    // 1. Switch Tab to songlist
    switchTab('songlist');

    // 2. Adjust SongListManager source select if available
    const sourceSelect = document.getElementById('songlist-source');
    if (sourceSelect) {
        sourceSelect.value = list.source;
    }

    // 3. Open Detail view via SongListManager
    if (window.SongListManager && window.SongListManager.openDetail) {
        window.SongListManager.openDetail(list.sourceListId, list.source);
    }
}


// Auto-restore on page load
document.addEventListener('DOMContentLoaded', async () => {
    // 0. Load settings first
    loadSettings();

    // Checkbox State
    const pubToggle = document.getElementById('toggle-public-sources');
    if (pubToggle) {
        pubToggle.checked = settings.enablePublicSources !== false;
    }

    // Update UI to match settings
    const selectEl = document.getElementById('items-per-page-select');
    if (selectEl && settings.itemsPerPage) {
        selectEl.value = settings.itemsPerPage.toString();
    }

    // [新增] 恢复音量设置
    try {
        const savedVolume = localStorage.getItem('lx_volume');
        if (savedVolume) {
            currentVolume = parseFloat(savedVolume);
            audio.volume = currentVolume;
            updateVolumeUI();
            console.log('[Volume] 已恢复音量设置:', currentVolume);
        }
    } catch (e) {
        console.error('[Volume] 恢复音量设置失败:', e);
    }

    // [新增] 恢复播放模式设置
    try {
        const savedMode = localStorage.getItem('lx_play_mode');
        if (savedMode && ['list', 'single', 'random', 'order'].includes(savedMode)) {
            playMode = savedMode;
            updatePlayModeUI();
            console.log('[PlayMode] 已恢复播放模式:', playMode);
        } else {
            // 默认模式
            updatePlayModeUI();
        }
    } catch (e) {
        console.error('[PlayMode] 恢复播放模式失败:', e);
    }

    // 1. Restore cached list data (from IndexedDB) for logged in user only
    try {
        const cachedList = await window.ListStore.get();
        if (cachedList && isUserLoggedIn()) {
            currentListData = cachedList;
            const savedUser = localStorage.getItem('lx_sync_user');
            if (savedUser && currentListData) {
                currentListData.username = savedUser;
            }
            window.myPersonalListData = currentListData;
            renderMyLists(currentListData);
            console.log('[Cache] 已恢复缓存的个人列表数据');
        }
    } catch (e) {
        console.error('[Cache] 恢复列表数据失败:', e);
    }

    // [New] Switch to the user's default entry tab on load
    const defaultTab = settings.defaultEntry || 'favorites';
    switchTab(defaultTab);

    // 2. Auto-reconnect or auto-login
    const syncMode = localStorage.getItem('lx_sync_mode');

    if (syncMode === 'local') {
        // Local mode: auto-login
        const user = localStorage.getItem('lx_sync_user');
        const pass = localStorage.getItem('lx_sync_pass');
        if (user && pass) {
            document.getElementById('sync-local-user').value = user;
            document.getElementById('sync-local-pass').value = pass;
            console.log('[Cache] 自动登录本地账号:', user);
            handleLocalLogin();
        }
    } else if (syncMode === 'remote') {
        // Remote mode: auto-reconnect
        const url = localStorage.getItem('lx_sync_url');
        const code = localStorage.getItem('lx_sync_code');
        const authStr = localStorage.getItem('lx_ws_auth');

        if (url && code) {
            document.getElementById('sync-remote-url').value = url;
            document.getElementById('sync-remote-code').value = code;

            // Check if we have saved authInfo
            if (authStr) {
                try {
                    const authInfo = JSON.parse(authStr);
                    console.log('[Cache] 使用缓存的认证信息自动重连...');

                    // Pre-populate authInfo in client
                    syncManager.initRemote(url, code, {
                        getData: async () => {
                            const cachedData = await window.ListStore.get().catch(() => null);
                            return cachedData || { defaultList: [], loveList: [], userList: [] };
                        },
                        setData: async (data) => {
                            await window.ListStore.set(data).catch(e => console.error('[IDBStore] 保存失败:', e));
                            const oldUsername = currentListData ? currentListData.username : null;
                            currentListData = data;
                            if (oldUsername) currentListData.username = oldUsername; // Preserve username

                            renderMyLists(data);
                            document.getElementById('sync-status').innerHTML = '<i class="fas fa-check-circle text-blue-500"></i> 数据已同步';
                        },
                        getSyncMode: async () => {
                            return new Promise((resolve) => {
                                syncModeResolve = resolve;
                                showSyncModeModal();
                            });
                        }
                    });

                    syncManager.client.authInfo = authInfo; // Reuse saved auth
                    syncManager.client.onLogin = (success) => {
                        if (success) {
                            console.log('[Cache] 自动重连成功');
                            updateSyncStatus('<i class="fas fa-check-circle text-green-500"></i> 已自动重连');
                        } else {
                            console.log('[Cache] 自动重连失败,需要手动重新配对');
                            localStorage.removeItem('lx_ws_auth'); // Clear invalid auth
                        }
                    };
                    syncManager.client.connect();
                } catch (e) {
                    console.error('[Cache] 自动重连失败:', e);
                }
            } else {
                console.log('[Cache] 无缓存认证信息,请手动连接');
            }
        }
    }
});

window.switchSyncMode = switchSyncMode;
window.handleLocalLogin = handleLocalLogin;
window.handleSyncLogout = handleSyncLogout;
window.resetAllSettings = resetAllSettings;

// Helper to Push Changes to Remote
async function pushDataChange(customListData) {
    const listToSave = customListData || currentListData;
    if (!listToSave) return;

    // 1. 优先同步保存到客户端 IndexedDB 本地缓存
    await window.ListStore.set(listToSave).catch(e => console.error('[IDBStore] 保存失败:', e));

    const isUserLoggedIn = !!userToken && localStorage.getItem('lx_sync_mode') === 'local';
    const isPublicList = listToSave.username === '_open' || listToSave.username === 'default';

    // 2. 如果是公开/未登录用户且开启了公开收藏开关
    if (isPublicList && window.lx_config?.['user.enablePublicFavorites']) {
        const isAdmin = !!localStorage.getItem('lx_admin_password');
        if (isAdmin) {
            try {
                const res = await fetch('/api/user/list?user=_open', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...getUserAuthHeaders()
                    },
                    body: JSON.stringify(listToSave)
                });
                if (!res.ok) {
                    const errorText = await res.text();
                    console.error('[PublicList] 推送保存公共歌单失败:', errorText);
                    showError('保存公共歌单失败: ' + errorText);
                    return;
                }
                console.log('[PublicList] 公共歌单成功保存至服务器');
            } catch (e) {
                console.error('[PublicList] 推送公共歌单网络异常:', e);
            }
        }
        return;
    }

    // 3. 登录普通用户的 SyncManager 推送逻辑
    try {
        if (window.SyncManager && window.SyncManager.client) {
            await window.SyncManager.push(listToSave);
            console.log('Data Pushed to Remote');
        } else {
            // 本地无同步模式：调用 REST API 推送给当前用户
            const headers = getUserAuthHeaders();
            if (headers['x-user-name'] === '_open') {
                const syncUser = localStorage.getItem('lx_sync_user');
                if (syncUser) headers['x-user-name'] = syncUser;
                else delete headers['x-user-name'];
            }
            const res = await fetch('/api/user/list', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...headers
                },
                body: JSON.stringify(listToSave)
            });
            if (!res.ok) throw new Error(await res.text());
        }
    } catch (e) {
        console.error('Push Failed', e);
    }
}

async function refreshUserListData() {
    if (!window.SyncManager) return;
    try {
        const listData = await window.SyncManager.sync();
        currentListData = listData;
        window.currentListData = listData;
        if (listData && listData.username !== '_open') {
            window.myPersonalListData = listData;
        }
        if (typeof renderMyLists === 'function') {
            renderMyLists(listData);
        }

        // [New] If currently viewing a local list, refresh its contents in main view
        if (window.currentSearchScope === 'local_list' && window.currentViewingListId) {
            console.log('[Sync] Auto-refreshing current list view:', window.currentViewingListId);
            handleListClick(window.currentViewingListId, true, true);
        }

        // Save to cache
        await window.ListStore.set(listData).catch(e => console.error('[IDBStore] 保存失败:', e));
        console.log('[Sync] List Data Refreshed');
        return listData;
    } catch (e) {
        console.error('[Sync] Failed to refresh list data:', e);
        return null;
    }
}

window.refreshUserListData = refreshUserListData;
window.handleRemoteConnect = handleRemoteConnect;
window.handleCreateList = handleCreateList;
window.handleRenameList = handleRenameList;
window.handleRefreshList = handleRefreshList;
window.handleRemoveList = handleRemoveList;
window.exportPlaylistToLocal = exportPlaylistToLocal;
window.toggleFavorites = toggleFavorites;
window.handleFavoritesClick = handleFavoritesClick;
window.handleRemoteStep1 = handleRemoteStep1;
window.handleRemoteBack = handleRemoteBack;


// ========================================
// Custom Source Management (自定义源管理)
// ========================================

let customSourceMode = 'file'; // 'file' or 'url'

// 切换上传方式
function switchCustomSourceMode(mode) {
    customSourceMode = mode;

    // 更新按钮样式
    document.getElementById('btn-source-file').className = mode === 'file'
        ? 'px-4 py-2 text-sm font-medium bg-emerald-100 text-emerald-700 rounded-lg'
        : 'px-4 py-2 text-sm font-medium bg-gray-100 t-text-muted rounded-lg hover:bg-gray-200';

    document.getElementById('btn-source-url').className = mode === 'url'
        ? 'px-4 py-2 text-sm font-medium bg-emerald-100 text-emerald-700 rounded-lg'
        : 'px-4 py-2 text-sm font-medium bg-gray-100 t-text-muted rounded-lg hover:bg-gray-200';

    // 切换显示
    document.getElementById('custom-source-file').classList.toggle('hidden', mode !== 'file');
    document.getElementById('custom-source-url').classList.toggle('hidden', mode !== 'url');
}

// 处理本地文件上传
async function handleFileUpload(input) {
    const file = input.files[0];
    if (!file) return;

    // 验证文件类型
    if (!file.name.endsWith('.js')) {
        showError('请选择 .js 文件');
        return;
    }

    // 更新文件名显示
    // document.getElementById('file-name-display').textContent = file.name;

    try {
        // 读取文件内容
        const content = await file.text();

        // 先验证脚本
        showInfo('正在验证脚本...');
        const adminPass = localStorage.getItem('lx_admin_password');
        const headers = { 'Content-Type': 'application/json', ...getUserAuthHeaders() };
        if (adminPass) headers['x-frontend-auth'] = adminPass;

        let validationRes = await fetch('/api/custom-source/validate', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                script: content,
                username: currentListData?.username || 'default'
            })
        });

        if (validationRes.status === 403) {
            const errData = await validationRes.json();
            showError(errData.error || '权限限制：请先登录管理员。');
            const authorized = await handleAdminAuth('上传自定义源需要管理员权限');
            if (authorized) return handleFileUpload(input);
            input.value = '';
            return;
        }

        const validation = await validationRes.json();

        if (validation.disabledVM) {
            showError(validation.error || '已禁用VM。当前服务器已禁用 VM 模式。');
            input.value = '';
            return;
        }

        if (!validation.valid && !validation.requireUnsafe) {
            showError(`脚本无效: ${validation.error}`);
            input.value = '';
            // document.getElementById('file-name-display').textContent = '点击选择 .js 文件';
            return;
        }

        // 验证通过，上传
        showInfo(`验证通过，正在上传 "${validation.metadata.name || file.name}"...`);
        let result = await uploadCustomSource(file.name, content, 'file');

        if (result.disabledVM) {
            showError(result.message || '已禁用VM');
            input.value = '';
            return;
        }

        // 如果需要不安全模式确认
        if (result.requireUnsafe) {
            const confirmed = await showSelect('安全风险确认', result.message || '该脚本需要原生 VM 模式运行，可能存在安全风险，是否继续？', { danger: true, confirmText: '允许并上传' });
            if (confirmed) {
                result = await uploadCustomSource(file.name, content, 'file', true);
                if (result.disabledVM) {
                    showError(result.message || '已禁用VM');
                    input.value = '';
                    return;
                }
            } else {
                showInfo('已取消上传');
                input.value = '';
                return;
            }
        }

        showSuccess(`已上传: ${validation.metadata.name || file.name} ${validation.metadata.version ? (/^v/i.test(validation.metadata.version) ? validation.metadata.version : 'v' + validation.metadata.version) : ''}`);

        // 重置输入
        input.value = '';
        // document.getElementById('file-name-display').textContent = '点击选择 .js 文件';

        // 刷新源列表
        loadCustomSources();
    } catch (error) {
        console.error('[CustomSource] 上传失败:', error);
        showError(`上传失败: ${error.message}`);
    }
}

// 处理远程链接导入
async function handleUrlImport() {
    const input = await showInput("导入远程音源", "请输入自定义源脚本的 URL 地址:", {
        placeholder: "https://example.com/script.js",
        confirmText: "开始导入"
    });

    if (input === null) return; // 用户取消

    const url = input.trim();
    if (!url) {
        showError('请输入链接地址');
        return;
    }

    try {
        showInfo('正在获取并验证远程脚本...');

        const username = currentListData?.username || 'default';
        const headers = { 'Content-Type': 'application/json', ...getUserAuthHeaders() };
        const adminPass = localStorage.getItem('lx_admin_password');
        if (adminPass) headers['x-frontend-auth'] = adminPass;

        // 从服务器代理下载
        const response = await fetch(`/api/custom-source/import`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                url,
                filename: url.split('/').pop().split('?')[0] || '',
                username: username
            })
        });

        if (response.status === 403) {
            const data = await response.json();
            showError(data.error || '权限限制：请先登录管理员。');
            const authorized = await handleAdminAuth('导入自定义源需要管理员权限');
            if (authorized) return handleUrlImport();
            return;
        }

        let result = await response.json();

        if (result.disabledVM) {
            showError(result.message || '已禁用VM');
            return;
        }

        if (!response.ok || (result.success === false && !result.requireUnsafe)) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }

        // 如果需要不安全模式确认
        if (result.requireUnsafe) {
            const confirmed = await showSelect('安全风险确认', result.message || '该脚本需要原生 VM 模式运行，可能存在安全风险，是否继续？', { danger: true, confirmText: '允许并导入' });
            if (confirmed) {
                const retryHeaders = { 'Content-Type': 'application/json', ...getUserAuthHeaders() };
                if (adminPass) retryHeaders['x-frontend-auth'] = adminPass;
                const retryResp = await fetch(`/api/custom-source/import`, {
                    method: 'POST',
                    headers: retryHeaders,
                    body: JSON.stringify({
                        url,
                        filename,
                        username: username,
                        allowUnsafeVM: true,
                    })
                });
                if (retryResp.status === 403) {
                    showError('管理员验证校验失败');
                    return;
                }
                result = await retryResp.json();
                if (result.disabledVM) {
                    showError(result.message || '已禁用VM');
                    return;
                }
            } else {
                showInfo('已取消导入');
                return;
            }
        }

        showSuccess(`已导入: ${result.filename}`);

        // 刷新源列表
        loadCustomSources();
    } catch (error) {
        console.error('[CustomSource] 导入失败:', error);
        showError(`导入失败: ${error.message}`);
    }
}

// 上传自定义源到服务器
async function uploadCustomSource(filename, content, type, allowUnsafeVM = false) {
    const headers = { 'Content-Type': 'application/json', ...getUserAuthHeaders() };
    const adminPass = localStorage.getItem('lx_admin_password');
    if (adminPass) headers['x-frontend-auth'] = adminPass;

    const response = await fetch('/api/custom-source/upload', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
            filename,
            content,
            type,
            username: currentListData?.username || 'default', // 使用当前登录用户
            allowUnsafeVM
        })
    });

    if (response.status === 403) {
        const result = await response.json();
        showError(result.error || '权限不足：请先登录管理员。');
        const authorized = await handleAdminAuth('上传自定义源需要管理员权限');
        if (authorized) return uploadCustomSource(filename, content, type, allowUnsafeVM);
        return;
    }

    if (!response.ok) {
        const errorText = await response.text();
        let errMsg = errorText;
        try {
            const errJson = JSON.parse(errorText);
            if (errJson.error) errMsg = errJson.error;
        } catch (e) { }
        throw new Error(errMsg || `HTTP ${response.status}`);
    }

    const result = await response.json();
    if (result.success === false && !result.requireUnsafe && !result.disabledVM) {
        throw new Error(result.error || '上传失败');
    }
    return result;
}

// 加载自定义源列表 (随时可以调用以刷新界面)
async function loadCustomSources() {
    await renderCustomSources();
}

// ========== 自定义源管理逻辑 ==========

async function fetchCustomSources() {
    try {
        const username = currentListData?.username || 'default';
        const headers = getUserAuthHeaders();
        const adminPass = localStorage.getItem('lx_admin_password');
        if (adminPass) headers['x-frontend-auth'] = adminPass;

        const res = await fetch(`/api/custom-source/list?username=${username}`, {
            headers: headers
        });

        if (res.status === 403) {
            // 被后端拒绝访问，说明开启了公开限制且未登录成功
            console.warn('[CustomSource] List access denied (403)');
            return null; // 返回 null 表示由于权限原因被拦截
        }

        if (!res.ok) throw new Error('Failed to fetch sources');
        return await res.json();
    } catch (err) {
        console.error('Fetch sources failed:', err);
        return [];
    }
}


function updateSourceScopeUI() {
    const username = currentListData?.username || 'default';
    const isPublic = username === 'default';
    const showPublic = settings.enablePublicSources !== false; // Default true

    const settingsTag = document.getElementById('settings-source-scope-tag');
    const modalTag = document.getElementById('modal-source-scope-info');

    // Tag Content Logic
    let tagHtml = '';
    if (isPublic) {
        tagHtml = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-500 whitespace-nowrap inline-block">公开</span>`;
    } else {
        // User logged in
        let userTag = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-600 whitespace-nowrap inline-block">${username}</span>`;
        if (showPublic) {
            userTag += `<span class="ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-500 whitespace-nowrap inline-block">公开</span>`
        }
        tagHtml = userTag;
    }

    if (settingsTag) settingsTag.innerHTML = tagHtml;

    if (modalTag) {
        modalTag.innerHTML = isPublic
            ? `<div class="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 w-fit mb-2"><i class="fas fa-globe"></i> 上传到: 公开</div>`
            : `<div class="flex items-center gap-2 text-xs text-purple-600 bg-purple-50 px-3 py-1.5 rounded-lg border border-purple-100 w-fit mb-2"><i class="fas fa-user-circle"></i> 上传到: ${username}</div>`;
    }
}

function togglePublicSourcesSetting() {
    updateSetting('enablePublicSources', !settings.enablePublicSources);
}

async function renderCustomSources() {
    let list = await fetchCustomSources();

    // 判断当前状态：是否由于权限被拦截
    // list === null 表示后端返回了 403
    // 或者前端认为应该拦截：开启了公开限制 && 非登录用户 && 非管理员
    const isAdmin = !!localStorage.getItem('lx_admin_password');
    const isUser = !!userToken;
    const isPublicRestrictionEnabled = !!window.lx_config?.['user.enablePublicRestriction'];
    const isPublicRestrictionActive = isPublicRestrictionEnabled && !isUser && !isAdmin;

    // 如果 list 为 null（后端拦截）或者前端计算出受限，则启用锁定展示
    const shouldShowHidden = (list === null) || isPublicRestrictionActive;

    // Filter based on setting (if list is successfully fetched)
    if (list && settings.enablePublicSources === false) {
        list = list.filter(item => item.owner !== 'open');
    }

    // 缓存当前最新的源列表，供编辑模态框等快速查询
    window._currentCustomSourcesList = list || [];

    updateSourceScopeUI();

    // 控制模态框头部的工具栏显示/隐藏
    const toolbar = document.getElementById('custom-source-toolbar');
    if (toolbar) {
        // 权限判定：如果是公开访问受限模式，且当前非管理员且非登录用户，则隐藏上传/导入工具栏
        const canManageGlobal = isAdmin || isUser || !isPublicRestrictionEnabled;
        toolbar.classList.toggle('hidden', shouldShowHidden || !canManageGlobal);
    }

    // 渲染目标容器 ID 列表：模态框内 & 设置界面内
    const targetIds = ['custom-sources-list', 'settings-custom-sources-list'];

    targetIds.forEach(containerId => {
        const container = document.getElementById(containerId);
        if (!container) return;

        // 如果开启了公开限制且未通过验证，则显示锁定提示
        if (shouldShowHidden) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center p-8 t-text-muted">
                    <div class="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mb-4">
                        <i class="fas fa-lock text-3xl text-emerald-500/50"></i>
                    </div>
                    <p class="text-base font-bold t-text-main mb-2">列表内容已隐藏</p>
                    <p class="text-xs text-center max-w-[240px] leading-relaxed">当前系统已开启公开访问限制，请登录管理员账号后再管理或查看自定义源列表。</p>
                    <button onclick="handleAdminLogin()" class="mt-6 px-6 py-2.5 bg-emerald-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-100 hover:bg-emerald-600 transition-all active:scale-95">前往登录</button>
                </div>
            `;
            return;
        }

        // 空状态
        if (!list || list.length === 0) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center p-6 t-text-muted">
                    <i class="fas fa-box-open text-3xl mb-3 opacity-30"></i>
                    <p class="text-sm">暂无自定义源</p>
                    ${containerId === 'custom-sources-list' ?
                    `<button onclick="document.getElementById('script-file').click()" class="mt-3 text-emerald-600 hover:text-emerald-700 text-sm font-medium">即刻上传</button>`
                    : ''}
                </div>
            `;
            return;
        }

        container.innerHTML = '';

        list.forEach((source, index) => {
            const div = document.createElement('div');
            // 设置界面使用稍紧凑的样式，模态框使用标准样式 (这里为了统一先用一样的，微调边距)
            div.className = `t-bg-panel p-3 md:p-4 rounded-xl border t-border-main shadow-sm hover:shadow-md transition-all mb-2.5 md:mb-3 relative group flex items-start source-item`;
            div.dataset.id = source.id;
            div.dataset.enabled = source.enabled;
            div.dataset.index = index;

            // 格式化支持的源 (标识出已禁用的平台)
            let supportedBadges = '';
            const disabledSources = Array.isArray(source.disabledSources) ? source.disabledSources : [];
            if (source.supportedSources && source.supportedSources.length > 0) {
                const sourceMap = {
                    'kg': { name: '酷狗', color: 't-badge-blue' },
                    'kw': { name: '酷我', color: 't-badge-yellow' },
                    'tx': { name: 'QQ', color: 't-badge-green' },
                    'wy': { name: '网易', color: 't-badge-red' },
                    'mg': { name: '咪咕', color: 't-badge-pink' }
                };

                supportedBadges = `<div class="flex flex-wrap gap-1 md:gap-1.5 mt-1.5 md:mt-2">
                ${source.supportedSources.map(s => {
                    const info = sourceMap[s] || { name: s, color: 't-badge-gray' };
                    const isPlatformDisabled = disabledSources.includes(s);
                    if (isPlatformDisabled) {
                        return `<span class="px-1.5 py-0.5 rounded-md text-[9px] md:text-[10px] font-medium transition-colors border border-transparent bg-gray-100 text-gray-400 dark:bg-neutral-800 dark:text-neutral-500 opacity-50 line-through whitespace-nowrap cursor-help" title="${info.name} (在此音源中已关闭)">${info.name}</span>`;
                    }
                    return `<span class="px-1.5 py-0.5 rounded-md text-[9px] md:text-[10px] font-medium transition-colors border border-transparent ${info.color} whitespace-nowrap">${info.name}</span>`;
                }).join('')}
            </div>`;
            } else {
                supportedBadges = `<div class="mt-1.5 md:mt-2 text-[10px] t-text-muted italic">未知支持源</div>`;
            }

            const size = source.size && !isNaN(source.size) ? (source.size / 1024).toFixed(1) + ' KB' : '未知大小';
            let date = '未知日期';
            try {
                if (source.uploadTime) date = new Date(source.uploadTime).toLocaleDateString();
            } catch (e) { }

            /* Status Badge Logic */
            let statusBadge = '';
            let errorMsg = '';

            if (source.enabled) {
                if (source.status === 'success') {
                    statusBadge = `<span class="text-[9px] md:text-[10px] bg-emerald-50 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-500/30 px-1.5 py-0.5 rounded-full border border-emerald-100 flex items-center gap-1 transition-colors whitespace-nowrap"><i class="fas fa-check-circle"></i>正常</span>`;
                } else if (source.status === 'failed') {
                    statusBadge = `<span class="text-[9px] md:text-[10px] bg-red-50 text-red-600 dark:bg-red-500/20 dark:text-red-400 dark:border-red-500/30 px-1.5 py-0.5 rounded-full border border-red-100 flex items-center gap-1 cursor-help transition-colors whitespace-nowrap" title="${source.error || '加载失败'}"><i class="fas fa-times-circle"></i>失败</span>`;
                    errorMsg = `<div class="text-[9px] md:text-[10px] text-red-500 dark:text-red-400 mt-1 flex items-start gap-1 p-1.5 bg-red-50 dark:bg-red-900/20 rounded transition-colors"><i class="fas fa-info-circle mt-0.5 flex-shrink-0"></i><span class="break-all">${source.error || '未知错误'}</span></div>`;
                } else {
                    statusBadge = `<span class="text-[9px] md:text-[10px] bg-blue-50 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-500/30 px-1.5 py-0.5 rounded-full border border-blue-100 flex items-center gap-1 transition-colors whitespace-nowrap"><i class="fas fa-circle-notch fa-spin"></i>加载...</span>`;
                }
            }

            const ownerTag = (source.owner && source.owner !== 'open') ?
                `<span class="px-1.5 md:px-2 py-0.5 rounded-md text-[9px] md:text-[10px] font-bold bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300 whitespace-nowrap">${source.owner}</span>` :
                `<span class="px-1.5 md:px-2 py-0.5 rounded-md text-[9px] md:text-[10px] font-bold bg-blue-50 text-blue-500 whitespace-nowrap">公开</span>`;

            const vmTag = source.allowUnsafeVM ?
                `<span class="px-1.5 md:px-2 py-0.5 rounded-md text-[9px] md:text-[10px] font-bold bg-red-50 text-red-500 border border-red-100 dark:bg-red-500/20 dark:text-red-400 dark:border-red-500/30 whitespace-nowrap">VM</span>` : '';

            // 权限判断：管理员有所有权限；登录用户对公开源只有查看使用（Toggle）权限，无法刷新或删除
            const isPublic = source.owner === 'open';
            const canManageSource = isAdmin || (!isPublic && isUser);

            div.innerHTML = `
            <div class="flex items-center self-stretch cursor-grab custom-source-handle t-text-muted hover:text-emerald-500 pr-2 md:pr-4 -ml-1 md:-ml-2 transition-all active:scale-110 touch-none" title="拖拽排序">
                <i class="fas fa-grip-vertical text-base md:text-lg"></i>
            </div>
            <div class="flex justify-between items-start flex-1 min-w-0">
                <div class="flex-1 pr-2 md:pr-4 min-w-0">
                    <div class="flex flex-wrap items-center gap-1.5 md:gap-2 mb-1">
                        <i class="fas fa-file-code text-emerald-500 flex-shrink-0 text-xs md:text-sm"></i>
                         ${createMarqueeHtml(source.name, "font-bold t-text-main text-xs md:text-sm")}
                        ${ownerTag}
                        ${vmTag}
                    </div>
                    ${errorMsg}
                    <div class="flex flex-wrap items-center text-[10px] t-text-muted gap-x-2.5 md:gap-x-3 gap-y-1 mt-1 md:mt-1.5">
                        <span class="flex items-center whitespace-nowrap max-w-[110px] sm:max-w-[160px] md:max-w-none truncate" title="${source.author || '未知'}"><i class="fas fa-user mr-1 opacity-70 shrink-0"></i><span class="truncate">${source.author || '未知'}</span></span>
                        <span class="flex items-center whitespace-nowrap"><i class="far fa-hdd mr-1 opacity-70 shrink-0"></i>${size}</span>
                        <span class="t-bg-main t-text-muted px-1.5 py-0.5 rounded-lg shrink-0 transition-colors font-mono pointer-events-none border t-border-main text-[9px] md:text-[10px] whitespace-nowrap">${source.version ? (/^v/i.test(source.version) ? source.version : 'v' + source.version) : '未知'}</span>
                        ${statusBadge}
                    </div>
                    ${supportedBadges}
                </div>
                
                <div class="flex flex-col items-end gap-1.5 md:gap-2 shrink-0">
                    <button onclick="toggleSource('${source.id}', ${source.enabled})" 
                            class="px-2 md:px-3 py-1 rounded-lg text-[11px] md:text-xs font-medium transition-colors whitespace-nowrap w-16 md:w-20 flex justify-center items-center ${source.enabled
                    ? (source.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-500/30' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-500/30')
                    : 't-bg-track t-text-muted hover:t-bg-item-hover'}">
                        ${source.enabled ? '已启用' : '已禁用'}
                    </button>
                    
                    <div class="flex items-center gap-1">
                        ${source.enabled && source.status === 'failed' && canManageSource ? `
                        <button onclick="reloadSource('${source.id}')" 
                                class="p-1 md:p-1.5 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/40 rounded-lg transition-colors"
                                title="尝试重新加载">
                            <i class="fas fa-sync-alt text-xs md:text-sm"></i>
                        </button>` : ''}

                        <button data-id="${encodeURIComponent(source.id)}" onclick="openEditSourceModal(decodeURIComponent(this.dataset.id))"
                                class="p-1 md:p-1.5 t-text-muted hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/40 rounded-lg transition-colors"
                                title="编辑音源平台">
                            <i class="fas fa-edit text-xs md:text-sm"></i>
                        </button>
                        
                        ${canManageSource ? `
                        <button onclick="deleteSource('${source.id}')" 
                                class="p-1 md:p-1.5 t-text-muted hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/40 rounded-lg transition-colors"
                                title="删除">
                            <i class="fas fa-trash-alt text-xs md:text-sm"></i>
                        </button>` : ''}
                    </div>
                </div>
            </div>
        `;
            container.appendChild(div);
        });

        // Add Sortable for both the modal list and the settings panel list
        const isSortableContainer = (containerId === 'custom-sources-list' || containerId === 'settings-custom-sources-list') && typeof Sortable !== 'undefined';
        if (isSortableContainer) {
            try {
                const oldSortable = Sortable.get(container);
                if (oldSortable) oldSortable.destroy();
            } catch (e) { }

            Sortable.create(container, {
                animation: 200,
                handle: '.custom-source-handle',
                ghostClass: 'sortable-ghost-solid',
                chosenClass: 'sortable-chosen-item',
                dragClass: 'sortable-drag-item',
                forceFallback: true,
                delay: 200,
                delayOnTouchOnly: true,
                onEnd: async function (evt) {
                    // 防止两个容器同时触发 onEnd 导致重复请求
                    if (window._reorderLock) return;
                    window._reorderLock = true;
                    setTimeout(() => { window._reorderLock = false; }, 500);

                    // DOM 已由 SortableJS 更新，直接读取新顺序
                    const items = Array.from(container.querySelectorAll('.source-item'));
                    const finalOrderIds = items.map(el => el.dataset.id);

                    // 同步另一个容器的 DOM 顺序（保持两者一致）
                    const otherId = containerId === 'custom-sources-list' ? 'settings-custom-sources-list' : 'custom-sources-list';
                    const otherContainer = document.getElementById(otherId);
                    if (otherContainer) {
                        finalOrderIds.forEach(id => {
                            const el = otherContainer.querySelector(`.source-item[data-id="${id}"]`);
                            if (el) otherContainer.appendChild(el);
                        });
                    }

                    try {
                        const username = currentListData?.username || 'default';
                        const headers = { 'Content-Type': 'application/json', ...getUserAuthHeaders() };
                        const adminPass = localStorage.getItem('lx_admin_password');
                        if (adminPass) headers['x-frontend-auth'] = adminPass;

                        const response = await fetch('/api/custom-source/reorder', {
                            method: 'POST',
                            headers: headers,
                            body: JSON.stringify({ username, sourceIds: finalOrderIds })
                        });

                        if (response.status === 403) {
                            showError('权限限制：保存排序需要管理员身份。');
                            const authorized = await handleAdminAuth('保存排序需要管理员身份');
                            if (authorized) renderCustomSources();
                            else renderCustomSources();
                            return;
                        }
                        if (!response.ok) throw new Error('Reorder failed');
                        // 成功：DOM 已是正确顺序，无需重新拉取
                        showInfo('排序已保存');
                    } catch (error) {
                        console.error('Reorder error:', error);
                        showError('保存排序失败，已还原');
                        renderCustomSources();
                    }
                }
            });
        }
    });

    if (typeof applyMarqueeChecks === 'function') {
        applyMarqueeChecks();
    }
}

// 重新加载源 (强制重新启用)
async function reloadSource(sourceId) {
    try {
        const username = currentListData?.username || 'default';
        const adminPass = localStorage.getItem('lx_admin_password');
        const headers = { 'Content-Type': 'application/json', ...getUserAuthHeaders() };
        if (adminPass) headers['x-frontend-auth'] = adminPass;

        const response = await fetch('/api/custom-source/toggle', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ username, sourceId, enabled: true }) // Force enable triggers reload
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        showInfo('正在重新加载...');
        // Wait a bit for server to process
        setTimeout(() => {
            renderCustomSources();
        }, 1000);

    } catch (error) {
        console.error('Reload failed:', error);
        showError(`重载请求失败: ${error.message}`);
    }
}

// 切换状态
async function toggleSource(sourceId, currentEnabled, allowUnsafeVM = false) {
    try {
        const username = currentListData?.username || 'default';
        const headers = { 'Content-Type': 'application/json', ...getUserAuthHeaders() };
        const adminPass = localStorage.getItem('lx_admin_password');
        if (adminPass) headers['x-frontend-auth'] = adminPass;

        const response = await fetch('/api/custom-source/toggle', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ username, sourceId, enabled: !currentEnabled, allowUnsafeVM }) // Send new state
        });

        if (response.status === 403) {
            const data = await response.json();
            showError(data.error || '权限限制：需要管理员身份。');
            const authorized = await handleAdminAuth('修改自定义源状态需要管理员权限');
            if (authorized) return await toggleSource(sourceId, currentEnabled, allowUnsafeVM);
            return;
        }

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const result = await response.json();

        if (result.disabledVM) {
            showError(result.message || '已禁用VM');
            return;
        }

        // 处理 REQUIRE_UNSAFE_VM
        if (result.requireUnsafe) {
            const confirmed = await showSelect('安全风险确认', result.message || '该脚本需要原生 VM 模式运行，可能存在安全风险，是否继续？', { danger: true, confirmText: '依然启用' });
            if (confirmed) {
                return await toggleSource(sourceId, currentEnabled, true);
            } else {
                return;
            }
        }

        // 刷新列表
        await renderCustomSources();
        showSuccess(currentEnabled ? '已禁用' : '已启用');
    } catch (error) {
        console.error('[CustomSource] 切换状态失败:', error);
        showError(`操作失败: ${error.message}`);
    }
}

// 删除源
async function deleteSource(sourceId) {
    if (!(await showSelect('删除自定义源', '确定要删除这个自定义源吗？', { danger: true }))) return;

    try {
        const username = currentListData?.username || 'default';
        const headers = { 'Content-Type': 'application/json', ...getUserAuthHeaders() };
        const adminPass = localStorage.getItem('lx_admin_password');
        if (adminPass) headers['x-frontend-auth'] = adminPass;

        const response = await fetch('/api/custom-source/delete', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ username, sourceId })
        });

        if (response.status === 403) {
            const data = await response.json();
            showError(data.error || '权限限制：需要管理员身份。');
            const authorized = await handleAdminAuth('删除自定义源需要管理员权限');
            if (authorized) return await deleteSource(sourceId);
            return;
        }

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        showSuccess('已删除');
        await renderCustomSources();
    } catch (error) {
        console.error('[CustomSource] 删除失败:', error);
        showError(`删除失败: ${error.message}`);
    }
}

// 模态框控制
function openCustomSourceModal() {
    const modal = document.getElementById('custom-source-modal');
    const content = document.getElementById('custom-source-modal-content');
    if (modal) modal.classList.remove('hidden');

    // 渲染列表
    renderCustomSources();

    setTimeout(() => {
        if (content) {
            content.classList.remove('scale-95', 'opacity-0');
            content.classList.add('scale-100', 'opacity-100');
        }
    }, 10);
}

function closeCustomSourceModal() {
    const modal = document.getElementById('custom-source-modal');
    const content = document.getElementById('custom-source-modal-content');

    if (content) {
        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
    }

    setTimeout(() => {
        if (modal) modal.classList.add('hidden');
    }, 300);
}

// ========================================
// Edit Custom Source Platforms Modal
// ========================================

window._editingSource = null;

function openEditSourceModal(sourceId) {
    const list = window._currentCustomSourcesList || [];
    let source = list.find(s => s.id === sourceId);
    if (!source) {
        // 尝试解码匹配
        try {
            const decoded = decodeURIComponent(sourceId);
            source = list.find(s => s.id === decoded || decodeURIComponent(s.id) === decoded);
        } catch (e) { }
    }

    if (!source) {
        showError('未找到指定的音源信息');
        return;
    }

    window._editingSource = source;

    const modal = document.getElementById('edit-source-modal');
    const content = document.getElementById('edit-source-modal-content');
    const nameEl = document.getElementById('edit-source-modal-name');
    const versionEl = document.getElementById('edit-source-modal-version');
    const listContainer = document.getElementById('edit-source-platform-list');

    if (!modal || !content || !listContainer) return;

    nameEl.textContent = source.name || source.id;
    nameEl.title = source.name || source.id;
    versionEl.textContent = source.version ? (/^v/i.test(source.version) ? source.version : 'v' + source.version) : 'v1.0';

    const sourceMap = {
        'kg': { name: '酷狗音乐', icon: 'fas fa-dog', color: 'text-blue-500 bg-blue-50 dark:bg-blue-900/30' },
        'kw': { name: '酷我音乐', icon: 'fas fa-music', color: 'text-amber-500 bg-amber-50 dark:bg-amber-900/30' },
        'tx': { name: 'QQ音乐', icon: 'fab fa-qq', color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/30' },
        'wy': { name: '网易云音乐', icon: 'fas fa-cloud', color: 'text-red-500 bg-red-50 dark:bg-red-900/30' },
        'mg': { name: '咪咕音乐', icon: 'fas fa-headphones-alt', color: 'text-pink-500 bg-pink-50 dark:bg-pink-900/30' },
        'local': { name: '本地音乐', icon: 'fas fa-hdd', color: 'text-purple-500 bg-purple-50 dark:bg-purple-900/30' }
    };

    const supportedSources = Array.isArray(source.supportedSources) ? source.supportedSources : [];
    const disabledSources = Array.isArray(source.disabledSources) ? source.disabledSources : [];

    if (supportedSources.length === 0) {
        listContainer.innerHTML = `
            <div class="text-center py-8 t-text-muted text-xs">
                <i class="fas fa-exclamation-circle text-2xl mb-2 opacity-50"></i>
                <p>该脚本未声明支持的平台列表</p>
            </div>
        `;
    } else {
        listContainer.innerHTML = supportedSources.map(platform => {
            const meta = sourceMap[platform] || {
                name: platform.toUpperCase() + ' 平台',
                icon: 'fas fa-compact-disc',
                color: 'text-gray-500 bg-gray-50 dark:bg-neutral-800'
            };
            const isEnabled = !disabledSources.includes(platform);

            return `
                <div class="flex items-center justify-between p-3 rounded-xl border t-border-main t-bg-panel hover:shadow-sm transition-all platform-toggle-item" data-platform="${platform}">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-xl flex items-center justify-center ${meta.color} flex-shrink-0">
                            <i class="${meta.icon} text-sm"></i>
                        </div>
                        <div>
                            <div class="font-bold text-xs md:text-sm t-text-main flex items-center gap-2">
                                <span>${meta.name}</span>
                                <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-neutral-800 text-gray-500">${platform}</span>
                            </div>
                            <div class="text-[10px] t-text-muted mt-0.5 platform-status-text">
                                ${isEnabled ? '<span class="text-emerald-500 font-medium"><i class="fas fa-check-circle mr-1"></i>允许解析</span>' : '<span class="text-gray-400 font-medium"><i class="fas fa-ban mr-1"></i>已在此源关闭</span>'}
                            </div>
                        </div>
                    </div>
                    <div>
                        <label class="relative inline-flex items-center cursor-pointer select-none">
                            <input type="checkbox" value="${platform}" class="sr-only peer platform-checkbox" ${isEnabled ? 'checked' : ''} onchange="handlePlatformCheckboxChange(this)">
                            <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-neutral-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-emerald-500"></div>
                        </label>
                    </div>
                </div>
            `;
        }).join('');
    }

    modal.classList.remove('hidden');
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);
}

function handlePlatformCheckboxChange(checkbox) {
    const item = checkbox.closest('.platform-toggle-item');
    if (!item) return;
    const statusText = item.querySelector('.platform-status-text');
    if (statusText) {
        statusText.innerHTML = checkbox.checked
            ? '<span class="text-emerald-500 font-medium"><i class="fas fa-check-circle mr-1"></i>允许解析</span>'
            : '<span class="text-gray-400 font-medium"><i class="fas fa-ban mr-1"></i>已在此源关闭</span>';
    }
}

function toggleAllEditPlatforms(enableAll) {
    const checkboxes = document.querySelectorAll('#edit-source-platform-list .platform-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = enableAll;
        handlePlatformCheckboxChange(cb);
    });
}

function closeEditSourceModal() {
    const modal = document.getElementById('edit-source-modal');
    const content = document.getElementById('edit-source-modal-content');
    if (content) {
        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
    }
    setTimeout(() => {
        if (modal) modal.classList.add('hidden');
        window._editingSource = null;
    }, 250);
}

async function saveEditSourcePlatforms() {
    if (!window._editingSource) return;

    const source = window._editingSource;
    const saveBtn = document.getElementById('edit-source-save-btn');
    const originalHtml = saveBtn ? saveBtn.innerHTML : '';

    try {
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i><span>保存中...</span>';
        }

        const checkboxes = Array.from(document.querySelectorAll('#edit-source-platform-list .platform-checkbox'));
        // 收集被关闭的平台
        const disabledSources = checkboxes.filter(cb => !cb.checked).map(cb => cb.value);

        const username = currentListData?.username || 'default';
        const headers = { 'Content-Type': 'application/json', ...getUserAuthHeaders() };
        const adminPass = localStorage.getItem('lx_admin_password');
        if (adminPass) headers['x-frontend-auth'] = adminPass;

        const response = await fetch('/api/custom-source/update-platforms', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                username,
                id: source.id,
                disabledSources
            })
        });

        if (response.status === 403) {
            const errData = await response.json();
            showError(errData.error || '权限不足：修改平台配置需要管理员身份');
            const authorized = await handleAdminAuth('修改自定义源平台配置需要管理员身份');
            if (authorized) {
                return await saveEditSourcePlatforms();
            }
            return;
        }

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `HTTP ${response.status}`);
        }

        // 更新本地对象
        source.disabledSources = disabledSources;
        showSuccess('已更新平台配置');
        closeEditSourceModal();

        // 重新渲染音源列表以更新徽章
        await renderCustomSources();
    } catch (error) {
        console.error('[CustomSource] 保存平台配置失败:', error);
        showError(`保存失败: ${error.message}`);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalHtml;
        }
    }
}

// 绑定模态框背景点击关闭
const editSourceModalEl = document.getElementById('edit-source-modal');
if (editSourceModalEl) {
    editSourceModalEl.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            closeEditSourceModal();
        }
    });
}

window.openEditSourceModal = openEditSourceModal;
window.closeEditSourceModal = closeEditSourceModal;
window.toggleAllEditPlatforms = toggleAllEditPlatforms;
window.saveEditSourcePlatforms = saveEditSourcePlatforms;
window.handlePlatformCheckboxChange = handlePlatformCheckboxChange;


// ========================================
// Playlist Add Modal (Collections)
// ========================================


// Helper to render the grid (can be called from anywhere)
function renderPlaylistAddGrid() {
    const isBatch = !!window.batchCollectSongs;
    const songs = isBatch ? window.batchCollectSongs : [window.playlistAddTargetSong || currentPlayingSong];
    const firstSong = songs[0];
    if (!firstSong) return;

    const listContainer = document.getElementById('playlist-add-list');
    if (!listContainer) return;

    // Single song mode: calculate inclusion status
    let targetId = null;
    if (!isBatch) {
        const cleanedSong = cleanSongData(firstSong);
        targetId = cleanedSong.id;
    }

    listContainer.innerHTML = '';

    // Helper to create grid item
    const createGridItem = (listId, listName, count, isIncluded) => {
        const btn = document.createElement('button');
        // Base styles
        let className = "relative h-14 rounded-lg text-sm font-bold transition-all duration-200 flex items-center justify-center gap-1 shadow-sm overflow-hidden ";

        // Active/Inactive styles (Highlight only in single-song mode)
        if (!isBatch && isIncluded) {
            className += "bg-red-500 text-white shadow-md scale-[1.02] ring-2 ring-red-200";
        } else {
            className += "bg-emerald-50 text-emerald-500 hover:bg-emerald-100 hover:shadow";
        }

        btn.className = className;
        btn.onclick = () => handleTogglePlaylist(listId, btn); // Use handler wrapper

        btn.innerHTML = `
            <span class="truncate max-w-[80%]">${listName}</span>
            ${(!isBatch && isIncluded) ? '<i class="fas fa-check text-xs ml-1 opacity-80"></i>' : ''}
        `;
        return btn;
    };

    const activeListData = isUserLoggedIn() ? (window.myPersonalListData || currentListData) : currentListData;

    // 1. My Love
    const loveList = activeListData.loveList || [];
    const isLoved = !isBatch && targetId && loveList.some(s => s.id === targetId);
    listContainer.appendChild(createGridItem('love', '我的收藏', loveList.length, isLoved));

    // 2. User Lists
    if (activeListData.userList) {
        activeListData.userList.forEach(list => {
            const isIncluded = !isBatch && targetId && list.list.some(s => s.id === targetId);
            listContainer.appendChild(createGridItem(list.id, list.name, list.list.length, isIncluded));
        });
    }

    // 3. Create New List Dash Box
    const createNewBtn = document.createElement('button');
    createNewBtn.className = "h-14 rounded-lg text-xs font-bold border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-500 hover:text-emerald-500 hover:border-emerald-400 transition-all flex items-center justify-center gap-2 t-bg-main/20 hover:t-bg-main/50 shadow-sm";
    createNewBtn.innerHTML = `
        <i class="fas fa-plus"></i> 新建歌单
    `;
    createNewBtn.onclick = () => {
        handleCreateList();
    };
    listContainer.appendChild(createNewBtn);
}

function hasPlaylistData(data) {
    return !!data && Array.isArray(data.loveList) && Array.isArray(data.userList) &&
        data.userList.every(list => list && Array.isArray(list.list));
}

async function ensurePlaylistDataAvailable() {
    const getActiveData = () => isUserLoggedIn()
        ? (window.myPersonalListData || currentListData)
        : currentListData;

    let activeListData = getActiveData();
    if (hasPlaylistData(activeListData)) return activeListData;

    if (window.SyncManager?.client && typeof refreshUserListData === 'function') {
        await refreshUserListData();
        activeListData = getActiveData();
    }
    return hasPlaylistData(activeListData) ? activeListData : null;
}

async function openPlaylistAddModal(batchSongs = null) {
    const activeListData = await ensurePlaylistDataAvailable();
    if (!activeListData) {
        showError('未找到可用歌单，请先登录或创建歌单');
        return;
    }

    // 本地歌曲必须先关联真实平台 ID，避免把文件名回退 ID 同步到其他客户端。
    const isUnboundLocalSong = (song) => {
        if (!song?.isLocal && !song?._localLibraryItem) return false;
        return !window.LocalMusicManager?.isPlaylistCollectable(song);
    };

    if (Array.isArray(batchSongs)) {
        const collectableSongs = batchSongs.filter(song => !isUnboundLocalSong(song));
        const unavailableCount = batchSongs.length - collectableSongs.length;
        if (collectableSongs.length === 0) {
            showError('歌曲不在曲库中，无法收藏到歌单。请先使用“手动关联”绑定平台歌曲 ID。');
            window.batchCollectSongs = null;
            window.playlistAddTargetSong = null;
            return;
        }
        if (unavailableCount > 0) {
            showInfo(`已跳过 ${unavailableCount} 首未绑定平台 ID 的歌曲；歌曲不在曲库中，无法收藏到歌单。`);
        }
        if (collectableSongs.length === 1) {
            window.batchCollectSongs = null;
            window.playlistAddTargetSong = collectableSongs[0];
        } else {
            window.batchCollectSongs = collectableSongs;
            window.playlistAddTargetSong = null;
        }
    } else {
        window.batchCollectSongs = null;
        window.playlistAddTargetSong = null;
        if (isUnboundLocalSong(currentPlayingSong)) {
            showError('歌曲不在曲库中，无法收藏到歌单。请先使用“手动关联”绑定平台歌曲 ID。');
            return;
        }
    }

    const isBatch = !!window.batchCollectSongs;
    const song = isBatch ? window.batchCollectSongs[0] : (window.playlistAddTargetSong || currentPlayingSong);

    if (!song) {
        showError(isBatch ? '无可收藏的歌曲' : '当前没有正在播放的歌曲');
        return;
    }

    const modal = document.getElementById('playlist-add-modal');
    const content = document.getElementById('playlist-add-modal-content');
    const nameLabel = document.getElementById('playlist-add-song-name');

    if (!modal) return;

    // Set Info
    nameLabel.innerText = isBatch ? `已选择 ${window.batchCollectSongs.length} 首歌曲` : song.name;

    // Render List Items
    renderPlaylistAddGrid();

    // Show Modal
    modal.style.zIndex = '10005';
    modal.classList.remove('hidden');
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);
}

function openPlaylistAddModalForSong(index) {
    const song = window.viewingPlaylist?.[index];
    if (!song) {
        showError('未找到要添加的歌曲');
        return;
    }
    openPlaylistAddModal([song]);
}

function openPlaylistAddModalForSongObject(song) {
    if (!song) {
        showError('未找到要添加的歌曲');
        return;
    }
    return openPlaylistAddModal([song]);
}

window.openPlaylistAddModalForSong = openPlaylistAddModalForSong;
window.openPlaylistAddModalForSongObject = openPlaylistAddModalForSongObject;

function closePlaylistAddModal() {
    const modal = document.getElementById('playlist-add-modal');
    const content = document.getElementById('playlist-add-modal-content');

    if (content) {
        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
    }

    setTimeout(() => {
        if (modal) modal.classList.add('hidden');
        window.batchCollectSongs = null;
        window.playlistAddTargetSong = null;
        // Update Player Info to refresh heart icon state
        if (currentPlayingSong) {
            updatePlayerInfo(currentPlayingSong);
        }
    }, 300);
}

// 绑定模态框背景点击
const playlistAddModal = document.getElementById('playlist-add-modal');
if (playlistAddModal) {
    playlistAddModal.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            closePlaylistAddModal();
        }
    });
}


// Helper: Clean song data to match LX.Music.MusicInfoOnline interface
function cleanSongData(song) {
    if (!song) return null;

    // Ensure meta exists, defaulting to empty object if missing
    const sourceMeta = song.meta || {};

    // 1. Resolve Song ID (songId or songmid or id)
    // Different sources/APIs place the ID in different spots
    let songId = sourceMeta.songId || song.songId || song.songmid || song.id;

    // [Fix] 针对 QQ 音乐 (tx)，强制使用 songmid 作为主 ID，避免使用数字 ID
    if (song.source === 'tx' && song.songmid) {
        songId = song.songmid;
    }

    // 2. Resolve Album Name
    let albumName = sourceMeta.albumName || song.albumName || song.album?.name || '';

    // 3. Resolve Pic URL
    let picUrl = sourceMeta.picUrl || song.picUrl || song.img || song.album?.cover;

    // Common Meta
    const meta = {
        songId: songId,
        albumName: albumName,
        picUrl: picUrl,
        qualitys: sourceMeta.qualitys || song.qualitys || song.types,
        _qualitys: sourceMeta._qualitys || song._qualitys || song._types,
        albumId: sourceMeta.albumId || song.albumId
    };

    // Source Reference: src/types/music.d.ts
    // 补全特定源的字段
    if (song.source === 'kg') {
        meta.hash = sourceMeta.hash || song.hash;
    } else if (song.source === 'tx') {
        meta.strMediaMid = sourceMeta.strMediaMid || song.strMediaMid || song.mediaMid;
        meta.id = sourceMeta.id || song.songId || song.id; // tx often uses numerical ID here
        meta.albumMid = sourceMeta.albumMid || song.albumMid;
    } else if (song.source === 'mg') {
        meta.copyrightId = sourceMeta.copyrightId || song.copyrightId || songId; // fallback
        meta.lrcUrl = sourceMeta.lrcUrl || song.lrcUrl;
        meta.mrcUrl = sourceMeta.mrcUrl || song.mrcUrl;
        meta.trcUrl = sourceMeta.trcUrl || song.trcUrl;
    }

    // Common Base
    // 确保 ID 格式为 source_songId (如 kw_123456)
    // 如果 song.id 已经是 source_id 格式则保留，否则拼接
    const fullId = (song.source && songId && !String(songId).startsWith(song.source + '_'))
        ? `${song.source}_${songId}`
        : (song.id || `${song.source || 'temp'}_${songId}`);

    const cleanSong = {
        id: fullId, // Standardized ID
        name: song.name,
        singer: song.singer,
        source: song.source,
        interval: song.interval,
        meta: meta
    };

    if (song.isLocal) cleanSong.isLocal = song.isLocal;
    if (song.url) cleanSong.url = song.url;
    if (song.folder) cleanSong.folder = song.folder;
    if (song.filename) cleanSong.filename = song.filename;

    // Remove undefined keys
    const removeUndefined = (obj) => {
        Object.keys(obj).forEach(key => {
            if (obj[key] === undefined) delete obj[key];
            else if (typeof obj[key] === 'object' && obj[key] !== null) removeUndefined(obj[key]);
        });
        return obj;
    };

    return removeUndefined(cleanSong);
}


// Modified handler for Grid Buttons
async function handleTogglePlaylist(listId, btnElement) {
    if (!currentListData) return;
    const activeListData = isUserLoggedIn() ? (window.myPersonalListData || currentListData) : currentListData;

    // 未登录账号且正在对 _open 公开列表进行修改时，需要管理员权限
    if (!isUserLoggedIn() && activeListData.username === '_open') {
        if (!(await requireAdminForOpenWrite('修改公开收藏'))) return;
    }
    const isBatch = !!window.batchCollectSongs;
    const songs = isBatch ? window.batchCollectSongs : [window.playlistAddTargetSong || currentPlayingSong];
    if (songs.length === 0 || !songs[0]) return;

    // --- Batch Mode Logic ---
    if (isBatch) {
        btnElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中...';
        btnElement.disabled = true;

        // 1. Find target list in memory (Optimistic Update)
        let targetListArray = null;
        if (listId === 'love') targetListArray = activeListData.loveList;
        else targetListArray = activeListData.userList.find(l => l.id === listId)?.list;

        if (!targetListArray) {
            showError('未找到目标歌单');
            return;
        }

        // 2. Local State Modification
        const addedSongs = [];
        songs.forEach(s => {
            const cleaned = cleanSongData(s);
            if (!targetListArray.some(existing => existing.id === cleaned.id)) {
                addMusicByConfiguredLocation(targetListArray, cleaned);
                addedSongs.push(cleaned);
            }
        });

        if (addedSongs.length === 0) {
            showInfo('所选歌曲已在歌单中');
            closePlaylistAddModal();
            return;
        }

        // 3. Immediate UI Refresh
        renderMyLists(currentListData);
        if (window.currentSearchScope === 'local_list' && window.currentViewingListId) {
            handleListClick(window.currentViewingListId, true, true);
        }

        // 4. Close Modal Immediately
        closePlaylistAddModal();

        // 5. Background Backend Sync
        try {
            const isRemoteSync = window.SyncManager && window.SyncManager.mode === 'remote' && window.SyncManager.client && window.SyncManager.client.isConnected;

            if (isRemoteSync) {
                // 远程模式：推送更新
                await pushDataChange(activeListData);
                showSuccess(`成功批量同步 ${addedSongs.length} 首歌曲`);
            } else {
                // 本地模式：调用 API 同步后端存储
                const headers = getUserAuthHeaders();
                if (headers['x-user-name'] === '_open') {
                    const syncUser = localStorage.getItem('lx_sync_user');
                    if (syncUser) headers['x-user-name'] = syncUser;
                    else delete headers['x-user-name'];
                }
                const res = await fetch('/api/music/user/list/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...headers },
                    body: JSON.stringify({
                        listId: listId,
                        musicInfos: addedSongs
                    })
                });
                if (!res.ok) throw new Error(await res.text());
                showSuccess(`批量收藏 ${addedSongs.length} 首歌曲成功`);
            }

            // Cleanup selection
            if (typeof exitBatchMode === 'function') exitBatchMode();
            else if (typeof deselectAll === 'function') deselectAll();

        } catch (e) {
            console.error('[BatchCollect] Sync failed, reverting or refreshing:', e);
            showError('同步失败: ' + e.message);
            // Full refresh as fallback to ensure consistency
            refreshUserListData();
        } finally {
            window.batchCollectSongs = null;
        }
        return;
    }

    // --- Single Song Mode Logic (Existing) ---
    const song = songs[0];
    let targetListArray;
    if (listId === 'love') {
        targetListArray = activeListData.loveList;
    } else {
        const uList = activeListData.userList.find(l => l.id === listId);
        if (uList) targetListArray = uList.list;
    }

    if (!targetListArray) return;

    const cleanedSong = cleanSongData(song); // 获取标准化的歌曲数据
    const targetId = cleanedSong.id;

    // Check against the standardized ID to ensure correct matching
    const isCurrentlyIncluded = targetListArray.some(s => s.id === targetId);
    const willAdd = !isCurrentlyIncluded;

    // Optimistic UI Update
    updateGridItemVisuals(btnElement, willAdd);

    try {
        if (willAdd) {
            addMusicByConfiguredLocation(targetListArray, cleanedSong);
        } else {
            const idx = targetListArray.findIndex(s => s.id === targetId);
            if (idx >= 0) targetListArray.splice(idx, 1);
        }

        await pushDataChange(activeListData);
        renderMyLists(currentListData);
    } catch (e) {
        showError('同步失败: ' + e.message);
        updateGridItemVisuals(btnElement, !willAdd); // Revert UI
    }
}

function updateGridItemVisuals(btn, isIncluded) {
    if (isIncluded) {
        btn.className = "relative h-14 rounded-lg text-sm font-bold transition-all duration-200 flex items-center justify-center gap-1 shadow-sm overflow-hidden bg-red-500 text-white shadow-md scale-[1.02] ring-2 ring-red-200";
        // Update icon if needed, though innerHTML replacement is easiest
        const textSpan = btn.querySelector('span'); // Assuming first span is text
        const text = textSpan ? textSpan.innerText : btn.innerText;
        btn.innerHTML = `
            <span class="truncate max-w-[80%]">${text}</span>
            <i class="fas fa-check text-xs ml-1 opacity-80"></i>
        `;
    } else {
        btn.className = "relative h-14 rounded-lg text-sm font-bold transition-all duration-200 flex items-center justify-center gap-1 shadow-sm overflow-hidden bg-emerald-50 text-emerald-500 hover:bg-emerald-100 hover:shadow";
        const textSpan = btn.querySelector('span');
        const text = textSpan ? textSpan.innerText : btn.innerText;
        btn.innerHTML = `<span class="truncate max-w-[80%]">${text}</span>`;
    }
}



let currentCommentType = 'hot'; // 'hot' or 'new'
let currentCommentPage = 1;
let isCommentLoading = false;

// 评论数据缓存
let lastCommentSongId = null;
let commentCache = {
    hot: { pages: {}, total: 0, maxPage: 1 },
    new: { pages: {}, total: 0, maxPage: 1 }
};

function clearCommentCache() {
    commentCache.hot = { pages: {}, total: 0, maxPage: 1 };
    commentCache.new = { pages: {}, total: 0, maxPage: 1 };
    const hotCount = document.getElementById('hot-comment-count');
    const newCount = document.getElementById('new-comment-count');
    if (hotCount) hotCount.innerText = '';
    if (newCount) newCount.innerText = '';
}

// 解决变量名不一致问题
function getActiveSongInfo() {
    if (typeof currentPlayingSong !== 'undefined' && currentPlayingSong) return currentPlayingSong;
    return null;
}


function toggleCommentModal() {
    const modal = document.getElementById('comment-modal');
    const content = document.getElementById('comment-modal-content');
    if (!modal || !content) return;

    const isHidden = modal.classList.contains('hidden');

    if (isHidden) {
        // 打开
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        // 触发动画
        requestAnimationFrame(() => {
            content.classList.remove('translate-y-10', 'opacity-0');
            content.classList.add('translate-y-0', 'opacity-100');
        });

        // 加载评论
        const song = getActiveSongInfo();
        if (song) {
            const songId = song.songmid || song.hash || song.id;
            if (lastCommentSongId !== songId) {
                console.log('[Comment] Song changed, clearing cache and refreshing');
                lastCommentSongId = songId;
                clearCommentCache();
                refreshComments();
            } else {
                console.log('[Comment] Same song, using cache check');
                fetchComments();
            }
        } else {
            console.warn('[Comment] No song playing, showing empty state');
            document.getElementById('comment-list').innerHTML = '<div class="text-center py-10 t-text-muted font-bold">请先播放歌曲</div>';
            document.getElementById('comment-loader').classList.add('hidden');
        }
    } else {
        // 关闭
        content.classList.remove('translate-y-0', 'opacity-100');
        content.classList.add('translate-y-10', 'opacity-0');

        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }, 300);
    }
}

async function switchCommentType(type) {
    if (currentCommentType === type) return;
    currentCommentType = type;

    // UI Feedback
    const hotBtn = document.getElementById('tab-hot-comments');
    const newBtn = document.getElementById('tab-new-comments');

    if (type === 'hot') {
        hotBtn.classList.add('text-emerald-600');
        hotBtn.classList.remove('t-text-muted');
        hotBtn.querySelector('div').classList.remove('scale-x-0');

        newBtn.classList.remove('text-emerald-600');
        newBtn.classList.add('t-text-muted');
        newBtn.querySelector('div').classList.add('scale-x-0');
    } else {
        newBtn.classList.add('text-emerald-600');
        newBtn.classList.remove('t-text-muted');
        newBtn.querySelector('div').classList.remove('scale-x-0');

        hotBtn.classList.remove('text-emerald-600');
        hotBtn.classList.add('t-text-muted');
        hotBtn.querySelector('div').classList.add('scale-x-0');
    }

    refreshComments(false);
}

async function refreshComments(force = true) {
    if (force) {
        clearCommentCache();
    }
    currentCommentPage = 1;
    await fetchComments();
}

async function changeCommentPage(delta) {
    const newPage = currentCommentPage + delta;
    if (newPage < 1 || isCommentLoading) return;

    currentCommentPage = newPage;
    await fetchComments();

    // 滚动到顶部
    const container = document.getElementById('comment-list-container');
    if (container) container.scrollTo({ top: 0, behavior: 'smooth' });
}

async function fetchComments() {
    const song = getActiveSongInfo();
    if (!song || isCommentLoading) {
        console.log('[Comment] Fetch skipped:', { hasSong: !!song, isLoading: isCommentLoading });
        return;
    }

    const loader = document.getElementById('comment-loader');
    const list = document.getElementById('comment-list');
    const pageIndicator = document.getElementById('comment-page-indicator');

    // 1. 检查当前类型和页码是否有缓存
    const cache = commentCache[currentCommentType];
    const cachedPage = cache.pages[currentCommentPage];

    if (cachedPage) {
        console.log(`[Comment] Using cached ${currentCommentType} page ${currentCommentPage}`);
        if (list) list.innerHTML = ''; // 确保清空上一页内容
        renderComments(cachedPage);
        updateCommentCountLabels(cache.total);
        updatePaginationUI(cache.total, cache.maxPage);
        if (loader) loader.classList.add('hidden');
        isCommentLoading = false;
        return;
    }

    // 2. Cache miss: 显示加载状态
    isCommentLoading = true;
    if (loader) loader.classList.remove('hidden');
    if (list) list.innerHTML = '';
    if (pageIndicator) pageIndicator.innerText = `PAGE -- / --`;

    // 更新标题和来源
    document.getElementById('comment-title').innerText = `${song.name} - 评论`;
    document.getElementById('comment-source-info').innerText = `Source: ${song.source.toUpperCase()}`;

    console.log(`[Comment] Fetching ${currentCommentType} for ${song.name} (${song.source}), page ${currentCommentPage}`);

    try {
        const response = await fetch('/api/music/comment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                songInfo: song,
                type: currentCommentType,
                page: currentCommentPage,
                limit: 20
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Comment] API Error:', response.status, errorText);
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        console.log('[Comment] Data received:', data);
        if (data.error) throw new Error(data.error);

        // 存入缓存
        commentCache[currentCommentType].pages[currentCommentPage] = data.comments;
        commentCache[currentCommentType].total = data.total;
        commentCache[currentCommentType].maxPage = data.maxPage || Math.ceil((data.total || 0) / 20) || 1;

        renderComments(data.comments);
        updateCommentCountLabels(data.total);
        updatePaginationUI(data.total, data.maxPage);

    } catch (e) {
        console.error('Fetch comments failed:', e);
        if (list) list.innerHTML = `<div class="text-center py-10 text-red-400 font-bold">加载失败: ${e.message}</div>`;
    } finally {
        if (loader) loader.classList.add('hidden');
        isCommentLoading = false;
    }
}

function updatePaginationUI(total, maxPage) {
    const totalPages = maxPage || Math.ceil((total || 0) / 20) || 1;
    const pageIndicator = document.getElementById('comment-page-indicator');
    if (pageIndicator) pageIndicator.innerText = `PAGE ${currentCommentPage} / ${totalPages}`;

    const prevBtn = document.getElementById('btn-comment-prev');
    const nextBtn = document.getElementById('btn-comment-next');
    if (prevBtn) prevBtn.disabled = currentCommentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentCommentPage >= totalPages;

    // 兼容旧版统计逻辑 (如果有)
    const oldInfo = document.getElementById('comment-pagination-info');
    if (oldInfo) oldInfo.innerText = `Page ${currentCommentPage}`;
}

function updateCommentCountLabels(total) {
    if (total === undefined) return;
    const countLabel = currentCommentType === 'hot' ? 'hot-comment-count' : 'new-comment-count';
    const el = document.getElementById(countLabel);
    if (el) el.innerText = total > 1000 ? (total / 1000).toFixed(1) + 'k' : total;
}

function renderComments(comments) {
    const list = document.getElementById('comment-list');
    if (!list) return;

    if (!comments || comments.length === 0) {
        if (currentCommentPage === 1) {
            list.innerHTML = '<div class="text-center py-20 text-gray-300 font-bold uppercase tracking-widest">暂无评论</div>';
        }
        return;
    }

    const html = comments.map(c => createCommentItemHTML(c)).join('');
    if (currentCommentPage === 1) {
        list.innerHTML = html;
    } else {
        list.insertAdjacentHTML('beforeend', html);
    }
}

function createCommentItemHTML(comment, isReply = false) {
    const timeStr = comment.timeStr || (comment.time ? new Date(comment.time).toLocaleString() : '');
    const location = comment.location ? ` • ${comment.location}` : '';

    // 头像处理
    const defaultAvatar = '/music/assets/logo.svg';
    const avatar = comment.avatar || defaultAvatar;
    const isDefault = avatar.includes('logo.svg') || !comment.avatar;
    const avatarClass = `w-8 h-8 md:w-10 md:h-10 rounded-full shadow-sm hover:scale-110 transition-transform t-bg-main flex-shrink-0 object-cover ${isDefault ? 'dynamic-logo is-placeholder p-1.5' : ''}`;

    let replyHtml = '';
    if (comment.reply && comment.reply.length > 0) {
        replyHtml = `
            <div class="mt-4 ml-2 pl-4 border-l-2 t-border-main space-y-4">
                ${comment.reply.map(r => createCommentItemHTML(r, true)).join('')}
            </div>
        `;
    }

    return `
        <div class="group flex gap-3 md:gap-4 transition-all animate-fade-in-up">
            <img src="${avatar}" 
                 loading="lazy" fetchpriority="low"
                 class="${avatarClass}" 
                 onerror="if(!this.dataset.tried){this.dataset.tried=1;this.src='/music/assets/logo.svg';this.classList.add('dynamic-logo','is-placeholder','p-1.5','bg-emerald-50');this.style.filter='var(--logo-filter, none)';}">
            <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs md:text-sm font-black t-text-main truncate">${comment.userName}</span>
                    <div class="flex items-center gap-1.5 text-[10px] t-text-muted font-bold">
                        <i class="far fa-thumbs-up"></i>
                        <span>${comment.likedCount || 0}</span>
                    </div>
                </div>
                <p class="text-xs md:text-sm t-text-muted leading-relaxed break-words whitespace-pre-wrap">${comment.text}</p>
                ${comment.images && comment.images.length > 0 ? `
                    <div class="mt-2 flex flex-wrap gap-2">
                        ${comment.images.map(img => `
                            <img src="${img}" 
                                 loading="lazy" fetchpriority="low"
                                 class="max-w-[200px] max-h-[300px] rounded-lg shadow-sm cursor-pointer hover:opacity-90 transition-opacity" 
                                 onclick="window.open('${img}', '_blank')"
                                 onerror="this.style.display='none'">
                        `).join('')}
                    </div>
                ` : ''}
                <div class="mt-2 flex items-center gap-3 text-[10px] t-text-muted font-bold uppercase tracking-tight">
                    <span>${timeStr}${location}</span>
                </div>
                ${replyHtml}
            </div>
        </div>
    `;
}

async function toggleSongInList(listId, isAdd) {
    // Deprecated in favor of handleTogglePlaylist
    console.warn("toggleSongInList is deprecated");
}


// ========================================
// 导出函数到 window (ES Module 需要显式暴露)
// ========================================

// Custom Source functions
window.openCustomSourceModal = openCustomSourceModal;
window.closeCustomSourceModal = closeCustomSourceModal;
window.switchCustomSourceMode = switchCustomSourceMode;
window.handleFileUpload = handleFileUpload;
window.handleUrlImport = handleUrlImport;

// Playlist Modal functions
window.openPlaylistAddModal = openPlaylistAddModal;
window.closePlaylistAddModal = closePlaylistAddModal;
window.toggleSongInList = toggleSongInList;


// 新版函数名
window.toggleSource = toggleSource;
window.deleteSource = deleteSource;
window.reloadSource = reloadSource;

// 兼容旧版函数名 (Alias)
window.toggleCustomSource = toggleSource;
window.deleteCustomSource = deleteSource;
window.importFromUrl = handleUrlImport;

window.togglePublicSourcesSetting = togglePublicSourcesSetting;

// Core functions
window.switchTab = switchTab;
window.handleSearchKeyPress = handleSearchKeyPress;
window.doSearch = doSearch;
window.changePage = changePage;
window.handleHotSearchClick = handleHotSearchClick;
window.playSong = playSong;
window.togglePlay = togglePlay;
window.handleDownloadClick = handleDownloadClick;
window.playNext = playNext;
window.playPrev = playPrev;
window.seek = seek;
window.changeQualityPreference = changeQualityPreference;

// Volume
window.setVolume = setVolume;
window.toggleMute = toggleMute;
window.setPlayMode = setPlayMode;
window.showSelect = showSelect;

// Lyrics
window.toggleLyrics = toggleLyrics;

// Favorites & Lists
window.toggleFavorites = toggleFavorites;
window.handleFavoritesClick = handleFavoritesClick;
window.handleListClick = handleListClick;
window.handleCreateList = handleCreateList;
window.handleRefreshList = handleRefreshList;
window.handleJumpToOriginalList = handleJumpToOriginalList;
window.handleRemoveList = handleRemoveList;
window.toggleLove = toggleLove;

// Sync functions
window.switchSyncMode = switchSyncMode;
window.handleLocalLogin = handleLocalLogin;
window.handleSyncLogout = handleSyncLogout;
window.resetAllSettings = resetAllSettings;
window.handleRemoteConnect = handleRemoteConnect;
window.handleRemoteStep1 = handleRemoteStep1;
window.handleRemoteBack = handleRemoteBack;
window.selectSyncMode = selectSyncMode;
window.cancelSyncMode = cancelSyncMode;
window.closeSyncModal = closeSyncModal;

// Comment functions
window.toggleCommentModal = toggleCommentModal;
window.switchCommentType = switchCommentType;
window.refreshComments = refreshComments;
window.fetchComments = fetchComments;
window.checkServerCache = checkServerCache;


// [Redundant block removed]

// ========================================
// UI Helper Functions (Toast Notifications)
// ========================================

/**
 * 弹出选择/确认对话框 (showSelect)
 * @param {string} title 标题
 * @param {string} message 内容
 * @param {object} options 配置 (confirmText, cancelText, danger)
 * @returns {Promise<boolean>}
 */
// 确认弹窗
/**
 * 弹出输入对话框 (showInput)
 * @param {string} title 标题
 * @param {string} message 提示信息
 * @param {object} options 配置 (placeholder, defaultValue, confirmText, cancelText)
 * @returns {Promise<string | null>}
 */
function showInput(title, message, options = {}) {
    const {
        placeholder = '请输入内容...',
        defaultValue = '',
        confirmText = '确定',
        cancelText = '取消',
        confirmColor = 'bg-emerald-500',
        inputType = 'text'
    } = options;

    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = "fixed inset-0 z-[200] flex items-center justify-center p-4 animate-fade-in";
        modal.innerHTML = `
            <div class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"></div>
            <div class="t-bg-panel rounded-xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all animate-slide-up relative z-10 border t-border-main">
                <!-- Header -->
                <div class="px-5 py-4 border-b border-emerald-100/50 flex justify-between items-center bg-emerald-50/50">
                    <h3 class="text-sm font-bold t-text-main">${title}</h3>
                    <button id="modal-close-x" class="t-text-muted hover:text-emerald-500 transition-colors">
                        <i class="fas fa-times text-lg"></i>
                    </button>
                </div>
                <!-- Body -->
                <div class="p-6">
                    <div class="flex items-start gap-4 mb-4">
                        <div class="w-10 h-10 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center shrink-0">
                            <i class="fas fa-edit text-lg"></i>
                        </div>
                        <div class="flex-1">
                            <p class="text-sm t-text-muted leading-relaxed mb-4">${message}</p>
                            <input type="${inputType}" id="modal-input" 
                                class="w-full px-4 py-2.5 t-bg-main border t-border-main rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm"
                                placeholder="${placeholder}" value="${defaultValue}">
                        </div>
                    </div>
                </div>
                <!-- Footer -->
                <div class="p-4 t-bg-main/50 border-t t-border-main/50 flex gap-3 flex-row-reverse">
                    <button id="confirm-ok" class="flex-1 py-2.5 text-sm font-bold text-white ${confirmColor} hover:opacity-90 rounded-xl shadow-lg transition-all active:scale-95">
                        ${confirmText}
                    </button>
                    <button id="confirm-cancel" class="flex-1 py-2.5 text-sm font-bold t-text-muted hover:t-text-main hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-all">
                        ${cancelText}
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const input = modal.querySelector('#modal-input');
        input.focus();
        if (defaultValue) input.select();

        const close = (result) => {
            const content = modal.querySelector('.max-w-sm');
            if (content) {
                content.classList.add('scale-95', 'opacity-0');
            }
            modal.classList.add('opacity-0');
            setTimeout(() => {
                modal.remove();
                resolve(result);
            }, 200);
        };

        modal.querySelector('#confirm-ok').onclick = () => close(input.value.trim() || null);
        modal.querySelector('#confirm-cancel').onclick = () => close(null);
        modal.querySelector('#modal-close-x').onclick = () => close(null);
        modal.querySelector('div:first-child').onclick = () => close(null);

        input.onkeydown = (e) => {
            if (e.key === 'Enter') close(input.value.trim() || null);
            if (e.key === 'Escape') close(null);
        };
    });
}


//确认弹窗
function showSelect(title, message, options = {}) {
    const {
        confirmText = '确定',
        cancelText = '取消',
        confirmColor = 'bg-emerald-500',
        danger = false
    } = options;

    const btnColor = danger ? 'bg-red-500 hover:bg-red-600 shadow-red-100' : `${confirmColor} hover:opacity-90 shadow-emerald-100`;

    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = "fixed inset-0 z-[200] flex items-center justify-center p-4 animate-fade-in";
        modal.innerHTML = `
            <div class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"></div>
            <div class="t-bg-panel rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all animate-slide-up relative z-10 border t-border-main">
                <!-- Header -->
                <div class="px-5 py-4 border-b border-emerald-100/50 flex justify-between items-center bg-emerald-50/50">
                    <h3 class="text-sm font-bold t-text-main">${title}</h3>
                    <button id="modal-close-x" class="t-text-muted hover:text-emerald-500 transition-colors">
                        <i class="fas fa-times text-lg"></i>
                    </button>
                </div>
                <!-- Body -->
                <div class="p-6">
                    <div class="flex items-start gap-4">
                        <div class="w-10 h-10 rounded-full ${danger ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-500'} flex items-center justify-center shrink-0">
                            <i class="fas ${danger ? 'fa-exclamation-triangle' : 'fa-question-circle'} text-lg"></i>
                        </div>
                        <div class="flex-1">
                            <p class="text-sm t-text-muted leading-relaxed">${message}</p>
                        </div>
                    </div>
                </div>
                <!-- Footer -->
                <div class="p-4 t-bg-main/50 border-t t-border-main/50 flex gap-3 flex-row-reverse">
                    <button id="confirm-ok" class="flex-1 py-2.5 text-sm font-bold text-white ${btnColor} rounded-xl shadow-lg transition-all active:scale-95">
                        ${confirmText}
                    </button>
                    <button id="confirm-cancel" class="flex-1 py-2.5 text-sm font-bold t-text-muted hover:t-text-main hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-all">
                        ${cancelText}
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const close = (result) => {
            const content = modal.querySelector('.max-w-sm');
            if (content) {
                content.classList.add('scale-95', 'opacity-0');
            }
            modal.classList.add('opacity-0');
            setTimeout(() => {
                modal.remove();
                resolve(result);
            }, 200);
        };

        modal.querySelector('#confirm-ok').onclick = () => close(true);
        modal.querySelector('#confirm-cancel').onclick = () => close(false);
        modal.querySelector('#modal-close-x').onclick = () => close(false);
        modal.querySelector('div:first-child').onclick = () => close(false);
    });
}

/**
 * 通用多选选择列表
 */
function showOptions(title, message, options = []) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = "fixed inset-0 z-[200] flex items-center justify-center p-4 animate-fade-in";

        const optionsHtml = options.map(opt => `
            <button class="w-full text-left px-4 py-3.5 t-text-main hover:bg-emerald-500 hover:text-white transition-all rounded-xl font-bold text-sm flex items-center justify-between group" data-value="${opt}">
                <span>${opt}</span>
                <i class="fas fa-chevron-right text-[10px] opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all"></i>
            </button>
        `).join('');

        modal.innerHTML = `
            <div class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"></div>
            <div class="t-bg-panel rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all animate-slide-up relative z-10 border t-border-main">
                <div class="px-5 py-4 border-b border-emerald-100/50 flex justify-between items-center bg-emerald-50/50">
                    <h3 class="text-sm font-bold t-text-main">${title}</h3>
                    <button id="opt-close-x" class="t-text-muted hover:text-emerald-500 transition-colors">
                        <i class="fas fa-times text-lg"></i>
                    </button>
                </div>
                <div class="p-3">
                    <p class="px-3 py-2 text-xs t-text-muted mb-2 font-medium">${message}</p>
                    <div class="max-h-[60vh] overflow-y-auto custom-scrollbar space-y-1">
                        ${optionsHtml}
                    </div>
                </div>
            </div>
        `;

        const close = (result) => {
            const content = modal.querySelector('.max-w-sm');
            if (content) {
                content.classList.add('scale-95', 'opacity-0');
            }
            modal.classList.add('opacity-0');
            setTimeout(() => {
                modal.remove();
                resolve(result);
            }, 200);
        };

        modal.querySelectorAll('button[data-value]').forEach(btn => {
            btn.onclick = () => close(btn.getAttribute('data-value'));
        });

        modal.querySelector('#opt-close-x').onclick = () => close(null);
        modal.querySelector('div:first-child').onclick = () => close(null);

        document.body.appendChild(modal);
    });
}
window.showOptions = showOptions;

/**
 * 播放栏下载/缓存按钮点击处理
 */
async function handleDownloadClick(event) {
    if (event) event.stopPropagation();

    if (!currentPlayingSong) {
        showInfo('当前没有正在播放的歌曲');
        return;
    }

    const song = currentPlayingSong;

    // [优化] 检测是否已缓存
    const prefQuality = window.settings?.preferredQuality || 'flac';
    const checkResult = await window.checkServerCache?.(song, prefQuality);
    const cacheSuffix = (checkResult?.exists && !checkResult?.isCollision) ? ' (已缓存)' : '';

    const isOnlyDownload = window.settings?.enableOnlyDownloadMode === true;
    const actionLabel = isOnlyDownload ? '下载到服务器' : '缓存到服务器';
    const options = ['浏览器下载', `${actionLabel}${cacheSuffix}`];
    const modeText = isOnlyDownload ? '仅下载模式' : '缓存模式';
    const selected = await showOptions('下载与缓存', `[${modeText}] 选择对 [${song.name}] 的操作：`, options);
    if (!selected) return;

    // 选中操作后的权限拦截校验
    const isPublic = !isUserLoggedIn() || window.currentListData?.username === 'default' || window.currentListData?.username === '_open';
    const enablePublicRestriction = window.lx_config?.['user.enablePublicRestriction'];
    const isAdmin = !!localStorage.getItem('lx_admin_password');

    if (selected === '浏览器下载') {
        const isBrowserDownloadAllowed = window.lx_config?.['user.enablePublicNonAdminBrowserDownload'] !== false;
        if (isPublic && enablePublicRestriction && !isBrowserDownloadAllowed && !isAdmin) {
            showError('权限限制：管理员已关闭非管理员浏览器下载功能，下载歌曲需要验证管理员身份。');
            if (typeof window.handleAdminAuth === 'function') {
                const authorized = await window.handleAdminAuth('管理员已关闭非管理员浏览器下载功能，下载歌曲需要验证管理员身份');
                if (!authorized) return;
            } else {
                return;
            }
        }

        if (typeof downloadSong === 'function') {
            downloadSong(song, null, false, '浏览器下载');
        } else {
            showError('下载功能未就绪');
        }
    } else if (selected && (selected.startsWith('缓存到服务器') || selected.startsWith('下载到服务器'))) {
        const isServerCacheAllowed = window.lx_config?.['user.enablePublicNonAdminServerCache'] !== false;
        if (isPublic && enablePublicRestriction && !isServerCacheAllowed && !isAdmin) {
            showError('权限限制：管理员已关闭非管理员服务器缓存功能，缓存歌曲需要验证管理员身份。');
            if (typeof window.handleAdminAuth === 'function') {
                const authorized = await window.handleAdminAuth('管理员已关闭非管理员服务器缓存功能，缓存歌曲需要验证管理员身份');
                if (!authorized) return;
            } else {
                return;
            }
        }

        const isCached = checkResult?.exists && !checkResult?.isCollision;
        if (!isOnlyDownload && isCached) {
            showInfo('该歌曲已在服务器缓存');
            return;
        }

        if (typeof downloadSong === 'function') {
            downloadSong(song, null, false, actionLabel);
        } else {
            showError('服务器缓存逻辑未就绪');
        }
    }
}

// ========================================
// 换源与降级故障恢复 - 常驻实时试错状态 Toast
// ========================================
const RecoveryToast = {
    el: null,
    hideTimer: null,
    currentSong: null,
    currentStatus: 'loading', // 'loading' | 'success' | 'error'
    triedHistory: [], // 记录本次试错轨迹：[{ platform, platformName, qualityName, status }]

    init() {
        if (!document.getElementById('recovery-toast-keyframes')) {
            const style = document.createElement('style');
            style.id = 'recovery-toast-keyframes';
            style.textContent = `
                @keyframes recoveryProgressFlow {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(350%); }
                }
                .animate-recovery-flow {
                    animation: recoveryProgressFlow 1.6s infinite ease-in-out;
                }
            `;
            document.head.appendChild(style);
        }

        let container = document.getElementById('recovery-status-toast');
        if (!container) {
            container = document.createElement('div');
            container.id = 'recovery-status-toast';
            container.className = 'fixed right-4 bottom-24 md:bottom-28 z-[1005] w-80 md:w-96 max-w-[92vw] rounded-2xl shadow-2xl border transition-all duration-300 transform translate-y-4 opacity-0 pointer-events-auto overflow-hidden flex flex-col backdrop-blur-md bg-white/95 dark:bg-gray-900/95 text-gray-800 dark:text-gray-100 border-emerald-500/40 shadow-emerald-500/10 dark:border-emerald-500/40 dark:shadow-black/60';
            document.body.appendChild(container);
        }
        this.el = container;
        return this.el;
    },

    // 清理底层露出的普通播放类 toast
    cleanupConflictingToasts() {
        try {
            document.querySelectorAll('.toast-item').forEach(el => {
                const text = el.textContent || '';
                if (text.includes('解析') || text.includes('加载') || text.includes('命中') || text.includes('播放') || text.includes('降级') || text.includes('备选源') || text.includes('换源')) {
                    el.remove();
                }
            });
        } catch (e) { }
    },

    show(song, message, details = {}) {
        this.init();
        this.cleanupConflictingToasts();
        this.currentStatus = 'loading';

        if (this.hideTimer) {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }

        const songName = song?.name || this.currentSong?.name || '未知歌曲';
        const singerName = song?.singer || this.currentSong?.singer || '';

        if (this.currentSong?.name !== songName) {
            this.currentSong = song;
            this.triedHistory = [];
        }

        if (details.triedPlatform) {
            const platformName = typeof getSourceName === 'function' ? getSourceName(details.triedPlatform) : details.triedPlatform.toUpperCase();
            const qualityName = details.quality && window.QualityManager ? window.QualityManager.getQualityDisplayName(details.quality) : '';
            const key = `${details.triedPlatform}_${details.quality || ''}`;
            const existing = this.triedHistory.find(item => item.key === key);
            if (!existing) {
                this.triedHistory.push({
                    key,
                    platform: details.triedPlatform,
                    platformName,
                    qualityName,
                    status: details.status || 'trying'
                });
            } else if (details.status) {
                existing.status = details.status;
            }
        }

        // 生成试错历史脚印标签 (完全适配明亮/暗黑模式与主题色)
        let historyHtml = '';
        if (this.triedHistory.length > 0) {
            historyHtml = `
                <div class="flex flex-wrap items-center gap-1 mt-1 text-[11px]">
                    <span class="text-gray-400 dark:text-gray-500 text-[10px]">尝试轨迹:</span>
                    ${this.triedHistory.map((item) => {
                if (item.status === 'failed') {
                    return `<span class="px-1.5 py-0.5 rounded bg-red-50 text-red-500 border border-red-200 dark:bg-red-500/20 dark:text-red-300 dark:border-red-500/30 line-through text-[10px]">${item.platformName}</span>`;
                } else if (item.status === 'success') {
                    return `<span class="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/30 font-bold text-[10px]">${item.platformName}</span>`;
                }
                return `<span class="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/30 font-medium animate-pulse text-[10px]">${item.platformName}</span>`;
            }).join('<span class="text-gray-300 dark:text-gray-600 text-[10px]">➔</span>')}
                </div>
            `;
        }

        // 样式：完全使用语义化主题类，自适应 Light / Dark 与当前主题色 (emerald/blue/amber/violet/rose)
        this.el.className = 'fixed right-4 bottom-24 md:bottom-28 z-[1005] w-80 md:w-96 max-w-[92vw] rounded-2xl shadow-2xl border transition-all duration-300 transform translate-y-0 opacity-100 pointer-events-auto overflow-hidden flex flex-col backdrop-blur-md bg-white/95 dark:bg-gray-900/95 text-gray-800 dark:text-gray-100 border-emerald-500/40 shadow-emerald-500/10 dark:border-emerald-500/40 dark:shadow-black/60';

        this.el.innerHTML = `
            <div class="p-3.5 flex flex-col gap-1.5">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <div class="w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 flex items-center justify-center text-xs">
                            <i class="fas fa-sync-alt fa-spin"></i>
                        </div>
                        <span class="text-xs font-bold text-emerald-600 dark:text-emerald-400">正在智能换源播放...</span>
                    </div>
                    <button onclick="RecoveryToast.dismiss()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1 rounded-lg">
                        <i class="fas fa-times text-xs"></i>
                    </button>
                </div>
                <div class="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate" title="${songName}">
                    《${songName}》<span class="text-gray-400 dark:text-gray-500 text-[11px] font-normal">${singerName ? ' - ' + singerName : ''}</span>
                </div>
                <div class="text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5 mt-0.5">
                    <span class="w-2 h-2 rounded-full bg-emerald-500 animate-ping shrink-0"></span>
                    <span class="truncate font-medium recovery-message-text">${message}</span>
                </div>
                ${historyHtml}
            </div>
            <div class="h-0.5 w-full bg-emerald-500/10 dark:bg-emerald-500/20 overflow-hidden">
                <div class="h-full bg-emerald-500 w-1/3 animate-recovery-flow"></div>
            </div>
        `;
    },

    updateStatusText(msg) {
        if (!this.el || !this.isActive()) return;
        const textEl = this.el.querySelector('.recovery-message-text');
        if (textEl) {
            textEl.textContent = msg;
        }
    },

    markStepFailed(platform, quality) {
        if (!platform) return;
        const key = `${platform}_${quality || ''}`;
        let item = this.triedHistory.find(i => i.key === key);
        if (!item) {
            item = this.triedHistory.find(i => i.platform === platform);
        }
        if (item) {
            item.status = 'failed';
        }
    },

    success(message) {
        if (!this.el || !document.body.contains(this.el) || this.el.classList.contains('opacity-0')) return;
        this.currentStatus = 'success';
        this.cleanupConflictingToasts();

        if (this.triedHistory.length > 0) {
            this.triedHistory[this.triedHistory.length - 1].status = 'success';
        }

        const songName = this.currentSong?.name || '当前歌曲';

        // 成功状态自适应明暗模式与主题色
        this.el.className = 'fixed right-4 bottom-24 md:bottom-28 z-[1005] w-80 md:w-96 max-w-[92vw] rounded-2xl shadow-2xl border transition-all duration-300 transform translate-y-0 opacity-100 pointer-events-auto overflow-hidden flex flex-col backdrop-blur-md bg-emerald-50/95 dark:bg-emerald-950/90 text-emerald-950 dark:text-emerald-100 border-emerald-400/80 dark:border-emerald-500/60 shadow-emerald-500/20';

        this.el.innerHTML = `
            <div class="p-3.5 flex flex-col gap-1.5">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <div class="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs shadow-sm">
                            <i class="fas fa-check"></i>
                        </div>
                        <span class="text-xs font-bold text-emerald-700 dark:text-emerald-300">换源成功</span>
                    </div>
                    <button onclick="RecoveryToast.dismiss()" class="text-emerald-600/70 hover:text-emerald-800 dark:text-emerald-400/70 dark:hover:text-emerald-200 transition-colors p-1 rounded-lg">
                        <i class="fas fa-times text-xs"></i>
                    </button>
                </div>
                <div class="text-xs text-gray-800 dark:text-gray-100 truncate font-semibold">
                    《${songName}》
                </div>
                <div class="text-xs text-emerald-700 dark:text-emerald-300 font-medium flex items-center gap-1.5">
                    <i class="fas fa-play-circle text-emerald-600 dark:text-emerald-400"></i>
                    <span>${message}</span>
                </div>
            </div>
        `;

        if (this.hideTimer) clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => {
            this.dismiss();
        }, 2800);
    },

    error(message) {
        if (!this.el || !document.body.contains(this.el)) return;
        this.currentStatus = 'error';
        this.cleanupConflictingToasts();

        const songName = this.currentSong?.name || '当前歌曲';

        // 失败状态自适应明暗模式
        this.el.className = 'fixed right-4 bottom-24 md:bottom-28 z-[1005] w-80 md:w-96 max-w-[92vw] rounded-2xl shadow-2xl border transition-all duration-300 transform translate-y-0 opacity-100 pointer-events-auto overflow-hidden flex flex-col backdrop-blur-md bg-red-50/95 dark:bg-red-950/95 text-red-900 dark:text-red-100 border-red-300 dark:border-red-500/40 shadow-red-500/10';

        this.el.innerHTML = `
            <div class="p-3.5 flex flex-col gap-1.5">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <div class="w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center text-xs shadow-sm">
                            <i class="fas fa-times"></i>
                        </div>
                        <span class="text-xs font-bold text-red-600 dark:text-red-400">换源失败</span>
                    </div>
                    <button onclick="RecoveryToast.dismiss()" class="text-red-400 hover:text-red-600 dark:hover:text-white transition-colors p-1 rounded-lg">
                        <i class="fas fa-times text-xs"></i>
                    </button>
                </div>
                <div class="text-xs text-gray-800 dark:text-gray-100 truncate font-semibold">
                    《${songName}》
                </div>
                <div class="text-xs text-red-600 dark:text-red-300 font-medium">
                    ${message}
                </div>
            </div>
        `;

        if (this.hideTimer) clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => {
            this.dismiss();
        }, 3200);
    },

    dismiss() {
        if (!this.el) return;
        if (this.hideTimer) {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
        this.el.classList.remove('opacity-100', 'translate-y-0');
        this.el.classList.add('opacity-0', 'translate-y-4');
        setTimeout(() => {
            if (this.el && this.el.parentNode) {
                this.el.parentNode.removeChild(this.el);
            }
            this.el = null;
            this.currentSong = null;
            this.triedHistory = [];
            this.currentStatus = 'loading';
        }, 300);
    },

    isActive() {
        return !!(this.el && !this.el.classList.contains('opacity-0'));
    }
};
window.RecoveryToast = RecoveryToast;

// 通用 Toast 显示函数 (支持宽屏、滚动文字、点击重置倒计时、动态堆叠)
function showToast(type, message, duration = 3000) {
    // 如果常驻试错换源 Toast 处于活跃状态，禁止歌曲解析/加载/降级/换源类提示弹出覆盖底层
    if (typeof RecoveryToast !== 'undefined' && RecoveryToast.isActive()) {
        const suppressKeywords = ['解析成功', '解析失败', '正在加载', '正在为您重新', '命中', '降级', '换源', '备选源', '播放失败'];
        if (suppressKeywords.some(kw => typeof message === 'string' && message.includes(kw))) {
            return;
        }
    }

    const config = {
        success: { bg: 'bg-emerald-500', icon: 'fa-check-circle' },
        info: { bg: 'bg-blue-500', icon: 'fa-info-circle' },
        error: { bg: 'bg-red-500', icon: 'fa-exclamation-circle' }
    };
    const conf = config[type] || config.info;

    const toast = document.createElement('div');
    // 添加 toast-item 类用于后续高度计算
    toast.className = `toast-item fixed right-4 ${conf.bg} text-white px-4 py-3 rounded-lg shadow-lg z-[1000] animate-slide-in flex items-center gap-3 w-80 md:w-96 max-w-[90vw] cursor-pointer transition-all duration-300`;

    // 使用通用跑马灯逻辑，自动检测文字是否超出容器宽度
    const contentHtml = createMarqueeHtml(message, 'flex-1 font-medium');

    toast.innerHTML = `
        <i class="fas ${conf.icon} text-xl shrink-0"></i>
        ${contentHtml}
    `;

    // 避让常驻 Toast，如果 RecoveryToast 存在则向上偏移，防止层叠
    const isRecoveryActive = typeof RecoveryToast !== 'undefined' && RecoveryToast.isActive();
    const bottomBase = isRecoveryActive ? 220 : 96;
    const gap = 12;

    toast.style.visibility = 'hidden';
    document.body.appendChild(toast);

    // 触发动态滚动检测
    applyMarqueeChecks();

    const toastHeight = toast.offsetHeight || 60;
    const shiftAmt = toastHeight + gap;

    document.querySelectorAll('.toast-item').forEach(el => {
        if (el === toast) return;
        const oldB = parseFloat(el.style.bottom || bottomBase);
        const newB = oldB + shiftAmt;
        el.style.bottom = `${newB}px`;
        el.dataset.offset = newB;
    });

    toast.style.bottom = `${bottomBase}px`;
    toast.dataset.offset = bottomBase;
    toast.style.visibility = 'visible';

    let hideTimer = null;

    const startTimer = () => {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            toast.classList.add('opacity-0', 'translate-y-4');
            setTimeout(() => {
                const h = toast.offsetHeight + gap;
                toast.remove();
                document.querySelectorAll('.toast-item').forEach(el => {
                    const elB = parseFloat(el.style.bottom || 0);
                    if (elB > parseFloat(toast.dataset.offset)) {
                        const newB = elB - h;
                        el.style.bottom = `${newB}px`;
                        el.dataset.offset = newB;
                    }
                });
            }, 300);
        }, duration);
    };

    startTimer();

    // 点击事件: 重新计时 (用户请求: 点击了那个信息就重新计时隐藏)
    toast.addEventListener('click', () => {
        // 视觉反馈
        toast.classList.add('scale-[1.02]', 'brightness-110');
        setTimeout(() => toast.classList.remove('scale-[1.02]', 'brightness-110'), 150);

        // 重置计时器
        startTimer();
        console.log('[Toast] Timer reset by click');
    });

    // 鼠标悬停暂停计时 (优化体验)
    toast.addEventListener('mouseenter', () => {
        if (hideTimer) clearTimeout(hideTimer);
    });

    toast.addEventListener('mouseleave', () => {
        startTimer();
    });
}

// 封装旧 API
function showSuccess(message) { showToast('success', message, 2000); }
function showInfo(message) { showToast('info', message, 2000); }
function showError(message) { showToast('error', message, 2000); }

/**
 * 全局加载提示 (showLoading)
 */
function showLoading(message = '正在处理...') {
    if (document.getElementById('global-loading-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'global-loading-overlay';
    overlay.className = "fixed inset-0 z-[200] flex items-center justify-center p-4 animate-fade-in";
    overlay.innerHTML = `
        <div class="absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-300"></div>
        <div class="t-bg-panel rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-4 relative z-[210] border t-border-main animate-slide-up">
            <div class="relative">
                <div class="w-12 h-12 rounded-full border-4 border-emerald-100 border-t-emerald-500 animate-spin"></div>
                <i class="fas fa-music text-emerald-500 absolute inset-0 flex items-center justify-center text-xs"></i>
            </div>
            <p class="text-sm font-bold t-text-main animate-pulse">${message}</p>
        </div>
    `;
    document.body.appendChild(overlay);
}

function hideLoading() {
    const overlay = document.getElementById('global-loading-overlay');
    if (overlay) {
        overlay.classList.add('opacity-0');
        const content = overlay.querySelector('.t-bg-panel');
        if (content) content.classList.add('scale-95');
        setTimeout(() => overlay.remove(), 300);
    }
}
window.showLoading = showLoading;
window.hideLoading = hideLoading;

// 清除所有当前显示的 Toast
function dismissAllToasts() {
    const toasts = document.querySelectorAll('.toast-item');
    toasts.forEach(toast => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    });
}
window.dismissAllToasts = dismissAllToasts;


// ========================================
// Sleep Timer Logic
// ========================================

let sleepTimerId = null;
let sleepTimerEnd = 0;

function openSleepTimerModal() {
    const modal = document.getElementById('sleep-timer-modal');
    const content = document.getElementById('sleep-timer-modal-content');
    if (!modal || !content) return;

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    // Trigger animation
    requestAnimationFrame(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    });

    updateSleepTimerModalUI();
}

function closeSleepTimerModal() {
    const modal = document.getElementById('sleep-timer-modal');
    const content = document.getElementById('sleep-timer-modal-content');
    if (!modal || !content) return;

    content.classList.add('scale-95', 'opacity-0');
    content.classList.remove('scale-100', 'opacity-100');

    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 300);
}

function setSleepTimer(minutes) {
    cancelSleepTimer();
    const durationMs = minutes * 60 * 1000;
    sleepTimerEnd = Date.now() + durationMs;

    startSleepTimerLoop();
    closeSleepTimerModal();
    showSuccess(`已设置 ${minutes} 分钟后停止播放`);
}

function cancelSleepTimer() {
    if (sleepTimerId) {
        clearInterval(sleepTimerId);
        sleepTimerId = null;
    }
    sleepTimerEnd = 0;

    const countdown = document.getElementById('sleep-timer-countdown');
    const triggerIcon = document.querySelector('#sleep-timer-trigger i');
    const activeStatus = document.getElementById('active-timer-status');

    if (countdown) countdown.classList.add('hidden');
    if (activeStatus) activeStatus.classList.add('hidden');
    if (triggerIcon) {
        triggerIcon.classList.replace('fas', 'far');
        triggerIcon.classList.remove('text-emerald-500');
    }
}

function startSleepTimerLoop() {
    const countdown = document.getElementById('sleep-timer-countdown');
    const triggerIcon = document.querySelector('#sleep-timer-trigger i');

    if (countdown) countdown.classList.remove('hidden');
    if (triggerIcon) {
        triggerIcon.classList.replace('far', 'fas');
        triggerIcon.classList.add('text-emerald-500');
    }

    updateSleepTimerDisplay();
    sleepTimerId = setInterval(() => {
        updateSleepTimerDisplay();
    }, 1000);
}

function updateSleepTimerDisplay() {
    const now = Date.now();
    const remain = sleepTimerEnd - now;

    if (remain <= 0) {
        finishSleepTimer();
        return;
    }

    const minutes = Math.floor(remain / 60000);
    const seconds = Math.floor((remain % 60000) / 1000);
    const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    const countdown = document.getElementById('sleep-timer-countdown');
    const statusCountdown = document.getElementById('status-countdown');

    if (countdown) countdown.innerText = timeStr;
    if (statusCountdown) statusCountdown.innerText = timeStr;
}

function finishSleepTimer() {
    cancelSleepTimer();
    // Use audio.pause directly or togglePlay if music is active
    if (audio && !audio.paused) {
        shouldAutoRecoverPlayback = false;
        audio.pause();
        updatePlayButton(false);
        showInfo('睡眠时间到，音乐已停止播放 🌙');
    }
}

function updateSleepTimerModalUI() {
    const activeStatus = document.getElementById('active-timer-status');
    const customInput = document.getElementById('custom-timer-input');

    if (activeStatus) {
        if (sleepTimerEnd > Date.now()) {
            activeStatus.classList.remove('hidden');
        } else {
            activeStatus.classList.add('hidden');
        }
    }
    if (customInput) customInput.classList.add('hidden');
}

function showCustomTimerInput() {
    const input = document.getElementById('custom-timer-input');
    if (input) input.classList.remove('hidden');
}

function applyCustomTimer() {
    const inputEl = document.getElementById('custom-minutes');
    const val = parseInt(inputEl.value);
    if (val > 0) {
        setSleepTimer(val);
        inputEl.value = '';
    } else {
        showError('请输入正确的时间（分钟）');
    }
}

// 监听模态框外部点击关闭
document.addEventListener('mousedown', (e) => {
    const modal = document.getElementById('sleep-timer-modal');
    const content = document.getElementById('sleep-timer-modal-content');
    if (modal && !modal.classList.contains('hidden') && e.target === modal) {
        closeSleepTimerModal();
    }
});

// 监听窗口大小变化
window.addEventListener('resize', () => {
    const indicator = document.getElementById('lyric-scroll-indicator');
    if (indicator) {
        indicator.dataset.positioned = '';
    }
});

// ========== 页面初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Init] 页面加载完成');

    // 预加载自定义源数据，确保设置界面和模态框打开时有数据
    loadCustomSources();

    // [优化] 此处不再立即调用 showInitialSearchState()，移至下方的 setTimeout 中

    // [Fix] Listen to scroll event for real-time highlighting
    const lyricContainer = document.getElementById('lyric-container');
    if (lyricContainer) {
        // Core user interaction detection
        // 只有当用户真的 "摸" 了或者是 "滑" 了，才认为是用户滚动
        // 纯 scroll 事件会被 scrollTo 触发，所以不能仅依赖 scroll 事件来 *启动* 手动模式
        const setUserInteracting = () => {
            // 强制清除程序滚动标记，因为用户干预了
            isProgrammaticScroll = false;
            if (window.programmaticScrollTimer) {
                clearTimeout(window.programmaticScrollTimer);
                window.programmaticScrollTimer = null;
            }
        };

        lyricContainer.addEventListener('mousedown', setUserInteracting, { passive: true });
        lyricContainer.addEventListener('touchstart', setUserInteracting, { passive: true });
        lyricContainer.addEventListener('touchmove', setUserInteracting, { passive: true });
        lyricContainer.addEventListener('wheel', setUserInteracting, { passive: true });
        lyricContainer.addEventListener('keydown', setUserInteracting, { passive: true }); // Keyboard arrow keys

        // 使用 passive: true 提高滚动性能
        lyricContainer.addEventListener('scroll', handleLyricScroll, { passive: true });
    }

    // 绑定音质选择
    const qualitySelect = document.getElementById('quality-select');
    if (qualitySelect && settings.preferredQuality) {
        qualitySelect.value = settings.preferredQuality;
    }

    // [优化] 延迟执行非关键初始化逻辑（设置恢复、状态重置、自动登录等）
    // 允许浏览器先完成主要的渲染和 load 事件，释放 PWA 安装按钮并显示刷新图标
    setTimeout(() => {
        console.log('[Init] 启动后台初始化任务...');
        loadSettings();
        restorePlaybackState();

        // [新增] 延迟显示热搜，避免启动请求堆积
        if (typeof showInitialSearchState === 'function') {
            showInitialSearchState();
        }

        // 监听源切换，自动刷新热搜
        const searchSourceSelect = document.getElementById('search-source');
        if (searchSourceSelect) {
            searchSourceSelect.addEventListener('change', () => {
                const searchInput = document.getElementById('search-input');
                // 仅当搜索框为空（即处于显示热搜状态）时刷新
                if (!searchInput || !searchInput.value.trim()) {
                    showInitialSearchState();
                }
            });
        }

        // [Fix] Auto-Login logic (Restore Session)
        const savedMode = localStorage.getItem('lx_sync_mode');
        if (savedMode === 'local') {
            const u = localStorage.getItem('lx_sync_user');
            const p = localStorage.getItem('lx_sync_pass');
            if (u && p) {
                // [优化] 如果已经有有效的 Token，不再重复登录
                if (userToken) {
                    console.log('[AutoLogin] 检测到有效 Token，跳过自动登录流程并直接恢复会话。');
                    return;
                }

                console.log('[AutoLogin] 检测到本地账户且无有效 Token，正在自动登录...');
                // Fill UI
                const uInput = document.getElementById('sync-local-user');
                const pInput = document.getElementById('sync-local-pass');
                if (uInput) uInput.value = u;
                if (pInput) pInput.value = p;
                // Trigger login
                handleLocalLogin();
            }
        } else if (savedMode === 'remote') {
            const url = localStorage.getItem('lx_sync_url');
            const code = localStorage.getItem('lx_sync_code');
            if (url && code) {
                console.log('[AutoLogin] 检测到远程同步设置，正在自动连接...');
                // Fill UI
                const remoteUrlInput = document.getElementById('sync-remote-url');
                const remoteStep1 = document.getElementById('sync-remote-step1');
                const remoteStep2 = document.getElementById('sync-remote-step2');
                const remoteCodeInput = document.getElementById('sync-remote-code');

                if (remoteUrlInput) remoteUrlInput.value = url;
                if (remoteStep1) remoteStep1.classList.add('hidden');
                if (remoteStep2) remoteStep2.classList.remove('hidden');
                if (remoteCodeInput) remoteCodeInput.value = code;

                // Trigger connect
                handleRemoteConnect();
            }
        }
    }, 100);

    // [New] 全局精简播放栏控制函数
    window.setCompactPlaybar = function (compact, showToastMsg = false) {
        const infoEl = document.getElementById('player-song-info');
        const collapseBtn = document.getElementById('btn-collapse-panel');
        if (!infoEl) return;

        if (compact) {
            infoEl.style.display = 'none';
            if (collapseBtn) collapseBtn.style.display = 'none';
            if (showToastMsg) showToast('info', '已开启精简播放控制栏', 1500);
        } else {
            infoEl.style.display = '';
            if (collapseBtn) collapseBtn.style.display = '';
            if (showToastMsg) showToast('info', '已恢复完整播放栏控制', 1500);
        }

        // 重新计算并应用底栏自适应布局高度 (解决手机端 Footer 高度重叠)
        if (window.musicVisualizer && window.musicVisualizer.applySettings) {
            setTimeout(() => window.musicVisualizer.applySettings(), 50);
        }
    };

    // [New] 长按播放键隐藏播放栏内容 (精简模式)
    const btnPlay = document.getElementById('btn-play');
    if (btnPlay) {
        let pressTimer;
        const infoEl = document.getElementById('player-song-info');

        const startPress = (e) => {
            if (e.type === 'mousedown' && e.button !== 0) return; // 仅限左键
            window.playBtnIsLongPress = false;
            pressTimer = setTimeout(() => {
                window.playBtnIsLongPress = true;
                if (navigator.vibrate) navigator.vibrate(50);

                if (infoEl) {
                    const isHidden = infoEl.style.display === 'none';
                    window.setCompactPlaybar(!isHidden, true);
                }
            }, 600); // 600ms = 长按
        };

        const cancelPress = () => {
            if (pressTimer) clearTimeout(pressTimer);
        };

        // 事件绑定
        btnPlay.addEventListener('mousedown', startPress);
        btnPlay.addEventListener('touchstart', startPress, { passive: true });
        btnPlay.addEventListener('mouseup', cancelPress);
        btnPlay.addEventListener('touchend', cancelPress);
        btnPlay.addEventListener('mouseleave', cancelPress);
        btnPlay.addEventListener('touchcancel', cancelPress);
    }
});

// ========================================
// Global Overrides
// ========================================

// Override batch_pagination.js helper to access local currentSearchScope
window.getCurrentActiveListId = function () {
    if (currentSearchScope === 'local_list') return window.currentViewingListId;
    if (currentSearchScope === 'local_all') return 'love';
    return null;
};



// ========================================
// Mobile Optimization Logic
// ========================================

// Mobile Sidebar Toggle
function toggleSidebar() {
    const sidebar = document.getElementById('main-sidebar');
    const backdrop = document.getElementById('mobile-sidebar-backdrop');

    if (sidebar.classList.contains('-translate-x-full')) {
        // Open
        sidebar.classList.remove('-translate-x-full');
        sidebar.classList.add('translate-x-0');
        backdrop.classList.remove('hidden');
    } else {
        // Close
        sidebar.classList.remove('translate-x-0');
        sidebar.classList.add('-translate-x-full');
        backdrop.classList.add('hidden');
    }
}

// Auto-adjust layout on resize
window.addEventListener('resize', () => {
    const sidebar = document.getElementById('main-sidebar');
    const backdrop = document.getElementById('mobile-sidebar-backdrop');

    if (sidebar && window.innerWidth >= 1025) {
        // Reset styles for desktop
        sidebar.classList.remove('-translate-x-full', 'translate-x-0');
        if (backdrop) backdrop.classList.add('hidden');
    } else if (sidebar) {
        // Ensure default closed state for mobile if not explicitly open
        if (!sidebar.classList.contains('translate-x-0')) {
            sidebar.classList.add('-translate-x-full');
        }
    }
});

// 切换详情页封面显示（移动端优化）
function toggleDetailCover() {
    const cover = document.getElementById('mobile-player-cover-container');
    const container = document.getElementById('player-detail-container');
    const lyricsWrapper = document.getElementById('lyrics-wrapper');
    const lyricContent = document.getElementById('lyric-content');
    const detailTitle = document.getElementById('detail-title');

    // 获取标题区域父容器
    const titleParent = lyricsWrapper ? lyricsWrapper.querySelector('div:first-child') : null;

    if (!cover || !container) return;

    // 根据 cover 的透明度状态判断当前是否隐藏
    const isHidden = cover.classList.contains('opacity-0');

    if (!isHidden) {
        // --- 隐藏封面 ---
        cover.style.display = 'none'; // 彻底移除渲染占位
        cover.classList.add('opacity-0', 'scale-90', 'border-0');

        // 隐藏封面时，不再需要那么大的 pt-8/md:pt-32。
        // 保留 md:pt-10 左右以避开顶部 Now Playing 即可，让歌词有更多纵向空间
        container.classList.remove('pt-8', 'mt-4', 'md:pt-0', 'md:pt-24');
        container.classList.add('pt-4', 'md:pt-10');

        if (lyricsWrapper) {
            lyricsWrapper.classList.remove('md:w-auto', 'md:max-w-[50%]', 'md:w-[500px]', 'lg:w-[600px]', 'flex-shrink-0');
            lyricsWrapper.classList.add('md:w-2/3', 'mx-auto', 'lyrics-centered');
            // 隐藏封面时允许歌词区域更高
            lyricsWrapper.style.maxHeight = '85vh';
        }

        if (lyricContent) {
            lyricContent.classList.remove('md:items-start', 'md:text-left', 'md:pl-6');
            lyricContent.classList.add('items-center', 'text-center');
        }

        if (titleParent) {
            titleParent.classList.remove('md:text-left', 'md:pl-6');
            titleParent.classList.add('text-center');
        }

        if (detailTitle) {
            detailTitle.classList.remove('md:mx-0');
            detailTitle.classList.add('mx-auto');
        }

        container.classList.add('has-centered-lyrics');

    } else {
        // --- 显示封面 ---
        cover.style.display = 'block'; // 恢复显示
        cover.classList.remove('opacity-0', 'scale-90', 'border-0');

        container.classList.remove('has-centered-lyrics');

        // 恢复当前使用的固定间距
        container.classList.add('gap-4', 'md:gap-20');
        container.classList.remove('pt-8', 'md:pt-32', 'md:pt-10'); // 移除纯歌词专用间距

        // 手机端恢复默认 pt
        if (window.innerWidth < 1025) {
            container.classList.add('pt-8', 'mt-4');
        }


        if (lyricsWrapper) {
            lyricsWrapper.classList.remove('md:w-auto', 'md:max-w-[50%]', 'md:w-2/3', 'mx-auto', 'lyrics-centered');
            // 锁定桌面端宽度，防止长短歌词导致封面抖动
            lyricsWrapper.classList.add('md:w-[500px]', 'lg:w-[600px]', 'flex-shrink-0');
            lyricsWrapper.style.maxHeight = ''; // 恢复默认值
        }

        if (lyricContent) {
            lyricContent.classList.add('items-center', 'md:items-start', 'text-center', 'md:text-left', 'md:pl-6');
        }

        if (titleParent) {
            titleParent.classList.add('text-center', 'md:text-left', 'md:pl-6');
        }

        if (detailTitle) {
            detailTitle.classList.add('md:mx-0');
        }
    }
}

// 启动展开按钮淡化计时器
function startExpandBtnTimer() {
    const expandBtn = document.getElementById('btn-expand-panel');
    if (!expandBtn) return;

    if (expandBtnTimeout) clearTimeout(expandBtnTimeout);
    expandBtn.classList.remove('faint');

    expandBtnTimeout = setTimeout(() => {
        // 只有当播放栏仍处于隐藏状态时才淡化
        const footer = document.getElementById('player-footer');
        if (footer && footer.classList.contains('translate-y-[110%]')) {
            expandBtn.classList.add('faint');
        }
    }, 3000);
}

// 启动歌词按钮淡化计时器
function startToggleLyricsBtnTimer() {
    const toggleBtn = document.getElementById('btn-toggle-lyrics');
    if (!toggleBtn) return;

    if (toggleLyricsBtnTimeout) clearTimeout(toggleLyricsBtnTimeout);
    toggleBtn.classList.remove('faint');

    toggleLyricsBtnTimeout = setTimeout(() => {
        // 只有当歌词页面处于显示状态时才淡化
        const view = document.getElementById('view-player-detail');
        if (view && !view.classList.contains('translate-y-[100%]')) {
            toggleBtn.classList.add('faint');
        }
    }, 3000);
}

// 切换底部播放栏显示/隐藏 (移动端)
function togglePlayerPanel() {
    const footer = document.getElementById('player-footer');
    const expandBtn = document.getElementById('btn-expand-panel');
    const container = document.getElementById('player-detail-container');

    if (!footer || !expandBtn) return;

    // 检查是否已经隐藏 (通过 transform 判断)
    // 注意: Tailwind 的 translate-y-full 等同于 transform: translateY(100%)
    const isHidden = footer.classList.contains('translate-y-[110%]');

    const views = ['view-search', 'view-settings', 'view-favorites', 'view-about', 'main-sidebar', 'view-songlist', 'songlist-detail-view'];
    const playerDetail = document.getElementById('view-player-detail');
    const lyricsWrapper = document.getElementById('lyrics-wrapper');

    if (isHidden) {
        // 显示播放栏
        footer.classList.remove('translate-y-[110%]');
        footer.style.opacity = '1';
        footer.style.pointerEvents = 'auto';

        // 隐藏展开按钮
        expandBtn.classList.remove('translate-y-0', 'scale-100', 'opacity-100');
        expandBtn.classList.add('translate-y-20', 'scale-75', 'opacity-0');

        // 重置状态
        if (expandBtnTimeout) clearTimeout(expandBtnTimeout);
        expandBtn.classList.remove('faint');

        // 恢复内容底部 Padding
        views.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.classList.remove('pb-32', 'pb-44', 'md:pb-32');
                el.classList.add('pb-44', 'md:pb-32');
            }
        });

        // 歌词页: 增加底部 Padding (避开播放栏)
        if (playerDetail) {
            playerDetail.classList.add('pb-24');
            playerDetail.classList.remove('pb-0');
        }

        // 桌面端: 恢复 md:pt-0 (垂直居中, 无顶部Padding)
        if (container) {
            container.classList.remove('translate-y-12', 'opacity-80', 'scale-95');
            container.classList.remove('md:pt-24', 'md:pt-12');
            container.classList.add('md:pt-0');
        }
    } else {
        // 隐藏播放栏 (向下移出屏幕) 
        footer.classList.add('translate-y-[110%]');
        footer.style.opacity = '0';
        footer.style.pointerEvents = 'none';

        // 停止动画并清除可视化画布，防止在偏移后仍有残留渲染
        if (window.musicVisualizer && window.musicVisualizer.clear) {
            window.musicVisualizer.clear('footer');
        }
        setTimeout(() => {
            expandBtn.classList.remove('translate-y-20', 'scale-75', 'opacity-0');
            expandBtn.classList.add('translate-y-0', 'scale-100', 'opacity-100');
        }, 300);

        // 开启 3s 自动淡化计时器
        startExpandBtnTimer();

        // 移除内容底部 Padding (内容延伸到底部)
        views.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('pb-32', 'pb-44', 'md:pb-32');
        });

        // 歌词页: 移除底部 Padding (利用底部空间)
        if (playerDetail) {
            playerDetail.classList.remove('pb-24');
            playerDetail.classList.add('pb-0');
        }

        // 桌面端: 移除 md:pt-0, 添加 md:pt-24 (避免遮挡顶部 NOW PLAYING)
        // 调整内容容器以填满全屏
        if (container) {
            container.classList.remove('md:pt-0');
            container.classList.add('md:pt-24');
            container.classList.add('translate-y-12', 'opacity-80', 'scale-95');
            // 稍后移除微调，保持丝滑
            setTimeout(() => {
                container.classList.remove('translate-y-12', 'opacity-80', 'scale-95');
            }, 600);
        }
    }

    // [New] 触发可视化模块更新布局 (Padding 处理)
    if (window.musicVisualizer) {
        window.musicVisualizer.applySettings();
    }

    // 重新校准歌词位置 (动画结束后执行)
    setTimeout(() => {
        scrollToActiveLine(true);
    }, 300);
}

// 导出函数
window.togglePlayerPanel = togglePlayerPanel;
window.updateSetting = updateSetting;

// Initialize Sound Effects on first play/click
function initAudioEngine() {
    if (window.soundEffects && !window._audioEngineInited) {
        window.soundEffects.init();
        window._audioEngineInited = true;
        console.log('[AudioEngine] Sound effects initialized via AudioEngine');

        // Ensure Visualizer captures correct source
        if (window.musicVisualizer && window.musicVisualizer.init) {
            window.musicVisualizer.init();
        }

        // iOS: 在用户手势上下文中立即启动 anchor audio，建立后台音频会话
        if (window.iOSBackgroundAudio) {
            window.iOSBackgroundAudio.ensureAnchorPlaying();
        }
    }
}

// Intercept play for audio engine init
const originalTogglePlay = window.togglePlay;
window.togglePlay = function () {
    initAudioEngine();
    if (originalTogglePlay) originalTogglePlay();
};

document.addEventListener('click', initAudioEngine, { once: true });

// --- Search Suggestions Logic ---
let searchTipsDebounceTimer = null;
let currentSelectedTipIndex = -1;
let currentTipAbortController = null;

function initSearchTips() {
    const searchInput = document.getElementById('search-input');
    const suggestionsContainer = document.getElementById('search-suggestions');

    if (!searchInput || !suggestionsContainer) return;

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        clearTimeout(searchTipsDebounceTimer);

        if (!query) {
            hideSearchSuggestions();
            return;
        }

        searchTipsDebounceTimer = setTimeout(() => {
            fetchSearchTips(query);
        }, 300);
    });

    searchInput.addEventListener('focus', () => {
        const query = searchInput.value.trim();
        if (query) {
            suggestionsContainer.classList.remove('hidden');
        }
    });

    searchInput.addEventListener('keydown', (e) => {
        const list = document.getElementById('search-suggestions-list');
        const items = list ? list.querySelectorAll('.search-tip-item') : [];

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (items.length === 0) return;
            currentSelectedTipIndex = (currentSelectedTipIndex + 1) % items.length;
            updateTipSelection(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (items.length === 0) return;
            currentSelectedTipIndex = (currentSelectedTipIndex - 1 + items.length) % items.length;
            updateTipSelection(items);
        } else if (e.key === 'Enter') {
            if (currentSelectedTipIndex >= 0 && items[currentSelectedTipIndex]) {
                e.preventDefault();
                const text = items[currentSelectedTipIndex].textContent.trim();
                searchInput.value = text;
                hideSearchSuggestions();
                doSearch();
            }
        } else if (e.key === 'Escape') {
            hideSearchSuggestions();
        }
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !suggestionsContainer.contains(e.target)) {
            hideSearchSuggestions();
        }
    });
}

function updateTipSelection(items) {
    items.forEach((item, index) => {
        if (index === currentSelectedTipIndex) {
            item.classList.add('t-bg-muted');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('t-bg-muted');
        }
    });
}

async function fetchSearchTips(query) {
    if (currentTipAbortController) currentTipAbortController.abort();
    currentTipAbortController = new AbortController();
    const signal = currentTipAbortController.signal;

    const source = (document.getElementById('search-source')) ? document.getElementById('search-source').value : 'kw';
    try {
        const resp = await fetch(`/api/music/tipSearch?name=${encodeURIComponent(query)}&source=${source}`, { signal });
        if (!resp.ok) return;
        const tips = await resp.json();
        renderSearchTips(tips);
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('[TipSearch] Fetch error:', err);
    } finally {
        if (currentTipAbortController && currentTipAbortController.signal === signal) {
            currentTipAbortController = null;
        }
    }
}

function renderSearchTips(tips) {
    const container = document.getElementById('search-suggestions');
    const list = document.getElementById('search-suggestions-list');
    const input = document.getElementById('search-input');
    if (!container || !list || !input) return;

    // 如果输入框已失去焦点（除非是操作建议列表），或者已经触发了正式搜索，则不再渲染
    if (document.activeElement !== input) {
        container.classList.add('hidden');
        return;
    }

    list.innerHTML = '';
    currentSelectedTipIndex = -1;

    if (!tips || tips.length === 0) {
        container.classList.add('hidden');
        return;
    }

    tips.forEach((tip, index) => {
        const div = document.createElement('div');
        div.className = 'search-tip-item px-4 py-2.5 hover:t-bg-muted cursor-pointer transition-colors text-sm flex items-center gap-3';
        div.innerHTML = `<i class="fas fa-search t-text-muted text-xs"></i><span class="truncate">${tip}</span>`;
        div.onclick = (e) => {
            e.stopPropagation(); // 防止触发 document click
            input.value = tip;
            hideSearchSuggestions();
            doSearch();
        };
        list.appendChild(div);
    });

    container.classList.remove('hidden');
}

function hideSearchSuggestions() {
    const container = document.getElementById('search-suggestions');
    if (container) container.classList.add('hidden');
    currentSelectedTipIndex = -1;

    // 清除待执行的防抖定时器
    if (searchTipsDebounceTimer) {
        clearTimeout(searchTipsDebounceTimer);
        searchTipsDebounceTimer = null;
    }

    // 中止正在进行的请求
    if (currentTipAbortController) {
        currentTipAbortController.abort();
        currentTipAbortController = null;
    }
}

// Ensure initSearchTips runs on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSearchTips);
} else {
    initSearchTips();
}
// ===== 持久化 Token 管理逻辑 =====

/**
 * 加载并渲染持久化 Token 配置
 */
async function loadTokenConfig() {
    const section = document.getElementById('token-management-section');
    if (!section) return;

    try {
        const res = await fetch('/api/user/token/config', {
            headers: getUserAuthHeaders()
        });
        if (!res.ok) throw new Error('Failed to load token config');

        const { config } = await res.json();
        const toggle = document.getElementById('setting-enable-persistent-token');
        const container = document.getElementById('token-list-container');

        if (toggle) toggle.checked = config.enabled;

        // [核心改进] 关闭认证时彻底隐藏下方列表
        if (config.enabled) {
            container.classList.remove('hidden', 'opacity-50', 'pointer-events-none');
        } else {
            container.classList.add('hidden');
        }

        // 同步到全局 settings
        settings.enablePersistentToken = config.enabled;

        renderTokenList(config.tokens || []);
    } catch (e) {
        console.error('[Token] Failed to load config:', e);
    }
}

/**
 * 渲染 Token 列表 UI
 */
function renderTokenList(tokens) {
    const list = document.getElementById('token-items');
    if (!list) return;

    if (tokens.length === 0) {
        list.innerHTML = '<div class="text-[10px] t-text-muted text-center py-6 border-2 border-dashed t-border-main rounded-xl italic opacity-60">暂无生成的 API Token</div>';
        return;
    }

    list.innerHTML = tokens.map(t => {
        const masked = `${t.token.slice(0, 6)}...${t.token.slice(-4)}`;
        const isExpired = t.expiresAt && t.expiresAt < Date.now();
        const isDisabled = !!t.disabled;

        return `
        <div class="t-bg-item rounded-3xl p-4 md:p-6 border t-border-main hover:t-border-primary transition-all duration-300 group ${isExpired || isDisabled ? 'opacity-60' : ''}">
            <div class="flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div class="flex-1 min-w-0">
                    <div class="text-sm font-bold t-text-main mb-1.5 truncate flex flex-wrap items-center gap-2">
                        <span>${t.name}</span>
                        <span class="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-mono border border-emerald-500/20">${masked}</span>
                        ${isExpired ? '<span class="px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 text-[9px] font-bold border border-red-500/20 whitespace-nowrap">已过期</span>' : ''}
                        ${isDisabled ? '<span class="px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-500 text-[9px] font-bold border border-orange-500/20 whitespace-nowrap">已禁用</span>' : ''}
                    </div>
                    <div class="text-[11px] t-text-muted mt-2 flex flex-col sm:flex-row sm:flex-wrap gap-y-1 sm:gap-x-4 items-start sm:items-center opacity-80">
                        <span class="inline-flex items-center gap-1.5"><i class="far fa-calendar-plus opacity-50 text-[10px]"></i> ${new Date(t.createdAt).toLocaleString()}</span>
                        <span class="inline-flex items-center gap-1.5"><i class="far fa-clock opacity-50 text-[10px]"></i> ${t.expiresAt ? new Date(t.expiresAt).toLocaleString() : '永久有效'}</span>
                    </div>
                    ${t.lastUsed ? `<div class="text-[10px] text-emerald-500/90 mt-2 flex items-center gap-1.5 font-medium"><i class="fas fa-history text-[9px]"></i> 最后调用: ${new Date(t.lastUsed).toLocaleString()}</div>` : ''}
                </div>
                
                <div class="flex items-center justify-between md:justify-end gap-3 pt-3 md:pt-0 border-t md:border-0 t-border-main border-dashed">
                    <!-- 状态切换 (使用统一的 Tailwind 样式) -->
                    <div class="flex items-center gap-2">
                        <span class="text-[11px] t-text-muted opacity-70 hidden sm:inline">${isDisabled ? '停用中' : '生效中'}</span>
                        <label class="relative inline-flex items-center cursor-pointer scale-[0.85]">
                            <input type="checkbox" ${!isDisabled ? 'checked' : ''} onchange="handleToggleTokenStatus('${masked}', !this.checked)" class="sr-only peer">
                            <div class="w-11 h-6 bg-gray-200/50 peer-focus:outline-none rounded-full peer dark:bg-gray-700/50 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-emerald-500"></div>
                        </label>
                    </div>
                    
                    <div class="flex items-center gap-1">
                        <button onclick="openTokenLogsModal('${masked}', '${t.name}')" 
                            class="p-2 md:p-2.5 rounded-xl t-bg-track hover:t-bg-primary hover:text-white transition-all group/btn" title="查看日志">
                            <i class="fas fa-list-ul text-[13px] md:text-[14px]"></i>
                        </button>
                        <button onclick="openEditTokenModal('${masked}', '${t.name}', ${t.expiresAt})" 
                            class="p-2 md:p-2.5 rounded-xl t-bg-track hover:t-bg-primary hover:text-white transition-all group/btn" title="编辑信息">
                            <i class="fas fa-pencil-alt text-[13px] md:text-[14px]"></i>
                        </button>
                        <button onclick="copyTokenToClipboard('${t.token}')" 
                            class="p-2 md:p-2.5 rounded-xl t-bg-track hover:bg-blue-500 hover:text-white transition-all group/btn" title="复制 Token">
                            <i class="far fa-copy text-[13px] md:text-[14px]"></i>
                        </button>
                        <button onclick="handleRemoveToken('${t.token}')" 
                            class="p-2 md:p-2.5 rounded-xl t-bg-track hover:bg-red-500 hover:text-white transition-all group/btn" title="删除 Token">
                            <i class="far fa-trash-alt text-[13px] md:text-[14px]"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `
    }).join('');
}

/**
 * 切换单个 Token 的启用/禁用状态
 */
async function handleToggleTokenStatus(tokenMasked, disabled) {
    try {
        const res = await fetch('/api/user/token/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getUserAuthHeaders() },
            body: JSON.stringify({ tokenMasked, disabled })
        });
        if (res.ok) {
            showSuccess(`已${disabled ? '停用' : '启用'}该凭证`);
            loadTokenConfig();
        } else {
            showError('操作失败');
            loadTokenConfig(); // 失败则回刷状态
        }
    } catch (e) {
        showError('请求异常');
        loadTokenConfig();
    }
}

/**
 * 切换 Token 校验功能显隐
 */
async function toggleTokenAuthSetting(enabled, silent = false) {
    try {
        const res = await fetch('/api/user/token/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getUserAuthHeaders() },
            body: JSON.stringify({ enabled })
        });
        if (res.ok) {
            if (!silent) showSuccess(`持久化 Token 已${enabled ? '启用' : '禁用'}`);
            // [核心修复] 使用 updateSetting 联动同步 localStorage 和服务器 settings.json
            await updateSetting('enablePersistentToken', enabled);
            await loadTokenConfig();
        } else {
            throw new Error();
        }
    } catch (e) {
        if (!silent) showError('更新 Token 配置失败');
        // 还原 UI 开关
        const toggle = document.getElementById('setting-enable-persistent-token');
        if (toggle) toggle.checked = !enabled;
    }
}

/**
 * 打开添加 Token 模态框
 */
function openAddTokenModal() {
    const modal = document.getElementById('modal-add-token');
    const content = document.getElementById('modal-add-token-content');
    modal.classList.remove('hidden');
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);

    // 设置为“生成”模式
    document.getElementById('token-modal-title').innerText = '生成持久化 Token';
    document.getElementById('edit-token-masked').value = '';
    document.getElementById('token-modal-submit-btn').innerText = '生成并保存';
    document.getElementById('token-modal-submit-btn').onclick = handleAddToken;

    document.getElementById('add-token-form').classList.remove('hidden');
    document.getElementById('add-token-result').classList.add('hidden');
    document.getElementById('new-token-name').value = '';

    // 初始化有效期 UI
    document.getElementById('new-token-offset-value').value = '';
    document.getElementById('new-token-exact-date').value = '';
    switchTokenExpireMode('offset');
}

/**
 * 切换有效期设置模式
 */
function switchTokenExpireMode(mode) {
    const btnOffset = document.getElementById('btn-expire-offset');
    const btnDate = document.getElementById('btn-expire-date');
    const areaOffset = document.getElementById('expire-offset-area');
    const areaDate = document.getElementById('expire-date-area');

    if (mode === 'offset') {
        btnOffset.classList.add('t-bg-main', 'bg-white', 'dark:bg-white/10', 'shadow-sm');
        btnOffset.classList.remove('t-text-muted');
        btnDate.classList.remove('t-bg-main', 'bg-white', 'dark:bg-white/10', 'shadow-sm');
        btnDate.classList.add('t-text-muted');
        areaOffset.classList.remove('hidden');
        areaDate.classList.add('hidden');
    } else {
        btnDate.classList.add('t-bg-main', 'bg-white', 'dark:bg-white/10', 'shadow-sm');
        btnDate.classList.remove('t-text-muted');
        btnOffset.classList.remove('t-bg-main', 'bg-white', 'dark:bg-white/10', 'shadow-sm');
        btnOffset.classList.add('t-text-muted');
        areaOffset.classList.add('hidden');
        areaDate.classList.remove('hidden');
    }
    // 保存当前模式到全局或临时变量，以便提交时判断
    document.getElementById('modal-add-token').dataset.expireMode = mode;
}

/**
 * 计算选定的过期时间戳
 */
function calculateSelectedExpiresAt() {
    const mode = document.getElementById('modal-add-token').dataset.expireMode;
    if (mode === 'date') {
        const val = document.getElementById('new-token-exact-date').value;
        return val ? new Date(val).getTime() : null;
    } else {
        const val = parseFloat(document.getElementById('new-token-offset-value').value);
        const unit = document.getElementById('new-token-offset-unit').value;
        if (!val || val <= 0) return null;

        const offsetMs = unit === 'h' ? val * 60 * 60 * 1000 : val * 24 * 60 * 60 * 1000;
        return Date.now() + offsetMs;
    }
}

/**
 * 打开编辑 Token 模态框
 */
function openEditTokenModal(tokenMasked, name, expiresAt) {
    const modal = document.getElementById('modal-add-token');
    const content = document.getElementById('modal-add-token-content');
    modal.classList.remove('hidden');
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);

    // 设置为“编辑”模式
    document.getElementById('token-modal-title').innerText = '编辑 Token 信息';
    document.getElementById('edit-token-masked').value = tokenMasked;
    document.getElementById('token-modal-submit-btn').innerText = '保存修改';
    document.getElementById('token-modal-submit-btn').onclick = handleUpdateToken;

    document.getElementById('add-token-form').classList.remove('hidden');
    document.getElementById('add-token-result').classList.add('hidden');
    document.getElementById('new-token-name').value = name || '';

    if (expiresAt) {
        switchTokenExpireMode('date');
        // 将时间戳转为 datetime-local 格式: YYYY-MM-DDTHH:mm
        const date = new Date(expiresAt);
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const hh = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        document.getElementById('new-token-exact-date').value = `${yyyy}-${mm}-${dd}T${hh}:${min}`;
        document.getElementById('new-token-offset-value').value = '';
    } else {
        switchTokenExpireMode('offset');
        document.getElementById('new-token-offset-value').value = '';
        document.getElementById('new-token-exact-date').value = '';
    }
}

/**
 * 处理更新 Token 信息
 */
async function handleUpdateToken() {
    const tokenMasked = document.getElementById('edit-token-masked').value;
    const name = document.getElementById('new-token-name').value.trim();
    const expiresAt = calculateSelectedExpiresAt();

    if (!name) return showError('请填写 Token 名称');

    try {
        const res = await fetch('/api/user/token/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getUserAuthHeaders() },
            body: JSON.stringify({ tokenMasked, name, expiresAt })
        });
        if (res.ok) {
            showSuccess('修改已保存');
            closeAddTokenModal();
            loadTokenConfig();
        } else {
            showError('保存失败');
        }
    } catch (e) {
        showError('请求异常');
    }
}

/**
 * 关闭添加 Token 模态框
 */
function closeAddTokenModal() {
    const modal = document.getElementById('modal-add-token');
    const content = document.getElementById('modal-add-token-content');
    content.classList.add('scale-95', 'opacity-0');
    content.classList.remove('scale-100', 'opacity-100');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

/**
 * 处理添加新 Token
 */
async function handleAddToken() {
    const name = document.getElementById('new-token-name').value.trim();
    const expiresAt = calculateSelectedExpiresAt();

    if (!name) {
        showError('请填写 Token 名称');
        return;
    }

    try {
        const res = await fetch('/api/user/token/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getUserAuthHeaders() },
            body: JSON.stringify({ name, expiresAt })
        });
        const result = await res.json();
        if (result.success) {
            document.getElementById('add-token-form').classList.add('hidden');
            const resultArea = document.getElementById('add-token-result');
            resultArea.classList.remove('hidden');
            document.getElementById('generated-token-value').value = result.token;
            loadTokenConfig();
        } else {
            showError(result.message || '生成失败');
        }
    } catch (e) {
        showError('生成器异常');
    }
}

/**
 * 处理删除 Token
 */
async function handleRemoveToken(token) {
    if (!await showSelect('确定删除', `确定要永久删除此 Token 吗？\n所有使用此凭证的外部工具将立即无法连接。`, { danger: true })) return;
    try {
        const res = await fetch('/api/user/token/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getUserAuthHeaders() },
            body: JSON.stringify({ token: token })
        });
        if (res.ok) {
            showSuccess('Token 已移除');
            loadTokenConfig();
        }
    } catch (e) {
        showError('删除失败');
    }
}

/**
 * 查看 Token 调用日志
 */
let currentViewingTokenMasked = '';

/**
 * 刷新 Token 调用日志记录
 */
async function handleRefreshTokenLogs() {
    if (!currentViewingTokenMasked) return;
    const list = document.getElementById('token-logs-list');
    const refreshBtn = document.getElementById('btn-refresh-token-logs');

    // 增加旋转动画
    if (refreshBtn) {
        const icon = refreshBtn.querySelector('i');
        if (icon) icon.classList.add('animate-spin');
    }

    try {
        const res = await fetch(`/api/user/token/logs?tokenMasked=${encodeURIComponent(currentViewingTokenMasked)}`, {
            headers: getUserAuthHeaders()
        });
        if (!res.ok) throw new Error('Failed to fetch logs');

        const { logs } = await res.json();
        if (!logs || logs.length === 0) {
            list.innerHTML = '<div class="py-12 text-center t-text-muted italic opacity-50">暂无该 Token 的调用日志</div>';
        } else {
            // 解析日志行，美化显示
            list.innerHTML = logs.map(line => {
                // [语义化解析] 提取审计日志核心字段
                const auditMatch = line.match(/used by (.*?) from (.*?) to access (.*?)$/);
                const timeMatch = line.match(/\[([\d-T:\.]+)\]/);
                const timeStr = timeMatch ? timeMatch[1].split('T')[1]?.split('.')[0] || '未知' : '未知';

                // 情况 A: 标准 API 调用流水
                if (auditMatch) {
                    const [, user, ip, url] = auditMatch;
                    return `
                    <div class="p-3.5 rounded-2xl t-bg-track border t-border-main flex flex-col gap-2 transition-all hover:t-border-primary border-transparent">
                        <div class="flex items-center justify-between border-b t-border-main border-dashed pb-2 mb-1 opacity-80">
                            <div class="flex items-center gap-1.5">
                                <i class="fas fa-fingerprint text-[10px] text-emerald-500"></i>
                                <span class="text-[10px] font-bold t-text-main">用户 ${user}</span>
                            </div>
                            <span class="px-2 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-500 font-mono text-[9px]">${timeStr}</span>
                        </div>
                        <div class="space-y-1.5">
                            <div class="flex items-center gap-2 text-[11px] t-text-main">
                                <i class="fas fa-network-wired w-4 opacity-40 text-center"></i>
                                <span class="opacity-50">来源 IP:</span> <span class="font-mono text-emerald-500/80 tracking-tighter">${ip}</span>
                            </div>
                            <div class="flex items-start gap-2 text-[11px] t-text-main">
                                <i class="fas fa-link w-4 opacity-40 text-center mt-0.5"></i>
                                <div class="flex-1">
                                    <span class="opacity-50">请求路径:</span> 
                                    <span class="font-medium break-all text-blue-500/80 ml-1 italic font-mono">${url}</span>
                                </div>
                            </div>
                        </div>
                    </div>`;
                }

                // 情况 B: 系统配置审计 (手动开启/关闭)
                if (line.includes('token auth')) {
                    const isEnabled = line.includes('enabled');
                    return `
                    <div class="p-3 rounded-2xl bg-blue-500/5 border border-blue-500/15 flex items-center justify-between">
                         <div class="flex items-center gap-3">
                             <div class="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-500">
                                 <i class="fas ${isEnabled ? 'fa-toggle-on' : 'fa-toggle-off'} text-xs"></i>
                             </div>
                             <div class="text-[11px] t-text-main font-extrabold">全局：${isEnabled ? '启用' : '停用'} API 验证鉴权</div>
                         </div>
                         <span class="text-[9px] t-text-muted opacity-60">${timeStr}</span>
                    </div>`;
                }

                // 情况 C: 原始日志 (兜底显示)
                return `<div class="p-3 t-bg-track rounded-xl t-text-muted text-[10px] opacity-70 italic border t-border-main border-dashed">${line}</div>`;
            }).join('');
        }
    } catch (e) {
        console.error('[TokenLog] Error:', e);
        list.innerHTML = `<div class="py-12 text-center text-red-500 italic opacity-50">拉取日志失败: ${e.message}</div>`;
    } finally {
        if (refreshBtn) {
            setTimeout(() => {
                const icon = refreshBtn.querySelector('i');
                if (icon) icon.classList.remove('animate-spin');
            }, 500);
        }
    }
}

/**
 * 查看 Token 调用日志
 */
async function openTokenLogsModal(tokenMasked, name) {
    currentViewingTokenMasked = tokenMasked;
    const modal = document.getElementById('modal-token-logs');
    const content = document.getElementById('modal-token-logs-content');
    const list = document.getElementById('token-logs-list');
    const nameEl = document.getElementById('log-token-name');

    nameEl.innerText = `Token: ${name} (${tokenMasked})`;
    list.innerHTML = '<div class="py-12 text-center t-text-muted italic opacity-50 animate-pulse">正在从日志服务器拉取记录...</div>';

    modal.classList.remove('hidden');
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);

    handleRefreshTokenLogs();
}

/**
 * 关闭 Token 调用日志模态框
 */
function closeTokenLogsModal() {
    const modal = document.getElementById('modal-token-logs');
    const content = document.getElementById('modal-token-logs-content');
    if (content) {
        content.classList.add('scale-95', 'opacity-0', 'duration-300');
        content.classList.remove('scale-100', 'opacity-100');
    }
    setTimeout(() => {
        if (modal) modal.classList.add('hidden');
    }, 300);
}

/**
 * 复制到剪切板
 */
function copyTokenToClipboard(token) {
    if (!token) return;
    navigator.clipboard.writeText(token).then(() => showSuccess('Token 已复制到剪贴板'));
}

function copyGeneratedToken() {
    const val = document.getElementById('generated-token-value').value;
    if (val) {
        navigator.clipboard.writeText(val).then(() => showSuccess('Token 已成功保存至剪贴板'));
    }
}

// 暴漏到全局
window.toggleTokenAuthSetting = toggleTokenAuthSetting;
window.openAddTokenModal = openAddTokenModal;
window.closeAddTokenModal = closeAddTokenModal;
window.handleAddToken = handleAddToken;
window.handleRemoveToken = handleRemoveToken;
window.openTokenLogsModal = openTokenLogsModal;
window.closeTokenLogsModal = closeTokenLogsModal;
window.handleRefreshTokenLogs = handleRefreshTokenLogs;
window.copyTokenToClipboard = copyTokenToClipboard;
window.copyGeneratedToken = copyGeneratedToken;
window.loadTokenConfig = loadTokenConfig;

// ── 全新自定义下拉框管理模块 ──
// ── 全新自定义下拉框管理模块 (Portal 模式版) ──
window.CustomSelectManager = {
    initAll() {
        document.querySelectorAll('select:not(.cs-hidden)').forEach(select => {
            this.init(select);
        });
    },
    init(select) {
        if (select.classList.contains('cs-hidden')) return;

        // 创建包装器，继承原 select 的布局类（如 flex-1, flex-shrink-0）
        const wrapper = document.createElement('div');
        wrapper.className = 'cs-wrapper';
        // 提取布局类
        const layoutClasses = Array.from(select.classList).filter(c =>
            c.startsWith('flex-') || c.startsWith('md:flex-') ||
            c.startsWith('w-') || c.startsWith('md:w-') ||
            c.startsWith('shrink-') || c.startsWith('md:shrink-')
        );
        if (layoutClasses.length) wrapper.classList.add(...layoutClasses);
        if (select.id) wrapper.id = 'cs-w-' + select.id;

        const trigger = document.createElement('div');
        trigger.className = 'cs-trigger';

        // 精准克隆外观属性以防止大小不一致 (匹配 Tailwind 值)
        if (select.classList.contains('px-4')) { trigger.style.paddingLeft = '1rem'; trigger.style.paddingRight = '1rem'; }
        if (select.classList.contains('py-3')) { trigger.style.paddingTop = '0.75rem'; trigger.style.paddingBottom = '0.75rem'; }
        if (select.classList.contains('py-2')) { trigger.style.paddingTop = '0.5rem'; trigger.style.paddingBottom = '0.5rem'; }
        if (select.classList.contains('rounded-xl')) trigger.style.borderRadius = '0.75rem';
        if (select.classList.contains('text-sm')) trigger.style.fontSize = '0.875rem';
        if (select.classList.contains('font-medium')) trigger.style.fontWeight = '500';

        const text = document.createElement('span');
        text.className = 'cs-trigger-text truncate mr-2';

        const icon = document.createElement('i');
        icon.className = 'fas fa-chevron-down cs-trigger-icon';

        trigger.appendChild(text);
        trigger.appendChild(icon);
        wrapper.appendChild(trigger);

        // 隐藏原始 select
        select.classList.add('cs-hidden');
        select.style.display = 'none';
        select.parentNode.insertBefore(wrapper, select);

        trigger.onclick = (e) => {
            e.stopPropagation();
            const isActive = wrapper.classList.contains('active');
            if (isActive) {
                this.closeAll();
            } else {
                this.closeAll();
                this.open(select, wrapper, trigger);
            }
        };

        // 初始同步 UI
        this.syncUI(select, wrapper);

        // 劫持 value 属性以支持 JS 赋值同步
        try {
            const originalSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
            Object.defineProperty(select, 'value', {
                set: function (val) {
                    originalSetter.call(this, val);
                    window.CustomSelectManager.syncUI(this);
                },
                get: function () {
                    return Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').get.call(this);
                },
                configurable: true
            });
        } catch (e) { console.warn('[CustomSelect] Value hijack failed:', e); }
    },
    open(select, wrapper, trigger) {
        wrapper.classList.add('active');

        // 创建下拉菜单并存入 body
        const dropdown = document.createElement('div');
        dropdown.className = 'cs-dropdown custom-scrollbar portal-active';
        dropdown.id = 'cs-dropdown-' + (select.id || Math.random().toString(36).substr(2, 9));

        const optionsList = document.createElement('ul');
        optionsList.className = 'cs-options';

        Array.from(select.options).forEach(opt => {
            if (opt.disabled) return;
            const li = document.createElement('li');
            li.className = 'cs-option' + (opt.selected ? ' selected' : '');
            li.innerHTML = `<span>${opt.text}</span><i class="fas fa-check"></i>`;

            li.onclick = (e) => {
                e.stopPropagation();
                select.value = opt.value;
                select.dispatchEvent(new Event('change'));
                this.syncUI(select, wrapper);
                this.closeAll();
            };
            optionsList.appendChild(li);
        });

        dropdown.appendChild(optionsList);
        document.body.appendChild(dropdown);

        // 计算位置
        this.reposition(trigger, dropdown);

        // 监听滚动以保持同步或关闭
        window.addEventListener('scroll', this.handleScrollOrResize, true);
        window.addEventListener('resize', this.handleScrollOrResize);

        requestAnimationFrame(() => {
            dropdown.classList.add('visible');
        });
    },
    reposition(trigger, dropdown) {
        const rect = trigger.getBoundingClientRect();
        dropdown.style.width = rect.width + 'px';
        dropdown.style.left = rect.left + 'px';

        // 检查空间，自动决定向上还是向下展开
        const spaceBelow = window.innerHeight - rect.bottom;
        const dropdownHeight = dropdown.offsetHeight || 260;

        if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
            dropdown.style.top = (rect.top + window.scrollY - dropdownHeight - 6) + 'px';
            dropdown.classList.add('open-up');
        } else {
            dropdown.style.top = (rect.bottom + window.scrollY + 4) + 'px';
            dropdown.classList.remove('open-up');
        }
    },
    handleScrollOrResize(e) {
        if (e && e.target && e.target.closest && e.target.closest('.cs-dropdown')) {
            return;
        }
        window.CustomSelectManager.closeAll();
    },
    syncUI(select, wrapper) {
        if (!wrapper) wrapper = select.previousSibling;
        if (!wrapper || !wrapper.classList.contains('cs-wrapper')) return;

        const textEl = wrapper.querySelector('.cs-trigger-text');
        const selectedOpt = select.options[select.selectedIndex];
        if (selectedOpt) {
            textEl.innerText = selectedOpt.text;
            this.updateHighlight(select, wrapper);
        }
    },
    updateHighlight(select, wrapper) {
        const val = select.value;
        let isDefault = false;
        if (select.id && typeof SETTINGS_UI_MAP !== 'undefined' && typeof DEFAULT_SETTINGS !== 'undefined') {
            const key = Object.keys(SETTINGS_UI_MAP).find(k => SETTINGS_UI_MAP[k].id === select.id);
            if (key && DEFAULT_SETTINGS[key] !== undefined) {
                isDefault = (String(val) === String(DEFAULT_SETTINGS[key]));
            }
        }

        if (!select.id || isDefault || ['all', 'none', 'root', 'mtime', 'desc', 'wy', '20', 'song'].includes(val)) {
            wrapper.classList.remove('highlight');
        } else {
            wrapper.classList.add('highlight');
        }
    },
    closeAll() {
        document.querySelectorAll('.cs-wrapper.active').forEach(w => w.classList.remove('active'));
        document.querySelectorAll('.cs-dropdown.portal-active').forEach(d => {
            d.remove();
        });
        window.removeEventListener('scroll', this.handleScrollOrResize, true);
        window.removeEventListener('resize', this.handleScrollOrResize);
    }
};

document.addEventListener('click', (e) => {
    if (!e.target.closest('.cs-wrapper') && !e.target.closest('.cs-dropdown')) {
        window.CustomSelectManager.closeAll();
    }
});

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    window.CustomSelectManager.initAll();
});
