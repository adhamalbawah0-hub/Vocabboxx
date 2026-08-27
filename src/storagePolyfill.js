/*
 * Real, standalone-browser replacement for the Claude.ai-artifact-only
 * `window.storage` API. Same method signatures, same return shapes —
 * backed by a real IndexedDB database instead of the Claude.ai host.
 *
 * This is installed as `window.storage` at app startup (see main.jsx),
 * so the rest of the app's code (VocabBox App.jsx) needs ZERO changes.
 */

const DB_NAME = 'vocabbox-db';
const STORE_NAME = 'kv';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME); // keyPath omitted — we supply keys manually
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = null;
function getDB() {
  if (!dbPromise) dbPromise = openDB();
  return dbPromise;
}

// Real deployments are single-user, so `shared` doesn't need a separate
// backend scope — we just namespace the key so shared/local never collide.
function fullKey(key, shared) {
  return `${shared ? 'shared' : 'local'}:${key}`;
}

async function idbGet(key) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbListKeys() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const storagePolyfill = {
  async get(key, shared = false) {
    const value = await idbGet(fullKey(key, shared));
    if (value === undefined) throw new Error(`Key not found: ${key}`); // matches documented artifact behavior
    return { key, value, shared };
  },

  async set(key, value, shared = false) {
    await idbSet(fullKey(key, shared), value);
    return { key, value, shared };
  },

  async delete(key, shared = false) {
    await idbDelete(fullKey(key, shared));
    return { key, deleted: true, shared };
  },

  async list(prefix = '', shared = false) {
    const allKeys = await idbListKeys();
    const namespacePrefix = `${shared ? 'shared' : 'local'}:`;
    const keys = allKeys
      .filter((k) => typeof k === 'string' && k.startsWith(namespacePrefix + prefix))
      .map((k) => k.slice(namespacePrefix.length));
    return { keys, prefix, shared };
  },
};

export function installStoragePolyfill() {
  if (typeof window !== 'undefined' && !window.storage) {
    window.storage = storagePolyfill;
  }
}
