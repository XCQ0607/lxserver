<style>
.about-wrapper {
  color: var(--text-primary, #e2e8f0);
  font-family: inherit;
}
.about-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  margin-bottom: 2.25rem;
  position: relative;
}
.about-logo-glow {
  position: relative;
  width: 88px;
  height: 88px;
  border-radius: 26px;
  margin: 0 auto 1.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #3b82f6 0%, #6366f1 50%, #8b5cf6 100%);
  box-shadow: 0 16px 36px -6px rgba(99, 102, 241, 0.45);
  transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.about-logo-glow:hover {
  transform: translateY(-4px) scale(1.05) rotate(2deg);
  box-shadow: 0 22px 46px -6px rgba(99, 102, 241, 0.6);
}
.about-logo-glow::after {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 30px;
  background: linear-gradient(135deg, #3b82f6, #8b5cf6);
  filter: blur(14px);
  opacity: 0.6;
  z-index: -1;
  animation: adminPulseGlow 3s ease-in-out infinite alternate;
}
@keyframes adminPulseGlow {
  0% { opacity: 0.4; transform: scale(0.96); }
  100% { opacity: 0.75; transform: scale(1.04); }
}
.about-logo-svg {
  width: 44px;
  height: 44px;
  color: #ffffff;
  filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.3));
}
.about-title {
  font-size: 2.15rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--text-primary, #ffffff);
  margin: 0 0 0.4rem 0;
  line-height: 1.2;
}
.about-tagline {
  font-size: 0.95rem;
  font-weight: 700;
  color: #818cf8;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 0.75rem;
}
.about-desc {
  max-width: 660px;
  font-size: 0.925rem;
  line-height: 1.65;
  color: var(--text-secondary, #94a3b8);
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
  background: var(--bg-tertiary, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.12));
  color: var(--text-primary, #e2e8f0);
  text-decoration: none;
  transition: all 0.2s ease;
}
.about-badge.accent {
  background: rgba(16, 185, 129, 0.15);
  border-color: rgba(16, 185, 129, 0.35);
  color: #34d399;
}
.about-badge.primary {
  background: rgba(99, 102, 241, 0.15);
  border-color: rgba(99, 102, 241, 0.35);
  color: #a5b4fc;
}
.about-badge.purple {
  background: rgba(139, 92, 246, 0.15);
  border-color: rgba(139, 92, 246, 0.35);
  color: #c084fc;
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
  background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
  color: #ffffff !important;
  box-shadow: 0 4px 16px rgba(99, 102, 241, 0.35);
}
.about-btn-primary:hover {
  background: linear-gradient(135deg, #4338ca 0%, #4f46e5 100%);
  transform: translateY(-2px);
  box-shadow: 0 6px 22px rgba(99, 102, 241, 0.5);
}
.about-btn-secondary {
  background: var(--bg-tertiary, rgba(255, 255, 255, 0.05));
  color: var(--text-primary, #e2e8f0) !important;
  border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.12));
}
.about-btn-secondary:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: #818cf8;
  transform: translateY(-2px);
}
.about-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.875rem;
  margin-bottom: 2.25rem;
}
@media (min-width: 640px) {
  .about-stats {
    grid-template-columns: repeat(4, 1fr);
  }
}
.about-stat-card {
  padding: 1.125rem 0.875rem;
  border-radius: 20px;
  background: var(--bg-tertiary, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.08));
  text-align: center;
  transition: all 0.25s ease;
}
.about-stat-card:hover {
  border-color: rgba(99, 102, 241, 0.45);
  transform: translateY(-2px);
}
.about-stat-val {
  font-size: 1.4rem;
  font-weight: 800;
  color: #818cf8;
  margin-bottom: 0.2rem;
  letter-spacing: -0.02em;
}
.about-stat-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary, #94a3b8);
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
  color: var(--text-primary, #ffffff);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
}
.about-section-tag {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted, #64748b);
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
  background: var(--bg-tertiary, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.08));
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.about-card:hover {
  transform: translateY(-3px);
  border-color: rgba(99, 102, 241, 0.4);
  box-shadow: 0 12px 24px -6px rgba(0, 0, 0, 0.3);
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
  color: var(--text-primary, #ffffff);
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
  color: var(--text-secondary, #94a3b8);
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}
.about-card-list li i {
  color: #818cf8;
  font-size: 0.7rem;
  margin-top: 0.32rem;
  flex-shrink: 0;
}
.about-box {
  border-radius: 20px;
  background: var(--bg-tertiary, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.08));
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
  color: var(--text-secondary, #94a3b8);
}
.about-disclaimer-card h4 {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text-primary, #ffffff);
  margin: 0 0 0.35rem 0;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.about-credits-content {
  font-size: 0.85rem;
  line-height: 1.7;
  color: var(--text-secondary, #94a3b8);
}
.about-credits-content a {
  color: #818cf8;
  text-decoration: none;
  font-weight: 600;
}
.about-credits-content a:hover {
  text-decoration: underline;
}
.about-footer {
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-muted, #64748b);
  margin-top: 1.5rem;
}
</style>

<div class="about-wrapper">
  <!-- Hero Section -->
  <div class="about-hero">
    <div class="about-logo-glow">
      <svg class="about-logo-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <path d="M9 18V5l12-2v13M6 15v8m6-8v8" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </div>
    <div class="about-tagline">Your Private Music Hub</div>
    <h1 class="about-title">LX Music Sync Server</h1>
    <p class="about-desc">
      自己的音乐服务器，歌单多端同步，在线听歌，数据都在你手里。自带网页管理后台、自动备份、WebDAV 云备份和 Subsonic 支持，还有一个开箱即用的网页播放器。
    </p>

    <!-- Dynamic Status Badges -->
    <div class="about-badges">
      <span class="about-badge accent">
        <i class="fas fa-check-circle"></i>
        <span>Release: {{version}}</span>
      </span>
      <span class="about-badge primary">
        <i class="fas fa-code-commit"></i>
        <span>Build: {{buildHash}}</span>
      </span>
      <span class="about-badge purple">
        <i class="fab fa-node-js"></i>
        <span>Node &gt;= 20</span>
      </span>
      <span class="about-badge">
        <i class="fas fa-certificate"></i>
        <span>Apache 2.0</span>
      </span>
      <span class="about-badge">
        <i class="fab fa-docker"></i>
        <span>Docker Ready</span>
      </span>
      <span class="about-badge accent">
        <i class="fas fa-satellite-dish"></i>
        <span>Subsonic 1.16+</span>
      </span>
    </div>

    <!-- Quick Action Links -->
    <div class="about-actions">
      <a href="/music" target="_blank" class="about-btn about-btn-primary">
        <i class="fas fa-play"></i>
        <span>打开 Web 播放器</span>
      </a>
      <a href="https://xcq0607.github.io/lxserver/" target="_blank" class="about-btn about-btn-secondary">
        <i class="fas fa-book"></i>
        <span>帮助与使用文档</span>
      </a>
      <a href="https://github.com/XCQ0607/lxserver" target="_blank" class="about-btn about-btn-secondary">
        <i class="fab fa-github"></i>
        <span>GitHub 源码仓库</span>
      </a>
      <a href="https://github.com/XCQ0607/lxserver/issues" target="_blank" class="about-btn about-btn-secondary">
        <i class="fas fa-circle-exclamation"></i>
        <span>提交问题与建议</span>
      </a>
    </div>
  </div>

<!-- Architecture Metrics -->

<div class="about-stats">
    <div class="about-stat-card">
      <div class="about-stat-val">多租户</div>
      <div class="about-stat-label">账号独立，权限可控</div>
    </div>
    <div class="about-stat-card">
      <div class="about-stat-val">双协议</div>
      <div class="about-stat-label">同时支持 LX Music 与 Subsonic</div>
    </div>
    <div class="about-stat-card">
      <div class="about-stat-val">防丢失</div>
      <div class="about-stat-label">自动快照 + WebDAV 备份</div>
    </div>
    <div class="about-stat-card">
      <div class="about-stat-val">全平台</div>
      <div class="about-stat-label">Docker 与桌面系统均可部署</div>
    </div>
  </div>

<!-- Enterprise Features Matrix -->

<div class="about-section-header">
    <h2 class="about-section-title">
      <i class="fas fa-server text-indigo-400"></i>
      <span>主要功能</span>
    </h2>
    <span class="about-section-tag">Core Architecture</span>
  </div>

<div class="about-grid">
    <!-- Card 1 -->
    <div class="about-card">
      <div class="about-card-top">
        <div class="about-card-icon" style="background: rgba(99, 102, 241, 0.15); color: #818cf8;">
          <i class="fas fa-users-gear"></i>
        </div>
        <h3 class="about-card-title">多用户管理</h3>
      </div>
      <ul class="about-card-list">
        <li>
          <i class="fas fa-check"></i>
          <span><strong>数据互相独立</strong>：每个用户的数据单独存放，可在网页上创建、禁用用户和重置密码。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>两种连接方式</strong>：可用 <code>/用户名</code> 路径连接，也可直接用根地址连接。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>权限可调</strong>：可分别控制音源导入、缓存、本地曲库和公共曲库的使用权限。</span>
        </li>
      </ul>
    </div>

    <!-- Card 2 -->
    <div class="about-card">
      <div class="about-card-top">
        <div class="about-card-icon" style="background: rgba(16, 185, 129, 0.15); color: #34d399;">
          <i class="fas fa-database"></i>
        </div>
        <h3 class="about-card-title">歌单管理</h3>
      </div>
      <ul class="about-card-list">
        <li>
          <i class="fas fa-check"></i>
          <span><strong>随时查看</strong>：直接浏览各用户的歌单和歌曲详情。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>搜索与整理</strong>：支持搜索、筛选，可批量删除无效歌曲。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>公共收藏</strong>：一键开启公共收藏夹，家人朋友可以一起维护曲库。</span>
        </li>
      </ul>
    </div>

    <!-- Card 3 -->
    <div class="about-card">
      <div class="about-card-top">
        <div class="about-card-icon" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24;">
          <i class="fas fa-clock-rotate-left"></i>
        </div>
        <h3 class="about-card-title">快照与回滚</h3>
      </div>
      <ul class="about-card-list">
        <li>
          <i class="fas fa-check"></i>
          <span><strong>自动快照</strong>：数据一有变动就自动保存一个历史版本。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>一键导出</strong>：可下载 <code>lx_backup.json</code>，能直接导入官方客户端。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>一键回滚</strong>：误删了也不怕，几秒钟即可恢复到之前的任意版本。</span>
        </li>
      </ul>
    </div>

    <!-- Card 4 -->
    <div class="about-card">
      <div class="about-card-top">
        <div class="about-card-icon" style="background: rgba(14, 165, 233, 0.15); color: #38bdf8;">
          <i class="fas fa-cloud-arrow-up"></i>
        </div>
        <h3 class="about-card-title">WebDAV 云备份</h3>
      </div>
      <ul class="about-card-list">
        <li>
          <i class="fas fa-check"></i>
          <span><strong>兼容常见网盘</strong>：支持坚果云、Nextcloud、Alist、群晖 NAS 等 WebDAV 服务。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>只备份重要数据</strong>：自动跳过体积大的音乐缓存，备份快、占用小，并支持定时打包。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>换机也轻松</strong>：服务器出问题时，可直接从 WebDAV 一键恢复全部数据。</span>
        </li>
      </ul>
    </div>

    <!-- Card 5 -->
    <div class="about-card">
      <div class="about-card-top">
        <div class="about-card-icon" style="background: rgba(168, 85, 247, 0.15); color: #c084fc;">
          <i class="fas fa-satellite-dish"></i>
        </div>
        <h3 class="about-card-title">Subsonic 支持</h3>
      </div>
      <ul class="about-card-list">
        <li>
          <i class="fas fa-check"></i>
          <span><strong>兼容主流客户端</strong>：支持 Subsonic API 1.16+，可使用独立端口，也可与主服务共用端口。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>在线搜歌</strong>：在第三方客户端搜索时加上 <code>wy:</code>、<code>tx:</code> 等前缀，即可搜索对应平台。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>音质自动选择</strong>：优先选用 FLAC/320k，并自动缓存常听歌曲，再次播放更快。</span>
        </li>
      </ul>
    </div>

    <!-- Card 6 -->
    <div class="about-card">
      <div class="about-card-top">
        <div class="about-card-icon" style="background: rgba(236, 72, 153, 0.15); color: #f472b6;">
          <i class="fas fa-sliders"></i>
        </div>
        <h3 class="about-card-title">配置与日志</h3>
      </div>
      <ul class="about-card-list">
        <li>
          <i class="fas fa-check"></i>
          <span><strong>网页上直接改配置</strong>：端口、鉴权、代理等设置改完即生效，不用手动编辑配置文件。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>配置自动备份</strong>：每天备份一次配置，并自动清理过期的旧备份。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>在线日志与文件</strong>：内置文件管理器和实时日志，服务器状态一目了然。</span>
        </li>
      </ul>
    </div>

</div>

<!-- Open Source Credits -->

<div class="about-section-header">
    <h2 class="about-section-title">
      <i class="fas fa-handshake-angle text-indigo-400"></i>
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
        <strong><a href="https://github.com/lyswhut/lx-music-sync-server" target="_blank">lx-music-sync-server</a></strong>：本项目的数据同步基础。
      </li>
      <li>
        <strong><a href="https://github.com/lyswhut/lx-music-desktop" target="_blank">lx-music-desktop</a></strong>：网页播放器的交互设计参考。
      </li>
      <li>
        感谢 <strong><a href="https://github.com/lyswhut" target="_blank">lyswhut</a></strong> 与开源社区。
      </li>
    </ul>
  </div>

<!-- Compliance & Legal Notice -->

<div class="about-section-header">
    <h2 class="about-section-title">
      <i class="fas fa-scale-balanced text-indigo-400"></i>
      <span>许可与声明</span>
    </h2>
    <span class="about-section-tag">Terms & Disclaimer</span>
  </div>

<div class="about-box">
    <div class="about-disclaimer-grid">
      <div class="about-disclaimer-card">
        <h4><i class="fas fa-file-contract text-indigo-400"></i> 开源许可</h4>
        <p style="margin: 0;">本项目基于 Apache License 2.0 开源，代码完全公开，供开发者学习交流和自行部署使用。</p>
      </div>
      <div class="about-disclaimer-card">
        <h4><i class="fas fa-shield-halved text-emerald-400"></i> 数据存在本地</h4>
        <p style="margin: 0;">同步数据、账号信息和歌单都保存在你自己的服务器上，不上传统计信息。</p>
      </div>
      <div class="about-disclaimer-card">
        <h4><i class="fas fa-clock-rotate-left text-amber-400"></i> 版权提醒</h4>
        <p style="margin: 0;">本服务不提供也不分发任何版权音频。使用中产生的缓存请自行及时清理，不得用于商业用途。</p>
      </div>
      <div class="about-disclaimer-card">
        <h4><i class="fas fa-gavel text-rose-400"></i> 免责声明</h4>
        <p style="margin: 0;">请在符合当地法律法规的前提下使用本项目。因使用产生的一切后果由使用者自行承担。</p>
      </div>
    </div>
  </div>

<div class="about-footer">
    Copyright © 2026 <a href="https://github.com/XCQ0607/lxserver" target="_blank" style="color: inherit; font-weight: 600;">XCQ0607 / LX Music Server Project</a>. All rights reserved.
  </div>
</div>
