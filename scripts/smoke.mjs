// scripts/smoke.mjs — dependency-free HTTP smoke test for the local server.
//
// Boots server.js on an uncommon port, asserts the page, the CSP, a few key
// assets and a directory-traversal probe, then tears everything down. Uses
// only Node built-ins (node:http, node:child_process, node:url): no global
// network helper and no third-party module.

import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.SMOKE_PORT || 5199);
const HOST = '127.0.0.1';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = `http://${HOST}:${PORT}`;
const TIMEOUT_MS = 4000;

const failures = [];
function check(ok, label) {
  if (ok) console.log(`  ✓ ${label}`);
  else { failures.push(label); console.error(`  ✗ ${label}`); }
}

function request(path) {
  return new Promise((resolve, reject) => {
    const req = get(`${BASE}${path}`, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('request timeout')));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(child) {
  for (let i = 0; i < 40; i++) {
    if (child.exitCode != null) return false;
    try {
      const res = await request('/');
      if (res.status === 200) return true;
    } catch (_) { /* not listening yet */ }
    await sleep(150);
  }
  return false;
}

const KEY_ASSETS = [
  '/styles/app.css',
  '/styles/grid.css',
  '/styles/theme-dark.css',
  '/src/main.js',
  '/src/sdk/index.js',
  '/src/core/grid.worker.js',
  '/src/core/csv.worker.js',
  '/sw.js',
];

const child = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});

try {
  const ready = await waitForServer(child);
  check(ready, `server became ready on ${BASE}`);
  if (ready) {
    const home = await request('/');
    check(home.status === 200, 'GET / → 200');
    const csp = home.headers['content-security-policy'] || '';
    check(csp.includes('connect-src'), 'CSP defines connect-src');
    check(!/connect-src 'none'/.test(csp), "CSP connect-src is relaxed for BYOK (not 'none')");
    check(csp.includes("connect-src 'self' http: https:"), 'CSP connect-src limits to self + http(s) — no wildcard');
    check(!csp.includes('*'), 'CSP contains no wildcard source');

    for (const asset of KEY_ASSETS) {
      const res = await request(asset);
      check(res.status === 200, `GET ${asset} → 200`);
    }

    const traversal = await request('/../../definitely-missing-traversal-probe.txt');
    check(traversal.status === 404, 'directory-traversal probe → 404');
  }
} catch (err) {
  check(false, `unexpected error: ${err.message}`);
} finally {
  child.kill('SIGTERM');
}

if (failures.length) {
  console.error(`\nSMOKE FAILED — ${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nsmoke: all checks passed.');
process.exit(0);
