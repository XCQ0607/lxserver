import * as fs from 'fs'

/**
 * 解析容器内访问宿主机服务的可用地址。
 *
 * fnOS / 部分 Docker 环境下 `extra_hosts: host.docker.internal:host-gateway`
 * 经常不生效，容器内无法解析 host.docker.internal，导致服务端请求宿主机上的
 * Alist/WebDAV 失败、内网歌曲无法播放。这里在发起出站请求前把
 * host.docker.internal 自动替换为宿主机可达地址。
 */

let cachedHostAddr: string | null = null

/** 从 /etc/hosts 内容中提取 host.docker.internal 的映射 IP */
export const parseHostsFile = (content: string): string => {
  for (const line of content.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.includes('host.docker.internal') && parts[0]) return parts[0]
  }
  return ''
}

/** 从 /proc/net/route 内容中提取默认网关 IP（bridge 网络下即宿主机） */
export const parseRouteFile = (content: string): string => {
  for (const line of content.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/)
    if (cols.length >= 3 && cols[1] === '00000000') {
      const gwHex = cols[2]
      if (/^[0-9a-fA-F]{8}$/.test(gwHex) && gwHex !== '00000000') {
        const ip = [
          gwHex.slice(6, 8), gwHex.slice(4, 6), gwHex.slice(2, 4), gwHex.slice(0, 2),
        ].map(h => parseInt(h, 16)).join('.')
        if (!ip.includes('NaN')) return ip
      }
    }
  }
  return ''
}

/** 探测宿主机在容器网络中的可达 IP */
export const getHostAddr = (): string => {
  // 1. 环境变量显式指定（最高优先级，用户可在 compose 中配置；实时读取）
  const envAddr = process.env.LX_HOST_ADDR || process.env.HOST_ADDR
  if (envAddr && envAddr.trim()) return envAddr.trim()

  // 文件探测结果缓存（进程内固定）
  if (cachedHostAddr !== null) return cachedHostAddr

  // 2. /etc/hosts 中 host.docker.internal 的映射（extra_hosts host-gateway 生效时存在）
  try {
    const hosts = fs.readFileSync('/etc/hosts', 'utf8')
    const ip = parseHostsFile(hosts)
    if (ip) {
      cachedHostAddr = ip
      return cachedHostAddr
    }
  } catch (e) { /* ignore */ }

  // 3. 默认网关 IP（bridge 网络下默认网关即宿主机）
  try {
    const routes = fs.readFileSync('/proc/net/route', 'utf8')
    const ip = parseRouteFile(routes)
    if (ip) {
      cachedHostAddr = ip
      return cachedHostAddr
    }
  } catch (e) { /* ignore */ }

  cachedHostAddr = ''
  return cachedHostAddr
}

/** 将 URL 中的 host.docker.internal 替换为宿主机可达地址；解析失败则原样返回 */
export const resolveHost = (url: string): string => {
  if (!url || !/host\.docker\.internal/i.test(url)) return url
  const addr = getHostAddr()
  if (!addr) return url
  return url.replace(/host\.docker\.internal/gi, addr)
}
