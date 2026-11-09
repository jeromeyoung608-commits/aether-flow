/**
 * ========================================================================
 * AetherFlow — Privacy-First Local Data Cleansing Engine
 * Copyright (c) 2026 Jerome Young. All Rights Reserved.
 *
 * Licensed under the MIT License.
 * For commercial private deployments (removing watermarks, custom DB adapters,
 * or SSO integration), a commercial license is required.
 * Contact: jeromeyoung608@gmail.com
 * ========================================================================
 */

console.log(
  '%c AetherFlow %c Engine by Jerome Young | Contact: jeromeyoung608@gmail.com ',
  'background: #3fb950; color: #000; font-weight: bold; padding: 4px 8px; border-radius: 4px 0 0 4px;',
  'background: #1a2028; color: #b3bcc8; padding: 4px 8px; border-radius: 0 4px 4px 0;'
);

// shell/app.js — the sample site's bootstrap.
//
// IMPORTANT (dogfooding): every user-facing action below is registered through
// the PUBLIC SDK. This file never reaches into a private module to wire a
// button. That is the cheapest possible proof that a customer can extend the
// same kernel without forking it.
//
// Zero network. Zero accounts. Zero telemetry. Zero runtime dependencies.
//
// 0.1.1: layout/edits are namespaced per file and flushed before switching;
// imports/restores are atomic; destructive actions confirm and can be undone;
// the status bar no longer calls a timestamp "a backup".

import { Grid, IndexedDBAdapter, MockAdapter, FIELD_META, demoRows, metaKey } from '../main.js';
import { createVault } from '../storage/idb.js';
import {
  exportBackup, restoreBackup, saveBackupToLocalFolder, requestPersistence,
  startActivityTimer, installUnloadGuard, META_LAST_ACTIVITY,
} from '../storage/backup.js';
import { AetherFlow, STABILITY } from '../sdk/index.js';
import { installEgressGuard, getLedger, onEgress, outboundCount, setEgressEndpoint } from './egress.js';
import { loadByokSettings } from '../io/byok.js';
import { openByokSettings } from '../ui/byok-settings.js';
import { installTabGuard } from './tabs.js';
import { Ingest, filesFromEvent, fileIdFor } from '../io/ingest.js';
import {
  downloadSnapshot, estimateSnapshotBytes, assertSnapshotSize,
  briefToMarkdown, briefToEmail,
} from '../io/snapshot-html.js';
import { DEFAULT_RULES, FULL_RULES, applyDateOrder } from '../io/cleanse.js';
import {
  listCleaningRecipes, saveCleaningRecipe, deleteCleaningRecipe, recommendRecipes,
  buildRecipeFromCleanse,
} from '../io/cleaning-recipes.js';
import { setValidatorResolver, VALIDATORS } from '../io/schema.js';
import { CommandPalette } from '../ui/palette.js';
import { FilePanel } from '../ui/files.js';
import { StatusBar } from '../ui/status.js';
import { ChartPanel } from '../ui/chart.js';
import { openImportPreview } from '../ui/import-preview.js';
import { openDateAmbiguity } from '../ui/date-ambiguity.js';
import { openIssueList } from '../ui/issue-list.js';
import { openCleansePreview } from '../ui/cleanse-preview.js';
import { openHealthReport } from '../ui/health-report.js';
import { openRecipeList } from '../ui/recipe-list.js';
import { loadRecipe, saveRecipe } from '../io/recipe.js';
import { reportToMarkdown } from '../io/report-md.js';
import { desensitizeRows, piiColumns } from '../io/desensitize.js';
import { buildCSV, downloadText } from '../utils/csv.js';

const DEMO_ROWS = 100000;
const DEMO_FILE_ID = '__demo__';
const state = {
  dirtySinceBackup: false, activeFileId: DEMO_FILE_ID, activeName: '',
  demo: false, vault: null,
};
// Captures the last explicit "Clean data" action so it can be saved as a recipe.
let lastClean = null;

function demoColumns() {
  return Object.entries(FIELD_META).map(([field, m]) => ({
    field, header: m.header, width: m.width, type: m.type, align: m.align,
    pinned: m.pinned, sortable: true, resizable: true, filterable: true,
    editable: field !== 'id',
    validate: ['currency', 'number'].includes(m.type) ? ['number'] : (m.type === 'date' ? ['isoDate'] : null),
  }));
}

function humanBytes(n) {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** A timestamp is NOT a backup. Only an exported .aether file can restore. */
function activityLabel(ts) {
  if (!ts) return 'No .aether backup yet';
  const mins = Math.round((Date.now() - ts) / 60000);
  return mins < 1 ? 'Last activity just now' : `Last activity ${mins} min ago`;
}

async function boot() {
  // ---- 0-egress guarantee (visible + enforced) --------------------------
  installEgressGuard();
  AetherFlow.setLedgerProvider(getLedger);

  // ---- storage: IndexedDB, with an honest fallback -----------------------
  const vault = await createVault();
  state.vault = vault;
  const persisted = await requestPersistence();
  const storage = {
    get: async (k) => (await vault.get('meta', k))?.value ?? null,
    set: (k, v) => vault.put('meta', { key: k, value: v }),
    clear: async (keys) => { for (const k of keys) await vault.delete('meta', k); },
  };

  // ---- UI shell ----------------------------------------------------------
  const status = new StatusBar({ mount: document.getElementById('app') });
  status.setOutbound(outboundCount());
  onEgress((n) => {
    status.setOutbound(n);
    AetherFlow.emit('egress:declared', { count: n, last: getLedger().slice(-1)[0] || null });
  });

  const filePanel = new FilePanel({
    mount: document.getElementById('workspace'),
    onSelect: (id) => openFile(id),
    onDelete: (id) => deleteFile(id),
    onImportClick: () => pickFiles(),
    onImportBackup: () => pickBackup(),
  });
  filePanel.setStorage({ backend: vault.backend, persisted });

  const chart = new ChartPanel({ sdk: AetherFlow });

  // ---- SDK registries: built-in validators + exporters -------------------
  for (const [name, fn] of Object.entries(VALIDATORS)) {
    AetherFlow.validators.register(name, fn, { stability: STABILITY.STABLE, description: `Built-in rule: ${name}` });
  }
  setValidatorResolver((name) => AetherFlow.validators.get(name));

  // ---- grid --------------------------------------------------------------
  let adapter;
  let columns = demoColumns();
  const files = await vault.getAll('files');

  if (files.length) {
    const first = files.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    state.activeFileId = first.id;
    state.activeName = first.name || '';
    if (Array.isArray(first.columns) && first.columns.length) columns = first.columns;
    adapter = new IndexedDBAdapter(vault, first.id);
  } else {
    state.demo = true;
    state.activeFileId = DEMO_FILE_ID;
    state.activeName = 'demo-100k.csv';
    adapter = new MockAdapter(demoRows(DEMO_ROWS));
  }

  const activeId = state.activeFileId;
  const lastActivity = (await storage.get(META_LAST_ACTIVITY))?.at || null;
  status.setBackup(activityLabel(lastActivity), false);

  const confirmAction = (message) => (typeof window !== 'undefined' && typeof window.confirm === 'function')
    ? window.confirm(message) : true;

  const grid = new Grid('#grid', {
    columns, adapter, storage, fileId: activeId,
    initialLayout: await storage.get(metaKey('layout', activeId)),
    initialEdits: await storage.get(metaKey('edits', activeId)),
    confirmAction,
    theme: 'dark', rowHeight: 40, selection: true, useWorker: true, stats: true,
    onEdit: (op) => {
      state.dirtySinceBackup = true;
      status.setBackup('Unsaved changes · export a .aether backup', false);
      AetherFlow.emit('meta:delta', op);
    },
    onInvalid: (msg) => status.toast(`Invalid value — ${msg}`, 'error'),
    onStats: (s) => status.setStats({
      rows: s.total, domNodes: s.domNodes, queryMs: s.queryMs, mode: s.mode,
    }),
    onNotice: (msg, kind, ms) => status.toast(msg, kind, ms),
    onConfigureByok: () => openByokSettings({ vault, onSaved: (s) => grid.setByokSettings(s) }),
  });

  await grid.loadData();
  filePanel.setFiles(files);

  // ---- BYOK: pre-arm the egress allowlist from saved settings (default off) --
  // If the user previously configured an endpoint, re-allow exactly that origin
  // at boot; otherwise the guard stays closed (0 reachable origins).
  try {
    const byok = await loadByokSettings(vault);
    setEgressEndpoint(byok && byok.endpoint ? byok.endpoint : null);
    grid.setByokSettings(byok);
  } catch (_) { /* BYOK is optional; never block boot on it */ }
  filePanel.setActive(state.demo ? null : state.activeFileId);

  // ---- M2-1: local cleaning recipes (grid API; dogfoods the same surface) ----
  grid.cleaningRecipes = () => listCleaningRecipes(storage);
  grid.saveCleaningRecipe = (recipe) => saveCleaningRecipe(storage, recipe);
  grid.deleteCleaningRecipe = (id) => deleteCleaningRecipe(storage, id);
  grid.recommendCleaningRecipes = async () => recommendRecipes(await listCleaningRecipes(storage), grid.dataColumns());
  grid.applyCleaningRecipe = async (recipe) => {
    const rows = grid.state.get('rows');
    for (const step of recipe.steps) grid.cleanseApply(step.rules, step.fields);
    if (!state.demo && rows) {
      filePanel.setProgress('Applying recipe', 0);
      try {
        await new IndexedDBAdapter(vault, state.activeFileId).importRows(
          state.activeFileId,
          { name: state.activeName, rowCount: rows.length, columns: grid.dataColumns(), updatedAt: Date.now() },
          rows,
          (done, total) => filePanel.setProgress('Applying recipe', Math.round((done / total) * 100)),
        );
      } catch (err) {
        filePanel.hideProgress();
        status.toast(`Could not save recipe results — ${err.message}`, 'error', 9000);
        return;
      }
      filePanel.hideProgress();
    }
    await grid.recompute({ preserveScroll: true });
    grid.renderBody();
    AetherFlow.emit('audit:append', { action: 'recipe.apply', steps: recipe.steps.length });
  };
  if (state.demo) status.toast('Demo dataset · drop a CSV to persist your own files on this device', 'info', 5200);

  // ---- honest capability warnings ----------------------------------------
  if (vault.backend === 'memory') {
    status.toast('TEMPORARY MODE — IndexedDB is unavailable, so nothing survives a refresh. Export a .aether backup before closing.', 'error', 12000);
  }
  installTabGuard({
    onPeers: (n) => {
      status.toast(`⚠ ${n} other tab(s) have this workspace open. There is no merge or version check — the last save wins. Close the others before editing.`, 'error', 12000);
      AetherFlow.emit('tabs:conflict', { peers: n });
    },
    onAlone: () => AetherFlow.emit('tabs:alone', {}),
  });

  // Offline shell: caches CODE only (never user data). Same-origin, no network
  // primitive in this file. First offline launch requires one online visit.
  try {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker?.register) {
      navigator.serviceWorker.register(new URL('../../sw.js', import.meta.url), { scope: './' })
        .catch(() => { /* optional: offline shell unavailable */ });
    }
  } catch (_) { /* optional */ }

  // ---- backup lifecycle --------------------------------------------------
  installUnloadGuard(state);
  startActivityTimer(vault, state, 5 * 60 * 1000, (at) => {
    if (!state.dirtySinceBackup) status.setBackup(activityLabel(at), false);
  });

  function markBackedUp() {
    state.dirtySinceBackup = false;
    status.setBackup('Backed up just now', true);
    AetherFlow.emit('audit:append', { action: 'backup.export', at: Date.now() });
  }

  // ---- file pickers ------------------------------------------------------
  const fileInput = document.getElementById('file-input');
  const backupInput = document.getElementById('backup-input');
  const pickFiles = () => fileInput.click();
  const pickBackup = () => backupInput.click();

  const ingest = new Ingest({
    onProgress: ({ label, pct }) => filePanel.setProgress(label, pct),
    rules: DEFAULT_RULES, // import only trims; aggressive rules are opt-in
  });

  async function refreshFiles() {
    const list = await vault.getAll('files');
    filePanel.setFiles(list);
    return list;
  }

  async function openFile(id) {
    const f = await vault.get('files', id);
    if (!f) { status.toast('File not found on this device', 'error'); return; }
    // Flush the CURRENT file's debounced layout/edits before switching context.
    await grid.setContext(id);
    const next = new IndexedDBAdapter(vault, id);
    adapter = next;
    state.activeFileId = id;
    state.activeName = f.name || '';
    state.demo = false;
    grid.adapter = next;
    grid.replaceColumns(
      Array.isArray(f.columns) && f.columns.length ? f.columns : demoColumns(),
      {
        layout: await storage.get(metaKey('layout', id)),
        edits: await storage.get(metaKey('edits', id)),
      },
    );
    await grid.loadData();
    filePanel.setActive(id);
    status.toast(`Opened ${f.name} · ${Number(f.rowCount || 0).toLocaleString('en-US')} rows · from this device`, 'ok');
    AetherFlow.emit('file:changed', { id, name: f.name });
  }

  async function deleteFile(id) {
    const f = await vault.get('files', id);
    const name = f?.name || id;
    if (!confirmAction(`Remove "${name}" and all of its rows from this device? This cannot be undone without a .aether backup.`)) return;
    try {
      await new IndexedDBAdapter(vault, id).deleteFile(id);
      await storage.clear([metaKey('layout', id), metaKey('edits', id)]);
      state.dirtySinceBackup = true;
      await refreshFiles();
      if (state.activeFileId === id) {
        const rest = await vault.getAll('files');
        if (rest.length) await openFile(rest[0].id);
        else {
          await grid.setContext(DEMO_FILE_ID);
          grid.adapter = new MockAdapter([]);
          grid.replaceColumns(demoColumns(), {});
          await grid.loadData();
          state.activeFileId = DEMO_FILE_ID;
          state.demo = true;
          filePanel.setActive(null);
        }
      }
      status.toast(`Removed "${name}" from this device`, 'ok');
    } catch (err) {
      status.toast(`Could not delete "${name}" — ${err.message}. Your data is unchanged.`, 'error', 8000);
    }
  }

  async function importFiles(list) {
    const usable = list.filter((f) => /\.(csv|tsv|txt)$/i.test(f.name || '') || (f.type || '').includes('csv'));
    if (!usable.length) { status.toast('Only local CSV/TSV files are supported in the core (Parser SPI for others)', 'error'); return; }
    for (const file of usable) {
      const id = fileIdFor(file);
      try {
        // 1) Non-destructive scan, then a confirm gate — nothing is written yet.
        filePanel.setProgress('Scanning file', null);
        const scan = await ingest.scan(file);

        // Reuse a previously-saved recipe for this file (consistent re-imports);
        // the user can still override any control in the dialog.
        const priorRecipe = await loadRecipe(vault, id);

        const opts = await new Promise((resolve) => {
          openImportPreview({
            report: scan, onConfirm: resolve, onCancel: () => resolve(null),
            defaults: priorRecipe || undefined, rememberDefault: !!priorRecipe,
          });
        });
        if (!opts) { filePanel.hideProgress(); status.toast('Import cancelled', 'info'); continue; }

        // 2) If ambiguous slash-dates exist, force the user to choose an order.
        //    Cancelling keeps the raw strings (they will be flagged invalid) and
        //    NEVER substitutes a guess.
        let dateOrder = {};
        if (scan.dateAmbiguity && scan.dateAmbiguity.length) {
          const res = await new Promise((resolve) => {
            openDateAmbiguity({ report: scan, onResolve: resolve, onCancel: () => resolve(null) });
          });
          if (res) dateOrder = res;
        }

        // 3) Only now parse + store, atomically.
        filePanel.setProgress('Parsing CSV', 0);
        const parsed = await ingest.parse(file, opts);
        if (Object.keys(dateOrder).length) {
          const changed = applyDateOrder(parsed.rows, parsed.columns, dateOrder);
          if (changed) status.toast(`Normalized ${changed} ambiguous date(s) using your chosen order`, 'info', 6000);
        }

        // Persist the recipe (if the user asked to remember it) so the NEXT
        // import of this file starts from the same choices. Local-only, never
        // sent off-device.
        if (opts.remember) {
          await saveRecipe(vault, id, {
            encoding: opts.encoding,
            delimiter: opts.delimiter,
            headerRow: opts.headerRow,
            skipRows: opts.skipRows,
            dateOrder,
          });
        }

        const target = new IndexedDBAdapter(vault, id);
        await target.importRows(
          id,
          { name: parsed.name, size: parsed.bytes, rowCount: parsed.rowCount,
            columns: parsed.columns, createdAt: Date.now() },
          parsed.rows,
          (done, total) => filePanel.setProgress('Storing on this device', Math.round((done / total) * 100)),
        );
        await refreshFiles();
        await openFile(id);
        state.dirtySinceBackup = true;
        status.setBackup('Unsaved changes · export a .aether backup', false);
        status.toast(`Imported ${parsed.rowCount.toLocaleString('en-US')} rows from ${parsed.name}`, 'ok');
        for (const warning of parsed.warnings || []) status.toast(warning, 'info', 7000);
        AetherFlow.emit('file:ingest', { id, name: parsed.name, rows: parsed.rowCount });
        // Trigger the Data Health Report scan after the table renders.
        try {
          const hr = grid.healthReport();
          if (hr.length) openHealthReport({ grid, toast: (m, k, ms) => status.toast(m, k, ms), onClose: () => {} });
        } catch { /* health scan is best-effort */ }
      } catch (err) {
        filePanel.hideProgress();
        status.toast(`Import failed: ${err.message}. Your existing files were not changed.`, 'error', 9000);
      } finally {
        filePanel.hideProgress();
      }
    }
  }

  fileInput.addEventListener('change', (e) => {
    importFiles(filesFromEvent(e).length ? filesFromEvent(e) : [...e.target.files]);
    e.target.value = '';
  });
  backupInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      filePanel.setProgress('Verifying backup', null);
      const r = await restoreBackup(file, vault, (done, total) =>
        filePanel.setProgress('Restoring rows', total ? Math.round((done / total) * 100) : null));
      filePanel.hideProgress();
      status.toast(`Restored ${r.rows.toLocaleString('en-US')} rows · checksum ${r.algorithm} verified — reloading`, 'ok', 4000);
      setTimeout(() => location.reload(), 1200);
    } catch (err) {
      filePanel.hideProgress();
      status.toast(`Restore failed: ${err.message}`, 'error', 9000);
    }
    e.target.value = '';
  });

  // ---- drag & drop / double-click ----------------------------------------
  const workspace = document.getElementById('workspace');
  const dropOverlay = document.getElementById('drop-overlay');
  let dragDepth = 0;
  const showDrop = (on) => { dropOverlay.style.display = on ? 'flex' : 'none'; };
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; showDrop(true); });
  window.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  window.addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; showDrop(false); } });
  window.addEventListener('drop', async (e) => {
    e.preventDefault(); dragDepth = 0; showDrop(false);
    const list = filesFromEvent(e);
    if (list.length) await importFiles(list);
    else status.toast('Drop a CSV / TSV file (or a folder containing them)', 'info');
  });
  workspace.addEventListener('dblclick', (e) => {
    if (e.target.closest('.zenith-cell, input, button, a, .af-palette, .af-chart, .af-files')) return;
    pickFiles();
  });
  document.getElementById('btn-import').addEventListener('click', pickFiles);
  document.getElementById('btn-backup').addEventListener('click', async () => {
    await exportBackup(vault); markBackedUp();
    status.toast('.aether backup downloaded — keep it somewhere safe', 'ok');
  });
  // ---- Export dropdown (Final Polish, point one: progressive disclosure) ----
  const exportBtn = document.getElementById('btn-share');
  const exportMenu = document.getElementById('export-menu');
  function closeExportMenu() { if (exportMenu) { exportMenu.hidden = true; exportBtn?.setAttribute('aria-expanded', 'false'); } }
  function openExportMenu() { if (exportMenu) { exportMenu.hidden = false; exportBtn?.setAttribute('aria-expanded', 'true'); } }

  async function runExport(kind) {
    const rows = grid.state.get('view') || [];
    const cols = grid.dataColumns();
    if (kind === 'csv') { grid.exportView(); status.toast('CSV exported (current view, Excel-safe BOM, formula-safe)', 'ok'); return; }
    if (kind === 'brief') { AetherFlow.get('exporters', 'snapshot-html')(); return; }
    if (kind === 'markdown') {
      const insights = await grid.insights();
      const md = reportToMarkdown({ columns: cols, findings: grid.healthReport(), insights });
      downloadText(`aether-report-${Date.now()}.md`, md, 'text/markdown;charset=utf-8');
      status.toast('Markdown report downloaded (privacy-safe)', 'ok');
      AetherFlow.emit('audit:append', { action: 'export.markdown', rows: rows.length });
      return;
    }
    if (kind === 'desensitized') {
      const masked = desensitizeRows(rows, cols);
      downloadText(`aether-desensitized-${Date.now()}.csv`, buildCSV(masked, cols), 'text/csv;charset=utf-8');
      status.toast('Desensitized CSV downloaded — PII columns masked', 'ok');
      AetherFlow.emit('audit:append', { action: 'export.desensitized', rows: rows.length });
      return;
    }
    if (kind === 'email') {
      const insights = await grid.insights();
      const md = reportToMarkdown({ columns: cols, findings: grid.healthReport(), insights });
      copyToClipboard(md).then((ok) => status.toast(ok ? 'Report copied — paste into your email' : 'Copy failed — copy manually', ok ? 'ok' : 'error'));
      return;
    }
    if (kind === 'brief-md') {
      const md = briefToMarkdown(rows, cols);
      copyToClipboard(md).then((ok) => status.toast(ok ? 'Brief Markdown copied — paste anywhere' : 'Copy failed — copy manually', ok ? 'ok' : 'error'));
      AetherFlow.emit('audit:append', { action: 'export.brief-markdown', rows: rows.length });
      return;
    }
    if (kind === 'brief-email') {
      const text = briefToEmail({ rows, columns: cols, sourceName: state.activeName, findings: grid.healthReport() });
      copyToClipboard(text).then((ok) => status.toast(ok ? 'Email summary copied — paste into your email' : 'Copy failed — copy manually', ok ? 'ok' : 'error'));
      AetherFlow.emit('audit:append', { action: 'export.brief-email', rows: rows.length });
      return;
    }
    if (kind === 'brief-masked') {
      const pii = piiColumns(cols);
      if (!pii.length) { status.toast('No PII columns detected — nothing to mask', 'info'); return; }
      // desensitizeRows returns NEW row objects; the source data is untouched.
      AetherFlow.get('exporters', 'snapshot-html-masked')(desensitizeRows(rows, cols), pii.length);
      return;
    }
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
    try {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return Promise.resolve(ok);
    } catch { return Promise.resolve(false); }
  }

  if (exportBtn && exportMenu) {
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (exportMenu.hidden) openExportMenu(); else closeExportMenu();
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('#export-dropdown')) closeExportMenu(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeExportMenu(); });
    exportMenu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-export]');
      if (!item) return;
      closeExportMenu();
      runExport(item.getAttribute('data-export'));
    });
  }

  document.getElementById('btn-palette').addEventListener('click', () => palette.open());

  // ---- exporters (public SPI) -------------------------------------------
  AetherFlow.exporters.register('csv', () => {
    grid.exportView();
    status.toast('CSV exported (current view, Excel-safe BOM, formula-safe)', 'ok');
  }, { stability: STABILITY.STABLE, description: 'Export current view as CSV' });

  AetherFlow.exporters.register('aether-backup', async () => {
    await exportBackup(vault); markBackedUp();
    status.toast('.aether backup downloaded · checksum detects accidental corruption', 'ok');
  }, { stability: STABILITY.STABLE, description: 'Portable .aether backup with checksum' });

  AetherFlow.exporters.register('local-folder', async () => {
    try {
      const how = await saveBackupToLocalFolder(vault);
      markBackedUp();
      status.toast(how === 'picker'
        ? 'Saved to the local folder you chose — your own sync client handles the rest'
        : 'File System Access unavailable here — downloaded the backup instead', 'ok', 5000);
    } catch (err) {
      if (err?.name !== 'AbortError') status.toast(`Save failed: ${err.message}`, 'error');
    }
  }, { stability: STABILITY.BETA, description: 'Write .aether into a user-chosen local synced folder' });

  AetherFlow.exporters.register('snapshot-html', () => {
    const selectedOnly = grid.hasExplicitSelection();
    const rows = grid.selectedRows();
    const cols = grid.dataColumns();
    try {
      assertSnapshotSize(rows, cols);
    } catch (err) {
      status.toast(err.message, 'error', 9000);
      return;
    }
    const bytes = estimateSnapshotBytes(rows, cols);
    filePanel.setProgress('Building Brief', 20);
    // Unresolved (Manual Review Required) count = distinct rows with any red cell.
    const invalidMap = grid.state.get('invalid') || new Map();
    const unresolvedIds = new Set();
    for (const key of invalidMap.keys()) {
      const sep = key.lastIndexOf(':');
      unresolvedIds.add(sep >= 0 ? key.slice(0, sep) : key);
    }
    let html;
    try {
      html = downloadSnapshot({ rows, columns: cols, sourceName: state.activeName, title: `${state.activeName} · Brief`, unresolvedRows: unresolvedIds.size });
    } catch (err) {
      filePanel.hideProgress();
      status.toast(`Brief failed: ${err.message}`, 'error', 9000);
      return;
    }
    filePanel.hideProgress();
    const scope = selectedOnly ? 'selected rows only' : 'current view';
    status.toast(`Brief exported · ${humanBytes(html.length)} · ${rows.length.toLocaleString('en-US')} rows (${scope}) · no network`, 'ok', 6000);
    AetherFlow.emit('audit:append', { action: 'share.html', rows: rows.length, approxBytes: bytes, selectedOnly });
  }, { stability: STABILITY.STABLE, description: 'Brief — self-contained read-only HTML deliverable' });

  AetherFlow.exporters.register('snapshot-html-masked', (maskedRows, piiCount) => {
    const selectedOnly = grid.hasExplicitSelection();
    const cols = grid.dataColumns();
    try {
      assertSnapshotSize(maskedRows, cols);
    } catch (err) {
      status.toast(err.message, 'error', 9000);
      return;
    }
    const bytes = estimateSnapshotBytes(maskedRows, cols);
    filePanel.setProgress('Building masked Brief', 20);
    const invalidMap = grid.state.get('invalid') || new Map();
    const unresolvedIds = new Set();
    for (const key of invalidMap.keys()) {
      const sep = key.lastIndexOf(':');
      unresolvedIds.add(sep >= 0 ? key.slice(0, sep) : key);
    }
    let html;
    try {
      html = downloadSnapshot({
        rows: maskedRows, columns: cols, sourceName: state.activeName,
        title: `${state.activeName} · Brief (masked)`, masked: true,
        unresolvedRows: unresolvedIds.size,
      });
    } catch (err) {
      filePanel.hideProgress();
      status.toast(`Masked Brief failed: ${err.message}`, 'error', 9000);
      return;
    }
    filePanel.hideProgress();
    const scope = selectedOnly ? 'selected rows only' : 'current view';
    status.toast(`Masked Brief exported · ${humanBytes(html.length)} · ${maskedRows.length.toLocaleString('en-US')} rows (${scope}) · ${piiCount} PII column(s) redacted`, 'ok', 6000);
    AetherFlow.emit('audit:append', { action: 'share.html.masked', rows: maskedRows.length, piiColumns: piiCount, approxBytes: bytes, selectedOnly });
  }, { stability: STABILITY.STABLE, description: 'Brief with PII columns masked — safe to share' });

  AetherFlow.exporters.register('report-markdown', async () => {
    const insights = await grid.insights();
    const md = reportToMarkdown({ columns: grid.dataColumns(), findings: grid.healthReport(), insights });
    downloadText(`aether-report-${Date.now()}.md`, md, 'text/markdown;charset=utf-8');
    status.toast('Markdown report downloaded (privacy-safe)', 'ok');
    AetherFlow.emit('audit:append', { action: 'export.markdown', rows: (grid.state.get('view') || []).length });
  }, { stability: STABILITY.STABLE, description: 'Data Health Report as Markdown' });

  AetherFlow.exporters.register('desensitized-csv', () => {
    const rows = grid.state.get('view') || [];
    const cols = grid.dataColumns();
    const masked = desensitizeRows(rows, cols);
    downloadText(`aether-desensitized-${Date.now()}.csv`, buildCSV(masked, cols), 'text/csv;charset=utf-8');
    status.toast('Desensitized CSV downloaded — PII columns masked', 'ok');
    AetherFlow.emit('audit:append', { action: 'export.desensitized', rows: rows.length });
  }, { stability: STABILITY.STABLE, description: 'CSV with PII columns masked' });

  AetherFlow.exporters.register('copy-email-draft', async () => {
    const insights = await grid.insights();
    const md = reportToMarkdown({ columns: grid.dataColumns(), findings: grid.healthReport(), insights });
    copyToClipboard(md).then((ok) => status.toast(ok ? 'Report copied — paste into your email' : 'Copy failed — copy manually', ok ? 'ok' : 'error'));
  }, { stability: STABILITY.STABLE, description: 'Copy a privacy-safe report to paste into email' });

  AetherFlow.exporters.register('brief-markdown', () => {
    const md = briefToMarkdown(grid.state.get('view') || [], grid.dataColumns());
    copyToClipboard(md).then((ok) => status.toast(ok ? 'Brief Markdown copied — paste anywhere' : 'Copy failed — copy manually', ok ? 'ok' : 'error'));
    AetherFlow.emit('audit:append', { action: 'export.brief-markdown', rows: (grid.state.get('view') || []).length });
  }, { stability: STABILITY.STABLE, description: 'Brief as Markdown (KPIs + current view table)' });

  AetherFlow.exporters.register('brief-email', () => {
    const text = briefToEmail({ rows: grid.state.get('view') || [], columns: grid.dataColumns(), sourceName: state.activeName, findings: grid.healthReport() });
    copyToClipboard(text).then((ok) => status.toast(ok ? 'Email summary copied — paste into your email' : 'Copy failed — copy manually', ok ? 'ok' : 'error'));
    AetherFlow.emit('audit:append', { action: 'export.brief-email', rows: (grid.state.get('view') || []).length });
  }, { stability: STABILITY.STABLE, description: 'Brief as a pure-English email summary' });

  // ---- commands (public SPI) --------------------------------------------
  const cmd = (name, title, keywords, hint, run, stability = STABILITY.STABLE) =>
    AetherFlow.commands.register(name, { title, keywords, hint, run }, { stability, description: title });

  cmd('import', 'Import local CSV / TSV', 'open file drop browse csv', '⌘K → import', pickFiles);
  cmd('recipes', 'Show saved import recipes', 'remember encoding delimiter choices per file review delete local', 'local only', () => openRecipeList({ vault }));
  cmd('restore', 'Restore .aether backup', 'backup checksum verify', 'local file', pickBackup);
  cmd('export-csv', 'Export current view as CSV', 'download excel csv', 'Excel-safe BOM', () => AetherFlow.get('exporters', 'csv')());
  cmd('export-backup', 'Export .aether backup', 'download portable backup checksum', 'keep it safe', () => AetherFlow.get('exporters', 'aether-backup')());
  cmd('save-folder', 'Save backup to a local synced folder', 'file system access icloud drive desktop', 'File System Access', () => AetherFlow.get('exporters', 'local-folder')());
  cmd('save-cleaning-recipe', 'Save cleaning recipe', 'remember reuse apply columns normalize trim', 'local only', async () => {
    if (!lastClean) { status.toast('Run "Clean data" first so a recipe can be captured', 'info'); return; }
    const name = (typeof window !== 'undefined' && typeof window.prompt === 'function')
      ? window.prompt('Name this cleaning recipe', 'My cleaning recipe') : null;
    if (!name) return;
    const recipe = buildRecipeFromCleanse(name.trim() || 'Untitled recipe', lastClean.rules, lastClean.fields);
    const saved = await grid.saveCleaningRecipe(recipe);
    status.toast(`Saved recipe "${saved.name}" — it will be recommended next time you open the Health Report`, 'ok', 6000);
  });
  cmd('share-html', 'Export Brief (read-only HTML)', 'brief report deliverable standalone offline boss email self-contained', 'one .html file', () => AetherFlow.get('exporters', 'snapshot-html')());
  cmd('export-markdown', 'Export Data Health Report (Markdown)', 'report markdown download health insights', 'privacy-safe', () => AetherFlow.get('exporters', 'report-markdown')());
  cmd('export-desensitized', 'Export desensitized CSV', 'pii mask anonymize safe share csv privacy', 'masked columns', () => AetherFlow.get('exporters', 'desensitized-csv')());
  cmd('copy-email', 'Copy report as email draft', 'email paste clipboard share markdown', 'privacy-safe', () => AetherFlow.get('exporters', 'copy-email-draft')());
  cmd('brief-markdown', 'Copy Brief as Markdown', 'brief markdown table kpi copy clipboard', 'KPIs + table', () => AetherFlow.get('exporters', 'brief-markdown')());
  cmd('brief-email', 'Copy Brief as email summary', 'brief email summary kpi issues clipboard', 'pure English', () => AetherFlow.get('exporters', 'brief-email')());
  cmd('brief-masked', 'Export Masked Brief (share-safe HTML)', 'brief mask pii redact share safe privacy html', 'masked columns', () => {
    const cols = grid.dataColumns();
    const pii = piiColumns(cols);
    if (!pii.length) { status.toast('No PII columns detected — nothing to mask', 'info'); return; }
    AetherFlow.get('exporters', 'snapshot-html-masked')(desensitizeRows(grid.state.get('view') || [], cols), pii.length);
  });
  cmd('validate-all', 'Validate all rows', 'check data quality rules errors', 'full table scan', async () => {
    filePanel.setProgress('Validating rows', 0);
    const n = await grid.validateAll((done, total) => filePanel.setProgress('Validating rows', Math.round((done / total) * 100)));
    filePanel.hideProgress();
    status.toast(n ? `${n.toLocaleString('en-US')} unresolved cell(s) flagged in red` : 'All cells pass validation', n ? 'error' : 'ok');
    AetherFlow.emit('audit:append', { action: 'validate', invalid: n });
  });
  cmd('clear-invalid', 'Clear unresolved markers', 'reset validation red', '', () => { grid.clearInvalid(); status.toast('Unresolved markers cleared', 'ok'); });
  cmd('issues', 'Show Unresolved (Manual Review Required)', 'validation errors list locate fix review', 'flagged cells', async () => {
    await grid.validateAll();
    openIssueList({ grid });
  });
  cmd('health', 'Run Data Health Report', 'scan missing type duplicate whitespace date scientific check', 'right panel', () => {
    openHealthReport({ grid, toast: (m, k, ms) => status.toast(m, k, ms) });
  });
  cmd('undo-delete', 'Undo last bulk delete', 'restore rows revert', 'one step', () => {
    const n = grid.undoLastBulk();
    if (n) status.toast(`Restored ${n.toLocaleString('en-US')} rows`, 'ok');
  });
  cmd('clean-data', 'Clean data (explicit: trim / collapse / dates / numbers)', 'normalize whitespace explicit opt-in', 'changes values', async () => {
    const rows = grid.state.get('rows');
    const fields = grid.dataColumns().map((c) => c.field);
    // Dry-run preview first: show impact, then apply on explicit approval.
    const changes = grid.cleansePreview(FULL_RULES, fields);
    openCleansePreview({
      changes,
      onApply: async () => {
        const n = grid.cleanseApply(FULL_RULES, fields);
        // Capture this successful action so it can be saved as a reusable recipe.
        lastClean = { rules: [...FULL_RULES], fields };
        if (n && !state.demo) {
          filePanel.setProgress('Storing cleaned rows', 0);
          try {
            await new IndexedDBAdapter(vault, state.activeFileId).importRows(
              state.activeFileId,
              { name: state.activeName, rowCount: rows.length, columns: grid.dataColumns(), updatedAt: Date.now() },
              rows,
              (done, total) => filePanel.setProgress('Storing cleaned rows', Math.round((done / total) * 100)),
            );
          } catch (err) {
            filePanel.hideProgress();
            status.toast(`Could not save cleaned rows — ${err.message}`, 'error', 9000);
            return;
          }
          filePanel.hideProgress();
        }
        await grid.recompute({ preserveScroll: true });
        grid.renderBody();
        status.toast(`Cleaned ${n.toLocaleString('en-US')} cells — undo available (⌘K → Undo clean)`, 'ok', 6000);
        AetherFlow.emit('audit:append', { action: 'clean', cells: n });
      },
    });
  });
  cmd('undo-cleanse', 'Undo last clean', 'revert restore cleanse values', 'one step', async () => {
    const rows = grid.state.get('rows');
    const n = grid.undoLastCleanse();
    if (!n) { status.toast('Nothing to undo', 'info'); return; }
    if (!state.demo) {
      filePanel.setProgress('Restoring values', 0);
      try {
        await new IndexedDBAdapter(vault, state.activeFileId).importRows(
          state.activeFileId,
          { name: state.activeName, rowCount: rows.length, columns: grid.dataColumns(), updatedAt: Date.now() },
          rows,
          (done, total) => filePanel.setProgress('Restoring values', Math.round((done / total) * 100)),
        );
      } catch (err) {
        filePanel.hideProgress();
        status.toast(`Could not save restored values — ${err.message}`, 'error', 9000);
        return;
      }
      filePanel.hideProgress();
    }
    await grid.recompute({ preserveScroll: true });
    grid.renderBody();
    status.toast(`Restored ${n.toLocaleString('en-US')} cell(s) to their pre-clean values`, 'ok', 6000);
  });
  cmd('chart', 'Chart the selected numeric column', 'visualize bars line graph', 'Canvas, zero deps', () => {
    const cols = grid.dataColumns();
    const numeric = cols.find((c) => ['number', 'currency'].includes(c.type)) || cols[0];
    if (!numeric) { status.toast('No numeric column to chart', 'error'); return; }
    chart.toggle({ rows: grid.selectedRows(), field: numeric.field, title: numeric.header });
  });
  cmd('byok', 'AI Rules · Bring Your Own Key', 'ai llm byok rules endpoint key schema suggest cleanse flag', 'your key, your endpoint', () => {
    // Opening the panel surfaces the right state: if no endpoint/key is set it
    // reveals the Configure prompt; if set, it focuses the instruction input.
    grid.openByokPanel();
  }, STABILITY.EXPERIMENTAL);
  cmd('stress-100k', 'Load 100,000-row stress demo', 'benchmark performance virtual scroll', 'in-memory', async () => {
    status.toast('Generating 100,000 rows…', 'info');
    await new Promise((r) => setTimeout(r, 20));
    await grid.setContext(DEMO_FILE_ID);
    grid.adapter = new MockAdapter(demoRows(DEMO_ROWS));
    grid.replaceColumns(demoColumns(), { layout: await storage.get(metaKey('layout', DEMO_FILE_ID)) });
    await grid.loadData();
    state.demo = true;
    state.activeFileId = DEMO_FILE_ID;
    state.activeName = 'demo-100k.csv';
    filePanel.setActive(null);
    status.toast('100,000 rows · DOM node count stays constant — check the HUD', 'ok', 5000);
  });
  cmd('toggle-hud', 'Toggle benchmark HUD', 'fps frame dom nodes', '', () => grid.toggleHud());
  cmd('toggle-filters', 'Toggle column filter row', 'hide show filter', '', () => {
    const row = grid.filterRow;
    grid.showFilterRow(row.style.display === 'none');
  });
  cmd('density', 'Cycle row density', 'compact comfortable relaxed spacing', 'desktop-grade', () => {
    const next = grid.cycleDensity();
    status.toast(`Row density: ${next}`, 'ok');
  });
  cmd('theme', 'Toggle light / dark theme', 'appearance colors', '', () => {
    const dark = !document.body.classList.contains('is-light');
    document.body.classList.toggle('is-light', dark);
    grid.setTheme(dark ? 'light' : 'dark');
  });
  cmd('focus-search', 'Focus global search', 'find filter text', 'all columns', () => {
    const input = grid.toolbar.querySelector('.zenith-search-input');
    if (input) input.focus();
  });
  cmd('reset-layout', 'Reset column layout', 'widths order hidden restore', 'reloads page', () => grid.resetLayout());
  cmd('egress', 'Show outbound request ledger', 'network privacy csp audit 0', 'must stay 0', () => {
    const n = AetherFlow.getLedger().length;
    status.toast(n ? `${n} outbound attempt(s) blocked` : '0 outbound data requests — CSP + guard both active', n ? 'error' : 'ok');
  });
  cmd('capabilities', 'Show this browser’s capabilities', 'platform indexeddb worker file system', '', async () => {
    const bits = [
      `Vault: ${vault.backend}`,
      `Persistent storage: ${persisted ? 'granted' : 'not granted'}`,
      `File System Access: ${typeof window.showSaveFilePicker === 'function' ? 'yes' : 'no'}`,
      `Module Workers: ${typeof Worker !== 'undefined' ? 'yes' : 'no'}`,
      `Outbound requests: ${AetherFlow.getLedger().length}`,
    ];
    status.toast(bits.join(' · '), 'info', 7000);
  });

  // Dynamic sort commands prove the registry is open to extension.
  for (const c of grid.dataColumns()) {
    for (const dir of ['asc', 'desc']) {
      cmd(`sort-${c.field}-${dir}`, `Sort ${c.header} ${dir === 'asc' ? 'ascending' : 'descending'}`,
        `sort ${c.header} ${dir}`, `column: ${c.field}`, () => {
          grid.state.set('sorters', [{ field: c.field, dir }]);
          grid.refreshSortIndicators();
          grid.recompute();
          grid._persistLayout();
        }, STABILITY.STABLE);
    }
  }

  const palette = new CommandPalette({ sdk: AetherFlow });

  // Expose ONLY the public API to the console / to extensions.
  window.AetherFlow = AetherFlow;
  AetherFlow.emit('plugin:loaded', { id: 'aether.sample-site', api: AetherFlow.apiVersion });

  // Toolbar hint: shortcut discoverability.
  document.getElementById('palette-hint').textContent =
    /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘K' : 'Ctrl+K';
}

boot().catch((err) => {
  console.error('[AetherFlow] boot failed:', err);
  const el = document.getElementById('boot-error');
  if (el) { el.style.display = 'block'; el.textContent = `Startup failed: ${err.message}`; }
});
