/**
 * System Log Viewer
 * Captures console output for display in Settings > Logs
 */

(function () {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    // Store logs in memory
    window.systemLogs = [];
    const MAX_LOGS = 1000;

    function captureLog(type, args) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString() + '.' + String(now.getMilliseconds()).padStart(3, '0');

        let message = '';
        try {
            message = args.map(arg => {
                if (arg instanceof Error) {
                    return arg.toString() + '\n' + (arg.stack || '');
                }
                if (typeof arg === 'object') {
                    try {
                        return JSON.stringify(arg, null, 2);
                    } catch (e) {
                        return '[Circular/Object]';
                    }
                }
                return String(arg);
            }).join(' ');
        } catch (e) {
            message = '[Error processing log arguments]';
        }

        const logEntry = {
            id: Date.now() + Math.random(),
            time: timeStr,
            type: type,
            message: message
        };

        window.systemLogs.push(logEntry);
        if (window.systemLogs.length > MAX_LOGS) {
            window.systemLogs.shift();
        }

        // Real-time update if view is active
        const container = document.getElementById('system-log-container');
        if (container && container.offsetParent !== null) { // minimal check for visibility
            appendLogToView(container, logEntry);
            if (window.autoScrollLogs) {
                container.scrollTop = container.scrollHeight;
            }
        }
    }

    // Override Console Methods
    console.log = function (...args) {
        originalLog.apply(console, args);
        captureLog('info', args);
    };

    console.warn = function (...args) {
        originalWarn.apply(console, args);
        captureLog('warn', args);
    };

    console.error = function (...args) {
        originalError.apply(console, args);
        captureLog('error', args);
    };

    // Helper: Escape HTML
    function escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Helper: Append single log
    function appendLogToView(container, log) {
        const div = document.createElement('div');
        div.className = `font-mono text-xs py-1.5 px-2 rounded border-b t-border-main last:border-0 hover:t-bg-item-hover transition-colors ${log.type === 'error' ? 'text-red-500 dark:text-red-400 bg-red-500/10' :
            log.type === 'warn' ? 'text-amber-500 dark:text-amber-400 bg-amber-500/10' :
                't-text-main'
            }`;

        // Colorize time
        const timeHtml = `<span class="t-text-muted opacity-70 select-none mr-2 font-semibold">[${log.time}]</span>`;
        // Message with preserved whitespace
        const msgHtml = `<span class="whitespace-pre-wrap break-words">${escapeHtml(log.message)}</span>`;

        div.innerHTML = timeHtml + msgHtml;
        container.appendChild(div);
    }

    // Global function to render all logs (called when tab switches)
    window.renderSystemLogs = function () {
        const container = document.getElementById('system-log-container');
        if (!container) return;

        container.innerHTML = '';
        window.systemLogs.forEach(log => appendLogToView(container, log));

        // Scroll to bottom initially
        setTimeout(() => {
            container.scrollTop = container.scrollHeight;
            window.autoScrollLogs = true; // Enable auto-scroll by default on open
        }, 0);
    };

    // Global function to clear logs
    window.clearSystemLogs = function () {
        window.systemLogs = [];
        const container = document.getElementById('system-log-container');
        if (container) container.innerHTML = '';
        console.log('[System] Logs cleared by user');
    };

})();
