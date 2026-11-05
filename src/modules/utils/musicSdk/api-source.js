// ========================================
// 服务器端版本的 api-source.js
// 移除了对 @renderer/store 的依赖
// ========================================

import apiSourceInfo from './api-source-info'

// 服务器端不使用内置的测试 API，全部走自定义源
// 如果需要内置 API，应该在各个源的 index.js 中单独导入
const allApi = {}

const apiList = {}
const supportQuality = {}

for (const api of apiSourceInfo) {
  supportQuality[api.id] = api.supportQualitys
  for (const source of Object.keys(api.supportQualitys)) {
    apiList[`${api.id}_api_${source}`] = allApi[`${api.id}_${source}`]
  }
}

// 服务器端的 userApi 引用
// 注意：这个模块会在运行时动态导入，避免循环依赖
let userApiModule = null

const getUserApi = () => {
  if (!userApiModule) {
    try {
      // 延迟加载 userApi 模块
      userApiModule = require('../../../server/sources/userApi')
    } catch (err) {
      console.error('[api-source] Failed to load userApi:', err.message)
      userApiModule = { getLoadedApis: () => [] }
    }
  }
  return userApiModule
}

// 获取已加载的自定义源 API
const getUserApis = () => {
  const userApi = getUserApi()
  const loadedApis = userApi.getLoadedApis ? userApi.getLoadedApis() : []

  // 构建 apis 对象，格式类似桌面端的 userApi.apis
  const apis = {}

  for (const apiInfo of loadedApis) {
    if (!apiInfo.enabled || !apiInfo.sources) continue

    for (const source of Object.keys(apiInfo.sources)) {
      // 为每个源创建 API 方法
      apis[source] = {
        getMusicUrl: (songInfo, type) => {
          return userApi.callUserApiGetMusicUrl(source, songInfo, type)
        },
        // 其他方法可以在需要时添加
        // getLyric: (songInfo) => { ... },
        // getPic: (songInfo) => { ... },
      }
    }
  }

  return apis
}

const apis = source => {
  // 服务器端：优先使用自定义源
  const userApis = getUserApis()

  if (userApis[source]) {
    return userApis[source]
  }

  // 如果没有自定义源支持该音源，抛出错误
  // 各个音源的 index.js 应该自己实现回退逻辑
  throw new Error(`未找到支持 ${source} 平台的自定义源，请在设置中添加或启用相关源`)
}

export { apis, supportQuality }

