// ui/byok-preview.js — confirm-before-apply dialog for a BYOK instruction.
//
// BYOK executes LOCALLY. This dialog is the gate: it shows the concrete impact
// (cells to be cleansed, dates to normalize, rows to flag) and any warnings
// from the trust-boundary validation, and only applies when the user confirms.

import { el } from '../utils/dom.js';

/**
 * @param {object} opts
 * @param {object} opts.preview { cleanseChanges:Array, dateChanges:number, flaggedCount:number }
 * @param {string[]} [opts.warnings]
 * @param {Function} opts.onApply
 * @param {Function} [opts.onCancel]
 */
export function openByokPreview({ preview, warnings = [], onApply, onCancel }) {
  const cleansed = (preview && preview.cleanseChanges) ? preview.cleanseChanges.length : 0;
  const dates = (preview && preview.dateChanges) || 0;
  const flagged = (preview && preview.flaggedCount) || 0;

  const summary = el('ul', { class: 'af-byok-impact' }, [
    impactRow('Cells to clean', cleansed, 'value edits you can undo'),
    impactRow('Dates to normalize', dates, 'ISO conversion by your chosen order'),
    impactRow('Rows to flag for review', flagged, 'highlighted, not deleted'),
  ]);

  const warnChildren = [
    el('div', { class: 'af-byok-warn-title' }, 'The model suggested things AetherFlow ignored:'),
  ];
  for (const w of (warnings || [])) {
    warnChildren.push(el('div', { class: 'af-byok-warn-item' }, `• ${w}`));
  }
  const warn = (warnings && warnings.length) ? el('div', { class: 'af-byok-warn' }, warnChildren) : null;

  const applyBtn = el('button', {
    class: 'af-btn af-btn-primary', type: 'button',
    onClick: () => { close(); onApply && onApply(); },
  }, 'Apply locally');
  const cancelBtn = el('button', {
    class: 'af-btn', type: 'button',
    onClick: () => { close(); onCancel && onCancel(); },
  }, 'Cancel');

  const panel = el('div', {
    class: 'af-modal af-byok-preview', role: 'dialog', 'aria-modal': 'true',
    'aria-label': 'Confirm AI suggestion',
  }, [
    el('div', { class: 'af-modal-head' }, [
      el('span', { class: 'af-modal-title' }, 'Apply AI suggestion — local only'),
      el('button', { class: 'af-modal-close', type: 'button', onClick: () => close() }, '×'),
    ]),
    el('p', { class: 'af-modal-note' },
      'Nothing leaves this device. The rules below run locally and you can undo the cell edits afterwards.'),
    summary,
    warn,
    el('div', { class: 'af-modal-foot' }, [cancelBtn, applyBtn]),
  ]);

  const backdrop = el('div', { class: 'af-modal-backdrop' }, [panel]);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });

  function impactRow(label, n, sub) {
    return el('li', { class: 'af-byok-impact-row' }, [
      el('span', { class: 'af-byok-impact-n' }, String(n)),
      el('span', { class: 'af-byok-impact-label' }, [el('b', {}, label), el('span', { class: 'af-byok-impact-sub' }, sub)]),
    ]);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); onCancel && onCancel(); }
    else if (e.key === 'Enter') { e.preventDefault(); applyBtn.click(); }
  }
  document.addEventListener('keydown', onKey);

  function close() {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
  }

  document.body.appendChild(backdrop);
  requestAnimationFrame(() => applyBtn.focus());
}
