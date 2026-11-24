const bitratesMpeg1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const bitratesMpeg2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
const sampleRates = [44_100, 48_000, 32_000]

/** Structural, full-file MP3 admission. This validates frame boundaries, not acoustic identity. */
export function inspectCompleteMp3(data: Buffer) {
  let offset = 0
  let end = data.length
  if (data.subarray(0, 3).toString('ascii') === 'ID3') {
    const version = data[3]
    const flags = data[5]
    const reservedFlags = version === 2 ? 0x3f : version === 3 ? 0x1f : 0x0f
    if (end < 10 || version < 2 || version > 4 || data[4] === 0xff || (flags & reservedFlags) ||
        data.subarray(6, 10).some(byte => byte >= 128)) return null
    offset = 10 + ((data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9])
    if (version === 4 && (flags & 0x10)) {
      if (offset + 10 > end || data.subarray(offset, offset + 3).toString('ascii') !== '3DI' ||
          !data.subarray(offset + 3, offset + 10).equals(data.subarray(3, 10))) return null
      offset += 10
    }
  }
  if (end >= 128 && data.subarray(end - 128, end - 125).toString('ascii') === 'TAG') end -= 128

  let frames = 0
  let totalSamples = 0
  let weightedBitrate = 0
  let sampleRate = 0
  while (offset < end) {
    if (offset + 4 > end) return null
    const a = data[offset], b = data[offset + 1], c = data[offset + 2], d = data[offset + 3]
    const version = (b >>> 3) & 3
    const layer = (b >>> 1) & 3
    const index = (c >>> 2) & 3
    if (a !== 0xff || (b & 0xe0) !== 0xe0 || version === 1 || layer !== 1 || index === 3 || (d & 3) === 2) return null
    const kbps = (version === 3 ? bitratesMpeg1 : bitratesMpeg2)[c >>> 4]
    const rate = sampleRates[index] / (version === 3 ? 1 : version === 2 ? 2 : 4)
    if (!kbps || (sampleRate && rate !== sampleRate)) return null
    sampleRate = rate
    const samples = version === 3 ? 1152 : 576
    const frameLength = Math.floor(samples * 125 * kbps / rate) + ((c >>> 1) & 1)
    const mono = (d >>> 6) === 3
    const sideInfo = version === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17)
    if (frameLength <= 4 + ((b & 1) ? 0 : 2) + sideInfo || offset + frameLength > end) return null
    totalSamples += samples
    weightedBitrate += kbps * samples
    offset += frameLength
    frames++
  }
  if (frames < 4) return null
  const bitrate = Math.round(weightedBitrate / totalSamples)
  if (bitrate < 120) return null // No supported quality tier for noticeably lower bitrates.
  return { seconds: totalSamples / sampleRate, sampleRate, bitrate, quality: bitrate >= 240 ? '320k' : bitrate >= 170 ? '192k' : '128k' }
}

const crc = (bits: 8 | 16, polynomial: number) => Array.from({ length: 256 }, (_, value) => {
  let result = value << (bits - 8)
  for (let i = 0; i < 8; i++) result = (result << 1) ^ (result & (1 << (bits - 1)) ? polynomial : 0)
  return result & ((1 << bits) - 1)
})
const crc8 = crc(8, 0x07)
const crc16 = crc(16, 0x8005)
const standardRates = [0, 88_200, 176_400, 192_000, 8_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000, 96_000]
const standardDepths = [0, 8, 12, 0, 16, 20, 24, 32]

/** Check FLAC STREAMINFO against all frame headers, CRCs, and counted samples, not a provider's quality label. */
export async function inspectCompleteFlac(data: Buffer, signal?: AbortSignal) {
  if (data.length < 42 || data.toString('ascii', 0, 4) !== 'fLaC' ||
      (data[4] & 0x7f) !== 0 || data.readUIntBE(5, 3) !== 34) return null
  const minBlock = data.readUInt16BE(8), maxBlock = data.readUInt16BE(10)
  const descriptor = data.readUInt32BE(18)
  const sampleRate = descriptor >>> 12, channels = ((descriptor >>> 9) & 7) + 1, bitDepth = ((descriptor >>> 4) & 31) + 1
  const samples = (descriptor & 15) * 0x1_0000_0000 + data.readUInt32BE(22)
  if (minBlock < 16 || minBlock > maxBlock || sampleRate < 8_000 || !samples) return null
  let firstFrame = 4
  for (;;) {
    if (firstFrame + 4 > data.length) return null
    const marker = data[firstFrame]
    if ((marker & 0x7f) === 127) return null
    firstFrame += 4 + data.readUIntBE(firstFrame + 1, 3)
    if (marker & 0x80) break
  }
  const readFrame = (start: number) => {
    if (start + 7 > data.length || data[start] !== 0xff || (data[start + 1] & 0xfe) !== 0xf8) return null
    const blockType = data[start + 2] >>> 4, rateType = data[start + 2] & 15
    const assignment = data[start + 3] >>> 4, depthType = (data[start + 3] >>> 1) & 7
    const actualChannels = assignment < 8 ? assignment + 1 : assignment <= 10 ? 2 : 0
    if (actualChannels !== channels || (data[start + 3] & 1) ||
        (depthType !== 0 && standardDepths[depthType] !== bitDepth) || !blockType || rateType === 15) return null
    let offset = start + 4
    const introducer = data[offset++]
    let number = introducer
    if (introducer & 0x80) {
      let bytes = 0
      for (let bit = 128; bit && (introducer & bit); bit >>>= 1) bytes++
      if (bytes < 2 || bytes > 7 || offset + bytes - 1 >= data.length) return null
      number = introducer & (127 >>> bytes)
      for (let i = 1; i < bytes; i++) {
        const next = data[offset++]
        if ((next & 0xc0) !== 0x80) return null
        number = number * 64 + (next & 63)
      }
    }
    if (offset + 5 > data.length) return null
    let count: number
    if (blockType === 1) count = 192
    else if (blockType <= 5) count = 576 << (blockType - 2)
    else if (blockType === 6) count = data[offset++] + 1
    else if (blockType === 7) { count = data.readUInt16BE(offset) + 1; offset += 2 }
    else count = 256 << (blockType - 8)
    let rate = rateType ? standardRates[rateType] : sampleRate
    if (rateType === 12) rate = data[offset++] * 1_000
    else if (rateType >= 13) { rate = data.readUInt16BE(offset) * (rateType === 14 ? 10 : 1); offset += 2 }
    if (rate !== sampleRate || count > maxBlock) return null
    let check = 0
    for (let pos = start; pos < offset; pos++) check = crc8[check ^ data[pos]]
    return check === data[offset] ? { number, count, variable: !!(data[start + 1] & 1), body: offset + 1 } : null
  }
  let frame = readFrame(firstFrame)
  if (!frame || frame.number !== 0) return null
  let pos = firstFrame
  let frameNumber = 0
  let consumed = 0
  let check = 0
  for (; pos < data.length; pos++) {
    if ((pos & 0x7ffff) === 0) {
      // Yield to media requests and cancellation during a long validation.
      await new Promise<void>(resolve => setImmediate(resolve))
      signal?.throwIfAborted()
    }
    if (pos > frame.body + 2 && check === 0 && data[pos] === 0xff) {
      const next = readFrame(pos)
      if (next && next.variable === frame.variable &&
          next.number === (frame.variable ? consumed + frame.count : frameNumber + 1)) {
        if (frame.count < minBlock) return null
        consumed += frame.count
        if (consumed >= samples) return null
        frameNumber++
        frame = next
      }
    }
    check = ((check << 8) & 0xffff) ^ crc16[(check >>> 8) ^ data[pos]]
  }
  if (pos <= frame.body + 2 || check !== 0 || consumed + frame.count !== samples) return null
  return { seconds: samples / sampleRate, sampleRate, bitDepth,
    bitrate: Math.round(data.length * 8 * sampleRate / (samples * 1_000)),
    quality: bitDepth > 16 || sampleRate > 48_000 ? 'hires' : 'flac' }
}
