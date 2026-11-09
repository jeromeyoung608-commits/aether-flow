// io/ingest.js — local file -> parsed records, with honest two-phase progress.
//
// Drop or double-click a CSV (or several). Parsing runs in csv.worker.js;
// storing runs in batched IndexedDB transactions. Progress shown to the user
// is the REAL byte / row count from those two phases, never a fake timer.
//
// The Worker and this fallback share one encoding/delimiter/warnings pipeline
// from csv.js: bytes are decoded with BOM / UTF-16 / strict-UTF-8 handling,
// the field separator is sniffed instead of hard-coded, and parse metadata is
// turned into user-facing warnings by importWarnings().

import { parseCSVText, sniffDelimiter, decodeBytes, importWarnings, decodeWithCandidates, detectHeaderAndSkip, parsePreview, countAmbiguousDates } from '../utils/csv.js';
import { buildColumns } from './schema.js';
import { cleanseRow, DEFAULT_RULES } from './cleanse.js';

export class Ingest {
  constructor({ onProgress, rules = DEFAULT_RULES } = {}) {
    this.onProgress = onProgress || (() => {});
    this.rules = rules;
  }

  /** @returns {Promise<{rows, columns, header, rowCount, name, bytes, warnings, delimiter, encoding}>} */
  parse(file, opts = {}) {
    if (typeof Worker !== 'undefined') return this._workerParse(file, opts);
    return this._fallbackParse(file, opts); // private mode / no module Worker support
  }

  /**
   * Non-destructive pre-import scan. Returns a PreviewReport (encoding
   * candidates, delimiter, header/skip detection, 20-row preview, ambiguous
   * date count) WITHOUT writing any row. The caller shows the report and only
   * writes after the user confirms.
   * @returns {Promise<object>} the scan report (mirrors the worker 'scan' msg)
   */
  scan(file) {
    if (typeof Worker !== 'undefined') return this._workerScan(file);
    return this._fallbackScan(file);
  }

  _workerScan(file) {
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker(new URL('../core/csv.worker.js', import.meta.url), { type: 'module' });
      } catch (_) {
        this._fallbackScan(file).then(resolve, reject);
        return;
      }
      const cleanup = () => { try { worker.terminate(); } catch (_) {} };
      worker.onmessage = (e) => {
        const m = e.data || {};
        if (m.type === 'scan') { cleanup(); resolve(m); }
        else if (m.type === 'scan-error') { cleanup(); reject(new Error(m.message)); }
      };
      worker.onerror = (e) => { cleanup(); reject(new Error(e.message || 'CSV worker failed')); };
      worker.postMessage({ type: 'scan', file });
    });
  }

  async _readBytes(file) {
    if (typeof file.arrayBuffer === 'function') {
      return new Uint8Array(await file.arrayBuffer());
    }
    if (typeof file.text === 'function') {
      return new Uint8Array(new TextEncoder().encode(await file.text()));
    }
    throw new Error('The file cannot be read as bytes.');
  }

  async _fallbackScan(file) {
    const bytes = await this._readBytes(file);
    const { text, encoding, bomLength } = decodeWithCandidates(bytes);
    const delimiter = sniffDelimiter(text.split(/\r?\n/, 1)[0] || text);
    const hs = detectHeaderAndSkip(text, delimiter);
    const preview = parsePreview(text, { delimiter, skipRows: hs.skipRows, maxRows: 20 });
    let extraRows = 0;
    for (const r of preview.rows) if (r.__extra) extraRows++;
    // Re-parse the head with real line breaks so the CSV state machine emits
    // every row (feeding bare lines leaves them buffered until the next
    // newline, which starves the date-ambiguity scan of data).
    const headText = text.split(/\r?\n/).slice(hs.skipRows, hs.skipRows + 2000).join('\n');
    const headRows = parseCSVText(headText, { delimiter });
    const headerCells = headRows[0] || [];
    const dateAmbiguity = [];
    for (let c = 0; c < headerCells.length; c++) {
      const vals = headRows.slice(1).map((r) => r[c]);
      const { count, sample } = countAmbiguousDates(vals);
      if (count > 0) dateAmbiguity.push({ colIndex: c, colName: String(headerCells[c] || `col_${c + 1}`), count, sample });
    }
    const warnings = importWarnings({ delimiter, encoding, bomLength, extraRows });
    return {
      name: file.name || 'data.csv', size: file.size || 0,
      text,
      encoding, encodingCandidates: [encoding], ambiguous: encoding !== 'utf-8',
      bomLength, delimiter, headerRow: hs.headerRow, skipRows: hs.skipRows,
      fieldCount: hs.fieldCount, preview, dateAmbiguity, warnings,
    };
  }

  _workerParse(file, opts = {}) {
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker(new URL('../core/csv.worker.js', import.meta.url), { type: 'module' });
      } catch (err) {
        this._fallbackParse(file, opts).then(resolve, reject);
        return;
      }
      const all = [];
      let columns = null;
      let header = null;
      let rowCount = 0;
      let bytes = 0;
      let delimiter;
      let encoding;
      const warnings = [];
      const cleanup = () => { try { worker.terminate(); } catch (_) {} };

      worker.onmessage = (e) => {
        const m = e.data || {};
        if (m.type === 'progress') {
          bytes = m.bytes;
          this.onProgress({ phase: 'parse', label: 'Parsing CSV', pct: m.pct, rows: m.rows, bytes, total: m.total });
        } else if (m.type === 'warning') {
          warnings.push(m.message);
        } else if (m.type === 'meta') {
          columns = m.columns;
          header = m.header;
        } else if (m.type === 'batch') {
          for (const r of m.rows) all.push(r);
        } else if (m.type === 'done') {
          columns = m.columns || columns;
          header = m.header || header;
          rowCount = m.rowCount;
          bytes = m.bytes;
          delimiter = m.delimiter;
          encoding = m.encoding || 'utf-8';
          cleanup();
          resolve({
            rows: all, columns: columns || [], header: header || [], rowCount,
            name: m.name, bytes,
            warnings: (m.warnings && m.warnings.length) ? m.warnings : warnings,
            delimiter, encoding,
          });
        } else if (m.type === 'error') {
          cleanup();
          reject(new Error(m.message));
        }
      };
      worker.onerror = (e) => {
        cleanup();
        reject(new Error(e.message || 'CSV worker failed'));
      };
      worker.postMessage({ type: 'parse', file, rules: this.rules, opts });
    });
  }

  /** Read bytes when possible (real File/Blob) and decode with the shared
   *  encoding logic; legacy shims that only expose text() stay supported. */
  async _readText(file) {
    if (typeof file.arrayBuffer === 'function') {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const { text, encoding, bomLength } = decodeBytes(bytes);
      return { text, encoding, bomLength, byteLength: bytes.byteLength };
    }
    if (typeof file.text === 'function') {
      const text = await file.text();
      return { text, encoding: 'utf-8', bomLength: 0, byteLength: file.size || text.length };
    }
    throw new Error('The file cannot be read as bytes or text.');
  }

  async _fallbackParse(file, opts = {}) {
    this.onProgress({ phase: 'parse', label: 'Parsing CSV', pct: 0 });
    const bytes = await this._readBytes(file);
    let text;
    let encoding;
    let bomLength = 0;
    if (opts.encoding) {
      encoding = opts.encoding;
      text = new TextDecoder(opts.encoding, { fatal: false }).decode(bytes);
    } else {
      const decoded = decodeWithCandidates(bytes);
      text = decoded.text;
      encoding = decoded.encoding;
      bomLength = decoded.bomLength;
    }
    const delimiter = opts.delimiter || sniffDelimiter(text);
    const skipRows = opts.skipRows || 0;
    const raw = parseCSVText(text, { delimiter });
    if (raw.length <= skipRows) throw new Error('The file is empty or has no data rows.');
    const header = raw[skipRows].map(String);
    const body = raw.slice(skipRows + 1).filter((r) => r.length > 1 || (r[0] ?? '') !== '');
    const columns = buildColumns(header, body.slice(0, 200));
    const fields = columns.map((c) => c.field);
    const typeOf = Object.fromEntries(columns.map((c) => [c.field, c.type]));
    let extraRows = 0;
    const rows = body.map((r, i) => {
      const rec = { id: i + 1 };
      for (let k = 0; k < fields.length; k++) rec[fields[k]] = r[k] ?? '';
      if (r.length > fields.length) {
        rec.__extra = r.slice(fields.length);
        extraRows++;
      }
      return cleanseRow(rec, this.rules, typeOf, fields);
    });
    const warnings = importWarnings({ delimiter, encoding, bomLength, extraRows });
    this.onProgress({ phase: 'parse', label: 'Parsing CSV', pct: 100, rows: rows.length });
    return {
      rows, columns, header, rowCount: rows.length,
      name: file.name || 'data.csv', bytes: bytes.byteLength,
      warnings, delimiter, encoding,
    };
  }
}

/** Normalize a drop event / file input into a plain File array. */
export function filesFromEvent(e) {
  const out = [];
  if (e?.dataTransfer?.files?.length) {
    for (const f of e.dataTransfer.files) out.push(f);
  } else if (e?.target?.files?.length) {
    for (const f of e.target.files) out.push(f);
  }
  return out.filter((f) => /\.(csv|tsv|txt)$/i.test(f.name || '') || (f.type || '').includes('csv'));
}

/** Stable id for an imported file (name + size + lastModified). */
export function fileIdFor(file) {
  return `f_${String(file.name || 'data')}_${file.size || 0}_${file.lastModified || 0}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}
