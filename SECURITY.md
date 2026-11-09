# Security policy

## Threat model

AetherFlow is a **static, single-origin site with no server**. Its primary
promise is that user files are never transmitted. The protections, in order:

1. **CSP is relaxed to `connect-src 'self' http: https:` *only* so your configured BYOK endpoint can be reached.** With no endpoint configured, the runtime Egress Guard below keeps the allowlist empty and blocks every request, so the effective posture is identical to `'none'`. The rule governs data connections, not code loads; static assets, same-origin module Workers and the Service Worker are still loaded. Shipped via `_headers` (Cloudflare), `vercel.json` (Vercel), `server.js` (local) and a `<meta http-equiv>` fallback (GitHub Pages). Meta-CSP cannot enforce `frame-ancestors`; use a host that sends real headers for the strictest posture.
2. **Runtime Egress Guard** (`src/shell/egress.js`) — intercepts the same
   primitives, blocks them, and records the attempt in a ledger visible in the
   status bar. A remote Worker URL is also blocked.
3. **`npm run audit`** — fails on any network primitive, `localStorage`,
   `sessionStorage`, remote `src`/`href`, remote font `@import`, or OAuth
   reference in shipped code (including `examples/`, `customers/` and `sw.js`).
4. **Zero external assets** — system font stack, inline SVG favicon, no CDN, no
   external icon/font/script. A generated Share HTML carries its own inline CSP.
5. **Same-origin Service Worker (`sw.js`)** — precaches same-origin code for
   offline use. It caches **code only** and never stores, reads or forwards rows,
   CSV bytes or `.aether` backups.
6. **Local-only state stays local.** Import recipes, the file vault and
   `.aether` backups live exclusively in IndexedDB / on the user's disk. No
   recipe, header or row value is ever sent off-device — except, under BYOK, the
   table schema (column names + types) and your instruction, which never contain
   any row value; the Egress Guard and `npm run audit` confirm the absence of any
   other data connection.

## What this does NOT protect against

Be honest during any security review:

- **Same-origin ES modules are fully trusted.** An extension loaded from
  `extensions/` has complete DOM, IndexedDB and file-handle access. The core
  cannot sandbox it. Bundled extensions must be reviewed as first-party code.
  For third-party code use an `iframe sandbox` with a `postMessage` capability
  whitelist; for regulated deployments add signed manifests + allowlist + SRI.
- **Shared origins are a real data-exposure risk.** IndexedDB is isolated per
  *origin*, not per path. GitHub Pages serves every site for an account under
  `https://<user>.github.io`, so a second Pages site you own can open and read
  the databases AetherFlow created — even though AetherFlow itself never sends
  a byte. Deploy AetherFlow on a **dedicated origin** (a custom domain, a
  `*.pages.dev` subdomain or a Vercel subdomain) before storing real files.
  See the Deploy section of the README.
- **`.aether` checksum is not a signature.** The SHA-256 (or labelled FNV
  fallback) checksum detects **accidental corruption** — a truncated or
  bit-flipped file. It is not a MAC or a digital signature and provides **no
  authenticity or tamper protection**: anyone who can modify the file can
  recompute the checksum to match. Never treat a matching checksum as proof
  that a backup was not edited.
- **IndexedDB is not encrypted at rest.** Browser profile access = data access.
  A customer requiring encryption must supply their own `StorageAdapter` through
  the SDK (this is a well-defined custom work item, not a core feature).
- **Site data can be evicted or cleared.** There is **no automatic data copy**:
  the "last activity" marker is only a timestamp, not a snapshot. Only an
  explicitly exported `.aether` file can restore lost data. See the honest
  limits in the README.
- **The offline shell needs one online visit.** `sw.js` precaches code on
  install, so a cold offline launch before that first online load has nothing
  cached. It does not add any protection against same-origin script execution:
  a same-origin XSS could read IndexedDB regardless of the Service Worker.
- **An exported Brief contains the rows in plain JSON.** It is a file the user
  chose to produce — treat it with the same care as the original file. The
  payload is escaped against `</script>` breakout, and the file has an inline
  CSP, but it is not encrypted.
- **We are not a data processor.** There is no server, so there are no server
  logs, but the static host may log ordinary asset requests (IP / user agent).
  That is true of every static website.

## Reporting

Open a GitHub issue for non-sensitive bugs. For a vulnerability that could
break the zero-egress guarantee, please include a minimal reproduction and the
exact CSP / browser version. Do not paste real customer data into an issue.
