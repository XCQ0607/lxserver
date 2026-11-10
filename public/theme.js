(function () {
  var KEY = 'lx-theme', root = document.documentElement, mq = window.matchMedia('(prefers-color-scheme: dark)');
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function cur() { return saved() || (mq.matches ? 'dark' : 'light'); }
  function css(n) { return getComputedStyle(root).getPropertyValue(n).trim(); }
  function recolorCharts() {
    if (!window.Chart || !Chart.instances) return;
    Object.values(Chart.instances).forEach(function (c) {
      var s = c.options.scales || {};
      ['x', 'y'].forEach(function (a) {
        if (!s[a]) return;
        s[a].grid.color = css('--chart-grid'); s[a].ticks.color = css('--chart-tick');
      });
      var t = c.options.plugins && c.options.plugins.tooltip;
      if (t) { t.backgroundColor = css('--tip-bg'); t.titleColor = t.bodyColor = css('--tip-text'); }
      c.update('none');
    });
  }
  function apply(t) { root.setAttribute('data-theme', t); recolorCharts(); }
  window.__themeColors = function () {
    return { grid: css('--chart-grid'), tick: css('--chart-tick'), tipBg: css('--tip-bg'), tipText: css('--tip-text') };
  };
  apply(cur());
  mq.addEventListener && mq.addEventListener('change', function () { if (!saved()) apply(cur()); });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#theme-toggle')) return;
    var n = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, n); } catch (x) { }
    apply(n);
  });
})();


/* runtime contrast safety net: fix text that ends up unreadable on its effective background */
(function () {
  var root = document.documentElement, timer, busy = false;
  function parse(c) { var m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; var p = m[1].split(',').map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
  function lum(c) { var f = function (v) { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); }
  function bgOf(el) {
    var layers = [], n = el;
    while (n && n.nodeType === 1) { var c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= .98) break; } n = n.parentElement; }
    var base = root.getAttribute('data-theme') === 'dark' ? { r: 11, g: 12, b: 15 } : { r: 246, g: 247, b: 249 };
    for (var i = layers.length - 1; i >= 0; i--) { var l = layers[i]; base = { r: l.r * l.a + base.r * (1 - l.a), g: l.g * l.a + base.g * (1 - l.a), b: l.b * l.a + base.b * (1 - l.a) }; }
    return base;
  }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
  function reset() { document.querySelectorAll('[data-cf]').forEach(function (e) { e.style.removeProperty('color'); e.removeAttribute('data-cf'); }); }
  function scan() {
    busy = true; reset();
    var dark = root.getAttribute('data-theme') === 'dark';
    var els = document.querySelectorAll('body *:not(script):not(style):not(svg):not(path):not(canvas)');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.closest('.sidebar,button,.btn-primary,.btn-secondary') || !el.offsetParent) continue;
      var own = false; for (var k = 0; k < el.childNodes.length; k++) if (el.childNodes[k].nodeType === 3 && el.childNodes[k].nodeValue.trim()) { own = true; break; }
      if (!own) continue;
      var col = parse(getComputedStyle(el).color); if (!col) continue;
      var bg = bgOf(el);
      if (ratio(col, bg) < 3) { el.style.setProperty('color', lum(bg) > .35 ? '#1f2430' : '#f1f2f5', 'important'); el.setAttribute('data-cf', '1'); }
    }
    busy = false;
  }
  function later() { clearTimeout(timer); timer = setTimeout(scan, 350); }
  new MutationObserver(function () { if (!busy) later(); }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  new MutationObserver(function () { reset(); later(); }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('load', later);
})();
