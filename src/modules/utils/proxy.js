import * as tunnel from 'tunnel'

/**
 * 出站代理的「分类」实现。
 *
 * 背景：此前只有一对 proxy.all.*，一旦开启就作用于所有服务端出网请求。
 * 实测出现过「代理可用、但音乐平台在代理出口下拿不到数据」的情况，
 * 这时没有任何办法只让某一类请求绕开代理，只能整体关掉。
 *
 * 现在拆成三类，各自独立开关：
 *  - music        内置音乐平台 SDK（tx/wy/kg/mg/kw/bd 等）走的请求
 *  - customSource 用户导入的自定义音源脚本发出的请求
 *  - app          lxserver 自身应用功能的请求（封面代理、AcoustID 识别、远程导入音源、音质探测等）
 *
 * 兼容：某个类别从未配置过（enabled 为 undefined）时，回落到旧的统一开关 proxy.all.*，
 * 已有配置的用户升级后行为不变。
 */

const httpsRxp = /^https:/

export const PROXY_CATEGORIES = {
    music: { enabled: 'proxy.music.enabled', address: 'proxy.music.address' },
    customSource: { enabled: 'proxy.customSource.enabled', address: 'proxy.customSource.address' },
    app: { enabled: 'proxy.app.enabled', address: 'proxy.app.address' },
}

/**
 * 取某类请求生效的代理地址；返回空串表示该类不走代理。
 * @param {'music'|'customSource'|'app'} category
 */
export function resolveProxyAddress(category) {
    const cfg = (global.lx && global.lx.config) || {}
    const keys = PROXY_CATEGORIES[category]
    const allEnabled = !!cfg['proxy.all.enabled']
    const allAddress = String(cfg['proxy.all.address'] || '')

    if (!keys) return allEnabled ? allAddress : ''

    // 该类别有显式配置时以它为准（enabled=false 即该类明确不走代理）
    if (cfg[keys.enabled] !== undefined) {
        return cfg[keys.enabled] ? String(cfg[keys.address] || '') : ''
    }
    // 未配置过 -> 沿用旧的统一开关
    return allEnabled ? allAddress : ''
}

async function buildAgent(url, address) {
    if (!address) return undefined
    try {
        const proxyUrl = new URL(address)
        if (proxyUrl.protocol === 'http:' || proxyUrl.protocol === 'https:') {
            const tunnelOptions = {
                proxy: {
                    host: proxyUrl.hostname,
                    port: proxyUrl.port,
                    proxyAuth: proxyUrl.username ? `${proxyUrl.username}:${proxyUrl.password}` : undefined,
                },
            }
            return (httpsRxp.test(url) ? tunnel.httpsOverHttp : tunnel.httpOverHttp)(tunnelOptions)
        }
        if (proxyUrl.protocol.startsWith('socks')) {
            const { SocksProxyAgent } = await import('socks-proxy-agent')
            return new SocksProxyAgent(address)
        }
    } catch (e) {
        // 地址非法：忽略代理，直连
    }
    return undefined
}

/**
 * 按类别取 needle/http 可用的 agent。
 * @param {string} url 目标地址（决定 http/https 隧道方式）
 * @param {'music'|'customSource'|'app'} category
 */
export async function getProxyAgent(url, category) {
    const address = resolveProxyAddress(category)
    if (address) return buildAgent(url, address)

    // 环境变量兜底（容器部署常用）
    const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy
    if (envProxy) return buildAgent(url, envProxy)

    return undefined
}
