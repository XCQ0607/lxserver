import { spawnSync } from 'child_process'
import path from 'path'
import os from 'os'
import fs from 'fs'
// @ts-ignore
import needle from 'needle'
import { getProxyAgent } from '../../modules/utils/proxy.js'

/**
 * AcoustID 歌曲识别工具类
 */

// AcoustID 配置
const API_KEY = 'Ti0HHLDf9O'
const API_URL = 'https://api.acoustid.org/v2/lookup'

/**
 * 获取 fpcalc 二进制路径
 */
function getFpcalcPath(): string | null {
    // 1. 检查 PATH 中是否已存在 (例如 Linux/Docker 环境下安装了 chromaprint)
    const checkGlobal = spawnSync(os.platform() === 'win32' ? 'where' : 'which', ['fpcalc'], { encoding: 'utf8' })
    if (checkGlobal.status === 0) {
        return 'fpcalc'
    }

    // 2. 检查本地打包目录
    const platform = os.platform() // win32, linux, darwin
    const arch = os.arch()         // x64, arm64

    // 构造可能的平台特定文件名
    let platformBinaryName = ''
    if (platform === 'win32') {
        platformBinaryName = `fpcalc-win-${arch === 'arm64' ? 'arm64' : 'x64'}.exe`
    } else if (platform === 'linux') {
        if (arch === 'arm64') platformBinaryName = 'fpcalc-linux-arm64'
        else if (arch === 'arm') platformBinaryName = 'fpcalc-linux-arm'
        else platformBinaryName = 'fpcalc-linux-x64'
    } else if (platform === 'darwin') {
        platformBinaryName = 'fpcalc-macos'
    }

    const binDir = path.join(process.cwd(), 'public/music/bin')

    // 优先匹配带平台的名称
    if (platformBinaryName) {
        const platformPath = path.join(binDir, platformBinaryName)
        if (fs.existsSync(platformPath)) return platformPath
    }

    // 次优先匹配通用名称 (兼容旧版或手动放置)
    const genericName = platform === 'win32' ? 'fpcalc.exe' : 'fpcalc'
    const genericPath = path.join(binDir, genericName)
    if (fs.existsSync(genericPath)) return genericPath

    return null
}

/**
 * 提取音频指纹
 */
export function getFingerprint(filePath: string): { fingerprint: string; duration: number } {
    const fpcalcPath = getFpcalcPath()
    if (!fpcalcPath) {
        throw new Error('未找到 fpcalc 二进制文件。Docker 环境请安装 chromaprint (apk add chromaprint)')
    }

    const result = spawnSync(fpcalcPath, ['-json', filePath], { encoding: 'utf8' })
    if (result.error) throw new Error(`启动 fpcalc 失败: ${result.error.message}`)
    if (result.status !== 0) throw new Error(`fpcalc 报错: ${result.stderr}`)

    return JSON.parse(result.stdout)
}

/**
 * 查询 AcoustID
 */
export async function lookupSong(fingerprint: string, duration: number): Promise<any> {
    const params = {
        format: 'json',
        client: API_KEY,
        duration: Math.floor(duration),
        fingerprint: fingerprint,
        meta: 'recordings releasegroups releases tracks'
    }

    try {
        const response = await needle('post', API_URL, params, {
            json: false,
            multipart: false,
            // AcoustID 识别属于应用类出站请求
            agent: await getProxyAgent(API_URL, 'app'),
        })

        if (response.statusCode !== 200) {
            throw new Error(`AcoustID API 返回状态码 ${response.statusCode}`)
        }

        return response.body
    } catch (error: any) {
        throw new Error(`AcoustID 查询失败: ${error.message}`)
    }
}

/**
 * 识别本地歌曲并返回格式化的结果
 */
export async function identifyLocalSong(filePath: string) {
    const { fingerprint, duration } = getFingerprint(filePath)
    const data = await lookupSong(fingerprint, duration)

    if (!data.results || data.results.length === 0) {
        return []
    }

    // 转换成统一格式
    const formattedResults = data.results.map((result: any) => {
        if (!result.recordings || result.recordings.length === 0) {
            return null
        }

        const rec = result.recordings[0]
        const artists = rec.artists ? rec.artists.map((a: any) => a.name).join(', ') : '未知歌手'
        const album = (rec.releasegroups && rec.releasegroups.length > 0) ? rec.releasegroups[0].title : ''

        return {
            name: rec.title,
            singer: artists,
            album: album,
            score: result.score
        }
    }).filter(Boolean)

    // 按得分排序
    return formattedResults.sort((a: any, b: any) => b.score - a.score)
}
