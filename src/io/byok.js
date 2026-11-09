// src/io/byok.js — Bring-Your-Own-Key AI rule suggestions (module #69, BYOK).
//
// The product spec, in plain terms:
//   * The user supplies their OWN API key + endpoint. AetherFlow never ships,
//     stores, or defaults a key.
//   * ONLY the table SCHEMA (column names + types) and the user's instruction
//     leave the device. NO row values are ever transmitted.
//   * The model returns JSON rule instructions; we validate them against a
//     fixed vocabulary (the trust boundary) and execute them LOCALLY, behind a
//     preview the user must confirm.
//   * Every network call goes through the egress guard's allowlist
//     (src/shell/egress.js). Only the configured endpoint origin is reachable;
//     everything else — and the unconfigured state — is blocked and recorded.
//
// This file deliberately contains NO direct call to the raw fetch primitive.
// The one network primitive it uses is explicitFetch, which lives in egress.js
// (the only file the audit gate permits to name network primitives). That keeps
// the static "0 network primitives" claim true and routes all egress through
// the single, auditable chokepoint.

import { explicitFetch, setEgressEndpoint } from '../shell/egress.js';
import { KNOWN_RULES } from './recipe.js';
import { previewCleanse, previewDateOrder, applyDateOrder } from './cleanse.js';

const SETTINGS_KEY = 'byok:settings';

// Predicate operators the model may use in a `flag` rule. No remote code, no
// arbitrary eval — only these six closed-form comparisons.
const SAFE_OPS = new Set(['>', '<', '>=', '<=', '==', '!=', 'contains']);

// ---- settings persistence (local vault only) ------------------------------

export function normalizeSettings(s) {
  const o = s && typeof s === 'object' ? s : {};
  return {
    endpoint: typeof o.endpoint === 'string' ? o.endpoint.trim() : '',
    apiKey: typeof o.apiKey === 'string' ? o.apiKey : '',
    model: typeof o.model === 'string' ? o.model.trim() : '',
  };
}

export function loadByokSettings(vault) {
  return Promise.resolve(vault.get('meta', SETTINGS_KEY)).then(
    (row) => (row && row.value ? normalizeSettings(row.value) : null),
  );
}

export async function saveByokSettings(vault, settings) {
  const norm = normalizeSettings(settings);
  await vault.put('meta', { key: SETTINGS_KEY, value: norm });
  // Keep the egress allowlist in lockstep with the saved endpoint.
  setEgressEndpoint(norm.endpoint || null);
  return norm;
}

export async function clearByokSettings(vault) {
  await vault.delete('meta', SETTINGS_KEY);
  setEgressEndpoint(null);
}

export function isByokEnabled(settings) {
  const s = normalizeSettings(settings);
  return Boolean(s.endpoint && s.apiKey);
}

// ---- schema only (no row data) --------------------------------------------

/** Build a schema-only description of the table. NEVER includes row values. */
export function buildSchema(columns) {
  return (columns || []).map((c) => ({
    name: c.header || c.field,
    field: c.field,
    type: c.type || 'text',
  }));
}

// ---- prompt + request body (pure, testable) --------------------------------

function buildMessages(instruction, columns) {
  const schema = buildSchema(columns);
  const system = [
    'You are a data-cleaning assistant for a local-first CSV tool.',
    'You receive ONLY a table schema (column names + types) and a user instruction.',
    'You NEVER receive row values. Do not invent, request, or echo any.',
    'Respond with a single JSON object and nothing else. Schema:',
    JSON.stringify(schema),
    '',
    'JSON shape: { "rules": string[], "fields"?: string[], "dateOrder"?: {field: "dmy"|"mdy"}, "flag"?: {field, op, value} }',
    `Allowed rule names: ${KNOWN_RULES.join(', ')}.`,
    'rules: a subset to apply (trim, collapse, isoDate, number, lower, upper, title).',
    'fields: optional subset of column names/fields to apply rules to; omit for all applicable.',
    'dateOrder: optional {field: "dmy"|"mdy"} for ambiguous slash-dates.',
    'flag: optional {field, op (">","<",">=","<=","==","!=","contains"), value} to highlight rows for review.',
  ].join('\n');
  const user = `Instruction: ${instruction}\nApply only the rules you need. Return JSON only.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Pure: assemble the request body. Exposed so tests can assert that no row
 * data is ever serialized into the wire format.
 */
export function buildRequestBody(settings, instruction, columns) {
  const s = normalizeSettings(settings);
  return JSON.stringify({
    model: s.model || 'gpt-4o-mini',
    messages: buildMessages(instruction, columns),
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });
}

function extractContent(data) {
  if (data && typeof data === 'object') {
    const c = data.choices?.[0]?.message?.content ?? data.content ?? data.text;
    if (typeof c === 'string' && c.trim()) return c;
  }
  return typeof data === 'string' ? data : JSON.stringify(data ?? {});
}

function parseInstruction(text) {
  if (typeof text !== 'string') throw new Error('LLM returned no content.');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  let obj = null;
  if (start >= 0 && end > start) {
    try { obj = JSON.parse(text.slice(start, end + 1)); } catch { obj = null; }
  }
  if (!obj) {
    try { obj = JSON.parse(text); } catch { /* fall through */ }
  }
  if (!obj || typeof obj !== 'object') {
    throw new Error('LLM did not return valid JSON instructions.');
  }
  return obj;
}

// ---- the network call (schema + instruction ONLY) --------------------------

/**
 * Call the user's LLM and return the raw instruction object it produced.
 * Sends ONLY schema + instruction. Throws if BYOK is not configured or the
 * endpoint is not the allowlisted one.
 */
export async function suggestRules({ settings, instruction, columns }) {
  const s = normalizeSettings(settings);
  if (!isByokEnabled(s)) {
    throw new Error('BYOK is not configured. Add an endpoint + API key in Settings (⌘K → BYOK settings).');
  }
  const body = buildRequestBody(s, instruction, columns);
  const resp = await explicitFetch(s.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${s.apiKey}`,
    },
    body,
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`LLM returned ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = await resp.json().catch(() => ({}));
  return parseInstruction(extractContent(data));
}

// ---- trust boundary: validate the LLM's instructions -----------------------

// Resolve a user-facing name or field token to a real column field id.
function resolveField(token, schema) {
  if (token == null) return null;
  const s = String(token);
  const byField = schema.find((c) => c.field === s);
  if (byField) return byField.field;
  const byName = schema.find((c) => c.name === s);
  return byName ? byName.field : null;
}

/**
 * The trust boundary for BYOK (mirrors recipe.js's migrateRecipe). The model's
 * output is UNTRUSTED: every field, rule, operator and value is checked
 * against a fixed vocabulary before it can touch the user's rows. Unknown or
 * out-of-range instructions are dropped (and reported as warnings), never run.
 * Returns { ok, instruction, warnings }.
 */
export function validateInstruction(raw, columns) {
  const schema = buildSchema(columns);
  const fields = new Set(schema.map((c) => c.field));
  const dateFields = new Set(schema.filter((c) => c.type === 'date').map((c) => c.field));
  const obj = raw && typeof raw === 'object' ? raw : {};
  const warnings = [];

  // rules
  const requestedRules = Array.isArray(obj.rules) ? obj.rules : [];
  const rules = requestedRules.filter((r) => KNOWN_RULES.includes(r));
  const droppedRules = requestedRules.filter((r) => !KNOWN_RULES.includes(r));
  if (droppedRules.length) warnings.push(`Ignored unknown rule(s): ${droppedRules.join(', ')}`);

  // fields (apply-target subset)
  const fieldsTarget = [];
  for (const f of (Array.isArray(obj.fields) ? obj.fields : [])) {
    const key = resolveField(f, schema);
    if (key) fieldsTarget.push(key);
    else warnings.push(`Ignored unknown field: ${f}`);
  }

  // dateOrder
  const dateOrder = {};
  const rawDO = (obj.dateOrder && typeof obj.dateOrder === 'object') ? obj.dateOrder : {};
  for (const [k, v] of Object.entries(rawDO)) {
    const key = resolveField(k, schema);
    if (!key) { warnings.push(`Ignored dateOrder for unknown field: ${k}`); continue; }
    if (!dateFields.has(key)) { warnings.push(`Field ${k} is not a date column; skipping dateOrder`); continue; }
    if (v !== 'dmy' && v !== 'mdy') { warnings.push(`Ignored invalid date order for ${k}`); continue; }
    dateOrder[key] = v;
  }

  // flag
  let flag = null;
  const rf = obj.flag;
  if (rf && typeof rf === 'object') {
    const key = resolveField(rf.field, schema);
    if (!key) warnings.push(`Flag field unknown: ${rf.field}`);
    else if (!SAFE_OPS.has(rf.op)) warnings.push(`Flag operator unsupported: ${rf.op}`);
    else if (rf.value === undefined) warnings.push('Flag is missing a value');
    else flag = { field: key, op: rf.op, value: rf.value };
  }

  if (!rules.length && !Object.keys(dateOrder).length && !flag) {
    warnings.push('No actionable instruction returned (no rules, dateOrder, or flag).');
  }

  return { ok: true, instruction: { rules, fields: fieldsTarget, dateOrder, flag }, warnings };
}

// ---- pure preview (no DOM, no mutation) -------------------------------------

/** Evaluate a flag predicate against a single cell value. */
export function evalPred(value, op, target) {
  switch (op) {
    case '>': return Number(value) > Number(target);
    case '<': return Number(value) < Number(target);
    case '>=': return Number(value) >= Number(target);
    case '<=': return Number(value) <= Number(target);
    case '==': return String(value) === String(target);
    case '!=': return String(value) !== String(target);
    case 'contains': return String(value).includes(String(target));
    default: return false;
  }
}

/**
 * Non-mutating impact preview for the confirmed-apply dialog. Returns how many
 * cells would be cleansed, how many dates would be normalized, and how many
 * rows would be flagged for review.
 */
export function previewInstruction(instruction, columns, rows) {
  const { rules, fields, dateOrder, flag } = instruction || {};
  const typeOf = {};
  for (const c of (columns || [])) typeOf[c.field] = c.type || 'text';
  const dataFields = (fields && fields.length) ? fields : (columns || []).map((c) => c.field);

  const cleanseChanges = previewCleanse(rows, rules || [], typeOf, dataFields);
  const dateChanges = previewDateOrder(rows, columns, dateOrder || {});

  let flaggedCount = 0;
  const flaggedIds = [];
  if (flag) {
    for (const r of rows) {
      if (evalPred(r[flag.field], flag.op, flag.value)) { flaggedCount++; flaggedIds.push(r.id); }
    }
  }
  return { cleanseChanges, dateChanges, flaggedCount, flaggedIds };
}

// Re-export so the grid can apply date normalization with one import.
export { applyDateOrder };
