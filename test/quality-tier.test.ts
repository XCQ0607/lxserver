import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// fileCache.ts 依赖运行时全局对象，这里只取出纯函数来测
const source = fs.readFileSync('src/server/music/fileCache.ts', 'utf8')
const start = source.indexOf('const HIRES_QUALITY_NAMES')
const code = source.slice(start, source.indexOf('export const checkCache', start))
    .replace(/export const/g, 'const').replace(/: string\[\]/g, '').replace(/: string/g, '')
const { isSameQualityTier, sameTierQualities } = new Function(`${code}; return { isSameQualityTier, sameTierQualities }`)() as {
    isSameQualityTier: (a: string, b: string) => boolean, sameTierQualities: (quality: string) => string[],
}

test('hires and flac24bit are the same cached quality tier; other qualities only match themselves', () => {
    assert.equal(isSameQualityTier('hires', 'flac24bit'), true)
    assert.equal(isSameQualityTier('flac24bit', 'hires'), true)
    assert.equal(isSameQualityTier('flac', 'flac'), true)
    assert.equal(isSameQualityTier('flac', 'flac24bit'), false)
    assert.equal(isSameQualityTier('master', 'hires'), false)
})

test('an exact lookup also tries the other name of the same tier', () => {
    assert.deepEqual(sameTierQualities('hires'), ['flac24bit'])
    assert.deepEqual(sameTierQualities('flac24bit'), ['hires'])
    assert.deepEqual(sameTierQualities('flac'), [])
})
