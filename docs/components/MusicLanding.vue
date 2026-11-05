<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { withBase } from 'vitepress'
import { useMusicFilm } from './useMusicFilm'
import './music-landing.css'

const props = defineProps<{ lang: 'zh' | 'en' }>()
const english = computed(() => props.lang === 'en')
const doc = (path: string) => {
  const [page, hash] = path.split('#')
  return withBase(`${english.value ? '/en' : ''}/${page}${page ? '.html' : ''}${hash ? `#${hash}` : ''}`)
}
const asset = (name: string) => withBase(`/showcase/${name}.jpg`)
const clipNames: Record<string, string> = { 'player-library': 'playlists', search: 'search', charts: 'charts', themes: 'themes', 'admin-dashboard': 'console' }
const clipFor = (image: string) => clipNames[image] || ''
const posterFor = (image: string) => asset(clipFor(image) ? `${clipFor(image)}-poster` : image)
const copy = computed(() => english.value ? {
  skip: 'Skip to content', docs: 'Documentation', start: 'Get started',
  motionOn: 'Pause motion', motionOff: 'Enable motion', motionReduced: 'Reduced motion',
  intro: 'Your music. Your space.',
  introBody: 'A self-hosted music and sync hub. Bring your library, playlists and favourite players together.',
  heroNote: 'Made for listening. Built to be yours.',
  listenTitle: ['Less noise.', 'More music.'],
  listenBody: 'Album art, word-by-word lyrics and the music you came for. A listening space that gets out of the way.',
  listenLink: 'Explore the Web player', interfaceNote: 'Actual product interface · Chinese UI shown',
  libraryTitle: ['One library.', 'Every side of it.'],
  libraryIntro: 'From the next song to the server behind it. Everything has its place.',
  views: [
    { title: 'Keep what you love.', short: 'Playlists', text: 'Search across sources. Keep favourites and playlists close, with playback controls always within reach.', link: 'Meet your player', path: 'guide/web-player', image: 'player-library', alt: 'Real Web player playlist with album art and playback controls' },
    { title: 'Find your next favourite.', short: 'Search', text: 'One search, multiple sources. Move from an artist or a song title to the music you were looking for.', link: 'Explore search', path: 'guide/web-player', image: 'search', alt: 'Recorded search flow, from trending searches to song results' },
    { title: 'Follow your curiosity.', short: 'Charts', text: 'Explore charts and discover songs beyond your own collection. A different starting point for your next listening session.', link: 'Explore discovery', path: 'guide/web-player', image: 'charts', alt: 'Real recording switching between music charts' },
    { title: 'Set your own mood.', short: 'Appearance', text: 'Light or dark. Quiet green or a different accent. Make the player feel at home in your day.', link: 'Player settings', path: 'guide/web-player', image: 'themes', alt: 'Actual player appearance settings switching themes and light and dark modes' },
    { title: 'Know your collection.', short: 'Local library', text: 'Your own audio files, with quality, sample rate, covers and lyrics in view. Find the gaps. Put your library in order.', link: 'Explore local music', path: 'guide/web-player', image: 'local-library', alt: 'Local library showing audio quality, sample rate and metadata completeness' },
    { title: 'See the whole picture.', short: 'Control centre', text: 'Manage accounts, check connected devices and watch your service. Snapshots and backup settings stay in the same console.', link: 'Explore the console', path: 'guide/sync-server', image: 'admin-dashboard', alt: 'Administration dashboard with CPU and memory charts and device counts' }
  ],
  connectTitle: ['Different players.', 'Same collection.'],
  connectBody: 'A browser at your desk. LX Music on the move. Your favourite Subsonic client. Choose how you listen.',
  clientLabel: 'Choose a connection',
  clients: [
    { name: 'Web player', detail: 'Open a browser. Your music is right there.', body: 'Search, playlists, local music and immersive lyrics in the built-in Web player. No separate client to install.', link: 'Web player guide', path: 'guide/web-player', device: 'Browser' },
    { name: 'LX Music', detail: 'Your playlists, moving with you.', body: 'Connect supported LX Music desktop and mobile clients. Synchronize playlists with separate accounts and snapshot history.', link: 'Connect LX Music', path: 'guide/sync-server', device: 'Desktop & mobile' },
    { name: 'Subsonic', detail: 'A wider world of music clients.', body: 'Connect compatible clients such as Feishin and Symfonium through the Subsonic API. See the guide for setup and supported behaviour.', link: 'Subsonic setup', path: 'guide/configuration', device: 'Compatible clients' }
  ],
  hub: 'Your music server', connection: 'One place to connect',
  closingTitle: ['Make room', 'for your music.'],
  closingBody: 'On your server, your NAS or your desktop. Choose the setup that fits, and make it your own.',
  deploy: 'Deployment guide',
  install: [
    { title: 'Docker', text: 'For a NAS or a server that stays on.', label: 'Docker Compose', path: 'guide/getting-started#docker-compose' },
    { title: 'Node.js', text: 'Run from source. Build it your way.', label: 'Run from source', path: 'guide/getting-started#build-from-source' },
    { title: 'Desktop', text: 'A dedicated window. A familiar home.', label: 'View releases', path: '' }
  ],
  footer: 'Self-hosted. Open source. Yours.', configuration: 'Configuration', api: 'API reference', operations: 'Operations & backups',
  footerNote: 'Apache-2.0 · xcq0607 & Contributors',
} : {
  skip: '跳至正文', docs: '阅读文档', start: '开始部署',
  motionOn: '暂停动态', motionOff: '开启动效', motionReduced: '已减少动态效果',
  intro: '音乐，自在一起。',
  introBody: '你的私有音乐与同步中心。让曲库、歌单和喜欢的播放器，在这里相遇。',
  heroNote: '为聆听而生，也为自由而来。',
  listenTitle: ['世界安静下来。', '只留下音乐。'],
  listenBody: '封面、逐字歌词，还有此刻想听的歌。把注意力还给音乐，把空间留给自己。',
  listenLink: '认识 Web 播放器', interfaceNote: '真实产品界面',
  libraryTitle: ['一份热爱。', '每一面，都照顾。'],
  libraryIntro: '从下一首想听的歌，到背后运行的服务。让一切各得其所。',
  views: [
    { title: '喜欢的，留在身边。', short: '歌单与收藏', text: '多源检索，把想听的歌收入收藏和歌单。切换页面时，播放控制始终触手可及。', link: '探索播放器', path: 'guide/web-player', image: 'player-library', alt: '真实 Web 播放器歌单，展示封面、歌曲信息与播放控制' },
    { title: '想听的，总有线索。', short: '多源搜索', text: '一位歌手，一个歌名，或突然想起的专辑。从多源搜索出发，找到此刻想听的那首歌。', link: '了解歌曲搜索', path: 'guide/web-player', image: 'search', alt: '真实搜索录屏，从热门搜索切换至歌曲结果' },
    { title: '偶遇下一首喜欢。', short: '排行榜', text: '换一个榜单，打开另一种听歌心情。在熟悉的收藏之外，发现值得单曲循环的新声音。', link: '探索音乐发现', path: 'guide/web-player', image: 'charts', alt: '真实排行榜录屏，在不同音乐榜单间切换' },
    { title: '也合你的眼缘。', short: '外观主题', text: '明亮或深邃，清新的绿，或另一种心情。随自己的喜好，选择播放器的外观。', link: '了解播放器设置', path: 'guide/web-player', image: 'themes', alt: '真实外观设置录屏，展示主题配色与深浅模式切换' },
    { title: '收藏的，心中有数。', short: '本地曲库', text: '音质、采样率、封面和歌词，一眼看清。检索本地音频，找出缺失信息，让自己的曲库井然有序。', link: '了解本地音乐', path: 'guide/web-player', image: 'local-library', alt: '本地曲库，展示音质、采样率以及封面和歌词状态' },
    { title: '运行的，尽在掌握。', short: '管理控制台', text: '管理账号，查看设备连接与服务运行状态。歌单快照、备份和恢复，也在同一处安排妥当。', link: '了解服务管理', path: 'guide/sync-server', image: 'admin-dashboard', alt: '管理控制台，展示 CPU、内存走势与在线设备数量' }
  ],
  connectTitle: ['各有所爱。', '依然，同频。'],
  connectBody: '桌前的浏览器，随身的 LX Music，还有习惯的 Subsonic 客户端。用你喜欢的方式，连接自己的音乐。',
  clientLabel: '选择连接方式',
  clients: [
    { name: 'Web 播放器', detail: '打开浏览器，音乐就在。', body: '多源搜索、歌单、本地曲库与沉浸歌词，集成在内置 Web 播放器中，无需另装客户端。', link: '播放器使用指南', path: 'guide/web-player', device: '浏览器' },
    { name: 'LX Music', detail: '歌单跟着你，不止一台设备。', body: '连接支持的 LX Music 桌面与移动客户端，在自己的服务端同步歌单。多账号独立管理，并保留历史快照。', link: '连接 LX Music', path: 'guide/sync-server', device: '桌面与移动端' },
    { name: 'Subsonic', detail: '把选择，留给喜欢的客户端。', body: '通过 Subsonic API 接入 Feishin、Symfonium 等兼容客户端。连接配置与支持范围，可在文档中查阅。', link: '查看 Subsonic 配置', path: 'guide/configuration', device: '兼容客户端' }
  ],
  hub: '你的音乐服务器', connection: '在这里，自由连接',
  closingTitle: ['给你的音乐，', '一个自己的家。'],
  closingBody: '服务器、NAS，或自己的电脑。选择适合的运行方式，把聆听的空间留在自己手中。',
  deploy: '查看部署指南',
  install: [
    { title: 'Docker', text: '适合 NAS 与长期运行的服务器。', label: '使用 Docker Compose', path: 'guide/getting-started#docker-compose' },
    { title: 'Node.js', text: '从源码运行，按自己的需要调整。', label: '从源码开始', path: 'guide/getting-started#从源码运行' },
    { title: '桌面客户端', text: '熟悉的桌面窗口，独立的音乐空间。', label: '查看发行版本', path: '' }
  ],
  footer: '自己部署。自由聆听。', configuration: '配置指南', api: 'API 参考', operations: '维护与备份',
  footerNote: 'Apache-2.0 · xcq0607 与贡献者',
})

const root = ref<HTMLElement>()
const hero = ref<HTMLElement>()
const collection = ref<HTMLElement>()
const activeView = ref(0)
const selectedClient = ref(0)
const manualPause = ref(false)
const systemReduced = ref(false)
const ready = ref(false)
const resting = computed(() => manualPause.value || systemReduced.value)
const client = computed(() => copy.value.clients[selectedClient.value])
const requestUpdate = useMusicFilm(root, ready, resting, systemReduced, activeView, () => copy.value.views.length)

async function toggleMotion() {
  manualPause.value = !manualPause.value
  await nextTick()
  // The control lives in the ending. Preserve that ending across layout modes.
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
  requestUpdate()
}



function chooseClient(index: number, focus = false) {
  selectedClient.value = (index + 3) % 3
  if (focus) nextTick(() => root.value?.querySelector<HTMLButtonElement>(`#music-tab-${selectedClient.value}`)?.focus())
}
</script>

<template>
  <div ref="root" class="music-landing" :class="{ 'is-animated': ready && !resting, 'is-resting': resting, 'is-english': english }">
    <a class="music-skip" href="#music-main">{{ copy.skip }}</a>
    <header class="music-nav">
      <a class="music-brand" :href="doc('')" aria-label="LX Sync Server"><svg width="25" height="28" viewBox="0 0 25 28" fill="none" aria-hidden="true"><path d="M3 25V10L14 4V20M14 15L22 11V24" stroke="currentColor" stroke-width="3.5"/><path d="M3 19L9 16" stroke="currentColor" stroke-width="3.5"/></svg><span>LX Sync Server</span></a>
      <nav :aria-label="english ? 'Main navigation' : '主导航'"><a class="music-doc-link" :href="doc('guide/getting-started')">{{ copy.docs }}</a><a class="music-language" :href="withBase(english ? '/' : '/en/')" :lang="english ? 'zh-CN' : 'en'" :aria-label="english ? '切换为中文' : 'Switch to English'">{{ english ? '中文' : 'EN' }}</a><a class="music-nav-action" :href="doc('guide/getting-started')">{{ copy.start }} <span aria-hidden="true">↗</span></a></nav>
    </header>
    <main id="music-main" class="music-film scene" data-scene="music-journey" :class="{ 'is-live': ready && !resting, 'is-rest': resting }"><div class="music-film-stage">
      <section ref="hero" class="music-hero" :class="{ 'is-live': ready && !resting, 'is-rest': resting }" aria-labelledby="music-title">
        <div class="music-hero-stage">
          <h1 id="music-title" class="music-hero-title"><span>LX</span> <span>SYNC</span></h1>
          <div class="music-hero-intro"><p class="music-hero-tagline">{{ copy.intro }}</p><div><p>{{ copy.introBody }}</p><a class="music-text-link" :href="doc('guide/getting-started')">{{ copy.start }} <span aria-hidden="true">↗</span></a></div></div>
          <figure class="music-hero-media" data-ui><img :src="asset('listening-poster')" :alt="english ? 'Actual immersive player with album artwork and synchronized lyrics' : '真实沉浸播放界面，展示专辑封面和同步歌词'" width="1596" height="820" fetchpriority="high" /><video data-film-clip="listening" :poster="asset('listening-poster')" preload="none" muted playsinline disablepictureinpicture aria-hidden="true"></video><figcaption>{{ copy.interfaceNote }}</figcaption></figure>
          <p class="music-hero-note">{{ copy.heroNote }}</p>
          <div class="music-listen-copy"><h2><span v-for="line in copy.listenTitle" :key="line">{{ line }}</span></h2><p>{{ copy.listenBody }}</p><a class="music-text-link" :href="doc('guide/web-player')">{{ copy.listenLink }} <span aria-hidden="true">↗</span></a></div>
        </div>
      </section>
      <section ref="collection" class="music-collection" :class="{ 'is-live': ready && !resting, 'is-rest': resting }" aria-labelledby="music-collection-title">
        <div class="music-collection-stage">
          <div class="music-collection-heading"><h2 id="music-collection-title"><span v-for="line in copy.libraryTitle" :key="line">{{ line }}</span></h2><p>{{ copy.libraryIntro }}</p></div>
          <div class="music-collection-content">
            <div class="music-view-panels">
              <article v-for="(view, i) in copy.views" :key="view.image" class="music-view-copy" :class="{ 'is-current': activeView === i }"><h3>{{ view.title }}</h3><p>{{ view.text }}</p><a class="music-text-link" :href="doc(view.path)">{{ view.link }} <span aria-hidden="true">↗</span></a><img class="music-rest-shot" :src="posterFor(view.image)" :alt="view.alt" width="1596" height="820" loading="lazy" /></article>
              <div class="music-view-track" aria-hidden="true"><span v-for="(view, i) in copy.views" :key="view.short" :class="{ 'is-current': activeView === i }">{{ view.short }}</span></div>
            </div>
            <figure class="music-product-window"><div class="music-window-bar" aria-hidden="true"><span class="music-window-dots"><i></i><i></i><i></i></span><span>lxserver / {{ copy.views[activeView].short }}</span><span>↗</span></div><div class="music-product-images"><div v-for="(view, i) in copy.views" :key="view.image" class="music-product-shot" data-ui :class="{ 'is-current': activeView === i }" :aria-hidden="activeView !== i"><img :src="posterFor(view.image)" :alt="view.alt" width="1600" height="798" loading="lazy" /><video v-if="clipFor(view.image)" :data-film-clip="clipFor(view.image)" :poster="posterFor(view.image)" preload="none" muted playsinline disablepictureinpicture aria-hidden="true"></video></div></div><figcaption>{{ copy.interfaceNote }}</figcaption></figure>
          </div>
        </div>
      </section>
      <section class="music-connect" aria-labelledby="music-connect-title">
        <div class="music-connect-heading" data-entrance><h2 id="music-connect-title"><span v-for="line in copy.connectTitle" :key="line">{{ line }}</span></h2><p>{{ copy.connectBody }}</p></div>
        <div class="music-connect-layout">
          <div class="music-client-picker" data-entrance>
            <div class="music-client-tabs" role="tablist" :aria-label="copy.clientLabel"><button v-for="(item, i) in copy.clients" :id="`music-tab-${i}`" :key="item.name" type="button" role="tab" :aria-selected="selectedClient === i" aria-controls="music-client-panel" :tabindex="selectedClient === i ? 0 : -1" @click="chooseClient(i)" @keydown.right.prevent="chooseClient(i + 1, true)" @keydown.left.prevent="chooseClient(i - 1, true)" @keydown.home.prevent="chooseClient(0, true)" @keydown.end.prevent="chooseClient(2, true)">{{ item.name }}</button></div>
            <div id="music-client-panel" class="music-client-panel" role="tabpanel" :aria-labelledby="`music-tab-${selectedClient}`" tabindex="0"><Transition name="music-client" mode="out-in"><div :key="selectedClient"><h3>{{ client.detail }}</h3><p>{{ client.body }}</p><a class="music-text-link" :href="doc(client.path)">{{ client.link }} <span aria-hidden="true">↗</span></a></div></Transition></div>
          </div>
          <div class="music-connection" data-entrance aria-hidden="true"><div class="music-server"><svg width="46" height="48" viewBox="0 0 25 28" fill="none"><path d="M3 25V10L14 4V20M14 15L22 11V24" stroke="currentColor" stroke-width="2.5"/></svg><strong>LX Sync</strong><span>{{ copy.hub }}</span></div><div class="music-signal"><span></span><span></span><span></span></div><div class="music-device" :key="selectedClient"><div class="music-device-symbol" :class="`device-${selectedClient}`"><span></span></div><strong>{{ client.name }}</strong><span>{{ client.device }}</span></div><p>{{ copy.connection }}</p></div>
        </div>
      </section>
      <section class="music-deploy" aria-labelledby="music-deploy-title">
        <div class="music-deploy-top"><h2 id="music-deploy-title" data-entrance><span v-for="line in copy.closingTitle" :key="line">{{ line }}</span></h2><div data-entrance><p>{{ copy.closingBody }}</p><a class="music-button" :href="doc('guide/getting-started')">{{ copy.deploy }} <span aria-hidden="true">↗</span></a></div></div>
        <div class="music-install-options"><article v-for="item in copy.install" :key="item.title" data-entrance><h3>{{ item.title }}</h3><p>{{ item.text }}</p><a class="music-text-link" :href="item.path ? doc(item.path) : 'https://github.com/XCQ0607/lxserver/releases'">{{ item.label }} <span aria-hidden="true">↗</span></a></article></div>
      </section>
    <footer class="music-footer"><div class="music-footer-top"><p>{{ copy.footer }}</p><nav :aria-label="english ? 'Documentation links' : '文档链接'"><a :href="doc('guide/configuration')">{{ copy.configuration }}</a><a :href="doc('api/reference')">{{ copy.api }}</a><a :href="doc('guide/operations')">{{ copy.operations }}</a><a href="https://github.com/XCQ0607/lxserver">GitHub ↗</a></nav></div><p class="music-footer-name" aria-hidden="true"><span>LX</span> <span>SYNC</span></p><div class="music-footer-bottom"><span>{{ copy.footerNote }}</span><button type="button" :aria-pressed="resting" :disabled="systemReduced" @click="toggleMotion"><span aria-hidden="true">{{ resting ? '▶' : 'Ⅱ' }}</span> {{ systemReduced ? copy.motionReduced : resting ? copy.motionOff : copy.motionOn }}</button></div></footer>
    </div></main>
  </div>
</template>
