const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')

test('music player search inputs are enclosed in role="search" forms with autocomplete="off"', () => {
  const html = readFileSync('public/music/index.html', 'utf8')

  // Search input must not use the legacy one-time-code hack or readonly workaround
  assert.doesNotMatch(html, /id="search-input"[^>]*autocomplete="one-time-code"/,
    'search-input should not use one-time-code autocomplete')
  assert.doesNotMatch(html, /id="search-input"[^>]*readonly onfocus/,
    'search-input should not use readonly onfocus workaround')

  // Main search bar must be in a form with role="search"
  const searchFormMatch = html.match(/<form[^>]*role="search"[^>]*id="search-input-wrapper"[^>]*>[\s\S]*?<input[^>]*id="search-input"[\s\S]*?<\/form>/)
  assert.ok(searchFormMatch, 'main search-input must be enclosed in a <form role="search"> container')

  // Check all specific search inputs are inside <form role="search"> and have autocomplete="off"
  const searchInputIds = [
    'search-input',
    'gl-local-search-input',
    'songlist-search-input',
    'sl-local-search-input',
    'lb-local-search-input',
    'manual-index-search-input'
  ]

  for (const id of searchInputIds) {
    const inputRegex = new RegExp(`<input[^>]*id="${id}"[^>]*>`, 'i')
    const match = html.match(inputRegex)
    assert.ok(match, `Input ${id} must exist in public/music/index.html`)
    assert.match(match[0], /autocomplete="off"/, `${id} must have autocomplete="off"`)
  }

  // Search inputs with onsubmit handlers must not duplicate search on Enter keypress
  assert.doesNotMatch(html, /id="search-input"[^>]*onkeypress=/,
    'search-input should not have redundant onkeypress handler')
  assert.doesNotMatch(html, /id="songlist-search-input"[^>]*onkeypress=/,
    'songlist-search-input should not have redundant onkeypress handler')
})

test('all password and connection code inputs in music web app are isolated in dedicated form elements', () => {
  const html = readFileSync('public/music/index.html', 'utf8')

  // Local sync login must be a <form> with username & current-password autocomplete
  const localSyncForm = html.match(/<form[^>]*id="sync-form-local"[^>]*>[\s\S]*?<\/form>/)
  assert.ok(localSyncForm, 'sync-form-local must be an explicit <form>')
  assert.match(localSyncForm[0], /id="sync-local-user"[^>]*autocomplete="username"/,
    'sync-local-user must have autocomplete="username"')
  assert.match(localSyncForm[0], /id="sync-local-pass"[^>]*autocomplete="current-password"/,
    'sync-local-pass must have autocomplete="current-password"')

  // Remote sync connect modal must be a <form> and sync-code must not be treated as a login password
  const syncConnectForm = html.match(/<form[^>]*id="sync-connect-form"[^>]*>[\s\S]*?<\/form>/)
  assert.ok(syncConnectForm, 'sync-connect-form must be an explicit <form>')
  assert.match(syncConnectForm[0], /id="sync-code"[^>]*autocomplete="new-password"/,
    'sync-code must have autocomplete="new-password"')

  // Remote overwrite modal must be a <form>
  const remoteOverwriteForm = html.match(/<form[^>]*id="remote-overwrite-step1"[^>]*>[\s\S]*?<\/form>/)
  assert.ok(remoteOverwriteForm, 'remote-overwrite-step1 must be an explicit <form>')
  assert.match(remoteOverwriteForm[0], /id="remote-overwrite-code"[^>]*autocomplete="new-password"/,
    'remote-overwrite-code must have autocomplete="new-password"')

  // Remote sync settings form must be a <form>
  const remoteSyncForm = html.match(/<form[^>]*id="sync-form-remote"[^>]*>[\s\S]*?<\/form>/)
  assert.ok(remoteSyncForm, 'sync-form-remote must be an explicit <form>')
})

test('admin console isolates configuration passwords from login autocomplete', () => {
  const html = readFileSync('public/index.html', 'utf8')

  // Config form must have autocomplete="off"
  const configFormMatch = html.match(/<form[^>]*id="config-form"[^>]*>/)
  assert.ok(configFormMatch, 'config-form must exist')
  assert.match(configFormMatch[0], /autocomplete="off"/, 'config-form must have autocomplete="off"')

  // Sensitive password fields inside config form must have autocomplete="new-password"
  assert.match(html, /<input[^>]*name="admin\.password"[^>]*autocomplete="new-password"/,
    'admin.password must specify autocomplete="new-password"')
  assert.match(html, /<input[^>]*name="player\.password"[^>]*autocomplete="new-password"/,
    'player.password must specify autocomplete="new-password"')
  assert.match(html, /<input[^>]*name="webdav\.password"[^>]*autocomplete="new-password"/,
    'webdav.password must specify autocomplete="new-password"')

  // Edit password modal input must be type="password" with autocomplete="new-password"
  const editPassMatch = html.match(/<input[^>]*id="edit-password-input"[^>]*>/)
  assert.ok(editPassMatch, 'edit-password-input must exist')
  assert.match(editPassMatch[0], /type="password"/, 'edit-password-input must be type="password"')
  assert.match(editPassMatch[0], /autocomplete="new-password"/, 'edit-password-input must have autocomplete="new-password"')
})

test('handleLocalLogin clears password from the DOM input after successful authentication', () => {
  const appJs = readFileSync('public/music/app.js', 'utf8')
  assert.match(appJs, /if\s*\(passInput\)\s*passInput\.value\s*=\s*'';/,
    'handleLocalLogin must clear passInput.value in DOM after successful login')
})

test('ListSearch.handleKeydown ignores IME composition events and navigates on standard Enter', () => {
  const vm = require('node:vm')
  const code = readFileSync('public/music/js/library/list_search.js', 'utf8')
  const context = { window: {} }
  vm.createContext(context)
  vm.runInContext(code, context)
  const ListSearch = context.window.ListSearch

  let navigated = 0
  ListSearch.navigate = (step) => { navigated += step }

  // 1. IME composing with Enter (e.g. typing pinyin/hiragana)
  let prevented = false
  ListSearch.handleKeydown({
    key: 'Enter',
    isComposing: true,
    preventDefault: () => { prevented = true }
  })
  assert.equal(navigated, 0, 'should not navigate during isComposing')
  assert.equal(prevented, false, 'should not preventDefault during isComposing')

  // 2. IME keyCode 229 with Enter
  ListSearch.handleKeydown({
    key: 'Enter',
    keyCode: 229,
    preventDefault: () => { prevented = true }
  })
  assert.equal(navigated, 0, 'should not navigate when keyCode is 229')
  assert.equal(prevented, false, 'should not preventDefault when keyCode is 229')

  // 3. Normal Enter keydown
  ListSearch.handleKeydown({
    key: 'Enter',
    isComposing: false,
    keyCode: 13,
    preventDefault: () => { prevented = true }
  })
  assert.equal(navigated, 1, 'should navigate on standard Enter')
  assert.equal(prevented, true, 'should preventDefault on standard Enter')
})
