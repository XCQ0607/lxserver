/**
 * idb_store.js
 * IndexedDB 封装，用于替代 localStorage 存储大型歌单数据（lx_list_data）。
 * 解决：Setting the value of 'lx_list_data' exceeded the quota.
 *
 * 提供同步风格的 window.ListStore API：
 *   window.ListStore.get()    -> Promise<object|null>
 *   window.ListStore.set(data)-> Promise<void>
 *   window.ListStore.remove() -> Promise<void>
 */
(function () {
    'use strict';

    const DB_NAME = 'lx_music_store';
    const DB_VERSION = 1;
    const STORE_NAME = 'kv';
    const LIST_KEY = 'lx_list_data';

    let _db = null;

    function openDB() {
        if (_db) return Promise.resolve(_db);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            req.onsuccess = (e) => {
                _db = e.target.result;
                resolve(_db);
            };
            req.onerror = (e) => {
                console.error('[IDBStore] 打开数据库失败:', e.target.error);
                reject(e.target.error);
            };
        });
    }

    function idbGet(key) {
        return openDB().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(key);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = (e) => reject(e.target.error);
        }));
    }

    function idbSet(key, value) {
        return openDB().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const req = tx.objectStore(STORE_NAME).put(value, key);
            req.onsuccess = () => resolve();
            req.onerror = (e) => reject(e.target.error);
        }));
    }

    function idbDelete(key) {
        return openDB().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const req = tx.objectStore(STORE_NAME).delete(key);
            req.onsuccess = () => resolve();
            req.onerror = (e) => reject(e.target.error);
        }));
    }

    const ListStore = {
        /** 获取歌单数据，返回 object 或 null */
        get() {
            return idbGet(LIST_KEY);
        },
        /** 保存歌单数据（传入 object，直接存入 IDB） */
        set(data) {
            return idbSet(LIST_KEY, data);
        },
        /** 删除歌单缓存 */
        remove() {
            return idbDelete(LIST_KEY);
        }
    };

    // 预热数据库
    openDB().catch(e => {
        console.warn('[IDBStore] 初始化失败:', e);
    });

    window.ListStore = ListStore;
})();
