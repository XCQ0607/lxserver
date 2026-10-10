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
    <div class="about-tagline">Next-Gen Web Audio Streaming Platform</div>
    <h1 class="about-title">LX Music Web</h1>
    <p class="about-desc">
      专为现代浏览器量身定制的高性能流媒体音乐播放器。支持多源聚合检索、Subsonic 开放协议桥接、LRU 自动化缓存与 PWA 离线运行，提供原生 App 级的沉浸式聆听体验。
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
      <div class="about-stat-label">主流平台聚合检索</div>
    </div>
    <div class="about-stat-card">
      <div class="about-stat-val">Hi-Res</div>
      <div class="about-stat-label">FLAC / 高保真自适应串流</div>
    </div>
    <div class="about-stat-card">
      <div class="about-stat-val">Subsonic</div>
      <div class="about-stat-label">全平台三方客户端兼容</div>
    </div>
    <div class="about-stat-card">
      <div class="about-stat-val">100%</div>
      <div class="about-stat-label">私有化本地数据主权</div>
    </div>
  </div>

  <!-- Core Features Matrix -->
  <div class="about-section-header">
    <h2 class="about-section-title">
      <i class="fas fa-sparkles text-emerald-500"></i>
      <span>核心架构与特性矩阵</span>
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
        <h3 class="about-card-title">极致播放与声学引擎</h3>
      </div>
      <ul class="about-card-list">
        <li>
          <i class="fas fa-check"></i>
          <span><strong>智能码率优选</strong>：FLAC 无损 / 320k / 128k 自适应策略，支持毫秒级流式起播。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>声学频谱动效</strong>：Web Audio 实时音频分析频谱，与沉浸式全屏歌词封面律动协同。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>智能播放队列</strong>：支持拖拽排序、批量插播、快速定位与定时伴眠关机。</span>
        </li>
      </ul>
    </div>

    <!-- Card 2 -->
    <div class="about-card">
      <div class="about-card-top">
        <div class="about-card-icon" style="background: rgba(59, 130, 246, 0.12); color: #3b82f6;">
          <i class="fas fa-magnifying-glass"></i>
        </div>
        <h3 class="about-card-title">全网多源智能聚合检索</h3>
      </div>
      <ul class="about-card-list">
        <li>
          <i class="fas fa-check"></i>
          <span><strong>全维度检索</strong>：整合多平台曲库资源，支持单曲、精选歌单、专辑、歌手一网打尽。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>自定义音源扩展</strong>：支持导入第三方 JS 音源脚本，无缝热插拔拓展更多音乐源。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>公共曲库与共享收藏</strong>：支持全站公共收藏夹，方便家庭与团队协同共建高品质曲库。</span>
        </li>
      </ul>
    </div>

    <!-- Card 3 -->
    <div class="about-card">
      <div class="about-card-top">
        <div class="about-card-icon" style="background: rgba(245, 158, 11, 0.12); color: #f59e0b;">
          <i class="fas fa-palette"></i>
        </div>
        <h3 class="about-card-title">前沿美学与全天候自适应</h3>
      </div>
      <ul class="about-card-list">
        <li>
          <i class="fas fa-check"></i>
          <span><strong>Glassmorphism 视觉</strong>：融合现代拟态毛玻璃美学，提供「森之韵」「深海鲨」等定制主题。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>深色模式无缝融合</strong>：深度跟随系统明暗色彩，浅色清爽明亮，深色沉浸护眼。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>歌词卡片海报生成器</strong>：支持横版/竖版/方版多种视觉规格，一键生成精美歌词海报分享。</span>
        </li>
      </ul>
    </div>

    <!-- Card 4 -->
    <div class="about-card">
      <div class="about-card-top">
        <div class="about-card-icon" style="background: rgba(139, 92, 246, 0.12); color: #8b5cf6;">
          <i class="fas fa-bolt-lightning"></i>
        </div>
        <h3 class="about-card-title">智能 LRU 缓存与 PWA 体验</h3>
      </div>
      <ul class="about-card-list">
        <li>
          <i class="fas fa-check"></i>
          <span><strong>全自动多级缓存</strong>：歌词、封面及音频文件自动落盘，支持弱网与离线环境秒开。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>缓存控制仪表盘</strong>：支持细粒度可视化管理，可配置最大缓存配额与 LRU 自动清理。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>PWA 原生级应用</strong>：支持一键安装至桌面端与手机主屏幕，支持全手势侧边栏交互。</span>
        </li>
      </ul>
    </div>

    <!-- Card 5 -->
    <div class="about-card">
      <div class="about-card-top">
        <div class="about-card-icon" style="background: rgba(6, 182, 212, 0.12); color: #06b6d4;">
          <i class="fas fa-network-wired"></i>
        </div>
        <h3 class="about-card-title">Subsonic 开放生态协议桥接</h3>
      </div>
      <ul class="about-card-list">
        <li>
          <i class="fas fa-check"></i>
          <span><strong>协议全面兼容</strong>：支持使用音流（Streamer）、Feishin、Symfonium 等客户端直连。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>指令化在线搜索</strong>：支持在三方客户端使用 <code>wy:</code>、<code>tx:</code> 等平台前缀指令全网检索。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>在线排行榜映射</strong>：官方排行榜无缝映射为客户端只读歌单，随时随地掌握流行趋势。</span>
        </li>
      </ul>
    </div>

    <!-- Card 6 -->
    <div class="about-card">
      <div class="about-card-top">
        <div class="about-card-icon" style="background: rgba(239, 68, 68, 0.12); color: #ef4444;">
          <i class="fas fa-shield-halved"></i>
        </div>
        <h3 class="about-card-title">数据主权与细粒度权限安全</h3>
      </div>
      <ul class="about-card-list">
        <li>
          <i class="fas fa-check"></i>
          <span><strong>跨端双向云同步</strong>：与 LX Music 官方桌面端/移动端实现歌单与收藏双向数据互通。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>RBAC 权限矩阵</strong>：严格区分访客、普通账号与管理员，限制未授权公开源与缓存写入。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>访问密码守护</strong>：支持配置 Web 播放器独立访问密码，确保私人音乐数据不被窥探。</span>
        </li>
      </ul>
    </div>
  </div>

  <!-- Open Source Credits -->
  <div class="about-section-header">
    <h2 class="about-section-title">
      <i class="fas fa-handshake-angle text-emerald-500"></i>
      <span>开源生态与鸣谢</span>
    </h2>
    <span class="about-section-tag">Acknowledgements</span>
  </div>

  <div class="about-box about-credits-content">
    <p style="margin: 0 0 0.5rem 0;">
      本项目遵循开放与共享的开源精神构建，衷心感谢以下优秀开源项目与技术贡献者：
    </p>
    <ul style="margin: 0; padding-left: 1.25rem;">
      <li>
        <strong><a href="https://github.com/lyswhut/lx-music-desktop" target="_blank">lx-music-desktop</a></strong>：提供极佳的交互规范与产品设计参考。
      </li>
      <li>
        <strong><a href="https://github.com/lyswhut/lx-music-sync-server" target="_blank">lx-music-sync-server</a></strong>：本项目数据同步架构的核心上游基石。
      </li>
      <li>
        特别感谢 <strong><a href="https://github.com/lyswhut" target="_blank">lyswhut</a></strong> 为开源社区带来的卓越贡献。
      </li>
    </ul>
  </div>

  <!-- Compliance & Legal Notice -->
  <div class="about-section-header">
    <h2 class="about-section-title">
      <i class="fas fa-scale-balanced text-emerald-500"></i>
      <span>法律合规与服务协议</span>
    </h2>
    <span class="about-section-tag">Terms & Disclaimer</span>
  </div>

  <div class="about-box">
    <div class="about-disclaimer-grid">
      <div class="about-disclaimer-card">
        <h4><i class="fas fa-file-contract text-emerald-500"></i> 开源许可与补充协议</h4>
        <p style="margin: 0;">本项目基于 Apache License 2.0 许可证开源发行。代码仓库完全公开透明，旨在为全网开发者及音乐爱好者提供技术交流与前端架构学习案例。</p>
      </div>
      <div class="about-disclaimer-card">
        <h4><i class="fas fa-globe text-blue-500"></i> 数据来源中立性声明</h4>
        <p style="margin: 0;">各音源平台在线数据由公开服务器接口按需合并展示，音频流依赖自定义源脚本解析，本项目自身不存储亦不对第三方音源数据的有效性与合法性承担担保责任。</p>
      </div>
      <div class="about-disclaimer-card">
        <h4><i class="fas fa-clock-rotate-left text-amber-500"></i> 版权数据 24 小时自律</h4>
        <p style="margin: 0;">使用过程中如产生包含版权音频、封面或文本数据，使用者务必在 <strong>24 小时内</strong> 从本地缓存中清除，严禁将其用于商业盈利、公开转播或二次分发。</p>
      </div>
      <div class="about-disclaimer-card">
        <h4><i class="fas fa-shield text-rose-500"></i> 法律遵从与免责约定</h4>
        <p style="margin: 0;">严禁在违反当地法律法规的环境下使用本项目。因使用者个人使用行为或音源脚本解析所产生的一切纠纷与法律责任，均由使用者本人独立承担。</p>
      </div>
    </div>
  </div>

  <div class="about-footer">
    Copyright © 2026 <a href="https://github.com/XCQ0607/lxserver" target="_blank" style="color: inherit; font-weight: 600;">XCQ0607 / LX Music Server Project</a>. All rights reserved.
  </div>
</div>
