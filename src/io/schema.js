// schema.js — column inference + the built-in validation rule registry.
//
// Pure module (no DOM, no Worker APIs): imported by the main thread, by the CSV
// parsing Worker, and by the Node test suite. New rules can be registered at
// runtime through the SDK: `AetherFlow.validators.register('sku', fn)`.

// A resolver can be attached by the SDK so externally registered rule names
// work exactly like built-ins. Keeps this module pure and dependency-free.
let externalResolver = null;
export function setValidatorResolver(fn) { externalResolver = fn; }

export const VALIDATORS = {
  required: (v) => (v != null && String(v).trim() !== '') || 'Required',
  number: (v) => (v === '' || v == null || Number.isFinite(Number(String(v).replace(/,/g, '')))) || 'Must be a number',
  integer: (v) => (v === '' || v == null || /^-?\d+$/.test(String(v).trim())) || 'Must be an integer',
  percent: (v) => (v === '' || (Number(v) >= 0 && Number(v) <= 100)) || 'Must be 0–100',
  email: (v) => (v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) || 'Invalid email',
  isoDate: (v) => (v === '' || /^\d{4}-\d{2}-\d{2}$/.test(String(v))) || 'Use YYYY-MM-DD',
  maxLength: (v) => (v == null || String(v).length <= 120) || 'Too long (120 max)',
};

/**
 * Run one or more validators.
 * @param {Function|string|Array<Function|string>} validate column rule(s)
 * @param {*} value
 * @param {object} [row]
 * @returns {string|null} error message, or null when valid
 */
export function runValidator(validate, value, row) {
  if (!validate) return null;
  const rules = Array.isArray(validate) ? validate : [validate];
  for (const rule of rules) {
    const fn = typeof rule === 'function' ? rule
      : (VALIDATORS[rule] || (externalResolver ? externalResolver(rule) : null));
    if (!fn) continue; // unknown named rule -> SDK consumer may register it later
    const result = fn(value, row);
    if (result !== true && result != null) return typeof result === 'string' ? result : 'Invalid value';
  }
  return null;
}

const NUM_RE = /^-?\d+(\.\d+)?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLASH_DATE_RE = /^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/;

/** Currency symbols and thousand separators must not hide a numeric column. */
function numericCandidate(value) {
  return NUM_RE.test(String(value).trim().replace(/[$€£¥,\s]/g, ''));
}
function dateCandidate(value) {
  const s = String(value).trim();
  return ISO_DATE_RE.test(s) || SLASH_DATE_RE.test(s);
}

/** Infer a column type from a sample of values. */
export function inferType(values) {
  const sample = values.filter((v) => v != null && String(v).trim() !== '').slice(0, 200);
  if (!sample.length) return 'text';
  if (sample.every(numericCandidate)) return 'number';
  if (sample.every(dateCandidate)) return 'date';
  return 'text';
}

/** Turn a raw header cell into a safe, unique field name. */
export function sanitizeField(label, index) {
  let s = String(label ?? '').replace(/^\uFEFF/, '').trim().toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!s || /^\d/.test(s)) s = `col_${index + 1}`;
  return s;
}

/** Default rule for an inferred type. */
export function defaultValidator(type) {
  if (type === 'number') return 'number';
  if (type === 'date') return 'isoDate';
  return null;
}

// Headers that name an identifier / account column. Such columns must stay TEXT
// even when every sample value is numeric, otherwise a 16-digit account number
// becomes a float (scientific notation) and "001234" loses its leading zeros.
// Final Polish, point five.
const ID_HEADER_RE = /(^|[^a-z])(id|account|acct|iban|swift|ssn|social|employee|employe|customer|client|order|invoice|phone|tel|mobile|zip|postal|card|passport|reference|ref|member|policy|no|number|num|code)([^a-z]|$)/i;

export function isIdentifierHeader(label) {
  return ID_HEADER_RE.test(String(label || ''));
}

/**
 * Build column definitions from a CSV header + sample rows.
 * A trailing `*` in the header marks the column as required.
 */
export function buildColumns(header, sampleRows = []) {
  const seen = new Map();
  const fields = header.map((label, i) => {
    const base = sanitizeField(label, i);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return { field: n === 1 ? base : `${base}_${n}`, label: String(label).replace(/^\uFEFF/, '').replace(/\*$/, '').trim() || base };
  });
  return fields.map(({ field, label }, i) => {
    let type = inferType(sampleRows.map((r) => r[i]));
    // Force identifier/account columns to text so import never coerces a long
    // id or a leading-zero code into a lossy number.
    if (type === 'number' && isIdentifierHeader(label)) type = 'text';
    const required = /\*\s*$/.test(String(header[i] ?? ''));
    const validate = [required ? 'required' : null, defaultValidator(type)].filter(Boolean);
    return {
      field,
      header: label + (required ? ' *' : ''),
      type,
      width: Math.min(280, Math.max(96, label.length * 8 + 42)),
      align: type === 'number' ? 'right' : 'left',
      sortable: true, resizable: true, filterable: true, editable: true,
      validate: validate.length ? validate : null,
    };
  });
}
