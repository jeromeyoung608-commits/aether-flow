// io/report-md.js — render the Data Health Report + Insights as Markdown.
//
// Pure (no DOM, no network): the same function feeds both the "Copy Insights to
// Markdown" button and the full-report export. Because it only emits column
// names, finding counts and insight summaries (never raw row values), the output
// is inherently privacy-safe and email-ready.

/**
 * Render the combined health findings + insights as a Markdown document.
 * @param {object} opts
 * @param {Array<object>} opts.columns
 * @param {Array<object>} opts.findings
 * @param {Array<object>} opts.insights
 * @returns {string} Markdown
 */
export function reportToMarkdown({ columns = [], findings = [], insights = [] } = {}) {
  const lines = [];
  lines.push('# AetherFlow — Data Health Report');
  lines.push('');

  const unresolved = findings.filter((f) => f.kind === 'unresolved').length;
  lines.push(`- **Columns:** ${columns.length}`);
  lines.push(`- **Findings:** ${findings.length} (${unresolved} need manual review — nothing was auto-changed)`);
  lines.push(`- **Business insights:** ${insights.length}`);
  lines.push('');

  if (insights.length) {
    lines.push('## Business Insights');
    lines.push('');
    for (const i of insights) {
      lines.push(`### ${i.title}`);
      lines.push(i.detail);
      lines.push('');
    }
  }

  if (findings.length) {
    lines.push('## Findings');
    lines.push('');
    lines.push('| Severity | Category | Field | Rows | Recommended action |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const f of findings) {
      const action = f.kind === 'unresolved'
        ? 'Manual review (preserved as-is)'
        : (f.pack ? `One-click / diff-confirm via ${f.pack.label}` : 'Dry-run fix available');
      const field = f.fieldName || f.field || '—';
      lines.push(`| ${f.severity} | ${f.category} | ${field} | ${f.affectedRows} | ${action} |`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('_Generated locally by AetherFlow. No row data left this device._');
  return lines.join('\n');
}

/**
 * Render just the insights as a short Markdown block (the "Copy Insights to
 * Markdown" payload).
 * @param {Array<object>} insights
 * @returns {string} Markdown
 */
export function insightsToMarkdown(insights = []) {
  if (!insights.length) return '_No business insights detected._\n';
  const lines = ['## Business Insights', ''];
  for (const i of insights) {
    lines.push(`### ${i.title}`);
    lines.push(i.detail);
    lines.push('');
  }
  return lines.join('\n');
}
