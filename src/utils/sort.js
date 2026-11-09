// sort.js — comparison + multi-column sort, the engine behind header clicks

function compareValues(a, b, type) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;

  switch (type) {
    case 'number':
    case 'currency':
      return Number(a) - Number(b);
    case 'date': {
      const da = new Date(a).getTime();
      const db = new Date(b).getTime();
      return da - db;
    }
    case 'text':
    default:
      return String(a).localeCompare(String(b), 'en', { sensitivity: 'base', numeric: true });
  }
}

/**
 * Stable multi-column sort.
 * @param {Array} rows source rows (not mutated)
 * @param {Array<{field:string,dir:'asc'|'desc'}>} sorters priority order, index 0 = primary
 * @param {Record<string,string>} typeOf field -> value type
 * @returns {Array} new sorted array
 */
export function multiSort(rows, sorters, typeOf = {}) {
  if (!sorters || sorters.length === 0) return rows;
  const type = (field) => typeOf[field] || 'text';
  const out = rows.slice();
  out.sort((r1, r2) => {
    for (const s of sorters) {
      const d = compareValues(r1[s.field], r2[s.field], type(s.field));
      if (d !== 0) return s.dir === 'desc' ? -d : d;
    }
    return 0;
  });
  return out;
}

export { compareValues };
