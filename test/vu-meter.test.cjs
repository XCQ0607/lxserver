const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync, existsSync } = require('node:fs')
const vm = require('node:vm')

function createVisualizerEnvironment() {
  const filePath = existsSync('public/music/js/visualizer.js') ? 'public/music/js/visualizer.js' : 'public/music/js/player/visualizer.js'
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
  assert.ok(Math.abs(vu.vuToNorm(-7) - 0.48) < 1e-3, '-7 VU must map to norm 0.48')
  assert.ok(Math.abs(vu.vuToNorm(-5) - 0.60) < 1e-3, '-5 VU must map to norm 0.60')
  assert.ok(Math.abs(vu.vuToNorm(-3) - 0.73) < 1e-3, '-3 VU must map to norm 0.73')
  assert.ok(Math.abs(vu.vuToNorm(0) - 0.86) < 1e-3, '0 VU must map to norm 0.86')
  assert.ok(Math.abs(vu.vuToNorm(1) - 0.91) < 1e-3, '+1 VU must map to norm 0.91')
  assert.ok(Math.abs(vu.vuToNorm(2) - 0.95) < 1e-3, '+2 VU must map to norm 0.95')
  assert.ok(Math.abs(vu.vuToNorm(3) - 1.00) < 1e-3, '+3 VU must map to norm 1.00')
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
