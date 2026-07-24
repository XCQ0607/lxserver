import * as fs from 'fs'
import * as path from 'path'
import { normalizeUsername, tryNormalizeUsername } from '@/utils/username'

export interface SourceShare {
  owner: string
  sourceId: string
  targetUsers: string[]
  sharedAt: string
}

const getSharesPath = () => path.join(global.lx.userPath, 'source', 'shares.json')

const getConfiguredUsers = () => new Set(
  global.lx.config.users.map(user => normalizeUsername(user.name)),
)

const normalizeTargets = (targets: unknown, owner: string): string[] => {
  if (!Array.isArray(targets)) throw new Error('targetUsers must be an array')

  const configuredUsers = getConfiguredUsers()
  const normalized = new Set<string>()
  let shareToAll = false

  for (const target of targets) {
    if (target === '*') {
      shareToAll = true
      continue
    }
    const username = tryNormalizeUsername(target)
    if (!username || !configuredUsers.has(username)) {
      throw new Error(`Target user not found: ${String(target)}`)
    }
    if (username !== owner) normalized.add(username)
  }

  return shareToAll ? ['*'] : Array.from(normalized)
}

const normalizeRecord = (value: unknown): SourceShare | null => {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<SourceShare>
  const owner = tryNormalizeUsername(record.owner)
  const sourceId = typeof record.sourceId === 'string' ? record.sourceId.trim() : ''
  if (!owner || !sourceId) return null

  try {
    const targetUsers = normalizeTargets(record.targetUsers, owner)
    if (targetUsers.length === 0) return null
    return {
      owner,
      sourceId,
      targetUsers,
      sharedAt: typeof record.sharedAt === 'string' && record.sharedAt
        ? record.sharedAt
        : new Date(0).toISOString(),
    }
  } catch {
    return null
  }
}

export const readSourceShares = (): SourceShare[] => {
  const sharesPath = getSharesPath()
  if (!fs.existsSync(sharesPath)) return []
  try {
    const value = JSON.parse(fs.readFileSync(sharesPath, 'utf-8'))
    if (!Array.isArray(value)) return []

    const records = new Map<string, SourceShare>()
    for (const item of value) {
      const record = normalizeRecord(item)
      if (record) records.set(`${record.owner}:${record.sourceId}`, record)
    }
    return Array.from(records.values())
  } catch {
    return []
  }
}

export const writeSourceShares = (shares: SourceShare[]) => {
  const sharesPath = getSharesPath()
  fs.mkdirSync(path.dirname(sharesPath), { recursive: true })
  fs.writeFileSync(sharesPath, JSON.stringify(shares, null, 2), 'utf-8')
}

export const getSourceShare = (owner: string, sourceId: string) => {
  const normalizedOwner = normalizeUsername(owner)
  return readSourceShares().find(share => share.owner === normalizedOwner && share.sourceId === sourceId)
}

export const getSharedUsers = (owner: string, sourceId: string): string[] => {
  return getSourceShare(owner, sourceId)?.targetUsers ?? []
}

export const isSourceSharedWithUser = (owner: string, sourceId: string, username: string): boolean => {
  const normalizedOwner = tryNormalizeUsername(owner)
  const normalizedUsername = tryNormalizeUsername(username)
  if (!normalizedOwner || !normalizedUsername || normalizedOwner === normalizedUsername) return false

  const share = getSourceShare(normalizedOwner, sourceId)
  return !!share && (share.targetUsers.includes('*') || share.targetUsers.includes(normalizedUsername))
}

export const setSourceShare = (owner: string, sourceId: string, targetUsers: unknown): SourceShare => {
  const normalizedOwner = normalizeUsername(owner)
  const normalizedSourceId = typeof sourceId === 'string' ? sourceId.trim() : ''
  if (!normalizedSourceId) throw new Error('sourceId is required')

  const normalizedTargets = normalizeTargets(targetUsers, normalizedOwner)
  if (normalizedTargets.length === 0) throw new Error('At least one target user is required')

  const shares = readSourceShares().filter(share => !(share.owner === normalizedOwner && share.sourceId === normalizedSourceId))
  const record: SourceShare = {
    owner: normalizedOwner,
    sourceId: normalizedSourceId,
    targetUsers: normalizedTargets,
    sharedAt: new Date().toISOString(),
  }
  shares.push(record)
  writeSourceShares(shares)
  return record
}

export const removeSourceShare = (owner: string, sourceId: string): boolean => {
  const normalizedOwner = normalizeUsername(owner)
  const shares = readSourceShares()
  const filtered = shares.filter(share => !(share.owner === normalizedOwner && share.sourceId === sourceId))
  if (filtered.length === shares.length) return false
  writeSourceShares(filtered)
  return true
}
