/**
 * OpenList 运行时门面：配置读取与客户端实例的**唯一入口**。
 *
 * 依赖方向：openlistRuntime（本文件）→ openlistConfigDb（落库）→ openlistBackupDb（连接/建表）
 *          openlistRuntime → OpenListClient（协议层）
 *
 * 上层（server.ts / openlistBackup.ts）只依赖这里，不再直接调用 openlistConfigDb：
 *  - 配置来源固定为 SQLite（openlist_config / openlist_user_backup），config.js 中的旧值仅由启动迁移读取一次；
 *  - endpoint / externalUrl 的尾斜杠规范化、externalUrl 留空回退 endpoint 统一在此处理；
 *  - OpenListClient 按连接参数签名缓存，配置变更（经本文件 saveOpenlistConfig 写入）自动失效。
 *
 * 写配置请走 saveOpenlistConfig，它会顺带清空客户端缓存，避免继续用旧凭据发请求。
 */
import { OpenListClient } from './openlistClient'
import { loadOpenlistConfig, saveOpenlistConfig as saveOpenlistConfigToDb } from './openlistConfigDb'
import type { OpenlistConfig } from './openlistConfigDb'

/** 去掉结尾斜杠（兼容用户误填的 / 或 \） */
const normalizeTrailingSlash = (u: string) => u.replace(/[\\/]+$/, '')

/** 运行时生效的配置：endpoint/externalUrl 已规范化，externalUrl 为空时已回退为 endpoint */
export interface OpenlistRuntimeConfig extends OpenlistConfig {
  endpoint: string
  externalUrl: string
}

let client: OpenListClient | null = null
let clientSig = ''

/** 读取当前生效配置（每次都读库，保证与写入方强一致；SQLite 本地读开销可忽略） */
export function getOpenlistConfig(): OpenlistRuntimeConfig {
  const cfg = loadOpenlistConfig()
  return {
    ...cfg,
    endpoint: normalizeTrailingSlash(cfg.endpoint),
    externalUrl: normalizeTrailingSlash(cfg.externalUrl || cfg.endpoint),
  }
}

/** 写入配置并失效客户端缓存，返回落库后的完整配置 */
export function saveOpenlistConfig(patch: Partial<OpenlistConfig>): OpenlistConfig {
  const saved = saveOpenlistConfigToDb(patch)
  invalidateOpenlistClient()
  return saved
}

/** 主动失效客户端缓存（配置外部变更、连接凭据轮换后调用） */
export function invalidateOpenlistClient(): void {
  client = null
  clientSig = ''
}

/** 获取共享客户端；未启用或未配置地址时返回 null。连接参数变化时自动重建。 */
export function getOpenlistClient(): OpenListClient | null {
  const cfg = getOpenlistConfig()
  if (!cfg.enable || !cfg.endpoint) {
    invalidateOpenlistClient()
    return null
  }
  const sig = [cfg.endpoint, cfg.username, cfg.password, cfg.token, cfg.root].join('|')
  if (client && clientSig === sig) return client
  client = new OpenListClient({
    endpoint: cfg.endpoint,
    username: cfg.username,
    password: cfg.password,
    token: cfg.token,
    root: cfg.root,
  })
  clientSig = sig
  return client
}
