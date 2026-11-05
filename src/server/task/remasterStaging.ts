import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { CacheItem } from '../music/fileCache'

type Folder = 'cache' | 'music'
interface Stage {
  owner: string
  namingPattern: string
  createdAt: number
  indexes: Record<Folder, Record<string, CacheItem>>
}

const PREFIX = '.remaster-staging/'
export const isRemasterStage = (username?: string) => !!username?.startsWith(PREFIX)

// Only task metadata lives in JSON. Native tagging and atomic replacement need
// real temporary audio files; keep those outside the user's music/cache trees.
export class RemasterStagingStore {
  private records: Record<string, Stage> | undefined
  private runtimeDir: () => string
  constructor(runtimeDir: () => string) { this.runtimeDir = runtimeDir }

  private get file() { return path.join(this.runtimeDir(), 'remaster-staging.json') }
  private get tempRoot() { return path.resolve(this.runtimeDir(), 'remaster-temp') }

  private load() {
    if (!this.records) {
      this.records = fs.existsSync(this.file)
        ? JSON.parse(fs.readFileSync(this.file, 'utf8')).tasks || {}
        : {}
    }
    return this.records!
  }

  private save() {
    fs.mkdirSync(this.runtimeDir(), { recursive: true })
    const temp = this.file + '.tmp'
    fs.writeFileSync(temp, JSON.stringify({ version: 1, tasks: this.load() }, null, 2))
    fs.renameSync(temp, this.file)
  }

  initialize() {
    this.load()
    if (!fs.existsSync(this.file)) this.save()
  }

  private id(username: string) {
    const id = username.slice(PREFIX.length)
    if (!username.startsWith(PREFIX) || !/^[a-f0-9]{24}$/.test(id)) throw new Error('Invalid remaster staging ID')
    return id
  }

  get(username: string): Stage {
    const stage = this.load()[this.id(username)]
    if (!stage) throw new Error('Remaster staging task is no longer active')
    return stage
  }

  create(owner: string, namingPattern: string) {
    const id = crypto.randomBytes(12).toString('hex')
    this.load()[id] = { owner, namingPattern, createdAt: Date.now(), indexes: { cache: {}, music: {} } }
    this.save()
    return PREFIX + id
  }

  directory(username: string, folder: Folder | 'covers') {
    this.get(username)
    const dir = path.join(this.tempRoot, this.id(username), folder)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  readIndex(username: string, folder: Folder) { return this.get(username).indexes[folder] }

  writeIndex(username: string, folder: Folder, index: Record<string, CacheItem>) {
    this.get(username).indexes[folder] = index
    this.save()
  }

  release(username: string) {
    const id = this.id(username)
    const dir = path.resolve(this.tempRoot, id)
    if (path.dirname(dir) !== this.tempRoot) throw new Error('Invalid staging cleanup path')
    fs.rmSync(dir, { recursive: true, force: true })
    delete this.load()[id]
    this.save()
    // Remove the temporary container when the last task finishes.
    if (fs.existsSync(this.tempRoot) && fs.readdirSync(this.tempRoot).length === 0) fs.rmdirSync(this.tempRoot)
  }
}

export const remasterStaging = new RemasterStagingStore(() => path.join(global.lx.dataPath, 'runtime'))
