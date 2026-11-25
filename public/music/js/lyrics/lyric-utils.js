// Lyric Utilities - Ported from lx-music-desktop
// Source: common/utils/lyric-font-player/utils.js

const getNow = typeof performance == 'object' && window.performance.now
    ? window.performance.now.bind(window.performance)
    : Date.now.bind(Date)

class TimeoutTools {
    constructor(thresholdTime = 80) {
        this.nextTick = window.requestAnimationFrame.bind(window)
        this.cancelNextTick = window.cancelAnimationFrame.bind(window)
        this.invokeTime = 0
        this.animationFrameId = null
        this.timeoutId = null
        this.callback = null
        this.thresholdTime = thresholdTime
    }

    run() {
        const tick = () => {
            let diff = this.invokeTime - getNow()

            if (diff > 0) {
                if (typeof document !== 'undefined' && document.hidden) {
                    return this.timeoutId = window.setTimeout(() => {
                        this.timeoutId = null
                        this.run()
                    }, Math.max(0, diff))
                }
                if (diff < this.thresholdTime) return this.run()
                return this.timeoutId = window.setTimeout(() => {
                    this.timeoutId = null
                    this.run()
                }, diff - this.thresholdTime)
            }

            this.callback(diff)
        }

        // 锁屏或后台标签页下 requestAnimationFrame 会被浏览器暂停，改用 setTimeout 保持歌词定时器推进
        if (typeof document !== 'undefined' && document.hidden) {
            const remaining = Math.max(0, this.invokeTime - getNow())
            this.timeoutId = window.setTimeout(() => {
                this.timeoutId = null
                tick()
            }, remaining)
            return
        }

        this.animationFrameId = this.nextTick(() => {
            this.animationFrameId = null
            tick()
        })
    }

    start(callback = () => { }, timeout = 0) {
        this.callback = callback
        this.invokeTime = getNow() + timeout
        this.run()
    }

    clear() {
        if (this.animationFrameId) {
            this.cancelNextTick(this.animationFrameId)
            this.animationFrameId = null
        }
        if (this.timeoutId) {
            window.clearTimeout(this.timeoutId)
            this.timeoutId = null
        }
    }
}

// 暴露到全局
window.LyricUtils = { getNow, TimeoutTools };
