import * as fs from 'fs'
import * as path from 'path'
import { extractMetadata, loadUserApi, initUserApis, getApiStatus } from './userApi'
import type { IncomingMessage, ServerResponse } from 'http'

// 读取请求体
async function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: any[] = []
        req.on('data', chunk => { chunks.push(chunk) })
        req.on('end', () => {
            const buffer = Buffer.concat(chunks)
            resolve(buffer.toString('utf-8'))
        })
        req.on('error', reject)
    })
}

// 验证脚本
export async function handleValidate(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { script, username, allowUnsafeVM } = JSON.parse(body)

        // 鉴权逻辑：只有已登录用户（非 default）可以免密码验证
        const targetOwner = (username && username !== 'default') ? username : 'open'
        if (targetOwner === 'open') {
            const auth = req.headers['x-frontend-auth']
            if (auth !== global.lx.config['frontend.password']) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '权限不足：管理自定义源需要先验证管理员身份。' }))
                return
            }
        }

        if (!script || typeof script !== 'string') {
            throw new Error('Invalid script content')
        }

        const metadata = extractMetadata(script)

        // 尝试加载验证
        const result = await loadUserApi({
            id: 'temp_validation',
            script,
            enabled: false,
            allowUnsafeVM: !!allowUnsafeVM,
            ...metadata,
            owner: 'temp' // 临时验证 owner
        } as any)

        if (result.success) {
            // 检查是否注册了任何源
            const api = result.apiInstance
            const sources = api?.info?.sources || {}
            const sourcesCount = Object.keys(sources).length

            if (sourcesCount === 0) {
                throw new Error('脚本没有注册任何音源。请确保脚本正确调用了 lx.send("inited", { sources: {...} })')
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
                valid: true,
                metadata,
                sources: Object.keys(sources),
                sourcesCount
            }))
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
                valid: false,
                error: result.error,
                requireUnsafe: result.requireUnsafe,
                disabledVM: result.requireUnsafe && !global.lx.config['system.allowUnsafeVM'],
                metadata // 即使验证失败也返回元数据，方便前端展示
            }))
        }
    } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ valid: false, error: err.message }))
    }
}

// 辅助函数：获取脚本信息（元数据和支持的源）
async function getScriptInfo(scriptContent: string, allowUnsafeVM: boolean = false) {
    const metadata = extractMetadata(scriptContent)

    // 试运行脚本以获取支持的源
    let supportedSources: string[] = []
    let requireUnsafe = false
    try {
        const result = await loadUserApi({
            id: 'temp_analysis_' + Date.now(),
            script: scriptContent,
            enabled: false,
            allowUnsafeVM,
            ...metadata,
            owner: 'temp'
        } as any)

        if (result.success && result.apiInstance?.info?.sources) {
            supportedSources = Object.keys(result.apiInstance.info.sources)
        } else {
            requireUnsafe = !!result.requireUnsafe
        }
    } catch (e: any) {
        console.warn('[CustomSource] 分析脚本支持源失败:', e.message)
    }

    return { metadata, supportedSources, requireUnsafe }
}

// 辅助函数：获取源存储目录
function getSourceDir(username?: string) {
    const dataPath = process.env.DATA_PATH || path.join(process.cwd(), 'data')
    const root = path.join(dataPath, 'users', 'source')
    // 如果 username 是 'open' 或 'default' 或空，则映射到 '_open'
    const targetDirName = (username && username !== 'default' && username !== 'open') ? username : '_open'
    return path.join(root, targetDirName)
}

// 辅助函数：生成可读且唯一的 ID/文件名
function generateId(name?: string, fallbackFilename?: string): string {
    let input = name || fallbackFilename || 'source'

    // 尝试解码，防止输入已经是 URL 编码的状态
    try {
        input = decodeURIComponent(input)
    } catch (e) {
        // 忽略解码错误（例如包含不合法的 % 字符）
    }

    // 如果是路径，只取最后一部分
    let base = path.basename(input)

    // 统一移除 .js 后缀，后面再补上，确保一致性
    if (base.toLowerCase().endsWith('.js')) {
        base = base.slice(0, -3)
    }

    // 过滤掉文件系统非法字符，保持中文等字符可读
    const clean = base.replace(/[\\/:*?"<>|]/g, '_').trim()

    return `${clean || 'source'}.js`
}

// 上传脚本
export async function handleUpload(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { filename, content, username, allowUnsafeVM } = JSON.parse(body)

        // 确定 owner 用于后续标识
        const targetOwner = (username && username !== 'default') ? username : 'open'

        // 检查权限限制 (针对公开源)
        if (targetOwner === 'open') {
            const auth = req.headers['x-frontend-auth']
            if (auth !== global.lx.config['frontend.password']) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '公共源管理已受限，仅管理员可操作。' }))
                return
            }
        }

        const sourcesDir = getSourceDir(username)
        const metaPath = path.join(sourcesDir, 'sources.json')

        // 创建目录
        if (!fs.existsSync(sourcesDir)) {
            fs.mkdirSync(sourcesDir, { recursive: true })
        }

        // 获取脚本信息
        const { metadata, supportedSources, requireUnsafe } = await getScriptInfo(content, allowUnsafeVM)

        // 核心安全校验：若脚本需要或者指定了 unsafe VM 模式，则必须验证管理员身份
        if (requireUnsafe || allowUnsafeVM) {
            const auth = req.headers['x-frontend-auth']
            if (auth !== global.lx.config['frontend.password']) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '允许以 VM 模式运行脚本需要验证管理员身份。' }))
                return
            }
        }

        // 如果检测到需要不安全模式
        if (requireUnsafe) {
            // 如果系统已禁用 VM 模式
            if (!global.lx.config['system.allowUnsafeVM']) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, disabledVM: true, error: 'VM_DISABLED', message: '已禁用VM。该脚本需要原生 VM 模式运行，但服务器后台已禁用 VM 模式。' }))
                return
            }

            // 如果未提供标志，则要求确认
            if (!allowUnsafeVM) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, requireUnsafe: true, message: '该脚本需要原生 VM 模式运行，可能存在安全风险，是否继续？' }))
                return
            }
        }

        // 生成唯一ID（可读的文件名）
        const id = generateId(metadata.name, filename)
        const scriptPath = path.join(sourcesDir, id)

        // 读取现有列表
        let sources: any[] = []
        if (fs.existsSync(metaPath)) {
            sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        }

        // 检查是否已存在
        const existing = sources.find(s => s.id === id)
        if (existing) {
            throw new Error(`源 "${metadata.name || filename}" 已存在于 [${targetOwner}]`)
        }

        // 保存脚本文件
        fs.writeFileSync(scriptPath, content, 'utf-8')

        // 更新元数据
        sources.push({
            id,
            name: metadata.name || filename,
            version: metadata.version || '1.0.0',
            author: metadata.author || '未知',
            description: metadata.description || '',
            homepage: metadata.homepage || '',
            size: Buffer.byteLength(content, 'utf-8'),
            supportedSources, // 保存支持的源
            enabled: false, // 默认禁用
            uploadTime: new Date().toISOString(),
            allowUnsafeVM: !!requireUnsafe || !!allowUnsafeVM,
            requireUnsafe: !!requireUnsafe
        })

        fs.writeFileSync(metaPath, JSON.stringify(sources, null, 2))

        // 重新加载该用户的API
        await initUserApis(targetOwner)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, id, metadata, supportedSources, owner: targetOwner, allowUnsafeVM: !!requireUnsafe || !!allowUnsafeVM }))
    } catch (err: any) {
        console.error('[CustomSource] Upload error:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: err.message }))
    }
}

// 从远程URL导入脚本
export async function handleImport(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { url, filename, username, allowUnsafeVM } = JSON.parse(body)

        if (!url) {
            throw new Error('Missing URL')
        }

        // 辅助函数：支持重定向的下载
        const download = async (targetUrl: string, depth = 0): Promise<string> => {
            if (depth > 5) throw new Error('Too many redirects')
            const protocol = targetUrl.startsWith('https') ? require('https') : require('http')

            return new Promise((resolve, reject) => {
                protocol.get(targetUrl, (response: any) => {
                    const { statusCode } = response

                    // 处理重定向
                    if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
                        let redirectUrl = response.headers.location
                        if (!redirectUrl.startsWith('http')) {
                            const parsedUrl = new URL(targetUrl)
                            redirectUrl = `${parsedUrl.protocol}//${parsedUrl.host}${redirectUrl}`
                        }
                        return resolve(download(redirectUrl, depth + 1))
                    }

                    if (statusCode !== 200) {
                        return reject(new Error(`Failed to download: status code ${statusCode}`))
                    }

                    const chunks: any[] = []
                    response.on('data', (chunk: any) => chunks.push(chunk))
                    response.on('end', () => {
                        const buffer = Buffer.concat(chunks)
                        resolve(buffer.toString('utf-8'))
                    })
                    response.on('error', reject)
                }).on('error', reject)
            })
        }

        const content = await download(url)

        // 获取脚本信息
        const { metadata, supportedSources, requireUnsafe } = await getScriptInfo(content, allowUnsafeVM)

        // 核心安全校验：若脚本需要或者指定了 unsafe VM 模式，则必须验证管理员身份
        if (requireUnsafe || allowUnsafeVM) {
            const auth = req.headers['x-frontend-auth']
            if (auth !== global.lx.config['frontend.password']) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '允许以 VM 模式运行脚本需要验证管理员身份。' }))
                return
            }
        }

        // 如果检测到需要不安全模式
        if (requireUnsafe) {
            // 如果系统已禁用 VM 模式
            if (!global.lx.config['system.allowUnsafeVM']) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, disabledVM: true, error: 'VM_DISABLED', message: '已禁用VM。该脚本需要原生 VM 模式运行，但服务器后台已禁用 VM 模式。' }))
                return
            }

            // 如果未提供标志，则要求确认
            if (!allowUnsafeVM) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, requireUnsafe: true, message: '该脚本需要原生 VM 模式运行，可能存在安全风险，是否继续？' }))
                return
            }
        }

        const targetOwner = (username && username !== 'default') ? username : 'open'

        // 检查权限限制
        if (targetOwner === 'open') {
            const auth = req.headers['x-frontend-auth']
            if (auth !== global.lx.config['frontend.password']) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '公共源导入已受限，仅管理员可操作。' }))
                return
            }
        }

        const sourcesDir = getSourceDir(username)
        const metaPath = path.join(sourcesDir, 'sources.json')

        // 创建目录
        if (!fs.existsSync(sourcesDir)) {
            fs.mkdirSync(sourcesDir, { recursive: true })
        }

        // 生成唯一ID（可读的文件名）
        const displayName = metadata.name || filename || 'unknown_source'
        const id = generateId(metadata.name, filename || 'unknown_source')
        const scriptPath = path.join(sourcesDir, id)

        // 读取现有列表
        let sources: any[] = []
        if (fs.existsSync(metaPath)) {
            sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        }

        // 检查是否已存在
        const existing = sources.find(s => s.id === id)
        if (existing) {
            throw new Error(`源 "${displayName}" 已存在于 [${targetOwner}]`)
        }

        // 保存脚本文件
        fs.writeFileSync(scriptPath, content, 'utf-8')

        // 更新元数据
        sources.push({
            id,
            name: metadata.name || filename,
            version: metadata.version || '1.0.0',
            author: metadata.author || '未知',
            description: metadata.description || '',
            homepage: metadata.homepage || '',
            size: Buffer.byteLength(content, 'utf-8'),
            supportedSources, // 保存支持的源
            enabled: false,
            uploadTime: new Date().toISOString(),
            sourceUrl: url,
            allowUnsafeVM: !!requireUnsafe || !!allowUnsafeVM,
            requireUnsafe: !!requireUnsafe
        })

        fs.writeFileSync(metaPath, JSON.stringify(sources, null, 2))

        // 重新加载
        await initUserApis(targetOwner)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, filename: displayName, id, metadata, supportedSources, owner: targetOwner, allowUnsafeVM: !!requireUnsafe || !!allowUnsafeVM }))
    } catch (err: any) {
        console.error('[CustomSource] Import error:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: err.message }))
    }
}

// 获取列表
// 如果提供了 username，返回 open + username 的源
// 如果没提供，只返回 open 的源
export async function handleList(req: IncomingMessage, res: ServerResponse, username: string) {
    const openSources: any[] = []
    const userSources: any[] = []

    // 1. 读取 Open 源
    const openSourcesDir = getSourceDir('open') // -> .../_open
    const openMetaPath = path.join(openSourcesDir, 'sources.json')

    if (fs.existsSync(openMetaPath)) {
        try {
            const parsedOpenSources = JSON.parse(fs.readFileSync(openMetaPath, 'utf-8'))
            parsedOpenSources.forEach((s: any) => {
                s.owner = 'open'
                s.isPublic = true
                openSources.push(s)
            })
        } catch (e) { }
    }

    // 2. 读取 User 源 (如果有)
    let userStates: Record<string, any> = {}
    const targetStatesOwner = (username && username !== 'default') ? username : 'open'
    const statesDir = getSourceDir(targetStatesOwner)
    const userStatesPath = path.join(statesDir, 'states.json')
    if (fs.existsSync(userStatesPath)) {
        try {
            userStates = JSON.parse(fs.readFileSync(userStatesPath, 'utf-8'))
        } catch (e) { }
    }

    if (username && username !== 'default') {
        const userSourcesDir = getSourceDir(username)
        const userMetaPath = path.join(userSourcesDir, 'sources.json')

        if (fs.existsSync(userMetaPath)) {
            try {
                const parsedUserSources = JSON.parse(fs.readFileSync(userMetaPath, 'utf-8'))
                parsedUserSources.forEach((s: any) => {
                    s.owner = username
                    s.isPublic = false
                    userSources.push(s)
                })
            } catch (e) { }
        }
    }

    // 合并列表：如果公开源和用户源存在相同ID，则排除公开源
    const allSources: any[] = []
    const userSourceIds = new Set(userSources.map(s => s.id))

    openSources.forEach((s: any) => {
        if (!userSourceIds.has(s.id)) {
            if (userStates[s.id] && typeof userStates[s.id].enabled === 'boolean') {
                s.enabled = userStates[s.id].enabled
            }
            allSources.push(s)
        }
    })

    allSources.push(...userSources)

    // 补充运行时状态及禁用平台配置
    const enrichedSources = allSources.map((source: any) => {
        // 合并运行时状态
        const status = getApiStatus(source.owner, source.id)
        if (status) {
            source.status = status.status
            source.error = status.error
        }

        // 读取对应音源的禁用平台列表
        const stateObj = userStates[source.id] || (userStates[decodeURIComponent(source.id)]) || (userStates[encodeURIComponent(source.id)]) || {}
        source.disabledSources = Array.isArray(stateObj.disabledSources) ? stateObj.disabledSources : []

        return source
    })

    // ===== 自定义合并后的排序逻辑 =====
    let targetOwner = (username && username !== 'default') ? username : 'open'
    let orderPath = path.join(getSourceDir(targetOwner), 'order.json')
    let order: string[] = []

    if (!fs.existsSync(orderPath) && targetOwner !== 'open') {
        // 未保存私有排序则尝试获取公开排序
        orderPath = path.join(getSourceDir('open'), 'order.json')
    }

    if (fs.existsSync(orderPath)) {
        try {
            order = JSON.parse(fs.readFileSync(orderPath, 'utf-8'))
        } catch (e) { }
    }

    if (order.length > 0) {
        const idToIndex = new Map(order.map((id, index) => [id, index]))
        enrichedSources.sort((a, b) => {
            // 永远保持“已启用”在前的分组逻辑
            if (a.enabled !== b.enabled) {
                return a.enabled ? -1 : 1
            }

            // 同组内根据保存的绝对顺序排序
            const indexA = idToIndex.has(a.id) ? idToIndex.get(a.id)! : 999999
            const indexB = idToIndex.has(b.id) ? idToIndex.get(b.id)! : 999999

            if (indexA !== indexB) {
                return indexA - indexB
            }
            return 0
        })
    } else {
        // 默认让启用的在前，禁用的在后
        enrichedSources.sort((a, b) => {
            if (a.enabled !== b.enabled) {
                return a.enabled ? -1 : 1
            }
            return 0
        })
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(enrichedSources))
}

// 启用/禁用
// 启用/禁用
export async function handleToggle(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { id, sourceId, enabled, username, allowUnsafeVM } = JSON.parse(body)
        const targetId = id || sourceId

        let targetOwner = (username && username !== 'default') ? username : 'open'

        // 检查权限限制
        if (targetOwner === 'open') {
            const auth = req.headers['x-frontend-auth']
            if (auth !== global.lx.config['frontend.password']) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '公共源状态切换已受限，仅管理员可操作。' }))
                return
            }
        }

        let sourcesDir = getSourceDir(targetOwner)
        let metaPath = path.join(sourcesDir, 'sources.json')

        let target: any = null
        let sources: any[] = []
        let isPublicSourceToggle = false

        if (!fs.existsSync(sourcesDir)) {
            fs.mkdirSync(sourcesDir, { recursive: true })
        }

        if (fs.existsSync(metaPath)) {
            sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
            target = sources.find((s: any) => s.id === targetId)
        }

        if (!target && targetOwner !== 'open') {
            // 尝试看看是否是普通用户在切换公共源
            const openSourcesDir = getSourceDir('open')
            const openMetaPath = path.join(openSourcesDir, 'sources.json')
            if (fs.existsSync(openMetaPath)) {
                const openSources = JSON.parse(fs.readFileSync(openMetaPath, 'utf-8'))
                const openTarget = openSources.find((s: any) => s.id === targetId)
                if (openTarget) {
                    target = openTarget
                    isPublicSourceToggle = true
                }
            }
        }

        if (!target) {
            throw new Error('源不存在')
        }

        // 核心安全逻辑：
        // 1. 如果正在执行的是公共源个人状态切换 (isPublicSourceToggle === true)
        //    则只需在 server.ts 层面保证用户已登录即可，不需要额外的管理员密码。
        // 2. 如果正在修改的是全局公共源 (targetOwner === 'open')
        //    则必须校验管理员密码。
        if (targetOwner === 'open') {
            const auth = req.headers['x-frontend-auth']
            if (auth !== global.lx.config['frontend.password']) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '权限不足：管理全局公开自定义源需要验证管理员身份。' }))
                return
            }
        }

        if (isPublicSourceToggle) {
            // 普通用户独立记录公开源的开启/关闭状态，不修改公开源属性
            const userStatesPath = path.join(sourcesDir, 'states.json')
            let states: any = {}
            if (fs.existsSync(userStatesPath)) {
                try { states = JSON.parse(fs.readFileSync(userStatesPath, 'utf-8')) } catch (e) { }
            }
            if (!states[targetId]) states[targetId] = {}
            states[targetId].enabled = enabled !== undefined ? enabled : !(states[targetId].enabled ?? target.enabled)
            fs.writeFileSync(userStatesPath, JSON.stringify(states, null, 2))

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, enabled: states[targetId].enabled }))
            return
        }

        const oldEnabled = target.enabled
        const oldAllowUnsafeVM = !!target.allowUnsafeVM

        // 核心安全校验：如果试图开启 VM 模式（或当前就是 VM 模式），必须要验证管理员密码
        if (target.allowUnsafeVM || allowUnsafeVM) {
            const auth = req.headers['x-frontend-auth']
            if (auth !== global.lx.config['frontend.password']) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '开启/运行 VM 模式脚本需要验证管理员身份。' }))
                return
            }
        }

        // 修改逻辑：只有当参数明确为 true 时才更新为 true，防止被默认值 false 覆盖
        if (allowUnsafeVM === true) target.allowUnsafeVM = true
        target.enabled = enabled !== undefined ? enabled : !target.enabled

        fs.writeFileSync(metaPath, JSON.stringify(sources, null, 2))

        // 重新加载
        try {
            await initUserApis(targetOwner)

            // 如果是尝试启用，检查启用后的实时状态
            if (target.enabled) {
                const status = getApiStatus(targetOwner, targetId)
                const isRequireUnsafe = !allowUnsafeVM && !oldAllowUnsafeVM && !!(status && status.status === 'failed' && status.error && (
                    status.error === 'REQUIRE_UNSAFE_VM' ||
                    status.error.includes('初始化超时') ||
                    status.error.includes('timeout')
                ))
                if (isRequireUnsafe) {
                    console.warn(`[CustomSource] Detect REQUIRE_UNSAFE_VM or Timeout during toggle for ${targetId}, rolling back...`)
                    // 回滚状态
                    target.enabled = oldEnabled
                    target.allowUnsafeVM = oldAllowUnsafeVM
                    fs.writeFileSync(metaPath, JSON.stringify(sources, null, 2))
                    await initUserApis(targetOwner)

                    // 如果系统已禁用 VM 模式，直接提示已禁用
                    if (!global.lx.config['system.allowUnsafeVM']) {
                        res.writeHead(200, { 'Content-Type': 'application/json' })
                        res.end(JSON.stringify({ success: false, disabledVM: true, error: 'VM_DISABLED', message: '已禁用VM。该脚本需要原生 VM 模式运行，但服务器后台已禁用 VM 模式。' }))
                        return
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({ success: false, requireUnsafe: true, message: '该脚本需要原生 VM 模式运行，可能存在安全风险，是否继续？' }))
                    return
                }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, enabled: target.enabled }))
        } catch (e: any) {
            // initUserApis 本身不应抛出这个错误（内部已捕获并记录 status），但为了健壮性保留此判断
            const isRequireUnsafe = !allowUnsafeVM && !oldAllowUnsafeVM && !!(e && e.message && (
                e.message === 'REQUIRE_UNSAFE_VM' ||
                e.message.includes('初始化超时') ||
                e.message.includes('timeout')
            ))
            if (isRequireUnsafe) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, requireUnsafe: true, message: '该脚本需要原生 VM 模式运行，可能存在安全风险，是否继续？' }))
                return
            }
            throw e
        }
    } catch (err: any) {
        console.error('[CustomSource] Toggle error:', err)
        res.writeHead(500)
        res.end(err.message)
    }
}

// 拖拽排序，更新 sources.json 中源的顺序
export async function handleReorder(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { username, sourceIds } = JSON.parse(body)

        if (!Array.isArray(sourceIds)) {
            throw new Error('sourceIds must be an array')
        }

        let targetOwner = (username && username !== 'default') ? username : 'open'

        // 检查权限限制 (公开源排序)
        if (targetOwner === 'open') {
            const auth = req.headers['x-frontend-auth']
            if (auth !== global.lx.config['frontend.password']) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '公共源排序已受限，仅管理员可操作。' }))
                return
            }
        }

        let sourcesDir = getSourceDir(targetOwner)
        let metaPath = path.join(sourcesDir, 'sources.json')
        let orderPath = path.join(sourcesDir, 'order.json')

        if (!fs.existsSync(sourcesDir)) {
            fs.mkdirSync(sourcesDir, { recursive: true })
        }

        // 保存混合列表的绝对顺序到 order.json（用于 handleList 展示排序）
        fs.writeFileSync(orderPath, JSON.stringify(sourceIds, null, 2))

        // 同时尝试重排各自存在的 sources.json，并记录是否修改了 open 的源
        let openSourcesModified = false

        if (fs.existsSync(metaPath)) {
            const sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
            const currentSourcesMap = new Map(sources.map((s: any) => [s.id, s]))
            const newSources: any[] = []

            for (const id of sourceIds) {
                if (currentSourcesMap.has(id)) {
                    newSources.push(currentSourcesMap.get(id))
                    currentSourcesMap.delete(id)
                }
            }
            for (const [id, source] of currentSourcesMap) {
                newSources.push(source)
            }
            fs.writeFileSync(metaPath, JSON.stringify(newSources, null, 2))
        } else if (targetOwner !== 'open') {
            // 用户没有私有源时，重排 open 的 sources.json
            const openSourcesDir = getSourceDir('open')
            const openMetaPath = path.join(openSourcesDir, 'sources.json')
            const openOrderPath = path.join(openSourcesDir, 'order.json')
            if (fs.existsSync(openMetaPath)) {
                const sources = JSON.parse(fs.readFileSync(openMetaPath, 'utf-8'))
                const currentSourcesMap = new Map(sources.map((s: any) => [s.id, s]))
                const newSources: any[] = []

                for (const id of sourceIds) {
                    if (currentSourcesMap.has(id)) {
                        newSources.push(currentSourcesMap.get(id))
                        currentSourcesMap.delete(id)
                    }
                }
                for (const [id, source] of currentSourcesMap) {
                    newSources.push(source)
                }
                fs.writeFileSync(openMetaPath, JSON.stringify(newSources, null, 2))
                // 同时把 order.json 写入 open 目录，供 loadSourcesFromDir 按序加载
                fs.writeFileSync(openOrderPath, JSON.stringify(sourceIds, null, 2))
                openSourcesModified = true
            }
        }

        // 重新加载 API，使新顺序立即生效于解析优先级
        await initUserApis(targetOwner)
        // 若修改了 open 的源顺序，也必须重载 open，否则 loadedApis 里顺序不变
        if (openSourcesModified) {
            await initUserApis('open')
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
    } catch (err: any) {
        console.error('[CustomSource] Reorder error:', err)
        res.writeHead(500)
        res.end(err.message)
    }
}

// 删除
export async function handleDelete(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { id, sourceId, username } = JSON.parse(body)
        const targetId = id || sourceId

        // 查找逻辑同 Toggle
        let targetOwner = (username && username !== 'default') ? username : 'open'

        // 检查权限限制
        if (targetOwner === 'open') {
            const auth = req.headers['x-frontend-auth']
            if (auth !== global.lx.config['frontend.password']) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '公共源删除已受限，仅管理员可操作。' }))
                return
            }
        }

        let sourcesDir = getSourceDir(targetOwner)
        let metaPath = path.join(sourcesDir, 'sources.json')

        // 尝试定位源
        let found = false
        let sources = []

        if (fs.existsSync(metaPath)) {
            sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
            if (sources.find((s: any) => s.id === targetId)) {
                found = true
            }
        }

        if (!found && targetOwner !== 'open') {
            const openSourcesDir = getSourceDir('open')
            const openMetaPath = path.join(openSourcesDir, 'sources.json')

            if (fs.existsSync(openMetaPath)) {
                const openSources = JSON.parse(fs.readFileSync(openMetaPath, 'utf-8'))
                if (openSources.find((s: any) => s.id === targetId)) {
                    targetOwner = 'open'
                    sourcesDir = openSourcesDir
                    metaPath = openMetaPath
                    sources = openSources
                    found = true
                }
            }
        }

        if (!found) {
            throw new Error('源不存在')
        }

        // 核心安全逻辑：删除全局公开源必须校验管理员权限
        if (targetOwner === 'open') {
            const auth = req.headers['x-frontend-auth']
            if (auth !== global.lx.config['frontend.password']) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '权限不足：删除全局公共源需要验证管理员身份。' }))
                return
            }
        }

        const scriptPath = path.join(sourcesDir, targetId)
        sources = sources.filter((s: any) => s.id !== targetId)

        // 删除脚本文件
        if (fs.existsSync(scriptPath)) {
            fs.unlinkSync(scriptPath)
        }

        fs.writeFileSync(metaPath, JSON.stringify(sources, null, 2))

        // 重新初始化
        await initUserApis(targetOwner)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
    } catch (err: any) {
        console.error('[CustomSource] Delete error:', err)
        res.writeHead(500)
        res.end(err.message)
    }
}

// 更新音源的平台配置 (关闭/开启部分平台)
export async function handleUpdatePlatforms(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { id, sourceId, username, disabledSources } = JSON.parse(body)
        const targetId = id || sourceId

        if (!targetId) {
            throw new Error('缺少音源ID')
        }

        let targetOwner = (username && username !== 'default') ? username : 'open'

        // 核心安全逻辑：如果是全局公开源且为 open 模式，需要验证管理员身份
        if (targetOwner === 'open') {
            const auth = req.headers['x-frontend-auth']
            if (auth !== global.lx.config['frontend.password']) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '权限不足：修改全局公开源平台配置需要管理员身份。' }))
                return
            }
        }

        const sourcesDir = getSourceDir(targetOwner)
        if (!fs.existsSync(sourcesDir)) {
            fs.mkdirSync(sourcesDir, { recursive: true })
        }

        const userStatesPath = path.join(sourcesDir, 'states.json')
        let states: Record<string, any> = {}
        if (fs.existsSync(userStatesPath)) {
            try {
                states = JSON.parse(fs.readFileSync(userStatesPath, 'utf-8'))
            } catch (e) { }
        }

        // 兼容原名、解码后或编码后的 key
        let matchedKey = targetId
        if (!states[matchedKey]) {
            try {
                const decoded = decodeURIComponent(targetId)
                if (states[decoded]) matchedKey = decoded
            } catch (e) { }
        }
        if (!states[matchedKey]) {
            try {
                const encoded = encodeURIComponent(targetId)
                if (states[encoded]) matchedKey = encoded
            } catch (e) { }
        }

        if (!states[matchedKey]) {
            states[matchedKey] = {}
        }

        states[matchedKey].disabledSources = Array.isArray(disabledSources) ? disabledSources : []
        fs.writeFileSync(userStatesPath, JSON.stringify(states, null, 2), 'utf-8')

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
            success: true,
            id: matchedKey,
            disabledSources: states[matchedKey].disabledSources
        }))
    } catch (error: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: error.message }))
    }
}
