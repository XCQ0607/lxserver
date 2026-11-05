/**
 * LX Music Web Sync Client
 * Ported from lx-music-desktop to support Pairing & Sync
 * Updated: Uses Web Crypto API for RSA-OAEP (SPKI) compatibility
 */

// Constants matches desktop app
const SYNC_CODE = {
    helloMsg: 'Hello~::^-^::~v4~',
    idPrefix: 'lx_web_',
    msgConnect: 'lx-music connect',
    msgAuth: 'lx-music auth::',
    msgData: 'lx-music data::',
    authFailed: 'Auth failed',
    missingAuth: 'Missing auth',
    authOk: 'Auth ok',
    sync: 'list:sync',
};

const SYNC_CLOSE_CODE = {
    normal: 1000,
    failed: 4100,
};

const LIST_IDS = {
    DEFAULT: 'default',
    LOVE: 'love',
    TEMP: 'temp',
    DOWNLOAD: 'download',
};

// Utils: Gzip (using pako)
const gzip = (str) => {
    try {
        const binary = pako.gzip(str);
        // [Fix] Avoid String.fromCharCode.apply stack overflow for large data
        let binaryString = '';
        const len = binary.length;
        const CHUNK_SIZE = 8192;
        for (let i = 0; i < len; i += CHUNK_SIZE) {
            // subarray is fast and creates a view, safe to spread small chunks
            binaryString += String.fromCharCode.apply(null, binary.subarray(i, Math.min(i + CHUNK_SIZE, len)));
        }
        return btoa(binaryString);
    } catch (e) {
        console.error('Gzip error:', e);
        return '';
    }
}

const unGzip = (b64) => {
    try {
        const str = atob(b64);
        const len = str.length;
        const binData = new Uint8Array(len);
        // [Fix] Avoid split().map() for memory efficiency
        for (let i = 0; i < len; i++) {
            binData[i] = str.charCodeAt(i);
        }
        return pako.ungzip(binData, { to: 'string' });
    } catch (e) {
        console.error('UnGzip error:', e);
        return '';
    }
}

const encodeData = (data) => {
    if (data.length > 1024) {
        return 'cg_' + gzip(data);
    }
    return data;
}

const decodeData = (data) => {
    if (data.startsWith('cg_')) {
        return unGzip(data.substring(3));
    }
    return data;
}


// Key Derivation for PAIRING (AES Key from Connection Code)
const deriveTempKey = (code) => {
    const md5Hex = CryptoJS.MD5(code).toString(CryptoJS.enc.Hex);
    const keySubstring = md5Hex.substring(0, 16);
    const keyWords = CryptoJS.enc.Utf8.parse(keySubstring);
    return CryptoJS.enc.Base64.stringify(keyWords);
}

// AES Helper (Desktop uses AES-128-ECB, Key is input as Base64 string)
const aesEncrypt = (text, keyBase64) => {
    const keyParsed = CryptoJS.enc.Base64.parse(keyBase64);
    const encrypted = CryptoJS.AES.encrypt(text, keyParsed, {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7
    });
    return encrypted.toString();
};

const aesDecrypt = (text, keyBase64) => {
    const keyParsed = CryptoJS.enc.Base64.parse(keyBase64);
    const decrypted = CryptoJS.AES.decrypt(text, keyParsed, {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7
    });
    return decrypted.toString(CryptoJS.enc.Utf8);
};

// Web Crypto Utils for RSA-OAEP
const cryptoUtils = {
    // Generate RSA KeyPair Compatible with LX Server (Node.js)
    // Server uses Node's generateKeyPair('rsa', { modulusLength: 2048, type: 'spki' })
    // which produces OID 1.2.840.113549.1.1.1 (rsaEncryption).
    // Web Crypto "RSA-OAEP" produces OID 1.2.840.113549.1.1.7 (id-RSAES-OAEP).
    // WORKAROUND: Generate as RSASSA-PKCS1-v1_5 (2048 bit) to get generic OID, then reuse as OAEP.
    generateKey: async () => {
        // 1. Generate generic RSA Key (Sign/Verify) - 2048 bits to match Desktop App
        const genKey = await window.crypto.subtle.generateKey(
            {
                name: "RSASSA-PKCS1-v1_5",
                modulusLength: 2048, // Updated to 2048
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: "SHA-256", // Signature hash (irrelevant for encryption/decryption key material)
            },
            true,
            ["sign", "verify"]
        );

        // 2. Export Private Key as JWK to strip algo info
        const jwk = await window.crypto.subtle.exportKey("jwk", genKey.privateKey);
        delete jwk.alg;
        delete jwk.key_ops;

        // 3. Import Private JWK as RSA-OAEP (for Decryption)
        // CRITICAL: Node.js publicEncrypt(RSA_PKCS1_OAEP_PADDING) defaults to SHA-1.
        // We MUST use SHA-1 here to match the server's encryption.
        const decryptKey = await window.crypto.subtle.importKey(
            "jwk",
            jwk,
            {
                name: "RSA-OAEP",
                hash: "SHA-1" // Changed from SHA-256 to SHA-1
            },
            false,
            ["decrypt"]
        );

        return {
            publicKey: genKey.publicKey, // Has "rsaEncryption" OID (Correct for Server)
            privateKey: decryptKey       // Usable for OAEP Decrypt (CLIENT)
        };
    },

    // Export Public Key as SPKI Base64 (No Headers)
    exportPublicKey: async (key) => {
        const exported = await window.crypto.subtle.exportKey("spki", key);
        const exportedAsBase64 = window.btoa(String.fromCharCode(...new Uint8Array(exported)));
        return exportedAsBase64;
    },

    // Decrypt data using Private Key
    decrypt: async (privateKey, dataBase64) => {
        const binaryString = window.atob(dataBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const decrypted = await window.crypto.subtle.decrypt(
            {
                name: "RSA-OAEP"
            },
            privateKey,
            bytes
        );

        return new TextDecoder().decode(decrypted);
    }
};


class LocalClient {
    constructor(username, password) {
        this.username = username;
        this.password = password;
        this.baseUrl = '/api/user';
    }

    async login() {
        try {
            const token = (typeof userToken !== 'undefined' && userToken) || localStorage.getItem('lx_user_token');
            const authHeaders = typeof getUserAuthHeaders === 'function'
                ? getUserAuthHeaders()
                : (token ? { 'x-user-token': token, 'x-user-name': this.username || '' } : {});

            if (token) {
                const res = await fetch(`${this.baseUrl}/auth/verify`, {
                    headers: authHeaders
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.valid) return true;
                }
            }
            if (!this.password) return false;
            const res = await fetch(`${this.baseUrl}/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ username: this.username, password: this.password })
            });
            const data = await res.json();
            return !!data.success;
        } catch (e) { return false; }
    }

    async getList() {
        const res = await fetch(`${this.baseUrl}/list`, { headers: getUserAuthHeaders() });
        return await res.json();
    }

    async updateList(data) {
        const res = await fetch(`${this.baseUrl}/list`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getUserAuthHeaders() },
            body: JSON.stringify(data)
        });
        return await res.json();
    }
}

// List Action Manipulators (In-Memory)
const ListHelper = {
    getList(data, id) {
        if (id === LIST_IDS.DEFAULT) return data.defaultList;
        if (id === LIST_IDS.LOVE) return data.loveList;
        const uList = data.userList.find(l => l.id === id);
        return uList ? uList.list : null;
    },
    // Update a specific list
    updateList(data, id, newList) {
        if (id === LIST_IDS.DEFAULT) data.defaultList = newList;
        else if (id === LIST_IDS.LOVE) data.loveList = newList;
        else {
            const uListIndex = data.userList.findIndex(l => l.id === id);
            if (uListIndex > -1) {
                data.userList[uListIndex].list = newList;
            }
        }
    },

    list_data_overwrite(currentData, newData) {
        return newData;
    },
    list_create(currentData, { position, listInfos }) {
        if (position < 0) position = currentData.userList.length;
        currentData.userList.splice(position, 0, ...listInfos);
        return currentData;
    },
    list_remove(currentData, ids) {
        currentData.userList = currentData.userList.filter(l => !ids.includes(l.id));
        return currentData;
    },
    list_update(currentData, listInfos) {
        listInfos.forEach(info => {
            const list = currentData.userList.find(l => l.id === info.id);
            if (list) {
                Object.assign(list, info);
            }
        });
        return currentData;
    },
    list_update_position(currentData, { position, ids }) {
        const toMove = currentData.userList.filter(l => ids.includes(l.id));
        const kept = currentData.userList.filter(l => !ids.includes(l.id));
        kept.splice(position, 0, ...toMove);
        currentData.userList = kept;
        return currentData;
    },
    list_music_add(currentData, { id, musicInfos, addMusicLocationType }) {
        const list = this.getList(currentData, id);
        if (!list) return currentData;
        const newMusics = musicInfos.filter(m => !list.some(existing => existing.id === m.id));
        if (addMusicLocationType === 'top') {
            list.unshift(...newMusics);
        } else {
            list.push(...newMusics);
        }
        return currentData;
    },
    list_music_move(currentData, { fromId, toId, musicInfos, addMusicLocationType }) {
        // Remove from source
        const fromList = this.getList(currentData, fromId);
        const toList = this.getList(currentData, toId);
        if (!fromList || !toList) return currentData;

        const idsToMove = musicInfos.map(m => m.id);
        const itemsToMove = fromList.filter(m => idsToMove.includes(m.id));

        // Update Source List
        const newFromList = fromList.filter(m => !idsToMove.includes(m.id));
        this.updateList(currentData, fromId, newFromList);

        // Add to Target
        const uniqueItems = itemsToMove.filter(m => !toList.some(t => t.id === m.id));
        if (addMusicLocationType === 'top') {
            toList.unshift(...uniqueItems);
        } else {
            toList.push(...uniqueItems);
        }
        return currentData;
    },
    list_music_remove(currentData, { listId, ids }) {
        const list = this.getList(currentData, listId);
        if (!list) return currentData;
        const newList = list.filter(m => !ids.includes(m.id));
        this.updateList(currentData, listId, newList);
        return currentData;
    },
    list_music_update(currentData, musicInfos) {
        const updateMusicInList = (list) => {
            list.forEach(m => {
                const info = musicInfos.find(u => u.id === m.id);
                if (info) Object.assign(m, info);
            });
        };
        updateMusicInList(currentData.defaultList);
        updateMusicInList(currentData.loveList);
        currentData.userList.forEach(l => updateMusicInList(l.list));
        return currentData;
    },
    list_music_update_position(currentData, { listId, position, ids }) {
        const list = this.getList(currentData, listId);
        if (!list) return currentData;
        const toMove = list.filter(m => ids.includes(m.id));
        const kept = list.filter(m => !ids.includes(m.id));
        kept.splice(position, 0, ...toMove);
        this.updateList(currentData, listId, kept);
        return currentData;
    },
    list_music_overwrite(currentData, { listId, musicInfos }) {
        this.updateList(currentData, listId, musicInfos);
        return currentData;
    },
    list_music_clear(currentData, ids) {
        ids.forEach(id => {
            if (id === LIST_IDS.DEFAULT) currentData.defaultList = [];
            else if (id === LIST_IDS.LOVE) currentData.loveList = [];
            else {
                const uList = currentData.userList.find(l => l.id === id);
                if (uList) uList.list = [];
            }
        });
        return currentData;
    }
};


class RemoteClient {
    constructor(url, code) {
        this.rawUrl = url;
        this.code = code;
        this.ws = null;
        this.isConnected = false;
        this.heartbeatTimer = null;

        this.authInfo = null;

        this.onLogin = null;
        this.onSync = null;
        this.onDisconnect = null;

        this.pendingRequests = {};

        // Handlers for List Data Access (to be passed from App)
        this.listHandlers = {
            getData: async () => null,
            setData: async (data) => { }
        };
    }

    // URL Parsing (HTTP -> WS and vice versa)
    parseUrl(inputUrl, targetProtocol = 'ws') {
        try {
            if (!inputUrl.match(/^(http|ws)s?:\/\//)) {
                inputUrl = 'http://' + inputUrl;
            }
            const urlObj = new URL(inputUrl);
            const isSecure = urlObj.protocol === 'https:' || urlObj.protocol === 'wss:';

            if (targetProtocol === 'ws') {
                urlObj.protocol = isSecure ? 'wss:' : 'ws:';
            } else {
                urlObj.protocol = isSecure ? 'https:' : 'http:';
            }

            let str = urlObj.toString();
            if (str.endsWith('/')) str = str.slice(0, -1);
            return str;
        } catch (e) {
            console.error('URL parse failed', e);
            return inputUrl;
        }
    }

    // PAIRING FLOW
    async pair() {
        if (!this.code) throw new Error('Missing Connection Code');

        console.log('Generating RSA Keys (Web Crypto)...');
        const keyPair = await cryptoUtils.generateKey();
        const publicKeyB64 = await cryptoUtils.exportPublicKey(keyPair.publicKey);

        // Prepare Pairing Request (Auth Handler)
        const httpBase = this.parseUrl(this.rawUrl, 'http');
        const tempKey = deriveTempKey(this.code); // AES Key from Code

        // Body: "lx-music auth::\n<PubKey>\nWebPlayer\nlx_music_mobile"
        const deviceName = 'WebPlayer';
        const isMobileStr = 'lx_music_mobile';

        // The server expects Base64 Body of SPKI (It wraps it in -----BEGIN PUBLIC KEY-----)
        // cryptoUtils.exportPublicKey returns exactly that.
        const authBody = `${SYNC_CODE.msgAuth}\n${publicKeyB64}\n${deviceName}\n${isMobileStr}`;

        // Encrypt with Temp Key
        const encryptedAuth = aesEncrypt(authBody, tempKey);

        console.log('Sending Pairing Request to:', `${httpBase}/ah`);

        try {
            const res = await fetch(`${httpBase}/ah`, {
                headers: {
                    'm': encryptedAuth
                }
            });

            if (res.status !== 200) {
                const txt = await res.text();
                throw new Error(`Server Error (${res.status}): ${txt || 'Unknown'}`);
            }

            const encryptedResp = await res.text();
            // Server responds with RSA Encrypted JSON
            const decryptedJson = await cryptoUtils.decrypt(keyPair.privateKey, encryptedResp);

            if (!decryptedJson) throw new Error('RSA Decrypt Failed');

            const authData = JSON.parse(decryptedJson);
            console.log('Pairing Success:', authData);

            this.authInfo = {
                clientId: authData.clientId,
                key: authData.key,
                serverName: authData.serverName
            };

            return true;
        } catch (e) {
            console.error('Pairing Error:', e);
            throw e;
        }
    }


    async connect() {
        if (!this.authInfo) {
            console.log('No Auth Info. Attempting to Pair...');
            try {
                await this.pair();
            } catch (e) {
                if (this.onLogin) this.onLogin(false, 'Pairing Failed: ' + e.message);
                return;
            }
        }

        const wsBase = this.parseUrl(this.rawUrl, 'ws');
        const { clientId, key } = this.authInfo;

        // Handshake Step 1: Query Params
        // t = AES(msgConnect, PERMANENT_KEY)
        const t = aesEncrypt(SYNC_CODE.msgConnect, key);
        const wsUrl = `${wsBase}/socket?i=${encodeURIComponent(clientId)}&t=${encodeURIComponent(t)}`;

        console.log('Connecting WS:', wsUrl);

        try {
            this.ws = new WebSocket(wsUrl);
            this.ws.onopen = () => this.handleOpen();
            this.ws.onmessage = (e) => this.handleMessage(e);
            this.ws.onclose = (e) => this.handleClose(e);
            this.ws.onerror = (e) => this.handleError(e);
        } catch (e) {
            if (this.onLogin) this.onLogin(false, e.message);
        }
    }

    handleOpen() {
        console.log('WS Open');
        this.isConnected = true;
        this.startHeartbeat();

        // Trigger Login Success Callback
        if (this.onLogin) this.onLogin(true, 'Connected');
    }

    async handleMessage(e) {
        let msg = e.data;

        // console.log('[Sync] 收到消息, 长度:', msg.length, '前50字符:', msg.substring(0, 50));

        if (msg === 'ping') {
            // console.log('[Sync] 收到 ping (忽略)');
            return;
        }

        if (msg === SYNC_CODE.helloMsg) {
            // console.log('[Sync] 收到 Hello 消息');
            return;
        }

        // IMPORTANT: Server does NOT encrypt messages!
        // It only compresses if length > 1024 (prefix: cg_)
        // See: lx-music-desktop-master/src/main/modules/sync/server/utils/tools.ts#L56-62

        // Step 1: Decompress if needed
        let decoded = msg;
        if (msg.startsWith('cg_')) {
            try {
                decoded = decodeData(msg);
                // console.log('[Sync] Gzip 解压成功, 明文长度:', decoded.length);
            } catch (e) {
                console.error('[Sync] Gzip 解压失败:', e);
                return;
            }
        }

        // Step 2: Parse JSON
        try {
            const action = JSON.parse(decoded);
            // console.log('[Sync] JSON 解析成功, Action:', action.name || action.action || action.type);
            this.handleAction(action);
        } catch (e) {
            console.error('[Sync] JSON 解析失败:', e, '内容:', decoded.substring(0, 100));
        }
    }

    handleAction(action) {
        // console.log('Remote Action:', action);

        // 1. Handle RPC Calls (requests from server)
        if (action.name || action.action) {
            this.handleRPC(action);
            return;
        }

        // 2. Handle Data Push (legacy/simple sync) - Fallback
        if (action.action === SYNC_CODE.sync) {
            if (this.onSync) this.onSync(action.data);

            Object.values(this.pendingRequests).forEach(req => {
                req.resolve(action.data);
                clearTimeout(req.timeout);
            });
            this.pendingRequests = {};
        }
    }

    async handleRPC(action) {
        const { name, path, data: args } = action;
        let method = path ? path[0] : name; // Sometimes path is used, sometimes name
        if (name == 'onListSyncAction') method = 'onListSyncAction'; // Explicit check

        // console.log('[RPC] 处理调用:', method, 'Args:', args);

        // Define RPC Handlers
        const handlers = {
            getEnabledFeatures: async (serverType, supportedFeatures) => {
                console.log('[RPC] getEnabledFeatures, 服务端支持:', supportedFeatures);
                // CRITICAL: Must match desktop client's featureVersion (list:1, dislike:1)
                // See: lx-music-desktop-master/src/main/modules/sync/client/modules/index.ts
                const featureVersion = { list: 1, dislike: 1 };
                const features = {};
                if (supportedFeatures && featureVersion.list == supportedFeatures.list) {
                    features.list = { skipSnapshot: false };
                }
                if (supportedFeatures && featureVersion.dislike == supportedFeatures.dislike) {
                    features.dislike = { skipSnapshot: false };
                }
                console.log('[RPC] 返回启用的功能:', features);
                return features;
            },

            // --- Sync Protocol Methods ---
            list_sync_get_md5: async () => {
                const data = await this.listHandlers.getData();
                const md5 = !data ? '' : CryptoJS.MD5(JSON.stringify(data)).toString();
                console.log('[RPC] list_sync_get_md5, MD5:', md5);
                return md5;
            },
            list_sync_get_list_data: async () => {
                const data = await this.listHandlers.getData();
                console.log('[RPC] list_sync_get_list_data, 数据:', data ? `${data.loveList?.length || 0} 首喜欢` : '空');
                return data;
            },
            list_sync_set_list_data: async (data) => {
                console.log('[RPC] list_sync_set_list_data, 接收数据:', data ? `${data.loveList?.length || 0} 首喜欢` : '空');
                await this.listHandlers.setData(data);
            },
            list_sync_get_sync_mode: async () => {
                console.log('[RPC] list_sync_get_sync_mode');
                if (this.listHandlers.getSyncMode) {
                    const mode = await this.listHandlers.getSyncMode();
                    console.log('[RPC] 用户选择同步模式:', mode);
                    return mode;
                }
                console.log('[RPC] 使用默认模式: merge_remote_local');
                return 'merge_remote_local';
            },
            list_sync_finished: () => {
                console.log('[RPC] list_sync_finished - 列表同步完成!');
                if (this.onSync) this.onSync('finished');
            },
            finished: () => {
                console.log('[RPC] finished - 全部同步完成!');
            },

            // --- Dislike Sync Protocl Methods (Mocked for compatibility) ---
            dislike_sync_get_md5: async () => {
                console.log('[RPC] dislike_sync_get_md5 (Mock)');
                return CryptoJS.MD5('').toString();
            },
            dislike_sync_get_list_data: async () => {
                console.log('[RPC] dislike_sync_get_list_data (Mock)');
                return ''; // Empty string for no dislike data
            },
            dislike_sync_set_list_data: async (data) => {
                console.log('[RPC] dislike_sync_set_list_data (Mock), Data Length:', data ? data.length : 0);
                // No-op: We don't store dislike data yet
            },
            dislike_sync_get_sync_mode: async () => {
                console.log('[RPC] dislike_sync_get_sync_mode (Mock)');
                return 'merge_remote_local'; // Default safe mode
            },
            dislike_sync_finished: () => {
                console.log('[RPC] dislike_sync_finished (Mock)');
            },

            // --- Real-time Updates Handlers ---
            onListSyncAction: async (actionData) => {
                console.log('[RPC] onListSyncAction, 远程操作:', actionData);
                const { action, data } = actionData;

                // Fetch current data
                let currentData = await this.listHandlers.getData();
                if (!currentData) currentData = { defaultList: [], loveList: [], userList: [] };

                // Apply Helper Logic
                if (ListHelper[action]) {
                    currentData = ListHelper[action](currentData, data);
                    // Save data
                    await this.listHandlers.setData(currentData);
                    console.log('[RPC] 操作应用成功:', action);
                } else {
                    console.warn('[RPC] 未知操作:', action);
                }
            }
        };

        // Helper to send response (NO encryption, only compression)
        const sendResponse = async (response) => {
            // [修复] 发送前必须检查连接状态，防止连接已关闭导致报错
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                console.warn('[Sync] 连接已断开，无法发送响应:', response.name);
                return;
            }

            // console.log('[RPC] 发送响应:', response.name, '错误:', response.error, '数据类型:', typeof response.data);

            // Step 1: Stringify
            let jsonStr = JSON.stringify(response);

            // Step 2: Compress if needed (>1024 bytes)
            let toSend = encodeData(jsonStr);

            // console.log('[RPC] 响应准备完成,长度:', toSend.length, '是否压缩:', toSend.startsWith('cg_'));
            this.ws.send(toSend);
        };

        if (handlers[method]) {
            try {
                // Determine args: might be array or single obj depending on call
                const callArgs = Array.isArray(args) ? args : [args];
                const result = await handlers[method](...callArgs);

                await sendResponse({
                    name: name,
                    error: null,
                    data: result
                });

            } catch (err) {
                console.error('[RPC] 处理出错:', err);
                await sendResponse({
                    name: name,
                    error: err.message
                });
            }
        } else {
            console.warn('[RPC] 方法未实现:', method);
            await sendResponse({
                name: name,
                error: `${method} is not defined`
            });
        }
    }

    async sendData(action, data) {
        if (!this.isConnected) throw new Error('Not connected');

        return new Promise((resolve, reject) => {

            const payload = {
                name: 'onListSyncAction',
                // path: ['list', 'onListSyncAction'], 
                data: [{ action: 'list_data_overwrite', data: data }] // Wrapped in array as args
            };

            try {
                const encoded = encodeData(JSON.stringify(payload));
                this.ws.send(encoded);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    }

    startHeartbeat() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

        this.heartbeatTimer = setInterval(() => {
            // this.ws.send('1'); 
        }, 30000);
    }

    close() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    }

    handleClose(e) {
        console.log('WS Close', e.code);
        this.isConnected = false;
        if (this.onDisconnect) this.onDisconnect();
    }

    handleError(e) {
        console.error('WS Error', e);
    }
}

const SyncManager = {
    client: null,
    mode: 'local',

    initLocal(u, p) {
        this.client = new LocalClient(u, p);
        this.mode = 'local';
    },

    initRemote(url, code, handlers, authInfo) {
        this.client = new RemoteClient(url, code);
        if (authInfo) {
            this.client.authInfo = authInfo;
        }
        if (handlers) {
            this.client.listHandlers = handlers;
        }
        this.mode = 'remote';
    },

    async sync() {
        if (!this.client) throw new Error('Client not Init');
        if (this.mode === 'local') return await this.client.getList();


        return null;
    },
    async push(data) {
        if (!this.client) throw new Error('Client not Init');
        if (this.mode === 'local') return await this.client.updateList(data);

        // Remote mode push
        await this.client.sendData('push', data);
        return true;
    }
};

window.SyncManager = SyncManager;
