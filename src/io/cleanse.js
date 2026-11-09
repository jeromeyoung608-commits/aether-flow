// cleanse.js — lightweight data cleansing applied BEFORE rows hit IndexedDB.
//
// Zero dependencies, pure functions. Rules are declarative strings so a
// customer can override them from `customers/<name>/` without touching core.
//
// Import defaults to the single reversible rule (`trim`). Anything that can
// silently rewrite meaning (flattening newlines in notes, stripping currency
// symbols or thousands separators) is opt-in via FULL_RULES, used only by the
// explicit "Clean data" command. This matters for audit / diligence datasets.

export const CLEANSE_RULES = {
  trim: (v) => String(v ?? '').trim(),
  collapse: (v) => String(v ?? '').replace(/\s+/g, ' '),
  lower: (v) => String(v ?? '').toLowerCase(),
  upper: (v) => String(v ?? '').toUpperCase(),
  title: (v) => String(v ?? '').replace(/\b\w/g, (c) => c.toUpperCase()),
  // Normalize common date spellings to ISO by assembling the parts by hand —
  // never build a Date object, which would shift a day in UTC-minus timezones.
  // Unknown formats pass through untouched.
  //
  // `order` is the user's explicit choice ('dmy' | 'mdy'). When a slash date is
  // AMBIGUOUS (both parts <= 12) and no order was given, we return the string
  // UNCHANGED — we never silently guess. The caller flags it instead.
  isoDate: (v, order) => {
    const s = String(v ?? '').trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = /^(\d{1,2})([/-])(\d{1,2})\2(\d{4})$/.exec(s);
    if (!m) return s;
    const a = Number(m[1]);
    const b = Number(m[3]);
    const year = m[4];
    let month, day;
    if (order === 'dmy') { day = a; month = b; }
    else if (order === 'mdy') { month = a; day = b; }
    else if (a > 12 && b <= 12) { day = a; month = b; }        // D-M-YYYY (unambiguous)
    else if (b > 12 && a <= 12) { month = a; day = b; }        // M-D-YYYY (unambiguous)
    else return s;                                             // ambiguous AND no order -> do NOT guess
    if (month < 1 || month > 12 || day < 1 || day > 31) return s;
    const pad = (n) => String(n).padStart(2, '0');
    return `${year}-${pad(month)}-${pad(day)}`;
  },
  // Only applied to numeric columns: strip currency symbols and separators.
  number: (v) => {
    const s = String(v ?? '').trim();
    if (!s) return '';
    const cleaned = s.replace(/[$€£¥\s,]/g, '');
    return /^-?\d+(\.\d+)?$/.test(cleaned) ? cleaned : s;
  },
};

/** The only rule that is safe to apply on every import. */
export const DEFAULT_RULES = ['trim'];

/** Aggressive, irreversible rules — used ONLY by the explicit "Clean data" command. */
export const FULL_RULES = ['trim', 'collapse', 'isoDate', 'number'];

/**
 * Clean a single value. `type` guards the numeric rule so text containing
 * commas/commas-like symbols is never mangled. `order` (per-field date order)
 * is forwarded only to isoDate.
 */
export function cleanValue(value, rules = DEFAULT_RULES, type = 'text', order) {
  let out = value;
  for (const name of rules) {
    const fn = CLEANSE_RULES[name];
    if (!fn) continue;
    if (name === 'number' && type !== 'number' && type !== 'currency') continue;
    if (name === 'isoDate' && type !== 'date') continue;
    out = fn(out, name === 'isoDate' ? order : undefined);
  }
  return out;
}

/** Clean a whole record object in place (returns the same object). */
export function cleanseRow(row, rules = DEFAULT_RULES, typeOf = {}, fields = Object.keys(row), order = {}) {
  for (const f of fields) row[f] = cleanValue(row[f], rules, typeOf[f] || 'text', order[f]);
  return row;
}

/**
 * Re-clean an existing in-memory set of rows (used by the Cmd+K "Clean data"
 * command). Returns the number of cells actually changed.
 */
export function recleanRows(rows, rules = DEFAULT_RULES, typeOf = {}, fields = [], order = {}) {
  let changed = 0;
  for (const r of rows) {
    for (const f of fields) {
      const before = r[f];
      const after = cleanValue(before, rules, typeOf[f] || 'text', order[f]);
      if (after !== before) { r[f] = after; changed++; }
    }
  }
  return changed;
}

/**
 * Apply an explicit date order to the date-typed columns of parsed rows
 * (used by the import gate after the user resolves ambiguous dates).
 * Returns the number of cells changed. Never guesses — only the columns the
 * user chose are touched.
 */
export function applyDateOrder(rows, columns, order = {}) {
  const dateFields = (columns || [])
    .filter((c) => c.type === 'date' && order[c.field])
    .map((c) => c.field);
  let changed = 0;
  for (const r of rows) {
    for (const f of dateFields) {
      const before = r[f];
      const after = CLEANSE_RULES.isoDate(before, order[f]);
      if (after !== before) { r[f] = after; changed++; }
    }
  }
  return changed;
}

/**
 * Non-mutating count of how many date-typed cells WOULD change under the given
 * per-field order. Used by BYOK's preview so the user sees impact before apply.
 */
export function previewDateOrder(rows, columns, order = {}) {
  const dateFields = (columns || [])
    .filter((c) => c.type === 'date' && order[c.field])
    .map((c) => c.field);
  let changed = 0;
  for (const r of rows) {
    for (const f of dateFields) {
      const before = r[f];
      const after = CLEANSE_RULES.isoDate(before, order[f]);
      if (after !== before) changed++;
    }
  }
  return changed;
}

/**
 * Non-mutating preview of a cleanse pass (module F). Returns the cells that
 * WOULD change and their before/after values, so the UI can show impact before
 * anything is written. Does not touch `rows`.
 * @returns {Array<{id:string|number, field:string, before:*, after:*}>}
 */
export function previewCleanse(rows, rules = DEFAULT_RULES, typeOf = {}, fields = []) {
  const cols = fields.length ? fields : Object.keys(typeOf);
  const changes = [];
  for (const r of rows) {
    for (const f of cols) {
      const before = r[f];
      const after = cleanValue(before, rules, typeOf[f] || 'text');
      if (after !== before) changes.push({ id: r.id, field: f, before, after });
    }
  }
  return changes;
}
