import { commitRatingFiles, recoverRatingTransaction, planRatingMigration } from './ratingMigration'
import { normalizeRatingHistory, validateRatingStorage } from './ratingValidation'
import { createHash } from 'node:crypto'
import { withRatingIdentityLock } from './ratingIdentityLock'
import fs from 'node:fs'
import path from 'node:path'
import { getUserDirname } from '@/user'
import { createRatingSnapshot, withMetaLock } from './ratingSnapshot'
import { getLocalTracks, localFile, localRatingId } from '../music/subsonicLocal'
import { getCacheDir } from '../music/fileCache'
import { getCustomMusicDir } from '../music/customMusicManager'

const metaFile = (user: string) => path.join(global.lx.userPath, getUserDirname(user), 'subsonic-meta.json')
export const readRatings = (user: string): any => {
  const file = metaFile(user)
  recoverRatingTransaction(path.dirname(file))
  if (!fs.existsSync(file)) return { starredAlbums: [], starredArtists: [], starredArtistNames: [], ratings: {} }
  const data = validateRatingStorage(JSON.parse(fs.readFileSync(file, 'utf8')))
  if (data.ratingHistory) data.ratingHistory = normalizeRatingHistory(data.ratingHistory)
  migrateLinkedRatings(user, data)
  return { ...data, ratings: data.ratings || {} }
}
/** 同步读改写不跨 await，关联扫描与评分写入共享同一进程的串行临界段。 */
export function migrateLinkedRatings(user: string, supplied?: any, tracks?: any[]) {
  const file = metaFile(user)
  recoverRatingTransaction(path.dirname(file))
  if (!fs.existsSync(file)) return
  const data = supplied || validateRatingStorage(JSON.parse(fs.readFileSync(file, 'utf8')))
  const dir = path.dirname(file)
  const registryFile = path.join(dir, 'subsonic-local-registry.json')
  const linked: any[] = tracks || (fs.existsSync(registryFile) ? Object.values(JSON.parse(fs.readFileSync(registryFile, 'utf8')).tracks || {}) : [])
  const catalogFile = path.join(dir, 'rating', 'songs.json')
  const catalog = fs.existsSync(catalogFile) ? JSON.parse(fs.readFileSync(catalogFile, 'utf8')) : {}
  const before = JSON.stringify(data), beforeCatalog = JSON.stringify(catalog)
  const changes = planRatingMigration(dir, data, catalog, linked)
  if (JSON.stringify(catalog) !== beforeCatalog) changes.set(catalogFile, JSON.stringify(catalog))
  if (JSON.stringify(data) !== before) changes.set(file, JSON.stringify(data))
  commitRatingFiles(dir, changes)
}
/** 未关联使用本地ID，关联后读写在线ID；本地评分迁移到在线ID，在线已有评分优先。 */
export async function resolveRatingId(user: string, song: any): Promise<string> {
  if (!song || typeof song !== 'object') throw new Error('Missing song')
  if (song.isLocal || song._localFilename) {
    if (song._localUsername && song._localUsername !== user) throw new Error('不能为其他用户的本地文件评分')
    const filename = song._localFilename || song.filename
    if (typeof filename !== 'string') throw new Error('Missing local filename')
    const folder = song._isCustomDir ? 'custom' : song._localFolder || song.folder
    if (!['music', 'cache', 'custom'].includes(folder)) throw new Error('Invalid local folder')
    const location = song._localLocation
    if (location && !['root', 'data'].includes(location)) throw new Error('Invalid storage location')
    const root = folder === 'custom' ? getCustomMusicDir(user) : getCacheDir(user, folder === 'music', location)
    if (!root) throw new Error('Local storage unavailable')
    const file = localFile({ root, filename })
    const tracks = await getLocalTracks(user, false, folder === 'custom' ? undefined : location)
    let track = file ? tracks.find(t => localFile(t) === file) : undefined
    if (!file) {
      // 仅接受由本地文件注册表记录的改名别名，不按歌名或在线ID猜测文件。
      const actualRoot = fs.realpathSync(root)
      const key = path.resolve(actualRoot, filename)
      if (!key.startsWith(actualRoot + path.sep)) throw new Error('Invalid local path')
      const registryFile = path.join(path.dirname(metaFile(user)), 'subsonic-local-registry.json')
      const registry = fs.existsSync(registryFile) ? JSON.parse(fs.readFileSync(registryFile, 'utf8')) : { tracks: {} }
      const prior = registry.tracks?.[key]
      if (prior) track = tracks.find(t => t.id === prior.id && localFile(t))
    }
    if (!track) throw new Error('该文件不在当前用户本地曲库中，请刷新本地列表')
    return localRatingId(track)
  }
  const source = String(song.source || '')
  let id = String(source === 'tx' ? song.songmid || song.meta?.songId || song.id || '' : song.meta?.songId || song.songmid || song.id || '')
  if (id.startsWith('local_')) {
    return resolveStoredRatingId(user, id)
  }
  if (!['wy','tx','kw','kg','mg','bd'].includes(source) || !id || id.length > 256 || /[\s\\/]/.test(id)) throw new Error('Invalid song identity')
  if (!id.startsWith(source + '_')) id = source + '_' + id
  return id
}
export async function resolveStoredRatingId(user: string, id: string): Promise<string> {
  if (!id.startsWith('local_')) return id
  const track = (await getLocalTracks(user)).find(t => t.id === id)
  if (track) return localRatingId(track)
  if (Object.hasOwn(readRatings(user).ratings, id)) return id
  throw new Error('Unknown local song')
}

export interface RatingWriteOptions { onlyMissing?: boolean, deferSnapshot?: boolean, repairOnly?: boolean }
export function writeRating(user: string, id: string, rating: number, channel: string, song?: any, options: RatingWriteOptions = {}) {
  return withRatingIdentityLock(user, async () => {
    try {return await writeRatingUnlocked(user, id, rating, channel, song, options)}
    catch(error){if(options.onlyMissing)recordRatingBackfillFailure(user,id,channel);throw error}
  })
}
/** 调用方已经持有身份锁时使用；读改写仍统一经过元数据锁。 */
export async function writeRatingUnlocked(user: string, id: string, rating: number, channel: string, song?: any, options: RatingWriteOptions = {}) {
  if (!Number.isInteger(rating) || rating < 0 || rating > 5) throw new Error('Rating must be an integer between 0 and 5')
  if (typeof id !== 'string' || !id || id.length > 512 || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('Invalid rating ID')
  const localInput = id.startsWith('local_') || String(song?.id || '').startsWith('local_') || song?.isLocal || song?._localFilename
  id = song && (song.isLocal || song._localFilename) ? await resolveRatingId(user, song) : await resolveStoredRatingId(user, id)
  if (song && !id.startsWith('local_') && localInput) {
    const linked = (await getLocalTracks(user)).find(track => track.platformId === id)
    // 使用服务端关联资料，避免关联前的列表条目覆盖在线歌曲资料。
    song = linked ? { name: linked.title, singer: linked.artist, albumName: linked.album, interval: linked.duration } : undefined
  }
  const meta = await withMetaLock(user, async () => {
    const data = readRatings(user)
    data.ratingOrigins ||= {}
    if (options.repairOnly) rating = data.ratings[id] || 0
    const changed = !(options.onlyMissing && data.ratings[id] > 0) && (data.ratings[id] || 0) !== rating
    if (!changed) data._ratingUnchanged = true
    if (changed) {
    const event = { from: data.ratings[id] || 0, to: rating, channel, at: Date.now() }
    data.ratingHistory ||= {}
    data.ratingHistory[id] = [...(data.ratingHistory[id] || []), event].slice(-30)
    if (rating === 0) { delete data.ratings[id]; delete data.ratingOrigins[id] }
    else { data.ratings[id] = rating; data.ratingOrigins[id] = { channel, at: Date.now() } }
    fs.mkdirSync(path.dirname(metaFile(user)), { recursive: true })
    const temporary = metaFile(user) + '.rating.tmp'
    fs.writeFileSync(temporary, JSON.stringify(data), 'utf8'); fs.renameSync(temporary, metaFile(user))
    }
    if (!song && rating > 0) song = knownRatingSong(user, id)
    if (!song && rating > 0) setRatingTask(user, 'metadata:' + id, {id,kind:'metadata',message:'歌曲资料尚未解析',at:Date.now()})
    if (song && rating > 0) {
      try {
      // 独立评分资料目录，不写歌单；拒绝持久化带鉴权参数的播放/封面URL。
      const file = path.join(path.dirname(metaFile(user)), 'rating', 'songs.json')
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const catalog = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
      const incoming: any = { id, name: String(song.name || '').slice(0,500), singer: String(song.singer || '').slice(0,500), source: id.startsWith('local_') ? 'local' : id.replace(/^(alb_|art_|artist_)/, '').split('_')[0], albumName: String(song.meta?.albumName || song.albumName || '').slice(0,500), interval: song.interval, img: safeCover(song.img || song.meta?.picUrl || song.picUrl), albumId: String(song.meta?.albumId || song.albumId || '').slice(0,200) }
      const previous = catalog[id] || {}
      catalog[id] = { ...previous, ...Object.fromEntries(Object.entries(incoming).filter(([,value]) => value !== undefined && value !== null && value !== '')) }
      const temp = file + '.tmp'
      const next = JSON.stringify(catalog)
      if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== next || !fs.existsSync(file)) {
        fs.writeFileSync(temp, next, 'utf8'); fs.renameSync(temp, file); data._ratingCatalogChanged = true
      }
      setRatingTask(user, 'catalog:' + id, null)
      setRatingTask(user, 'metadata:' + id, null)
      } catch { data._ratingCatalogWarning = true; setRatingTask(user, 'catalog:' + id, { id, kind: 'catalog', message: '歌曲资料保存失败', song: ratingDescriptor(id, song), at: Date.now() }) }
    }
    return data
  })
  let snapshotWarning: string | undefined = meta._ratingCatalogWarning ? '评分已保存，但评分歌曲资料保存失败' : undefined
  delete meta._ratingCatalogWarning
  const unchanged = !!meta._ratingUnchanged; delete meta._ratingUnchanged
  const catalogChanged = !!meta._ratingCatalogChanged; delete meta._ratingCatalogChanged
  if (!options.deferSnapshot && (!unchanged || catalogChanged || readRatingTasks(user).some((task: any) => task.kind === 'snapshot'))) {
    const result = await flushRatingSnapshot(user); snapshotWarning = result || snapshotWarning
  }
  if (options.onlyMissing) setRatingTask(user, 'backfill:' + id, null)
  return { id, meta, snapshotWarning, unchanged }
}

/** 仅保留不带查询串/凭据的公开封面地址，避免持久化鉴权参数。 */
export const safeCover = (value: any): string => {
  if (typeof value !== 'string' || value.length > 500 || !/^https?:\/\//i.test(value)) return ''
  try { const url = new URL(value); return /[?#]/.test(value) || url.username || url.password ? '' : value } catch { return '' }
}

export type RatingKind = 'song' | 'album' | 'artist'
export const ratingKind = (id: string): RatingKind => /^(alb_|lalb_)/.test(id) ? 'album' : /^(art_|artist_|lart_)/.test(id) ? 'artist' : 'song'

/** 汇总该用户的全部评分（歌曲/专辑/歌手），补齐封面、平台、来源与时间。 */
export function listRatingItems(user: string): any[] {
  const meta = readRatings(user)
  const dir = path.join(global.lx.userPath, getUserDirname(user))
  const readJson = (file: string, fallback: any) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback } }
  const catalog = readJson(path.join(dir, 'rating', 'songs.json'), {})
  const online = readJson(path.join(global.lx.dataPath, 'runtime', 'subsonic-online-cache.json'), [])
  const localRegistry = readJson(path.join(dir, 'subsonic-local-registry.json'), { tracks: {} })
  const onlineMap = new Map((Array.isArray(online) ? online : []).map((x: any) => [x.id, x]))
  const localMap = new Map(Object.values(localRegistry.tracks || {}).map((x: any) => [x.id, x]))
  const library = new Map<string, any>()
  for (const [file, prefix] of [['library/albums.json', 'alb'], ['library/artists.json', 'art'], ['dislike/library/albums.json', 'alb'], ['dislike/library/artists.json', 'art']]) {
    const rows = readJson(path.join(dir, file), [])
    if (Array.isArray(rows)) for (const row of rows) if (row?.id && !library.has(`${prefix}_${row.source}_${row.id}`)) library.set(`${prefix}_${row.source}_${row.id}`, row)
  }
  return Object.entries(meta.ratings as Record<string, number>).map(([id, rating]) => {
    const kind = ratingKind(id)
    const origin = meta.ratingOrigins?.[id] || null
    const history = meta.ratingHistory?.[id] || []
    if (kind !== 'song') {
      const row = { ...(catalog[id] || {}), ...(library.get(id) || {}) }
      return { id, rating, kind, history, name: row.name || id, singer: row.artistName || '', source: row.source || id.split('_')[1] || '', albumName: '', img: safeCover(row.picUrl || row.meta?.picUrl), origin }
    }
    const local: any = localMap.get(id)
    const effectiveId = local?.platformId || id
    const item: any = { ...(local || {}), ...(onlineMap.get(id) || {}), ...(catalog[id] || {}) }
    const source = id.startsWith('local_') ? 'local' : item.source || id.split('_')[0]
    return { id, rating, kind, history, effectiveId, name: item.name || item.title || id, singer: item.singer || item.artist || '', source, albumName: item.albumName || item.album || item.meta?.albumName || '', interval: item.interval || item.duration, img: safeCover(item.img || item.pic || item.picUrl || item.meta?.picUrl), origin }
  })
}

/** 解析接口返回明确归属；本地历史只作说明，不作为在线评分回退值。 */
export async function ratingIdentityDetails(user: string, song: any, details = false) {
  const id = await resolveRatingId(user, song)
  const local = song.isLocal || song._localFilename || String(song.id || '').startsWith('local_')
  const identity = local ? (id.startsWith('local_') ? 'local' : 'linked-online') : 'online'
  if (!details) return { id, identity }
  const tracks = await getLocalTracks(user)
  const related = tracks.filter(t => localRatingId(t) === id)
  const rows = listRatingItems(user)
  return { id, identity,
    target: rows.find(x => x.id === id) || { id },
    linkedCopies: related.length }
}

function ratingDescriptor(id: string, song: any) {
 return {id,source:id.replace(/^(alb_|art_|artist_)/,'').split('_')[0],name:String(song?.name||song?.title||'').slice(0,500),singer:String(song?.singer||song?.artist||'').slice(0,500),albumName:String(song?.albumName||song?.meta?.albumName||song?.album||'').slice(0,500),albumId:String(song?.albumId||song?.meta?.albumId||'').slice(0,200),img:safeCover(song?.img||song?.meta?.picUrl),interval: typeof song?.interval === 'string' || typeof song?.interval === 'number' ? song.interval : undefined}
}
function knownRatingSong(user: string, id: string): any {
 const files = [path.join(path.dirname(metaFile(user)),'rating','songs.json'),path.join(global.lx.dataPath,'runtime','subsonic-online-cache.json'),path.join(path.dirname(metaFile(user)),'subsonic-local-registry.json')]
 for (const file of files) {
  if (!fs.existsSync(file)) continue
  try {
   const data=JSON.parse(fs.readFileSync(file,'utf8'));const rows=Array.isArray(data)?data:Object.values(data.tracks||data)
   const song:any=rows.find((row:any)=>row.id===id||row.platformId===id)
   if(song)return ratingDescriptor(id,song)
  } catch { /* 缓存损坏不阻止分数写入；主评分文件严格校验。 */ }
 }
}
const taskFile=(user:string)=>path.join(path.dirname(metaFile(user)),'rating','sync-status.json')
export function readRatingTasks(user:string):any[] {
 const file=taskFile(user);if(!fs.existsSync(file))return []
 try {
  const tasks=JSON.parse(fs.readFileSync(file,'utf8'))
  if(!Array.isArray(tasks)||tasks.some(t=>!t||typeof t.key!=='string'||!['catalog','metadata','snapshot','backfill'].includes(t.kind)))throw Error('invalid status')
  return tasks
 } catch {return [{key:'status-error',kind:'status',message:'同步状态文件损坏，原文件已保留；请人工检查',at:0}]}
}

function setRatingTask(user:string,key:string,task:any) {
 try {const file=taskFile(user);const current=readRatingTasks(user);if(current.some(row=>row.kind==='status'))throw Error('damaged status');const rows=current.filter(row=>row.key!==key);if(task)rows.push({...task,key});fs.mkdirSync(path.dirname(file),{recursive:true});const next=JSON.stringify(rows);if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==next){fs.writeFileSync(file+'.tmp',next,'utf8');fs.renameSync(file+'.tmp',file)}}
 catch { /* 状态文件失败不掩盖评分主操作的结果。 */ }
}
export async function flushRatingSnapshot(user:string):Promise<string|undefined> {
 try {await createRatingSnapshot(user);setRatingTask(user,'snapshot',null)}
 catch {setRatingTask(user,'snapshot',{kind:'snapshot',message:'评分快照生成失败',at:Date.now()});return '评分已保存，但评分快照生成失败，可重试失败项'}
}
export async function retryRatingTasks(user:string) {
 const tasks=readRatingTasks(user)
 for(const task of tasks){
  if(task.kind==='status')throw Error('同步状态文件损坏，已保留原文件，请人工检查后重试')
  if(task.kind==='backfill') {
   try {await writeRating(user,task.id,1,task.channel,undefined,{onlyMissing:true})}catch{}
  } else if ((task.kind==='catalog'||task.kind==='metadata') && task.id) {
    if (!(readRatings(user).ratings[task.id]>0)) {setRatingTask(user,task.key,null);continue}
    const song = task.kind==='catalog' ? task.song : await require('../integrations/subsonic').subsonicHandler.getRatingMetadata(user,task.id).catch(()=>undefined)
    if(song)await writeRating(user,task.id,readRatings(user).ratings[task.id]||0,'repair',song,{repairOnly:true})
  } else if(task.kind==='snapshot') await flushRatingSnapshot(user)
 }

 return {pending:readRatingTasks(user),version:ratingVersion(user)}
}
export function ratingVersion(user:string):string {
 const dir=path.dirname(metaFile(user));const files=['subsonic-meta.json','subsonic-local-registry.json','rating/songs.json','rating/sync-status.json']
 return createHash('sha256').update(files.map(name=>{try{const stat=fs.statSync(path.join(dir,name),{bigint:true});return `${name}:${stat.mtimeNs}:${stat.size}`}catch{return name+':missing'}}).join('|')).digest('hex').slice(0,24)
}

export function recordRatingBackfillFailure(user:string,id:string,channel:string) {
 if (!['web-dislike-link','manual-dislike-to-rating'].includes(channel) || typeof id!=='string' || !id || id.length>512 || ['__proto__','constructor','prototype'].includes(id)) return
 setRatingTask(user,'backfill:'+id,{id,kind:'backfill',channel,message:'补分写入失败',at:Date.now()})
}
