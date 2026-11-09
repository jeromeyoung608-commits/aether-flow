// ui/issue-list.js — issue list + locate + batch fix (M1, module E).
//
// Surfaces every flagged cell (the grid's `invalid` Map) in one keyboard-
// reachable panel. Each issue can be located (scroll + focus the exact cell),
// and — where a lossless trim resolves it — fixed in bulk. No network, no
// framework, no icon font: same constraints as the other modals.

/**
 * Build a structured list of invalid cells from the grid's invalid Map.
 * Pure: takes the Map and the column descriptors, returns plain objects.
 * @param {Map<string,string>} invalid  keyed `${rowId}:${field}` -> message
 * @param {Array<{field?:string,name?:string,validate?:string|Function}>} columns
 * @returns {Array<{rowId:string,field:string,colName:string,message:string}>}
 */
export function buildIssueIndex(invalid, columns) {
  const byField = new Map();
  for (const c of columns) if (c && c.field) byField.set(c.field, c);
  const out = [];
  for (const [key, message] of invalid.entries()) {
    const sep = key.lastIndexOf(':');
    if (sep < 0) continue;
    const rowId = key.slice(0, sep);
    const field = key.slice(sep + 1);
    const col = byField.get(field);
    out.push({
      rowId,
      field,
      colName: (col && (col.name || col.field)) || field,
      message: String(message || ''),
    });
  }
  return out;
}

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

/**
 * Open the issue list dialog.
 * @param {object} opts
 * @param {{state:object, columns:Array, focusCell:Function, clearInvalid:Function, fixInvalidByTrimming:Function}} opts.grid
 *        any object exposing the grid surface issue-list needs (a real Grid or a test mock)
 * @param {() => void} [opts.onClose]
 * @returns {() => void} close()
 */
export function openIssueList({ grid, onClose } = {}) {
  const invalid = (grid.state && grid.state.get('invalid')) || new Map();
  const columns = (grid.columns || []).filter((c) => c && c.field);
  const issues = buildIssueIndex(invalid, columns);

  const overlay = el('div', { class: 'af-modal-overlay', role: 'presentation' });
  const dialog = el('div', {
    class: 'af-modal af-issue-list',
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'af-il-title',
  });
  const title = el('h2', { id: 'af-il-title', class: 'af-modal-title', text: 'Unresolved (Manual Review Required)' });
  const sub = el('p', { class: 'af-modal-sub' });
  const note = el('p', { class: 'af-modal-note', text: 'These cells could not be auto-corrected by the rules engine. They are preserved exactly as imported — nothing was silently changed or dropped. Review or fix them manually.' });

  const listWrap = el('div', { class: 'af-il-list' });

  function renderList() {
    const current = buildIssueIndex((grid.state && grid.state.get('invalid')) || new Map(), columns);
    sub.textContent = current.length
      ? `${current.length} unresolved cell(s). Locate jumps to the exact cell; "Fix whitespace" resolves the lossless ones below.`
      : 'No unresolved cells — every cell passes validation.';
    listWrap.replaceChildren();
    if (!current.length) return;
    for (const issue of current) {
      const row = el('div', { class: 'af-il-row' }, [
        el('div', { class: 'af-il-meta' }, [
          el('span', { class: 'af-il-col', text: issue.colName }),
          el('span', { class: 'af-il-rowid', text: `Row ${issue.rowId}` }),
          el('span', { class: 'af-il-msg', text: issue.message }),
        ]),
        el('button', {
          class: 'af-btn af-btn-sm af-il-locate', type: 'button', text: 'Locate',
          onclick: () => { close(); grid.focusCell(issue.rowId, issue.field); },
        }),
      ]);
      listWrap.appendChild(row);
    }
  }

  const clearBtn = el('button', {
    class: 'af-btn', type: 'button', text: 'Clear all markers',
    onclick: () => { grid.clearInvalid(); close(); },
  });
  const fixBtn = el('button', {
    class: 'af-btn', type: 'button', text: 'Fix whitespace',
    onclick: async () => {
      const n = await grid.fixInvalidByTrimming();
      if (n) sub.textContent = `Trimmed ${n} cell(s) into validity. Remaining issues shown below.`;
      renderList();
    },
  });
  const closeBtn = el('button', { class: 'af-btn af-btn-primary', type: 'button', text: 'Close' });
  const actions = el('div', { class: 'af-modal-actions' }, [clearBtn, fixBtn, closeBtn]);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    if (onClose) onClose();
  }
  closeBtn.addEventListener('click', close);
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter' && e.target.tagName !== 'INPUT') { e.preventDefault(); close(); }
  }
  document.addEventListener('keydown', onKey, true);

  renderList();
  dialog.append(title, sub, note, listWrap, actions);
  overlay.appendChild(dialog);
  (document.getElementById('app') || document.body).appendChild(overlay);
  closeBtn.focus();
  return close;
}
