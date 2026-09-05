import { VM } from 'vm2'
import * as fs from 'fs'
import * as path from 'path'

import needle from 'needle'
import * as crypto from 'crypto'
import * as zlib from 'zlib'
import { promisify } from 'util'

import * as tunnel from 'tunnel'
const inflate = promisify(zlib.inflate)
const deflate = promisify(zlib.deflate)

// 彻底切断与沙箱上下文的联系
function decontextify(obj: any): any {
    if (obj === null || obj === undefined) return obj

    // 非对象直接返回
    if (typeof obj !== 'object') return obj

    // 处理 Buffer (极其重要：使用 Uint8Array 中转以切断 Proxy 链)
    try {
        if (Buffer.isBuffer(obj) || obj instanceof Uint8Array || (obj && obj.constructor && obj.constructor.name === 'Buffer')) {
            return Buffer.from(Uint8Array.from(obj as any))
        }
    } catch (e) { }

    // 处理数组
    if (Array.isArray(obj)) {
        try {
            return obj.map(item => decontextify(item))
        } catch (e) {
            return []
        }
    }

    // 处理 Error (增加对沙箱内 Error 的识别)
    if (obj instanceof Error || (obj && obj.constructor && obj.constructor.name === 'Error')) {
        const err = new Error(obj.message)
        err.stack = obj.stack
        return err
    }

    // 处理普通对象 (预防 Proxy Traps)
    try {
        const newObj: any = {}
        const keys = Object.keys(obj)
        for (const key of keys) {
            try {
                newObj[key] = decontextify(obj[key])
            } catch (e) { }
        }
        return newObj
    } catch (e) {
        try {
            const str = JSON.stringify(obj)
            return str ? JSON.parse(str) : String(obj)
        } catch (e2) {
            return String(obj)
        }
    }
}

// 用户API信息接口
interface UserApiInfo {
    id: string
    name: string
    description: string
    version: number | string
    author: string
    homepage: string
    script: string
    sources: Record<string, any>
    enabled: boolean
    owner: string // 'open' or username
    allowUnsafeVM?: boolean
}

// 加载的 API 实例
const loadedApis = new Map<string, any>()

// API 初始化状态追踪 map<id, status>
const apiStatus = new Map<string, { status: 'success' | 'failed', error?: string }>()

export function getApiStatus(owner: string, id: string) {
    return apiStatus.get(`${owner}_${id}`)
}


// 从脚本注释中提取元数据
export function extractMetadata(script: string): Partial<UserApiInfo> {
    const meta: any = {}

    // 匹配 JSDoc 风格的注释 (支持 /*! 和 /**)
    const commentMatch = script.match(/\/\*[*!]([\s\S]*?)\*\//)
    if (commentMatch) {
        const comment = commentMatch[1]

        // @name
        const nameMatch = comment.match(/@name\s+(.+)/)
        if (nameMatch) meta.name = nameMatch[1].trim()

        // @description
        const descMatch = comment.match(/@description\s+(.+)/)
        if (descMatch) meta.description = descMatch[1].trim()

        // @version
        const verMatch = comment.match(/@version\s+(.+)/)
        if (verMatch) meta.version = verMatch[1].trim()

        // @author
        const authorMatch = comment.match(/@author\s+(.+)/)
        if (authorMatch) meta.author = authorMatch[1].trim()

        // @repository or @homepage
        const repoMatch = comment.match(/@(?:repository|homepage)\s+(.+)/)
        if (repoMatch) meta.homepage = repoMatch[1].trim()
    }

    return meta
}

// 创建 lx.request 包装器（使用 needle）
function createLxRequest(isUnsafe: boolean = false) {
    return (url: string, options: any, callback: Function) => {
        const safeOptions = decontextify(options || {})
        const { method = 'get', timeout, headers, body, form, formData } = safeOptions

        let requestOptions: any = {
            headers,
            follow_max: 5,
            response_timeout: typeof timeout === 'number' && timeout > 0 ? Math.min(timeout, 60000) : 60000
        }

        let data = body
        if (form) {
            data = form
            requestOptions.json = false
        } else if (formData) {
            data = formData
            requestOptions.json = false
        }

        const request = needle.request(method, url, data, requestOptions, (err: any, resp: any, body: any) => {
            try {
                if (err) {
                    callback.call(null, decontextify(err), null, null)
                } else {
                    let parsedBody = body
                    if (typeof body === 'string') {
                        try {
                            parsedBody = JSON.parse(body)
                        } catch { }
                    }

                    let safeResp: any = {
                        statusCode: resp.statusCode,
                        statusMessage: resp.statusMessage,
                        headers: resp.headers,
                        body: decontextify(parsedBody)
                    }

                    // 核心修复：原生 VM 模式下，将响应对象通过 JSON 转换以修复原型链，但保留原始 Body 引用（如果不是对象）
                    if (isUnsafe) {
                        const jsonBody = (typeof parsedBody === 'object' && !Buffer.isBuffer(parsedBody))
                            ? JSON.parse(JSON.stringify(parsedBody))
                            : parsedBody;

                        safeResp = JSON.parse(JSON.stringify({
                            statusCode: resp.statusCode,
                            statusMessage: resp.statusMessage,
                            headers: resp.headers
                        }));
                        safeResp.body = jsonBody;
                    }

                    callback.call(null, null, safeResp, safeResp.body)
                }
            } catch (error: any) {
                callback.call(null, decontextify(error), null, null)
            }
        })

        return () => {
            const reqObj = (request as any).request
            if (reqObj && !reqObj.aborted) reqObj.abort()
        }
    }
}

// 加载自定义源脚本
export async function loadUserApi(apiInfo: UserApiInfo): Promise<any> {
    // 从脚本中提取元数据
    const metadata = extractMetadata(apiInfo.script)
    const fullApiInfo = { ...apiInfo, ...metadata }

    // 创建事件处理映射
    const eventHandlers = new Map<string, Function>()
    let registeredSources: any = {}

    // ========== 关键修改：提前创建 initPromise ==========
    let initResolve: (() => void) | null = null
    let initReject: ((err: Error) => void) | null = null
    const initPromise = new Promise<void>((resolve, reject) => {
        initResolve = resolve
        initReject = reject
    })
    // ==================================================

    // lx 环境数据准备
    const lxDataInside = {
        version: '2.0.0',
        env: 'desktop',
        platform: 'web',
        currentScriptInfo: {
            name: fullApiInfo.name,
            description: fullApiInfo.description,
            version: fullApiInfo.version,
            author: fullApiInfo.author,
            homepage: fullApiInfo.homepage,
            rawScript: fullApiInfo.script,
        },
        EVENT_NAMES: {
            request: 'request',
            inited: 'inited',
            updateAlert: 'updateAlert'
        }
    }

    // 构建 lx 工具集
    const lxUtils = {
        buffer: {
            from: (d: any, e: any) => Buffer.from(decontextify(d), decontextify(e)),
            bufToString: (b: any, f: any) => Buffer.isBuffer(b) ? b.toString(f) : Buffer.from(b, 'binary').toString(f)
        },
        crypto: {
            md5: (str: string) => crypto.createHash('md5').update((decontextify(str) || '') as any).digest('hex'),
            aesEncrypt: (buffer: any, mode: string, key: any, iv: any) => {
                const dKey = decontextify(key)
                const dIv = decontextify(iv)
                const dBuffer = decontextify(buffer)
                const algorithm = `aes-${(dKey as any).length * 8}-${mode}`
                const cipher = crypto.createCipheriv(algorithm as any, dKey as any, dIv as any)
                return Buffer.concat([cipher.update(dBuffer as any) as any, cipher.final() as any])
            },
            rsaEncrypt: (buffer: any, key: any) => crypto.publicEncrypt(decontextify(key) as any, decontextify(buffer) as any),
            randomBytes: (size: number) => crypto.randomBytes(size),
        },
        zlib: {
            inflate: (buffer: any) => inflate(decontextify(buffer) as any),
            deflate: (buffer: any) => deflate(decontextify(buffer) as any),
        }
    }

    // 核心 lx 对象
    const lxObject = {
        ...lxDataInside,
        utils: lxUtils,
        request: createLxRequest(!!apiInfo.allowUnsafeVM && !!global.lx.config['system.allowUnsafeVM']),
        send: (eventName: string, data: any) => {
            const dData = decontextify(data)
            // console.log(`[UserApi-${fullApiInfo.name}] send:`, eventName)
            if (eventName === 'inited') {
                if (dData && dData.sources) {
                    registeredSources = dData.sources
                    console.log(`[UserApi-${fullApiInfo.name}] Registered sources:`, Object.keys(registeredSources).join(', '))
                }
                if (initResolve) initResolve()
            } else if (eventName === 'updateAlert') {
                const error = new Error(`发现新版本,需要更新: ${JSON.stringify(dData)}`)
                if (initReject) initReject(error)
            }
        },
        on: (eventName: string, handler: Function) => {
            // console.log(`[UserApi-${fullApiInfo.name}] on:`, eventName)
            if (eventName === 'request') {
                eventHandlers.set(eventName, handler)
            }
        }
    }

    // 完整沙箱环境
    const sandbox: any = {
        // console: {
        //     log: () => { }, // 静默脚本内部的普通日志
        //     info: () => { },
        //     error: console.error,
        //     warn: console.warn,
        //     debug: console.debug,
        //     time: console.time,
        //     timeEnd: console.timeEnd
        // },
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Buffer,
        URL,
        URLSearchParams,
        TextEncoder,
        TextDecoder,
        process: {
            nextTick: (fn: Function, ...args: any[]) => setTimeout(() => fn(...args), 0),
            env: { NODE_ENV: process.env.NODE_ENV || 'production' }
        },
        lx: lxObject,
        // 关键：适配混淆脚本对全局变量的引用
        global: null,
        window: null,
        globalThis: null,
        atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
        btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
        crypto: crypto
    }
    sandbox.global = sandbox
    sandbox.window = sandbox
    sandbox.globalThis = sandbox

    try {
        if (apiInfo.allowUnsafeVM && global.lx.config['system.allowUnsafeVM']) {
            console.log(`[UserApi] ${fullApiInfo.name} 正在以原生 VM 模式启动...`)
            const vm = require('vm')
            const context = vm.createContext(sandbox)
            // 不再注入 injectionCode 字符串，环境已在 sandbox 中就绪
            vm.runInContext(apiInfo.script, context, {
                filename: `custom_source_${fullApiInfo.id}.js`,
                timeout: 10000
            })
        } else {
            // 保持 vm2 逻辑用于安全模式
            try {
                const vmInstance = new VM({
                    timeout: 10000,
                    sandbox,
                    eval: true,
                    wasm: false,
                })
                await vmInstance.run(apiInfo.script)
            } catch (e: any) {
                const isContextError = e.message.includes('contextified object') || e.message.includes('Operation not allowed')
                if (isContextError) {
                    console.warn(`[UserApi] ${fullApiInfo.name} 触发 vm2 安全限制，正在提示用户开启 VM 模式`)
                    throw new Error('REQUIRE_UNSAFE_VM')
                }
                throw e
            }
        }

        // 等待脚本调用 lx.send('inited')（最多等待 3 秒）
        await Promise.race([
            initPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('初始化超时，请确保脚本调用了 lx.send("inited", ...)')), 3000))
        ])

        // 保存加载 of the API
        const apiInstance = {
            info: { ...fullApiInfo, sources: registeredSources },
            handlers: eventHandlers,
            callRequest: async (action: string, source: string, info: any) => {
                try {
                    const handler = eventHandlers.get('request')
                    if (!handler) throw new Error(`源 ${fullApiInfo.name} 未注册 request 处理器`)

                    // 核心修复：如果是原生 VM 模式，将传入数据 JSON 化以纯净化原型链（确保它是 VM 内的对象）
                    let inputData = { action, source, info }
                    if (apiInfo.allowUnsafeVM && global.lx.config['system.allowUnsafeVM']) {
                        inputData = JSON.parse(JSON.stringify(inputData))
                    }

                    const result = await handler(inputData)
                    return decontextify(result)
                } catch (e: any) {
                    console.error(`[UserApi-${fullApiInfo.name}] callRequest Error:`, e.message)
                    throw e
                }
            }
        }

        loadedApis.set(`${fullApiInfo.owner}_${apiInfo.id}`, apiInstance)
        console.log(`[UserApi] ✓ 成功加载: ${fullApiInfo.name} v${fullApiInfo.version} (Owner: ${fullApiInfo.owner})`)
        console.log(`[UserApi]   支持源: ${Object.keys(registeredSources).join(', ')}`)
        return { success: true, apiInstance, error: null }
    } catch (error: any) {
        console.error(`[UserApi] ✗ 加载失败 ${fullApiInfo.name}:`, error.message)
        if (error.stack && error.message !== 'REQUIRE_UNSAFE_VM') {
            console.error(`[UserApi] [Stack] ${fullApiInfo.name}:`, error.stack)
        }

        let isRequireUnsafe = !apiInfo.allowUnsafeVM && (error.message === 'REQUIRE_UNSAFE_VM' || error.message.includes('初始化超时') || error.message.includes('timeout'))

        // 如果在 VM2 模式下加载失败，且系统允许 VM 模式，尝试测试原生 VM 模式能否成功加载
        if (!isRequireUnsafe && !apiInfo.allowUnsafeVM && global.lx.config['system.allowUnsafeVM']) {
            try {
                const testUnsafeRes = await loadUserApi({
                    ...apiInfo,
                    id: `${apiInfo.id}_test_vm`,
                    allowUnsafeVM: true
                })
                if (testUnsafeRes.success) {
                    console.log(`[UserApi] ${fullApiInfo.name} 在 VM2 模式下失败，但在原生 VM 模式下成功，标记 requireUnsafe = true`)
                    isRequireUnsafe = true
                }
            } catch (e) { }
        }

        return { success: false, apiInstance: null, error: error.message, requireUnsafe: isRequireUnsafe }
    }
}

// 调用自定义源的 getMusicUrl
export async function callUserApiGetMusicUrl(
    source: string,
    songInfo: any,
    quality: string,
    clientUsername?: string,
    onProgress?: (attempt: any) => Promise<void> | void,
    enableAutoSwitchApiSource?: boolean,
    excludeApiSources?: string[]
): Promise<{ url: string, type: string, sourceName?: string, sourceId?: string, attempts?: any[], hasMoreSources?: boolean }> {
    // 标准化 songInfo 格式：将 meta 中的字段提升到顶层
    const normalizedSongInfo = { ...songInfo }
    if (songInfo.meta) {
        // 将 meta 中的所有字段展开到顶层
        Object.assign(normalizedSongInfo, songInfo.meta)

        // ========== 通用字段映射 ==========
        // songId -> songmid (通用)
        if (songInfo.meta.songId && !normalizedSongInfo.songmid) {
            normalizedSongInfo.songmid = songInfo.meta.songId
        }

        // 图片字段统一
        if (songInfo.meta.picUrl && !normalizedSongInfo.img) {
            normalizedSongInfo.img = songInfo.meta.picUrl
        }

        // 音质信息
        if (songInfo.meta.qualitys && !normalizedSongInfo.types) {
            normalizedSongInfo.types = songInfo.meta.qualitys
        }
        if (songInfo.meta._qualitys && !normalizedSongInfo._types) {
            normalizedSongInfo._types = songInfo.meta._qualitys
        }

        // ========== 各平台特有字段 ==========
        // 酷狗 (kg): hash, albumId
        if (songInfo.meta.hash && !normalizedSongInfo.hash) {
            normalizedSongInfo.hash = songInfo.meta.hash
        }
        if (songInfo.meta.albumId && !normalizedSongInfo.albumId) {
            normalizedSongInfo.albumId = songInfo.meta.albumId
        }

        // 咪咕 (mg): copyrightId, lrcUrl, mrcUrl, trcUrl
        if (songInfo.meta.copyrightId && !normalizedSongInfo.copyrightId) {
            normalizedSongInfo.copyrightId = songInfo.meta.copyrightId
        }
        if (songInfo.meta.lrcUrl && !normalizedSongInfo.lrcUrl) {
            normalizedSongInfo.lrcUrl = songInfo.meta.lrcUrl
        }
        if (songInfo.meta.mrcUrl && !normalizedSongInfo.mrcUrl) {
            normalizedSongInfo.mrcUrl = songInfo.meta.mrcUrl
        }
        if (songInfo.meta.trcUrl && !normalizedSongInfo.trcUrl) {
            normalizedSongInfo.trcUrl = songInfo.meta.trcUrl
        }

        // QQ音乐 (tx): strMediaMid, albumMid
        if (songInfo.meta.strMediaMid && !normalizedSongInfo.strMediaMid) {
            normalizedSongInfo.strMediaMid = songInfo.meta.strMediaMid
        }
        if (songInfo.meta.albumMid && !normalizedSongInfo.albumMid) {
            normalizedSongInfo.albumMid = songInfo.meta.albumMid
        }

        // 不再删除 meta 对象，以免有些严谨的脚本报错（许多脚本会读取 info.meta）
        // delete normalizedSongInfo.meta
    }

    // ========== 顶层字段兜底映射 ==========
    if (!normalizedSongInfo.hash && songInfo.hash) {
        normalizedSongInfo.hash = songInfo.hash
    }
    if (!normalizedSongInfo.copyrightId && songInfo.copyrightId) {
        normalizedSongInfo.copyrightId = songInfo.copyrightId
    }
    if (!normalizedSongInfo.strMediaMid && songInfo.strMediaMid) {
        normalizedSongInfo.strMediaMid = songInfo.strMediaMid
    }
    if (!normalizedSongInfo.albumMid && songInfo.albumMid) {
        normalizedSongInfo.albumMid = songInfo.albumMid
    }
    if (!normalizedSongInfo.albumId && songInfo.albumId) {
        normalizedSongInfo.albumId = songInfo.albumId
    }
    if (!normalizedSongInfo.lrcUrl && songInfo.lrcUrl) {
        normalizedSongInfo.lrcUrl = songInfo.lrcUrl
    }
    if (!normalizedSongInfo.mrcUrl && songInfo.mrcUrl) {
        normalizedSongInfo.mrcUrl = songInfo.mrcUrl
    }
    if (!normalizedSongInfo.trcUrl && songInfo.trcUrl) {
        normalizedSongInfo.trcUrl = songInfo.trcUrl
    }
    if (typeof normalizedSongInfo.hash === 'string' && !normalizedSongInfo.hash) {
        delete normalizedSongInfo.hash
    }

    let supportedCount = 0;
    let lastError: Error | null = null;

    // 查找支持该 source 的 API
    // 收集所有支持该 source 的 API，并根据权限过滤
    let candidates: any[] = []
    const userApiIds = new Set<string>()

    // 读取当前用户的公开源状态覆盖（启用/禁用）以及私有源 ID 集合
    let userStates: Record<string, any> = {}
    const dataPath = process.env.DATA_PATH || path.join(process.cwd(), 'data')
    if (clientUsername && clientUsername !== 'default') {
        const userPath = path.join(dataPath, 'users', 'source', clientUsername)
        const statesPath = path.join(userPath, 'states.json')
        const metaPath = path.join(userPath, 'sources.json')

        if (fs.existsSync(statesPath)) {
            try { userStates = JSON.parse(fs.readFileSync(statesPath, 'utf-8')) } catch (e) { }
        }
        // 预收集私有源 ID（用于屏蔽同名公开源）
        if (fs.existsSync(metaPath)) {
            try {
                const userSources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
                for (const s of userSources) userApiIds.add(s.id)
            } catch (e) { }
        }
    } else {
        const openStatesPath = path.join(dataPath, 'users', 'source', '_open', 'states.json')
        if (fs.existsSync(openStatesPath)) {
            try { userStates = JSON.parse(fs.readFileSync(openStatesPath, 'utf-8')) } catch (e) { }
        }
    }

    const getSourceState = (id: string) => {
        return userStates[id] || userStates[decodeURIComponent(id)] || userStates[encodeURIComponent(id)] || {}
    }

    // 按 loadedApis 收集所有可用候选源（权限过滤，不强制任何顺序）
    for (const [apiId, api] of loadedApis) {
        if (!api.info.sources || !api.info.sources[source]) continue

        const state = getSourceState(api.info.id)

        if (api.info.owner === 'open') {
            // 计算公开源对当前用户的有效启用状态
            let isEnabled = api.info.enabled
            if (clientUsername && clientUsername !== 'default') {
                if (typeof state.enabled === 'boolean') {
                    isEnabled = state.enabled
                }
            }
            if (!isEnabled) continue
            if (userApiIds.has(api.info.id)) continue  // 被同名私有版本覆盖，跳过

            // 检查平台是否被禁用
            if (Array.isArray(state.disabledSources) && state.disabledSources.includes(source)) {
                continue
            }

            candidates.push(api)
        } else if (clientUsername && api.info.owner === clientUsername) {
            if (!api.info.enabled) continue

            // 检查平台是否被禁用
            if (Array.isArray(state.disabledSources) && state.disabledSources.includes(source)) {
                continue
            }

            candidates.push(api)
            userApiIds.add(api.info.id) // 兜底：确保后续不重复添加公开同名源
        }
    }

    // === 实时按 order.json 对候选列表排序 ===
    // 不依赖 loadedApis 的 Map 插入顺序（部分 reload 后顺序会乱），
    // 每次解析都直接读 order.json，无需重启服务器即可生效
    if (candidates.length > 1) {
        const dataPath = process.env.DATA_PATH || path.join(process.cwd(), 'data')
        let orderData: string[] = []

        // 优先读用户自己的排序（admin/order.json），再回退到公开源排序（_open/order.json）
        const orderCandidates = clientUsername && clientUsername !== 'default'
            ? [
                path.join(dataPath, 'users', 'source', clientUsername, 'order.json'),
                path.join(dataPath, 'users', 'source', '_open', 'order.json')
              ]
            : [path.join(dataPath, 'users', 'source', '_open', 'order.json')]

        for (const orderPath of orderCandidates) {
            if (fs.existsSync(orderPath)) {
                try {
                    orderData = JSON.parse(fs.readFileSync(orderPath, 'utf-8'))
                    if (orderData.length > 0) break
                } catch (e) { }
            }
        }

        if (orderData.length > 0) {
            const idToIndex = new Map(orderData.map((id, i) => [id, i]))
            candidates.sort((a: any, b: any) => {
                const ia = idToIndex.has(a.info.id) ? idToIndex.get(a.info.id)! : 999999
                const ib = idToIndex.has(b.info.id) ? idToIndex.get(b.info.id)! : 999999
                return ia - ib
            })
        }
    }
    // =========================================

    // === 排除已在当前请求中上报失败/失效的自定义源 ===
    if (Array.isArray(excludeApiSources) && excludeApiSources.length > 0) {
        const excludeSet = new Set(excludeApiSources.map(s => String(s).trim().toLowerCase()))
        candidates = candidates.filter(api => {
            const name = (api.info?.name || '').trim().toLowerCase()
            const id = (api.info?.id || '').trim().toLowerCase()
            return !excludeSet.has(name) && !excludeSet.has(id)
        })
    }

    if (enableAutoSwitchApiSource === false && candidates.length > 1) {
        candidates = [candidates[0]]
    }

    supportedCount = candidates.length

    if (supportedCount === 0) {
        const hasExcluded = Array.isArray(excludeApiSources) && excludeApiSources.length > 0
        const errMsg = hasExcluded
            ? `支持 ${source} 平台的自定义源均已尝试且无法播放（已尝试 ${excludeApiSources.length} 个音源）`
            : `未找到支持 ${source} 平台的自定义源，请在设置中添加或启用相关源`
        if (onProgress) await onProgress({ name: '系统', status: 'fail', message: errMsg })
        const err: any = new Error(errMsg)
        err.allSourcesExhausted = true
        throw err
    }

    // 逻辑分歧：
    // 1. 如果只有一个源支持 -> 重试 3 次
    // 2. 如果有多个源支持 -> 每个源试一次 (轮询)

    const attempts: any[] = []

    if (supportedCount === 1) {
        const api = candidates[0]
        const maxRetries = 3

        for (let i = 0; i < maxRetries; i++) {
            try {
                console.log(`[UserApi] 尝试 ${api.info.name} 获取 ${source} 音乐链接 (第 ${i + 1}/${maxRetries} 次, Owner: ${api.info.owner})`)

                const url = await api.callRequest('musicUrl', source, {
                    musicInfo: normalizedSongInfo,
                    quality: quality,
                    type: quality
                })

                console.log(`[UserApi] ✓ ${api.info.name} 成功返回链接 (Owner: ${api.info.owner})`)
                const att = { name: api.info.name, status: 'success', message: `第 ${i + 1} 次尝试成功` }
                attempts.push(att)
                if (onProgress) await onProgress(att)
                return { url, type: quality, sourceName: api.info.name, sourceId: api.info.id, attempts, hasMoreSources: false }
            } catch (error: any) {
                console.error(`[UserApi] ${api.info.name} 失败 (第 ${i + 1}/${maxRetries} 次):`, `音源日志：${error.message}`)
                lastError = error
                const att = { name: api.info.name, status: 'fail', message: `第 ${i + 1} 次尝试失败,音源日志：${error.message}` }
                attempts.push(att)
                if (onProgress) await onProgress(att)
                // 如果不是最后一次尝试，等待一小会儿
                if (i < maxRetries - 1) {
                    await new Promise(r => setTimeout(r, 1000))
                }
            }
        }
    } else {
        // 多个源，轮流尝试
        for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
            const api = candidates[candidateIndex]
            try {
                console.log(`[UserApi] 尝试 ${api.info.name} 获取 ${source} 音乐链接 (Owner: ${api.info.owner})`)

                const url = await api.callRequest('musicUrl', source, {
                    musicInfo: normalizedSongInfo,
                    quality: quality,
                    type: quality
                })

                console.log(`[UserApi] ✓ ${api.info.name} 成功返回链接 (Owner: ${api.info.owner})`)
                const att = { name: api.info.name, status: 'success' }
                attempts.push(att)
                if (onProgress) await onProgress(att)
                return {
                    url,
                    type: quality,
                    sourceName: api.info.name,
                    sourceId: api.info.id,
                    attempts,
                    hasMoreSources: candidateIndex < candidates.length - 1
                }
            } catch (error: any) {
                console.error(`[UserApi] ${api.info.name} 失败:`, `音源日志：${error.message}`)
                lastError = error
                const att = { name: api.info.name, status: 'fail', message: `音源日志：${error.message}` }
                attempts.push(att)
                if (onProgress) await onProgress(att)
                continue
            }
        }
    }

    const detailMsg = supportedCount === 1
        ? `自定义源 [${candidates[0].info.name}] 解析失败`
        : `已尝试了 ${supportedCount} 个支持 ${source} 平台的源，但全部解析失败`

    const finalError: any = new Error(`${detailMsg} (音源日志: ${lastError?.message})`)
    finalError.attempts = attempts
    throw finalError
}

// 辅助函数：加载指定目录下的源
async function loadSourcesFromDir(dirPath: string, owner: string, stats: { loadedCount: number }) {
    const metaPath = path.join(dirPath, 'sources.json')
    if (!fs.existsSync(metaPath)) {
        return
    }

    try {
        let sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        let needsSave = false

        // === 按 order.json 排序，确保 loadedApis 插入顺序 = 用户配置的优先级顺序 ===
        const orderPath = path.join(dirPath, 'order.json')
        if (fs.existsSync(orderPath)) {
            try {
                const order: string[] = JSON.parse(fs.readFileSync(orderPath, 'utf-8'))
                if (order.length > 0) {
                    const idToIndex = new Map(order.map((id, i) => [id, i]))
                    sources = [...sources].sort((a: any, b: any) => {
                        const ia = idToIndex.has(a.id) ? idToIndex.get(a.id)! : 999999
                        const ib = idToIndex.has(b.id) ? idToIndex.get(b.id)! : 999999
                        return ia - ib
                    })
                }
            } catch (e) { }
        }
        // =========================================================================

        for (const source of sources) {
            if (!source.enabled && owner !== 'open') {
                console.log(`[UserApi] [${owner}] 跳过已禁用: ${source.name}`)
                apiStatus.delete(`${owner}_${source.id}`)
                continue
            }

            const scriptPath = path.join(dirPath, source.id)
            if (!fs.existsSync(scriptPath)) {
                console.warn(`[UserApi] [${owner}] 脚本文件未找到: ${source.id}`)
                continue
            }

            try {
                const script = fs.readFileSync(scriptPath, 'utf-8')
                const metadata = extractMetadata(script)

                const result = await loadUserApi({
                    id: source.id,
                    name: metadata.name || source.name,
                    description: metadata.description || '',
                    version: metadata.version || 1,
                    author: metadata.author || '',
                    homepage: metadata.homepage || '',
                    script,
                    sources: {},
                    enabled: source.enabled, // 传递原本的开关状态
                    allowUnsafeVM: source.allowUnsafeVM, // 传递不安全模式标志
                    owner: owner // 设置 owner
                })

                if (result.success) {
                    stats.loadedCount++
                    apiStatus.set(`${owner}_${source.id}`, { status: 'success' })

                    // [Self-Healing] 检查并修复 supportedSources
                    const runtimeSources = Object.keys(result.apiInstance.info.sources).sort();
                    const storedSources = (source.supportedSources || []).sort();

                    if (JSON.stringify(runtimeSources) !== JSON.stringify(storedSources)) {
                        console.log(`[UserApi] [Fix] [${owner}] 更新源 ${source.name} 的支持列表: ${JSON.stringify(storedSources)} -> ${JSON.stringify(runtimeSources)}`);
                        source.supportedSources = runtimeSources;
                        if (metadata.version && source.version !== metadata.version) source.version = metadata.version;
                        if (metadata.author && source.author !== metadata.author) source.author = metadata.author;
                        if (metadata.description && source.description !== metadata.description) source.description = metadata.description;
                        if (metadata.homepage && source.homepage !== metadata.homepage) source.homepage = metadata.homepage;
                        needsSave = true;
                    }
                } else {
                    console.error(`[UserApi] [${owner}] 加载 ${metadata.name || source.name} 失败: ${result.error}`)
                    apiStatus.set(`${owner}_${source.id}`, { status: 'failed', error: result.error })
                }
            } catch (error: any) {
                console.error(`[UserApi] [${owner}] 加载 ${source.name} 失败:`, error.message)
                apiStatus.set(`${owner}_${source.id}`, { status: 'failed', error: error.message })
            }
        }

        if (needsSave) {
            // Write back using the original (file-order) sources array to avoid overwriting sources.json ordering
            const originalSources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
            const updatedMap = new Map(sources.map((s: any) => [s.id, s]))
            const merged = originalSources.map((s: any) => updatedMap.get(s.id) || s)
            fs.writeFileSync(metaPath, JSON.stringify(merged, null, 2));
            console.log(`[UserApi] [${owner}] 已更新 sources.json 元数据`);
        }
    } catch (error: any) {
        console.error(`[UserApi] [${owner}] 读取 sources.json 失败:`, error.message)
    }
}

// 文件监控相关
let fsWatcher: fs.FSWatcher | null = null
const lastReloadMap = new Map<string, number>() // 记录每个用户的最后加载时间

// 启动文件监控
function startWatcher(sourceRoot: string) {
    if (fsWatcher) return

    console.log(`[UserApi] 启动源文件监控: ${sourceRoot}`)
    const debounceMap = new Map<string, NodeJS.Timeout>()

    try {
        // Warning: recursive option for fs.watch is generally supported on Windows/macOS but not Linux
        // For better cross-platform support, chokidar would be preferred, but using fs.watch as requested/minimal dependency
        fsWatcher = fs.watch(sourceRoot, { recursive: true }, (eventType, filename) => {
            if (!filename) return

            // 仅关注 .js 和 sources.json 文件的变化
            if (!filename.endsWith('.js') && !filename.endsWith('sources.json')) {
                return
            }

            // 解析用户名 (目录名)
            // filename on Windows might be "username\file.js"
            const parts = (filename as string).split(path.sep)
            let username = parts[0]

            // 如果是 _open 目录，对应 'open' 用户
            if (username === '_open') {
                username = 'open'
            }

            // 简单的防抖处理
            if (debounceMap.has(username)) {
                clearTimeout(debounceMap.get(username)!)
            }

            debounceMap.set(username, setTimeout(() => {
                // 检查是否是最近刚手动加载过 (避免面板上传造成的重复加载)
                // 阈值设为 3000ms，假设手动上传触发的 reload 会在这个时间内完成
                const lastReload = lastReloadMap.get(username) || 0
                if (Date.now() - lastReload < 3000) {
                    console.log(`[UserApi] [Watcher] 忽略近期更新的文件变动 (视为手动上传): ${filename}`)
                    return
                }

                console.log(`[UserApi] [Watcher] 检测到文件变动 (${eventType}): ${filename} -> 重新加载 ${username}`)
                initUserApis(username).catch(err => {
                    console.error(`[UserApi] [Watcher] 重新加载失败:`, err)
                })
            }, 2000)) // 2秒防抖，等待文件写入完成
        })

        // 进程退出时关闭监听
        process.on('exit', () => {
            if (fsWatcher) fsWatcher.close()
        })
    } catch (e) {
        console.error('[UserApi] 启动文件监控失败:', e)
    }
}

// 从文件系统加载所有已启用的自定义源
// 路径变更：DATA_PATH/users/source/{username} 和 DATA_PATH/users/source/_open
export async function initUserApis(targetUser?: string) {
    const dataPath = process.env.DATA_PATH || path.join(process.cwd(), 'data')
    const sourceRoot = path.join(dataPath, 'users', 'source')
    const stats = { loadedCount: 0 }

    // 更新最后加载时间
    if (targetUser) {
        lastReloadMap.set(targetUser, Date.now())
    } else {
        // 全局加载
    }

    console.log(`[UserApi] ========================================`)

    // 如果根目录不存在，无需加载
    if (!fs.existsSync(sourceRoot)) {
        console.log(`[UserApi] Source root directory not found: ${sourceRoot}`)
        console.log(`[UserApi] ========================================`)
        return
    }

    // 尝试启动监控 (只会在第一次调用且无 watcher 时启动)
    if (!fsWatcher) {
        startWatcher(sourceRoot)
    }

    if (targetUser) {
        console.log(`[UserApi] 重新加载用户源: ${targetUser}`)
        // 清理该用户的旧源和状态
        for (const [key, api] of loadedApis.entries()) {
            if (api.info.owner === targetUser) {
                loadedApis.delete(key)
            }
        }
        for (const key of apiStatus.keys()) {
            if (key.startsWith(`${targetUser}_`)) {
                apiStatus.delete(key)
            }
        }

        // 加载该用户的源
        let dirName = targetUser

        // 特殊处理：如果是 'open'，对应目录是 '_open'
        if (targetUser === 'open') {
            dirName = '_open'
        }

        const userSourceDir = path.join(sourceRoot, dirName)
        if (fs.existsSync(userSourceDir)) {
            await loadSourcesFromDir(userSourceDir, targetUser, stats)
        }

    } else {
        console.log(`[UserApi] 初始化所有自定义源...`)
        loadedApis.clear()

        // 扫描 sourceRoot 下的所有子目录
        try {
            const entries = fs.readdirSync(sourceRoot, { withFileTypes: true })
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    let owner = entry.name
                    // 如果目录是 _open，owner 为 'open'
                    if (entry.name === '_open') {
                        owner = 'open'
                    }

                    const dirPath = path.join(sourceRoot, entry.name)
                    await loadSourcesFromDir(dirPath, owner, stats)
                }
            }
        } catch (error: any) {
            console.error('[UserApi] 扫描源目录失败:', error.message)
        }
    }

    console.log(`[UserApi] 本次加载: ${stats.loadedCount} 个源`)
    console.log(`[UserApi] 当前总计: ${loadedApis.size} 个源`)
    console.log(`[UserApi] ========================================`)
}

// 获取所有已加载的 API
export function getLoadedApis() {
    return Array.from(loadedApis.values()).map(api => api.info)
}

// 检查某个源是否被支持
// clientUsername: 调用者的用户名。如果未提供，则只能检查 open 源
export function isSourceSupported(source: string, clientUsername?: string): boolean {
    const dataPath = process.env.DATA_PATH || path.join(process.cwd(), 'data')
    let userStates: Record<string, any> = {}
    if (clientUsername && clientUsername !== 'default') {
        const statesPath = path.join(dataPath, 'users', 'source', clientUsername, 'states.json')
        if (fs.existsSync(statesPath)) {
            try { userStates = JSON.parse(fs.readFileSync(statesPath, 'utf-8')) } catch (e) { }
        }
    } else {
        const openStatesPath = path.join(dataPath, 'users', 'source', '_open', 'states.json')
        if (fs.existsSync(openStatesPath)) {
            try { userStates = JSON.parse(fs.readFileSync(openStatesPath, 'utf-8')) } catch (e) { }
        }
    }

    const getSourceState = (id: string) => {
        return userStates[id] || userStates[decodeURIComponent(id)] || userStates[encodeURIComponent(id)] || {}
    }

    for (const [apiId, api] of loadedApis) {
        if (!api.info.sources || !api.info.sources[source]) {
            continue
        }

        const state = getSourceState(api.info.id)
        let isEnabled = api.info.enabled
        if (api.info.owner === 'open' && clientUsername && clientUsername !== 'default') {
            if (typeof state.enabled === 'boolean') {
                isEnabled = state.enabled
            }
        }
        if (!isEnabled) continue

        // 检查平台是否被禁用
        if (Array.isArray(state.disabledSources) && state.disabledSources.includes(source)) {
            continue
        }

        // 权限检查
        if (api.info.owner === 'open' || (clientUsername && api.info.owner === clientUsername)) {
            return true
        }
    }
    return false
}
