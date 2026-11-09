// query.js — the filter + sort pipeline, shared by the main thread and the Web
// Worker. It works on *indices* (not row objects) so the worker can return a
// tiny array of numbers instead of cloning the whole dataset back to the main
// thread. The main thread maps indices -> row objects for rendering.

import { compareValues } from './sort.js';

/**
 * Filter + sort the dataset and return the matching row indices, in display
 * order. Pure: never mutates `rows`.
 *
 * @param {Array} rows source rows
 * @param {object} params
 * @param {string} [params.global] cross-column search term
 * @param {Record<string,string>} [params.columns] per-column substring filters
 * @param {Array<{field:string,dir:'asc'|'desc'}>} [params.sorters]
 * @param {Record<string,string>} [params.typeOf] field -> value type
 * @param {string[]} [params.fields] fields searched by the global term
 * @returns {number[]} matching indices, sorted
 */
export function runQueryIndices(rows, params = {}) {
  const {
    global = '',
    columns = {},
    sorters = [],
    typeOf = {},
    fields = [],
  } = params;

  const needle = (global || '').trim().toLowerCase();
  const colFilters = [];
  for (const f in columns) {
    const v = columns[f];
    if (v) colFilters.push([f, String(v).toLowerCase()]);
  }

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    if (needle) {
      let hit = false;
      for (let k = 0; k < fields.length; k++) {
        if (String(r[fields[k]] ?? '').toLowerCase().includes(needle)) { hit = true; break; }
      }
      if (!hit) continue;
    }

    let ok = true;
    for (let k = 0; k < colFilters.length; k++) {
      const [f, v] = colFilters[k];
      if (!String(r[f] ?? '').toLowerCase().includes(v)) { ok = false; break; }
    }
    if (!ok) continue;

    out.push(i);
  }

  if (sorters && sorters.length) {
    const type = (f) => typeOf[f] || 'text';
    out.sort((a, b) => {
      for (let s = 0; s < sorters.length; s++) {
        const so = sorters[s];
        const d = compareValues(rows[a][so.field], rows[b][so.field], type(so.field));
        if (d !== 0) return so.dir === 'desc' ? -d : d;
      }
      return a - b; // stable tiebreak by original position
    });
  }

  return out;
}
