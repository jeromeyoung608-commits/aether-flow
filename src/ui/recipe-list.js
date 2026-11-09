// ui/recipe-list.js — review / delete saved import recipes (M1, module G).
//
// Recipes are local-only and must stay reviewable, not hidden. This modal lists
// every saved recipe so the user can see what "remembered" choices exist and
// delete the ones they no longer want.
//
// Pure DOM, no framework, no icon font. Keyboard reachable: focus moves into the
// dialog on open, Esc/Enter close, each row has a Delete button.

import { listRecipes, recipeKey } from '../io/recipe.js';

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

function summarize(recipe) {
  const parts = [];
  parts.push(`enc ${recipe.encoding}`);
  parts.push(`delim ${recipe.delimiter === '\t' ? 'tab' : JSON.stringify(recipe.delimiter)}`);
  if (recipe.headerRow) parts.push(`header row ${recipe.headerRow}`);
  if (recipe.skipRows) parts.push(`skip ${recipe.skipRows}`);
  const orders = Object.entries(recipe.dateOrder || {});
  if (orders.length) parts.push(`dates ${orders.map(([, v]) => v).join(',')}`);
  return parts.join(' · ');
}

/**
 * Open the saved-recipe list modal.
 * @param {object} opts
 * @param {object} opts.vault  the local vault
 * @param {() => void} [opts.onClose]
 * @returns {() => void} close()
 */
export async function openRecipeList({ vault, onClose }) {
  const overlay = el('div', { class: 'af-modal-overlay', role: 'presentation' });
  const dialog = el('div', {
    class: 'af-modal af-recipe-list',
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'af-rl-title',
  });

  const title = el('h2', { id: 'af-rl-title', class: 'af-modal-title', text: 'Saved import recipes' });
  const subtitle = el('p', { class: 'af-modal-sub', text: 'Local-only choices remembered per file. Delete any you no longer want.' });

  const listWrap = el('div', { class: 'af-rl-list' });

  const closeBtn = el('button', { class: 'af-btn', type: 'button', text: 'Close' });
  const actions = el('div', { class: 'af-modal-actions' }, [closeBtn]);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    if (onClose) onClose();
  }

  async function render() {
    listWrap.replaceChildren();
    const recipes = await listRecipes(vault);
    if (!recipes.length) {
      listWrap.appendChild(el('p', { class: 'af-rl-empty', text: 'No saved recipes yet. Import a file with "Remember these choices" checked to create one.' }));
      return;
    }
    for (const { fileId, recipe } of recipes) {
      const delBtn = el('button', { class: 'af-btn af-btn-sm', type: 'button', text: 'Delete' });
      delBtn.addEventListener('click', async () => {
        delBtn.disabled = true;
        await vault.delete('meta', recipeKey(fileId));
        await render();
      });
      const row = el('div', { class: 'af-rl-row' }, [
        el('div', { class: 'af-rl-meta' }, [
          el('div', { class: 'af-rl-file', text: fileId }),
          el('div', { class: 'af-rl-sum', text: summarize(recipe) }),
        ]),
        delBtn,
      ]);
      listWrap.appendChild(row);
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); close(); }
  }
  document.addEventListener('keydown', onKey, true);

  closeBtn.addEventListener('click', close);

  dialog.append(title, subtitle, listWrap, actions);
  overlay.appendChild(dialog);
  (document.getElementById('app') || document.body).appendChild(overlay);

  await render();
  closeBtn.focus();

  return close;
}
