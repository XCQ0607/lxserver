const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')

function createVisualizerEnvironment() {
  const filePath = 'public/music/js/player/visualizer.js'
  const code = readFileSync(filePath, 'utf8')
  const listeners = {}
  let currentTime = 1000
  let audioPlayer = {
    paused: false,
    muted: false,
    volume: 1.0,
    currentTime: 10,
    readyState: 4,
    addEventListener: () => {},
    removeEventListener: () => {}
  }
  const context = {
    window: {
      addEventListener: (evt, fn) => { listeners[evt] = fn },
      removeEventListener: () => {}
    },
    document: {
      documentElement: { classList: { contains: () => false }, getAttribute: () => null },
      getElementById: (id) => id === 'audio-player' ? audioPlayer : null,
      addEventListener: () => {}
    },
    performance: { now: () => currentTime },
    Math,
    Uint8Array,
    console
  }
  context.window.window = context.window
  context.window.document = context.document
  vm.createContext(context)
  vm.runInContext(code, context)
  return {
    LXStudioVUMeterAnimation: context.window.LXStudioVUMeterAnimation,
    setSimulatedTime: (t) => { currentTime = t },
    window: context.window,
    audioPlayer
  }
}

test('vuToNorm accurately maps dial scale points to dial tick norms', () => {
  const { LXStudioVUMeterAnimation } = createVisualizerEnvironment()
  assert.ok(LXStudioVUMeterAnimation, 'LXStudioVUMeterAnimation must be exported on window')

  const vu = new LXStudioVUMeterAnimation()

  // Test scale bounds and tick alignments matching canvas masterTicks
  assert.equal(vu.vuToNorm(-30), 0.0)
  assert.ok(Math.abs(vu.vuToNorm(-20) - 0.08) < 1e-3, '-20 VU must map to norm 0.08')
  assert.ok(Math.abs(vu.vuToNorm(-10) - 0.32) < 1e-3, '-10 VU must map to norm 0.32')
  assert.ok(Math.abs(vu.vuToNorm(-7) - 0.44) < 1e-3, '-7 VU must map to norm 0.44')
  assert.ok(Math.abs(vu.vuToNorm(-5) - 0.54) < 1e-3, '-5 VU must map to norm 0.54')
  assert.ok(Math.abs(vu.vuToNorm(-3) - 0.64) < 1e-3, '-3 VU must map to norm 0.64')
  assert.ok(Math.abs(vu.vuToNorm(-1) - 0.74) < 1e-3, '-1 VU must map to norm 0.74')
  assert.ok(Math.abs(vu.vuToNorm(0) - 0.80) < 1e-3, '0 VU must map to norm 0.80')
  assert.ok(Math.abs(vu.vuToNorm(1) - 0.8666667) < 1e-3, '+1 VU must map to norm 0.8667')
  assert.ok(Math.abs(vu.vuToNorm(2) - 0.9333333) < 1e-3, '+2 VU must map to norm 0.9333')
  assert.ok(Math.abs(vu.vuToNorm(3) - 1.00) < 1e-3, '+3 VU must map to norm 1.00')
})

const STUDY_THEMES = ['study-nocturne', 'study-heritage', 'study-atelier', 'study-riviera', 'study-cobalt']

function createMockCtx(width, height) {
  const base = {
    canvas: { width, height, clientWidth: width, clientHeight: height },
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    measureText: text => ({ width: String(text).length * 6 }),
    fillTextCalls: []
  }
  base.fillText = (text, x, y) => base.fillTextCalls.push({ text, x, y })
  return new Proxy(base, {
    get: (target, key) => (key in target ? target[key] : () => {}),
    set: (target, key, value) => { target[key] = value; return true }
  })
}

test('design-study dials fall back to Nocturne for unsupported themes', () => {
  const { LXStudioVUMeterAnimation } = createVisualizerEnvironment()
  const vu = new LXStudioVUMeterAnimation()
  assert.deepEqual(STUDY_THEMES.map(id => vu.getDesign(id).name), ['Nocturne', 'Heritage', 'Atelier', 'Riviera', 'Cobalt'])
  const legacy = { 'vintage-amber': 'study-nocturne', 'ocean-blue': 'study-nocturne', 'cyber-cyan': 'study-nocturne', 'champagne-gold': 'study-nocturne', 'studio-monochrome': 'study-nocturne', unknown: 'study-nocturne' }
  for (const [from, to] of Object.entries(legacy)) {
    assert.equal(LXStudioVUMeterAnimation.normalizeTheme(from), to)
  }
  for (const id of STUDY_THEMES) {
    assert.equal(LXStudioVUMeterAnimation.normalizeTheme(id), id)
  }
  for (const id of ['constructor', 'toString', '__proto__', null, undefined]) {
    assert.equal(LXStudioVUMeterAnimation.normalizeTheme(id), 'study-nocturne')
    assert.ok(vu.getDesign(id).geometry)
  }
})

test('every dial prints a calibrated, monotonic scale inside its sweep', () => {
  const { LXStudioVUMeterAnimation } = createVisualizerEnvironment()
  const vu = new LXStudioVUMeterAnimation()
  for (const id of STUDY_THEMES) {
    const { geometry: g } = vu.getDesign(id)
    const marks = vu.getScaleMarks(id)
    const angles = marks.map(m => vu.scaleAngle(id, m.norm))
    for (let i = 1; i < angles.length; i++) assert.ok(angles[i] > angles[i - 1], `${id} ticks must increase`)
    assert.ok(angles[0] >= g.start - 1e-9 && angles.at(-1) <= g.start + g.sweep + 1e-9, `${id} ticks must stay in the sweep`)
    const zero = marks.find(m => m.label === '0')
    assert.ok(zero && Math.abs(zero.norm - vu.vuToNorm(0)) < 1e-9, `${id} must align 0 VU to the shared calibration`)
  }
  assert.ok(vu.getScaleMarks('study-cobalt').length > vu.getScaleMarks('study-riviera').length, 'cobalt should be denser than riviera')
})

test('every dial renders at detail and footer sizes and hides on mobile', () => {
  const { LXStudioVUMeterAnimation, window } = createVisualizerEnvironment()
  for (const id of STUDY_THEMES) {
    window.settings = { vuMeterTheme: id }
    for (const [w, h, compact] of [[1200, 380, false], [456, 72, true]]) {
      window.innerWidth = 1440
      const ctx = createMockCtx(w, h)
      new LXStudioVUMeterAnimation({ isCompact: compact }).renderConsole(ctx, w, h, 0.6, 0.7, compact)
      assert.ok(ctx.fillTextCalls.some(c => c.text === '0'), `${id} ${w}x${h} should print its scale`)
      for (const c of ctx.fillTextCalls) assert.ok(c.x >= 0 && c.x <= w && c.y >= 0 && c.y <= h, `${id} label ${c.text} must stay on canvas`)
    }
  }
  window.innerWidth = 390
  const ctx = createMockCtx(390, 40)
  new LXStudioVUMeterAnimation({ isCompact: true }).renderConsole(ctx, 390, 40, 0.6, 0.7, true)
  assert.equal(ctx.fillTextCalls.length, 0, 'mobile viewports should not draw a VU meter')
})

test('VU meter at 100% player volume oscillates and does not stay pinned at max level (1.0)', () => {
  const { LXStudioVUMeterAnimation, setSimulatedTime } = createVisualizerEnvironment()

  let simulatedTime = 1000
  let renderedLevels = []
  const mockCtx = {
    canvas: { width: 400, height: 60 },
    save: () => {},
    restore: () => {},
    clearRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: () => {},
    arcTo: () => {},
    arc: () => {},
    clip: () => {},
    fillText: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    roundRect: () => {}
  }

  const vu = new LXStudioVUMeterAnimation({ isCompact: true })

  vu.renderConsole = (ctx, w, h, levelL, levelR) => {
    renderedLevels.push({ levelL, levelR })
  }

  function makeTimeDomain(targetRms) {
    const buf = new Uint8Array(512)
    const amp = Math.min(127, Math.round(targetRms * Math.SQRT2 * 128))
    for (let i = 0; i < 512; i++) {
      buf[i] = Math.round(128 + amp * Math.sin((i / 512) * Math.PI * 8))
    }
    return buf
  }

  const rmsValues = [
    0.30, 0.30, 0.28, 0.14, 0.12, 0.12, 0.13, 0.32, 0.30, 0.15, 0.12, 0.11
  ]

  vu.options.analyserL = {
    fftSize: 512,
    getByteTimeDomainData: (buf) => {
      const curRms = rmsValues[Math.floor((simulatedTime - 1000) / 100) % rmsValues.length]
      buf.set(makeTimeDomain(curRms))
    }
  }
  vu.options.analyserR = vu.options.analyserL

  for (let frame = 0; frame < 60; frame++) {
    simulatedTime += 33
    setSimulatedTime(simulatedTime)
    vu.draw(null, mockCtx)
  }

  const levels = renderedLevels.map(r => r.levelL)
  const minLevel = Math.min(...levels)
  const maxLevel = Math.max(...levels)

  assert.ok(maxLevel < 1.0, `Max needle level should not be pegged at 1.0 (got ${maxLevel})`)
  assert.ok(maxLevel > 0.60, `Needle should rise into active zone on loud beats (got ${maxLevel})`)
  assert.ok(minLevel < 0.60, `Needle should dip down between beats (got ${minLevel})`)
  assert.ok((maxLevel - minLevel) > 0.15, `Needle should oscillate with significant dynamic range (swing was ${maxLevel - minLevel})`)
})
