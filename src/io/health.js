// io/health.js - local, zero-dependency Data Health Report engine (M1, module B).
//
// Scans the in-memory rows and reports problems WITHOUT ever changing them.
// Six base checks, per the product spec:
//   1. Missing rate          - null / empty / whitespace-only cells per column.
//   2. Type anomaly          - values that do not match the column's expected type.
//   3. Duplicate rows        - fully identical rows (the 'id' column excluded).
//   4. Leading/trailing ws   - cells carrying stray whitespace.
//   5. Date format mix       - a date column holding more than one format pattern.
//   6. Numeric/ID corruption - scientific notation or leading-zero loss in
//      identifier columns (these CANNOT be recovered, so they are Unresolved).
//
// Every finding carries a 'kind' ('fixable' | 'unresolved' | 'info') and, for
// fixable ones, a 'preset' ({ rules, fields, dateOrder }) the UI can hand to
// the local rule engine through a dry-run preview before any write happens.

export const SEVERITY = { HIGH: 'High', MEDIUM: 'Medium', INFO: 'Info' };

const ID_HINT = /(^|[^a-z])(id|code|zip|postal|phone|tel|mobile|account|acct|ssn|iban|swift)([^a-z]|$)/i;
const SCI_RE = /[eE][+-]?\d+/;
const NUM_ONLY_RE = /^\d+$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLASH_DATE_RE = /^(\d{1,2})([/-])(\d{1,2})\2(\d{4})$/;
const NUM_RE = /^-?\d+(\.\d+)?$/;
const WS_RE = /^\s|\s$/;

function isDataColumn(c) {
  return c && c.field && c.field !== '__sel' && c.type !== 'check';
}

function pushFinding(findings, f) {
  findings.push(f);
}

/**
 * Pure, single-pass health scan. Never mutates `rows`.
 * @param {Array<object>} rows  rows with an `id` field
 * @param {Array<object>} columns  column defs ({ field, type, header })
 * @returns {Array<object>} findings, sorted High -> Medium -> Info by affected rows
 */
export function analyzeHealth(rows, columns = []) {
  const findings = [];
  const dataCols = columns.filter(isDataColumn);
  const n = rows.length;

  for (const col of dataCols) {
    const f = col.field;
    let missing = 0;
    let typeBad = 0;
    let ws = 0;
    const datePatterns = new Set();
    const wsIds = [];
    const typeBadIds = [];

    for (const r of rows) {
      const raw = r ? r[f] : undefined;
      const s = raw == null ? '' : String(raw);
      const trimmed = s.trim();
      if (trimmed === '') { missing++; continue; }
      if (WS_RE.test(s)) { ws++; wsIds.push(r.id); }
      if (col.type === 'number' || col.type === 'currency') {
        if (!NUM_RE.test(trimmed)) { typeBad++; typeBadIds.push(r.id); }
      } else if (col.type === 'date') {
        if (ISO_RE.test(trimmed)) datePatterns.add('iso');
        else if (SLASH_DATE_RE.test(trimmed)) datePatterns.add('slash');
        else datePatterns.add('other');
      }
    }

    const name = col.header || f;
    if (missing > 0) {
      const ratio = missing / Math.max(1, n);
      const ids = [];
      for (const r of rows) {
        const v = r ? r[f] : undefined;
        if ((v == null ? '' : String(v).trim()) === '') ids.push(r.id);
      }
      pushFinding(findings, {
        category: 'Missing values', field: f, fieldName: name,
        affectedRows: missing, severity: ratio > 0.2 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
        kind: 'unresolved', suggestion: ratio > 0.2
          ? 'High missing rate - review or fill before analysis'
          : 'Review missing values', preset: null, ids,
      });
    }
    if (ws > 0) {
      pushFinding(findings, {
        category: 'Leading/trailing whitespace', field: f, fieldName: name,
        affectedRows: ws, severity: SEVERITY.MEDIUM, kind: 'fixable',
        suggestion: 'Apply Trim and collapse whitespace',
        preset: { rules: ['trim', 'collapse'], fields: [f] }, ids: wsIds,
      });
    }
    if (typeBad > 0) {
      const rule = (col.type === 'number' || col.type === 'currency') ? ['number'] : ['isoDate'];
      const suggestion = col.type === 'date' ? 'Standardize dates to ISO' : 'Extract numeric values';
      pushFinding(findings, {
        category: 'Type mismatch', field: f, fieldName: name,
        affectedRows: typeBad, severity: SEVERITY.MEDIUM, kind: 'fixable',
        suggestion, preset: { rules: rule, fields: [f] }, ids: typeBadIds,
      });
    }
    if (col.type === 'date' && datePatterns.size > 1) {
      pushFinding(findings, {
        category: 'Date format mix', field: f, fieldName: name,
        affectedRows: n, severity: SEVERITY.MEDIUM, kind: 'fixable',
        suggestion: 'Standardize dates to ISO', preset: { rules: ['isoDate'], fields: [f] }, ids: [],
      });
    }
    if (col.type === 'text' && ID_HINT.test(f)) {
      let sci = 0;
      const sciIds = [];
      for (const r of rows) {
        const raw = r ? r[f] : undefined;
        const s = (raw == null ? '' : String(raw)).trim();
        if (SCI_RE.test(s) || (NUM_ONLY_RE.test(s) && s.length > 4)) { sci++; sciIds.push(r.id); }
      }
      if (sci > 0) {
        pushFinding(findings, {
          category: 'Numeric/ID corruption (scientific)', field: f, fieldName: name,
          affectedRows: sci, severity: SEVERITY.HIGH, kind: 'unresolved',
          suggestion: 'Leading zeros / scientific notation cannot be recovered - flag for manual review',
          preset: null, ids: sciIds,
        });
      }
    }
  }

  // Duplicate rows: identical across data columns, the synthetic 'id' key excluded.
  if (n > 1) {
    const seen = new Map();
    const dupIds = [];
    for (const r of rows) {
      const key = dataCols
        .filter((c) => c.field !== 'id')
        .map((c) => { const v = r ? r[c.field] : undefined; return v == null ? '' : String(v); })
        .join(String.fromCharCode(1));
      if (!key) continue; // skip fully-empty rows
      if (seen.has(key)) dupIds.push(r.id);
      else seen.set(key, true);
    }
    if (dupIds.length > 0) {
      pushFinding(findings, {
        category: 'Duplicate rows', field: null, fieldName: null,
        affectedRows: dupIds.length, severity: SEVERITY.HIGH, kind: 'unresolved',
        suggestion: 'Exact duplicate rows detected - flag for review (not auto-deleted)',
        preset: null, ids: dupIds,
      });
    }
  }

  const order = { High: 0, Medium: 1, Info: 2 };
  findings.sort((a, b) => (order[a.severity] - order[b.severity]) || (b.affectedRows - a.affectedRows));
  return findings;
}

/**
 * Count findings that are Unresolved (cannot be auto-fixed) - drives the Brief
 * warning and the IssueList count.
 * @param {Array<object>} findings
 * @returns {number} distinct row ids touched by unresolved findings
 */
export function unresolvedRowCount(findings) {
  const ids = new Set();
  for (const f of findings) if (f.kind === 'unresolved') for (const id of f.ids || []) ids.add(id);
  return ids.size;
}
