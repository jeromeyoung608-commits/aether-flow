// io/desensitize.js — optional privacy-safe export (Final Polish, point one).
//
// Masks the values in PII-looking columns so the user can share a CSV without
// leaking identities. Pure: returns NEW row objects, never mutates the input.
// Column-level only — a value is masked when its COLUMN header matches a PII
// hint. This is the "desensitization export" in the Export dropdown.

const PII_HINTS = [
  'email', 'mail', 'e-mail', 'phone', 'tel', 'mobile', 'cell',
  'ssn', 'social', 'account', 'acct', 'iban', 'swift', 'card', 'passport',
  'name', 'address', 'street', 'city', 'zip', 'postal', 'dob', 'birth',
];

function isPiiColumn(c) {
  const h = (c.header || c.field || '').toLowerCase();
  return PII_HINTS.some((k) => h.includes(k));
}

function mask(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return s;
  if (s.includes('@')) {
    const [local, domain] = s.split('@');
    if (!domain) return s;
    const head = local.slice(0, 2);
    const stars = '*'.repeat(Math.max(1, local.length - 2));
    return `${head}${stars}@${domain}`;
  }
  if (/^\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}$/.test(s)) {
    return `**** **** **** ${s.replace(/\s|-/g, '').slice(-4)}`;
  }
  if (s.length > 4) return `${'*'.repeat(Math.min(s.length, 10))}${s.slice(-2)}`;
  if (s.length > 0) return '*'.repeat(s.length);
  return s;
}

/**
 * Return a copy of `rows` with PII-column values masked.
 * @param {Array<object>} rows
 * @param {Array<object>} columns
 * @returns {Array<object>} new rows
 */
export function desensitizeRows(rows = [], columns = []) {
  const pii = new Set(columns.filter(isPiiColumn).map((c) => c.field));
  return rows.map((r) => {
    const out = { ...r };
    for (const f of pii) out[f] = mask(r ? r[f] : undefined);
    return out;
  });
}

/** Which columns would be masked (for UI hints). */
export function piiColumns(columns = []) {
  return columns.filter(isPiiColumn);
}
