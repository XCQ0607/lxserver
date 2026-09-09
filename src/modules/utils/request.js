import needle from 'needle'
import { debugRequest } from './env'
import { requestMsg } from './message'
import { bHh } from './musicSdk/options'
import { deflateRaw } from 'zlib'
import * as tunnel from 'tunnel'


const httpsRxp = /^https:/

// Mock proxy config from global.lx.config if needed, or environment variables
const getRequestAgent = async url => {
    const config = global.lx?.config || {}
    const proxyEnabled = config['proxy.all.enabled']
    const proxyAddress = config['proxy.all.address']

    if (proxyEnabled && proxyAddress) {
        try {
            const proxyUrl = new URL(proxyAddress)
            if (proxyUrl.protocol === 'http:' || proxyUrl.protocol === 'https:') {
                const isHttps = httpsRxp.test(url)
                const tunnelOptions = {
                    proxy: {
                        host: proxyUrl.hostname,
                        port: proxyUrl.port,
                        proxyAuth: proxyUrl.username ? `${proxyUrl.username}:${proxyUrl.password}` : undefined
                    }
                }
                return (isHttps ? tunnel.httpsOverHttp : tunnel.httpOverHttp)(tunnelOptions)
            } else if (proxyUrl.protocol.startsWith('socks')) {
                const { SocksProxyAgent } = await import('socks-proxy-agent')
                return new SocksProxyAgent(proxyAddress)
            }
        } catch (e) {
            // console.error('[Request] Invalid proxy address:', proxyAddress, e)
        }
    }

    if (process.env.HTTPS_PROXY) {
        try {
            const proxyUrl = new URL(process.env.HTTPS_PROXY)
            const tunnelOptions = {
                proxy: {
                    host: proxyUrl.hostname,
                    port: proxyUrl.port,
                    proxyAuth: proxyUrl.username ? `${proxyUrl.username}:${proxyUrl.password}` : undefined
                }
            }
            return (httpsRxp.test(url) ? tunnel.httpsOverHttp : tunnel.httpOverHttp)(tunnelOptions)
        } catch (e) { }
    }

    return undefined
}


const request = (url, options, callback) => {
    let data
    if (options.body) {
        data = options.body
    } else if (options.form) {
        data = options.form
        // data.content_type = 'application/x-www-form-urlencoded'
        options.json = false
    } else if (options.formData) {
        data = options.formData
        // data.content_type = 'multipart/form-data'
        options.json = false
    }
    options.response_timeout = options.timeout
    options.read_timeout = options.timeout

    return needle.request(options.method || 'get', url, data, options, (err, resp, body) => {
        if (!err) {
            body = resp.body = resp.raw.toString()
            try {
                resp.body = JSON.parse(resp.body)
            } catch (_) { }
            body = resp.body
        }
        callback(err, resp, body)
    }).request
}


const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}

const buildHttpPromose = (url, options) => {
    let obj = {
        isCancelled: false,
        cancelHttp: () => {
            if (!obj.requestObj) return obj.isCancelled = true
            cancelHttp(obj.requestObj)
            obj.requestObj = null
            obj.promise = obj.cancelHttp = null
            if (obj.cancelFn) obj.cancelFn(new Error(requestMsg.cancelRequest))
            obj.cancelFn = null
        },
    }
    obj.promise = new Promise((resolve, reject) => {
        obj.cancelFn = reject
        debugRequest && console.log(`\n---send request------${url}------------`)
        fetchData(url, options.method, options, (err, resp, body) => {
            debugRequest && console.log(`\n---response------${url}------------`)
            debugRequest && console.log(body)
            obj.requestObj = null
            obj.cancelFn = null
            if (err) return reject(err)
            resolve(resp)
        }).then(ro => {
            obj.requestObj = ro
            if (obj.isCancelled) obj.cancelHttp()
        })
    })
    return obj
}

export const httpFetch = (url, options = { method: 'get' }) => {
    const requestObj = buildHttpPromose(url, options)
    requestObj.promise = requestObj.promise.catch(err => {
        if (err.message === 'socket hang up') {
            return Promise.reject(new Error(requestMsg.unachievable))
        }
        switch (err.code) {
            case 'ETIMEDOUT':
            case 'ESOCKETTIMEDOUT':
                return Promise.reject(new Error(requestMsg.timeout))
            case 'ENOTFOUND':
                return Promise.reject(new Error(requestMsg.notConnectNetwork))
            default:
                return Promise.reject(err)
        }
    })
    return requestObj
}

export const cancelHttp = requestObj => {
    if (!requestObj) return
    if (!requestObj.abort) return
    requestObj.abort()
}


export const http = (url, options, cb) => {
    if (typeof options === 'function') {
        cb = options
        options = {}
    }

    // 默认选项
    if (options.method == null) options.method = 'get'

    debugRequest && console.log(`\n---send request------${url}------------`)
    return fetchData(url, options.method, options, (err, resp, body) => {
        debugRequest && console.log(`\n---response------${url}------------`)
        debugRequest && console.log(body)
        if (err) {
            debugRequest && console.log(JSON.stringify(err))
        }
        cb(err, resp, body)
    })
}

export const httpGet = (url, options, callback) => {
    if (typeof options === 'function') {
        callback = options
        options = {}
    }

    debugRequest && console.log(`\n---send request-------${url}------------`)
    return fetchData(url, 'get', options, function (err, resp, body) {
        debugRequest && console.log(`\n---response------${url}------------`)
        debugRequest && console.log(body)
        if (err) {
            debugRequest && console.log(JSON.stringify(err))
        }
        callback(err, resp, body)
    })
}

export const httpPost = (url, data, options, callback) => {
    if (typeof options === 'function') {
        callback = options
        options = {}
    }
    options.data = data

    debugRequest && console.log(`\n---send request-------${url}------------`)
    return fetchData(url, 'post', options, function (err, resp, body) {
        debugRequest && console.log(`\n---response------${url}------------`)
        debugRequest && console.log(body)
        if (err) {
            debugRequest && console.log(JSON.stringify(err))
        }
        callback(err, resp, body)
    })
}

export const http_jsonp = (url, options, callback) => {
    // Node.js doesn't support JSONP natively in the way browsers do.
    // However, musicSdk uses it to fetch data.
    // We can simulate it by standard GET and manual parsing if strictly necessary,
    // or typically APIs just return JSON if we don't ask for JSONP callback or handle it manually.
    // Needle ignores jsonp parameters, so we implement a basic GET.
    if (typeof options === 'function') {
        callback = options
        options = {}
    }

    let jsonpCallback = 'jsonpCallback'
    if (url.indexOf('?') < 0) url += '?'
    url += `&${options.jsonpCallback}=${jsonpCallback}`

    options.format = 'script'

    debugRequest && console.log(`\n---send request-------${url}------------`)
    return fetchData(url, 'get', options, function (err, resp, body) {
        debugRequest && console.log(`\n---response------${url}------------`)
        debugRequest && console.log(body)
        if (err) {
            debugRequest && console.log(JSON.stringify(err))
        } else {
            // Manual JSONP parsing
            try {
                body = JSON.parse(body.replace(new RegExp(`^${jsonpCallback}\\(({.*})\\)$`), '$1'))
            } catch (e) {
                // If regex fails, maybe it returned plain JSON or error
            }
        }

        callback(err, resp, body)
    })
}

const handleDeflateRaw = data => new Promise((resolve, reject) => {
    deflateRaw(data, (err, buf) => {
        if (err) return reject(err)
        resolve(buf)
    })
})

const regx = /(?:\d\w)+/g

const fetchData = async (url, method, {
    headers = {},
    format = 'json',
    timeout = 15000,
    ...options
}, callback) => {
    // console.log('---start---', url)
    headers = Object.assign({}, headers)
    if (headers[bHh]) {
        const path = url.replace(/^https?:\/\/[\w.:]+\//, '/')
        let s = Buffer.from(bHh, 'hex').toString()
        s = s.replace(s.substr(-1), '')
        s = Buffer.from(s, 'base64').toString()

        // Process versions mocking
        const v1 = '2050201' // Mock version numbers
        const v2 = '10'

        // let v = process.versions.app... // This was electron specific
        let v = v1.split('-')[0].split('.').map(n => n.length < 3 ? n.padStart(3, '0') : n).join('')

        headers[s] = !s || `${(await handleDeflateRaw(Buffer.from(JSON.stringify(`${path}${v}`.match(regx), null, 1).concat(v)).toString('base64'))).toString('hex')}&${parseInt(v)}${v2}`
        delete headers[bHh]
    }
    return request(url, {
        ...options,
        method,
        headers: Object.assign({}, defaultHeaders, headers),
        timeout,
        agent: await getRequestAgent(url),
        json: format === 'json',
        rejectUnauthorized: false,
    }, (err, resp, body) => {
        if (err) return callback(err, null)
        callback(null, resp, body)
    })
}

export const checkUrl = (url, options = {}) => {
    return new Promise((resolve, reject) => {
        fetchData(url, 'head', options, (err, resp) => {
            if (err) return reject(err)
            if (resp.statusCode === 200) {
                resolve()
            } else {
                reject(new Error(resp.statusCode))
            }
        })
    })
}
