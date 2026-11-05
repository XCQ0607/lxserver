/**
 * 音质管理模块
 * 负责音质选择、智能降级和音质信息获取
 */

// 音质优先级定义（从高到低）
const QUALITY_PRIORITY = ['master', 'atmos_plus', 'atmos', 'hires', 'flac24bit', 'flac', '320k', '192k', '128k'];
const QUALITY_ORDER_LOW_TO_HIGH = [...QUALITY_PRIORITY].reverse();

// These platforms can resolve qualities that older saved playlist entries do not advertise.
// The server still performs the final availability check and quality fallback per song.
const PLATFORM_SELECTABLE_QUALITIES = {
    tx: ['128k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'atmos_plus', 'master'],
    wy: ['128k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'master'],
    kw: ['128k', '320k', 'flac', 'flac24bit', 'hires'],
    kg: ['128k', '320k', 'flac', 'flac24bit', 'hires'],
    mg: ['128k', '320k', 'flac']
};

// 音质显示名称
const QUALITY_NAMES = {
    master: '母带音质',
    atmos_plus: '增强空间音频',
    atmos: '空间音频',
    hires: '高解析度',
    flac24bit: '24bit无损',
    flac: '无损音质',
    '320k': '高音质',
    '192k': '192k',
    '128k': '128k'
};

// 音质颜色（用于 UI 显示）
const QUALITY_COLORS = {
    master: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-700/50',
    atmos_plus: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200 dark:bg-fuchsia-900/30 dark:text-fuchsia-300 dark:border-fuchsia-700/50',
    atmos: 'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300 dark:border-cyan-700/50',
    hires: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800/50',
    flac24bit: 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800/50',
    flac: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800/50',
    '320k': 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800/50',
    '192k': 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400 dark:border-indigo-800/50',
    '128k': 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700'
};

function getRawQualityData(songInfo) {
    if (!songInfo) return {};
    return songInfo.types || songInfo._types ||
        songInfo.qualitys || songInfo._qualitys ||
        (songInfo.meta && (songInfo.meta.qualitys || songInfo.meta._qualitys || songInfo.meta.types || songInfo.meta._types)) ||
        {};
}

function sortQualitiesLowToHigh(qualities) {
    return qualities.filter(Boolean).sort((a, b) => {
        const aIndex = QUALITY_ORDER_LOW_TO_HIGH.indexOf(a);
        const bIndex = QUALITY_ORDER_LOW_TO_HIGH.indexOf(b);
        const aRank = aIndex === -1 ? QUALITY_ORDER_LOW_TO_HIGH.length : aIndex;
        const bRank = bIndex === -1 ? QUALITY_ORDER_LOW_TO_HIGH.length : bIndex;
        return aRank - bRank;
    });
}

function isQualityEntryAvailable(entry) {
    if (!entry) return false;
    if (typeof entry === 'object') return !entry.isPlatformQuality;
    return true;
}

function getAvailableQualities(songInfo) {
    if (!songInfo) return ['128k'];

    const types = getRawQualityData(songInfo);

    if (Array.isArray(types)) {
        return sortQualitiesLowToHigh(types.filter(isQualityEntryAvailable).map(t => t.type || t));
    }

    return sortQualitiesLowToHigh(Object.keys(types).filter(k => isQualityEntryAvailable(types[k])));
}

function getSelectableQualities(songInfo) {
    const source = songInfo?.source || songInfo?.meta?.source;
    const platformQualities = PLATFORM_SELECTABLE_QUALITIES[source];
    return platformQualities ? [...platformQualities] : getAvailableQualities(songInfo);
}

function getBestQuality(songInfo, userPreference = '320k') {
    if (!songInfo) return '128k';

    const availableQualities = getAvailableQualities(songInfo);
    if (availableQualities.length === 0) {
        console.warn('[Quality] 歌曲无音质信息，使用默认 128k');
        return '128k';
    }

    const startIndex = QUALITY_PRIORITY.indexOf(userPreference);
    if (startIndex === -1) {
        console.warn(`[Quality] 无效的音质偏好: ${userPreference}`);
        return availableQualities[0] || '128k';
    }

    for (let i = startIndex; i < QUALITY_PRIORITY.length; i++) {
        const quality = QUALITY_PRIORITY[i];
        if (availableQualities.includes(quality)) {
            console.log(`[Quality] 选择音质: ${quality} (偏好: ${userPreference})`);
            return quality;
        }
    }

    console.warn('[Quality] 无匹配音质，使用第一个可用:', availableQualities[0]);
    return availableQualities[0] || '128k';
}

function getNextLowerQuality(currentQuality, songInfo = null) {
    const index = QUALITY_PRIORITY.indexOf(currentQuality);
    if (index === -1 || index === QUALITY_PRIORITY.length - 1) {
        return null;
    }

    const available = songInfo ? getAvailableQualities(songInfo) : null;
    for (let i = index + 1; i < QUALITY_PRIORITY.length; i++) {
        const q = QUALITY_PRIORITY[i];
        if (!available || available.includes(q)) {
            return q;
        }
    }
    return null;
}

function getQualityDisplayName(quality) {
    return QUALITY_NAMES[quality] || String(quality || '').toUpperCase();
}

function getQualityColor(quality) {
    return QUALITY_COLORS[quality] || QUALITY_COLORS['128k'];
}

function isQualityAvailable(songInfo, quality) {
    return getAvailableQualities(songInfo).includes(quality);
}

// 导出到全局
window.QualityManager = {
    QUALITY_PRIORITY,
    QUALITY_ORDER_LOW_TO_HIGH,
    PLATFORM_SELECTABLE_QUALITIES,
    QUALITY_NAMES,
    QUALITY_COLORS,
    getBestQuality,
    getNextLowerQuality,
    getAvailableQualities,
    getSelectableQualities,
    getQualityDisplayName,
    getQualityColor,
    isQualityAvailable
};

console.log('[Quality] 音质管理模块已加载');
