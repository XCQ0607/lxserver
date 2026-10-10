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
    <div class="about-tagline">High-Performance Sync & Streaming Gateway</div>
    <h1 class="about-title">LX Music Sync Server</h1>
    <p class="about-desc">
      企业级私有化音乐数据同步中枢与流媒体服务网关。深度整合 Web 可视化运维控制台、全自动时间胶囊快照回滚、WebDAV 云端灾备、Subsonic 开放流媒体协议以及内置现代 Web 播放器。
    </p>

    `<!-- Dynamic Status Badges -->`
    `<div class="about-badges">`
      `<span class="about-badge accent">`
        `<i class="fas fa-check-circle"></i>`
        `<span>`Release: {{version}}
    
      `<span class="about-badge primary">`
        `<i class="fas fa-code-commit"></i>`
        `<span>`Build: {{buildHash}}
    
      `<span class="about-badge purple">`
        `<i class="fab fa-node-js"></i>`
        `<span>`Node >= 20
    
      `<span class="about-badge">`
        `<i class="fas fa-certificate"></i>`
        `<span>`Apache 2.0
    
      `<span class="about-badge">`
        `<i class="fab fa-docker"></i>`
        `<span>`Docker Ready
    
      `<span class="about-badge accent">`
        `<i class="fas fa-satellite-dish"></i>`
        `<span>`Subsonic 1.16+
    
    `</div>`

    `<!-- Quick Action Links -->`
    `<div class="about-actions">`
      `<a href="/music" target="_blank" class="about-btn about-btn-primary">`
        `<i class="fas fa-play"></i>`
        `<span>`打开 Web 播放器
      `</a>`
      `<a href="https://xcq0607.github.io/lxserver/" target="_blank" class="about-btn about-btn-secondary">`
        `<i class="fas fa-book"></i>`
        `<span>`帮助与使用文档
      `</a>`
      `<a href="https://github.com/XCQ0607/lxserver" target="_blank" class="about-btn about-btn-secondary">`
        `<i class="fab fa-github"></i>`
        `<span>`GitHub 源码仓库
      `</a>`
      `<a href="https://github.com/XCQ0607/lxserver/issues" target="_blank" class="about-btn about-btn-secondary">`
        `<i class="fas fa-circle-exclamation"></i>`
        `<span>`提交问题与建议
      `</a>`
    `</div>`

</div>

<!-- Architecture Metrics -->

<div class="about-stats">
    <div class="about-stat-card">
      <div class="about-stat-val">多租户</div>
      <div class="about-stat-label">独立数据隔离与权限矩阵</div>
    </div>
    <div class="about-stat-card">
      <div class="about-stat-val">双协议</div>
      <div class="about-stat-label">LX Music + Subsonic 双引擎</div>
    </div>
    <div class="about-stat-card">
      <div class="about-stat-val">全灾备</div>
      <div class="about-stat-label">自动快照回滚 + WebDAV 备份</div>
    </div>
    <div class="about-stat-card">
      <div class="about-stat-val">全平台</div>
      <div class="about-stat-label">Docker / 跨平台桌面端即启</div>
    </div>
  </div>

<!-- Enterprise Features Matrix -->

<div class="about-section-header">
    <h2 class="about-section-title">
      <i class="fas fa-server text-indigo-400"></i>
      <span>服务端架构与核心中枢能力</span>
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
        <h3 class="about-card-title">多租户账号管理与细粒度权限矩阵</h3>
      </div>
      <ul class="about-card-list">
        <li>
          <i class="fas fa-check"></i>
          <span><strong>租户空间隔离</strong>：多用户数据物理级隔离，支持在 Web 界面快速创建、禁用用户与重置密码。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>双连接模式</strong>：支持用户路径路由模式（<code>/username</code>）与根路径智能鉴权路由双模式接入。</span>
        </li>
        <li>
          <i class="fas fa-check"></i>
          <span><strong>RBAC 权限约束</strong>：细粒度控制公开源导入、缓存落盘、本地曲库读写与公共曲库权限。</span>
        </li>
      </ul>
    </div>

    `<!-- Card 2 -->`
    `<div class="about-card">`
      `<div class="about-card-top">`
        `<div class="about-card-icon" style="background: rgba(16, 185, 129, 0.15); color: #34d399;">`
          `<i class="fas fa-database"></i>`
        `</div>`
        `<h3 class="about-card-title">`歌单全景运维与颗粒度数据治理`</h3>`
      `</div>`
      `<ul class="about-card-list">`
        `<li>`
          `<i class="fas fa-check"></i>`
          `<span><strong>`全景透视浏览`</strong>`：实时检索并查看各用户的歌单分类、单曲明细与关联元数据结构。
        `</li>`
        `<li>`
          `<i class="fas fa-check"></i>`
          `<span><strong>`歌单深度治理`</strong>`：支持歌单全文检索、条件筛选、批量删除异常曲目与歌单结构优化。
        `</li>`
        `<li>`
          `<i class="fas fa-check"></i>`
          `<span><strong>`公共收藏协作`</strong>`：一键开启全站公共收藏夹与共享歌曲，方便家庭与团队协同共建曲库。
        `</li>`
      `</ul>`
    `</div>`

    `<!-- Card 3 -->`
    `<div class="about-card">`
      `<div class="about-card-top">`
        `<div class="about-card-icon" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24;">`
          `<i class="fas fa-clock-rotate-left"></i>`
        `</div>`
        `<h3 class="about-card-title">`时间胶囊快照与全时态灾备回滚`</h3>`
      `</div>`
      `<ul class="about-card-list">`
        `<li>`
          `<i class="fas fa-check"></i>`
          `<span><strong>`事件驱动快照`</strong>`：数据变更自动触发生成版本快照，建立可靠的多版本历史时间胶囊。
        `</li>`
        `<li>`
          `<i class="fas fa-check"></i>`
          `<span><strong>`标准数据导出`</strong>`：一键下载 `<code>`lx_backup.json`</code>` 标准归档，与全平台官方客户端无缝互导。
        `</li>`
        `<li>`
          `<i class="fas fa-check"></i>`
          `<span><strong>`一键平滑回滚`</strong>`：支持秒级将指定租户数据恢复至历史任意时刻，从容抵御操作失误。
        `</li>`
      `</ul>`
    `</div>`

    `<!-- Card 4 -->`
    `<div class="about-card">`
      `<div class="about-card-top">`
        `<div class="about-card-icon" style="background: rgba(14, 165, 233, 0.15); color: #38bdf8;">`
          `<i class="fas fa-cloud-arrow-up"></i>`
        `</div>`
        `<h3 class="about-card-title">`WebDAV 自动化云端双向同步`</h3>`
      `</div>`
      `<ul class="about-card-list">`
        `<li>`
          `<i class="fas fa-check"></i>`
          `<span><strong>`生态广泛兼容`</strong>`：无缝对接坚果云、Nextcloud、Alist、Synology NAS 等标准 WebDAV 网盘。
        `</li>`
        `<li>`
          `<i class="fas fa-check"></i>`
          `<span><strong>`智能增量灾备`</strong>`：自动排除大容量媒体缓存，极速同步核心歌单数据与全量定时轮转打包。
        `</li>`
        `<li>`
          `<i class="fas fa-check"></i>`
          `<span><strong>`异地灾难恢复`</strong>`：宿主机硬件故障时，支持直接从 WebDAV 云端一键拉取并重建完整服务。
        `</li>`
      `</ul>`
    `</div>`

    `<!-- Card 5 -->`
    `<div class="about-card">`
      `<div class="about-card-top">`
        `<div class="about-card-icon" style="background: rgba(168, 85, 247, 0.15); color: #c084fc;">`
          `<i class="fas fa-satellite-dish"></i>`
        `</div>`
        `<h3 class="about-card-title">`Subsonic 开放流媒体服务网关`</h3>`
      `</div>`
      `<ul class="about-card-list">`
        `<li>`
          `<i class="fas fa-check"></i>`
          `<span><strong>`标准协议兼容`</strong>`：实现 Subsonic API 1.16+ 规范，支持独立监听端口或单端口复用模式。
        `</li>`
        `<li>`
          `<i class="fas fa-check"></i>`
          `<span><strong>`全网在线检索代理`</strong>`：支持第三方客户端直连并在关键词前使用 `<code>`wy:`</code>`、`<code>`tx:`</code>` 等前缀在线全网检索。
        `</li>`
        `<li>`
          `<i class="fas fa-check"></i>`
          `<span><strong>`服务端音质优选`</strong>`：服务端支持 FLAC/320k 音质自适应调度与 LRU 自动缓存落盘加速。
        `</li>`
      `</ul>`
    `</div>`

    `<!-- Card 6 -->`
    `<div class="about-card">`
      `<div class="about-card-top">`
        `<div class="about-card-icon" style="background: rgba(236, 72, 153, 0.15); color: #f472b6;">`
          `<i class="fas fa-sliders"></i>`
        `</div>`
        `<h3 class="about-card-title">`动态热更新配置与全局可观测性`</h3>`
      `</div>`
      `<ul class="about-card-list">`
        `<li>`
          `<i class="fas fa-check"></i>`
          `<span><strong>`全量 Web 热配置`</strong>`：系统端口、鉴权策略、代理分流等全维度配置即改即生效，无需手动改写配置文件。
        `</li>`
        `<li>`
          `<i class="fas fa-check"></i>`
          `<span><strong>`配置自动轮转备份`</strong>`：每日自动生成配置文件历史副本并自动清理过期备份，保障配置变更安全。
        `</li>`
        `<li>`
          `<i class="fas fa-check"></i>`
          `<span><strong>`一体化日志浏览器`</strong>`：内置在线文件管理器与实时日志追踪器，随时掌控服务器运行态势。
        `</li>`
      `</ul>`
    `</div>`

</div>

<!-- Open Source Credits -->

<div class="about-section-header">
    <h2 class="about-section-title">
      <i class="fas fa-handshake-angle text-indigo-400"></i>
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
        <strong><a href="https://github.com/lyswhut/lx-music-sync-server" target="_blank">lx-music-sync-server</a></strong>：本项目数据同步架构的核心上游基础。
      </li>
      <li>
        <strong><a href="https://github.com/lyswhut/lx-music-desktop" target="_blank">lx-music-desktop</a></strong>：Web 播放器交互设计与前端协议的标杆范式。
      </li>
      <li>
        感谢 <strong><a href="https://github.com/lyswhut" target="_blank">lyswhut</a></strong> 及整个开源社区为优秀的音乐软件生态所作出的卓越贡献。
      </li>
    </ul>
  </div>

<!-- Compliance & Legal Notice -->

<div class="about-section-header">
    <h2 class="about-section-title">
      <i class="fas fa-scale-balanced text-indigo-400"></i>
      <span>法律合规与服务协议</span>
    </h2>
    <span class="about-section-tag">Terms & Disclaimer</span>
  </div>

<div class="about-box">
    <div class="about-disclaimer-grid">
      <div class="about-disclaimer-card">
        <h4><i class="fas fa-file-contract text-indigo-400"></i> 开源许可与补充协议</h4>
        <p style="margin: 0;">本项目基于 Apache License 2.0 许可证开源发行。代码仓库完全公开透明，旨在为全网开发者及私有化部署爱好者提供技术研究与网络服务架构交流。</p>
      </div>
      <div class="about-disclaimer-card">
        <h4><i class="fas fa-shield-halved text-emerald-400"></i> 本地私有化数据掌控</h4>
        <p style="margin: 0;">所有同步数据、用户凭据与歌单数据全部存储于宿主机本地，系统支持关闭任何遥测统计，数据资产享有 100% 自主掌控权。</p>
      </div>
      <div class="about-disclaimer-card">
        <h4><i class="fas fa-clock-rotate-left text-amber-400"></i> 版权数据自律管理</h4>
        <p style="margin: 0;">本服务端不存储亦不分发任何商业版权音频文件。因客户端同步产生的数据缓存，使用者应自觉遵守版权法规并按需清理，严禁用于任何商业牟利行为。</p>
      </div>
      <div class="about-disclaimer-card">
        <h4><i class="fas fa-gavel text-rose-400"></i> 法律遵从与免责约定</h4>
        <p style="margin: 0;">严禁在违反当地法律法规的环境下部署与使用本项目。使用者因部署或使用本项目所产生的任何法律纠纷及附带责任，均由使用者本人独立承担。</p>
      </div>
    </div>
  </div>

<div class="about-footer">
    Copyright © 2026 <a href="https://github.com/XCQ0607/lxserver" target="_blank" style="color: inherit; font-weight: 600;">XCQ0607 / LX Music Server Project</a>. All rights reserved.
  </div>
</div>
