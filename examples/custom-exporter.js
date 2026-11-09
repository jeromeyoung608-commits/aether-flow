// examples/custom-exporter.js — a second minimal extension: JSON Lines export.
//
// Shows that an Exporter only needs to return a Blob; the host handles the
// download. Nothing here touches the DOM at import time, so it is testable.

import { STABILITY, defineModule } from '../src/sdk/index.js';

export const { manifest } = defineModule({
  id: 'example.exporter.jsonl',
  egress: 'none',
  permissions: ['files.read'],
  provides: ['exporter:jsonl'],
}, () => ({}));

/** Pure: build JSON Lines text from records + column defs. */
export function buildJSONL(rows, columns) {
  return rows.map((r) => {
    const obj = {};
    for (const c of columns) obj[c.header || c.field] = r[c.field] ?? '';
    return JSON.stringify(obj);
  }).join('\n');
}

export function registerExampleExporter(AetherFlow, { getRows, getColumns, save }) {
  return AetherFlow.exporters.register('jsonl', () => {
    const text = buildJSONL(getRows(), getColumns());
    const blob = new Blob([text], { type: 'application/x-ndjson;charset=utf-8' });
    save('aether-export.jsonl', blob);
    return blob;
  }, {
    stability: STABILITY.BETA,
    description: 'JSON Lines (one object per row) — handy for local pipelines',
  });
}
