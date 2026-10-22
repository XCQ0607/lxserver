/**
 * Subsonic 配置独立页 - 回归测试用例与场景
 *
 * 运行: node --test test/subsonic-config.test.cjs  (或 npm test)
 *
 * 背景: 原 Subsonic 配置卡片内嵌在「系统配置」页面(config-form)中，本次重构将其
 * 拆分为独立视图 view-subsonic / subsonic-form，新增 loadSubsonicConfig() /
 * saveSubsonicConfig()。以下用例用于防止「字段静默不加载/不保存」「主配置误写
 * subsonic 默认值」等回归。
 *
 * 手动端到端场景(供 PR 评审参考):
 *   1. 打开「系统配置」, 确认不再出现 Subsonic 卡片; 左侧导航出现「Subsonic 配置」入口。
 *   2. 进入 Subsonic 配置页, 修改任意字段(如主机/账号/密码)并保存, 刷新后值仍在。
 *   3. 切换 subsonic.enable, 独立端口字段显隐与「需重启」提示随状态变化。
 *   4. 切换 subsonic.port 后保存, 出现「修改需重启生效」提示。
 *   5. 修改「系统配置」其它项保存, 确认不会把 subsonic.* 默认值写回后端。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');

// ---- 提取辅助 ----
function sliceFromMarker(marker, endMarker) {
  const s = html.indexOf(marker);
  if (s < 0) return '';
  const e = endMarker ? html.indexOf(endMarker, s + marker.length) : -1;
  return html.slice(s, e < 0 ? html.length : e);
}
const viewSubsonic = sliceFromMarker('id="view-subsonic"', 'id="view-');
const subsonicForm = sliceFromMarker('id="subsonic-form"', '</form>');
const configForm = sliceFromMarker('id="config-form"', '</form>');

function fnBody(name) {
  const i = appJs.indexOf(`async ${name}(`);
  assert.ok(i >= 0, `未找到函数 ${name}`);
  const open = appJs.indexOf('{', i);
  let depth = 0, j = open;
  for (; j < appJs.length; j++) {
    if (appJs[j] === '{') depth++;
    else if (appJs[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return appJs.slice(open, j);
}

function collect(re, text, group = 1) {
  const set = new Set();
  let m;
  while ((m = re.exec(text))) set.add(m[group]);
  return set;
}

const load = fnBody('loadSubsonicConfig');
const save = fnBody('saveSubsonicConfig');

// load 读取的字段: form.elements['X'] 与 config['X']
const loadNames = new Set([
  ...collect(/form\.elements\['([^']+)'\]/g, load),
  ...collect(/config\['([^']+)'\]/g, load),
]);
const SUBSONIC_PREFIX = (k) => k.startsWith('subsonic.') || k === 'singer.sourcePriority';
const loadKeys = [...loadNames].filter(SUBSONIC_PREFIX).sort();

// 这些键不呈现为 form.elements 项，而是由独立 DOM 控件(经 getElementById 取值的开关)提供，
// 因此不存在 name="..." 属性；其 DOM 存在性由场景3(ID 校验)保证。
const NON_FORM_KEYS = new Set(['subsonic.standalone']);

// save 写入的字段: 'subsonic.xxx': 或 'singer.sourcePriority':
const saveKeys = [...collect(/'(subsonic\.[^']+|singer\.sourcePriority)'\s*:/g, save)].sort();

// 表单内 name 属性 / 视图内 id
const formNames = collect(/\bname="([^"]+)"/g, subsonicForm);
const viewIds = collect(/id="([^"]+)"/g, viewSubsonic);
const usedIds = new Set([
  ...collect(/getElementById\(['"]([^'"]+)['"]\)/g, load),
  ...collect(/getElementById\(['"]([^'"]+)['"]\)/g, save),
]);

// ---- 用例 ----
test('场景1: 导航入口与视图/表单结构存在', () => {
  assert.ok(html.includes('data-view="subsonic"'), '左侧导航缺少 Subsonic 配置入口');
  assert.ok(viewSubsonic.length > 0, '缺少 view-subsonic 视图');
  assert.ok(subsonicForm.length > 0, '缺少 subsonic-form 表单');
  assert.ok(appJs.includes("case 'subsonic':"), "switchView 缺少 case 'subsonic'");
  assert.ok(appJs.includes('this.loadSubsonicConfig()'), '进入 subsonic 视图未调用 loadSubsonicConfig');
});

test('场景2: load 引用的所有字段在 subsonic-form 中真实存在', () => {
  assert.ok(loadKeys.length > 0, '未提取到任何 subsonic 加载字段');
  const missing = loadKeys.filter((k) => !formNames.has(k) && !NON_FORM_KEYS.has(k));
  assert.deepEqual(missing, [], `subsonic-form 缺少 load 引用的字段: ${missing.join(', ')}`);
});

test('场景3: load/save 引用的所有元素 ID 在 view-subsonic 中真实存在', () => {
  const missing = [...usedIds].filter((id) => !viewIds.has(id));
  assert.deepEqual(missing, [], `view-subsonic 缺少 getElementById 引用的 ID: ${missing.join(', ')}`);
});

test('场景4: 系统配置页(config-form)无 subsonic 残留字段(回归)', () => {
  const leftover = collect(/\bname="(subsonic\.[^"]+|singer\.sourcePriority)"/g, configForm);
  assert.deepEqual([...leftover], [], `config-form 仍残留 subsonic 字段: ${[...leftover].join(', ')}`);
  // reload-config-btn 全页唯一, 避免 id 重复导致脚本误绑
  const reloadCount = (html.match(/id="reload-config-btn"/g) || []).length;
  assert.equal(reloadCount, 1, `reload-config-btn 应全局唯一, 实际 ${reloadCount}`);
});

test('场景5: load 与 save 字段集合完全一致(往返无丢失/孤儿)', () => {
  assert.deepEqual(loadKeys, saveKeys,
    `load(${loadKeys.length}) 与 save(${saveKeys.length}) 字段不一致`);
});

test('场景6: 重启提示键均属已保存字段', () => {
  const rr = save.match(/const restartRequiredKeys = \[([^\]]+)\]/);
  assert.ok(rr, 'saveSubsonicConfig 未定义 restartRequiredKeys');
  const keys = rr[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
  const invalid = keys.filter((k) => !saveKeys.includes(k));
  assert.deepEqual(invalid, [], `restartRequiredKeys 含未保存字段: ${invalid.join(', ')}`);
});

test('场景7: 保存提交的是 subsonic-form(不会误提交主配置)', () => {
  assert.ok(save.includes("'subsonic-form'") || save.includes('subsonic-form'),
    'saveSubsonicConfig 未引用 subsonic-form');
});
