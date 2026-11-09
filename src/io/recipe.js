// src/io/recipe.js — per-file import / cleanse recipes (M1, module G).
//
// A recipe captures the choices a user made at the import gate (encoding,
// delimiter, header / skip rows, date order) so the next import of the same
// file is consistent — and so the choices are reviewable, not hidden. Recipes
// are stored in the LOCAL vault only; they never leave the device.
//
// Security: `migrateRecipe` is the trust boundary. It accepts ANY input (a
// stored object, a pasted JSON string, an older version) and returns a recipe
// with ONLY known fields and validated types. Nothing untrusted is ever handed
// straight to the parser.

export const RECIPE_VERSION = 1;

const KNOWN_ENCODINGS = new Set([
  'utf-8', 'utf-16le', 'utf-16be', 'gbk', 'windows-1252', 'latin1', 'iso-8859-1', 'shift_jis', 'euc-kr',
]);
const KNOWN_ORDER = new Set(['dmy', 'mdy']);
export const KNOWN_RULES = ['trim', 'collapse', 'isoDate', 'number', 'lower', 'upper', 'title'];

const clampInt = (v, max) => {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
};

export function recipeKey(fileId) {
  return `recipe:${fileId || 'default'}`;
}

/** The trust boundary: turn untrusted input into a safe recipe. */
export function migrateRecipe(input) {
  const obj = typeof input === 'string'
    ? safeParse(input)
    : (input && typeof input === 'object' ? input : {});
  return {
    version: RECIPE_VERSION,
    encoding: KNOWN_ENCODINGS.has(obj.encoding) ? obj.encoding : 'utf-8',
    delimiter: validDelimiter(obj.delimiter) ? obj.delimiter : ',',
    headerRow: clampInt(obj.headerRow, 50),
    skipRows: clampInt(obj.skipRows, 1000),
    dateOrder: validDateOrder(obj.dateOrder),
    rules: validRules(obj.rules),
  };
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
function validDelimiter(d) {
  return d === ',' || d === ';' || d === '\t' || d === '|'
    || (typeof d === 'string' && d.length === 1);
}
function validDateOrder(o) {
  if (!o || typeof o !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(o)) if (KNOWN_ORDER.has(v)) out[k] = v;
  return out;
}
function validRules(r) {
  if (!Array.isArray(r)) return ['trim'];
  const out = r.filter((x) => KNOWN_RULES.includes(x));
  return out.length ? out : ['trim'];
}

/** JSON form for storage / export — human-readable, safe fields only. */
export function serializeRecipe(recipe) {
  return JSON.stringify(migrateRecipe(recipe), null, 2);
}

// ---- vault-backed persistence (local only) --------------------------------

export async function saveRecipe(vault, fileId, recipe) {
  const safe = migrateRecipe(recipe);
  await vault.put('meta', { key: recipeKey(fileId), value: safe });
  return safe;
}

export async function loadRecipe(vault, fileId) {
  const row = await vault.get('meta', recipeKey(fileId));
  return row && row.value ? migrateRecipe(row.value) : null;
}

export async function listRecipes(vault) {
  const all = await vault.getAll('meta');
  const out = [];
  for (const r of all || []) {
    if (r && typeof r.key === 'string' && r.key.startsWith('recipe:')) {
      out.push({ fileId: r.key.slice('recipe:'.length), recipe: migrateRecipe(r.value) });
    }
  }
  return out;
}
