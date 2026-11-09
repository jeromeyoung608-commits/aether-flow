// grid.worker.js — off-main-thread query engine.
//
// The worker holds the full dataset (sent once via `init`) and answers `query`
// requests with an array of matching *indices* — not row objects — so the
// payload back to the main thread stays tiny even at 100k+ rows. This is what
// keeps the UI thread free to render at 60fps while a 100k sort/filter runs.
//
// 0.1.1: every query carries an `id` that is echoed back in `result`. The main
// thread keeps a Map of pending requests, so a late answer from an older query
// can never resolve a newer Promise (the "type then immediately sort" race).

import { runQueryIndices } from '../utils/query.js';

let rows = [];
let byId = new Map();

self.onmessage = (e) => {
  const msg = e.data || {};

  if (msg.type === 'init') {
    rows = msg.rows || [];
    byId = new Map();
    for (let i = 0; i < rows.length; i++) byId.set(rows[i].id, rows[i]);
    return;
  }

  if (msg.type === 'query') {
    const idx = runQueryIndices(rows, msg.params || {});
    self.postMessage({ type: 'result', id: msg.id, idx });
    return;
  }

  if (msg.type === 'patch') {
    // keep the worker's copy in sync after an inline edit on the main thread
    const r = byId.get(msg.id);
    if (r) r[msg.field] = msg.value;
    return;
  }
};
