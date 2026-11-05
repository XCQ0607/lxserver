import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import formidable from 'formidable'
import { ZipArchive } from 'archiver'
import unzipper from 'unzipper'
import sharp from 'sharp'
import { parseCookies, resolveContainedPath } from '../auth/security'

const MB = 1024 * 1024
const MAX_UPLOAD = 1024 * MB
const MAX_TEXT = 8 * MB
const SESSION_AGE = 3600
const sessionSecret = crypto.randomBytes(32)
const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }) }
type Roots = Record<string, string>
type Params = Record<string, any>
const mimeTypes: Record<string, string> = {
  txt: 'text/plain', md: 'text/markdown', json: 'application/json', js: 'text/javascript',
  ts: 'text/plain', tsx: 'text/plain', jsx: 'text/plain', css: 'text/css', html: 'text/html',
  xml: 'application/xml', svg: 'image/svg+xml', csv: 'text/csv', yml: 'text/plain', yaml: 'text/plain',
  ini: 'text/plain', conf: 'text/plain', log: 'text/plain', sh: 'text/plain', cjs: 'text/javascript',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  mp3: 'audio/mpeg', flac: 'audio/flac', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', pdf: 'application/pdf', zip: 'application/zip',
}
const mime = (file: string) => mimeTypes[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream'
function nameOf(value: unknown): string {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' ||
    /[<>:"/\\|?*\x00-\x1f]/.test(value) || /[. ]$/.test(value) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) fail('文件名无效')
  return value as string
}
const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child)
  return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}
const exists = async (file: string) => {
  try { await fs.promises.lstat(file); return true } catch (error: any) { if (error.code === 'ENOENT') return false; throw error }
}
const noClobber = async (file: string) => { if (await exists(file)) fail('目标已存在，请更改名称或选择其他目录', 409) }

/** VueFinder 4 RemoteDriver contract. No absolute host paths are sent to clients. */
export class FileManager {
  readonly roots: Roots
  constructor(roots: Roots) { this.roots = Object.fromEntries(Object.entries(roots).map(([key, value]) => [key, path.resolve(value)])) }

  resolve(input: unknown = 'root://') {
    if (typeof input !== 'string') fail('路径无效')
    const match = /^([a-z]+):\/\/(.*)$/.exec(input as string)
    if (!match || !Object.hasOwn(this.roots, match[1])) fail('存储位置无效')
    const [, storage, relative] = match!
    if (relative.includes('\\') || relative.startsWith('/') || relative.split('/').some(p => p === '..' || p === '.')) fail('路径无效')
    relative.split('/').filter(Boolean).forEach(nameOf)
    const root = this.roots[storage]
    const absolute = resolveContainedPath(root, relative)
    // Do not traverse symlinks, including links inside copied folders.
    let current = root
    for (const segment of relative.split('/').filter(Boolean)) {
      current = path.join(current, segment)
      try { if (fs.lstatSync(current).isSymbolicLink()) fail('不支持符号链接', 403) } catch (error: any) { if (error.code !== 'ENOENT') throw error }
    }
    return { absolute, storage, root, virtual: `${storage}://${path.relative(root, absolute).split(path.sep).join('/')}` }
  }
  private mutable(file: string) {
    if (Object.values(this.roots).some(root => inside(file, root))) fail('不能修改存储根目录或其父目录', 403)
  }
  private async directory(input: unknown) {
    const result = this.resolve(input)
    if (!(await fs.promises.stat(result.absolute)).isDirectory()) fail('目标不是文件夹')
    return result
  }
  private child(parent: string, name: unknown) { return parent + (parent.endsWith('/') ? '' : '/') + nameOf(name) }
  private async entry(input: string) {
    const loc = this.resolve(input)
    const stat = await fs.promises.stat(loc.absolute)
    if (!stat.isDirectory() && !stat.isFile()) fail('不支持此文件类型')
    const dir = path.relative(loc.root, path.dirname(loc.absolute)).split(path.sep).join('/')
    return {
      path: loc.virtual, storage: loc.storage, dir: `${loc.storage}://${dir === '..' ? '' : dir}`,
      basename: path.basename(loc.absolute), extension: stat.isDirectory() ? '' : path.extname(loc.absolute).slice(1),
      type: stat.isDirectory() ? 'dir' : 'file', file_size: stat.isDirectory() ? null : stat.size,
      last_modified: Math.floor(stat.mtimeMs / 1000), mime_type: stat.isDirectory() ? null : mime(loc.absolute), visibility: 'private',
    }
  }
  async list(input: unknown = 'root://') {
    const loc = await this.directory(input)
    const files = []
    for (const item of await fs.promises.readdir(loc.absolute, { withFileTypes: true })) {
      if (item.isSymbolicLink() || (!item.isFile() && !item.isDirectory())) continue
      try { files.push(await this.entry(this.child(loc.virtual, item.name))) } catch (error: any) { if (error.code !== 'ENOENT' && error.code !== 'EACCES' && error.status !== 403) throw error }
    }
    return { storages: Object.keys(this.roots), dirname: loc.virtual, files, read_only: false }
  }
  private items(value: unknown): string[] {
    if (!Array.isArray(value) || !value.length || value.length > 1000 || value.some(v => typeof v !== 'string')) fail('请选择 1 至 1000 个文件')
    const items = [...new Set(value as string[])]
    const paths = items.map(v => this.resolve(v).absolute)
    if (paths.some((p, i) => paths.some((q, j) => i !== j && inside(p, q)))) fail('不能同时选择文件夹和它的子项')
    return items
  }
  private async scan(input: string): Promise<string[]> {
    const loc = this.resolve(input)
    const stat = await fs.promises.lstat(loc.absolute)
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) fail('目录内包含不支持的链接或特殊文件', 403)
    const result = [input]
    if (stat.isDirectory()) for (const name of await fs.promises.readdir(loc.absolute)) result.push(...await this.scan(this.child(input, name)))
    if (result.length > 100000) fail('目录项目过多，请分批操作', 413)
    return result
  }
  async search(params: Params) {
    const base = await this.directory(params.path)
    const filter = String(params.filter || '').toLocaleLowerCase()
    const files: any[] = []
    const queue = [base.virtual]
    let visited = 0
    while (queue.length) {
      const listing = await this.list(queue.shift())
      for (const file of listing.files) {
        if (++visited > 100000) fail('搜索范围过大，请选择更小的目录', 413)
        if (file.type === 'dir' && (params.deep === '1' || params.deep === true)) queue.push(file.path)
        const size = file.file_size ?? 0
        const sizeMatch = !params.size || params.size === 'all' || (file.type === 'file' && (
          params.size === 'small' ? size < MB : params.size === 'medium' ? size >= MB && size < 100 * MB : params.size === 'large' && size >= 100 * MB))
        if (file.basename.toLocaleLowerCase().includes(filter) && sizeMatch) files.push(file)
        if (files.length > 10000) fail('结果过多，请缩小搜索范围', 413)
      }
    }
    return { dirname: base.virtual, storages: Object.keys(this.roots), read_only: false, files }
  }
  async mutate(action: string, p: Params): Promise<any> {
    if (action === 'save') {
      const loc = this.resolve(p.path)
      this.mutable(loc.absolute)
      const stat = await fs.promises.stat(loc.absolute)
      if (!stat.isFile() || stat.size > MAX_TEXT || typeof p.content !== 'string' || Buffer.byteLength(p.content) > MAX_TEXT) fail('仅支持编辑 8 MiB 以内的文本文件', 413)
      const old = await fs.promises.readFile(loc.absolute)
      if (old.includes(0) || (!mime(loc.absolute).startsWith('text/') && !['application/json', 'application/xml', 'image/svg+xml'].includes(mime(loc.absolute)))) fail('不支持编辑此二进制文件')
      await fs.promises.writeFile(loc.absolute, p.content, 'utf8')
      return '文件已保存'
    }
    const current = await this.directory(p.path || p.destination)
    if (action === 'create-file' || action === 'create-folder') {
      const target = this.resolve(this.child(current.virtual, p.name)).absolute
      await noClobber(target)
      if (action === 'create-file') await fs.promises.writeFile(target, '', { flag: 'wx' })
      else await fs.promises.mkdir(target)
    } else if (action === 'rename') {
      const src = this.resolve(p.item)
      this.mutable(src.absolute)
      if (path.dirname(src.absolute) !== current.absolute) fail('文件不在当前目录')
      const dst = this.resolve(this.child(current.virtual, p.name)).absolute
      await noClobber(dst)
      await fs.promises.rename(src.absolute, dst)
    } else if (action === 'delete') {
      const selected = this.items(p.items?.map((item: any) => item.path))
      const targets = selected.map(v => this.resolve(v))
      for (const item of targets) { this.mutable(item.absolute); await fs.promises.lstat(item.absolute) }
      for (const item of targets) await fs.promises.rm(item.absolute, { recursive: true })
      return { ...await this.list(current.virtual), deleted: selected.map(v => ({ path: v })) }
    } else if (action === 'copy' || action === 'move') {
      const destination = await this.directory(p.destination)
      const selected = this.items(p.sources)
      const targets = selected.map(v => {
        const src = this.resolve(v)
        this.mutable(src.absolute)
        const dst = this.resolve(this.child(destination.virtual, path.basename(src.absolute))).absolute
        if (inside(src.absolute, dst)) fail('不能复制或移动到自身或子目录')
        return { src, dst }
      })
      if (new Set(targets.map(v => v.dst.toLowerCase())).size !== targets.length) fail('所选文件存在重名', 409)
      for (const { src, dst } of targets) { await this.scan(src.virtual); await noClobber(dst) }
      for (const { src, dst } of targets) {
        if (action === 'copy') await fs.promises.cp(src.absolute, dst, { recursive: true, force: false, errorOnExist: true })
        else {
          try { await fs.promises.rename(src.absolute, dst) } catch (error: any) {
            if (error.code !== 'EXDEV') throw error
            await fs.promises.cp(src.absolute, dst, { recursive: true, force: false, errorOnExist: true })
            await fs.promises.rm(src.absolute, { recursive: true })
          }
        }
      }
    } else if (action === 'archive') {
      const destination = await this.directory(p.destination || p.path)
      const name = nameOf(p.name)
      const target = this.resolve(this.child(destination.virtual, name.toLowerCase().endsWith('.zip') ? name : `${name}.zip`)).absolute
      await noClobber(target)
      const selected = this.items(p.items?.map((item: any) => item.path))
      const entries: { file: string, name: string, dir: boolean }[] = []
      const basenames = new Set<string>()
      for (const value of selected) {
        const src = this.resolve(value)
        if (inside(src.absolute, target)) fail('压缩包不能放在被压缩目录内')
        const base = path.basename(src.absolute)
        if (basenames.has(base.toLowerCase())) fail('所选文件存在重名', 409)
        basenames.add(base.toLowerCase())
        for (const item of await this.scan(value)) {
          const loc = this.resolve(item)
          entries.push({ file: loc.absolute, name: path.join(base, path.relative(src.absolute, loc.absolute)).split(path.sep).join('/'), dir: (await fs.promises.stat(loc.absolute)).isDirectory() })
        }
      }
      const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lx-zip-'))
      try {
        const zip = new ZipArchive({ zlib: { level: 6 } })
        const out = pipeline(zip, fs.createWriteStream(path.join(tmp, 'archive.zip')))
        for (const entry of entries) {
          if (entry.dir) zip.append('', { name: entry.name + '/' })
          else zip.file(entry.file, { name: entry.name })
        }
        await Promise.all([zip.finalize(), out])
        await fs.promises.copyFile(path.join(tmp, 'archive.zip'), target, fs.constants.COPYFILE_EXCL)
      } finally { await fs.promises.rm(tmp, { recursive: true, force: true }) }
    } else if (action === 'unarchive') {
      const src = this.resolve(p.item)
      if (path.extname(src.absolute).toLowerCase() !== '.zip') fail('仅支持 ZIP 压缩包')
      const destination = await this.directory(p.destination || p.path)
      const zip = await unzipper.Open.file(src.absolute)
      if (zip.files.length > 10000) fail('压缩包项目过多', 413)
      let expanded = 0
      const topNames = new Set<string>()
      const seen = new Set<string>()
      for (const entry of zip.files) {
        const relative = entry.path.replace(/\/$/, '')
        if (!relative || relative.includes('\\') || relative.startsWith('/')) fail('压缩包包含非法路径')
        relative.split('/').forEach(nameOf)
        if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) fail('压缩包包含符号链接')
        if (seen.has(relative.toLowerCase())) fail('压缩包包含重名项目', 409)
        seen.add(relative.toLowerCase())
        topNames.add(relative.split('/')[0])
        expanded += entry.uncompressedSize
        if (expanded > 2 * MAX_UPLOAD) fail('解压内容超过 2 GiB', 413)
      }
      for (const name of topNames) await noClobber(this.resolve(this.child(destination.virtual, name)).absolute)
      const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lx-extract-'))
      try {
        let actual = 0
        for (const entry of zip.files) {
          const target = resolveContainedPath(tmp, entry.path)
          if (entry.type === 'Directory') await fs.promises.mkdir(target, { recursive: true })
          else {
            await fs.promises.mkdir(path.dirname(target), { recursive: true })
            const limit = new Transform({ transform(chunk, _encoding, cb) { actual += chunk.length; cb(actual > 2 * MAX_UPLOAD ? new Error('解压内容超过 2 GiB') : null, chunk) } })
            await pipeline(entry.stream(), limit, fs.createWriteStream(target, { flags: 'wx' }))
          }
        }
        for (const name of topNames) await fs.promises.cp(path.join(tmp, name), this.resolve(this.child(destination.virtual, name)).absolute, { recursive: true, force: false, errorOnExist: true })
      } finally { await fs.promises.rm(tmp, { recursive: true, force: true }) }
    } else fail('不支持的文件操作', 404)
    return this.list(current.virtual)
  }
  async upload(req: IncomingMessage) {
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lx-upload-'))
    try {
      const form = formidable({ uploadDir: tmp, maxFileSize: MAX_UPLOAD, maxTotalFileSize: MAX_UPLOAD, maxFiles: 20, maxFieldsSize: MB, allowEmptyFiles: true, minFileSize: 0 })
      const [fields, files] = await form.parse(req)
      const parent = await this.directory(fields.path?.[0])
      const uploads = Object.values(files).flat().filter(Boolean) as formidable.File[]
      if (!uploads.length) fail('没有收到文件')
      const overwrite = fields.overwrite?.[0] === '1'
      for (const file of uploads) {
        const target = this.resolve(this.child(parent.virtual, file.originalFilename)).absolute
        this.mutable(target)
        if (!overwrite) await noClobber(target)
        else if (await exists(target) && !(await fs.promises.stat(target)).isFile()) fail('目标不是文件')
        await fs.promises.copyFile(file.filepath, target, overwrite ? 0 : fs.constants.COPYFILE_EXCL)
      }
      return this.list(parent.virtual)
    } finally { await fs.promises.rm(tmp, { recursive: true, force: true }) }
  }
}

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(value))
}
const sign = (value: string, password: string) => crypto.createHmac('sha256', sessionSecret).update(password + '\0' + value).digest('hex')
function hasMediaSession(req: IncomingMessage, password: string) {
  const token = parseCookies(req.headers.cookie).lx_files || ''
  const [expires, signature] = token.split('.')
  if (!/^\d+$/.test(expires || '') || !/^[a-f0-9]{64}$/.test(signature || '') || Number(expires) < Date.now()) return false
  const expected = sign(expires, password)
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}
async function readJson(req: IncomingMessage) {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_TEXT + MB) fail('请求内容过大', 413)
    chunks.push(chunk)
  }
  try { const data = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!data || typeof data !== 'object' || Array.isArray(data)) fail('请求格式无效'); return data } catch { return fail('请求 JSON 无效') }
}
let mutationQueue: Promise<unknown> = Promise.resolve()
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = mutationQueue.then(task, task)
  mutationQueue = next.catch(() => {})
  return next
}

/** Header auth for all API calls; scoped HttpOnly cookie only for media GET/HEAD. */
export async function handleFileManager(req: IncomingMessage, res: ServerResponse, roots: Roots, password: string | undefined) {
  try {
    if (typeof password !== 'string' || !password) return json(res, 401, { message: '请先配置管理密码并登录' })
    const url = new URL(req.url || '/', 'http://localhost')
    const action = url.pathname.slice('/api/files'.length).replace(/^\//, '')
    const media = ['preview', 'download', 'thumbnail'].includes(action)
    const authenticated = typeof req.headers['x-frontend-auth'] === 'string' && req.headers['x-frontend-auth'] === password
    if (!authenticated && !(media && ['GET', 'HEAD'].includes(req.method || '') && hasMediaSession(req, password))) return json(res, 401, { message: '登录已失效，请返回管理后台重新登录' })
    const get = ['GET', 'HEAD'].includes(req.method || '')
    if ((['', 'search', 'preview', 'download', 'thumbnail'].includes(action) && !get) || (!['', 'search', 'preview', 'download', 'thumbnail'].includes(action) && req.method !== 'POST')) return json(res, 405, { message: '不支持的请求方法' })
    const manager = new FileManager(roots)
    if (action === 'session') {
      const expiry = String(Date.now() + SESSION_AGE * 1000)
      const secure = 'encrypted' in req.socket && req.socket.encrypted
      res.setHeader('Set-Cookie', `lx_files=${expiry}.${sign(expiry, password)}; HttpOnly; SameSite=Strict; Path=/api/files; Max-Age=${SESSION_AGE}${secure ? '; Secure' : ''}`)
      return json(res, 200, { storages: Object.keys(roots), maxFileSize: MAX_UPLOAD })
    }
    if (media) {
      const loc = manager.resolve(url.searchParams.get('path'))
      const stat = await fs.promises.stat(loc.absolute)
      if (!stat.isFile()) fail('目标不是文件')
      // User-managed HTML/SVG must never execute in the admin origin.
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'")
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Cache-Control', 'private, no-store')
      if (action === 'thumbnail') {
        if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(mime(loc.absolute)) || stat.size > 50 * MB) fail('不支持此图片缩略图')
        const buffer = await sharp(loc.absolute, { limitInputPixels: 40000000 }).rotate().resize(160, 160, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 75 }).toBuffer()
        res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': buffer.length })
        res.end(req.method === 'HEAD' ? undefined : buffer)
        return
      }
      const type = mime(loc.absolute)
      const safeType = ['text/html', 'image/svg+xml', 'text/javascript', 'application/xml'].includes(type) ? 'text/plain; charset=utf-8' : type
      res.setHeader('Content-Type', action === 'download' ? 'application/octet-stream' : safeType)
      res.setHeader('Content-Disposition', `${action === 'download' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(path.basename(loc.absolute)).replace(/['()]/g, c => '%' + c.charCodeAt(0).toString(16))}`)
      res.setHeader('Accept-Ranges', 'bytes')
      let start = 0, end = stat.size - 1
      const range = req.headers.range
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range)
        if (!match || (!match[1] && !match[2])) { res.setHeader('Content-Range', `bytes */${stat.size}`); res.writeHead(416); res.end(); return }
        if (!match[1]) start = Math.max(0, stat.size - Number(match[2]))
        else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])) }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) { res.setHeader('Content-Range', `bytes */${stat.size}`); res.writeHead(416); res.end(); return }
        res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
      }
      res.setHeader('Content-Length', Math.max(0, end - start + 1))
      res.writeHead(range ? 206 : 200)
      if (req.method === 'HEAD' || !stat.size) res.end()
      else await pipeline(fs.createReadStream(loc.absolute, { start, end }), res)
      return
    }
    if (!action) return json(res, 200, await manager.list(url.searchParams.get('path') || 'root://'))
    if (action === 'search') return json(res, 200, await manager.search(Object.fromEntries(url.searchParams)))
    if (action === 'upload') return json(res, 200, await serialize(() => manager.upload(req)))
    const params = await readJson(req)
    return json(res, 200, await serialize(() => manager.mutate(action, params)))
  } catch (error: any) {
    if (res.headersSent) { if (!res.writableEnded) res.destroy(); return }
    const codes: Record<string, [number, string]> = {
      ENOENT: [404, '文件或目录不存在'], EEXIST: [409, '目标已存在'], ENOTEMPTY: [409, '目标目录非空'],
      EACCES: [403, '没有访问权限'], EPERM: [403, '文件被占用或没有访问权限'], ENOSPC: [507, '磁盘空间不足'],
    }
    const [status, message] = codes[error.code] || [error.status || error.httpCode || 500, error.status ? error.message : '文件操作失败，请检查文件状态后重试']
    json(res, status, { message })
  }
}
