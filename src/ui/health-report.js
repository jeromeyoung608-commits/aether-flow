// ui/health-report.js - Data Health Report side panel (M1, module B) + Final
// Polish (points one, two, three).
//
// What it now does, on top of the original scan:
//   * A Region/Industry Rule Pack switch at the top. A region/industry pack is
//     NEVER applied automatically — us.md §1 and README §3 require an explicit
//     declaration. The engine may *suggest* one from the headers (e.g. an `ssn`
//     column -> "US"), shown as a "Detected … enable above" hint, but the user
//     must opt in from the dropdown (progressive disclosure).
//   * Every finding carries its source Rule Pack label + id (or "Built-in").
//   * Rule Pack fixable findings: Info severity -> one-click Apply; Warning
//     severity -> Diff preview + Approve (full-chain dry-run). Unresolved ->
//     Flag (preserved as-is, never auto-changed).
//   * A Business Insights section (overlapping subscriptions + hidden fees)
//     with one-click locate and "Copy Insights to Markdown".
//   * A footer to copy / export the whole report as Markdown.
//
// Pure DOM, no framework, no icon font, keyboard reachable.

import { openCleansePreview } from './cleanse-preview.js';
import { reportToMarkdown, insightsToMarkdown } from '../io/report-md.js';
import { dryRunRecipe } from '../io/cleaning-recipes.js';

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

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

/**
 * Open the Data Health Report panel.
 * @param {object} opts
 * @param {{healthReport:Function, insights:Function, cleansePreview:Function, cleanseApply:Function, markUnresolved:Function, dataColumns:Function, packOptions:Array, setRulePack:Function, rulePackHint:Function, applyRulePackFix:Function, flagRows:Function}} opts.grid
 * @param {Function} [opts.toast]
 * @param {() => void} [opts.onClose]
 * @returns {() => void} close()
 */
export function openHealthReport({ grid, toast, onClose } = {}) {
  const existingByok = document.querySelector('.af-byok');
  if (existingByok) existingByok.remove();

  const findings = grid.healthReport();
  const overlay = el('div', { class: 'af-health-overlay', role: 'presentation' });
  const panel = el('div', {
    class: 'af-health', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'af-hr-title',
  });
  const title = el('h2', { id: 'af-hr-title', class: 'af-modal-title', text: 'Data Health Report' });

  // ---- Rule Pack switch (progressive disclosure) ----
  const packBar = el('div', { class: 'af-hr-packbar' });
  const packSelect = el('select', {
    class: 'af-select', 'aria-label': 'Rule pack',
    onchange: (e) => { grid.setRulePack(e.target.value); refresh(); },
  });
  for (const opt of (grid.packOptions || [])) {
    const o = el('option', { value: opt.id, text: opt.label });
    packSelect.appendChild(o);
  }
  packSelect.value = grid.activePack === 'General' ? 'General' : grid.activePack;
  const packHint = el('div', { class: 'af-hr-packhint', 'data-kind': 'muted' });
  packBar.append(el('label', { class: 'af-hr-packlabel', text: 'Rule pack' }), packSelect, packHint);

  const sub = el('p', { class: 'af-modal-sub' });
  const list = el('div', { class: 'af-hr-list' });
  const insightsWrap = el('div', { class: 'af-hr-insights' });
  const recipesWrap = el('div', { class: 'af-hr-recipes' });

  // ---- M2-1: recommend saved cleaning recipes relevant to these columns -----
  // Loaded async so opening the panel stays instant. A recommendation appears
  // only when at least one of the recipe's target columns exists here, and the
  // Apply action runs a dry-run preview before anything is written.
  async function loadRecipes() {
    recipesWrap.replaceChildren();
    let recs = [];
    try { if (grid.recommendCleaningRecipes) recs = await grid.recommendCleaningRecipes(); }
    catch { recs = []; }
    if (!recs || !recs.length) return;
    recipesWrap.appendChild(el('h3', { class: 'af-hr-recipes-title', text: 'Suggested Recipe' }));
    for (const { recipe, matchedFields } of recs) {
      const stepLabel = recipe.steps.map((s) => s.rules.join(' + ')).join('; ');
      const card = el('div', { class: 'af-hr-recipe' }, [
        el('div', { class: 'af-hr-recipe-head' }, [
          el('span', { class: 'af-hr-recipe-name', text: recipe.name }),
          el('span', { class: 'af-hr-recipe-match', text: `${matchedFields.length} matching column(s)` }),
        ]),
        el('p', { class: 'af-hr-recipe-detail', text: `Actions: ${stepLabel}` }),
        el('div', { class: 'af-hr-recipe-actions' }, [
          el('button', {
            class: 'af-btn af-btn-sm', type: 'button', text: 'Apply (dry-run)',
            onclick: async () => {
              const rows = (grid.selectedRows && grid.selectedRows().length)
                ? grid.selectedRows() : (grid.state.get('rows') || []);
              const cols = grid.dataColumns();
              const typeOf = Object.fromEntries(cols.map((c) => [c.field, c.type]));
              const changes = dryRunRecipe(recipe, rows, typeOf);
              openCleansePreview({
                changes,
                onApply: async () => {
                  if (grid.applyCleaningRecipe) await grid.applyCleaningRecipe(recipe);
                  if (toast) toast(`Applied recipe "${recipe.name}"`, 'ok');
                  refresh();
                },
              });
            },
          }),
          el('button', {
            class: 'af-btn af-btn-sm af-btn-ghost', type: 'button', text: 'Delete',
            onclick: async () => {
              if (grid.deleteCleaningRecipe) { await grid.deleteCleaningRecipe(recipe.id); loadRecipes(); }
            },
          }),
        ]),
      ]);
      recipesWrap.appendChild(card);
    }
  }

  function renderPackHint() {
    const hint = grid.rulePackHint();
    if (grid.activePack === 'General' && hint) {
      // Header inference only SUGGESTS a pack; it is not applied until the user
      // enables it. We must not imply automatic application.
      packHint.dataset.kind = 'suggested';
      packHint.textContent = `Detected ${hint.label} from your headers — select it above to enable region rules. Not applied automatically.`;
    } else if (grid.activePack === 'General') {
      packHint.dataset.kind = 'muted';
      packHint.textContent = 'General rules only (no region/industry detected).';
    } else {
      packHint.dataset.kind = 'manual';
      packHint.textContent = `Active: ${grid.activePack} (you enabled it explicitly).`;
    }
  }

  function refresh() {
    const current = grid.healthReport();
    const cols = grid.dataColumns().length;
    const unresolved = current.filter((f) => f.kind === 'unresolved').length;
    sub.textContent = current.length
      ? `${current.length} finding(s) across ${cols} column(s) · ${unresolved} need manual review. Nothing was changed.`
      : 'No health issues — every cell passes the checks.';
    list.replaceChildren();
    if (!current.length) list.appendChild(el('p', { class: 'af-hr-empty', text: 'Clean sheet.' }));
    for (const f of current) list.appendChild(renderFinding(f));
    renderPackHint();
    renderInsights().catch(() => {}); // async (Worker); best-effort, never blocks open
  }

  function renderFinding(f) {
    const sevClass = f.severity === 'High' ? 'af-sev-high' : f.severity === 'Medium' ? 'af-sev-medium' : 'af-sev-info';
    const packTag = f.pack
      ? el('span', { class: 'af-hr-packtag', text: `${f.pack.label} · ${f.pack.id}` })
      : el('span', { class: 'af-hr-packtag af-hr-packtag-builtin', text: 'Built-in' });
    const head = el('div', { class: 'af-hr-head' }, [
      el('span', { class: 'af-hr-cat', text: f.category }),
      el('span', { class: `af-sev ${sevClass}`, text: f.severity }),
    ]);
    const meta = el('div', { class: 'af-hr-meta' }, [
      el('span', { class: 'af-hr-field', text: f.fieldName ? `${f.fieldName} · ${f.affectedRows} row(s)` : `${f.affectedRows} row(s)` }),
      packTag,
    ]);
    const sug = el('p', { class: 'af-hr-sug', text: f.suggestion });

    const actions = el('div', { class: 'af-hr-actions' });
    const isPack = f.preset && f.preset.rulePack;
    if (f.kind === 'fixable' && f.preset) {
      if (isPack && f.severity === 'Info') {
        // Safe one-click rewrite (e.g. trimmed/normalized). Still reversible.
        actions.appendChild(el('button', {
          class: 'af-btn af-btn-sm', type: 'button', text: 'Apply',
          onclick: () => {
            const n = grid.applyRulePackFix(f.preset);
            if (toast) toast(`${n} cell(s) rewritten by ${f.pack.label} (undo any time)`, 'ok');
            refresh();
          },
        }));
      } else if (isPack) {
        // Warning: show Diff + Approve (full-chain dry-run).
        actions.appendChild(el('button', {
          class: 'af-btn af-btn-sm', type: 'button', text: 'Review diff',
          onclick: () => {
            openCleansePreview({
              changes: f.preset.fixes,
              onApply: () => {
                const n = grid.applyRulePackFix(f.preset);
                if (toast) toast(`${n} cell(s) rewritten by ${f.pack.label}`, 'ok');
                refresh();
              },
            });
          },
        }));
      } else {
        // Built-in cleanse preset.
        actions.appendChild(el('button', {
          class: 'af-btn af-btn-sm', type: 'button', text: 'Apply',
          onclick: () => {
            const changes = grid.cleansePreview(f.preset.rules, f.preset.fields);
            openCleansePreview({
              changes,
              onApply: () => { grid.cleanseApply(f.preset.rules, f.preset.fields); refresh(); },
            });
          },
        }));
      }
    } else if (f.kind === 'unresolved') {
      actions.appendChild(el('button', {
        class: 'af-btn af-btn-sm af-btn-warn', type: 'button', text: 'Flag',
        onclick: () => {
          const cols = f.field ? [f.field] : grid.dataColumns().map((c) => c.field);
          const entries = [];
          for (const id of f.ids || []) for (const field of cols) entries.push({ id, field, message: `${f.category} — preserved as-is` });
          const n = grid.markUnresolved(entries);
          if (toast) toast(`${n} cell(s) flagged Unresolved (preserved as-is)`, 'info');
          close();
        },
      }));
    }
    return el('div', { class: `af-hr-row af-hr-${f.kind}` }, [head, meta, sug, actions]);
  }

  async function renderInsights() {
    const insights = await grid.insights();
    insightsWrap.replaceChildren();
    if (!insights.length) return;
    insightsWrap.appendChild(el('h3', { class: 'af-hr-insights-title', text: '💡 Insight' }));
    const insList = el('div', { class: 'af-hr-insights-list' });
    for (const i of insights) {
      const impact = i.amount != null
        ? el('div', { class: 'af-hr-insight-impact' }, [
          el('span', { class: 'af-hr-insight-impact-label', text: 'Estimated Impact' }),
          el('span', { class: 'af-hr-insight-amount', text: `${i.currency}${i.amount.toLocaleString('en-US')}${i.annualized ? '/yr' : ''}` }),
        ])
        : null;
      const card = el('div', { class: 'af-hr-insight' }, [
        el('div', { class: 'af-hr-insight-head' }, [
          el('span', { class: 'af-hr-insight-title', text: i.title }),
          impact,
        ]),
        el('p', { class: 'af-hr-insight-detail', text: i.detail }),
        el('div', { class: 'af-hr-insight-actions' }, [
          el('button', {
            class: 'af-btn af-btn-sm', type: 'button', text: 'Locate',
            onclick: () => {
              grid.flagRows(i.allIds || i.locate.ids);
              if (toast) toast(`Highlighted ${i.allIds ? i.allIds.length : i.locate.ids.length} row(s) for review`, 'info');
              close();
            },
          }),
        ]),
      ]);
      insList.appendChild(card);
    }
    insightsWrap.appendChild(insList);
    insightsWrap.appendChild(el('button', {
      class: 'af-btn af-btn-sm af-btn-ghost', type: 'button', text: 'Copy Insights to Markdown',
      onclick: async () => {
        const ok = await copyText(insightsToMarkdown(insights));
        if (toast) toast(ok ? 'Insights copied as Markdown' : 'Copy failed — select manually', ok ? 'ok' : 'error');
      },
    }));
  }

  const footer = el('div', { class: 'af-modal-actions af-hr-footer' }, [
    el('button', {
      class: 'af-btn af-btn-sm af-btn-ghost', type: 'button', text: 'Copy full report (MD)',
      onclick: async () => {
        const insights = await grid.insights();
        const md = reportToMarkdown({ columns: grid.dataColumns(), findings: grid.healthReport(), insights });
        const ok = await copyText(md);
        if (toast) toast(ok ? 'Report copied as Markdown' : 'Copy failed — select manually', ok ? 'ok' : 'error');
      },
    }),
    el('button', { class: 'af-btn af-btn-primary', type: 'button', text: 'Close' }),
  ]);
  footer.querySelectorAll('.af-btn-primary')[0].addEventListener('click', close);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    if (onClose) onClose();
  }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
  document.addEventListener('keydown', onKey, true);

  refresh();
  panel.append(title, packBar, recipesWrap, sub, list, insightsWrap, footer);
  overlay.appendChild(panel);
  (document.getElementById('app') || document.body).appendChild(overlay);
  footer.querySelector('.af-btn-primary').focus();
  loadRecipes().catch(() => {}); // async, best-effort — never blocks open
  return close;
}
