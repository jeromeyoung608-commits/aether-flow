// csv.js — zero-dependency CSV read + write.
//
// CSVParser is an incremental state machine: it accepts arbitrarily small
// string chunks from a stream, so a 500 MB file is never held in memory as
// one string. It handles quoted fields, escaped quotes, embedded newlines,
// CRLF line endings and a configurable delimiter. The browser Worker and the
// Node test suite share it.
//
// Everything here stays local: no network primitive, no legacy sync store,
// no framework. Incoming bytes are decoded only with the runtime TextDecoder.

import { sanitizeField } from '../io/schema.js';

// ---------------------------------------------------------------------------
// Delimiter sniffing
// ---------------------------------------------------------------------------

// Tie-break priority: , > \t > ; > | .
const DELIMITERS = [',', '\t', ';', '|'];

/**
 * Guess the field separator from the first line of a CSV text.
 * Candidate characters are counted only OUTSIDE quoted fields, so a comma in
 * "a,b" never wins over a real ';' separator. Returns ',' when the line has
 * no candidate at all (single-column files).
 */
export function sniffDelimiter(text) {
  const s = String(text ?? '');
  let end = s.length;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\n' || s[i] === '\r') { end = i; break; }
  }
  const counts = { ',': 0, '\t': 0, ';': 0, '|': 0 };
  let inQuotes = false;
  for (let i = 0; i < end; i++) {
    const ch = s[i];
    if (ch === '"') {
      if (inQuotes && s[i + 1] === '"') { i++; continue; } // escaped ""
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (ch === ',' || ch === '\t' || ch === ';' || ch === '|') counts[ch]++;
  }
  let best = ',';
  let bestCount = -1;
  for (const d of DELIMITERS) {
    if (counts[d] > bestCount) { bestCount = counts[d]; best = d; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Encoding detection + byte decoding
// ---------------------------------------------------------------------------

// A BOM-less UTF-16 stream of mostly-ASCII text is full of NUL bytes (every
// other byte). Flag it instead of producing mojibake. Require a meaningful
// ratio so a stray NUL inside a UTF-8 cell never trips it.
function looksLikeUTF16(b) {
  const n = Math.min(b.length, 4096);
  if (n < 4) return false;
  let nuls = 0;
  for (let i = 0; i < n; i++) if (b[i] === 0) nuls++;
  return nuls >= 3 && nuls / n >= 0.15;
}

/**
 * Inspect a byte sample and decide how it must be decoded. Pure.
 * @returns {{encoding: string, bomLength: number}}
 * @throws {Error} for a BOM-less UTF-16 stream (explicit re-export hint).
 */
export function detectEncoding(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) {
    return { encoding: 'utf-8', bomLength: 3 };
  }
  if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) {
    return { encoding: 'utf-16le', bomLength: 2 };
  }
  if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) {
    return { encoding: 'utf-16be', bomLength: 2 };
  }
  if (looksLikeUTF16(b)) {
    throw new Error('This file looks like UTF-16 without a BOM. Re-export it as UTF-8 CSV and try again.');
  }
  return { encoding: 'utf-8', bomLength: 0 };
}

/** Clear message for bytes we cannot safely turn into text. */
export function decodeErrorMessage(encoding) {
  const label = encoding === 'utf-8' ? 'UTF-8' : encoding;
  return `This file contains bytes that cannot be safely decoded as ${label} (it may be GBK / Windows-1252, or the data is corrupted). Re-export it as UTF-8 CSV and try again.`;
}

/** A fatal TextDecoder for the label, or a clear error on unsupported labels. */
export function createDecoder(encoding) {
  try {
    return new TextDecoder(encoding, { fatal: true });
  } catch (_) {
    throw new Error(`TextDecoder does not support ${encoding} in this browser. Re-export the file as UTF-8 CSV and try again.`);
  }
}

// Legacy single-byte encodings that frequently masquerade as a "corrupt" file.
// Both map every byte, so a fatal decode always yields *something* — we surface
// them as candidates and let the user confirm the 20-row preview before import.
export const CANDIDATE_ENCODINGS = ['gbk', 'windows-1252'];

/**
 * Decode bytes into text, trying several encodings instead of failing hard.
 * Pure. Only throws for a BOM-less UTF-16 stream or bytes no candidate can map
 * (genuine corruption). A GBK / Windows-1252 file yields readable text plus a
 * list of candidate encodings and `ambiguous: true` so the UI can confirm.
 * @returns {{ text: string, encoding: string, bomLength: number,
 *             candidates: Array<{encoding: string, definite: boolean}>,
 *             ambiguous: boolean, definite: boolean }}
 */
export function decodeWithCandidates(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const bom = detectEncoding(b); // throws for BOM-less UTF-16 (handled by callers)
  const body = b.subarray(bom.bomLength);

  // A byte-order mark is an explicit, authoritative encoding declaration.
  if (bom.encoding !== 'utf-8') {
    try {
      const text = new TextDecoder(bom.encoding, { fatal: true }).decode(body);
      return {
        text, encoding: bom.encoding, bomLength: bom.bomLength,
        candidates: [{ encoding: bom.encoding, definite: true }],
        ambiguous: false, definite: true,
      };
    } catch (_) { /* fall through to candidate scan */ }
  }

  // Strict UTF-8: the overwhelmingly common case, authoritative when valid.
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    return {
      text, encoding: 'utf-8', bomLength: bom.bomLength,
      candidates: [{ encoding: 'utf-8', definite: true }],
      ambiguous: false, definite: true,
    };
  } catch (_) { /* not valid UTF-8 — keep scanning */ }

  // Legacy single-byte encodings: GBK / Windows-1252.
  const candidates = [];
  for (const label of CANDIDATE_ENCODINGS) {
    try {
      new TextDecoder(label, { fatal: true }).decode(body);
      candidates.push({ encoding: label, definite: true });
    } catch (_) { /* this label cannot represent the bytes */ }
  }
  if (candidates.length) {
    const chosen = candidates[0];
    const text = new TextDecoder(chosen.encoding, { fatal: false }).decode(body);
    return {
      text, encoding: chosen.encoding, bomLength: bom.bomLength,
      candidates, ambiguous: candidates.length > 1, definite: false,
    };
  }

  // Nothing could decode it. Be honest: a hard error, not silent mojibake.
  throw new Error(decodeErrorMessage('utf-8'));
}

/**
 * Decode a COMPLETE byte buffer to text (used by the non-Worker fallback).
 * A GBK / Windows-1252 file now decodes instead of throwing; only genuinely
 * undecodable bytes (or a BOM-less UTF-16 stream) raise a clear error.
 * @returns {{text: string, encoding: string, bomLength: number}}
 */
export function decodeBytes(bytes) {
  const r = decodeWithCandidates(bytes);
  return {
    text: r.text, encoding: r.encoding, bomLength: r.bomLength,
    candidates: r.candidates, ambiguous: r.ambiguous, definite: r.definite,
  };
}

/**
 * Streaming byte -> text decoder for the Worker. Buffers the first few bytes
 * until a BOM decision is possible, decodes incrementally, keeps UTF-16 on
 * even code-unit boundaries, and sniffs the delimiter from the first text.
 */
export class ByteDecoder {
  constructor() {
    this.hint = null;
    this.decoder = null;
    this.head = null;       // initial bytes held until BOM resolution
    this.isUTF16 = false;
    this.carry = null;      // single residual byte for UTF-16 alignment
    this.delimiter = ',';
    this._sniffed = false;
    this.forced = null;     // user-overridden encoding (confirmed at import)
  }

  /** Force a specific encoding (the user picked it in the import preview). */
  forceEncoding(label) { this.forced = label; }

  _absorb(text) {
    if (!this._sniffed && text) {
      this.delimiter = sniffDelimiter(text);
      this._sniffed = true;
    }
    return text;
  }

  _decode(input, stream) {
    if (this.isUTF16) {
      if (this.carry !== null) {
        const merged = new Uint8Array(1 + input.length);
        merged[0] = this.carry;
        merged.set(input, 1);
        input = merged;
        this.carry = null;
      }
      if (input.length % 2 !== 0) {
        this.carry = input[input.length - 1];
        input = input.subarray(0, input.length - 1);
      }
    }
    try {
      return this.decoder.decode(input, stream ? { stream: true } : undefined);
    } catch (_) {
      throw new Error(decodeErrorMessage(this.hint.encoding));
    }
  }

  _init(head) {
    if (this.forced) {
      this.hint = { encoding: this.forced, bomLength: 0 };
    } else {
      this.hint = detectEncoding(head);
    }
    this.decoder = createDecoder(this.hint.encoding);
    this.isUTF16 = this.hint.encoding !== 'utf-8';
    return head.subarray(this.hint.bomLength);
  }

  /** Feed one raw byte chunk, return the text decoded so far. */
  push(bytes) {
    const chunk = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (this.hint === null) {
      if (this.head === null) this.head = chunk;
      else {
        const merged = new Uint8Array(this.head.length + chunk.length);
        merged.set(this.head, 0);
        merged.set(chunk, this.head.length);
        this.head = merged;
      }
      if (this.head.length < 3) return '';    // need >= 3 bytes to rule on a BOM
      const body = this._init(this.head);
      this.head = null;
      return this._absorb(this._decode(body, true));
    }
    return this._absorb(this._decode(chunk, true));
  }

  /** Flush the decoder and any residual byte, return remaining text. */
  end() {
    let out = '';
    if (this.hint === null) {
      const head = this.head || new Uint8Array(0);
      this.head = null;
      const body = this._init(head);
      out = this._absorb(this._decode(body, true));
    }
    let tail = '';
    if (this.isUTF16 && this.carry !== null) {
      try { tail = this.decoder.decode(new Uint8Array([this.carry]), { stream: true }); }
      catch (_) { throw new Error(decodeErrorMessage(this.hint.encoding)); }
      this.carry = null;
    }
    try { tail += this.decoder.decode(); }
    catch (_) { throw new Error(decodeErrorMessage(this.hint.encoding)); }
    return out + tail;
  }
}

// ---------------------------------------------------------------------------
// Import warnings (shared by the Worker and the non-Worker fallback)
// ---------------------------------------------------------------------------

/**
 * Build user-facing warnings from parse metadata. Pure.
 * A plain comma / UTF-8 / no-BOM / no-extra-column file yields [] so the
 * common case stays quiet. Each entry is surfaced by the shell as a toast.
 */
export function importWarnings({ delimiter = ',', encoding = 'utf-8', bomLength = 0, extraRows = 0 } = {}) {
  const out = [];
  if (delimiter !== ',') {
    out.push(`Detected ${JSON.stringify(delimiter)} as the column delimiter (not a comma). Verify the columns split correctly.`);
  }
  if (encoding !== 'utf-8') {
    out.push(`Decoded from ${encoding.toUpperCase()} using the file BOM.`);
  }
  if (bomLength > 0) {
    out.push('A byte-order mark was detected and stripped.');
  }
  if (extraRows > 0) {
    out.push(`${extraRows} row(s) had more fields than the header; the extra values were kept in __extra`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Header / skip-row detection + preview parsing (M1 import gate)
// ---------------------------------------------------------------------------

const SLASH_DATE_RE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;
export { SLASH_DATE_RE };

/**
 * Decide which line is the header and how many leading lines to skip.
 * Conservative: default to the first non-blank line as the header and skip
 * only blank lines before it. Only when a leading block has a different column
 * count than the dominant count do we treat it as a preamble (title / notes)
 * and skip past it. Pure.
 * @returns {{headerRow: number, skipRows: number, fieldCount: number, preamble: number[]}}
 */
export function detectHeaderAndSkip(text, delimiter = ',', maxLines = 40) {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const nonBlank = [];
  for (let i = 0; i < lines.length && nonBlank.length < maxLines; i++) {
    if (lines[i].trim() !== '') nonBlank.push({ index: i, line: lines[i] });
  }
  if (!nonBlank.length) return { headerRow: 0, skipRows: 0, fieldCount: 0, preamble: [] };

  const countFields = (ln) => ln.split(delimiter).length + (ln.trim().endsWith(delimiter) ? 1 : 0);
  const counts = nonBlank.map((r) => countFields(r.line));
  const freq = {};
  for (const c of counts) freq[c] = (freq[c] || 0) + 1;
  const dominant = Object.keys(freq).map(Number).sort((a, b) => freq[b] - freq[a] || a - b)[0];

  // Header = first non-blank line whose column count matches the dominant shape
  // AND that looks textual (a row of pure numbers is data, not a header).
  let headerIdx = -1;
  for (let i = 0; i < nonBlank.length; i++) {
    if (counts[i] !== dominant) continue;
    const tokens = nonBlank[i].line.split(delimiter).map((t) => t.trim());
    const looksHeader = tokens.some((t) => /[A-Za-z_]/i.test(t) && !/^-?\d+(\.\d+)?$/.test(t));
    if (looksHeader) { headerIdx = i; break; }
  }
  if (headerIdx === -1) headerIdx = 0;

  return {
    headerRow: nonBlank[headerIdx].index,
    skipRows: nonBlank[headerIdx].index,
    fieldCount: dominant,
    preamble: nonBlank.slice(0, headerIdx).map((r) => r.index),
  };
}

/**
 * Parse just the head of a CSV into raw records (NO cleansing) for the import
 * preview. Honest: the user sees the source values exactly, before any rule
 * rewrites them. Keeps __extra for over-long rows.
 * @returns {{header: string[], fields: string[], rows: object[]}}
 */
export function parsePreview(text, { delimiter = ',', headerRow = 0, skipRows = 0, maxRows = 20 } = {}) {
  const all = parseCSVText(text, { delimiter });
  const data = all.slice(skipRows);
  const header = (data[0] || []).map(String);
  const fields = header.map((h, i) => sanitizeField(h, i));
  const rows = [];
  for (let i = 1; i < data.length && rows.length < maxRows; i++) {
    const r = data[i];
    const rec = { id: i };
    for (let k = 0; k < fields.length; k++) rec[fields[k]] = r[k] ?? '';
    if (r.length > fields.length) rec.__extra = r.slice(fields.length);
    rows.push(rec);
  }
  return { header, fields, rows };
}

/**
 * Count slash-dates where BOTH parts are <= 12 — those cannot be resolved
 * without asking the user (05/01/2024 could be May 1 or Jan 5). Pure.
 * @returns {{count: number, sample: string|null}}
 */
export function countAmbiguousDates(values) {
  let count = 0;
  let sample = null;
  for (const v of values) {
    const m = SLASH_DATE_RE.exec(String(v ?? '').trim());
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a <= 12 && b <= 12) { count++; if (sample === null) sample = String(v).trim(); }
  }
  return { count, sample };
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

export class CSVParser {
  constructor(opts = {}) {
    this.delimiter = opts.delimiter || ',';
    this.field = '';
    this.row = [];
    this.quoted = false;
    this.pendingQuote = false;
    this.pendingCR = false;
  }

  /** Feed one chunk, return the rows completed within this chunk. */
  push(chunk) {
    const out = [];
    for (let i = 0; i < chunk.length; i++) {
      let ch = chunk[i];

      if (this.pendingQuote) {
        this.pendingQuote = false;
        if (ch === '"') { this.field += '"'; continue; } // escaped ""
        this.quoted = false;                              // closing quote
        // fall through: reprocess this character in unquoted mode
      }
      if (this.pendingCR) {
        this.pendingCR = false;
        if (ch === '\n') continue; // swallow LF of a CRLF pair
        // fall through
      }

      if (this.quoted) {
        if (ch === '"') { this.pendingQuote = true; continue; }
        this.field += ch;
        continue;
      }
      if (ch === '"' && this.field === '') { this.quoted = true; continue; }
      if (ch === this.delimiter) { this.row.push(this.field); this.field = ''; continue; }
      if (ch === '\r' || ch === '\n') {
        this.row.push(this.field);
        this.field = '';
        out.push(this.row);
        this.row = [];
        if (ch === '\r') this.pendingCR = true;
        continue;
      }
      this.field += ch;
    }
    return out;
  }

  /** Flush the last (possibly unterminated) field and row. */
  end() {
    if (this.pendingQuote) { this.quoted = false; this.pendingQuote = false; }
    this.pendingCR = false;
    const rows = [];
    if (this.field !== '' || this.row.length) {
      this.row.push(this.field);
      rows.push(this.row);
      this.field = '';
      this.row = [];
    }
    return rows;
  }
}

/** Parse a complete CSV string (small files, tests, examples). */
export function parseCSVText(text, opts = {}) {
  const clean = String(text ?? '').replace(/^\uFEFF/, '');
  const delimiter = opts.delimiter != null ? opts.delimiter : sniffDelimiter(clean);
  const p = new CSVParser({ delimiter });
  const rows = p.push(clean);
  return rows.concat(p.end());
}

// ---------------------------------------------------------------------------
// CSV writing
// ---------------------------------------------------------------------------

// Spreadsheet apps evaluate cells that begin with a formula marker. Prefix
// those with an apostrophe so the value is stored as text. A leading '-' is a
// real negative number only when followed by a digit or a decimal point.
function needsFormulaGuard(s) {
  const body = s.replace(/^[ \t]+/, '');
  if (!body) return false;
  const first = body[0];
  if (first === '=' || first === '+' || first === '@') return true;
  if (first === '-') return !/[\d.]/.test(body[1] || '');
  return false;
}

function escapeCell(value) {
  let s = value == null ? '' : String(value);
  if (needsFormulaGuard(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// Excel stores at most 15 significant digits; anything longer is rendered in
// scientific notation and the low digits are lost. A leading zero likewise
// disappears the moment Excel reads the cell as a number. For text columns we
// emit the value as a string formula ="…" so Excel keeps the EXACT characters.
// Final Polish, point five.
function isLongNumberOrLeadingZero(s) {
  const t = s.trim();
  return /^\d{16,}$/.test(t) || /^0\d/.test(t);
}

function buildCell(value, col) {
  let s = value == null ? '' : String(value);
  if (col && col.type === 'text' && isLongNumberOrLeadingZero(s)) {
    // Already a safe text formula — return as-is so escapeCell's guard does
    // not add a second apostrophe.
    return '="' + s.replace(/"/g, '""') + '"';
  }
  return escapeCell(s);
}

/** @returns {string} CSV text with a UTF-8 BOM (Excel-safe) and CRLF endings. */
export function buildCSV(rows, columns) {
  const lines = [columns.map((c) => escapeCell(c.header != null ? c.header : c.field)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => buildCell(r[c.field], c)).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

/** Trigger a client-side download of any Blob. No network involved. */
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCSV(filename, rows, columns) {
  downloadBlob(filename, new Blob([buildCSV(rows, columns)], { type: 'text/csv;charset=utf-8' }));
}

export function downloadText(filename, text, type = 'text/plain;charset=utf-8') {
  downloadBlob(filename, new Blob([text], { type }));
}
