// ui/files.js — the right-hand "Local Files" tree (M2A: dual view).
//
// This is the file-first entry point. Each imported CSV becomes a descriptor
// in IndexedDB and appears here; the center Zenith grid renders whichever file
// is active. No directory is uploaded anywhere — only the user's own browser
// ever sees these bytes.
//
// setStorage() is deliberately blunt about the in-memory fallback: it is NOT
// device persistence, and a refresh discards everything.

export class FilePanel {
  constructor({ mount, onSelect, onDelete, onImportClick, onImportBackup }) {
    this.onSelect = onSelect;
    this.onDelete = onDelete;
    this.activeId = null;
    this.files = [];

    this.el = document.createElement('aside');
    this.el.className = 'af-files';

    const head = document.createElement('div');
    head.className = 'af-files-head';
    const headTitle = document.createElement('span');
    headTitle.textContent = 'Local files';
    this.countEl = document.createElement('span');
    this.countEl.className = 'af-files-count';
    this.countEl.textContent = '0';
    head.append(headTitle, this.countEl);

    this.progressWrap = document.createElement('div');
    this.progressWrap.className = 'af-progress';
    this.progressWrap.style.display = 'none';
    this.progressLabel = document.createElement('div');
    this.progressLabel.className = 'af-progress-label';
    this.progressTrack = document.createElement('div');
    this.progressTrack.className = 'af-progress-track';
    this.progressBar = document.createElement('div');
    this.progressBar.className = 'af-progress-bar';
    this.progressTrack.appendChild(this.progressBar);
    this.progressWrap.append(this.progressLabel, this.progressTrack);

    this.list = document.createElement('div');
    this.list.className = 'af-files-list';

    const actions = document.createElement('div');
    actions.className = 'af-files-actions';
    const btnImport = document.createElement('button');
    btnImport.className = 'af-btn af-btn-primary';
    btnImport.textContent = '+ Import CSV';
    btnImport.addEventListener('click', () => onImportClick?.());
    const btnRestore = document.createElement('button');
    btnRestore.className = 'af-btn';
    btnRestore.textContent = 'Restore .aether';
    btnRestore.addEventListener('click', () => onImportBackup?.());
    actions.append(btnImport, btnRestore);

    this.storageNote = document.createElement('div');
    this.storageNote.className = 'af-storage-note';
    this.storageNote.textContent = 'Checking storage backend…';

    this.el.append(head, this.progressWrap, this.list, actions, this.storageNote);
    mount.appendChild(this.el);
  }

  setFiles(files) {
    this.files = files.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    this.render();
  }

  setActive(id) { this.activeId = id; this.render(); }

  setStorage({ backend, persisted }) {
    // Memory is NOT "stored on this device": it is process memory and a refresh
    // wipes it. Say so plainly and push the user toward an explicit export.
    if (backend === 'memory') {
      this.storageNote.textContent =
        'TEMPORARY MODE · in-memory only — lost on refresh. Export a .aether backup now.';
      return;
    }
    this.storageNote.textContent =
      `Stored on this device · IndexedDB${persisted ? ' · persistent' : ''}`;
  }

  /** Real progress. `pct` may be null for indeterminate streams. */
  setProgress(label, pct) {
    this.progressWrap.style.display = 'block';
    const p = pct == null ? '' : ` · ${pct}%`;
    this.progressLabel.textContent = `${label}${p}`;
    this.progressBar.style.width = pct == null ? '35%' : `${Math.max(0, Math.min(100, pct))}%`;
    this.progressWrap.classList.toggle('is-indeterminate', pct == null);
  }
  hideProgress() {
    this.progressWrap.style.display = 'none';
    this.progressWrap.classList.remove('is-indeterminate');
  }

  render() {
    this.list.textContent = '';
    this.countEl.textContent = String(this.files.length);
    if (!this.files.length) {
      const empty = document.createElement('div');
      empty.className = 'af-files-empty';
      empty.innerHTML = 'No files yet.<br><b>Drop a CSV here</b> or double-click the grid area.<br><small>Nothing is uploaded — parsing happens in a Web Worker.</small>';
      this.list.appendChild(empty);
      return;
    }
    for (const f of this.files) {
      const item = document.createElement('div');
      item.className = 'af-file' + (f.id === this.activeId ? ' is-active' : '');
      const icon = document.createElement('span');
      icon.className = 'af-file-icon';
      icon.textContent = 'CSV';
      const body = document.createElement('div');
      body.className = 'af-file-body';
      const name = document.createElement('div');
      name.className = 'af-file-name';
      name.textContent = f.name || f.id;
      const meta = document.createElement('div');
      meta.className = 'af-file-meta';
      meta.textContent = `${(f.rowCount || 0).toLocaleString('en-US')} rows · ${formatBytes(f.size || 0)}`;
      body.append(name, meta);
      const del = document.createElement('button');
      del.className = 'af-file-del';
      del.title = 'Remove from this device';
      del.textContent = '×';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onDelete?.(f.id);
      });
      item.append(icon, body, del);
      item.addEventListener('click', () => this.onSelect?.(f.id));
      this.list.appendChild(item);
    }
  }
}

function formatBytes(n) {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
