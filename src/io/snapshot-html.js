// snapshot-html.js — generate a Brief: a standalone, read-only .html deliverable.
//
// "Brief" is the PRODUCT name. The module, the exporter id and the exported
// helper names keep their historical "snapshot" spelling because they are
// referenced by the public SDK and by tests; renaming them would be a stable
// API break for no user benefit.
//
// No server, no build step, no CDN. Everything (CSS, JS, data) is inlined into
// one file the user can email / double-click / archive. It is genuinely
// read-only: the embedded runtime has no write path at all (not a hidden
// button, not a disabled input).
//
// Security (R3):
//   - `<`, `>`, `&`, U+2028/U+2029 are escaped in the JSON payload so a cell
//     containing `</script>` cannot break out of the data island.
//   - Title/source names are HTML-escaped.
//   - An inline CSP blocks every network connection (connect-src 'none').

import { snapshotRuntime } from './snapshot-runtime.js';
import { downloadText } from '../utils/csv.js';

/** Hard ceiling for a single Brief file (the data island dominates the size). */
export const SNAPSHOT_MAX_BYTES = 25 * 1024 * 1024;

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

/** JSON that is safe to place inside a <script> element. */
export function safeJSON(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Pure value formatter shared with the inlined viewer.
 *
 * KEEP IN SYNC with fmt() inside snapshotRuntime() (src/io/snapshot-runtime.js).
 * The two implementations MUST be identical: the runtime is inlined into the
 * generated HTML via .toString() and cannot reference this helper, so Node tests
 * exercise this exported copy directly.
 */
export function formatSnapshotValue(v, type) {
  if (v == null || v === '') return '';
  var s = String(v);
  if ((type === 'number' || type === 'currency') &&
      /^-?(0|[1-9]\d{0,14})(\.\d{1,6})?$/.test(s)) {
    return Number(s).toLocaleString('en-US');
  }
  return s;
}

/** Column defs reduced to serializable, renderable fields (functions stripped). */
function toSafeColumns(columns) {
  return columns.map((c) => ({
    field: c.field,
    header: c.header != null ? c.header : c.field,
    width: c.width || 120,
    type: c.type || 'text',
    align: c.align || 'left',
  }));
}

/**
 * Approximate size of the inlined data island (the size-dominant part of the
 * file). Small collections are serialized exactly; large ones are sampled by
 * numeric index across head / middle / tail and extrapolated, so the guard
 * never materialises the whole dataset before rejecting an oversized export.
 */
export function estimateSnapshotBytes(rows, columns) {
  const safeColumns = toSafeColumns(columns);
  const base = safeJSON({
    title: '', createdAt: '', sourceName: '', columns: safeColumns, rows: [],
  }).length;
  const n = rows?.length ?? 0;
  if (n === 0) return base;
  if (n <= 64) {
    return safeJSON({
      title: '', createdAt: '', sourceName: '', columns: safeColumns, rows,
    }).length;
  }
  // Index access (not iteration/spread) keeps array-like views working too.
  const step = Math.max(1, Math.floor(n / 64));
  const sample = [];
  for (let i = 0; i < n && sample.length < 64; i += step) {
    const r = rows[i];
    if (r !== undefined) sample.push(r);
  }
  const perRow = sample.length
    ? (safeJSON(sample).length - 2) / sample.length + 1 // +1 for the inter-row comma
    : 4 + safeColumns.length * 8;
  return Math.ceil((base - 2) + perRow * n * 1.15); // strip empty "[]", add margin
}

function approxMB(n) {
  return String(Math.round(n / (1024 * 1024) * 10) / 10);
}

/** KPI card markup for the Brief top band (pure, no runtime dependency). */
function kpiCard(label, value, sub) {
  return `<div class="kpi"><span class="kpi-label">${escapeHtml(label)}</span>` +
    `<span class="kpi-value">${escapeHtml(value)}</span>` +
    (sub ? `<span class="kpi-sub">${escapeHtml(sub)}</span>` : '') +
    `</div>`;
}

const NUMERIC_TYPES = new Set(['number', 'currency']);

function parseNumeric(v) {
  const s = String(v == null ? '' : v).replace(/[, \s$€£¥]/g, '').trim();
  if (!s) return null; // blank / whitespace-only / symbol-only -> no value
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Pure KPI math for the Brief: row count + per-numeric-column sum. */
export function summarizeKPIs(rows = [], columns = []) {
  const numeric = columns.filter((c) => NUMERIC_TYPES.has(c.type));
  const sums = numeric.map((c) => {
    let total = 0, n = 0;
    for (const r of rows) {
      const v = parseNumeric(r ? r[c.field] : null);
      if (v != null) { total += v; n++; }
    }
    return { field: c.field, header: c.header || c.field, total, n };
  }).filter((s) => s.n > 0);
  return { rowCount: rows.length, numeric: sums };
}

/** Sample the first numeric column for a compact bar chart (max `maxBars`). */
export function summarizeChart(rows = [], columns = [], maxBars = 32) {
  const col = columns.find((c) => NUMERIC_TYPES.has(c.type));
  if (!col) return null;
  const n = rows.length;
  if (!n) return null;
  const step = Math.max(1, Math.ceil(n / maxBars));
  const values = [];
  for (let i = 0; i < n; i += step) {
    const v = parseNumeric(rows[i] ? rows[i][col.field] : null);
    if (v != null) values.push(v);
  }
  return { field: col.field, header: col.header || col.field, values };
}

/** Throw a human-readable error when a Brief would exceed the size ceiling. */
export function assertSnapshotSize(rows, columns) {
  const bytes = estimateSnapshotBytes(rows, columns);
  if (bytes > SNAPSHOT_MAX_BYTES) {
    throw new Error(
      'Brief would be about ' + approxMB(bytes) + ' MB (limit ' +
      approxMB(SNAPSHOT_MAX_BYTES) + ' MB). Select fewer rows or export CSV instead.'
    );
  }
  return bytes;
}

const SNAPSHOT_CSS = `
:root{color-scheme:dark;--bg:#0b0e13;--panel:#11161d;--line:#232b36;--text:#e6edf3;--muted:#8b949e;--accent:#7c8cff}
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{background:var(--bg);color:var(--text);font:13px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:14px;padding:12px 18px;border-bottom:1px solid var(--line);background:var(--panel);flex:0 0 auto}
.brand{font-weight:700;letter-spacing:.2px}.brand small{color:var(--muted);font-weight:500;margin-left:8px}
.ro{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#a5b4fc;border:1px solid #4c4f8a;background:rgba(124,140,255,.12);padding:3px 9px;border-radius:999px}
header .spacer{flex:1}
#search{width:240px;height:32px;padding:0 11px;border:1px solid var(--line);border-radius:8px;background:#0b0f14;color:var(--text);font:inherit;outline:none}
#search:focus{border-color:var(--accent)}
#count{color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
#scroller{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column}
#headwrap{flex:0 0 auto;overflow:hidden;border-bottom:1px solid var(--line);background:var(--panel)}
#head{display:flex;height:38px;will-change:transform}
.hcell{display:flex;align-items:center;padding:0 12px;font-weight:600;border-right:1px solid var(--line);flex:0 0 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#viewport{flex:1;min-height:0;overflow:auto}
#spacer{position:relative;min-width:100%}
.row{position:absolute;top:0;left:0;display:flex;width:100%;height:32px;will-change:transform}
.cell{display:flex;align-items:center;padding:0 12px;border-right:1px solid var(--line);border-bottom:1px solid rgba(35,43,54,.55);flex:0 0 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.row:nth-child(even) .cell{background:#10151c}
footer{padding:9px 18px;border-top:1px solid var(--line);color:var(--muted);font-size:11px;background:var(--panel);flex:0 0 auto}
footer .decl{color:#c9d1d9;font-weight:600}
.brief-warn{margin:0;padding:12px 18px;border-top:1px solid #b8860b;background:#fff8e1;color:#5c4700;font-size:13px;flex:0 0 auto}
.brief-warn b{color:#7a5b00}
.brief-masked{margin:0;padding:12px 18px;border-top:1px solid #3b6ea5;background:#eaf2fb;color:#1b3a5b;font-size:13px;flex:0 0 auto}
#viewport::-webkit-scrollbar{width:12px;height:12px}
#viewport::-webkit-scrollbar-thumb{background:#30363d;border:3px solid var(--bg);border-radius:8px}
#brief-top{flex:0 0 auto;display:flex;flex-wrap:wrap;gap:12px;align-items:stretch;padding:14px 18px;border-bottom:1px solid var(--line);background:var(--panel)}
.kpi{display:flex;flex-direction:column;justify-content:center;min-width:118px;padding:10px 14px;border:1px solid var(--line);border-radius:10px;background:#0d121a}
.kpi-label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);white-space:nowrap}
.kpi-value{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;margin-top:3px;line-height:1.2}
.kpi-sub{font-size:10px;color:var(--muted);margin-top:2px}
#chart{flex:1 1 320px;min-width:260px;height:180px;width:100%;border:1px solid var(--line);border-radius:10px;background:#0d121a}
`;

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";

/**
 * @param {object} opts
 * @param {Array<object>} opts.rows
 * @param {Array<object>} opts.columns plain column defs (functions stripped)
 * @param {string} [opts.title]
 * @param {string} [opts.sourceName]
 * @param {number|Array} [opts.unresolvedRows] count of rows (or array of row ids)
 *        carrying Unresolved (Manual Review Required) anomalies. When > 0 a
 *        yellow warning banner is rendered at the bottom of the Brief.
 * @returns {string} complete standalone HTML document
 */
export function buildSnapshotHTML({ rows, columns, title = 'AetherFlow Brief', sourceName = '', createdAt = new Date().toISOString(), unresolvedRows = 0, masked = false }) {
  // Defensive size ceiling. The shell should pre-check too, for a friendly prompt.
  assertSnapshotSize(rows, columns);
  const safeColumns = toSafeColumns(columns);
  const kpis = summarizeKPIs(rows, safeColumns);
  const chart = summarizeChart(rows, safeColumns);
  const payload = {
    title,
    createdAt,
    sourceName,
    columns: safeColumns,
    rows,
    kpis,
    chart,
  };
  const json = safeJSON(payload);
  const runtime = '(' + snapshotRuntime.toString() + ')();';

  // Brief top band: KPI cards (rendered here) + a Canvas chart (drawn by the
  // inlined runtime, which has no access to this module's helpers).
  const kpiNodes = [kpiCard('Rows', kpis.rowCount.toLocaleString('en-US'), '')];
  for (const s of kpis.numeric) {
    kpiNodes.push(kpiCard(s.header, formatSnapshotValue(String(s.total), 'number'), `${s.n} value(s)`));
  }
  const chartHtml = chart ? '<canvas id="chart" height="180"></canvas>' : '';
  const topHtml = kpiNodes.length
    ? `<section id="brief-top">${kpiNodes.join('')}${chartHtml}</section>`
    : '';

  // Unresolved anomalies: count from a number or an array of row ids.
  const unresolvedCount = Array.isArray(unresolvedRows) ? unresolvedRows.length : (Number(unresolvedRows) || 0);
  const warnBanner = unresolvedCount > 0
    ? `<p class="brief-warn"><b>⚠️ Attention:</b> This dataset contains ${unresolvedCount} row(s) with unresolved anomalies. They were preserved as-is. Please review them manually.</p>`
    : '';

  const maskedBanner = masked
    ? `<p class="brief-masked">Masked: personal identifiers in PII columns were redacted — safe to share externally. The source data on this device is unchanged.</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${escapeHtml(title)} — AetherFlow Brief</title>
<style>${SNAPSHOT_CSS}</style>
</head>
<body>
<header>
  <span class="brand">AetherFlow Brief <small>${escapeHtml(sourceName || 'read-only')}</small></span>
  <span class="ro">Read only</span>
  <span class="spacer"></span>
  <input id="search" type="search" placeholder="Filter rows…" aria-label="Filter rows">
  <span id="count">—</span>
</header>
${topHtml}
<div id="scroller">
  <div id="headwrap"><div id="head"></div></div>
  <div id="viewport"><div id="spacer"></div></div>
</div>
${warnBanner}${maskedBanner}<footer><span class="decl">Execution: 100% Deterministic Rules. (Zero AI Hallucination on Data). Your data never left this browser.</span></footer>
<script type="application/json" id="aether-data">${json}</script>
<script>${runtime}</script>
</body>
</html>`;
}

/**
 * Markdown copy of the Brief: a compact summary (core KPIs) plus a capped
 * table of the current view. Pure (no DOM): feeds the "Copy as Markdown"
 * export. No finding/insight data is included — that is the privacy-safe
 * Report export's job — this one mirrors the Brief's data only.
 * @param {Array<object>} rows
 * @param {Array<object>} columns
 * @param {number} [maxRows] cap on rendered table rows (default 200)
 * @returns {string} Markdown
 */
export function briefToMarkdown(rows = [], columns = [], maxRows = 200) {
  const cols = toSafeColumns(columns);
  const kpis = summarizeKPIs(rows, cols);
  const lines = [];
  lines.push('# AetherFlow Brief (Markdown copy)');
  lines.push('');
  lines.push(`- **Rows:** ${kpis.rowCount.toLocaleString('en-US')}`);
  for (const s of kpis.numeric) {
    lines.push(`- **${s.header}:** ${formatSnapshotValue(String(s.total), 'number')} (${s.n} value(s))`);
  }
  lines.push('');
  if (cols.length) {
    const capped = rows.length > maxRows;
    lines.push(`## Data (current view${capped ? ` · first ${maxRows} of ${rows.length.toLocaleString('en-US')} rows` : ''})`);
    lines.push('');
    lines.push('| ' + cols.map((c) => escapeHtml(c.header)).join(' | ') + ' |');
    lines.push('| ' + cols.map(() => '---').join(' | ') + ' |');
    for (const r of rows.slice(0, maxRows)) {
      lines.push('| ' + cols.map((c) => escapeHtml(String(r[c.field] == null ? '' : r[c.field])).replace(/\|/g, '\\|')).join(' | ') + ' |');
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('_Generated locally by AetherFlow. No row data left this device._');
  return lines.join('\n');
}

/**
 * Pure-English email summary for the Brief: core KPIs, the data-quality
 * findings (fixed / flagged), and a capped table of the cleaned current view.
 * Intended to be pasted into an email — no clipboard/network code here.
 * @param {object} opts
 * @param {Array<object>} opts.rows
 * @param {Array<object>} opts.columns
 * @param {string} [opts.sourceName]
 * @param {Array<object>} [opts.findings] health-report findings
 * @returns {string} plain English email text
 */
export function briefToEmail({ rows = [], columns = [], sourceName = '', findings = [] } = {}) {
  const cols = toSafeColumns(columns);
  const kpis = summarizeKPIs(rows, cols);
  const lines = [];
  const stamp = new Date().toISOString().slice(0, 10);
  lines.push(`AetherFlow data summary — ${sourceName || 'exported data'}`);
  lines.push('');
  lines.push(`Generated ${stamp} from "${sourceName || 'local data'}". This summary was produced locally; no row data left this device.`);
  lines.push('');
  lines.push('Core KPIs:');
  lines.push(`- Rows: ${kpis.rowCount.toLocaleString('en-US')}`);
  for (const s of kpis.numeric) {
    lines.push(`- ${s.header}: ${formatSnapshotValue(String(s.total), 'number')} (${s.n} value(s))`);
  }
  lines.push('');
  lines.push('Data quality (fixed / flagged issues):');
  if (findings && findings.length) {
    const unresolved = findings.filter((f) => f.kind === 'unresolved').length;
    lines.push(`- ${findings.length} finding(s); ${unresolved} need manual review (preserved as-is, nothing auto-changed).`);
    for (const f of findings.slice(0, 8)) {
      const field = f.fieldName || f.field || '—';
      const action = f.kind === 'unresolved' ? 'manual review' : 'auto-fix available';
      lines.push(`  • [${f.severity}] ${f.category} on ${field}: ${f.affectedRows} row(s) — ${action}`);
    }
  } else {
    lines.push('- No data-quality issues detected.');
  }
  lines.push('');
  const capped = rows.length > 25;
  lines.push(`Cleaned data (current view${capped ? `, first 25 of ${rows.length.toLocaleString('en-US')} rows` : ''}):`);
  if (cols.length) {
    lines.push('| ' + cols.map((c) => escapeHtml(c.header)).join(' | ') + ' |');
    lines.push('| ' + cols.map(() => '---').join(' | ') + ' |');
    for (const r of rows.slice(0, 25)) {
      lines.push('| ' + cols.map((c) => escapeHtml(String(r[c.field] == null ? '' : r[c.field])).replace(/\|/g, '\\|')).join(' | ') + ' |');
    }
  }
  lines.push('');
  lines.push('---');
  lines.push('Generated by AetherFlow · Deterministic rules, zero AI hallucination on data.');
  return lines.join('\n');
}

export function downloadSnapshot(opts) {
  const html = buildSnapshotHTML(opts);
  const stamp = new Date().toISOString().slice(0, 10);
  const name = (opts.sourceName || 'data').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-');
  downloadText(`aether-brief-${name}-${stamp}.html`, html, 'text/html;charset=utf-8');
  return html;
}
