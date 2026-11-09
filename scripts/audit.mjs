// scripts/audit.mjs — the zero-egress / zero-localStorage CI gate.
//
// M1A: core is permanently `egress: none`. M4A: localStorage is fully removed.
// This script makes both claims machine-verifiable instead of marketing.
// Run: npm run audit   (also part of npm run verify)
//
// Scope includes the extension / customer / docs directories too: an extension
// shipped under examples/ or customers/ is still "shipped code", so a network
// primitive there must fail CI just like one in src/. `walk` only picks up
// js/mjs/css/html, so Markdown docs are documentation, not scanned code.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CODE_DIRS = ['src', 'styles', 'scripts', 'tests', 'examples', 'customers', 'docs'];
const CODE_FILES = ['index.html', 'server.js', '_headers', 'vercel.json', 'sw.js'];

// The guard is the ONLY place allowed to name/work with network primitives.
const ALLOWED_NETWORK = new Set([
  'src/shell/egress.js',      // intercepts + blocks them
  'scripts/audit.mjs',        // this scanner
  'tests/integration.test.mjs' // asserts they are blocked
]);

const RULES = [
  { id: 'fetch', re: /\bfetch\s*\(/g, network: true },
  { id: 'websocket', re: /new\s+WebSocket\b/g, network: true },
  { id: 'event-source', re: /new\s+EventSource\b/g, network: true },
  { id: 'beacon', re: /sendBeacon\s*\(/g, network: true },
  { id: 'xhr', re: /XMLHttpRequest\b/g, network: true },
  { id: 'remote-script', re: /(?:src|href)\s*=\s*["']https?:\/\//gi, network: true },
  { id: 'remote-font', re: /@import\s+url\(\s*["']?https?:\/\//gi, network: true },
  { id: 'remote-worker', re: /new\s+URL\(\s*["']https?:\/\//gi, network: true },
  { id: 'localStorage', re: /\blocalStorage\b/g, network: false },
  { id: 'sessionStorage', re: /\bsessionStorage\b/g, network: false },
  { id: 'oauth', re: /\bOAuth\b|\bshowDirectoryPicker\b/g, network: false },
];

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', '.git'].includes(e.name)) walk(p, out); }
    else if (/\.(js|mjs|css|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

const targets = [
  ...CODE_DIRS.filter((d) => existsSync(join(ROOT, d))).flatMap((d) => walk(join(ROOT, d))),
  ...CODE_FILES.map((f) => join(ROOT, f)).filter(existsSync),
];

const findings = [];
for (const f of targets) {
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  const src = readFileSync(f, 'utf8');
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    if (!rule.re.test(src)) continue;
    if (rule.network && ALLOWED_NETWORK.has(rel)) continue;
    // This scanner necessarily names the constructs it forbids.
    if (!rule.network && rel === 'scripts/audit.mjs') continue;
    findings.push(`${rel}: ${rule.id}`);
  }
}

if (findings.length) {
  console.error('AUDIT FAILED — forbidden construct in shipped code:\n' +
    findings.map((x) => '  ✗ ' + x).join('\n'));
  process.exit(1);
}
console.log(`audit: ${targets.length} files · 0 network primitives · 0 localStorage/sessionStorage · 0 OAuth.`);
