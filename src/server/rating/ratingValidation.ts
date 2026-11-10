const record = (value: any) => value && typeof value === 'object' && !Array.isArray(value)
const safeId = (id: string) => !!id && id.length <= 512 && !['__proto__','constructor','prototype'].includes(id)
export function normalizeRatingHistory(value: any): Record<string, any[]> {
 const result: Record<string, any[]> = Object.create(null)
 if (!record(value)) return result
 for (const [id, events] of Object.entries(value)) {
  if (!safeId(id) || !Array.isArray(events)) continue
  result[id] = events.filter(e => record(e) && Number.isInteger(e.from) && e.from >= 0 && e.from <= 5 && Number.isInteger(e.to) && e.to >= 0 && e.to <= 5 && typeof e.at === 'number' && Number.isFinite(e.at) && e.at > 0 && typeof e.channel === 'string' && e.channel.length <= 100).slice(-30).map(e => ({ from:e.from,to:e.to,at:e.at,channel:e.channel,...(typeof e.snapshotId === 'string' && e.snapshotId.length<=200 ? {snapshotId:e.snapshotId}: {}) }))
 }
 return result
}
export function validateRatingStorage(data: any) {
 if (!record(data) || (data.ratings !== undefined && !record(data.ratings))) throw new Error('评分文件结构损坏，请从备份恢复；原文件未修改')
 if (data.ratings && Object.entries(data.ratings).some(([id,value]) => !safeId(id) || !Number.isInteger(value) || Number(value)<1 || Number(value)>5)) throw new Error('评分文件包含无效分值，已停止操作并保留原文件')
 return data
}
