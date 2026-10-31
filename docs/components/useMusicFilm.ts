import { nextTick, onBeforeUnmount, onMounted, type Ref } from 'vue'
import { withBase } from 'vitepress'

/** A single native-scroll timeline. No wheel interception, timers or global state. */
export function useMusicFilm(root: Ref<HTMLElement | undefined>, ready: Ref<boolean>,
  resting: Ref<boolean>, systemReduced: Ref<boolean>, activeView: Ref<number>, viewCount: () => number) {
  let dispose = () => {}
  let refresh = () => {}
  onMounted(() => {
    const el = root.value!
    const find = (selector: string) => el.querySelector<HTMLElement>(selector)!
    const film = find('.music-film')
    const hero = find('.music-hero'), collection = find('.music-collection')
    const connect = find('.music-connect'), deploy = find('.music-deploy'), footer = find('.music-footer')
    const title = find('.music-hero-title'), intro = find('.music-hero-intro')
    const media = find('.music-hero-media'), listen = find('.music-listen-copy'), note = find('.music-hero-note')
    const product = find('.music-product-window'), heading = find('.music-collection-heading')
    const panels = [...el.querySelectorAll<HTMLElement>('.music-view-copy')]
    const shots = [...el.querySelectorAll<HTMLElement>('.music-product-shot')]
    const videos = [...el.querySelectorAll<HTMLVideoElement>('video[data-film-clip]')]
    const signals = [...el.querySelectorAll<HTMLElement>('.music-signal span')]
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    systemReduced.value = reduced.matches
    let disposed = false, frame = 0
    const listeners: (() => void)[] = []
    const listenTo = (target: EventTarget, event: string, handler: EventListener) => {
      target.addEventListener(event, handler); listeners.push(() => target.removeEventListener(event, handler))
    }
    const clamp = (n: number) => Math.max(0, Math.min(1, n))
    const smooth = (n: number) => { const x = clamp(n); return x * x * (3 - 2 * x) }
    const paint = (node: HTMLElement, alpha: number, transform = '') => {
      node.style.opacity = `${alpha}`
      node.style.visibility = alpha < .025 ? 'hidden' : ''
      node.style.transform = transform
    }
    const stage = (node: HTMLElement, alpha: number, transform = '') => {
      paint(node, alpha, transform)
      node.style.visibility = alpha < .025 ? 'hidden' : 'visible'
      node.inert = alpha < .45
    }
    const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData)
    const loadClip = (video: HTMLVideoElement) => {
      if (saveData || video.dataset.failed || video.hasAttribute('src')) return
      const mobile = window.innerWidth < 760
      video.muted = true
      video.preload = 'auto'
      video.src = withBase(`/showcase/${video.dataset.filmClip}${mobile ? '-mobile' : ''}.mp4`)
      video.load()
    }
    const scrub = (name: string, fraction: number) => {
      const video = videos.find(v => v.dataset.filmClip === name)
      if (!video) return
      loadClip(video)
      if (!Number.isFinite(video.duration) || !video.duration || video.seeking || video.readyState < 1) return
      const desired = clamp(fraction) * Math.max(0, video.duration - .06)
      const delta = desired - video.currentTime
      if (Math.abs(delta) > .028) video.currentTime += Math.abs(delta) < .1 ? delta : delta * .32
    }
    const update = () => {
      frame = 0
      if (disposed) return
      if (resting.value) {
        ;[hero, collection, connect, deploy, footer, ...panels].forEach(node => { node.inert = false })
        videos.forEach(v => v.pause())
        return
      }
      const mobile = window.innerWidth < 760
      const rect = film.getBoundingClientRect()
      const p = clamp(-rect.top / Math.max(1, rect.height - window.innerHeight))
      el.style.setProperty('--film-progress', `${p}`)
      const h = clamp(p / .205), entry = smooth(h / .52), immersion = smooth((h - .36) / .38)
      const heroExit = smooth((p - .185) / .075)
      stage(hero, 1 - heroExit, `translate3d(0,${-heroExit * 12}vh,0) scale(${1 - heroExit * .06})`)
      paint(title, 1 - smooth(h / .3), `translate3d(0,${-h * 190}px,0)`)
      paint(intro, 1 - smooth(h / .28), `translate3d(0,${-h * 110}px,0)`)
      intro.inert = h > .28
      paint(note, 1 - entry)
      paint(listen, smooth((immersion - .25) / .5) * (1 - smooth((p - .18) / .035)), `translate3d(0,${(1 - immersion) * 45}px,0)`)
      listen.inert = immersion < .5 || p > .215
      paint(media, 1, mobile
        ? `translate3d(${-entry * 5}%,${-entry * 9 + immersion * 8}vh,0) scale(${1 + entry * .1}) rotateX(${(1 - entry) * 8}deg)`
        : `translate3d(${-entry * 9 + immersion * 43}%,${-entry * 17 - immersion * 13}vh,0) scale(${1 + entry * .12}) rotateX(${(1 - entry) * 11}deg) rotateY(${-immersion * 8}deg)`)
      if (p < .27) scrub('listening', clamp(p / .24))

      const collectionEnter = smooth((p - .21) / .055), collectionExit = smooth((p - .71) / .055)
      stage(collection, collectionEnter * (1 - collectionExit), `translate3d(${collectionExit * 38}%,${(1 - collectionEnter) * 10 - collectionExit * 5}vh,0) scale(${1 - collectionExit * .14})`)
      const c = clamp((p - .265) / .445), count = viewCount()
      const position = c * count, index = Math.min(count - 1, Math.floor(position))
      const local = c === 1 ? 1 : position - index
      activeView.value = index
      const textIn = index === 0 ? 1 : smooth(local / .2)
      const textOut = index === count - 1 ? 0 : smooth((local - .84) / .16)
      panels.forEach((panel, i) => {
        const alpha = i === index ? textIn * (1 - textOut) * (1 - smooth(collectionExit / .65)) : 0
        paint(panel, alpha, `translate3d(0,${(1 - alpha) * 18}px,0)`)
        panel.inert = i !== index || collectionEnter < .8 || collectionExit > .2
      })
      // Incoming text waits for the outgoing text. Images retain a continuous wipe.
      paint(heading, collectionEnter * (1 - smooth(collectionExit / .65)))
      paint(product, 1, `perspective(1800px) rotateY(${mobile ? 0 : -3 + c * 6}deg) translate3d(0,${-Math.sin(c * Math.PI) * 15}px,0)`)
      shots.forEach((shot, i) => {
        const reveal = i === 0 ? 1 : clamp((position - i + .16) / .32)
        shot.style.clipPath = `inset(${(1 - reveal) * 100}% 0 0 0)`
        shot.style.transform = `scale(${1 + (i === index ? (1 - local) * .025 : 0)})`
      })
      const activeShot = shots[index]
      if (p > .23 && p < .78) {
        const clip = activeShot?.querySelector<HTMLVideoElement>('video')
        if (clip) scrub(clip.dataset.filmClip!, local)
        // Load only the neighbouring clip, so a quick wheel can reverse immediately.
        for (const neighbour of [index - 1, index + 1]) {
          const next = shots[neighbour]?.querySelector<HTMLVideoElement>('video')
          if (next) loadClip(next)
        }
      }

      const connectionsIn = smooth((p - .735) / .06), connectionsOut = smooth((p - .855) / .045)
      stage(connect, connectionsIn * (1 - connectionsOut), `translate3d(0,${(1 - connectionsIn) * 14 - connectionsOut * 12}vh,0) scale(${.94 + connectionsIn * .06})`)
      const connectionArrival = smooth((p - .765) / .035)
      paint(find('.music-connection'), connectionArrival, `translate3d(${(1 - connectionArrival) * 15}%,0,0)`)
      signals.forEach((signal, i) => {
        const wave = Math.sin(clamp((p - .735) / .165) * Math.PI * 5 - i * 1.1)
        paint(signal, .25 + .75 * (wave + 1) / 2, `translate3d(${wave * 4}px,0,0)`)
      })
      const closing = smooth((p - .875) / .075)
      stage(deploy, closing, `translate3d(0,${(1 - closing) * 20}vh,0)`)
      stage(footer, smooth((p - .94) / .04), `translate3d(0,${(1 - closing) * 40}px,0)`)
      el.classList.toggle('is-closing', p > .915)
      // The connector is active only during its scene, not off screen.
      find('.music-connection').classList.toggle('is-in-view', p > .735 && p < .9)
    }
    refresh = () => { if (!disposed && !frame) frame = requestAnimationFrame(update) }
    videos.forEach(video => {
      listenTo(video, 'loadedmetadata', refresh)
      listenTo(video, 'loadeddata', () => { video.classList.add('has-frame'); refresh() })
      listenTo(video, 'seeked', () => { video.classList.add('has-frame'); refresh() })
      listenTo(video, 'error', () => { video.dataset.failed = 'true'; video.classList.remove('has-frame') })
    })
    const reducedChanged = () => { systemReduced.value = reduced.matches; nextTick(refresh) }
    reduced.addEventListener('change', reducedChanged)
    window.addEventListener('scroll', refresh, { passive: true })
    window.addEventListener('resize', refresh, { passive: true })
    ready.value = true
    nextTick(refresh)
    dispose = () => {
      disposed = true
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', refresh)
      window.removeEventListener('resize', refresh)
      reduced.removeEventListener('change', reducedChanged)
      listeners.forEach(remove => remove())
      videos.forEach(video => { video.pause(); video.removeAttribute('src'); video.load() })
    }
  })
  onBeforeUnmount(() => dispose())
  return () => refresh()
}
