// core/insights.worker.js — M2-2: off-main-thread business Insights scan.
//
// The overlapping-subscription and hidden-fee scans run HERE, never on the UI
// thread, so a 100k-row file never freezes the Data Health Report. Pure local
// code: NO fetch, NO network, NO API, NO LLM. It imports only the pure
// `analyzeInsights` function and answers an `insights` message with an
// `insights-result`.
//
// The caller ships `rows` + `columns` with each request (stateless). This keeps
// the worker free of a second dataset-sync channel while staying correct even
// after inline edits on the main thread (the freshest rows are always sent).

import { analyzeInsights } from '../io/insights.js';

self.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type !== 'insights') return;
  const insights = analyzeInsights(msg.rows || [], msg.columns || []);
  self.postMessage({ type: 'insights-result', id: msg.id, insights });
};
