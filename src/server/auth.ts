import type http from 'http'
import { SYNC_CODE } from '@/constants'
import {
  aesEncrypt,
  aesDecrypt,
  rsaEncrypt,
  getIP,
} from '@/utils/tools'
import querystring from 'node:querystring'
import store from '@/utils/cache'
import { getUserSpace, getUserName, setUserName, createClientKeyInfo } from '@/user'
import { toMD5 } from '@/utils'
import { tryNormalizeUsername } from '@/utils/username'

const getAvailableIP = (req: http.IncomingMessage) => {
  let ip = getIP(req)
  return ip && (store.get<number>(ip) ?? 0) < 10 ? ip : null
}

const verifyByKey = (encryptMsg: string, userId: string, targetUserName?: string) => {
  const userName = tryNormalizeUsername(getUserName(userId))
  if (!userName) return null

  // 如果指定了目标用户名（通过URL路径），则必须匹配
  const normalizedTargetUserName = targetUserName == null ? null : tryNormalizeUsername(targetUserName)
  if (global.lx.config['user.enablePath'] && targetUserName && userName !== normalizedTargetUserName) {
    return null
  }

  const userSpace = getUserSpace(userName)
  const keyInfo = userSpace.dataManage.getClientKeyInfo(userId)
  if (!keyInfo) return null
  let text
  try {
    text = aesDecrypt(encryptMsg, keyInfo.key)
  } catch (err) {
    return null
  }
  // console.log(text)
  if (text.startsWith(SYNC_CODE.authMsg)) {
    const deviceName = text.replace(SYNC_CODE.authMsg, '') || 'Unknown'
    if (deviceName != keyInfo.deviceName) {
      keyInfo.deviceName = deviceName
      userSpace.dataManage.saveClientKeyInfo(keyInfo)
    }
    return aesEncrypt(SYNC_CODE.helloMsg, keyInfo.key)
  }
  return null
}

const verifyByCode = (encryptMsg: string, users: LX.Config['users'], targetUserName?: string) => {
  const normalizedTargetUserName = targetUserName == null ? null : tryNormalizeUsername(targetUserName)
  if (targetUserName && !normalizedTargetUserName) return null
  for (const userInfo of users) {
    if (normalizedTargetUserName && userInfo.name !== normalizedTargetUserName) continue
    let key = toMD5(userInfo.password).substring(0, 16)
    // const iv = Buffer.from(key.split('').reverse().join('')).toString('base64')
    key = Buffer.from(key).toString('base64')
    // console.log(req.headers.m, authCode, key)
    let text
    try {
      text = aesDecrypt(encryptMsg, key)
    } catch { continue }
    // console.log(text)
    if (text.startsWith(SYNC_CODE.authMsg)) {
      const data = text.split('\n')
      const publicKey = `-----BEGIN PUBLIC KEY-----\n${data[1]}\n-----END PUBLIC KEY-----`
      const deviceName = data[2] || 'Unknown'
      const isMobile = data[3] == 'lx_music_mobile'
      const keyInfo = createClientKeyInfo(deviceName, isMobile)
      const userSpace = getUserSpace(userInfo.name)
      userSpace.dataManage.saveClientKeyInfo(keyInfo)
      setUserName(keyInfo.clientId, userInfo.name)
      return rsaEncrypt(Buffer.from(JSON.stringify({
        clientId: keyInfo.clientId,
        key: keyInfo.key,
        serverName: global.lx.config.serverName,
      })), publicKey)
    }
  }
  return null
}

export const authCode = async (req: http.IncomingMessage, res: http.ServerResponse, users: LX.Config['users'], targetUserName?: string) => {
  let code = 401
  let msg: string = SYNC_CODE.msgAuthFailed

  let ip = getAvailableIP(req)
  if (ip) {
    if (typeof req.headers.m == 'string' && req.headers.m) {
      const userId = req.headers.i
      const _msg = typeof userId == 'string' && userId
        ? verifyByKey(req.headers.m, userId, targetUserName)
        : verifyByCode(req.headers.m, users, targetUserName)
      if (_msg != null) {
        msg = _msg
        code = 200
      }
    }

    if (code != 200) {
      const num = store.get<number>(ip) ?? 0
      // if (num > 20) return
      store.set(ip, num + 1)
    }
  } else {
    code = 403
    msg = SYNC_CODE.msgBlockedIp
  }
  // console.log(req.headers)

  res.writeHead(code)
  res.end(msg)
}

const verifyConnection = (encryptMsg: string, userId: string) => {
  const userName = getUserName(userId)
  // console.log(userName)
  if (!userName) return false
  const userSpace = getUserSpace(userName)
  const keyInfo = userSpace.dataManage.getClientKeyInfo(userId)
  if (!keyInfo) return false
  let text
  try {
    text = aesDecrypt(encryptMsg, keyInfo.key)
  } catch (err) {
    return false
  }
  // console.log(text)
  return text == SYNC_CODE.msgConnect
}
export const authConnect = async (req: http.IncomingMessage) => {
  let ip = getAvailableIP(req)
  if (ip) {
    const query = querystring.parse((req.url as string).split('?')[1])
    const i = query.i
    const t = query.t
    if (typeof i == 'string' && typeof t == 'string' && verifyConnection(t, i)) {
      // 验证 URL 路径中的用户名是否与连接的客户端所属用户一致
      if (global.lx.config['user.enablePath']) {
        const path = (req.url as string).split('?')[0]
        const pathParts = path.split('/').filter(p => p)
        // 假设路径格式为 /<username>
        // 解码 URL 编码的用户名
        const pathUserName = pathParts[0] ? decodeURIComponent(pathParts[0]) : null
        const urlUserName = pathUserName === 'socket' ? null : tryNormalizeUsername(pathUserName)
        const clientUserName = tryNormalizeUsername(getUserName(i))

        // console.log('Auth check path:', urlUserName, clientUserName)

        if (pathUserName !== 'socket' && (!urlUserName || !clientUserName || urlUserName !== clientUserName)) {
          // 如果路径中有用户名，且与客户端所属用户不一致，则拒绝连接
          throw new Error('User mismatch')
        }
      }
      return
    }

    const num = store.get<number>(ip) ?? 0
    store.set(ip, num + 1)
  }
  throw new Error('failed')
}
