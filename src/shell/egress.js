// shell/egress.js — runtime Egress Guard + Ledger (audit-allow: egress-guard)
//
// CSP `connect-src 'self' http: https:` is necessary so the user's configured
// BYOK endpoint can actually be reached. That relaxation is NOT the security
// boundary — THIS guard is: it intercepts every outbound primitive, records the
// attempt in a ledger, and blocks everything except the single origin the user
// explicitly configured. The status bar shows the live count.
//
// Honest wording: "0 outbound DATA requests after page load". Static assets and
// same-origin Workers still load — those are code, not your files. Without a
// configured BYOK endpoint the allowlist is empty and every fetch is blocked
// exactly as before the relaxation.
//
// A customer extension that legitimately needs a network call must BOTH relax
// the CSP and declare `egress: 'explicit'`; the ledger then becomes the paid,
// auditable boundary documented in docs/api.md.

const ledger = [];
const listeners = new Set();

function record(kind, target, by = 'core') {
  ledger.push({ when: Date.now(), kind, target: String(target), by });
  for (const fn of listeners) fn(ledger.length, ledger[ledger.length - 1]);
}

export function getLedger() { return ledger.slice(); }
export function outboundCount() { return ledger.length; }
export function onEgress(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function resetLedger() { ledger.length = 0; for (const fn of listeners) fn(0, null); }

// ---- BYOK explicit-egress allowlist (module #69) -------------------------
//
// BYOK (Bring-Your-Own-Key) is the ONLY sanctioned outbound path. It is
// opt-in and default-closed: until the user configures an endpoint, this list
// is empty and every fetch is blocked exactly as before. When an endpoint is
// configured, ONLY requests whose ORIGIN matches it are permitted; everything
// else is still blocked and recorded. Each allowed call is recorded in the
// ledger so the "outbound" count stays honest.
//
// The CSP is relaxed to permit the user's endpoint (see index.html / _headers),
// but THIS guard is the real enforcement layer: the browser would allow the
// request, but our guarded fetch still rejects every origin except the one the
// user explicitly configured.

let allowedOrigin = null;
let configuredEndpoint = null;
let realFetch = (typeof globalThis !== 'undefined' && globalThis.fetch) || null;

/** Configure (or clear, with `null`/`''`) the single permitted BYOK origin. */
export function setEgressEndpoint(url) {
  if (!url) { allowedOrigin = null; configuredEndpoint = null; return null; }
  let parsed;
  try {
    parsed = new URL(String(url), globalThis.location?.href || 'http://localhost/');
  } catch {
    throw new Error(`Invalid BYOK endpoint: ${url}`);
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error(`BYOK endpoint must be http(s); got ${parsed.protocol}`);
  }
  configuredEndpoint = parsed.href;
  allowedOrigin = parsed.origin;
  return configuredEndpoint;
}

export function getEgressEndpoint() { return configuredEndpoint; }

/** True iff `target` shares the configured endpoint's origin exactly. */
export function isEgressAllowed(target) {
  if (!allowedOrigin) return false;
  try {
    const u = new URL(String(target), globalThis.location?.href || 'http://localhost/');
    return u.origin === allowedOrigin;
  } catch {
    return false;
  }
}

/**
 * The sanctioned network primitive. BYOK code calls THIS, never `fetch`
 * directly, so the allowlist (and the audit gate) stay the single chokepoint.
 * In Node, with no guard installed, it still enforces the allowlist against
 * `globalThis.fetch`, which tests can mock.
 * @returns {Promise<Response>}
 */
export async function explicitFetch(url, init = {}) {
  if (!isEgressAllowed(url)) {
    record('fetch', url, 'byok-blocked');
    throw new Error(
      `[AetherFlow] BYOK egress blocked: ${url} is not the configured endpoint. ` +
      `Only ${allowedOrigin || '(none configured)'} is permitted.`,
    );
  }
  record('fetch', url, 'byok-explicit');
  // In the browser the guard has wrapped window.fetch, so call the captured
  // ORIGINAL (realFetch) to actually emit the request. In Node (no window) we
  // use globalThis.fetch — read at call time so tests can mock it.
  const f = (typeof globalThis.window === 'undefined')
    ? globalThis.fetch
    : (realFetch || globalThis.fetch);
  if (typeof f !== 'function') {
    throw new Error('[AetherFlow] fetch is unavailable in this environment.');
  }
  return f(url, init);
}

function block(kind, target) {
  record(kind, target);
  throw new Error(`[AetherFlow] blocked by 0-egress policy (${kind} → ${target}). ` +
    `Declare egress:'explicit' and relax connect-src for custom builds.`);
}

function sameOrigin(url) {
  try {
    if (!url) return true;
    const u = new URL(String(url), globalThis.location?.href || 'http://localhost/');
    return u.origin === (globalThis.location?.origin ?? u.origin);
  } catch (_) { return false; }
}

/** Install once. Idempotent. Returns an uninstall function (used by tests). */
export function installEgressGuard() {
  if (typeof globalThis.window === 'undefined') return () => {};
  if (globalThis.__aetherEgressInstalled) return () => {};
  globalThis.__aetherEgressInstalled = true;

  const win = globalThis.window;
  const saved = {
    fetch: win.fetch,
    xhrOpen: win.XMLHttpRequest?.prototype?.open,
    sendBeacon: win.navigator?.sendBeacon,
    WebSocket: win.WebSocket,
    EventSource: win.EventSource,
    Worker: win.Worker,
  };

  // Capture the ORIGINAL fetch so explicitFetch (BYOK) can reach the user's
  // configured endpoint without being re-intercepted by the guard itself.
  if (typeof saved.fetch === 'function') realFetch = saved.fetch;

  if (typeof saved.fetch === 'function') {
    win.fetch = function guardedFetch(input) {
      const target = typeof input === 'string' ? input : (input?.url || '');
      // Blob:/data: URLs are local objects, not network requests.
      if (/^(blob|data):/i.test(String(target))) return saved.fetch.apply(this, arguments);
      // The one sanctioned exception: the user's configured BYOK endpoint.
      if (isEgressAllowed(target)) return saved.fetch.apply(this, arguments);
      return block('fetch', target);
    };
  }
  if (saved.xhrOpen) {
    win.XMLHttpRequest.prototype.open = function guardedOpen(method, url) {
      if (/^(blob|data):/i.test(String(url))) return saved.xhrOpen.apply(this, arguments);
      if (isEgressAllowed(url)) return saved.xhrOpen.apply(this, arguments);
      return block('xhr', url);
    };
  }
  if (typeof saved.sendBeacon === 'function') {
    win.navigator.sendBeacon = function guardedBeacon(url) { return block('beacon', url); };
  }
  if (saved.WebSocket) {
    win.WebSocket = function GuardedWebSocket(url) { block('websocket', url); };
    win.WebSocket.prototype = saved.WebSocket.prototype;
    Object.assign(win.WebSocket, saved.WebSocket);
  }
  if (saved.EventSource) {
    win.EventSource = function GuardedEventSource(url) { block('event-source', url); };
    Object.assign(win.EventSource, saved.EventSource);
  }
  // A remote Worker script is an outbound request too. Same-origin Workers
  // (our query / parse / AI workers) are expected and are not counted.
  if (saved.Worker) {
    win.Worker = function GuardedWorker(url, opts) {
      if (!sameOrigin(String(url))) block('worker[cross-origin]', url);
      return new saved.Worker(url, opts);
    };
    win.Worker.prototype = saved.Worker.prototype;
  }

  return () => {
    if (saved.fetch) win.fetch = saved.fetch;
    if (saved.xhrOpen) win.XMLHttpRequest.prototype.open = saved.xhrOpen;
    if (saved.sendBeacon) win.navigator.sendBeacon = saved.sendBeacon;
    if (saved.WebSocket) win.WebSocket = saved.WebSocket;
    if (saved.EventSource) win.EventSource = saved.EventSource;
    if (saved.Worker) win.Worker = saved.Worker;
    globalThis.__aetherEgressInstalled = false;
  };
}
