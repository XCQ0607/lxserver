const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const test = require('node:test')
const vm = require('node:vm')

const repositoryRoot = path.resolve(__dirname, '..')

const extractFunction = (source, declaration) => {
  const start = source.indexOf(declaration)
  assert.notEqual(start, -1, `Missing function: ${declaration}`)

  const bodyStart = source.indexOf('{', start)
  let depth = 0
  for (let index = bodyStart; index < source.length; index++) {
    if (source[index] === '{') depth++
    if (source[index] !== '}') continue
    depth--
    if (depth === 0) return source.slice(start, index + 1)
  }
  throw new Error(`Unterminated function: ${declaration}`)
}

test('web player honors bottom when adding a song to the default list', async () => {
  const appSource = fs.readFileSync(path.join(repositoryRoot, 'public/music/app.js'), 'utf8')
  const configFunctionSource = extractFunction(appSource, 'function getConfiguredAddMusicLocationType()')
  const addFunctionSource = extractFunction(appSource, 'function addMusicByConfiguredLocation(list, music)')
  const functionSource = extractFunction(appSource, 'async function addToDefaultList(song)')
  const currentListData = {
    defaultList: [{ id: 'existing', name: 'Existing' }],
    loveList: [],
    userList: [],
  }
  const context = vm.createContext({
    currentListData,
    window: { CONFIG: { 'list.addMusicLocationType': 'bottom' } },
    cleanSongData: song => song,
    pushDataChange: async () => {},
    renderMyLists: () => {},
    console,
  })
  vm.runInContext(configFunctionSource, context)
  vm.runInContext(addFunctionSource, context)
  const addToDefaultList = vm.runInContext(`(${functionSource})`, context)

  await addToDefaultList({ id: 'new', name: 'New' })

  assert.deepEqual(currentListData.defaultList.map(song => song.id), ['existing', 'new'])
})

test('web player starts recovery when a resolved online URL fails to play', async () => {
  const appSource = fs.readFileSync(path.join(repositoryRoot, 'public/music/app.js'), 'utf8')
  const functionSource = extractFunction(appSource, 'async function playSong(song, index, forceQuality = null, noPlay = false, isRetry = false, shouldAddToDefault = null)')
  const listeners = new Map()
  const audio = {
    paused: true,
    ended: false,
    src: '',
    volume: 1,
    playError: null,
    addEventListener(name, listener) {
      const handlers = listeners.get(name) || []
      handlers.push(listener)
      listeners.set(name, handlers)
    },
    removeEventListener(name, listener) {
      listeners.set(name, (listeners.get(name) || []).filter(handler => handler !== listener))
    },
    pause() { this.paused = true },
    async play() {
      if (this.playError) throw this.playError
      this.paused = false
    },
    dispatch(name) {
      for (const listener of [...(listeners.get(name) || [])]) listener({ type: name })
    },
  }
  let recoveryCalls = 0
  const context = vm.createContext({
    audio,
    settings: {
      playbackErrorPriority: 'platform',
      enableAutoDegradeQuality: false,
      enableAutoSwitchSource: true,
      enableAutoSkipOnError: false,
      preferredQuality: '128k',
      enableCrossfade: false,
      enableServerLyricCache: false,
    },
    window: {
      QualityManager: { getBestQuality: () => '128k' },
      currentPlayingSong: null,
      _autoSkipTimer: null,
    },
    document: { getElementById: () => null },
    prefetchManager: { get: () => null, bufferer: { src: '' } },
    resolveSongUrl: async () => ({ url: 'https://invalid.example/song.mp3', sourceType: 'normal', quality: '128k' }),
    runRecoveryFlow: async () => { recoveryCalls++ },
    updatePlayerInfo: () => {},
    updateMediaSessionMetadata: () => {},
    fetchLyric: () => {},
    renderQueue: () => {},
    showInfo: () => {},
    showSuccess: () => {},
    showError: () => {},
    setPlayerStatus: () => {},
    updatePlayButton: () => {},
    getSourceTypeText: () => '在线解析',
    cleanSongData: song => song,
    savePlayHistory: () => {},
    addToDefaultList: () => {},
    prefetchNextSong: () => {},
    localStorage: { removeItem: () => {} },
    console,
    currentLoadingSongId: null,
    loadingRequestCounter: 0,
    currentLoadingRequestId: 0,
    currentRecoveryState: null,
    currentPlaybackErrorHandler: null,
    shouldAutoRecoverPlayback: false,
    playbackRecoveryTriggeredForRequestId: 0,
    currentIndex: -1,
    preSelectedNextIndex: null,
    currentPlayingSong: null,
    currentQuality: null,
    currentSourceType: 'normal',
    currentPlayingScope: 'local_list',
    currentRawLrc: '',
    currentRawTlrc: '',
    currentRawRlrc: '',
    currentRawKlrc: '',
    currentVolume: 1,
    isUserScrolling: false,
    scrollLockTimeout: null,
    hintTimeout: null,
  })
  vm.runInContext(functionSource, context)

  await context.playSong({ id: 'song-a', name: 'Song A', singer: 'Artist', source: 'wy' }, 0)
  audio.dispatch('error')
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(recoveryCalls, 1)

  audio.playError = Object.assign(new Error('Unsupported audio source'), { name: 'NotSupportedError' })
  await context.playSong({ id: 'song-b', name: 'Song B', singer: 'Artist', source: 'wy' }, 1)

  assert.equal(recoveryCalls, 2)
})

test('web player recovers when playback pauses unexpectedly', async () => {
  const appSource = fs.readFileSync(path.join(repositoryRoot, 'public/music/app.js'), 'utf8')
  const functionSource = extractFunction(appSource, 'function handleUnexpectedPlaybackPause()')
  let recoveryCalls = 0
  const context = vm.createContext({
    audio: { paused: true, ended: false, src: 'https://invalid.example/song.mp3' },
    shouldAutoRecoverPlayback: true,
    currentRecoveryState: { thisRequestId: 7 },
    currentPlaybackErrorHandler: null,
    playbackRecoveryTriggeredForRequestId: 0,
    runRecoveryFlow: async () => { recoveryCalls++ },
    Error,
  })
  vm.runInContext(functionSource, context)

  const recovered = context.handleUnexpectedPlaybackPause()
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(recovered, true)
  assert.equal(recoveryCalls, 1)
  assert.equal(context.shouldAutoRecoverPlayback, false)
})

test('web player continues source recovery after an earlier source switch', async () => {
  const appSource = fs.readFileSync(path.join(repositoryRoot, 'public/music/app.js'), 'utf8')
  const functionSource = extractFunction(appSource, 'async function runRecoveryFlow(error)')
  const originalSong = { id: 'wy-a', source: 'wy', name: 'Song A' }
  const alreadyTried = { id: 'tx-a', source: 'tx', name: 'Song A' }
  const nextSource = { id: 'kw-a', source: 'kw', name: 'Song A' }
  const playedSources = []
  const context = vm.createContext({
    currentRecoveryState: {
      originalSong,
      currentSong: alreadyTried,
      currentIndex: 0,
      currentQuality: '128k',
      triedQualities: ['128k'],
      triedPlatforms: ['wy', 'tx'],
      steps: ['switch_platform'],
      currentStepIndex: 0,
    },
    findOtherSourceMatches: async () => [alreadyTried, nextSource],
    playSong: song => { playedSources.push(song.source) },
    settings: { preferredQuality: '128k' },
    window: { QualityManager: { getBestQuality: () => '128k' }, _autoSkipTimer: null },
    showInfo: () => {},
    showError: () => {},
    setPlayerStatus: () => {},
    updatePlayButton: () => {},
    getSourceName: source => source,
    console,
  })
  vm.runInContext(functionSource, context)

  await context.runRecoveryFlow(new Error('failed'))

  assert.deepEqual(playedSources, ['kw'])
})

test('song rows expose an add-to-playlist action', () => {
  const appSource = fs.readFileSync(path.join(repositoryRoot, 'public/music/app.js'), 'utf8')
  assert.match(appSource, /title="添加到歌单"/)
  assert.match(appSource, /openPlaylistAddModalForSong\(actualIndexInOriginal\)/)
})

test('every song list uses the checked single-song playlist picker', () => {
  const appSource = fs.readFileSync(path.join(repositoryRoot, 'public/music/app.js'), 'utf8')
  const songListSource = fs.readFileSync(path.join(repositoryRoot, 'public/music/js/songlist_manager.js'), 'utf8')
  const leaderboardSource = fs.readFileSync(path.join(repositoryRoot, 'public/music/js/leaderboard_manager.js'), 'utf8')
  const localMusicSource = fs.readFileSync(path.join(repositoryRoot, 'public/music/js/local_music.js'), 'utf8')
  const downloadSource = fs.readFileSync(path.join(repositoryRoot, 'public/music/js/download_manager.js'), 'utf8')

  assert.match(appSource, /window\.playlistAddTargetSong/)
  assert.match(appSource, /window\.openPlaylistAddModalForSongObject/)
  assert.match(appSource, /openPlaylistAddModalForSongObject\(currentPlaylist\[\$\{index\}\]\)/)
  assert.match(appSource, /openPlaylistAddModalForSong\(index\)/)
  assert.match(appSource, /bg-red-500 text-white[\s\S]*fa-check/)
  assert.match(songListSource, /SongListManager\.addSongToPlaylist\(\$\{index\}\)/)
  assert.match(leaderboardSource, /LeaderboardManager\.addSongToPlaylist\(\$\{index\}\)/)
  assert.match(localMusicSource, /data-lm-action="playlist"/)
  assert.match(localMusicSource, /addItemToPlaylist\(index\)/)
  assert.match(downloadSource, /addTaskToPlaylist\('\$\{task\.id\}'\)/)
  assert.match(appSource, /openCacheItemPlaylist\(\$\{idx\}\)/)
})

test('single-song playlist picker marks existing playlists with a red check', () => {
  const appSource = fs.readFileSync(path.join(repositoryRoot, 'public/music/app.js'), 'utf8')
  const functionSource = extractFunction(appSource, 'function renderPlaylistAddGrid()')
  const listContainer = {
    children: [],
    innerHTML: '',
    appendChild(child) { this.children.push(child) },
  }
  const context = vm.createContext({
    window: {
      batchCollectSongs: null,
      playlistAddTargetSong: { id: 'song-a', name: 'Song A' },
      myPersonalListData: null,
    },
    currentPlayingSong: null,
    currentListData: {
      loveList: [{ id: 'song-a' }],
      userList: [{ id: 'other', name: 'Other', list: [] }],
    },
    document: {
      getElementById: id => id === 'playlist-add-list' ? listContainer : null,
      createElement: () => ({ className: '', innerHTML: '', onclick: null }),
    },
    cleanSongData: song => song,
    isUserLoggedIn: () => false,
    handleTogglePlaylist: () => {},
    handleCreateList: () => {},
  })
  vm.runInContext(functionSource, context)
  context.renderPlaylistAddGrid()

  assert.match(listContainer.children[0].className, /bg-red-500/)
  assert.match(listContainer.children[0].innerHTML, /fa-check/)
  assert.match(listContainer.children[1].className, /bg-emerald-50/)
  assert.doesNotMatch(listContainer.children[1].innerHTML, /fa-check/)
})

test('song pagination exposes first and last page controls', () => {
  const html = fs.readFileSync(path.join(repositoryRoot, 'public/music/index.html'), 'utf8')
  const appSource = fs.readFileSync(path.join(repositoryRoot, 'public/music/app.js'), 'utf8')
  const paginationSource = fs.readFileSync(path.join(repositoryRoot, 'public/music/js/batch_pagination.js'), 'utf8')
  const songListSource = fs.readFileSync(path.join(repositoryRoot, 'public/music/js/songlist_manager.js'), 'utf8')
  const leaderboardSource = fs.readFileSync(path.join(repositoryRoot, 'public/music/js/leaderboard_manager.js'), 'utf8')
  const localMusicSource = fs.readFileSync(path.join(repositoryRoot, 'public/music/js/local_music.js'), 'utf8')

  for (const id of ['search-btn-first', 'search-btn-last', 'btn-songlist-first', 'btn-songlist-last', 'lb-btn-first', 'lb-btn-last', 'lm-page-first', 'lm-page-last']) {
    assert.ok(html.includes(`id="${id}"`), `Missing pagination control ${id}`)
  }
  assert.match(paginationSource, /function firstPage\(\)/)
  assert.match(paginationSource, /function lastPage\(\)/)
  assert.match(appSource, /function artistSongsFirstPage\(\)/)
  assert.match(appSource, /function artistSongsLastPage\(\)/)
  assert.match(songListSource, /goToPage: function \(page\)/)
  assert.match(leaderboardSource, /async function goToBoundary\(boundary\)/)
  assert.match(localMusicSource, /goToPage\(page\)/)
})

test('unselected playlist choices use the default green style', () => {
  const appSource = fs.readFileSync(path.join(repositoryRoot, 'public/music/app.js'), 'utf8')
  const functionSource = extractFunction(appSource, 'function renderPlaylistAddGrid()')
  assert.match(functionSource, /bg-emerald-50 text-emerald-500/)
  assert.doesNotMatch(functionSource, /else \{\s*className \+= "bg-red-50/)

  const buttonSources = [
    appSource,
    fs.readFileSync(path.join(repositoryRoot, 'public/music/js/songlist_manager.js'), 'utf8'),
    fs.readFileSync(path.join(repositoryRoot, 'public/music/js/leaderboard_manager.js'), 'utf8'),
    fs.readFileSync(path.join(repositoryRoot, 'public/music/js/local_music.js'), 'utf8'),
    fs.readFileSync(path.join(repositoryRoot, 'public/music/js/download_manager.js'), 'utf8'),
  ]
  const addButtons = buttonSources.flatMap(source => [...source.matchAll(/<button\b[^>]*title="添加到歌单"[^>]*>/g)].map(match => match[0]))
  assert.ok(addButtons.length >= 8)
  for (const button of addButtons) assert.doesNotMatch(button, /(?:text|bg|border)-(?:red|rose)-/)
})

test('adding a song validates playlist data and preserves the current page', () => {
  const appSource = fs.readFileSync(path.join(repositoryRoot, 'public/music/app.js'), 'utf8')
  assert.match(appSource, /async function ensurePlaylistDataAvailable\(\)/)
  assert.match(appSource, /await ensurePlaylistDataAvailable\(\)/)
  assert.match(appSource, /function handleListClick\(listId, skipAutoUpdate = false, preservePage = false\)/)
  assert.match(appSource, /if \(!preservePage\) \{\s*currentPage = 1;/)
  assert.match(appSource, /handleListClick\(window\.currentViewingListId, true, true\)/)
})

test('player sidebar links directly to the admin page', () => {
  const html = fs.readFileSync(path.join(repositoryRoot, 'public/music/index.html'), 'utf8')
  assert.match(html, /id="nav-admin-link"/)
  assert.match(html, /onclick="event\.preventDefault\(\); goToAdmin\(\)"/)
})

test('admin page documents all Subsonic search scopes', () => {
  const html = fs.readFileSync(path.join(repositoryRoot, 'public/index.html'), 'utf8')
  for (const prefix of ['all:', 'online:', 'local:', 'wy:', 'tx:', 'kw:', 'kg:', 'mg:']) {
    assert.ok(html.includes(prefix), `Missing Subsonic search prefix ${prefix}`)
  }
})

test('token-authenticated local list deletion is not blocked by a missing saved password', async () => {
  const opsSource = fs.readFileSync(path.join(repositoryRoot, 'public/music/js/single_song_ops.js'), 'utf8')
  const functionSource = extractFunction(opsSource, 'async function deleteSingleSong(songId)')
  let fetchCalls = 0
  const context = vm.createContext({
    showSelect: async () => true,
    requireAdminForOpenWrite: async () => true,
    getCurrentActiveListId: () => 'default',
    currentListData: { username: 'test', defaultList: [{ id: 'song-a' }], loveList: [], userList: [] },
    localStorage: {
      getItem(key) {
        if (key === 'lx_sync_user') return 'test'
        if (key === 'lx_user_token') return 'token'
        return null
      },
    },
    getUserAuthHeaders: () => ({ 'x-user-name': 'test', 'x-user-token': 'token' }),
    requestListSongRemoval: async () => { fetchCalls++ },
    window: {
      SyncManager: { mode: 'local', sync: async () => ({ defaultList: [], loveList: [], userList: [] }) },
      ListStore: { set: async () => {} },
    },
    renderMyLists: () => {},
    handleListClick: () => {},
    showError: () => {},
    console,
  })
  vm.runInContext(functionSource, context)

  await context.deleteSingleSong('song-a')

  assert.equal(fetchCalls, 1)
})

test('web player exports built-in and custom playlists as local JSON files', () => {
  const appSource = fs.readFileSync(path.join(repositoryRoot, 'public/music/app.js'), 'utf8')
  const functionSource = extractFunction(appSource, 'function buildPlaylistExport(listId, exportedAt = new Date().toISOString())')
  const context = vm.createContext({
    currentListData: {
      defaultList: [{ id: 'song-a', name: 'Song A' }],
      loveList: [],
      userList: [{ id: 'custom', name: '夜晚/放松', source: 'wy', sourceListId: '123', list: [{ id: 'song-b', name: 'Song B' }] }],
    },
  })
  vm.runInContext(functionSource, context)

  const builtIn = context.buildPlaylistExport('default', '2026-08-09T00:00:00.000Z')
  assert.equal(builtIn.fileName, '默认列表.json')
  assert.deepEqual(JSON.parse(builtIn.json).playlist.list.map(song => song.id), ['song-a'])

  const custom = context.buildPlaylistExport('custom', '2026-08-09T00:00:00.000Z')
  assert.equal(custom.fileName, '夜晚_放松.json')
  const payload = JSON.parse(custom.json)
  assert.equal(payload.type, 'lxserver-playlist')
  assert.equal(payload.version, 1)
  assert.equal(payload.playlist.sourceListId, '123')
  assert.deepEqual(payload.playlist.list.map(song => song.id), ['song-b'])
})

const waitForServer = async (baseUrl, process, getOutput) => {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`Server exited with ${process.exitCode}:\n${getOutput()}`)
    }
    try {
      const response = await fetch(`${baseUrl}/rest/ping?u=test&p=test-pass&f=json`)
      if (response.ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for test server:\n${getOutput()}`)
}

test('Subsonic playlist mutation endpoints persist changes', async t => {
  const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lxserver-subsonic-'))
  const userDir = path.join(dataPath, 'users', `test_${crypto.createHash('md5').update('test').digest('hex').slice(0, 6)}`)
  const listDir = path.join(userDir, 'list')
  const snapshotDir = path.join(listDir, 'snapshot')
  fs.mkdirSync(snapshotDir, { recursive: true })
  fs.writeFileSync(path.join(dataPath, 'users.json'), JSON.stringify([
    { name: 'test', password: 'test-pass' },
  ]))

  const initialData = {
    defaultList: [{ id: 'song-a', name: 'Song A', singer: 'Artist A', source: 'wy', songmid: 'a' }],
    loveList: [{ id: 'song-b', name: 'Song B', singer: 'Artist B', source: 'wy', songmid: 'b' }],
    userList: [{
      id: 'source-list',
      name: 'Source list',
      list: [{ id: 'song-c', name: 'Song C', singer: 'Artist C', source: 'wy', songmid: 'c' }],
    }],
  }
  const snapshotJson = JSON.stringify(initialData)
  const snapshotId = crypto.createHash('md5').update(snapshotJson).digest('hex')
  fs.writeFileSync(path.join(snapshotDir, `snapshot_${snapshotId}`), snapshotJson)
  fs.writeFileSync(path.join(listDir, 'snapshotInfo.json'), JSON.stringify({
    latest: snapshotId,
    time: Date.now(),
    list: [],
    clients: {},
  }))

  const port = 19_000 + (process.pid % 1_000)
  const baseUrl = `http://127.0.0.1:${port}`
  let output = ''
  const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      BIND_IP: '127.0.0.1',
      CONFIG_PATH: path.join(dataPath, 'config.js'),
      DATA_PATH: dataPath,
      DISABLE_TELEMETRY: 'true',
      LIST_ADD_MUSIC_LOCATION_TYPE: 'bottom',
      PORT: String(port),
      ADMIN_PATH: '/music',
      PLAYER_PATH: '/',
      SUBSONIC_ENABLE: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', chunk => { output = (output + chunk).slice(-8_000) })
  server.stderr.on('data', chunk => { output = (output + chunk).slice(-8_000) })
  t.after(() => {
    if (server.exitCode === null) server.kill('SIGTERM')
    fs.rmSync(dataPath, { recursive: true, force: true })
  })
  await waitForServer(baseUrl, server, () => output)

  const playerHtml = await (await fetch(`${baseUrl}/`)).text()
  assert.match(playerHtml, /<title>LX Music Web<\/title>/)
  const adminHtml = await (await fetch(`${baseUrl}/music/`)).text()
  assert.match(adminHtml, /<title>LX Music Sync Server - 管理控制台<\/title>/)

  const call = async (method, params = {}) => {
    const query = new URLSearchParams({ u: 'test', p: 'test-pass', f: 'json', ...params })
    const response = await fetch(`${baseUrl}/rest/${method}?${query}`)
    assert.equal(response.status, 200)
    return response.json()
  }
  const post = async (method, entries) => {
    const query = new URLSearchParams({ u: 'test', p: 'test-pass', f: 'json' })
    const body = new URLSearchParams(entries)
    const response = await fetch(`${baseUrl}/rest/${method}?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    assert.equal(response.status, 200)
    return response.json()
  }
  const responseBody = body => body['subsonic-response']

  const folders = responseBody(await call('getMusicFolders')).musicFolders.musicFolder
  assert.deepEqual(folders.map(folder => folder.id), ['1', 'local', 'all', 'wy', 'tx', 'kw', 'kg', 'mg'])

  assert.equal(responseBody(await call('updatePlaylist', {
    playlistId: 'default',
    songIdToAdd: 'song-b',
  })).status, 'ok')
  let playlist = responseBody(await call('getPlaylist', { id: 'default' })).playlist
  assert.deepEqual(playlist.entry.map(song => song.id), ['song-a', 'song-b'])

  assert.equal(responseBody(await call('updatePlaylist', {
    playlistId: 'default',
    songIdToAdd: 'song-c',
    songIndexToAdd: '0',
  })).status, 'ok')
  playlist = responseBody(await call('getPlaylist', { id: 'default' })).playlist
  assert.deepEqual(playlist.entry.map(song => song.id), ['song-c', 'song-a', 'song-b'])

  const created = responseBody(await call('createPlaylist', {
    name: 'Created through Subsonic',
    songId: 'song-b',
  }))
  assert.equal(created.status, 'ok')
  const createdId = created.playlist?.id
  assert.ok(createdId)

  assert.equal(responseBody(await post('updatePlaylist', [
    ['playlistId', createdId],
    ['songIdToAdd', 'song-a'],
    ['songIdToAdd', 'song-c'],
  ])).status, 'ok')
  playlist = responseBody(await call('getPlaylist', { id: createdId })).playlist
  assert.deepEqual(playlist.entry.map(song => song.id), ['song-b', 'song-a', 'song-c'])

  assert.equal(responseBody(await post('updatePlaylist', [
    ['playlistId', createdId],
    ['songIndexToRemove', '1'],
  ])).status, 'ok')
  playlist = responseBody(await call('getPlaylist', { id: createdId })).playlist
  assert.deepEqual(playlist.entry.map(song => song.id), ['song-b', 'song-c'])

  // Some clients send a song ID even though the original Subsonic API specifies an index.
  assert.equal(responseBody(await post('updatePlaylist', [
    ['playlistId', createdId],
    ['songIdToRemove', 'song-b'],
  ])).status, 'ok')
  playlist = responseBody(await call('getPlaylist', { id: createdId })).playlist
  assert.deepEqual(playlist.entry.map(song => song.id), ['song-c'])

  assert.equal(responseBody(await call('updatePlaylist', {
    playlistId: createdId,
    name: 'Renamed through Subsonic',
  })).status, 'ok')
  playlist = responseBody(await call('getPlaylist', { id: createdId })).playlist
  assert.equal(playlist.name, 'Renamed through Subsonic')

  let playlists = responseBody(await call('getPlaylists')).playlists.playlist
  assert.ok(playlists.some(item => item.id === createdId))

  assert.equal(responseBody(await call('deletePlaylist', { id: createdId })).status, 'ok')
  playlists = responseBody(await call('getPlaylists')).playlists.playlist
  assert.ok(!playlists.some(item => item.id === createdId))
})
