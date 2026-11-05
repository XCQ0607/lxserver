// Lyric Parser - Ported from lx-music-desktop
// Source: common/utils/lyric-font-player/line-player.js (simplified)

try {
    // 从全局获取工具函数（由 lyric-utils.js 提供）
    if (!window.LyricUtils) {
        console.error('[Lyric Parser] LyricUtils not loaded! Make sure lyric-utils.js is loaded before lyric-parser.js');
        throw new Error('LyricUtils not loaded');
    }

    const { getNow, TimeoutTools } = window.LyricUtils;

    const timeFieldExp = /^(?:\[[\d:.]+\])+/g
    const timeExp = /\d{1,3}(:\d{1,3}){0,2}(?:\.\d{1,3})/g
    const tagRegMap = {
        title: 'ti',
        artist: 'ar',
        album: 'al',
        offset: 'offset',
        by: 'by',
    }

    const timeoutTools = new TimeoutTools()

    const t_rxp_1 = /^0+(\d+)/
    const t_rxp_2 = /:0+(\d+)/g
    const t_rxp_3 = /\.0+(\d+)/

    const formatTimeLabel = (label) => {
        return label.replace(t_rxp_1, '$1')
            .replace(t_rxp_2, ':$1')
            .replace(t_rxp_3, '.$1')
    }

    const parseExtendedLyric = (lrcLinesMap, extendedLyric) => {
        const extendedLines = extendedLyric.split(/\r\n|\n|\r/)
        for (let i = 0; i < extendedLines.length; i++) {
            const line = extendedLines[i].trim()
            let result = timeFieldExp.exec(line)
            if (result) {
                const timeField = result[0]
                const text = line.replace(timeFieldExp, '').trim()
                if (text && text != '//') {
                    const times = timeField.match(timeExp)
                    if (times == null) continue
                    for (let time of times) {
                        const timeStr = formatTimeLabel(time)
                        const targetLine = lrcLinesMap[timeStr]
                        if (targetLine) targetLine.extendedLyrics.push(text)
                    }
                }
            }
        }
    }

    class LinePlayer {
        constructor({ offset = 0, rate = 1, onPlay = function () { }, onSetLyric = function () { } } = {}) {
            this.tags = {}
            this.lines = null
            this.onPlay = onPlay
            this.onSetLyric = onSetLyric
            this.isPlay = false
            this.curLineNum = 0
            this.maxLine = 0
            this.offset = offset
            this._performanceTime = 0
            this._startTime = 0
            this._rate = rate
        }

        _init() {
            if (this.lyric == null) this.lyric = ''
            if (this.extendedLyrics == null) this.extendedLyrics = []
            this._initTag()
            this._initLines()
            this.onSetLyric(this.lines, this.tags.offset + this.offset)
        }

        _initTag() {
            this.tags = {}
            for (let tag in tagRegMap) {
                const matches = this.lyric.match(new RegExp(`\\[${tagRegMap[tag]}:([^\\]]*)\\]`, 'i'))
                this.tags[tag] = (matches && matches[1]) || ''
            }
            if (this.tags.offset) {
                let offset = parseInt(this.tags.offset)
                this.tags.offset = Number.isNaN(offset) ? 0 : offset
            } else {
                this.tags.offset = 0
            }
        }

        _initLines() {
            this.lines = []
            const lines = this.lyric.split(/\r\n|\r|\n/)
            const linesMap = {}
            // [Fix] 兼容 <起始,持续,未知>、<起始,持续> 等各种尖括号逐字标签
            const wordExp = /<(\d+),(\d+)(?:,\d+)?>([^<]*)/g

            // console.log('[LinePlayer] 准备解析歌词，原始数据前 300 字符预览:\n' + this.lyric.substring(0, 300));
            // console.log('[LinePlayer] 是否包含 < 符号? ' + this.lyric.includes('<'));
            // console.log('[LinePlayer] 是否包含 ( 符号? ' + this.lyric.incudes('('));

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim()
                let result = timeFieldExp.exec(line)
                if (result) {
                    const timeField = result[0]
                    const textContent = line.replace(timeFieldExp, '').trim()
                    if (textContent) {
                        const times = timeField.match(timeExp)
                        if (times == null) continue
                        for (let time of times) {
                            const timeStr = formatTimeLabel(time)
                            if (linesMap[timeStr]) {
                                linesMap[timeStr].extendedLyrics.push(textContent)
                                continue
                            }
                            const timeArr = timeStr.split(':')
                            if (timeArr.length > 3) continue
                            else if (timeArr.length < 3) {
                                for (let i = 3 - timeArr.length; i--;) timeArr.unshift('0')
                            }
                            if (timeArr[2].indexOf('.') > -1) {
                                timeArr.splice(2, 1, ...timeArr[2].split('.'))
                            }

                            const lineTime = parseInt(timeArr[0]) * 60 * 60 * 1000 +
                                parseInt(timeArr[1]) * 60 * 1000 +
                                parseInt(timeArr[2]) * 1000 +
                                parseInt(timeArr[3] || 0);

                            // 解析逐字歌词
                            const words = []
                            let wordMatch
                            wordExp.lastIndex = 0; // [Fix] 重置正则偏移量，确保每行从头解析

                            while ((wordMatch = wordExp.exec(textContent)) !== null) {
                                words.push({
                                    startTime: parseInt(wordMatch[1]),
                                    duration: parseInt(wordMatch[2]),
                                    text: wordMatch[3]
                                })
                            }

                            // 针对部分源可能存在的 (start,duration) 格式兼容
                            if (words.length === 0) {
                                const wordExp2 = /\((\d+),(\d+)\)([^(\[]*)/g
                                let wordMatch2
                                while ((wordMatch2 = wordExp2.exec(textContent)) !== null) {
                                    words.push({
                                        startTime: parseInt(wordMatch2[1]),
                                        duration: parseInt(wordMatch2[2]),
                                        text: wordMatch2[3]
                                    })
                                }
                            }

                            // 如果没有逐字匹配，但看起来像普通的 lrc 文字
                            const plainText = textContent.replace(/<[\d,]+>|\(\d+,\d+\)/g, '').trim()

                            linesMap[timeStr] = {
                                time: lineTime,
                                text: plainText,
                                words: words.length > 0 ? words : null,
                                extendedLyrics: [],
                            }
                        }
                    }
                }
            }

            let wordLineCount = 0;
            for (const lrc of this.extendedLyrics) parseExtendedLyric(linesMap, lrc)
            this.lines = Object.values(linesMap)
            this.lines.sort((a, b) => a.time - b.time)
            this.maxLine = this.lines.length - 1

            // 汇总解析结果日志
            // this.lines.forEach(l => { if (l.words) wordLineCount++ });
            // console.log(`[LinePlayer] 解析完成: 共 ${this.lines.length} 行, 其中逐字歌词行: ${wordLineCount}`);
            // if (wordLineCount > 0) {
            //     console.log('[LinePlayer] 第一行逐字数据示例:', this.lines.find(l => l.words));
            // }
        }

        _currentTime() {
            return (getNow() - this._performanceTime) * this._rate + this._startTime
        }

        _findCurLineNum(curTime, startIndex = 0) {
            if (curTime <= 0) return 0
            if (!this.lines || !this.lines.length) return 0
            const length = this.lines.length
            for (let index = startIndex; index < length; index++) {
                if (curTime < this.lines[index].time) {
                    return index === 0 ? 0 : index - 1
                }
            }
            return length - 1
        }

        _handleMaxLine() {
            this.onPlay(this.curLineNum, this.lines[this.curLineNum].text, this._currentTime())
            this.pause()
        }

        _refresh() {
            this.curLineNum++
            if (this.curLineNum >= this.maxLine) return this._handleMaxLine()

            let curLine = this.lines[this.curLineNum]
            const currentTime = this._currentTime()
            const driftTime = currentTime - curLine.time

            if (driftTime >= 0) {
                let nextLine = this.lines[this.curLineNum + 1]
                const delay = (nextLine.time - curLine.time - driftTime) / this._rate

                if (delay > 0) {
                    if (this.isPlay) {
                        timeoutTools.start(() => {
                            if (!this.isPlay) return
                            this._refresh()
                        }, delay)
                    }
                    this.onPlay(this.curLineNum, curLine.text, currentTime)
                    return
                } else {
                    let newCurLineNum = this._findCurLineNum(currentTime, this.curLineNum + 1)
                    if (newCurLineNum > this.curLineNum) this.curLineNum = newCurLineNum - 1
                    this._refresh()
                    return
                }
            } else if (this.curLineNum == 0) {
                let firstLine = this.lines[0]
                const delay = (firstLine.time - currentTime) / this._rate
                if (this.isPlay) {
                    timeoutTools.start(() => {
                        if (!this.isPlay) return
                        this.curLineNum = -1
                        this._refresh()
                    }, delay)
                }
                this.onPlay(-1, '', currentTime)
                return
            }

            this.curLineNum = this._findCurLineNum(currentTime, this.curLineNum) - 1
            this._refresh()
        }

        play(curTime = 0) {
            if (!this.lines || !this.lines.length) return
            if (this.isPlay) {
                // 如果已经在播放，检查当前时间差，如果偏差较大则重置
                const currentTime = this._currentTime();
                if (Math.abs(currentTime - curTime) < 100) return;
            }
            this.pause()
            this.isPlay = true

            this._performanceTime = getNow() - parseInt(this.tags.offset + this.offset)
            this._startTime = curTime

            this.curLineNum = this._findCurLineNum(this._currentTime()) - 1
            this._refresh()
        }

        pause() {
            if (!this.isPlay) return
            this.isPlay = false
            timeoutTools.clear()
            if (this.curLineNum === this.maxLine) return
            const currentTime = this._currentTime()
            const curLineNum = this._findCurLineNum(currentTime)
            if (this.curLineNum !== curLineNum) {
                this.curLineNum = curLineNum
                this.onPlay(curLineNum, this.lines[curLineNum].text, currentTime)
            }
        }

        setPlaybackRate(rate) {
            this._rate = rate
            if (!this.lines.length) return
            if (!this.isPlay) return
            this.play(this._currentTime())
        }


        setLyric(lyric, extendedLyrics) {
            if (this.isPlay) this.pause()
            this.lyric = lyric
            this.extendedLyrics = extendedLyrics
            console.log('[LinePlayer] setLyric', {
                lrcLength: lyric?.length || 0,
                extendedCount: extendedLyrics?.length || 0,
                hasLrc: !!lyric
            });
            this._init()
        }
    }

    // 暴露到全局
    window.LinePlayer = LinePlayer;

} catch (error) {
    console.error('[Lyric Parser] Failed to load:', error);
    console.error('[Lyric Parser] Stack:', error.stack);
}
