// ui/date-ambiguity.js — forced date-order resolution (M1, module D).
//
// When a column has slash-dates where BOTH parts are <= 12 (05/01/2024 could be
// May 1 or Jan 5), we MUST ask — never guess. This dialog returns a map of
// field name -> 'dmy' | 'mdy', or null if the user cancels (in which case the
// raw strings are kept and flagged, and NOT substituted with a guess).
//
// Pure DOM, no framework, no icon font. Keyboard reachable.

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

/**
 * @param {object} report  the PreviewReport (uses report.dateAmbiguity)
 * @param {(order: object|null) => void} onResolve  field->'dmy'|'mdy', or null
 * @param {() => void} onCancel
 * @returns {() => void} close()
 */
export function openDateAmbiguity({ report, onResolve, onCancel }) {
  const ambiguous = (report.dateAmbiguity || []).filter((d) => d.count > 0);
  const overlay = el('div', { class: 'af-modal-overlay', role: 'presentation' });
  const dialog = el('div', {
    class: 'af-modal af-date-ambiguity',
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'af-da-title',
  });

  const choices = {}; // field -> 'dmy' | 'mdy'
  const title = el('h2', { id: 'af-da-title', class: 'af-modal-title', text: 'Choose the date format' });
  const sub = el('p', { class: 'af-modal-sub', text: 'These columns contain dates where the day and month are both valid numbers. Pick the order so we never guess.' });

  const groups = el('div', { class: 'af-da-groups' });
  for (const d of ambiguous) {
    const name = d.colName;
    choices[name] = null;
    const sample = d.sample || '05/01/2024';
    const g = el('fieldset', { class: 'af-da-group' }, [
      el('legend', { text: `${name} · ${d.count} row(s)` }),
      el('p', { class: 'af-da-sample', text: `Example: ${sample}` }),
      el('label', { class: 'af-radio' }, [
        el('input', { type: 'radio', name: `da-${name}`, value: 'dmy', onchange: () => { choices[name] = 'dmy'; } }),
        el('span', { text: 'Day / Month / Year  (05/01/2024 → 2024-01-05)' }),
      ]),
      el('label', { class: 'af-radio' }, [
        el('input', { type: 'radio', name: `da-${name}`, value: 'mdy', onchange: () => { choices[name] = 'mdy'; } }),
        el('span', { text: 'Month / Day / Year  (05/01/2024 → 2024-05-01)' }),
      ]),
    ]);
    groups.appendChild(g);
  }

  const resolveBtn = el('button', { class: 'af-btn af-btn-primary', type: 'button', text: 'Apply' });
  const skipBtn = el('button', { class: 'af-btn', type: 'button', text: 'Skip — keep raw values' });
  const actions = el('div', { class: 'af-modal-actions' }, [skipBtn, resolveBtn]);

  function close() { overlay.remove(); document.removeEventListener('keydown', onKey, true); }
  function resolve() {
    // Only fields with a chosen order are returned; the rest stay raw + invalid.
    const out = {};
    for (const [k, v] of Object.entries(choices)) if (v) out[k] = v;
    close(); onResolve(out);
  }
  function skip() { close(); onResolve(null); }

  resolveBtn.addEventListener('click', resolve);
  skipBtn.addEventListener('click', skip);
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); skip(); }
    else if (e.key === 'Enter' && e.target.tagName !== 'INPUT') { e.preventDefault(); resolve(); }
  }
  document.addEventListener('keydown', onKey, true);

  dialog.append(title, sub, groups, actions);
  overlay.appendChild(dialog);
  (document.getElementById('app') || document.body).appendChild(overlay);
  resolveBtn.focus();
  return close;
}
