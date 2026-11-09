// checksum.js — integrity verification for .aether backups.
//
// We use Web Crypto SHA-256 when available (secure context). When it is not
// (e.g. a plain file:// bundle) we fall back to a clearly-labelled FNV-1a
// checksum — that is an INTEGRITY check, NOT a cryptographic hash. The backup
// records which algorithm produced it, so a restore can never silently
// downgrade the guarantee.

export const HASH_SHA256 = 'sha-256';
export const HASH_FNV1A = 'fnv1a-integrity';

/** Deterministic 32-bit FNV-1a over UTF-8 bytes. Integrity only, not crypto. */
export function fnv1a(text) {
  let h = 0x811c9dc5;
  const bytes = new TextEncoder().encode(text);
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @returns {Promise<{algorithm:string, value:string}>}
 */
export async function computeChecksum(text) {
  if (globalThis.crypto?.subtle) {
    try { return { algorithm: HASH_SHA256, value: await sha256(text) }; }
    catch (_) { /* fall through */ }
  }
  return { algorithm: HASH_FNV1A, value: fnv1a(text) };
}

export async function verifyChecksum(text, algorithm, expected) {
  const got = algorithm === HASH_SHA256 && globalThis.crypto?.subtle
    ? await computeChecksum(text)
    : { algorithm: HASH_FNV1A, value: fnv1a(text) };
  return got.algorithm === algorithm && got.value === expected;
}

/** Stable serialization so the checksum is reproducible across browsers. */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}
