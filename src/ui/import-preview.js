// ui/import-preview.js — pre-import gate modal (M1, module C).
//
// Shows the 20-row preview plus four overridable controls (encoding, delimiter,
// header row, skip rows) BEFORE any row is written. Changing a control
// re-renders the preview locally from the decoded head — no Worker, no network.
//
// Pure DOM, no framework, no icon font. Keyboard reachable: focus moves into the
// dialog on open, Esc cancels, Enter confirms (unless you are typing in a field).

import { parsePreview, sniffDelimiter } from '../utils/csv.js';

const ENCODINGS = ['utf-8', 'utf-16le', 'utf-16be', 'gbk', 'windows-1252'];
const DELIMS = [
  { v: ',', label: 'Comma ,' },
  { v: ';', label: 'Semicolon ;' },
  { v: '\t', label: 'Tab' },
  { v: '|', label: 'Pipe |' },
];

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) n.appendChild(c);
  return n;
}

function formatBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Open the import preview dialog.
 * @param {object} report  the PreviewReport from Ingest.scan()
 * @param {(opts: object) => void} onConfirm  called with the chosen overrides
 * @param {() => void} onCancel
 * @returns {() => void} close()
 */
export function openImportPreview({ report, onConfirm, onCancel, defaults, rememberDefault }) {
  const overlay = el('div', { class: 'af-modal-overlay', role: 'presentation' });
  const dialog = el('div', {
    class: 'af-modal af-import-preview',
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'af-ip-title',
  });

  // A saved recipe (if any) wins over the freshly-detected values, so the same
  // file imports consistently across sessions. Detection is the fallback.
  const state = {
    encoding: (defaults && defaults.encoding) || report.encoding || 'utf-8',
    delimiter: (defaults && defaults.delimiter) || report.delimiter || ',',
    headerRow: (defaults && defaults.headerRow) != null ? defaults.headerRow : (report.headerRow || 0),
    skipRows: (defaults && defaults.skipRows) != null ? defaults.skipRows : (report.skipRows || 0),
    remember: !!(rememberDefault || (defaults && defaults.remember)),
  };

  const title = el('h2', { id: 'af-ip-title', class: 'af-modal-title', text: 'Confirm import' });
  const subtitle = el('p', { class: 'af-modal-sub' });
  subtitle.textContent = `${report.name || 'data.csv'} · ${formatBytes(report.size)} · detected delimiter ${JSON.stringify(report.delimiter)}`;

  // --- override controls -----------------------------------------------------
  const encodingSel = el('select', { class: 'af-input', 'aria-label': 'Encoding' },
    ENCODINGS.map((e) => el('option', { value: e, text: e.toUpperCase(), selected: e === state.encoding })));
  // Ensure the detected candidate is always selectable even if outside the list.
  if (!ENCODINGS.includes(report.encoding)) {
    encodingSel.appendChild(el('option', { value: report.encoding, text: `${report.encoding.toUpperCase()} (detected)`, selected: true }));
  }

  const delimSel = el('select', { class: 'af-input', 'aria-label': 'Delimiter' },
    DELIMS.map((d) => el('option', { value: d.v, text: d.label, selected: d.v === state.delimiter })));
  const delimCustom = el('input', {
    class: 'af-input af-input-sm', type: 'text', maxlength: '1', 'aria-label': 'Custom delimiter',
    placeholder: 'custom', value: DELIMS.some((d) => d.v === state.delimiter) ? '' : state.delimiter,
  });

  const headerInput = el('input', {
    class: 'af-input af-input-sm', type: 'number', min: '0', 'aria-label': 'Header row (0-based line)', value: String(state.headerRow),
  });
  const skipInput = el('input', {
    class: 'af-input af-input-sm', type: 'number', min: '0', 'aria-label': 'Skip rows before header', value: String(state.skipRows),
  });

  const controls = el('div', { class: 'af-ip-controls' }, [
    el('label', { class: 'af-ip-field' }, [el('span', { text: 'Encoding' }), encodingSel]),
    el('label', { class: 'af-ip-field' }, [el('span', { text: 'Delimiter' }), delimSel, delimCustom]),
    el('label', { class: 'af-ip-field' }, [el('span', { text: 'Header row' }), headerInput]),
    el('label', { class: 'af-ip-field' }, [el('span', { text: 'Skip rows' }), skipInput]),
  ]);

  // --- preview table ---------------------------------------------------------
  const tableWrap = el('div', { class: 'af-ip-tablewrap' });

  // --- warnings / ambiguity --------------------------------------------------
  const notes = el('div', { class: 'af-ip-notes' });
  for (const w of report.warnings || []) notes.appendChild(el('p', { class: 'af-note', text: w }));
  if (report.ambiguous) {
    notes.appendChild(el('p', { class: 'af-note af-note-warn', text: 'Encoding was guessed — verify the preview text is readable before importing.' }));
  }
  if (report.dateAmbiguity && report.dateAmbiguity.length) {
    const cols = report.dateAmbiguity.map((d) => `${d.colName} (${d.count})`).join(', ');
    notes.appendChild(el('p', {
      class: 'af-note af-note-warn',
      text: `Ambiguous dates in: ${cols}. You will be asked to choose the order (DD/MM vs MM/DD) before import — nothing is guessed silently.`,
    }));
  }

  const confirmBtn = el('button', { class: 'af-btn af-btn-primary', type: 'button', text: 'Confirm import' });
  const cancelBtn = el('button', { class: 'af-btn', type: 'button', text: 'Cancel' });
  const rememberChk = el('input', { type: 'checkbox', id: 'af-ip-remember', class: 'af-checkbox' });
  rememberChk.checked = state.remember;
  const rememberLabel = el('label', { class: 'af-ip-remember', for: 'af-ip-remember' }, [
    rememberChk, el('span', { text: 'Remember these choices for this file' }),
  ]);
  const actions = el('div', { class: 'af-modal-actions' }, [rememberLabel, cancelBtn, confirmBtn]);

  function renderTable() {
    const maxCols = 8;
    const p = parsePreview(report.text || '', {
      delimiter: state.delimiter, skipRows: state.skipRows, maxRows: 20,
    });
    const header = p.header.slice(0, maxCols);
    const extra = p.header.length - header.length;
    const thead = el('thead', {}, [el('tr', {}, header.map((h, i) =>
      el('th', { text: String(h || p.fields[i] || `col_${i + 1}`) })))]);
    if (extra > 0) thead.firstChild.appendChild(el('th', { text: `+${extra} more…` }));
    const tbody = el('tbody', {});
    for (const r of p.rows) {
      const tr = el('tr', {});
      for (let i = 0; i < header.length; i++) {
        const f = p.fields[i];
        tr.appendChild(el('td', { text: r[f] == null ? '' : String(r[f]) }));
      }
      if (extra > 0) tr.appendChild(el('td', { class: 'af-muted', text: r.__extra ? `+${r.__extra.length} extra` : '' }));
      tbody.appendChild(tr);
    }
    tableWrap.replaceChildren(el('table', { class: 'af-ip-table' }, [thead, tbody]));
    subtitle.textContent = `${report.name || 'data.csv'} · ${formatBytes(report.size)} · ${p.rows.length} preview rows`;
  }

  function recompute() {
    state.encoding = encodingSel.value;
    const custom = delimCustom.value;
    state.delimiter = custom ? custom : delimSel.value;
    state.headerRow = Math.max(0, parseInt(headerInput.value, 10) || 0);
    state.skipRows = Math.max(0, parseInt(skipInput.value, 10) || 0);
    renderTable();
  }

  encodingSel.addEventListener('change', recompute);
  delimSel.addEventListener('change', () => { delimCustom.value = ''; recompute(); });
  delimCustom.addEventListener('input', recompute);
  headerInput.addEventListener('input', recompute);
  skipInput.addEventListener('input', recompute);

  function close() { overlay.remove(); document.removeEventListener('keydown', onKey, true); }
  function cancel() { close(); if (onCancel) onCancel(); }
  function confirm() { close(); if (onConfirm) onConfirm({ ...state, remember: rememberChk.checked }); }

  cancelBtn.addEventListener('click', cancel);
  confirmBtn.addEventListener('click', confirm);
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if (e.key === 'Enter') {
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
      if (!typing) { e.preventDefault(); confirm(); }
    }
  }
  document.addEventListener('keydown', onKey, true);

  dialog.append(title, subtitle, controls, notes, tableWrap, actions);
  overlay.appendChild(dialog);
  (document.getElementById('app') || document.body).appendChild(overlay);

  renderTable();
  // Move focus into the dialog for keyboard users.
  confirmBtn.focus();

  return close;
}
