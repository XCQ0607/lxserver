(function () {
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB'; if (n >= 1048576) return (n / 1048576).toFixed(0) + ' MB'; return (n / 1024).toFixed(0) + ' KB'; };
  function meter(label, used, total, hint) {
    var p = total ? Math.min(100, used / total * 100) : 0, cls = p > 90 ? 'bad' : p > 75 ? 'warn' : '';
    return '<div class="dash-meter"><div class="dash-meter-row"><span>' + label + '</span><span>' + hint + '</span></div><div class="dash-meter-track"><i class="' + cls + '" style="width:' + p.toFixed(1) + '%"></i></div></div>';
  }
  function badge(on, onText, offText) { return '<span class="dash-pill ' + (on ? 'on' : 'off') + '">' + (on ? onText : offText) + '</span>'; }
  function tm(v) { if (!v) return ''; var d = new Date(v); return isNaN(d) ? '' : ('0' + (d.getMonth() + 1)).slice(-2) + '/' + ('0' + d.getDate()).slice(-2) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function sub(v, p) { var t = tm(v); return t ? '<small>' + p + ' ' + t + '</small>' : ''; }
  function olSub(r) { if (!r) return ''; var l = r.lastRun, x = ''; if (l) x = '最近 ' + tm(l.at) + ' ↑' + (l.uploaded || 0) + ' ↓' + (l.downloaded || 0) + (l.errors && l.errors.length ? ' ⚠' : ''); var n = tm(r.nextSyncAt); if (n) x += (x ? ' · ' : '') + '下次 ' + n; return x ? '<small>' + x + '</small>' : ''; }
  function render(o, users, bk) {
    var t = o.logs.totals;
    $('dash-log-error').textContent = t.error; $('dash-log-warn').textContent = t.warn; $('dash-log-info').textContent = t.info;
    var h = $('dash-health'); h.className = 'dash-health ' + (t.error ? 'bad' : t.warn > 20 ? 'warn' : 'ok');
    h.textContent = t.error ? '存在错误' : t.warn > 20 ? '需关注' : '运行健康';
    var max = Math.max.apply(null, o.logs.buckets.map(function (b) { return b.info + b.warn + b.error; }).concat([1]));
    $('dash-log-bars').innerHTML = o.logs.buckets.map(function (b) {
      var tot = b.info + b.warn + b.error, d = new Date(b.t), hh = ('0' + d.getHours()).slice(-2);
      var seg = function (n, c) { return n ? '<i class="' + c + '" style="height:' + (n / max * 100) + '%"></i>' : ''; };
      return '<div class="dash-bar" title="' + hh + ':00  共 ' + tot + ' 条 (错误 ' + b.error + ' / 警告 ' + b.warn + ')">' + seg(b.error, 'e') + seg(b.warn, 'w') + seg(b.info, 'i') + '<span>' + hh + '</span></div>';
    }).join('');
    var s = o.services;
    $('dash-services').innerHTML =
      '<li><span>WebDAV 云备份' + sub(bk.webdav && bk.webdav.nextSyncAt, '下次') + '</span>' + badge(s.webdav, bk.webdav && bk.webdav.running ? '备份中' : '已启用', '未启用') + '</li>' +
      '<li><span>OpenList 备份' + olSub(bk.openlist) + '</span>' + badge(s.openlist, bk.openlist && bk.openlist.running ? '同步中' : '已启用', '未启用') + '</li>' +
      '<li><span>公共收藏</span>' + badge(s.publicFavorites, '已开启', '已关闭') + '</li>' +
      '<li><span>恢复维护模式</span>' + badge(!s.maintenance, '正常', '维护中') + '</li>';
    var m = '';
    if (o.disk) m += meter('数据盘', o.disk.total - o.disk.free, o.disk.total, fmt(o.disk.total - o.disk.free) + ' / ' + fmt(o.disk.total));
    m += meter('进程内存 (RSS)', o.heap.used, o.heap.total, fmt(o.heap.used) + ' / ' + fmt(o.heap.total));
    $('dash-meters').innerHTML = m;
    $('dash-node-info').textContent = 'Node ' + o.node + ' · PID ' + o.pid;
    var online = users.filter(function (u) { return u.online; }).length, real = users.filter(function (u) { return u.name !== '_open'; });
    $('dash-users-sub').textContent = real.length + ' 个用户 · ' + online + ' 个在线';
    $('dash-users').innerHTML = real.slice(0, 6).map(function (u) {
      return '<li><span class="dash-dot ' + (u.online ? 'on' : '') + '"></span><span class="dash-uname">' + esc(u.name) + '</span>' +
        (u.disabled ? '<span class="dash-pill off">已禁用</span>' : '') +
        '<span class="dash-udev">' + (u.online ? u.onlineDevices + ' 台设备' : '离线') + '</span></li>';
    }).join('') || '<li class="dash-empty">暂无用户</li>';
    $('dash-events').innerHTML = o.logs.recent.map(function (e) {
      return '<li><span class="dash-lv ' + e.level + '">' + (e.level === 'error' ? 'ERR' : 'WARN') + '</span><span class="dash-msg">' + esc(e.msg) + '</span><time>' + esc(e.time.replace('T', ' ').slice(5, 19)) + '</time></li>';
    }).join('') || '<li class="dash-empty">近 24 小时没有警告或错误 ✓</li>';
  }
  var busy = false;
  async function refresh() {
    var view = $('view-dashboard');
    if (busy || !view || !view.classList.contains('active') || document.hidden || typeof app === 'undefined') return;
    busy = true;
    try {
      var r = await Promise.all([app.request('/api/dashboard/overview'), app.request('/api/users'), app.request('/api/backup/status').catch(function () { return {}; })]);
      if (r[0] && r[0].success) render(r[0], Array.isArray(r[1]) ? r[1] : [], r[2] || {});
    } catch (e) { /* silent: dashboard keeps last data */ }
    busy = false;
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-go]'); if (a && window.app) app.switchView(a.getAttribute('data-go'));
  });
  setInterval(refresh, 10000); setTimeout(refresh, 800);
  document.addEventListener('click', function (e) { if (e.target.closest('.nav-item')) setTimeout(refresh, 400); });

  /* KPI sparklines sampled from the live stat values */
  var SP = { 'stat-cpu': [], 'stat-memory-percent': [] };
  function spark(id) {
    var el = $(id); if (!el) return; var card = el.closest('.stat-card'); if (!card) return;
    var v = parseFloat(el.textContent); if (isNaN(v)) return; var a = SP[id]; a.push(v); if (a.length > 40) a.shift();
    if (a.length < 2) return; var lo = Math.min.apply(null, a), hi = Math.max.apply(null, a), r = Math.max(hi - lo, 4);
    var pts = a.map(function (y, i) { return (i / (a.length - 1) * 100).toFixed(1) + ',' + (28 - (y - lo) / r * 24).toFixed(1); }).join(' ');
    var svg = card.querySelector('svg.spark');
    if (!svg) { svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'spark'); svg.setAttribute('viewBox', '0 0 100 30'); svg.setAttribute('preserveAspectRatio', 'none'); svg.innerHTML = '<polyline fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke"/>'; card.appendChild(svg); }
    svg.firstChild.setAttribute('points', pts);
  }
  setInterval(function () { Object.keys(SP).forEach(spark); }, 3000);

  /* chart time-window switch */
  function addWindow() {
    var grid = document.querySelector('#view-dashboard .monitor-grid'); if (!grid || document.getElementById('dash-win')) return;
    var bar = document.createElement('div'); bar.id = 'dash-win'; bar.className = 'dash-win';
    var STEP = 3000 / 1000;
    [['1 分钟', 60], ['5 分钟', 300], ['15 分钟', 900]].forEach(function (w, i) {
      var b = document.createElement('button'); b.textContent = w[0]; b.className = i ? '' : 'on';
      b.onclick = function () { app.monitorWindow = Math.round(w[1] / STEP); bar.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); };
      bar.appendChild(b);
    });
    grid.parentNode.insertBefore(bar, grid);
  }
  setTimeout(addWindow, 600);})();