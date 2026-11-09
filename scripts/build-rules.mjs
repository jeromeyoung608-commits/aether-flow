// scripts/build-rules.mjs — AetherFlow Rule Pack compiler.
//
// The rules/ directory is the SOURCE OF TRUTH authored by Tree: plain Markdown
// files, zero code, diffable. This script compiles them into a single static ES
// module (src/io/rules-bundle.js) that the browser imports DIRECTLY — no fetch,
// no network, no dependency. That keeps the project's "0 network primitives in
// app code" audit claim true (scripts/audit.mjs would otherwise fail on a
// runtime fetch of rules/*.md).
//
// Run: node scripts/build-rules.mjs   (also wired as `npm run build:rules`)

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RULES_DIR = join(ROOT, 'rules');
const OUT_BUNDLE = join(ROOT, 'src/io/rules-bundle.js');
const OUT_INDEX = join(ROOT, 'rules/rules-index.json');

// ---- curated display + matching metadata (not derivable from the md) -------

const LABELS = {
  'form.email': 'Email',
  'form.phone': 'Phone',
  'form.date-time': 'Date / Time',
  'form.numbers-text': 'Number / Text',
  'form.enums-currency': 'Enum / Currency',
  'region.us': 'US Region',
  'region.eu': 'EU Region',
  'region.gb': 'UK Region',
  'region.cn': 'CN Region',
  'region.intl': 'International Codes',
  'industry.finance': 'Finance Pack',
  'industry.healthcare': 'Healthcare Pack',
  'industry.logistics': 'Logistics Pack',
  'industry.retail': 'Retail / GS1 Pack',
  'industry.auto-legal': 'Automotive / Legal Pack',
  'quality.field': 'Quality (Field)',
  'quality.record': 'Quality (Record)',
  'term.geo': 'Geo Terms',
  'term.finance': 'Finance Terms',
  'term.healthcare': 'Healthcare Terms',
  'term.legal': 'Legal Terms',
  'term.units': 'Units of Measure',
};

// Header keywords that make a column a candidate for a given pack. Matching is
// a case-insensitive substring test against the column header. This is the
// column-level "ruler matching" layer: a region pack only annotates columns
// whose header looks like its domain (SSN, ZIP, IBAN, Patient, ...).
const HEADER_HINTS = {
  'form.email': ['email', 'mail', 'e-mail'],
  'form.phone': ['phone', 'tel', 'mobile', 'cell', 'fax'],
  'form.date-time': ['date', 'time', 'birth', 'created', 'updated', 'datetime'],
  'form.numbers-text': ['amount', 'price', 'qty', 'quantity', 'number', 'count', 'balance', 'total'],
  'form.enums-currency': ['currency', 'status', 'type', 'gender', 'bool', 'enum', 'category', 'rate'],
  'region.us': ['ssn', 'social', 'ein', 'tax', 'fein', 'zip', 'zipcode', 'postal', 'state', 'routing', 'aba', 'rtn', 'itin'],
  'region.eu': ['vat', 'iban', 'postcode', 'euro'],
  'region.gb': ['nino', 'postcode', 'utr', 'sort', 'companies', 'insurance'],
  'region.cn': ['身份证', 'sfz', 'uscc', '邮编', '手机号', 'mobile', 'postal', 'china', '统一社会信用'],
  'region.intl': ['iso', 'lei', 'bic', 'isin', 'm49'],
  'industry.finance': ['iban', 'swift', 'vat', 'debit', 'credit', 'isin', 'cusip', 'bic', 'bank', 'account', 'finance', 'financial'],
  'industry.healthcare': ['patient', 'diagnosis', 'icd', 'medical', 'clinic', 'hospital', 'health'],
  'industry.logistics': ['container', 'locode', 'iata', 'sscc', 'gln', 'logistics', 'ship'],
  'industry.retail': ['gtin', 'ean', 'upc', 'sku', 'retail', 'barcode'],
  'industry.auto-legal': ['vin', 'plate', 'case', 'vehicle', 'court', 'legal'],
  'quality.field': [],
  'quality.record': [],
  'term.geo': [],
  'term.finance': [],
  'term.healthcare': [],
  'term.legal': [],
  'term.units': [],
};

// Which packs are "appliesTo" a column by default. form_fields + region +
// industry are column-applicable; quality/terminology are referenced but not
// auto-applied to individual columns in this release (documented in README).
function kindOf(id) {
  if (id.startsWith('region.')) return 'region';
  if (id.startsWith('industry.')) return 'industry';
  if (id.startsWith('quality.')) return 'quality';
  if (id.startsWith('term.')) return 'terminology';
  return 'form';
}

// ---- tiny frontmatter parser (closed set of keys, inline arrays) -----------

function parseArray(raw) {
  const s = raw.trim();
  if (s.startsWith('[') && s.endsWith(']')) {
    return s.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  return s;
}

function parseFrontmatter(text) {
  const fm = {};
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!m) return fm;
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val.startsWith('[')) fm[key] = parseArray(val);
    else fm[key] = val.replace(/^["']|["']$/g, '');
  }
  return fm;
}

// ---- section + code-block extraction --------------------------------------

function stripFrontmatter(text) {
  const m = text.match(/^---\s*\n[\s\S]*?\n---\s*\n/);
  return m ? text.slice(m[0].length) : text;
}

// A line is treated as a regex candidate only if it carries regex structure,
// so a stray prose / label line ("State abbreviations:") can never silently
// become a (valid-but-meaningless) literal regex in the bundle.
const REGEX_STRUCTURAL = /[\\^$()[\]{}.*+?|]/;
const REGEX_START = /[\\^([/]/; // where the actual pattern begins (anchor/class/group/slash)
const COMMENT_LINE = /^(#|\/\/|;|>|[-*]\s)/; // bullet / comment markers
const CJK = /[　-鿿]/;            // fullwidth space .. CJK Unified Ideographs

function looksLikeRegexLine(line) {
  const t = line.trim();
  if (!t) return false;
  if (COMMENT_LINE.test(t)) return false; // bullet / comment
  if (CJK.test(t)) return false;          // Chinese explanatory note
  return REGEX_STRUCTURAL.test(t);        // must carry regex structure
}

// Take a raw fence line and return the bare pattern, or null if the line is a
// label / comment / note. Real pack regexes contain no internal whitespace, so
// the pattern is bounded by the first structural START token and the first
// trailing space (a trailing label/comment). This strips both:
//   "SSN: ^(?!...)...$"        -> "^(?!...)...$"   (leading label)
//   "^...$  # SSN"             -> "^(?!...)...$"   (trailing comment)
//   "^...$  preserve as-is"    -> "^(?!...)...$"   (trailing label)
function toRegexOrNull(line) {
  let t = line.trim();
  if (!looksLikeRegexLine(t)) return null;
  // Strip a leading label: jump to the first structural START token.
  const start = t.search(REGEX_START);
  if (start > 0) t = t.slice(start);
  // Strip a trailing label/comment: regexes have no internal space, so the
  // first whitespace begins the trailing note.
  const space = t.search(/\s/);
  if (space > 0) t = t.slice(0, space);
  t = t.trim();
  return t || null;
}

// Returns { regexes: [string], sets: [[tokens]] } found in the ## 2. section.
function extractLogic(body) {
  const lines = body.split('\n');
  let inTwo = false;
  let inFence = false;
  let fenceLang = '';
  let fenceBuf = [];
  const regexes = [];
  const sets = [];
  for (const line of lines) {
    if (/^##\s*2\./.test(line)) { inTwo = true; continue; }
    if (/^##\s*3\./.test(line)) break; // stop before examples
    if (!inTwo) continue;
    const fenceStart = line.match(/^```(\w*)\s*$/);
    if (fenceStart) {
      if (!inFence) { inFence = true; fenceLang = fenceStart[1] || ''; fenceBuf = []; }
      else {
        inFence = false;
        const content = fenceBuf.join('\n');
        fenceBuf = [];
        if (fenceLang === 'regex') {
          // Each candidate line is a self-contained regex. Labels / Chinese
          // notes / comment lines are dropped, so a messy fence can never emit
          // an invalid pattern — and the compile assertion below guarantees it.
          for (const raw of content.split('\n')) {
            const rx = toRegexOrNull(raw);
            if (rx) regexes.push(rx);
          }
        } else if (looksLikeTokenSet(content.trim())) {
          sets.push(tokenizeSet(content));
        }
        fenceLang = '';
      }
      continue;
    }
    if (inFence) fenceBuf.push(line);
  }
  return { regexes, sets };
}

function looksLikeTokenSet(content) {
  if (!content) return false;
  const tokens = content.split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return false;
  // Heuristic: a vocabulary set (e.g. US state codes) is short, uppercase,
  // punctuation-free tokens. Reject prose paragraphs.
  const allShort = tokens.every((t) => /^[A-Z0-9./-]{1,5}$/.test(t));
  return allShort && tokens.length >= 3;
}

function tokenizeSet(content) {
  return content.split(/\s+/).filter(Boolean).map((t) => t.replace(/[.,;]/g, ''));
}

// Parses the ## 4. term-mapping table -> [[from, to], ...].
//
// The first non-separator `|` row after `## 4.` is always treated as the table
// header and skipped, regardless of its language (Chinese `非标准写法|标准值`,
// English `Non-standard form|Standard value`, or the quality packs' `维度|中文`).
// This keeps the compiler language-agnostic: authoring the packs in English or
// Chinese — or mixing — never emits a bogus header row into the bundle.
function extractTermMap(body) {
  const lines = body.split('\n');
  let inFour = false;
  let headerRowSeen = false;
  const out = [];
  for (const line of lines) {
    if (/^##\s*4\./.test(line)) { inFour = true; headerRowSeen = false; continue; }
    if (/^##\s*5\./.test(line)) break;
    if (!inFour) continue;
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    if (/^:?-{2,}:?$/.test(cells[0])) continue; // separator row
    if (!headerRowSeen) { headerRowSeen = true; continue; } // header row (any language)
    const from = cells[0];
    let to = cells[1];
    if (/空值|null/i.test(to)) to = ''; // placeholder -> empty / null
    out.push([from, to]);
  }
  return out;
}

function firstTitle(body) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

// ---- compile --------------------------------------------------------------

function compile() {
  const files = [];
  for (const dir of ['form_fields', 'regions', 'industries', 'quality', 'terminology']) {
    const d = join(RULES_DIR, dir);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).sort()) {
      if (!f.endsWith('.md')) continue;
      files.push(join(d, f));
    }
  }
  const packs = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const fm = parseFrontmatter(text);
    const body = stripFrontmatter(text);
    const { regexes, sets } = extractLogic(body);
    const termMap = extractTermMap(body);
    const id = fm.id;
    if (!id) { console.warn(`skip (no id): ${relative(ROOT, file)}`); continue; }
    const kind = kindOf(id);
    const normalize = id === 'form.email' ? 'email'
      : id === 'region.us' ? 'us'
      : id === 'region.eu' ? 'eu'
      : id === 'region.gb' ? 'gb'
      : id === 'region.cn' ? 'cn'
      : 'trim';
    packs.push({
      id,
      version: Number(fm.version) || 1,
      scope: fm.scope || kind,
      field_types: Array.isArray(fm.field_types) ? fm.field_types : (fm.field_types ? [fm.field_types] : []),
      regions: Array.isArray(fm.regions) ? fm.regions : [],
      industries: Array.isArray(fm.industries) ? fm.industries : [],
      severity: fm.severity || 'warning',
      direction: fm.direction || 'both',
      evidence: fm.evidence || 'high',
      source: Array.isArray(fm.source) ? fm.source : [],
      title: firstTitle(body),
      label: LABELS[id] || id,
      kind,
      normalize,
      headerHints: HEADER_HINTS[id] || [],
      regexes,
      sets,
      termMap,
    });
  }
  packs.sort((a, b) => a.id.localeCompare(b.id));
  return packs;
}

function emitBundle(packs) {
  const header = `// src/io/rules-bundle.js — GENERATED by scripts/build-rules.mjs.
// Do not edit by hand. Edit the Markdown packs in rules/ and re-run:
//   node scripts/build-rules.mjs
//
// This is a static data module (no network, no fetch, no runtime dependency).
// It is imported by src/io/rule-packs.js so the Rule Engine runs fully offline.

export const RULES_BUNDLE = ${JSON.stringify(packs, null, 2)};
`;
  writeFileSync(OUT_BUNDLE, header, 'utf8');
}

function emitIndex(packs) {
  const index = packs.map((p) => {
    const rel = relative(RULES_DIR, findSource(p.id));
    return rel;
  }).filter(Boolean);
  writeFileSync(OUT_INDEX, JSON.stringify(index, null, 2) + '\n', 'utf8');
}

// Map a pack id back to its source file (best-effort, for the index JSON).
function findSource(id) {
  for (const dir of ['form_fields', 'regions', 'industries', 'quality', 'terminology']) {
    const base = id.split('.').slice(1).join('-');
    const cand = join(RULES_DIR, dir, `${base}.md`);
    if (existsSync(cand)) return cand;
  }
  return '';
}

// Fail the build loudly when a rule pattern cannot be compiled. Without this,
// a malformed regex would reach the engine as a silent no-op (the engine's
// try/catch around `new RegExp` swallows the error and yields a dead rule),
// which is how a "published standard" quietly stops protecting data. We treat
// an invalid regex as a hard build error, not a runtime surprise.
function assertRegexesCompile(packs) {
  const failed = [];
  for (const pack of packs) {
    for (const r of pack.regexes || []) {
      try { new RegExp(r); }
      catch (e) { failed.push({ id: pack.id, regex: r, error: e.message }); }
    }
  }
  if (failed.length) {
    console.error('\nbuild-rules: REGEX COMPILE FAILURE — invalid rule patterns found in rules/.');
    console.error('These would have become silent runtime no-ops; the build is aborted.\n');
    for (const f of failed) {
      console.error(`  ✗ [${f.id}] /${f.regex}/`);
      console.error(`      ${f.error}`);
    }
    console.error(`\n${failed.length} invalid regex(es). Fix the Markdown in rules/ and re-run.\n`);
    process.exit(1);
  }
}

const packs = compile();
assertRegexesCompile(packs);
emitBundle(packs);
emitIndex(packs);

console.log(`build-rules: compiled ${packs.length} packs -> ${relative(ROOT, OUT_BUNDLE)}`);
console.log(`build-rules: index -> ${relative(ROOT, OUT_INDEX)}`);
