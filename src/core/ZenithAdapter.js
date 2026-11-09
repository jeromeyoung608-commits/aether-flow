// ZenithAdapter.js — the data-source contract, now IndexedDB-backed.
//
// S1 change (M4A): the legacy synchronous key/value store is entirely gone.
// Every read and write goes through a StorageAdapter vault (IDBVault /
// MemoryVault, or a customer-supplied implementation). The sample site has no
// server, so this adapter IS the persistence layer, not a thin mock.
//
// 0.1.1: import is atomic (generation staging + one descriptor transaction),
// bulk deletes use ONE transaction, and every write surfaces its errors to the
// caller instead of being swallowed.
//
// Stable SPI: `StorageAdapter` — see docs/api.md.

import { generateRecords } from '../data/generator.js';

export class ZenithAdapter {
  /**
   * @param {object} params
   * @param {number} [params.page] zero-based page index
   * @param {number} [params.pageSize] rows per page
   * @param {Array<{field:string,dir:'asc'|'desc'}>} [params.sort]
   * @param {{global?:string, columns?:Record<string,string>}} [params.filter]
   * @returns {Promise<{rows:Array, total:number}>}
   */
  async fetchData(/* params */) {
    throw new Error('ZenithAdapter.fetchData() must be implemented by a subclass.');
  }
}

/** The default, real adapter for AetherFlow. Sits on a vault, not on a network. */
export class IndexedDBAdapter extends ZenithAdapter {
  constructor(vault, fileId, { batchSize = 2000 } = {}) {
    super();
    this.vault = vault;
    this.fileId = fileId;
    this.batchSize = batchSize;
  }

  setFile(fileId) { this.fileId = fileId; return this; }

  async fetchData(/* params */) {
    // Sorting/filtering stay in the query Worker; the vault only returns the
    // working set. 100k rows are read with one indexed getAll.
    const rows = await this.vault.getRows(this.fileId);
    return { rows, total: rows.length };
  }

  async listFiles() { return this.vault.getAll('files'); }

  async registerFile(descriptor) { return this.vault.put('files', descriptor); }

  async deleteFile(fileId) { return this.vault.deleteFileCompletely(fileId); }

  /**
   * Replace one file's dataset ATOMICALLY. New rows are staged under a fresh
   * namespace with real progress; the live descriptor flips only after every
   * batch has committed. A quota failure leaves the old generation intact.
   */
  async importRows(fileId, descriptor, rows, onProgress) {
    return this.vault.commitStagedFile(fileId, descriptor, rows, onProgress);
  }

  /** Persist one edited cell; called from Grid.commitEdit(). Errors propagate. */
  async commitEdit(id, field, value) {
    const row = await this.vault.getRow(this.fileId, id);
    if (!row) return false;
    row[field] = value;
    await this.vault.putRow(this.fileId, row);
    return true;
  }

  /** ONE transaction for the whole selection, plus a cheap count update. */
  async deleteRows(ids) {
    return this.vault.deleteRowsFor(this.fileId, ids);
  }

  /** Undo path: put the deleted rows back into the live namespace. */
  async restoreRows(rows) {
    return this.vault.restoreRows(this.fileId, rows);
  }

  async getMeta(key) { return this.vault.get('meta', key); }
  async setMeta(key, value) { return this.vault.put('meta', { key, value }); }
}

/**
 * In-memory adapter kept for examples and for the "stress" demo. It does NOT
 * touch IndexedDB — use `IndexedDBAdapter.importRows()` for persisted demos.
 */
export class MockAdapter extends ZenithAdapter {
  constructor(data, { latency = 0, failOnce = false } = {}) {
    super();
    this.data = data;
    this.latency = latency;
    this.failOnce = failOnce;
    this._failed = false;
  }
  async fetchData(/* params */) {
    if (this.latency) await new Promise((r) => setTimeout(r, this.latency));
    if (this.failOnce && !this._failed) {
      this._failed = true;
      throw new Error('Simulated upstream failure (demo only).');
    }
    return { rows: this.data, total: this.data.length };
  }
  async commitEdit(/* id, field, value */) { return true; }
  async deleteRows(/* ids */) { return 0; }
  async restoreRows(/* rows */) { return 0; }
}

/** Generate deterministic synthetic rows for the 100k stress demo. */
export function demoRows(n = 100000) { return generateRecords(n); }
