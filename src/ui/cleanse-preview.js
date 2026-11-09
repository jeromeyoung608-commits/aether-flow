// ui/cleanse-preview.js — dry-run confirmation for the explicit "Clean data"
// command (M1, module F).
//
// Shows how many cells WOULD change and a few before -> after samples BEFORE any
// value is rewritten. The user approves or cancels; nothing is guessed and the
// change is always reversible via the one-step undo. Pure DOM, keyboard
// reachable, no network, no framework, no icon font.

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) n.appendChild(c);
  return n;
}

const MAX_SAMPLES = 6;

function previewCell(v) {
  const s = v == null ? '' : String(v);
  return el('code', { class: 'af-cp-cell', text: s === '' ? '∅' : s, title: s });
}

/**
 * @param {object} opts
 * @param {Array<{field:string, before:*, after:*}>} opts.changes
 * @param {() => void} opts.onApply
 * @param {() => void} opts.onCancel
 * @returns {() => void} close()
 */
export function openCleansePreview({ changes, onApply, onCancel } = {}) {
  const overlay = el('div', { class: 'af-modal-overlay', role: 'presentation' });
  const dialog = el('div', {
    class: 'af-modal af-cleanse-preview',
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'af-cp-title',
  });
  const title = el('h2', { id: 'af-cp-title', class: 'af-modal-title', text: 'Clean data?' });
  const sub = el('p', {
    class: 'af-modal-sub',
    text: changes.length
      ? `${changes.length} cell(s) will be rewritten. This is explicit and reversible — you can undo it in one step.`
      : 'Nothing would change — the data already matches the clean rules.',
  });

  const listWrap = el('div', { class: 'af-cp-list' });
  for (const c of changes.slice(0, MAX_SAMPLES)) {
    listWrap.appendChild(el('div', { class: 'af-cp-row' }, [
      el('span', { class: 'af-cp-field', text: c.field }),
      previewCell(c.before),
      el('span', { class: 'af-cp-arrow', text: '→' }),
      previewCell(c.after),
    ]));
  }
  if (changes.length > MAX_SAMPLES) {
    listWrap.appendChild(el('p', { class: 'af-cp-more', text: `…and ${changes.length - MAX_SAMPLES} more.` }));
  }

  const applyBtn = el('button', {
    class: 'af-btn af-btn-primary', type: 'button', text: 'Apply clean',
    disabled: changes.length === 0,
    onclick: () => { close(); onApply(); },
  });
  const cancelBtn = el('button', { class: 'af-btn', type: 'button', text: 'Cancel', onclick: () => { close(); if (onCancel) onCancel(); } });
  const actions = el('div', { class: 'af-modal-actions' }, [cancelBtn, applyBtn]);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); if (onCancel) onCancel(); }
    else if (e.key === 'Enter' && e.target.tagName !== 'INPUT') { e.preventDefault(); applyBtn.dispatch('click'); }
  }
  document.addEventListener('keydown', onKey, true);

  dialog.append(title, sub, listWrap, actions);
  overlay.appendChild(dialog);
  (document.getElementById('app') || document.body).appendChild(overlay);
  if (changes.length) applyBtn.focus(); else cancelBtn.focus();
  return close;
}
