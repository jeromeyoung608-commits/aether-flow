// idb.js — AetherFlow's StorageAdapter implementations.
//
// The sample site has NO server. Everything the user imports (file descriptors,
// parsed rows, column layout, edits, settings) lives here, in the browser.
//
// Two implementations share ONE contract so the rest of the app never imports
// IndexedDB directly:
//   IDBVault     — real IndexedDB, batched transactions for 100k rows
//   MemoryVault  — graceful fallback (private mode / IDB disabled / tests)
//
// This contract is a public SPI (see docs/api.md). A customer can supply their
// own encrypted / sharded vault without touching the core.
//
// ATOMIC REPLACE (0.1.1): rows are stored under a per-file *namespace*
// `${owner}@${generation}`, and the `files` descriptor points at the live one.
// An import writes a whole new generation first (progress stays real and the UI
// stays responsive); only then does a SINGLE transaction flip the descriptor.
// A quota error halfway through therefore leaves the previous generation — and
// every row the user already had — completely intact. Restore works the same
// way: staged rows, then one transaction that swaps `files` + `meta` together.

export const DB_NAME = 'aether-flow';
export const DB_VERSION = 1;

const STORE_DEFS = {
  files: { keyPath: 'id' },
  // Composite key keeps multiple imported files in one store without collisions.
  // `fileId` here holds the namespace, not the logical owner id.
  rows: { keyPath: ['fileId', 'id'], indexes: [{ name: 'byFile', keyPath: 'fileId' }] },
  meta: { keyPath: 'key' },
};

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Open a transaction and resolve only after it fully commits. */
function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

/** Write in bounded transactions so a 100k import never blocks the UI thread. */
function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

/** Namespaces always begin with the logical owner id followed by '@'. */
function newNamespace(fileId, tag = 'g') {
  return `${fileId}@${tag}@${Date.now().toString(36)}@${Math.random().toString(36).slice(2, 8)}`;
}

function ownerOf(row) {
  if (row?.owner) return row.owner;
  const ns = String(row?.fileId ?? '');
  const at = ns.indexOf('@');
  return at === -1 ? ns : ns.slice(0, at);
}

/** Upper bound for all namespaces belonging to one logical file. */
function namespaceRange(fileId) {
  return [fileId, `${fileId}\uffff`];
}

export class IDBVault {
  constructor(name = DB_NAME) {
    this.name = name;
    this.db = null;
    this.backend = 'indexeddb';
  }

  open() {
    if (this.db) return Promise.resolve(this);
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [name, def] of Object.entries(STORE_DEFS)) {
          const store = db.objectStoreNames.contains(name)
            ? req.transaction.objectStore(name)
            : db.createObjectStore(name, { keyPath: def.keyPath });
          for (const idx of def.indexes || []) {
            if (!store.indexNames.contains(idx.name)) store.createIndex(idx.name, idx.keyPath);
          }
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        this.db.onversionchange = () => { this.db.close(); this.db = null; };
        resolve(this);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
    });
  }

  _store(name, mode) {
    if (!this.db) throw new Error('Vault is not open');
    return this.db.transaction(name, mode).objectStore(name);
  }

  async get(store, key) {
    const tx = this.db.transaction(store, 'readonly');
    return reqToPromise(tx.objectStore(store).get(key));
  }

  async put(store, value) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    await txDone(tx);
    return value;
  }

  async getAll(store) {
    const tx = this.db.transaction(store, 'readonly');
    return reqToPromise(tx.objectStore(store).getAll());
  }

  async delete(store, key) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await txDone(tx);
  }

  /**
   * Batched write with real progress. Each batch is its own transaction, so the
   * browser can yield between batches (the UI stays at 60fps during import).
   */
  async putMany(store, values, onProgress, batchSize = 2000) {
    const batches = chunk(values, batchSize);
    let done = 0;
    for (const batch of batches) {
      const tx = this.db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      for (const v of batch) os.put(v);
      await txDone(tx);
      done += batch.length;
      if (onProgress) onProgress(done, values.length);
      // Yield to the event loop so progress paints instead of batching into one frame.
      await new Promise((r) => setTimeout(r, 0));
    }
    return values.length;
  }

  /** The namespace a file currently reads from. Falls back to legacy rows. */
  async getNamespace(fileId) {
    const descriptor = await this.get('files', fileId);
    return descriptor?.ns || fileId;
  }

  async getRows(fileId) {
    if (!this.db) throw new Error('Vault is not open');
    const ns = await this.getNamespace(fileId);
    const tx = this.db.transaction('rows', 'readonly');
    const idx = tx.objectStore('rows').index('byFile');
    return reqToPromise(idx.getAll(IDBKeyRange.only(ns)));
  }

  async getRow(fileId, id) {
    const ns = await this.getNamespace(fileId);
    return this.get('rows', [ns, id]);
  }

  async putRow(fileId, row) {
    const ns = await this.getNamespace(fileId);
    const stored = { ...row, fileId: ns, owner: row.owner || fileId };
    await this.put('rows', stored);
    return stored;
  }

  /** Remove one namespace's rows in a single transaction. */
  async _purgeNamespace(ns) {
    if (!this.db) return;
    const tx = this.db.transaction('rows', 'readwrite');
    const os = tx.objectStore('rows');
    const keys = await reqToPromise(os.index('byFile').getAllKeys(IDBKeyRange.only(ns)));
    for (const k of keys) os.delete(k);
    await txDone(tx);
    return keys.length;
  }

  /** All generations of one logical file, in a single transaction. */
  async _purgeAllNamespaces(fileId) {
    if (!this.db) return;
    const tx = this.db.transaction('rows', 'readwrite');
    const os = tx.objectStore('rows');
    const keys = await reqToPromise(os.index('byFile').getAllKeys(
      IDBKeyRange.bound(...namespaceRange(fileId)),
    ));
    for (const k of keys) os.delete(k);
    await txDone(tx);
    return keys.length;
  }

  async deleteRows(fileId) { return this._purgeAllNamespaces(fileId); }
  async deleteRow(fileId, id) {
    const ns = await this.getNamespace(fileId);
    return this.delete('rows', [ns, id]);
  }

  /**
   * One transaction deletes every requested row. No per-row transaction, no
   * full table re-read just to update the count.
   */
  async deleteRowsFor(fileId, ids) {
    const ns = await this.getNamespace(fileId);
    const unique = [...new Set(ids)];
    const descriptor = await this.get('files', fileId);
    const tx = this.db.transaction(['rows', 'files'], 'readwrite');
    const os = tx.objectStore('rows');
    for (const id of unique) os.delete([ns, id]);
    if (descriptor) {
      const remaining = Math.max(0, Number(descriptor.rowCount || 0) - unique.length);
      tx.objectStore('files').put({ ...descriptor, rowCount: remaining, updatedAt: Date.now() });
    }
    await txDone(tx);
    return unique.length;
  }

  /** Re-insert rows after an undo. They go back into the LIVE namespace. */
  async restoreRows(fileId, rows) {
    const ns = await this.getNamespace(fileId);
    const stored = rows.map((r) => ({ ...r, fileId: ns, owner: r.owner || fileId }));
    await this.putMany('rows', stored);
    const descriptor = await this.get('files', fileId);
    if (descriptor) {
      await this.put('files', { ...descriptor, rowCount: Number(descriptor.rowCount || 0) + rows.length, updatedAt: Date.now() });
    }
    return rows.length;
  }

  async deleteFileCompletely(fileId) {
    await this._purgeAllNamespaces(fileId);
    await this.delete('files', fileId);
  }

  /**
   * Atomic import. Stages a whole new generation first, then flips the file
   * descriptor in ONE transaction. Any failure before the flip purges the stage
   * and leaves the previous generation untouched.
   */
  async commitStagedFile(fileId, descriptor, rows, onProgress) {
    const ns = newNamespace(fileId);
    const staged = rows.map((r) => ({ ...r, fileId: ns, owner: fileId }));
    try {
      await this.putMany('rows', staged, onProgress);
    } catch (err) {
      await this._purgeNamespace(ns).catch(() => {});
      throw new Error(`Import failed — your existing data was NOT changed (${err.message})`);
    }
    const previous = await this.get('files', fileId);
    try {
      await this.put('files', {
        ...descriptor, id: fileId, ns, owner: fileId,
        rowCount: rows.length, updatedAt: Date.now(),
      });
    } catch (err) {
      await this._purgeNamespace(ns).catch(() => {});
      throw new Error(`Import failed — your existing data was NOT changed (${err.message})`);
    }
    if (previous?.ns && previous.ns !== ns) await this._purgeNamespace(previous.ns).catch(() => {});
    return rows.length;
  }

  /**
   * Atomic restore. Stages every row under fresh namespaces, then swaps the
   * entire `files` + `meta` state in ONE transaction. A failure before that
   * transaction changes nothing the user currently has.
   */
  async restoreAtomically(payload, onProgress) {
    const files = payload?.files || [];
    const rows = payload?.rows || [];
    const meta = payload?.meta || {};
    const stamp = Date.now().toString(36);
    const nsByOwner = new Map();
    for (const f of files) nsByOwner.set(f.id, `${f.id}@restore@${stamp}`);
    // Old backups have no `owner`; derive it from the namespace prefix.
    for (const r of rows) if (!nsByOwner.has(ownerOf(r))) nsByOwner.set(ownerOf(r), `${ownerOf(r)}@restore@${stamp}`);

    const staged = rows.map((r) => {
      const owner = ownerOf(r);
      return { ...r, fileId: nsByOwner.get(owner), owner };
    });
    const stagedNamespaces = [...new Set(staged.map((r) => r.fileId).filter(Boolean))];

    try {
      await this.putMany('rows', staged, onProgress);
    } catch (err) {
      for (const ns of stagedNamespaces) await this._purgeNamespace(ns).catch(() => {});
      throw new Error(`Restore failed — your current data was NOT changed (${err.message})`);
    }

    const oldFiles = await this.getAll('files');
    try {
      const tx = this.db.transaction(['files', 'meta'], 'readwrite');
      const fileStore = tx.objectStore('files');
      const metaStore = tx.objectStore('meta');
      fileStore.clear();
      for (const f of files) fileStore.put({ ...f, ns: nsByOwner.get(f.id) || f.ns, owner: f.id });
      metaStore.clear();
      for (const [key, value] of Object.entries(meta)) metaStore.put({ key, value });
      await txDone(tx);
    } catch (err) {
      for (const ns of stagedNamespaces) await this._purgeNamespace(ns).catch(() => {});
      throw new Error(`Restore failed — your current data was NOT changed (${err.message})`);
    }

    // Old generations are dead weight, not live state. Best-effort cleanup.
    for (const f of oldFiles) await this._purgeNamespace(f.ns || f.id).catch(() => {});
    return { files: files.length, rows: rows.length };
  }

  async clear() {
    if (!this.db) return;
    for (const name of Object.keys(STORE_DEFS)) {
      const tx = this.db.transaction(name, 'readwrite');
      tx.objectStore(name).clear();
      await txDone(tx);
    }
  }

  async estimate() {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      return { usage, quota };
    }
    return null;
  }
}

/**
 * In-memory vault with the exact same surface. Used when IndexedDB is blocked
 * (private browsing, hardened browsers) and by the Node test suite.
 * It is TEMPORARY: nothing survives a reload. The UI says so explicitly.
 */
export class MemoryVault {
  constructor() {
    this.backend = 'memory';
    this._stores = { files: new Map(), rows: new Map(), meta: new Map() };
  }
  async open() { return this; }
  _map(store) {
    if (!this._stores[store]) this._stores[store] = new Map();
    return this._stores[store];
  }
  _key(store, value) {
    const kp = STORE_DEFS[store]?.keyPath;
    return Array.isArray(kp) ? JSON.stringify(kp.map((k) => value[k])) : value[kp];
  }
  async get(store, key) { return this._map(store).get(Array.isArray(key) ? JSON.stringify(key) : key); }
  async put(store, value) { this._map(store).set(this._key(store, value), value); return value; }
  async getAll(store) { return [...this._map(store).values()]; }
  async delete(store, key) { this._map(store).delete(Array.isArray(key) ? JSON.stringify(key) : key); }
  async putMany(store, values, onProgress, batchSize = 2000) {
    const map = this._map(store);
    const batches = chunk(values, batchSize);
    let done = 0;
    for (const batch of batches) {
      for (const v of batch) map.set(this._key(store, v), v);
      done += batch.length;
      if (onProgress) onProgress(done, values.length);
      await new Promise((r) => setTimeout(r, 0));
    }
    return values.length;
  }

  async getNamespace(fileId) {
    return (await this.get('files', fileId))?.ns || fileId;
  }
  _rowsFor(ns) {
    return [...this._map('rows').values()].filter((r) => r.fileId === ns);
  }
  async getRows(fileId) { return this._rowsFor(await this.getNamespace(fileId)); }
  async getRow(fileId, id) {
    const ns = await this.getNamespace(fileId);
    return this.get('rows', [ns, id]);
  }
  async putRow(fileId, row) {
    const ns = await this.getNamespace(fileId);
    const stored = { ...row, fileId: ns, owner: row.owner || fileId };
    await this.put('rows', stored);
    return stored;
  }

  _purgeNamespace(ns) {
    const map = this._map('rows');
    let n = 0;
    for (const [k, v] of map) if (v.fileId === ns) { map.delete(k); n++; }
    return n;
  }
  _purgeAllNamespaces(fileId) {
    const map = this._map('rows');
    const [lo, hi] = namespaceRange(fileId);
    let n = 0;
    for (const [k, v] of map) if (v.fileId >= lo && v.fileId <= hi) { map.delete(k); n++; }
    return n;
  }
  async deleteRows(fileId) { return this._purgeAllNamespaces(fileId); }
  async deleteRow(fileId, id) {
    const ns = await this.getNamespace(fileId);
    return this.delete('rows', [ns, id]);
  }

  async deleteRowsFor(fileId, ids) {
    const ns = await this.getNamespace(fileId);
    const unique = new Set(ids);
    const map = this._map('rows');
    for (const id of unique) map.delete(JSON.stringify([ns, id]));
    const descriptor = await this.get('files', fileId);
    if (descriptor) {
      await this.put('files', {
        ...descriptor,
        rowCount: Math.max(0, Number(descriptor.rowCount || 0) - unique.size),
        updatedAt: Date.now(),
      });
    }
    return unique.size;
  }

  async restoreRows(fileId, rows) {
    const ns = await this.getNamespace(fileId);
    const stored = rows.map((r) => ({ ...r, fileId: ns, owner: r.owner || fileId }));
    await this.putMany('rows', stored);
    const descriptor = await this.get('files', fileId);
    if (descriptor) {
      await this.put('files', { ...descriptor, rowCount: Number(descriptor.rowCount || 0) + rows.length, updatedAt: Date.now() });
    }
    return rows.length;
  }

  async deleteFileCompletely(fileId) {
    this._purgeAllNamespaces(fileId);
    await this.delete('files', fileId);
  }

  async commitStagedFile(fileId, descriptor, rows, onProgress) {
    const ns = newNamespace(fileId);
    const staged = rows.map((r) => ({ ...r, fileId: ns, owner: fileId }));
    try {
      await this.putMany('rows', staged, onProgress);
    } catch (err) {
      this._purgeNamespace(ns);
      throw new Error(`Import failed — your existing data was NOT changed (${err.message})`);
    }
    const previous = await this.get('files', fileId);
    try {
      await this.put('files', {
        ...descriptor, id: fileId, ns, owner: fileId,
        rowCount: rows.length, updatedAt: Date.now(),
      });
    } catch (err) {
      this._purgeNamespace(ns);
      throw new Error(`Import failed — your existing data was NOT changed (${err.message})`);
    }
    if (previous?.ns && previous.ns !== ns) this._purgeNamespace(previous.ns);
    return rows.length;
  }

  async restoreAtomically(payload, onProgress) {
    const files = payload?.files || [];
    const rows = payload?.rows || [];
    const meta = payload?.meta || {};
    const stamp = Date.now().toString(36);
    const nsByOwner = new Map();
    for (const f of files) nsByOwner.set(f.id, `${f.id}@restore@${stamp}`);
    for (const r of rows) if (!nsByOwner.has(ownerOf(r))) nsByOwner.set(ownerOf(r), `${ownerOf(r)}@restore@${stamp}`);

    const staged = rows.map((r) => {
      const owner = ownerOf(r);
      return { ...r, fileId: nsByOwner.get(owner), owner };
    });
    const stagedNamespaces = [...new Set(staged.map((r) => r.fileId).filter(Boolean))];
    // Everything below is a pure in-memory swap: build the new state aside,
    // then replace it in one assignment so no partial state is ever visible.
    try {
      const newRows = new Map(this._map('rows'));
      for (const r of staged) newRows.set(JSON.stringify([r.fileId, r.id]), r);
      if (onProgress) onProgress(staged.length, staged.length);
      const newFiles = new Map();
      for (const f of files) newFiles.set(f.id, { ...f, ns: nsByOwner.get(f.id) || f.ns, owner: f.id });
      const newMeta = new Map();
      for (const [key, value] of Object.entries(meta)) newMeta.set(key, { key, value });
      this._stores.rows = newRows;
      this._stores.files = newFiles;
      this._stores.meta = newMeta;
    } catch (err) {
      for (const ns of stagedNamespaces) this._purgeNamespace(ns);
      throw new Error(`Restore failed — your current data was NOT changed (${err.message})`);
    }
    for (const ns of stagedNamespaces) {
      // Remove rows still pointing at a pre-restore namespace of the same owner.
      const owner = String(ns).split('@')[0];
      const map = this._map('rows');
      for (const [k, v] of map) if (v.fileId !== ns && String(v.fileId).startsWith(`${owner}@`)) map.delete(k);
    }
    return { files: files.length, rows: rows.length };
  }

  async clear() { for (const m of Object.values(this._stores)) m.clear(); }
  async estimate() { return null; }
}

/** Pick the best available backend. Never throws: the site must not white-screen. */
export async function createVault() {
  try { return await new IDBVault().open(); }
  catch (_) { return new MemoryVault().open(); }
}
