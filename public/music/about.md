<style>
.about-wrapper {
  color: var(--text-main, #1f2937);
  font-family: inherit;
}
.about-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  margin-bottom: 2rem;
  position: relative;
}
.about-logo-box {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 96px;
  height: 96px;
  border-radius: 28px;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.16) 0%, rgba(5, 150, 105, 0.04) 100%);
  border: 1px solid rgba(16, 185, 129, 0.3);
  box-shadow: 0 16px 36px -8px rgba(16, 185, 129, 0.25);
  margin-bottom: 1.25rem;
  transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.about-logo-box:hover {
  transform: translateY(-4px) scale(1.05);
  box-shadow: 0 20px 42px -6px rgba(16, 185, 129, 0.35);
}
.about-logo-img {
  width: 56px;
  height: 56px;
  filter: drop-shadow(0 6px 14px rgba(16, 185, 129, 0.3));
}
.about-title {
  font-size: 2.15rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--text-main, #1f2937);
  margin: 0 0 0.4rem 0;
  line-height: 1.2;
}
.about-tagline {
  font-size: 0.95rem;
  font-weight: 700;
  color: #10b981;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 0.75rem;
}
.about-desc {
  max-width: 620px;
  font-size: 0.925rem;
  line-height: 1.65;
  color: var(--text-muted, #4b5563);
  margin: 0 auto 1.35rem auto;
}
.about-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
}
.about-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.3rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: 9999px;
  background: var(--bg-item-hover, rgba(0, 0, 0, 0.05));
  border: 1px solid var(--border-main, rgba(0, 0, 0, 0.1));
  color: var(--text-main, #1f2937);
  text-decoration: none;
  transition: all 0.2s ease;
}
.about-badge.accent {
  background: rgba(16, 185, 129, 0.12);
  border-color: rgba(16, 185, 129, 0.3);
  color: #10b981;
}
.about-badge.primary {
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.3);
  color: #3b82f6;
}
.about-badge.purple {
  background: rgba(139, 92, 246, 0.12);
  border-color: rgba(139, 92, 246, 0.3);
  color: #8b5cf6;
}
.about-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.75rem;
}
.about-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1.25rem;
  font-size: 0.85rem;
  font-weight: 600;
  border-radius: 14px;
  text-decoration: none;
  transition: all 0.25s ease;
}
.about-btn-primary {
  background: #10b981;
  color: #ffffff !important;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.3);
}
.about-btn-primary:hover {
  background: #059669;
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(16, 185, 129, 0.4);
}
.about-btn-secondary {
  background: var(--bg-item-hover, rgba(0, 0, 0, 0.04));
  color: var(--text-main, #1f2937) !important;
  border: 1px solid var(--border-dim, rgba(0, 0, 0, 0.1));
}
.about-btn-secondary:hover {
  background: var(--bg-panel, #ffffff);
  border-color: #10b981;
  transform: translateY(-2px);
}
.about-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.875rem;
  margin-bottom: 2rem;
}
@media (min-width: 640px) {
  .about-stats {
    grid-template-columns: repeat(4, 1fr);
  }
}
.about-stat-card {
  padding: 1.125rem 0.875rem;
  border-radius: 20px;
  background: var(--bg-item-hover, rgba(0, 0, 0, 0.03));
  border: 1px solid var(--border-main, rgba(0, 0, 0, 0.08));
  text-align: center;
  transition: all 0.25s ease;
}
.about-stat-card:hover {
  border-color: rgba(16, 185, 129, 0.35);
  transform: translateY(-2px);
}
.about-stat-val {
  font-size: 1.4rem;
  font-weight: 800;
  color: #10b981;
  margin-bottom: 0.2rem;
  letter-spacing: -0.02em;
}
.about-stat-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted, #6b7280);
}
.about-section-header {
  margin: 2.25rem 0 1.15rem 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.about-section-title {
  font-size: 1.15rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--text-main, #1f2937);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
}
.about-section-tag {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-dim, #9ca3af);
}
.about-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
  margin-bottom: 2rem;
}
@media (min-width: 640px) {
  .about-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
.about-card {
  padding: 1.35rem;
  border-radius: 20px;
  background: var(--bg-item-hover, rgba(0, 0, 0, 0.025));
  border: 1px solid var(--border-main, rgba(0, 0, 0, 0.08));
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.about-card:hover {
  transform: translateY(-3px);
  border-color: rgba(16, 185, 129, 0.35);
  box-shadow: 0 12px 24px -6px rgba(0, 0, 0, 0.06);
}
.about-card-top {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.about-card-icon {
  width: 42px;
  height: 42px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  flex-shrink: 0;
}
.about-card-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-main, #1f2937);
  margin: 0;
}
.about-card-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.about-card-list li {
  font-size: 0.825rem;
  line-height: 1.55;
  color: var(--text-muted, #4b5563);
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}
.about-card-list li i {
  color: #10b981;
  font-size: 0.7rem;
  margin-top: 0.32rem;
  flex-shrink: 0;
}
.about-box {
  border-radius: 20px;
  background: var(--bg-item-hover, rgba(0, 0, 0, 0.025));
  border: 1px solid var(--border-main, rgba(0, 0, 0, 0.08));
  padding: 1.25rem 1.5rem;
  margin-bottom: 1.5rem;
}
.about-disclaimer-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}
@media (min-width: 640px) {
  .about-disclaimer-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
.about-disclaimer-card {
  font-size: 0.8rem;
  line-height: 1.6;
  color: var(--text-muted, #4b5563);
}
.about-disclaimer-card h4 {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text-main, #1f2937);
  margin: 0 0 0.35rem 0;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.about-credits-content {
  font-size: 0.85rem;
  line-height: 1.7;
  color: var(--text-muted, #4b5563);
}
.about-credits-content a {
  color: #10b981;
  text-decoration: none;
  font-weight: 600;
}
.about-credits-content a:hover {
  text-decoration: underline;
}
.about-footer {
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-dim, #9ca3af);
  margin-top: 1.5rem;
}
</style>

<div class="about-wrapper">
  <!-- Hero Section -->
  <div class="about-hero">
    <div class="about-logo-box">
      <img src="/music/assets/logo.svg" class="about-logo-img" alt="LX Music Logo">
    </div>
    <div class="about-tagline">Listen Anywhere, Right in Your Browser</div>
    <h1 class="about-title">LX Music Web</h1>
    <p class="about-desc">
      打开浏览器就能用的音乐播放器。多个平台一起搜歌，自动缓存听过的歌，可以安装成应用，用起来和手机 App 一样顺手。
    </p>

    <!-- Dynamic Status Pills -->
    <div class="about-badges">
      <span class="about-badge accent">
        <i class="fas fa-check-circle"></i>
        <span>Release: {{version}}</span>
      </span>
      <span class="about-badge primary">
        <i class="fas fa-code-commit"></i>
        <span>Build: {{buildHash}}</span>
      </span>
      <span class="about-badge">
        <i class="fas fa-certificate"></i>
        <span>Apache 2.0</span>
      </span>
      <span class="about-badge purple">
        <i class="fas fa-mobile-screen-button"></i>
        <span>PWA Ready</span>
      </span>
      <span class="about-badge">
        <i class="fas fa-satellite-dish"></i>
        <span>Subsonic 1.16+</span>
      </span>
    </div>

    <!-- Quick Action Links -->
    <div class="about-actions">
      <a href="https://xcq0607.github.io/lxserver/" target="_blank" class="about-btn about-btn-primary">
        <i class="fas fa-book"></i>
        <span>帮助与使用文档</span>
      </a>
      <a href="https://github.com/XCQ0607/lxserver" target="_blank" class="about-btn about-btn-secondary">
        <i class="fab fa-github"></i>
        <span>GitHub 源码仓库</span>
      </a>
      <a href="https://github.com/XCQ0607/lxserver/issues" target="_blank" class="about-btn about-btn-secondary">
        <i class="fas fa-circle-exclamation"></i>
        <span>提交反馈</span>
      </a>
    </div>
  </div>

  <!-- Architecture Metrics -->
  <div class="about-stats">
    <div class="about-stat-card">
      <div class="about-stat-val">5+</div>
      <div class="about-stat-label">个平台一起搜</div>
    </div>
    <div class="about-stat-card">
      <div class="about-stat-val">Hi-Res</div>
      <div class="about-stat-label">支持 FLAC 无损音质</div>
    </div>
    <div class="about-stat-card">
      <div class="about-stat-val">Subsonic</div>
      <div class="about-stat-label">可用第三方客户端播放</div>
    </div>
    <div class="about-stat-card">
      <div class="about-stat-val">100%</div>
      <div class="about-stat-label">数据存在你自己的服务器</div>
    </div>
  </div>

  <!-- Core Features Matrix -->
  <div class="about-section-header">
    <h2 class="about-section-title">
      <i class="fas fa-sparkles text-emerald-500"></i>
      <span>主要功能</span>
    </h2>
    <span class="about-section-tag">Core Capabilities</span>
  </div>

  <div class="about-grid">
    <!-- Card 1 -->
    <div class="about-card">
      <div class="about-card-top">
        <div class="about-card-icon" style="background: rgba(16, 185, 129, 0.12); color: #10b981;">
          <i class="fas fa-headphones-simple"></i>
        </div>
        <h3 class="about-card-title">好听的播放体验</h3>
      </div>
      <ul class="about-card-list">
        <li>
          <i class="fas fa-check"></i>
          <span><strong>音质自动选择</strong>：按 FLAC / 320k / 128k 顺序自动选最佳音质，点击即播。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>频谱动画</strong>：播放时显示实时频谱，搭配全屏歌词和封面。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>播放队列</strong>：支持拖拽排序、批量添加、快速定位，还有睡眠定时。</span>
        </li>
      </ul>
    </div>

    <!-- Card 2 -->
    <div class="about-card">
      <div class="about-card-top">
        <div class="about-card-icon" style="background: rgba(59, 130, 246, 0.12); color: #3b82f6;">
          <i class="fas fa-magnifying-glass"></i>
        </div>
        <h3 class="about-card-title">多平台搜索</h3>
      </div>
      <ul class="about-card-list">
        <li>
          <i class="fas fa-check"></i>
          <span><strong>一次搜全部</strong>：同时搜索多个平台，可查歌曲、歌单、专辑和歌手。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>自定义音源</strong>：可导入第三方 JS 音源脚本，随时增减音乐来源。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>公共收藏</strong>：可开启公共收藏夹，家人朋友一起攒歌单。</span>
        </li>
      </ul>
    </div>

    <!-- Card 3 -->
    <div class="about-card">
      <div class="about-card-top">
        <div class="about-card-icon" style="background: rgba(245, 158, 11, 0.12); color: #f59e0b;">
          <i class="fas fa-palette"></i>
        </div>
        <h3 class="about-card-title">界面与主题</h3>
      </div>
      <ul class="about-card-list">
        <li>
          <i class="fas fa-check"></i>
          <span><strong>毛玻璃界面</strong>：提供「森之韵」「深海鲨」等多款主题。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>深色模式</strong>：自动跟随系统，白天明亮，夜间护眼。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>歌词海报</strong>：横版、竖版、方形任选，一键生成歌词图片分享给朋友。</span>
        </li>
      </ul>
    </div>

    <!-- Card 4 -->
    <div class="about-card">
      <div class="about-card-top">
        <div class="about-card-icon" style="background: rgba(139, 92, 246, 0.12); color: #8b5cf6;">
          <i class="fas fa-bolt-lightning"></i>
        </div>
        <h3 class="about-card-title">缓存与安装</h3>
      </div>
      <ul class="about-card-list">
        <li>
          <i class="fas fa-check"></i>
          <span><strong>自动缓存</strong>：歌词、封面和音频自动保存，网络不好时也能快速打开。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>缓存管理</strong>：可查看缓存占用，设置容量上限，超出后自动清理最久没听的歌。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>可安装成应用</strong>：一键添加到电脑桌面或手机主屏幕，支持手势操作侧边栏。</span>
        </li>
      </ul>
    </div>

    <!-- Card 5 -->
    <div class="about-card">
      <div class="about-card-top">
        <div class="about-card-icon" style="background: rgba(6, 182, 212, 0.12); color: #06b6d4;">
          <i class="fas fa-network-wired"></i>
        </div>
        <h3 class="about-card-title">Subsonic 支持</h3>
      </div>
      <ul class="about-card-list">
        <li>
          <i class="fas fa-check"></i>
          <span><strong>兼容常用客户端</strong>：可直接连接音流（Streamer）、Feishin、Symfonium 等。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>在线搜歌</strong>：在第三方客户端搜索时加上 <code>wy:</code>、<code>tx:</code> 等前缀，即可搜索对应平台。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>排行榜</strong>：各平台排行榜会显示为只读歌单，随时看热门歌曲。</span>
        </li>
      </ul>
    </div>

    <!-- Card 6 -->
    <div class="about-card">
      <div class="about-card-top">
        <div class="about-card-icon" style="background: rgba(239, 68, 68, 0.12); color: #ef4444;">
          <i class="fas fa-shield-halved"></i>
        </div>
        <h3 class="about-card-title">同步与安全</h3>
      </div>
      <ul class="about-card-list">
        <li>
          <i class="fas fa-check"></i>
          <span><strong>多端同步</strong>：歌单和收藏可与 LX Music 官方桌面端、手机端双向同步。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>分级权限</strong>：访客、普通用户和管理员权限分开，未授权的人不能导入音源或写入缓存。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>访问密码</strong>：可给网页播放器单独设置密码，保护你的私人歌单。</span>
        </li>
      </ul>
    </div>
  </div>

  <!-- Open Source Credits -->
  <div class="about-section-header">
    <h2 class="about-section-title">
      <i class="fas fa-handshake-angle text-emerald-500"></i>
      <span>致谢</span>
    </h2>
    <span class="about-section-tag">Acknowledgements</span>
  </div>

  <div class="about-box about-credits-content">
    <p style="margin: 0 0 0.5rem 0;">
      本项目基于以下开源项目开发，感谢它们的作者：
    </p>
    <ul style="margin: 0; padding-left: 1.25rem;">
      <li>
        <strong><a href="https://github.com/lyswhut/lx-music-desktop" target="_blank">lx-music-desktop</a></strong>：交互与产品设计参考。
      </li>
      <li>
        <strong><a href="https://github.com/lyswhut/lx-music-sync-server" target="_blank">lx-music-sync-server</a></strong>：本项目的数据同步基础。
      </li>
      <li>
        感谢 <strong><a href="https://github.com/lyswhut" target="_blank">lyswhut</a></strong> 与开源社区。
      </li>
    </ul>
  </div>

  <!-- Compliance & Legal Notice -->
  <div class="about-section-header">
    <h2 class="about-section-title">
      <i class="fas fa-scale-balanced text-emerald-500"></i>
      <span>许可与声明</span>
    </h2>
    <span class="about-section-tag">Terms & Disclaimer</span>
  </div>

  <div class="about-box">
    <div class="about-disclaimer-grid">
      <div class="about-disclaimer-card">
        <h4><i class="fas fa-file-contract text-emerald-500"></i> 开源许可</h4>
        <p style="margin: 0;">本项目基于 Apache License 2.0 开源，代码完全公开，供开发者和音乐爱好者学习交流。</p>
      </div>
      <div class="about-disclaimer-card">
        <h4><i class="fas fa-globe text-blue-500"></i> 数据来源</h4>
        <p style="margin: 0;">在线歌曲信息来自各平台的公开接口，音频由自定义音源脚本解析。本项目不存储这些内容，也不保证第三方数据的可用性与合法性。</p>
      </div>
      <div class="about-disclaimer-card">
        <h4><i class="fas fa-clock-rotate-left text-amber-500"></i> 版权提醒</h4>
        <p style="margin: 0;">使用中缓存的版权音频、封面或文本，请在 <strong>24 小时内</strong> 清除，不得用于商业盈利、公开传播或二次分发。</p>
      </div>
      <div class="about-disclaimer-card">
        <h4><i class="fas fa-shield text-rose-500"></i> 免责声明</h4>
        <p style="margin: 0;">请在符合当地法律法规的前提下使用本项目。因个人使用或音源脚本产生的一切纠纷和责任，由使用者自行承担。</p>
      </div>
    </div>
  </div>

  <div class="about-footer">
    Copyright © 2026 <a href="https://github.com/XCQ0607/lxserver" target="_blank" style="color: inherit; font-weight: 600;">XCQ0607 / LX Music Server Project</a>. All rights reserved.
  </div>
</div>
