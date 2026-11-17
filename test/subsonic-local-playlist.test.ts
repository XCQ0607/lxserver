import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

const source = fs.readFileSync('src/server/integrations/subsonic.ts', 'utf8')
const start = source.indexOf('    private async getLocalLibraryPlaylist(')
const end = source.indexOf('    private playlistCoverId(', start)
assert.ok(start > 0 && end > start)
const detailStart = source.indexOf('    private async handleGetPlaylist(')
const detailEnd = source.indexOf("        if (id.startsWith('lb_'))", detailStart)
assert.ok(detailStart > 0 && detailEnd > detailStart)

for (const location of ['data', 'root']) {
  test(`local playlist cache selection follows ${location} storage and updates without rescanning`, async () => {
    const config: Record<string, boolean> = {}
    let customDir = path.resolve(location, 'custom')
    let stateReads = 0
    let songConversions = 0
    const tracks = ['music', 'cache', 'custom'].map((folder, i) => ({
      id: folder, root: path.resolve(location, folder), title: folder, duration: i + 1, mtime: 1000,
    }))
    const context = vm.createContext({
      global: { lx: { config } }, path,
      getCacheDir: (user: string, music: boolean) => {
        assert.equal(user, 'alice')
        return path.resolve(location, music ? 'music' : 'cache')
      },
      getCustomMusicDir: () => customDir,
      getLocalTracks: async () => tracks,
      localMusic: (track: any) => track,
      readLocalState: () => { stateReads++; return { starred: { music: 'starred' } } },
      localSong: (track: any, _user: string, state: any) => {
        songConversions++
        return { ...track, starred: state.starred[track.id] }
      },
      localRatingId: (track: any) => track.id,
    })
    vm.runInContext(transformSync(`class Harness {
      userRatingsCache = new Map([['alice', { music: 5 }]])
      musicToSongFlat(t) { return t }
      ${source.slice(start, end)}
      ${source.slice(detailStart, detailEnd)}
      }
      sendError(_res, code) { return { error: code } }
      sendLocalResponse(_res, data) { return data }
    }; globalThis.harness = new Harness()`, { loader: 'ts' }).code, context)
    const harness = (context as any).harness
    config['subsonic.localPlaylist'] = false
    for (const id of ['local-library', 'custom-library']) {
      const denied = await harness.handleGetPlaylist({}, 'alice', new URLSearchParams({ id }), 'json')
      assert.equal(denied.error, 70)
    }
    assert.equal(stateReads, 0)
    config['subsonic.localPlaylist'] = true
    config['subsonic.customPlaylist'] = false
    assert.equal((await harness.handleGetPlaylist({}, 'alice', new URLSearchParams({ id: 'custom-library' }), 'json')).error, 70)
    const response = await harness.handleGetPlaylist({}, 'alice', new URLSearchParams({ id: 'local-library' }), 'json')
    assert.equal(response.playlist.songCount, 1)
    assert.equal(response.playlist.entry[0].id, 'music')
    const check = async (custom: boolean, ids: string[], duration: number) => {
      const result = await harness.getLocalLibraryPlaylist('alice', custom)
      assert.deepEqual(Array.from(result.songs, (t: any) => t.id).sort(), ids)
      assert.equal(result.meta.songCount, ids.length)
      assert.equal(result.meta.duration, duration)
    }
    await check(false, ['music'], 1)
    await check(true, ['custom'], 3)
    config['subsonic.cachePlaylist'] = true
    await check(false, ['cache', 'music'], 3)
    await check(true, ['custom'], 3)
    config['subsonic.cachePlaylist'] = false
    await check(false, ['music'], 1)
    const before = { stateReads, songConversions }
    const metadata = await harness.getLocalLibraryPlaylist('alice', false, false)
    assert.equal(metadata.meta.songCount, 1)
    assert.equal(metadata.songs.length, 0)
    assert.deepEqual({ stateReads, songConversions }, before)
    config['subsonic.cachePlaylist'] = true
    const detail = await harness.getLocalLibraryPlaylist('alice')
    assert.equal(stateReads, before.stateReads + 1)
    assert.equal(detail.songs.find((t: any) => t.id === 'music').starred, 'starred')
    assert.equal(detail.songs.find((t: any) => t.id === 'music').userRating, 5)
    for (const folder of ['music', 'cache']) {
      customDir = path.resolve(location, folder)
      await check(false, ['cache', 'music'], 3)
      await check(true, [], 0)
      config['subsonic.cachePlaylist'] = false
      await check(false, ['music'], 1)
      config['subsonic.cachePlaylist'] = true
    }
  })
}
