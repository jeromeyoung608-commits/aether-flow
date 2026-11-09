// io/rule-packs.js - the Rule Pack loader + grading engine (M3 / Final Polish).
//
// The rule packs themselves live as Markdown in rules/ and are compiled to the
// static, dependency-free src/io/rules-bundle.js by scripts/build-rules.mjs.
// This module consumes that bundle and runs it against the in-memory rows,
// fully offline (no fetch, no network - it satisfies the audit gate).
//
// Two-layer matching, exactly as specified:
//   1. Global ruler selection  - a region/industry pack is active ONLY when the
//      user explicitly opts in (dropdown). Header-keyword inference may
//      *suggest* one, but it is never auto-applied (us.md §1, "region: US must
//      be declared explicitly"; README §3 "Regional rules are not applied by default").
//      This is deliberate: spraying a published standard (SSN/EIN/ZIP/...) across
//      every column that merely looks like it is how false positives are born,
//      and how unrelated 9-digit identifiers get rewritten into SSN form.
//   2. Column-level matching    - once the global pack(s) are active, each
//      field rule is applied only to columns whose header matches. A region
//      pack never sprays every row.
//
// Strict three-state grading:
//   severity: info    -> safe rewrite, one-click apply (Fixable).
//   severity: warning -> show Diff and require Approve (Fixable, needs confirm).
//   severity: error   -> never auto-change; flag red as Unresolved.
//   evidence: low     -> overrides everything: Unresolved, "verify manually".

import { RULES_BUNDLE } from './rules-bundle.js';

export { RULES_BUNDLE };

const FORM_FIELD_IDS = [
  'form.email', 'form.phone', 'form.date-time', 'form.numbers-text', 'form.enums-currency',
];

// Dropdown choices exposed in the Data Health Report panel. General = the five
// universal form-field packs only. Every region / industry pack that is actually
// compiled into the bundle is listed here, so the moat is complete: a user can
// explicitly opt into any published standard. Order: General, then regions, then
// industries.
export const PACK_OPTIONS = [
  { id: 'General', label: 'Standard: General' },
  { id: 'region.us', label: 'US' },
  { id: 'region.eu', label: 'EU' },
  { id: 'region.gb', label: 'UK' },
  { id: 'region.cn', label: 'CN' },
  { id: 'region.intl', label: 'International' },
  { id: 'industry.finance', label: 'Finance' },
  { id: 'industry.healthcare', label: 'Healthcare' },
  { id: 'industry.logistics', label: 'Logistics' },
  { id: 'industry.retail', label: 'Retail / GS1' },
  { id: 'industry.auto-legal', label: 'Automotive / Legal' },
];

// Header-keyword inference map (layer 1). Ordered: first match wins.
const INFERENCE = [
  { id: 'industry.finance', label: 'Finance Pack', keywords: ['iban', 'swift', 'vat', 'debit', 'credit', 'isin', 'cusip', 'bic'] },
  { id: 'industry.healthcare', label: 'Healthcare Pack', keywords: ['patient', 'diagnosis', 'icd', 'medical', 'clinic', 'hospital'] },
  { id: 'region.us', label: 'US Region', keywords: ['ssn', 'social', 'zip', 'state', 'ein', 'tax', 'routing', 'aba', 'itin'] },
  { id: 'region.gb', label: 'UK Region', keywords: ['nino', 'sort code', 'sort', 'utr', 'postcode'] },
];

// ---- pack accessors --------------------------------------------------------

export function getPackIndex() {
  return RULES_BUNDLE.map((p) => ({
    id: p.id, label: p.label, kind: p.kind, severity: p.severity, evidence: p.evidence, scope: p.scope,
  }));
}

export function getPack(id) {
  return RULES_BUNDLE.find((p) => p.id === id) || null;
}

export function loadRulesBundle() {
  return RULES_BUNDLE;
}

// ---- layer 1: global selection --------------------------------------------

/** Scan header names for region/industry signals. Returns the best guess. */
export function detectGlobalPack(headers = []) {
  const hay = (headers || []).join(' ').toLowerCase();
  if (!hay.trim()) return null;
  for (const rule of INFERENCE) {
    const hit = rule.keywords.find((k) => hay.includes(k));
    if (hit) return { id: rule.id, label: rule.label, matchedOn: hit };
  }
  return null;
}

/**
 * Resolve the active pack set.
 * @param {{manual?:string, headers?:string[]}} opts
 * @returns {{activePackIds:string[], inferred:object|null, manual:string|null}}
 */
export function selectActivePacks({ manual, headers } = {}) {
  if (manual && manual !== 'General') {
    // Explicit opt-in only: a region / industry pack is active because the user
    // chose it (e.g. "US" in the Data Health Report dropdown). This is the ONLY
    // way a regional standard enters the active set.
    return { activePackIds: [...FORM_FIELD_IDS, manual], inferred: null, manual };
  }
  // Regional / industry packs are NEVER auto-applied. us.md §1 requires an
  // explicit `region: US` declaration; README §3 states "Regional rules are not
  // applied by default." Header-keyword inference may *suggest* a pack, but it
  // is returned only so the UI can prompt the user to enable it — it never
  // enters `activePackIds` on its own. The active set stays General (the five
  // universal form-field packs) until the user explicitly opts in.
  const inferred = detectGlobalPack(headers);
  return { activePackIds: [...FORM_FIELD_IDS], inferred, manual: 'General' };
}

// ---- layer 2: column matching ---------------------------------------------

const EMAIL_RE = /@/;
const NUMERIC_RE = /^-?\d+([.,]\d+)?$/;

function ratio(values, pred) {
  const sample = values.filter((v) => v != null && String(v).trim() !== '').slice(0, 200);
  if (!sample.length) return 0;
  let n = 0;
  for (const v of sample) if (pred(String(v).trim())) n++;
  return n / sample.length;
}

function headerHas(header, hints) {
  const h = (header || '').toLowerCase();
  return hints.some((k) => h.includes(k));
}

// Layer-2 column matching is HEADER-driven first (per spec: "apply form.email only
// when a header reads Email"). Value-profile fallback is only used where it is safe:
// an email column may be named "contact", so an @-ratio is a reliable tell, but
// a phone/number profile would collide with SSN / ID columns and spray false
// positives. Type-based matching is safe because schema inference already typed
// numeric/currency/date columns.
export function matchColumnToPacks(column, activePackIds, rows = []) {
  const result = [];
  const header = column.header || column.field || '';
  const type = column.type || 'text';
  const values = rows.map((r) => r && r[column.field]);

  for (const id of activePackIds) {
    const pack = getPack(id);
    if (!pack) continue;
    let applies = false;
    if (pack.id === 'form.email') applies = headerHas(header, ['email', 'mail', 'e-mail']) || ratio(values, (v) => EMAIL_RE.test(v)) >= 0.8;
    else if (pack.id === 'form.phone') applies = headerHas(header, ['phone', 'tel', 'mobile', 'cell', 'fax']);
    else if (pack.id === 'form.date-time') applies = headerHas(header, ['date', 'time', 'birth', 'created', 'updated', 'datetime']) || type === 'date';
    else if (pack.id === 'form.numbers-text') applies = headerHas(header, ['amount', 'price', 'qty', 'quantity', 'number', 'count', 'balance', 'total']) || type === 'number' || type === 'currency';
    else if (pack.id === 'form.enums-currency') applies = headerHas(header, ['currency', 'status', 'type', 'gender', 'bool', 'enum', 'category', 'rate']) || type === 'currency';
    else applies = headerHas(header, pack.headerHints); // region / industry packs
    if (applies) result.push(id);
  }
  return result;
}

// A region/industry code cell (e.g. "FL", "02134", "123-45-6789") is short and
// mostly alphanumeric. A free-text word like "California" is NOT code-like, so a
// US state column full of full names is not sprayed with false rejections.
function isCodeLike(val) {
  const s = val.replace(/[\s.-]/g, '');
  if (s.length < 2 || s.length > 20) return false;
  if (/[a-zA-Z]/.test(s) && !/\d/.test(s) && s.length > 4) return false; // long pure-alpha = a word
  return /^[\w]+$/.test(s);
}

// ---- normalization (safe rewrite) ------------------------------------------

function normalizeEmail(raw) {
  let s = String(raw).trim();
  s = s.replace(/^[<]/, '').replace(/[>]$/, '');
  s = s.replace(/^mailto:/i, '');
  s = s.replace(/[.,;]+$/, '');
  if (!EMAIL_RE.test(s)) return null;
  const at = s.lastIndexOf('@');
  if (at < 0) return null;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1).toLowerCase();
  const out = `${local}@${domain}`;
  return out === String(raw).trim() ? null : out;
}

function normalizeTrim(raw) {
  const s = String(raw);
  const out = s.replace(/\s+/g, ' ').trim();
  return out === s ? null : out;
}

function normalizeUs(raw) {
  const s = String(raw).replace(/\s+/g, ' ').trim();
  // IMPORTANT: a bare 9-digit string is NOT normalized to an SSN here. "9 digits"
  // is not a SSN discriminator — it also matches order numbers, batch numbers,
  // legacy org codes (exactly 9 digits), invoice numbers, bank-account fragments,
  // ... Applying the SSN shape to every 9-digit column rewrites unrelated
  // identifiers into SSN form, which is silent data destruction (reconciliation
  // breaks, ERP rejects, downstream string matches fail). The only safe,
  // pattern-specific rewrite we keep is a ZIP+4 written with a space
  // ("12345 6789" -> "12345-6789"), which is unambiguously a ZIP and is merely
  // a separator fix — not a semantic rewrite.
  if (/^\d{5} \d{4}$/.test(s)) return s.replace(' ', '-'); // ZIP+4 space -> dash
  if (s === String(raw)) return null; // nothing to trim or normalize
  return s;
}

function normalizeCell(pack, raw) {
  switch (pack.normalize) {
    case 'email': return normalizeEmail(raw);
    case 'us': return normalizeUs(raw);
    default: return normalizeTrim(raw);
  }
}

// ---- grading ---------------------------------------------------------------

/** Map pack metadata to a finding kind. evidence:low always -> unresolved. */
export function triageRuleHit(pack) {
  if (pack.evidence === 'low') return 'unresolved';
  if (pack.severity === 'error') return 'unresolved';
  return 'fixable'; // warning -> approve-diff, info -> one-click
}

function severityLabel(pack) {
  return pack.severity === 'error' ? 'High' : pack.severity === 'warning' ? 'Medium' : 'Info';
}

function buildSuggestion(pack, kind, evidence) {
  if (kind === 'unresolved') {
    if (evidence === 'low') return `Low confidence rule (${pack.id}). Please verify manually. Preserved as-is.`;
    if (pack.severity === 'error') return `Rejected by ${pack.label} (${pack.id}). Never auto-changed - preserved as-is for manual review.`;
    return `Flagged by ${pack.label} (${pack.id}). Preserved as-is for manual review.`;
  }
  if (pack.severity === 'info') return `Safe normalization by ${pack.label}. One-click apply available.`;
  return `Suggested standardization by ${pack.label}. Review the diff before applying.`;
}

function cellValid(pack, val, compiled) {
  if (compiled.length) {
    for (const re of compiled) { try { if (re.test(val)) return true; } catch { /* bad regex */ } }
  }
  if (pack.sets.length) {
    const v = val.toUpperCase().replace(/[\s.-]/g, '');
    if (v.length <= 4) { for (const set of pack.sets) if (set.includes(v)) return true; }
  }
  return false;
}

// ---- the engine ------------------------------------------------------------

/**
 * Run the active rule packs against the rows. Pure: never mutates input.
 * Findings share the health-report shape ({ category, field, fieldName,
 * affectedRows, severity, kind, suggestion, preset, ids }) and additionally
 * carry `pack` ({ id, label }) and, for fixable rows, `preset.fixes`.
 *
 * @param {Array<object>} rows
 * @param {Array<object>} columns
 * @param {string[]} activePackIds
 * @returns {Array<object>} findings
 */
export function runRulePacks(rows, columns, activePackIds) {
  const findings = [];
  const dataCols = columns.filter((c) => c && c.field && c.field !== '__sel' && c.type !== 'check');
  const n = rows.length;

  for (const col of dataCols) {
    const field = col.field;
    const applicable = matchColumnToPacks(col, activePackIds, rows);
    if (!applicable.length) continue;
    const fieldName = col.header || field;

    for (const id of applicable) {
      const pack = getPack(id);
      if (!pack) continue;
      const compiled = pack.regexes.map((r) => { try { return new RegExp(r); } catch { return null; } }).filter(Boolean);
      const isRegionKind = pack.kind === 'region' || pack.kind === 'industry';

      const unresolvedIds = [];
      const fixes = [];
      // A pack with no regex/set cannot "reject" anything - it can only propose
      // a safe normalization. Treat it as normalize-only so it never sprays
      // false rejections (e.g. form.phone, form.date-time, form.enums-currency).
      const pureNorm = !pack.regexes.length && !pack.sets.length;

      for (const r of rows) {
        const raw = r ? r[field] : undefined;
        const val = raw == null ? '' : String(raw).trim();
        if (val === '') continue; // missing handled by base health scan
        const norm = normalizeCell(pack, val);

        if (pureNorm) {
          if (norm && norm !== val) fixes.push({ id: r.id, field, before: val, after: norm });
          continue;
        }

        const valid = cellValid(pack, val, compiled);
        if (valid && (!norm || norm === val)) continue; // clean

        const codeLike = !isRegionKind || isCodeLike(val);

        if (!valid) {
          // Region/industry packs are strict published standards, so a code-like
          // miss is a real rejection. Email is the one universal field whose
          // regex is permissive enough that a miss means the address is wrong.
          // Every other form-field pack is LENIENT: a value that merely fails
          // the canonical regex is usually just a different-but-valid format
          // (e.g. "(800) 555-1212" vs E.164), so we never hard-reject it - we
          // only offer a safe normalization, or skip it. This is exactly the
          // false-positive storm the product must avoid.
          if (!codeLike) continue;
          const kind = triageRuleHit(pack);
          if (kind === 'fixable' && norm && norm !== val) {
            fixes.push({ id: r.id, field, before: val, after: norm });
          } else if (pack.id === 'form.email' || pack.kind === 'region' || pack.kind === 'industry') {
            // A value that fails the canonical regex but whose NORMALIZED form is
            // itself canonical-valid is a safe standardization, not a rejection.
            // e.g. ZIP "12345 6789" -> "12345-6789", or a 9-digit SSN
            // "123456789" -> "123-45-6789". These must be fixable (one-click
            // apply), never red-flagged as unresolved. Only a value whose
            // normalized form is ALSO invalid stays unresolved.
            if (norm && norm !== val && cellValid(pack, norm, compiled)) {
              fixes.push({ id: r.id, field, before: val, after: norm });
            } else {
              unresolvedIds.push(r.id);
            }
          }
          // other form-fields: lenient - skip (do not flag)
        } else {
          // Valid but normalizable (e.g. Wei@Corp.COM -> lowercased domain, or a
          // ZIP "12345 6789" -> "12345-6789"). A value that already passes the
          // canonical check only needs a safe format standardization, so it is
          // ALWAYS fixable regardless of pack severity. Pack severity only
          // governs how an INVALID cell is graded (below), never a valid one.
          if (norm && norm !== val) fixes.push({ id: r.id, field, before: val, after: norm });
        }
      }

      // One (pack, column) may contain BOTH invalid (unresolved) and
      // valid-but-normalizable (fixable) cells. Emit two findings so neither
      // population is swallowed by the other's verdict.
      if (unresolvedIds.length) {
        findings.push({
          category: `${pack.label}`,
          field, fieldName, affectedRows: unresolvedIds.length,
          severity: severityLabel(pack), kind: 'unresolved',
          suggestion: buildSuggestion(pack, 'unresolved', pack.evidence),
          preset: null, ids: unresolvedIds, pack: { id: pack.id, label: pack.label }, evidence: pack.evidence,
        });
      }
      if (fixes.length) {
        findings.push({
          category: `${pack.label}`,
          field, fieldName, affectedRows: fixes.length,
          severity: severityLabel(pack), kind: 'fixable',
          suggestion: buildSuggestion(pack, 'fixable', pack.evidence),
          preset: { rulePack: pack.id, field, fixes }, ids: fixes.map((f) => f.id),
          pack: { id: pack.id, label: pack.label }, evidence: pack.evidence,
        });
      }
    }
  }

  const order = { High: 0, Medium: 1, Info: 2 };
  findings.sort((a, b) => (order[a.severity] - order[b.severity]) || (b.affectedRows - a.affectedRows));
  return findings;
}
