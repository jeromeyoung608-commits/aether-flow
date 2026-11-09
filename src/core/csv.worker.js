// csv.worker.js — streaming CSV parse, fully off the main thread.
//
// A 100k-row / 500 MB file must never be decoded on the UI thread. The main
// thread only receives progress / meta / batch / done / warning / error
// messages, so scrolling and rAF stay smooth throughout the import.
//
// The File is structured-cloned into the worker (no upload, no network
// primitive). Byte progress is derived from real bytes read, not a timer.
//
// Schema inference needs a sample, so the first SAMPLE_SIZE rows are buffered.
// Those buffered rows are STILL emitted once the schema is known — dropping
// them would silently lose the head of every large file. Rows longer than the
// header keep their tail in __extra and raise a warning instead of losing data.

import { CSVParser, ByteDecoder, importWarnings, decodeWithCandidates, detectHeaderAndSkip, parsePreview, countAmbiguousDates, sniffDelimiter } from '../utils/csv.js';
import { buildColumns } from '../io/schema.js';
import { cleanseRow, DEFAULT_RULES } from '../io/cleanse.js';

const SAMPLE_SIZE = 200;
const BATCH_SIZE = 5000;
const SCAN_BYTES = 64 * 1024;
const SCAN_LINES = 2000;

/**
 * Read the head of a file as bytes (or whole file when small).
 * @returns {Promise<Uint8Array>}
 */
async function readHeadBytes(file) {
  if (typeof file.slice === 'function' && (file.size || 0) > SCAN_BYTES) {
    return new Uint8Array(await file.slice(0, SCAN_BYTES).arrayBuffer());
  }
  if (typeof file.arrayBuffer === 'function') {
    return new Uint8Array(await file.arrayBuffer());
  }
  const t = await file.text();
  return new Uint8Array(new TextEncoder().encode(t));
}

/**
 * Non-destructive pre-import scan: decode (GBK / Windows-1252 no longer error),
 * sniff the delimiter, detect header + skip-rows, render a 20-row preview and
 * count ambiguous slash-dates. Everything stays on the worker thread; the main
 * thread only receives the report. No rows are written anywhere.
 */
async function runScan(file) {
  try {
    const total = file.size || 0;
    const bytes = await readHeadBytes(file);
    let decoded;
    try {
      decoded = decodeWithCandidates(bytes);
    } catch (err) {
      self.postMessage({ type: 'scan-error', message: err && err.message ? err.message : String(err) });
      return;
    }
    const { text, encoding, bomLength, candidates, ambiguous } = decoded;

    const delimiter = sniffDelimiter((text.split(/\r?\n/, 1)[0] || text));
    const hs = detectHeaderAndSkip(text, delimiter);

    const preview = parsePreview(text, { delimiter, skipRows: hs.skipRows, maxRows: 20 });
    let extraRows = 0;
    for (const r of preview.rows) if (r.__extra) extraRows++;

    // Date-ambiguity scan over a larger head so the count is meaningful.
    const headLines = text.split(/\r?\n/).slice(hs.skipRows, hs.skipRows + SCAN_LINES);
    const p = new CSVParser({ delimiter });
    const headRows = [];
    for (const ln of headLines) for (const row of p.push(ln)) headRows.push(row);
    for (const row of p.end()) headRows.push(row);
    const headerCells = headRows[0] || [];
    const dateAmbiguity = [];
    for (let c = 0; c < headerCells.length; c++) {
      const vals = headRows.slice(1).map((r) => r[c]);
      const { count, sample } = countAmbiguousDates(vals);
      if (count > 0) dateAmbiguity.push({ colIndex: c, colName: String(headerCells[c] || `col_${c + 1}`), count, sample });
    }

    const warnings = importWarnings({ delimiter, encoding, bomLength, extraRows });
    self.postMessage({
      type: 'scan',
      name: file.name || 'data.csv',
      size: total,
      text,
      encoding, encodingCandidates: candidates.map((c) => c.encoding),
      ambiguous, bomLength,
      delimiter, headerRow: hs.headerRow, skipRows: hs.skipRows, fieldCount: hs.fieldCount,
      preview, dateAmbiguity, warnings,
    });
  } catch (err) {
    self.postMessage({ type: 'scan-error', message: err && err.message ? err.message : String(err) });
  }
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type === 'scan') { runScan(msg.file); return; }
  if (msg.type !== 'parse') return;
  const { file, rules = DEFAULT_RULES, opts = {} } = msg;
  if (!file || typeof file.stream !== 'function') {
    self.postMessage({ type: 'error', message: 'No readable file was provided.' });
    return;
  }

  try {
    const total = file.size || 0;
    const byteDecoder = new ByteDecoder();
    if (opts.encoding) byteDecoder.forceEncoding(opts.encoding);
    const forcedDelimiter = opts.delimiter || null;
    const skipRows = opts.skipRows || 0;
    let parser = null;
    const reader = file.stream().getReader();

    let bytes = 0;
    let id = 0;
    let header = null;
    let columns = null;
    let schemaReady = false;
    let typeOf = {};
    let fields = [];
    const buffer = [];      // raw rows held until the schema is inferred
    let batch = [];
    let lastReport = 0;
    let extraRows = 0;
    let warnedExtra = false;

    const emitBatch = (force = false) => {
      if (!force && batch.length < BATCH_SIZE) return;
      if (!batch.length) return;
      self.postMessage({ type: 'batch', rows: batch });
      batch = [];
    };

    const noteExtra = () => {
      extraRows++;
      if (!warnedExtra) {
        warnedExtra = true;
        self.postMessage({ type: 'warning', message: 'Some rows have more fields than the header. The extra values were kept in __extra.' });
      }
    };

    const accept = (raw) => {
      const record = { id: ++id };
      for (let i = 0; i < fields.length; i++) record[fields[i]] = raw[i] ?? '';
      if (raw.length > fields.length) {
        record.__extra = raw.slice(fields.length);
        noteExtra();
      }
      cleanseRow(record, rules, typeOf, fields);
      batch.push(record);
      emitBatch();
    };

    const initSchema = () => {
      columns = buildColumns(header, buffer);
      fields = columns.map((c) => c.field);
      typeOf = Object.fromEntries(columns.map((c) => [c.field, c.type]));
      schemaReady = true;
      self.postMessage({ type: 'meta', columns, header });
      const buffered = buffer.slice();
      buffer.length = 0;
      for (const r of buffered) accept(r);
    };

    let consumed = 0;
    const consume = (raw) => {
      consumed++;
      if (consumed <= skipRows) return;            // preamble / blank lines
      if (!header) { header = raw; return; }
      if (!schemaReady) {
        buffer.push(raw);
        if (buffer.length >= SAMPLE_SIZE) initSchema();
        return;
      }
      accept(raw);
    };

    const report = (force = false) => {
      const now = Date.now();
      if (!force && now - lastReport < 90) return;
      lastReport = now;
      self.postMessage({
        type: 'progress', phase: 'parse', bytes, total,
        pct: total ? Math.min(100, Math.round((bytes / total) * 100)) : null,
        rows: id + buffer.length,
      });
    };

    // Construct the parser lazily: ByteDecoder sniffs the delimiter from the
    // first decoded text block, which is only available after the first push.
    // A user-overridden delimiter wins over the sniffed one.
    const feed = (text) => {
      if (!text) return;
      if (!parser) parser = new CSVParser({ delimiter: forcedDelimiter || byteDecoder.delimiter });
      for (const raw of parser.push(text)) consume(raw);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      feed(byteDecoder.push(value));
      report();
    }
    feed(byteDecoder.end());
    if (!parser) parser = new CSVParser({ delimiter: forcedDelimiter || byteDecoder.delimiter });
    for (const raw of parser.end()) consume(raw);

    // Short files never reached SAMPLE_SIZE — infer from what we actually got.
    if (!schemaReady && header) initSchema();
    emitBatch(true);
    report(true);

    if (!header || !id) {
      self.postMessage({ type: 'error', message: 'The file is empty or has no data rows.' });
      return;
    }
    const hint = byteDecoder.hint || { encoding: 'utf-8', bomLength: 0 };
    const delimiter = forcedDelimiter || byteDecoder.delimiter;
    const warnings = importWarnings({
      delimiter, encoding: hint.encoding, bomLength: hint.bomLength, extraRows,
    });
    self.postMessage({
      type: 'done', columns, header: header.map(String), rowCount: id, bytes,
      name: file.name || 'data.csv',
      delimiter,
      encoding: hint.encoding,
      warnings,
    });
  } catch (err) {
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
};
