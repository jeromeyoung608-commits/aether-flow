// io/cleaning-recipes.js — M2-1: local cleaning recipes (retention / stickiness).
//
// A cleaning recipe captures a *successful* set of cleaning actions (e.g. a trim
// + collapse + number-format pass over specific columns) so the user can replay
// it on the next file with one click. Recipes live ONLY in the local vault
// (meta:cleaning_recipes); they never leave the device.
//
// Design mirrors io/recipe.js: a `migrateCleaningRecipe` trust boundary turns
// untrusted input (a stored object, a pasted JSON string) into a recipe with
// ONLY known fields and validated rule names. Nothing untrusted reaches the
// cleanse engine.
//
// The module is store-agnostic: it talks to a tiny `{ get(key), put(key, value) }`
// surface (the app's storage wrapper satisfies this), so it is unit-testable
// with an in-memory fake and requires no DOM or IndexedDB.

import { CLEANSE_RULES, previewCleanse } from './cleanse.js';

export const CLEANING_RECIPES_KEY = 'meta:cleaning_recipes';
export const RECIPE_VERSION = 1;

// Only known cleanse rule names can be stored. `isoDate` is allowed but only
// meaningful on date-typed columns (the engine guards that anyway).
const KNOWN_RULES = new Set(Object.keys(CLEANSE_RULES));

function safeParse(s) {
  if (typeof s !== 'string') return null;
  try { return JSON.parse(s); } catch { return null; }
}

/** The trust boundary: turn untrusted input into a safe recipe (or null). */
export function migrateCleaningRecipe(input) {
  const obj = typeof input === 'string'
    ? safeParse(input)
    : (input && typeof input === 'object' ? input : null);
  if (!obj || typeof obj !== 'object') return null;

  const name = typeof obj.name === 'string' && obj.name.trim()
    ? obj.name.trim().slice(0, 120)
    : 'Untitled recipe';

  const steps = Array.isArray(obj.steps) ? obj.steps : [];
  const safeSteps = steps
    .map((s) => ({
      rules: Array.isArray(s?.rules) ? [...new Set(s.rules.filter((r) => KNOWN_RULES.has(r)))] : [],
      fields: Array.isArray(s?.fields)
        ? [...new Set(s.fields.filter((f) => typeof f === 'string' && f.trim()))]
        : [],
    }))
    .filter((s) => s.rules.length && s.fields.length); // a step must target real rules+fields

  if (!safeSteps.length) return null;

  return {
    id: typeof obj.id === 'string' && obj.id ? obj.id : `crecipe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    version: RECIPE_VERSION,
    name,
    createdAt: Number(obj.createdAt) || Date.now(),
    steps: safeSteps,
  };
}

/** Convenience: build a recipe from one successful cleanse action. */
export function buildRecipeFromCleanse(name, rules, fields) {
  return migrateCleaningRecipe({ name, steps: [{ rules: [...new Set(rules)], fields: [...new Set(fields)] }] });
}

/** Merge step rules per field so a recipe never lists the same rule twice. */
export function normalizeRecipeSteps(steps) {
  const byField = new Map();
  for (const s of steps || []) {
    for (const f of s.fields || []) {
      const cur = byField.get(f) || new Set();
      for (const r of s.rules || []) cur.add(r);
      byField.set(f, cur);
    }
  }
  return [...byField.entries()].map(([field, rules]) => ({ rules: [...rules], fields: [field] }));
}

// ---- store-backed persistence (local only) ---------------------------------

export async function listCleaningRecipes(store) {
  const raw = await store.get(CLEANING_RECIPES_KEY);
  const arr = Array.isArray(raw) ? raw : safeParse(JSON.stringify(raw));
  if (!Array.isArray(arr)) return [];
  return arr.map(migrateCleaningRecipe).filter(Boolean);
}

export async function saveCleaningRecipe(store, recipe) {
  const safe = migrateCleaningRecipe(recipe);
  if (!safe || !safe.steps.length) throw new Error('Recipe has no valid steps');
  const all = await listCleaningRecipes(store);
  const i = all.findIndex((r) => r.id === safe.id);
  if (i >= 0) all[i] = safe; else all.push(safe);
  await store.put(CLEANING_RECIPES_KEY, all);
  return safe;
}

export async function deleteCleaningRecipe(store, id) {
  const all = await listCleaningRecipes(store);
  const next = all.filter((r) => r.id !== id);
  await store.put(CLEANING_RECIPES_KEY, next);
  return next;
}

export async function getCleaningRecipe(store, id) {
  const all = await listCleaningRecipes(store);
  return all.find((r) => r.id === id) || null;
}

/**
 * Recommend recipes relevant to the CURRENT columns. A recipe is relevant when
 * at least one of its step fields exists among `columns`. Ranked by the number
 * of matching fields so the most-applicable surfaces first.
 * @returns {Array<{recipe:object, matchedFields:string[], score:number}>}
 */
export function recommendRecipes(recipes, columns) {
  const fields = new Set((columns || []).map((c) => c.field));
  const scored = [];
  for (const r of recipes || []) {
    const matched = new Set();
    for (const s of r.steps || []) for (const f of s.fields || []) if (fields.has(f)) matched.add(f);
    if (matched.size) scored.push({ recipe: r, matchedFields: [...matched], score: matched.size });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Non-mutating dry-run of a recipe against in-memory rows. Reuses previewCleanse
 * per step, then de-dupes by (id, field) so later steps win. Returns the cells
 * that WOULD change, each tagged with the rules that produced it. Does not touch
 * `rows`.
 * @returns {Array<{id:string|number, field:string, before:*, after:*, rules:string[]}>}
 */
export function dryRunRecipe(recipe, rows, typeOf = {}) {
  const collected = [];
  for (const step of recipe.steps || []) {
    const changes = previewCleanse(rows, step.rules, typeOf, step.fields);
    for (const c of changes) collected.push({ ...c, rules: step.rules });
  }
  const map = new Map();
  for (const c of collected) map.set(`${c.id}::${c.field}`, c);
  return [...map.values()];
}
