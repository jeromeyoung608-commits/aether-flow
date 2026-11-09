// backup.js — .aether portable backup (the honest answer to "IndexedDB isn't permanent").
//
// Calibration C1: browsers MAY evict site data under storage pressure, and
// clearing site data / switching devices always loses it. So AetherFlow never
// claims "permanent storage". Instead it ships:
//   1. navigator.storage.persist()        — ask the browser not to evict
//   2. a last-activity marker            — a timestamp, NOT a data copy
//   3. explicit .aether export            — SHA-256 checksum, portable file
//   4. pre-unload reminder                — never lose edits silently
//   5. File System Access "save to folder" — user picks a LOCAL synced folder
//      (iCloud Drive / Drive Desktop); sync is done by their installed client.
//      no third-party sign-in, no cloud API, no network. (Calibration C2)
//
// 0.1.1 honesty fixes:
//   * `startSnapshotTimer` was described as "periodic snapshots" but only
//     wrote a timestamp. It is now named and worded as a last-activity marker;
//     ONLY an exported .aether file can restore lost data.
//   * Restore stages all rows first and swaps `files` + `meta` in ONE
//     transaction. A failure at 90% no longer erases the current workspace.
//   * The checksum detects ACCIDENTAL CORRUPTION only. It is not a signature
//     or an authentication code: anyone who can edit the file can recompute it.

import { computeChecksum, verifyChecksum, stableStringify } from '../utils/checksum.js';
import { downloadText } from '../utils/csv.js';

export const BACKUP_FORMAT = 'aether';
export const BACKUP_VERSION = 1;
export const META_LAST_ACTIVITY = 'lastActivity';

/** Read everything needed to reconstruct the workspace (live rows only). */
export async function collectBackup(vault) {
  const [files, meta] = await Promise.all([
    vault.getAll('files'), vault.getAll('meta'),
  ]);
  const rows = [];
  for (const f of files) {
    const live = await vault.getRows(f.id);
    for (const r of live) rows.push({ ...r, owner: f.id });
  }
  return {
    files,
    rows,
    meta: Object.fromEntries((meta || []).map((m) => [m.key, m.value])),
  };
}

export async function buildBackup(vault) {
  const payload = await collectBackup(vault);
  const checksum = await computeChecksum(stableStringify(payload));
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    checksum,
    payload,
  };
}

function filename() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `aether-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.aether`;
}

export async function exportBackup(vault) {
  const backup = await buildBackup(vault);
  downloadText(filename(), JSON.stringify(backup), 'application/json;charset=utf-8');
  return backup;
}

/**
 * M1A: let the user choose a LOCAL folder (e.g. their iCloud Drive directory).
 * The browser never talks to a cloud service — the user's own sync client does.
 * Falls back to a normal download when the API is unavailable (Safari/Firefox).
 * @returns {Promise<'picker'|'download'>}
 */
export async function saveBackupToLocalFolder(vault) {
  const backup = await buildBackup(vault);
  const text = JSON.stringify(backup);
  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename(),
        types: [{ description: 'AetherFlow backup', accept: { 'application/json': ['.aether'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return 'picker';
    } catch (err) {
      if (err && err.name === 'AbortError') throw err; // user cancelled: don't fall back
      // any other picker failure -> ordinary download
    }
  }
  downloadText(filename(), text, 'application/json;charset=utf-8');
  return 'download';
}

/**
 * Verify + restore. Throws on unsupported version or checksum mismatch.
 * On ANY failure the current workspace is left untouched — see
 * `vault.restoreAtomically()` in storage/idb.js.
 */
export async function restoreBackup(file, vault, onProgress) {
  const text = await file.text();
  let backup;
  try { backup = JSON.parse(text); }
  catch (_) { throw new Error('Not a valid .aether file (bad JSON).'); }

  if (backup.format !== BACKUP_FORMAT) throw new Error('Unrecognized backup format.');
  if (backup.version > BACKUP_VERSION) throw new Error('Backup was written by a newer AetherFlow version.');
  const { algorithm, value } = backup.checksum || {};
  const ok = await verifyChecksum(stableStringify(backup.payload), algorithm, value);
  if (!ok) throw new Error('Checksum mismatch — the backup is corrupted or was altered. Export a fresh copy.');

  const result = await vault.restoreAtomically(backup.payload, onProgress);
  return {
    files: result.files,
    rows: result.rows,
    algorithm,
    createdAt: backup.createdAt,
  };
}

/** Ask the browser for persistent storage. Never throws. */
export async function requestPersistence() {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      const already = await navigator.storage.persisted?.();
      return already || await navigator.storage.persist();
    }
  } catch (_) { /* ignore */ }
  return false;
}

/**
 * A LAST-ACTIVITY MARKER, not a backup. It writes one small timestamp so the
 * status bar can say "Last activity N min ago". It copies NO data and cannot
 * recover anything after eviction. The only real recovery is a .aether export.
 * Returns a stop() function.
 */
export function startActivityTimer(vault, state, intervalMs = 5 * 60 * 1000, onTick) {
  const tick = async () => {
    try {
      const files = await vault.getAll('files');
      const meta = await vault.get('meta', 'layout');
      await vault.put('meta', {
        key: META_LAST_ACTIVITY,
        value: { at: Date.now(), files: files.length, hasLayout: !!meta },
      });
      if (onTick) onTick(Date.now());
    } catch (_) { /* vault may be unavailable; the marker is best-effort */ }
  };
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}

/** Backwards-compatible alias for older call sites. */
export const startSnapshotTimer = startActivityTimer;

/** Warn only when there are un-backed-up changes. */
export function installUnloadGuard(state) {
  if (typeof window === 'undefined') return () => {};
  const handler = (e) => {
    if (!state.dirtySinceBackup) return;
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}
