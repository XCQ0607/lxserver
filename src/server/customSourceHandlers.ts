import * as fs from 'fs'
import * as path from 'path'
import type { IncomingMessage, ServerResponse } from 'http'
import { extractMetadata, loadUserApi, initUserApis, getApiStatus } from './userApi'
import { normalizeUsername } from '@/utils/username'
import { getUserSourcePath } from '@/user'
import {
    getSharedUsers,
    readSourceShares,
    removeSourceShare,
    setSourceShare,
} from './customSourceSharing'

interface StoredSource {
    id: string
    name: string
    version: string | number
    author: string
    description: string
    homepage: string
    size: number
    supportedSources: string[]
    enabled: boolean
    uploadTime: string
    sourceUrl?: string
    allowUnsafeVM: boolean
    requireUnsafe: boolean
}

const readBody = async (req: IncomingMessage): Promise<string> => new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
})

const sendJson = (res: ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
}

const assertUsername = (username: string) => {
    let value: string
    try {
        value = normalizeUsername(username)
    } catch {
        throw new Error('Authenticated username required')
    }
    if (!global.lx.config.users.some(user => user.name === value)) {
        throw new Error('User not found')
    }
    return value
}

const getSourceDir = (username: string) => {
    return getUserSourcePath(assertUsername(username))
}

const readSources = (username: string): StoredSource[] => {
    const metaPath = path.join(getSourceDir(username), 'sources.json')
    if (!fs.existsSync(metaPath)) return []
    try {
        const value = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        return Array.isArray(value) ? value : []
    } catch {
        return []
    }
}

const writeSources = (username: string, sources: StoredSource[]) => {
    const sourcesDir = getSourceDir(username)
    fs.mkdirSync(sourcesDir, { recursive: true })
    fs.writeFileSync(path.join(sourcesDir, 'sources.json'), JSON.stringify(sources, null, 2))
}

const generateId = (name?: string, fallbackFilename?: string): string => {
    let input = name || fallbackFilename || 'source'
    try { input = decodeURIComponent(input) } catch { }
    let base = path.basename(input)
    if (base.toLowerCase().endsWith('.js')) base = base.slice(0, -3)
    const clean = base.replace(/[\\/:*?"<>|]/g, '_').trim()
    return `${clean || 'source'}.js`
}

const getScriptInfo = async (scriptContent: string, allowUnsafeVM = false) => {
    const metadata = extractMetadata(scriptContent)
    let supportedSources: string[] = []
    let requireUnsafe = false
    let error = ''
    try {
        const result = await loadUserApi({
            id: 'temp_analysis',
            script: scriptContent,
            enabled: false,
            allowUnsafeVM,
            ...metadata,
            owner: 'temp',
        } as any, false)
        if (result.success && result.apiInstance?.info?.sources) {
            supportedSources = Object.keys(result.apiInstance.info.sources)
        } else {
            requireUnsafe = !!result.requireUnsafe
            error = result.error || 'Failed to initialize source'
        }
    } catch (err: any) {
        error = err.message || String(err)
        console.warn('[CustomSource] Failed to analyze source:', error)
    }
    return { metadata, supportedSources, requireUnsafe, error }
}

const authorizeUnsafeSource = (
    req: IncomingMessage,
    res: ServerResponse,
    requireUnsafe: boolean,
    allowUnsafeVM: boolean,
) => {
    if (!requireUnsafe && !allowUnsafeVM) return true
    if (requireUnsafe && !allowUnsafeVM) {
        sendJson(res, 200, {
            success: false,
            requireUnsafe: true,
            message: 'This source requires unsafe VM mode. Confirm before continuing.',
        })
        return false
    }
    if (req.headers['x-frontend-auth'] !== global.lx.config['frontend.password']) {
        sendJson(res, 403, { success: false, error: 'Unsafe VM scripts require administrator authorization.' })
        return false
    }
    if (!global.lx.config['system.allowUnsafeVM']) {
        sendJson(res, 200, {
            success: false,
            disabledVM: true,
            error: 'VM_DISABLED',
            message: 'Unsafe VM mode is disabled by the server administrator.',
        })
        return false
    }
    return true
}

const authorizeAdmin = (req: IncomingMessage, res: ServerResponse) => {
    if (req.headers['x-frontend-auth'] === global.lx.config['frontend.password']) return true
    sendJson(res, 403, { success: false, error: 'Administrator authorization required.' })
    return false
}

const saveSource = async (
    req: IncomingMessage,
    res: ServerResponse,
    username: string,
    filename: string,
    content: string,
    allowUnsafeVM: boolean,
    sourceUrl?: string,
) => {
    if (!content || typeof content !== 'string') throw new Error('Invalid script content')
    const owner = assertUsername(username)
    const safeInfo = await getScriptInfo(content)
    const requireUnsafe = safeInfo.requireUnsafe
    if (!authorizeUnsafeSource(req, res, requireUnsafe, allowUnsafeVM)) return
    const scriptInfo = requireUnsafe ? await getScriptInfo(content, true) : safeInfo
    if (scriptInfo.supportedSources.length === 0) {
        throw new Error(scriptInfo.error || 'The script did not register any music sources')
    }
    const { metadata, supportedSources } = scriptInfo

    const sourcesDir = getSourceDir(owner)
    fs.mkdirSync(sourcesDir, { recursive: true })
    const id = generateId(metadata.name, filename)
    const sources = readSources(owner)
    if (sources.some(source => source.id === id)) {
        throw new Error(`Source "${metadata.name || filename}" already exists`)
    }

    fs.writeFileSync(path.join(sourcesDir, id), content, 'utf-8')
    const source: StoredSource = {
        id,
        name: metadata.name || filename,
        version: metadata.version || '1.0.0',
        author: metadata.author || 'Unknown',
        description: metadata.description || '',
        homepage: metadata.homepage || '',
        size: Buffer.byteLength(content, 'utf-8'),
        supportedSources,
        enabled: false,
        uploadTime: new Date().toISOString(),
        sourceUrl,
        allowUnsafeVM: !!requireUnsafe,
        requireUnsafe: !!requireUnsafe,
    }
    sources.push(source)
    writeSources(owner, sources)
    await initUserApis(owner)
    sendJson(res, 200, {
        success: true,
        filename: source.name,
        id,
        metadata,
        supportedSources,
        owner,
        allowUnsafeVM: source.allowUnsafeVM,
    })
}

const downloadScript = async (targetUrl: string, depth = 0): Promise<string> => {
    if (depth > 5) throw new Error('Too many redirects')
    const parsedUrl = new URL(targetUrl)
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error('Only HTTP and HTTPS URLs are supported')
    }
    const protocol = parsedUrl.protocol === 'https:' ? require('https') : require('http')
    return new Promise((resolve, reject) => {
        protocol.get(parsedUrl, (response: any) => {
            const statusCode = Number(response.statusCode || 0)
            if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
                response.resume()
                resolve(downloadScript(new URL(response.headers.location, parsedUrl).toString(), depth + 1))
                return
            }
            if (statusCode !== 200) {
                response.resume()
                reject(new Error(`Failed to download: status code ${statusCode}`))
                return
            }
            const chunks: Buffer[] = []
            response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
            response.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
            response.on('error', reject)
        }).on('error', reject)
    })
}

export async function handleValidate(req: IncomingMessage, res: ServerResponse, username: string) {
    try {
        assertUsername(username)
        const { script, allowUnsafeVM } = JSON.parse(await readBody(req))
        if (!script || typeof script !== 'string') throw new Error('Invalid script content')
        const safeInfo = await getScriptInfo(script)
        if (safeInfo.requireUnsafe && !allowUnsafeVM) {
            sendJson(res, 200, {
                valid: false,
                error: safeInfo.error,
                requireUnsafe: true,
                disabledVM: !global.lx.config['system.allowUnsafeVM'],
                metadata: safeInfo.metadata,
            })
            return
        }
        if (safeInfo.requireUnsafe && !authorizeUnsafeSource(req, res, true, true)) return
        const scriptInfo = safeInfo.requireUnsafe ? await getScriptInfo(script, true) : safeInfo
        if (scriptInfo.supportedSources.length === 0) {
            throw new Error(scriptInfo.error || 'The script did not register any music sources')
        }
        sendJson(res, 200, {
            valid: true,
            metadata: scriptInfo.metadata,
            sources: scriptInfo.supportedSources,
            sourcesCount: scriptInfo.supportedSources.length,
        })
    } catch (error: any) {
        sendJson(res, 400, { valid: false, error: error.message })
    }
}

export async function handleUpload(req: IncomingMessage, res: ServerResponse, username: string) {
    try {
        const { filename, content, allowUnsafeVM } = JSON.parse(await readBody(req))
        await saveSource(req, res, username, filename || 'source.js', content, !!allowUnsafeVM)
    } catch (error: any) {
        console.error('[CustomSource] Upload error:', error)
        sendJson(res, 500, { success: false, error: error.message })
    }
}

export async function handleImport(req: IncomingMessage, res: ServerResponse, username: string) {
    try {
        const { url, filename, allowUnsafeVM } = JSON.parse(await readBody(req))
        if (!url || typeof url !== 'string') throw new Error('Invalid source URL')
        const content = await downloadScript(url)
        await saveSource(req, res, username, filename || path.basename(new URL(url).pathname) || 'source.js', content, !!allowUnsafeVM, url)
    } catch (error: any) {
        console.error('[CustomSource] Import error:', error)
        sendJson(res, 500, { success: false, error: error.message })
    }
}

export async function handleList(_req: IncomingMessage, res: ServerResponse, username: string) {
    try {
        const owner = assertUsername(username)
        const shares = readSourceShares()
        const ownSourceList = readSources(owner)
        const ownSourceIds = new Set(ownSourceList.map(source => source.id))
        const ownSources = ownSourceList.map(source => {
            const sharedUsers = getSharedUsers(owner, source.id)
            const status = getApiStatus(owner, source.id)
            return {
                ...source,
                owner,
                shared: false,
                readOnly: false,
                sharedUsers,
                sharedToAll: sharedUsers.includes('*'),
                ...(status ? { status: status.status, error: status.error } : {}),
            }
        })
        const sharedSources = shares
            .filter(share => share.owner !== owner && (share.targetUsers.includes('*') || share.targetUsers.includes(owner)))
            .flatMap(share => {
                if (ownSourceIds.has(share.sourceId)) return []
                const source = readSources(share.owner).find(item => item.id === share.sourceId)
                if (!source) return []
                const status = getApiStatus(share.owner, source.id)
                return [{
                    ...source,
                    owner: share.owner,
                    shared: true,
                    readOnly: true,
                    sharedBy: share.owner,
                    sharedUsers: [],
                    sharedToAll: share.targetUsers.includes('*'),
                    ...(status ? { status: status.status, error: status.error } : {}),
                }]
            })
        const sources = [...ownSources, ...sharedSources]
        const orderPath = path.join(getSourceDir(owner), 'order.json')
        let order: string[] = []
        if (fs.existsSync(orderPath)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(orderPath, 'utf-8'))
                if (Array.isArray(parsed)) order = parsed
            } catch { }
        }
        const orderMap = new Map(order.map((id, index) => [id, index]))
        sources.sort((a, b) => {
            if (a.shared !== b.shared) return a.shared ? 1 : -1
            if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
            return (orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER)
        })
        sendJson(res, 200, sources)
    } catch (error: any) {
        sendJson(res, 400, { success: false, error: error.message })
    }
}

export async function handleShare(req: IncomingMessage, res: ServerResponse, username: string) {
    try {
        if (!authorizeAdmin(req, res)) return
        const owner = assertUsername(username)
        const { id, sourceId, targetUsers } = JSON.parse(await readBody(req))
        const targetId = id || sourceId
        const source = readSources(owner).find(item => item.id === targetId)
        if (!source) throw new Error('Source not found')
        if (!source.enabled) throw new Error('Enable the source before sharing it.')
        const share = setSourceShare(owner, targetId, targetUsers)
        sendJson(res, 200, { success: true, ...share })
    } catch (error: any) {
        console.error('[CustomSource] Share error:', error)
        sendJson(res, 400, { success: false, error: error.message })
    }
}

export async function handleUnshare(req: IncomingMessage, res: ServerResponse, username: string) {
    try {
        if (!authorizeAdmin(req, res)) return
        const owner = assertUsername(username)
        const { id, sourceId } = JSON.parse(await readBody(req))
        const targetId = id || sourceId
        if (!targetId || !readSources(owner).some(source => source.id === targetId)) {
            throw new Error('Source not found')
        }
        removeSourceShare(owner, targetId)
        sendJson(res, 200, { success: true })
    } catch (error: any) {
        console.error('[CustomSource] Unshare error:', error)
        sendJson(res, 400, { success: false, error: error.message })
    }
}

export async function handleSharedUsers(req: IncomingMessage, res: ServerResponse, _username: string) {
    try {
        if (!authorizeAdmin(req, res)) return
        sendJson(res, 200, {
            success: true,
            users: global.lx.config.users.map(user => ({ name: normalizeUsername(user.name) })),
        })
    } catch (error: any) {
        sendJson(res, 400, { success: false, error: error.message })
    }
}

export async function handleToggle(req: IncomingMessage, res: ServerResponse, username: string) {
    try {
        const owner = assertUsername(username)
        const { id, sourceId, enabled, allowUnsafeVM } = JSON.parse(await readBody(req))
        const targetId = id || sourceId
        const sources = readSources(owner)
        const target = sources.find(source => source.id === targetId)
        if (!target) throw new Error('Source not found')

        const oldEnabled = target.enabled
        const oldAllowUnsafeVM = target.allowUnsafeVM
        const nextEnabled = enabled !== undefined ? !!enabled : !target.enabled
        if (nextEnabled && target.requireUnsafe && !target.allowUnsafeVM) {
            if (!authorizeUnsafeSource(req, res, true, allowUnsafeVM === true)) return
        }
        if (nextEnabled && target.allowUnsafeVM && !global.lx.config['system.allowUnsafeVM']) {
            sendJson(res, 200, {
                success: false,
                disabledVM: true,
                error: 'VM_DISABLED',
                message: 'Unsafe VM mode is disabled by the server administrator.',
            })
            return
        }
        if (allowUnsafeVM === true) target.allowUnsafeVM = true
        target.enabled = nextEnabled
        writeSources(owner, sources)
        await initUserApis(owner)

        if (target.enabled) {
            const status = getApiStatus(owner, targetId)
            const requiresUnsafe = !allowUnsafeVM && !oldAllowUnsafeVM && status?.status === 'failed' && !!status.error && (
                status.error === 'REQUIRE_UNSAFE_VM' || status.error.includes('timeout')
            )
            if (requiresUnsafe) {
                target.enabled = oldEnabled
                target.allowUnsafeVM = oldAllowUnsafeVM
                writeSources(owner, sources)
                await initUserApis(owner)
                sendJson(res, 200, {
                    success: false,
                    requireUnsafe: true,
                    disabledVM: !global.lx.config['system.allowUnsafeVM'],
                    message: 'This source requires unsafe VM mode. Confirm before continuing.',
                })
                return
            }
        }
        sendJson(res, 200, { success: true, enabled: target.enabled })
    } catch (error: any) {
        console.error('[CustomSource] Toggle error:', error)
        sendJson(res, 500, { success: false, error: error.message })
    }
}

export async function handleReorder(req: IncomingMessage, res: ServerResponse, username: string) {
    try {
        const owner = assertUsername(username)
        const { sourceIds } = JSON.parse(await readBody(req))
        if (!Array.isArray(sourceIds)) throw new Error('sourceIds must be an array')
        const sources = readSources(owner)
        const sourceMap = new Map(sources.map(source => [source.id, source]))
        const ordered: StoredSource[] = []
        for (const id of sourceIds) {
            const source = sourceMap.get(id)
            if (!source) continue
            ordered.push(source)
            sourceMap.delete(id)
        }
        ordered.push(...sourceMap.values())
        writeSources(owner, ordered)
        fs.writeFileSync(path.join(getSourceDir(owner), 'order.json'), JSON.stringify(ordered.map(source => source.id), null, 2))
        await initUserApis(owner)
        sendJson(res, 200, { success: true })
    } catch (error: any) {
        console.error('[CustomSource] Reorder error:', error)
        sendJson(res, 500, { success: false, error: error.message })
    }
}

export async function handleDelete(req: IncomingMessage, res: ServerResponse, username: string) {
    try {
        const owner = assertUsername(username)
        const { id, sourceId } = JSON.parse(await readBody(req))
        const targetId = id || sourceId
        const sources = readSources(owner)
        if (!sources.some(source => source.id === targetId)) throw new Error('Source not found')
        const scriptPath = path.join(getSourceDir(owner), targetId)
        if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath)
        writeSources(owner, sources.filter(source => source.id !== targetId))
        removeSourceShare(owner, targetId)
        const orderPath = path.join(getSourceDir(owner), 'order.json')
        if (fs.existsSync(orderPath)) {
            try {
                const order = JSON.parse(fs.readFileSync(orderPath, 'utf-8'))
                if (Array.isArray(order)) {
                    fs.writeFileSync(orderPath, JSON.stringify(order.filter(id => id !== targetId), null, 2))
                }
            } catch { }
        }
        await initUserApis(owner)
        sendJson(res, 200, { success: true })
    } catch (error: any) {
        console.error('[CustomSource] Delete error:', error)
        sendJson(res, 500, { success: false, error: error.message })
    }
}
