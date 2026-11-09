// io/insights.js — business Insights for the Data Health Report (Final Polish,
// point three).
//
// Two independent scans run over the in-memory rows and surface money-leak
// signals the raw health checks cannot see:
//
//   1. Overlapping / duplicate subscriptions
//      A column that looks like a subscription/service/plan list is grouped by
//      normalized name. Any service that recurs is a likely duplicate (you are
//      paying twice). If a price column is present we total the redundant
//      copies; a billing-period column annualizes the figure. Result: an
//      estimated annual saving of $X.
//
//   2. Hidden penalties & fees
//      Columns named fee / penalty / late / charge / fine / surcharge / interest
//      / overdue are summed (currency symbols and parentheses-negatives handled)
//      so the user sees the total $N draining away.
//
// Every insight carries a `locate` ({ field, ids }) so the UI can one-click
// jump to (and, for subscriptions, offer to resolve) the offending rows.
// Pure: never mutates input, safe to run in a Worker or Node test.

// ---- header hints ----------------------------------------------------------

const SUBSCRIPTION_HINTS = [
  'subscription', 'subscrip', 'plan', 'service', 'membership', 'recurring', 'saas',
];
const PRICE_HINTS = [
  'price', 'amount', 'cost', 'monthly', 'annual', 'fee', 'charge', 'total', 'value', 'rate', 'spend',
];
const PERIOD_HINTS = ['billing', 'period', 'term', 'frequency', 'cycle', 'cadence'];
const PENALTY_HINTS = [
  'fee', 'penalty', 'late', 'charge', 'fine', 'surcharge', 'interest', 'overdue', 'deduction', 'tax',
];

function headerHas(header, hints) {
  const h = (header || '').toLowerCase();
  return hints.some((k) => h.includes(k));
}

function findColumn(columns, hints) {
  return columns.find((c) => c && c.field && headerHas(c.header || c.field, hints)) || null;
}

function parseMoney(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  const num = s.replace(/[(),$\u20AC\u00A3\u00A5\uFFE5\s]/g, '');
  const n = Number(num);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : Math.abs(n);
}

function detectCurrencySymbol(v) {
  const s = String(v == null ? '' : v);
  if (s.includes('\u20AC')) return '\u20AC';
  if (s.includes('\u00A3')) return '\u00A3';
  if (s.includes('\u00A5') || s.includes('\uFFE5')) return '\u00A5';
  return '$';
}

function normalizeName(v) {
  return String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------

function analyzeSubscriptions(rows, columns) {
  const subCol = findColumn(columns, SUBSCRIPTION_HINTS);
  if (!subCol) return null;
  const priceCol = findColumn(columns, PRICE_HINTS);
  const periodCol = findColumn(columns, PERIOD_HINTS);

  // Annualize when a billing-period column says "month" (and the price column
  // is not itself explicitly annual).
  let periodFactor = 1;
  if (periodCol && !(priceCol && /annual|year/i.test(priceCol.header || ''))) {
    const values = rows.map((r) => normalizeName(r ? r[periodCol.field] : '')).filter(Boolean);
    if (values.some((v) => /month/i.test(v))) periodFactor = 12;
  }

  const groups = new Map();
  for (const r of rows) {
    if (!r) continue;
    const name = normalizeName(r[subCol.field]);
    if (!name) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(r);
  }

  let redundantIds = [];
  let savings = 0;
  const duplicatedNames = [];
  let currency = '$';
  let sawPrice = false;

  for (const [name, members] of groups) {
    if (members.length < 2) continue;
    duplicatedNames.push(name);
    // Keep the first (cheapest is hard to know) and treat the rest as redundant.
    const redundant = members.slice(1);
    redundantIds = redundantIds.concat(redundant.map((r) => r.id));
    if (priceCol) {
      sawPrice = true;
      for (const r of redundant) {
        const raw = r ? r[priceCol.field] : null;
        const m = parseMoney(raw);
        if (m != null) {
          savings += m;
          currency = detectCurrencySymbol(raw);
        }
      }
    }
  }

  if (!redundantIds.length) return null;
  savings *= periodFactor;

  const detail = sawPrice
    ? `${duplicatedNames.length} service(s) appear more than once (e.g. ${duplicatedNames.slice(0, 3).join(', ')}). Canceling the redundant subscription(s) could save about ${currency}${Math.round(savings).toLocaleString('en-US')}${periodFactor > 1 ? '/year' : ''}.`
    : `${duplicatedNames.length} service(s) appear more than once (e.g. ${duplicatedNames.slice(0, 3).join(', ')}). These may be duplicate subscriptions worth reviewing.`;

  return {
    id: 'insight-subscriptions',
    kind: 'subscription',
    title: 'Overlapping / duplicate subscriptions',
    detail,
    amount: sawPrice ? Math.round(savings * 100) / 100 : null,
    currency,
    annualized: periodFactor > 1,
    locate: { field: subCol.field, ids: redundantIds },
    allIds: rows.filter((r) => r && duplicatedNames.includes(normalizeName(r[subCol.field]))).map((r) => r.id),
  };
}

function analyzePenalties(rows, columns) {
  const penaltyCols = columns.filter((c) => c && c.field && headerHas(c.header || c.field, PENALTY_HINTS));
  if (!penaltyCols.length) return null;

  let total = 0;
  let currency = '$';
  const ids = [];
  const touched = new Set();
  let any = false;

  for (const col of penaltyCols) {
    for (const r of rows) {
      if (!r) continue;
      const raw = r[col.field];
      if (raw == null || String(raw).trim() === '') continue;
      const m = parseMoney(raw);
      if (m == null) continue;
      total += m;
      any = true;
      currency = detectCurrencySymbol(raw);
      if (!touched.has(r.id)) { touched.add(r.id); ids.push(r.id); }
    }
  }

  if (!any) return null;
  return {
    id: 'insight-penalties',
    kind: 'penalty',
    title: 'Hidden penalties & fees',
    detail: `Detected ${currency}${Math.round(total).toLocaleString('en-US')} in fees/penalties across ${penaltyCols.length} column(s) (${penaltyCols.map((c) => (c.header || c.field)).slice(0, 3).join(', ')}). Review for charges you can avoid.`,
    amount: Math.round(total * 100) / 100,
    currency,
    annualized: false,
    locate: { field: penaltyCols[0].field, ids },
    allIds: ids,
  };
}

/**
 * Run both insight scans. Pure.
 * @param {Array<object>} rows  rows with an `id` field
 * @param {Array<object>} columns  column defs
 * @returns {Array<object>} insight objects (may be empty)
 */
export function analyzeInsights(rows = [], columns = []) {
  const out = [];
  const subs = analyzeSubscriptions(rows, columns);
  if (subs) out.push(subs);
  const pen = analyzePenalties(rows, columns);
  if (pen) out.push(pen);
  return out;
}
