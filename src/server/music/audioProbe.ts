/** Reject error pages and tiny placeholder responses when advertising a quality. */
export function getVerifiedAudioSize(status: number, headers: Record<string, any>): number | null {
  if (status !== 200 && status !== 206) return null
  const header = (name: string) => String(headers[name] || '').toLowerCase()
  const type = header('content-type').split(';')[0].trim()
  if (!type.startsWith('audio/') && !['application/octet-stream', 'binary/octet-stream', 'application/ogg'].includes(type)) return null
  const range = header('content-range').match(/^bytes \d+-\d+\/(\d+)$/)
  if (status === 206 && !range) return null
  const size = Number(range ? range[1] : header('content-length'))
  return Number.isSafeInteger(size) && size >= 1024 ? size : null
}
