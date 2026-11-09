// scripts/check.mjs — syntax + import graph validation. No dependencies.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
let checked = 0;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git'].includes(entry.name)) continue;
      walk(p, out);
    } else if (/\.(js|mjs)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const files = [join(ROOT, 'src'), join(ROOT, 'scripts'), join(ROOT, 'tests')]
  .filter(existsSync).flatMap((d) => walk(d));

// 1) Syntax
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); checked++; }
  catch (e) { failures.push(`syntax: ${relative(ROOT, f)} — ${String(e.stderr || e.message).trim()}`); }
}

// 2) Relative imports + Worker URLs must resolve
const importRe = /(?:from\s*|import\s*\(\s*|new\s+URL\s*\(\s*)['"]([^'"]+)['"]/g;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  let m;
  while ((m = importRe.exec(src))) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const target = resolve(dirname(f), spec);
    if (!existsSync(target)) failures.push(`missing import: ${relative(ROOT, f)} → ${spec}`);
  }
}

if (failures.length) {
  console.error('CHECK FAILED\n' + failures.map((x) => '  ✗ ' + x).join('\n'));
  process.exit(1);
}
console.log(`check: ${checked} JS files, syntax OK, all relative imports resolve.`);
