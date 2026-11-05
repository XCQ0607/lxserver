import crypto from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolvePublicUrl } from '../auth/security'

export interface CastIdentity {
  owner: string
  headers: IncomingMessage['headers']
  valid: () => boolean
}
interface Grant { target: string, mime: string, identity: CastIdentity, expiresAt: number }

// Receiver capabilities carry access to one immutable resource, never an account token.
export class CastAccessStore {
  private grants = new Map<string, Grant>()
  constructor(private now = Date.now, private ttl = 2 * 60 * 60 * 1000) {}
  issue(target: string, mime: string, identity: CastIdentity) {
    for (const [key, grant] of this.grants) if (grant.expiresAt <= this.now()) this.grants.delete(key)
    const owned = [...this.grants].filter(([, grant]) => grant.identity.owner === identity.owner)
    while (owned.length >= 16) this.grants.delete(owned.shift()![0])
    if (this.grants.size >= 1024) throw new Error('Too many Cast streams')
    const id = crypto.randomBytes(32).toString('hex')
    const grant = { target, mime, identity, expiresAt: this.now() + this.ttl }
    this.grants.set(id, grant)
    return { id, expiresAt: grant.expiresAt }
  }
  get(id: string) {
    const grant = this.grants.get(id)
    if (!grant) return null
    if (grant.expiresAt <= this.now() || !grant.identity.valid()) { this.grants.delete(id); return null }
    return grant
  }
  revoke(id: string, owner: string) {
    if (this.grants.get(id)?.identity.owner !== owner) return false
    return this.grants.delete(id)
  }
}

export const normalizeCastTarget = async (input: string): Promise<string> => {
  if (typeof input !== 'string' || input.length > 16384) throw new Error('Invalid media URL')
  if (!input.startsWith('/') || input.startsWith('//')) {
    const { url } = await resolvePublicUrl(input)
    return '/api/music/download?' + new URLSearchParams({ url: url.href, inline: '1' })
  }
  const url = new URL(input, 'https://local.invalid')
  const allowed = url.pathname.startsWith('/api/music/cache/file/') ||
    url.pathname === '/api/music/custom/file' || url.pathname.startsWith('/api/music/custom/file/') ||
    url.pathname === '/api/music/cache/cover' || url.pathname === '/api/music/custom/cover'
  if (url.pathname === '/api/music/download') {
    const upstream = url.searchParams.get('url')
    if (!upstream) throw new Error('Missing media URL')
    const { url: remote } = await resolvePublicUrl(upstream)
    return '/api/music/download?' + new URLSearchParams({ url: remote.href, inline: '1' })
  }
  if (!allowed) throw new Error('Only music resources can be cast')
  url.searchParams.delete('token')
  url.hash = ''
  return url.pathname + url.search
}

const types = new Set(['audio/mpeg', 'audio/flac', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/webm', 'image/jpeg', 'image/png'])
export const createCastHandler = (identify: (req: IncomingMessage) => CastIdentity | null, store = new CastAccessStore()) =>
  async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url || '/', 'http://local.invalid')
    if (url.pathname !== '/api/music/cast/session' && url.pathname !== '/api/music/cast/media') return false
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')
    const json = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
    const id = url.searchParams.get('id') || ''
    if (url.pathname === '/api/music/cast/media') {
      if (req.method !== 'GET' && req.method !== 'HEAD') { json(405, { error: 'Method not allowed' }); return true }
      const grant = store.get(id)
      if (!grant) { json(401, { error: 'Cast stream expired or revoked' }); return true }
      // Ignore all receiver-supplied routing and credentials. The normal music
      // handlers still enforce ownership, containment and upstream DNS checks.
      req.url = grant.target
      for (const key of ['cookie', 'x-user-name', 'x-user-token', 'x-frontend-auth']) delete req.headers[key]
      Object.assign(req.headers, grant.identity.headers)
      ;(req as any).castContentType = grant.mime
      return false
    }
    const identity = identify(req)
    if (!identity) { json(401, { error: 'Sign in to cast' }); return true }
    if (req.method === 'DELETE') { json(store.revoke(id, identity.owner) ? 200 : 404, { success: true }); return true }
    if (req.method === 'GET') {
      const grant = store.get(id)
      if (!grant || grant.identity.owner !== identity.owner) { json(404, { error: 'Cast stream unavailable' }); return true }
      json(200, { url: grant.target, mime: grant.mime }); return true
    }
    if (req.method !== 'POST') { json(405, { error: 'Method not allowed' }); return true }
    try {
      let body = ''
      for await (const chunk of req) { body += chunk; if (body.length > 20000) throw new Error('Request too large') }
      const data = JSON.parse(body)
      const target = await normalizeCastTarget(data.url)
      const mime = types.has(data.mime) ? data.mime : 'audio/mpeg'
      const grant = store.issue(target, mime, identity)
      json(200, { ...grant, url: '/api/music/cast/media?id=' + grant.id, mime })
    } catch { json(400, { error: 'Cannot cast this URL. Use a server or online music source.' }) }
    return true
  }
