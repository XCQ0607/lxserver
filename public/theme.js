(function () {
    'use strict';
    const key = 'lx-theme';
    const root = document.documentElement;
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    function preference() {
        try {
            const value = localStorage.getItem(key);
            return value === 'light' || value === 'dark' ? value : null;
        } catch (_) { return null; }
    }
    let selected = preference();

    // Canvas cannot consume var() directly. Resolve the same CSS tokens as the UI.
    window.themeColors = function () {
        const style = getComputedStyle(root);
        const css = name => style.getPropertyValue(name).trim();
        return {
            grid: css('--chart-grid'), tick: css('--chart-tick'),
            series: [1, 2, 3, 4].map(n => css('--chart-' + n)),
            tipBg: css('--surface'), tipText: css('--text'), border: css('--border'),
            accent: css('--login-particle-1'), info: css('--login-particle-2'),
        };
    };

    function recolorCharts() {
        if (!window.Chart || !window.Chart.instances) return;
        const colors = themeColors();
        Object.values(window.Chart.instances).forEach(chart => {
            Object.values(chart.options.scales || {}).forEach(axis => {
                if (axis.grid) axis.grid.color = colors.grid;
                if (axis.ticks) axis.ticks.color = colors.tick;
            });
            const tooltip = chart.options.plugins && chart.options.plugins.tooltip;
            if (tooltip) {
                tooltip.backgroundColor = colors.tipBg;
                tooltip.titleColor = tooltip.bodyColor = colors.tipText;
                tooltip.borderColor = colors.border;
            }
            chart.data.datasets.forEach((dataset, i) => {
                dataset.borderColor = colors.series[dataset.themeSeries ?? i % 4];
                dataset.backgroundColor = dataset.borderColor;
            });
            chart.update('none');
        });
    }

    function apply() {
        const theme = selected || (system.matches ? 'dark' : 'light');
        root.dataset.theme = theme;
        document.querySelectorAll('[data-theme-toggle]').forEach(toggle => {
            toggle.setAttribute('aria-pressed', String(theme === 'dark'));
            toggle.setAttribute('aria-label', theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题');
        });
        recolorCharts();
    }
    // Loaded synchronously in head before any stylesheet or visible content.
    apply();
    system.addEventListener('change', () => { if (!selected) apply(); });
    window.addEventListener('storage', event => {
        if (event.key === key || event.key === null) { selected = preference(); apply(); }
    });
    document.addEventListener('DOMContentLoaded', apply);
    document.addEventListener('click', event => {
        if (!event.target.closest('[data-theme-toggle]')) return;
        selected = root.dataset.theme === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(key, selected); } catch (_) { /* Keep the choice for this page. */ }
        apply();
    });
})();
