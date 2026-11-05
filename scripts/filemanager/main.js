import { createApp, h, ref } from 'vue';
import VueFinderPlugin, { VueFinder, RemoteDriver, useVueFinder } from 'vuefinder';
import zhCN from 'vuefinder/dist/locales/zhCN.js';
import 'vuefinder/dist/style.css';
import './style.css';

const endpoint = '/api/files';
const auth = () => localStorage.getItem('lx_auth') || '';
const adminPath = () => (window.CONFIG?.['admin.path'] || '/admin').replace(/\/$/, '') + '/';
const headers = () => ({ 'x-frontend-auth': auth() });
async function session() {
  const response = await fetch(`${endpoint}/session`, { method: 'POST', headers: headers() });
  if (!response.ok) throw new Error('登录已失效，请返回管理后台重新登录');
  return response.json();
}

class FilesDriver extends RemoteDriver {
  getHeaders() { return { 'Content-Type': 'application/json', ...headers() }; }
  async getContent(params) {
    const check = await fetch(this.getPreviewUrl(params), { method: 'HEAD', headers: headers(), signal: params.signal });
    if (!check.ok) throw new Error('无法读取文件');
    if (Number(check.headers.get('content-length')) > 8 * 1024 * 1024) throw new Error('文本预览和编辑限 8 MiB 以内');
    return super.getContent(params);
  }
  configureUploader(uppy, context) {
    super.configureUploader(uppy, context);
    uppy.addPreProcessor(async (ids) => {
      const listing = await this.list({ path: context.getTargetPath() });
      const names = new Set(listing.files.map(file => file.basename.toLocaleLowerCase()));
      for (const id of ids) {
        const file = uppy.getFile(id);
        const conflict = names.has(file.name.toLocaleLowerCase());
        if (conflict && !window.confirm(`“${file.name}”已存在。确定替换该文件吗？`)) throw new Error('已取消覆盖上传');
        uppy.setFileMeta(id, { overwrite: conflict ? '1' : '0' });
      }
    });
  }
}

const driver = new FilesDriver({ baseURL: endpoint });
const fallback = document.getElementById('loading');
function showFailure(error) {
  fallback.hidden = false;
  fallback.replaceChildren();
  const message = document.createElement('p');
  message.textContent = error.message || '文件管理加载失败';
  const link = document.createElement('a');
  link.href = adminPath();
  link.textContent = '返回管理后台';
  fallback.append(message, link);
}

async function start() {
  const settings = await session();
  // 4.7.6 merges library defaults over config props on first mount. Seed only
  // missing persisted keys, preserving the user's subsequent view choices.
  const configKey = 'vuefinder_config_lx-files';
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(configKey) || '{}') || {}; } catch { /* reset malformed preferences */ }
  localStorage.setItem(configKey, JSON.stringify({
    view: 'list', theme: 'silver', persist: true, path: 'root://',
    showTreeView: window.innerWidth >= 768, showHiddenFiles: false, ...stored,
  }));
  const app = createApp({
    setup() {
      // The child registers its instance during mount, after this parent setup.
      let finder;
      const current = ref('');
      const error = ref('');
      const navigate = async (path) => {
        try { if (finder) await finder.open(path); error.value = ''; } catch (e) { error.value = e.message; }
      };
      const quickLink = (label, target) => h('button', {
        class: ['quick-link', current.value.startsWith(target) && 'active'],
        onClick: () => navigate(target),
      }, label);
      return () => h('div', { class: 'files-shell' }, [
        h('header', { class: 'files-header' }, [
          h('a', { class: 'back-link', href: adminPath(), title: '返回管理后台', 'aria-label': '返回管理后台' }, '←'),
          h('div', { class: 'files-heading' }, [h('h1', '文件管理'), h('span', '浏览、整理与预览服务器文件')]),
          h('nav', { class: 'quick-links', 'aria-label': '快捷目录' }, [quickLink('项目目录', 'root://'), quickLink('数据目录', 'data://')]),
        ]),
        error.value && h('div', { class: 'files-error', role: 'alert' }, [error.value, h('button', { onClick: () => { error.value = ''; } }, '关闭')]),
        h('main', { class: 'files-main' }, [h(VueFinder, {
          id: 'lx-files', driver, locale: 'zhCN', features: 'advanced',
          config: {
            initialPath: 'root://', view: 'list', theme: 'silver', persist: true,
            showTreeView: window.innerWidth >= 768, showHiddenFiles: false,
            showThumbnails: true, showMenuBar: true, loadingIndicator: 'linear',
            maxFileSize: settings.maxFileSize, listItemHeight: 38,
            notificationPosition: 'bottom-right',
          },
          onPathChange: (path) => { current.value = path; error.value = ''; },
          onError: (e) => { error.value = e.message || String(e); },
          onReady: () => { finder = useVueFinder('lx-files'); fallback.hidden = true; current.value = finder.getPath(); },
        })]),
      ]);
    },
  });
  app.use(VueFinderPlugin, { i18n: { zhCN: {
    ...zhCN, 'Search Files': '搜索文件', Filter: '筛选', 'Toggle Tree View': '切换目录树',
  } } });
  app.mount('#app');
  fallback.hidden = true;
  setInterval(() => { session().catch(showFailure); }, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) session().catch(showFailure); });
}
start().catch(showFailure);
