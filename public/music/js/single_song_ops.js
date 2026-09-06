function getSongQualitySize(song, quality) {
    const maps = [
        song?._types,
        song?._qualitys,
        song?.meta?._types,
        song?.meta?._qualitys
    ];
    for (const map of maps) {
        const size = map?.[quality]?.size;
        if (size && size !== '0 B') return size;
    }

    const lists = [
        song?.types,
        song?.qualitys,
        song?.meta?.types,
        song?.meta?.qualitys
    ];
    for (const list of lists) {
        if (!Array.isArray(list)) continue;
        const size = list.find(t => (t?.type || t) === quality)?.size;
        if (size && size !== '0 B') return size;
    }

    return null;
}

const remoteQualitySizeCache = new Map();

const QUALITY_SOURCE_LABELS = {
    tx: 'TX',
    wy: 'WY',
    kw: 'KW',
    kg: 'KG',
    mg: 'MG'
};

function getSongQualityCacheKey(song, quality) {
    const meta = song?.meta || {};
    const source = song?.source || meta.source || '';
    const id = song?.songmid || song?.songId || song?.id || meta.songId || meta.songmid || '';
    return `${source}:${id}:${quality}`;
}

function getSongQualityResolvedSource(song, quality) {
    return song?._resolvedQualitySources?.[quality] || null;
}

function applySongQualityProbe(song, quality, probe) {
    if (!song || !quality || !probe) return;

    const size = probe.size || null;
    const source = probe.source || null;

    // Older favorites only contain the qualities known when they were saved.
    // Always create a canonical entry so newly supported qualities can be read
    // back by getSongQualitySize after the remote probe succeeds.
    if (!song._types || typeof song._types !== 'object' || Array.isArray(song._types)) {
        song._types = {};
    }
    if (!song._types[quality] || typeof song._types[quality] !== 'object') {
        song._types[quality] = {};
    }
    if (size) song._types[quality].size = size;

    if (source) {
        if (!song._resolvedQualitySources || typeof song._resolvedQualitySources !== 'object') {
            song._resolvedQualitySources = {};
        }
        song._resolvedQualitySources[quality] = source;
    }

    const maps = [song._types, song._qualitys, song.meta?._types, song.meta?._qualitys];
    maps.forEach(map => {
        if (!map?.[quality]) return;
        if (size) map[quality].size = size;
        if (source) map[quality].resolvedSource = source;
    });

    const lists = [song.types, song.qualitys, song.meta?.types, song.meta?.qualitys];
    lists.forEach(list => {
        if (!Array.isArray(list)) return;
        const item = list.find(t => (t?.type || t) === quality);
        if (item && typeof item === 'object') {
            if (size) item.size = size;
            if (source) item.resolvedSource = source;
        }
    });
}

async function fetchRemoteQualitySize(song, quality) {
    const cacheKey = getSongQualityCacheKey(song, quality);
    if (remoteQualitySizeCache.has(cacheKey)) {
        const cachedProbe = remoteQualitySizeCache.get(cacheKey);
        applySongQualityProbe(song, quality, cachedProbe);
        return cachedProbe;
    }

    try {
        const authHeaders = typeof getUserAuthHeaders === 'function' ? getUserAuthHeaders() : {};
        const res = await fetch('/api/music/quality/size', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders
            },
            body: JSON.stringify({ songInfo: song, quality })
        });
        if (!res.ok) throw new Error(await res.text());

        const data = await res.json();
        const probe = {
            size: data?.size || null,
            bytes: Number(data?.bytes) || 0,
            source: data?.source || null,
            resolvedQuality: data?.type || quality,
            sourceName: data?.sourceName || ''
        };
        applySongQualityProbe(song, quality, probe);
        remoteQualitySizeCache.set(cacheKey, probe);
        return probe;
    } catch (e) {
        console.warn(`[QualitySize] 获取 ${quality} 真实大小失败:`, e);
        // Do not make a transient source/network failure permanent for this tab.
        remoteQualitySizeCache.delete(cacheKey);
        return null;
    }
}

async function buildQualityOptionLabels(song, qualities) {
    const unresolvedQualities = qualities.filter(q => !getSongQualitySize(song, q) || !getSongQualityResolvedSource(song, q));
    if (unresolvedQualities.length > 0) {
        window.showLoading?.('正在读取音质大小...');
        try {
            await Promise.all(unresolvedQualities.map(q => fetchRemoteQualitySize(song, q)));
        } finally {
            window.hideLoading?.();
        }
    }

    return qualities.map(q => getQualityOptionLabel(song, q));
}

function getQualityOptionLabel(song, quality) {
    const name = window.QualityManager ? window.QualityManager.getQualityDisplayName(quality) : quality;
    const size = getSongQualitySize(song, quality) || '未知大小';
    const source = getSongQualityResolvedSource(song, quality);
    const sourceLabel = source ? (QUALITY_SOURCE_LABELS[source] || String(source).toUpperCase()) : '';
    return `${name} [${size}${sourceLabel ? ` · ${sourceLabel}` : ''}]`;
}

function getSelectableQualityOrder(song = null) {
    if (song && window.QualityManager?.getSelectableQualities) {
        return window.QualityManager.getSelectableQualities(song);
    }
    return window.QualityManager?.QUALITY_ORDER_LOW_TO_HIGH ||
        (window.QualityManager?.QUALITY_PRIORITY ? [...window.QualityManager.QUALITY_PRIORITY].reverse() : ['128k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'atmos_plus', 'master']);
}

async function requestListSongRemoval(listId, songIds) {
    const send = () => fetch('/api/music/user/list/remove', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...getUserAuthHeaders()
        },
        body: JSON.stringify({ listId, songIds })
    });

    let response = await send();
    if (response.status === 401 && typeof ensureUserAuthToken === 'function') {
        const refreshed = await ensureUserAuthToken({ force: true });
        if (refreshed) response = await send();
    }
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || '删除失败');
    }
    return response;
}
window.requestListSongRemoval = requestListSongRemoval;

// Single song deletion
async function deleteSingleSong(songId) {
    if (!(await showSelect('删除歌曲', '确定要删除这首歌曲吗?', { danger: true }))) {
        return;
    }

    // 公开列表删除需要管理员权限
    if (typeof requireAdminForOpenWrite === 'function') {
        if (!(await requireAdminForOpenWrite('删除公开列表中的歌曲'))) return;
    }

    const activeListId = getCurrentActiveListId();
    if (!activeListId || !currentListData) {
        showError('无法确定当前列表');
        return;
    }

    if (window.SyncManager.mode === 'local') {
        // Token authentication is sufficient; a saved plaintext password is not required.
        const authHeaders = getUserAuthHeaders();
        if (!authHeaders['x-user-token'] && !authHeaders['x-user-password']) {
            showError('请先登录本地账号');
            return;
        }

        try {
            await requestListSongRemoval(activeListId, [songId]);

            // Reload data from server
            const data = await window.SyncManager.sync();
            const oldUsername = currentListData ? currentListData.username : null;
            currentListData = data;
            if (oldUsername) currentListData.username = oldUsername; // Preserve username
            await window.ListStore.set(data).catch(e => console.error('[IDBStore] 保存失败:', e));
            renderMyLists(data);

            // Refresh current view
            handleListClick(activeListId, true, true);

            console.log('[Single] 本地模式删除成功');

        } catch (e) {
            showError('删除失败: ' + e.message);
            console.error('[Single] 删除错误:', e);
        }
    } else if (window.SyncManager.mode === 'remote') {
        // Remote mode: Modify cache
        try {
            const listToModify = getListById(activeListId);
            if (!listToModify) {
                throw new Error('找不到当前列表');
            }

            // Remove item from list
            const remainingItems = listToModify.filter(item => item.id !== songId);
            setListById(activeListId, remainingItems);

            // Save to cache
            await window.ListStore.set(currentListData).catch(e => console.error('[IDBStore] 保存失败:', e));
            console.log('[Single] WS模式:已修改缓存,下次连接时将同步');

            // If currently connected, push the change immediately
            if (window.SyncManager.client && window.SyncManager.client.isConnected) {
                try {
                    await pushDataChange();
                    console.log('[Single] WS模式:实时推送成功');
                } catch (e) {
                    console.warn('[Single] WS推送失败(将在下次连接时同步):', e);
                }
            }

            // Update UI
            renderMyLists(currentListData);
            handleListClick(activeListId, true, true);

        } catch (e) {
            showError('删除失败: ' + e.message);
            console.error('[Single] WS删除错误:', e);
        }
    }
}

/**
 * 辅助函数：根据设置触发服务器端歌词缓存
 * @param {Object} song 歌曲信息
 * @param {String} quality 音质
 * @param {Boolean} force 是否强制同步（忽略设置开关，用于手动点击按钮）
 */
async function requestServerLyricCache(song, quality = null, force = false) {
    if (!force && (typeof settings === 'undefined' || settings.enableServerLyricCache === false)) return false;

    console.log(`[Lyric] 尝试同步下载歌词缓存: ${song.name} (${quality || 'auto'})`);
    try {
        const meta = song.meta || {};
        const source = song.source || meta.source || '';
        const songmid = song.songmid || song.songId || meta.songmid || meta.songId || song.id || '';
        const nameValue = song.name || meta.songName || '';
        const singerValue = song.singer || meta.singerName || '';
        const name = encodeURIComponent(nameValue);
        const singer = encodeURIComponent(singerValue);
        const hash = song.hash || meta.hash || '';
        const interval = song.interval || meta.interval || '';

        if (!source || !songmid) {
            console.warn('[Lyric] 歌曲缺少必要字段，跳过歌词缓存同步:', song);
            return false;
        }

        // 1. 先尝试获取歌词数据
        const lyricUrl = `/api/music/lyric?source=${source}&songmid=${songmid}&name=${name}&singer=${singer}&hash=${hash}&interval=${interval}`;
        const lRes = await fetch(lyricUrl);
        if (!lRes.ok) return false;
        const lyricInfo = await lRes.json();

        if (!lyricInfo || (!lyricInfo.lyric && !lyricInfo.lrc)) return false;

        // 2. 将歌词推送到服务器缓存接口
        const cacheUrl = `/api/music/cache/lyric`;
        const headers = {
            'Content-Type': 'application/json',
            ...getUserAuthHeaders()
        };

        // 构建包含音质信息的 songInfo
        const songInfoForCache = {
            ...song,
            source,
            songmid,
            songId: song.songId || meta.songId || songmid,
            name: nameValue,
            singer: singerValue,
            hash,
            interval
        };
        if (quality) songInfoForCache.quality = quality;

        const enableOnlyDownloadMode = window.settings?.enableOnlyDownloadMode || false;

        const cacheRes = await fetch(cacheUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                songInfo: songInfoForCache,
                lyricsObj: lyricInfo,
                enableOnlyDownloadMode
            })
        });
        if (!cacheRes.ok) throw new Error('Lyric cache request failed');
        console.log(`[Lyric] 歌曲下载触发的歌词缓存同步成功: ${song.name} (仅下载模式: ${enableOnlyDownloadMode})`);
        return true;
    } catch (e) {
        console.warn(`[Lyric] 自动同步歌词缓存失败: ${song.name}`, e);
        if (force) throw e;
        return false;
    }
}

// Placeholder for download function
// Download single song
// Download single song
async function downloadSong(songOrId, forceQuality = null, suppressAlerts = false, skipPromptTarget = null) {
    let song;
    if (typeof songOrId === 'object') {
        song = songOrId;
    } else {
        if (!currentPlaylist) return false;
        song = currentPlaylist.find(s => s.id === songOrId);
    }

    if (!song) {
        if (!suppressAlerts) showError('未找到歌曲信息');
        return false;
    }

    const isOnlyDownload = window.settings?.enableOnlyDownloadMode === true;
    const actionLabel = isOnlyDownload ? '下载到服务器' : '缓存到服务器';

    let selected = skipPromptTarget;
    if (!selected) {
        // [优化] 检测是否已缓存
        const prefQuality = window.settings?.preferredQuality || 'flac';
        const checkResult = await window.checkServerCache?.(song, prefQuality);
        const cacheSuffix = (checkResult?.exists && !checkResult?.isCollision) ? ' (已缓存)' : '';

        const options = ['浏览器下载', `${actionLabel}${cacheSuffix}`];
        const modeText = isOnlyDownload ? '仅下载模式' : '缓存模式';
        selected = await showOptions('下载与缓存', `[${modeText}] 选择对 [${song.name}] 的操作：`, options);
    }
    if (!selected) return false;

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
                if (!authorized) return false;
            } else {
                return false;
            }
        }

        if (window.SystemDownloadManager) {
            const availableQualities = getSelectableQualityOrder(song);
            const qualityDisplayNames = await buildQualityOptionLabels(song, availableQualities);
            const selectedQualityDisplay = await showOptions('选择下载音质', `请选择对 [${song.name}] 的下载音质：`, qualityDisplayNames);
            if (!selectedQualityDisplay) return false;

            const selectedQualityIndex = qualityDisplayNames.indexOf(selectedQualityDisplay);
            const targetQuality = availableQualities[selectedQualityIndex];

            window.SystemDownloadManager.addTasks([{
                ...song,
                quality: targetQuality
            }]);

            if (!suppressAlerts) showInfo(`已添加任务，您可以在右侧下载管理面板查看进度`);
            return true;
        } else {
            showError('下载管理器未就绪');
            return false;
        }
    } else if (selected && (selected.startsWith('缓存到服务器') || selected.startsWith('下载到服务器'))) {
        const isServerCacheAllowed = window.lx_config?.['user.enablePublicNonAdminServerCache'] !== false;
        if (isPublic && enablePublicRestriction && !isServerCacheAllowed && !isAdmin) {
            showError('权限限制：管理员已关闭非管理员服务器缓存功能，缓存到服务器需要验证管理员。');
            if (typeof window.handleAdminAuth === 'function') {
                const authorized = await window.handleAdminAuth('管理员已关闭非管理员服务器缓存功能，缓存到服务器需要验证管理员身份');
                if (!authorized) return false;
            } else {
                return false;
            }
        }

        // [优化] 检测是否已缓存
        const prefQuality = window.settings?.preferredQuality || 'flac';
        const checkResult = await window.checkServerCache?.(song, prefQuality);
        const isCached = checkResult?.exists && !checkResult?.isCollision;

        if (!isOnlyDownload && isCached) {
            showInfo('该歌曲已在服务器缓存');
            return false;
        }
        let targetQuality = forceQuality;
        if (!targetQuality) {
            const availableQualities = getSelectableQualityOrder(song);
            const qualityDisplayNames = await buildQualityOptionLabels(song, availableQualities);
            const selectedQualityDisplay = await showOptions('选择缓存音质', `请选择对 [${song.name}] 的缓存音质：`, qualityDisplayNames);
            if (!selectedQualityDisplay) return false;

            const selectedQualityIndex = qualityDisplayNames.indexOf(selectedQualityDisplay);
            targetQuality = availableQualities[selectedQualityIndex];
        }

        try {
            // [Unified] 统一交给下载管理器调度
            if (window.SystemDownloadManager) {
                window.SystemDownloadManager.addTasks([{
                    ...song,
                    taskId: 'server_' + (song.id || song.songmid),
                    isServer: true,
                    quality: targetQuality // Let DM handle best quality resolution
                }]);
                if (!suppressAlerts) showInfo(`已添加云端缓存任务`);
                return true;
            } else {
                showError('下载管理器未就绪');
                return false;
            }
        } catch (e) {
            if (!suppressAlerts) showError('操作失败: ' + e.message);
            return false;
        }
    }
    return false;
}

// Batch download function shared by list selection and album downloads.
async function batchDownloadSongs(songsToDownload, batchOptions = {}) {
    if (!Array.isArray(songsToDownload) || songsToDownload.length === 0) {
        showError(batchOptions.emptyMessage || '未找到要下载的歌曲');
        return false;
    }

    const clearSelection = batchOptions.clearSelection !== false;
    const selectionLabel = batchOptions.selectionLabel || `选择了 ${songsToDownload.length} 首歌曲`;
    const targetOptions = ['浏览器下载', '缓存到服务器'];
    const modeText = window.settings?.['enableOnlyDownloadMode'] ? '仅下载模式' : '缓存模式';
    const selected = await showOptions('批量下载与缓存', `[${modeText}] ${selectionLabel}，请选择操作：`, targetOptions);

    if (!selected) return false;

    // 选中操作后的权限拦截校验
    const isPublic = !isUserLoggedIn() || window.currentListData?.username === 'default' || window.currentListData?.username === '_open';
    const enablePublicRestriction = window.lx_config?.['user.enablePublicRestriction'];
    const isAdmin = !!localStorage.getItem('lx_admin_password');

    if (selected === '浏览器下载') {
        const isBrowserDownloadAllowed = window.lx_config?.['user.enablePublicNonAdminBrowserDownload'] !== false;
        if (isPublic && enablePublicRestriction && !isBrowserDownloadAllowed && !isAdmin) {
            showError('权限限制：管理员已关闭非管理员浏览器下载功能，批量下载需要验证管理员身份。');
            if (typeof window.handleAdminAuth === 'function') {
                const authorized = await window.handleAdminAuth('管理员已关闭非管理员浏览器下载功能，批量下载需要验证管理员身份');
                if (!authorized) return false;
            } else {
                return false;
            }
        }

        if (window.SystemDownloadManager) {
            // 使用全局音质优先级展示可选音质
            const availableQualities = getSelectableQualityOrder();
            const qualityDisplayNames = availableQualities.map(q => window.QualityManager ? window.QualityManager.getQualityDisplayName(q) : q);
            const selectedQualityDisplay = await showOptions('选择下载音质', `请选择批量下载的音质：\n将优先请求所选音质，解析失败时按自动降级设置处理`, qualityDisplayNames);

            if (!selectedQualityDisplay) return false;
            const selectedQualityIndex = qualityDisplayNames.indexOf(selectedQualityDisplay);
            const targetQuality = availableQualities[selectedQualityIndex];

            const tasks = songsToDownload.map(s => ({
                ...s,
                quality: targetQuality
            }));

            await window.SystemDownloadManager.addTasks(tasks);

            showInfo(`已将 ${songsToDownload.length} 项任务添加到下载列表，您可以前往右侧下载管理面板查看进度`);
            if (clearSelection) {
                if (typeof exitBatchMode === 'function') exitBatchMode();
                else if (typeof deselectAll === 'function') deselectAll();
            }
            return true;
        } else {
            showError('下载管理器未就绪');
            return false;
        }
    } else if (selected === '缓存到服务器') {
        const isServerCacheAllowed = window.lx_config?.['user.enablePublicNonAdminServerCache'] !== false;
        if (isPublic && enablePublicRestriction && !isServerCacheAllowed && !isAdmin) {
            showError('权限限制：管理员已关闭非管理员服务器缓存功能，批量缓存需要验证管理员身份。');
            if (typeof window.handleAdminAuth === 'function') {
                const authorized = await window.handleAdminAuth('管理员已关闭非管理员服务器缓存功能，批量缓存需要验证管理员身份');
                if (!authorized) return false;
            } else {
                return false;
            }
        }

        // 使用全局音质优先级展示可选音质
        const availableQualities = getSelectableQualityOrder();
        const qualityDisplayNames = availableQualities.map(q => window.QualityManager ? window.QualityManager.getQualityDisplayName(q) : q);
        const selectedQualityDisplay = await showOptions('选择全局缓存音质', `请选择批量请求服务器缓存的音质，下载歌曲的音质将取不超过该音质的最大音质`, qualityDisplayNames);

        if (!selectedQualityDisplay) return false;
        const selectedQualityIndex = qualityDisplayNames.indexOf(selectedQualityDisplay);
        const targetQuality = availableQualities[selectedQualityIndex];

        if (!window.SystemDownloadManager) {
            showError('下载管理器未就绪');
            return false;
        }

        // 1. 直接将歌曲注册到下载管理器，由其内部调度器控制并发
        const tasks = songsToDownload.map(s => {
            return {
                ...s,
                taskId: 'server_' + (s.id || s.songmid),
                isServer: true,
                quality: targetQuality // 调度器启动时会重新计算最佳音质
            };
        });
        await window.SystemDownloadManager.addTasks(tasks);

        if (clearSelection) {
            if (typeof exitBatchMode === 'function') exitBatchMode();
            else if (typeof deselectAll === 'function') deselectAll();
        }
        showInfo(`已将 ${songsToDownload.length} 首歌曲加入缓存队列`);
        return true;
    }

    return false;
}

async function batchDownloadFromList() {
    if (selectedItems.size === 0) {
        showError('请先选择要下载的歌曲');
        return false;
    }

    // Convert IDs to Songs
    const songsToDownload = [];
    const findSong = (list, id) => list.find(s => String(s.id) === String(id));

    selectedItems.forEach(id => {
        let song = null;
        if (selectedSongObjects && selectedSongObjects.has(id)) song = selectedSongObjects.get(id);
        if (!song && typeof viewingPlaylist !== 'undefined' && viewingPlaylist) song = findSong(viewingPlaylist, id);
        if (!song && currentPlaylist) song = findSong(currentPlaylist, id);
        if (!song && currentListData) {
            if (currentListData.defaultList) song = findSong(currentListData.defaultList, id);
            if (!song && currentListData.loveList) song = findSong(currentListData.loveList, id);
            if (!song && currentListData.userList) {
                for (const uList of currentListData.userList) {
                    song = findSong(uList.list, id);
                    if (song) break;
                }
            }
        }
        if (song) songsToDownload.push(song);
    });

    if (songsToDownload.length === 0) {
        showError('未找到选中歌曲的详细信息');
        return false;
    }

    return batchDownloadSongs(songsToDownload);
}

// Re-use helper functions from batch_pagination.js
function getListById(listId) {
    if (!currentListData) return null;
    if (listId === 'default') return currentListData.defaultList;
    if (listId === 'love') return currentListData.loveList;
    const userList = currentListData.userList.find(l => l.id === listId);
    return userList ? userList.list : null;
}

function setListById(listId, newList) {
    if (!currentListData) return;
    if (listId === 'default') currentListData.defaultList = newList;
    else if (listId === 'love') currentListData.loveList = newList;
    else {
        const userList = currentListData.userList.find(l => l.id === listId);
        if (userList) userList.list = newList;
    }
}

// Export functions
window.deleteSingleSong = deleteSingleSong;
window.downloadSong = downloadSong;
window.batchDownloadSongs = batchDownloadSongs;
window.batchDownloadFromList = batchDownloadFromList;
window.requestServerLyricCache = requestServerLyricCache;
