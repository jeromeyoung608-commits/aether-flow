# AetherFlow

**Turn a messy export into a Brief your boss can open by double-clicking — without your data ever leaving your computer.**

`Zero uploads. Zero accounts. Zero telemetry.`

AetherFlow is for the analyst who has to ship a weekly or monthly report, has no data engineer on the team, and keeps receiving a CSV that does not quite open correctly: odd encoding, semicolons instead of commas, ragged rows, dates that shift by a day, IDs with leading zeros. Drop the file in, fix what needs fixing in the grid, then export a **Brief** — one self-contained `.html` file that opens on anyone's machine, is genuinely read-only, and needs no server, no account and no network.

> The whole trip stays on your disk. A static host sends ~2 MB of **code** once; every byte of **data** stays in your browser's IndexedDB.

```
   messy CSV                AetherFlow (your browser)                 Brief
  ┌─────────────┐          ┌───────────────────────────────┐       ┌──────────────┐
  │ odd export  │  ─────►  │ import → inspect → fix        │ ────► │ one .html    │
  │ ragged rows │          │ (parsed + stored locally)     │       │ double-click │
  └─────────────┘          └───────────────────────────────┘       │ read-only    │
                                                                     └──────────────┘
```

1. **Import** — encoding, delimiter and surplus fields are detected *and reported*, never silently corrected.
2. **Inspect & fix** — sort, filter, validate, edit. Any normalization that rewrites values is explicit and confirmed.
3. **Deliver** — `Export Brief` (or CSV / `.aether` backup). The Brief is a file you can email, archive or double-click.

This repository ships the **product kernel**: the same code you can self-host for free, with no account and no build step. Private deployments for organisations are custom delivery work built on top of this kernel — not a second product, not a hosted service, and never a place where your data is sent. See [`COMMERCIAL.md`](COMMERCIAL.md).

---

## Technical baseline

> Dependencies **0** · Outbound **data** requests **0** after load · Rows **100,000** · License **MIT**

AetherFlow is a static site you can deploy with a single `git push`. There is no backend, no build step, no bundler, no account, no API key and no telemetry. Drop a local CSV: it is parsed in a Web Worker, stored in **IndexedDB on your machine**, and rendered by a virtual-scrolling grid that keeps a constant number of DOM nodes at any dataset size.

One precise note on "0 network requests": after the page has loaded the app issues **zero outbound data requests**. Static assets (HTML, CSS, ES modules) and same-origin Worker scripts are still fetched from the host — as *code*, not as your files — and a Service Worker precaches that same-origin code after your **first online visit** so the application shell also works offline. You can verify all of this in the Network panel.

---

## Why

Most "AI data tools" require you to upload your spreadsheet to someone else's computer. For a lot of work — a diligence folder, a clinical trial export, an internal audit sheet — that is a non-starter. The person who has to produce the report is usually also the person who is not allowed to send the data anywhere.

Web storage is good enough now to invert the model: the host sends ~2 MB of **code** once, and every byte of **data** stays on the user's device. No database to pay for, no upload bandwidth, no data-processing agreement to sign. The output is not a dashboard that needs a login to view — it is a file.

```
   static host ──► index.html + ES modules + Workers   (code only, once)
                          │
   your disk ─────► File.stream() ──► csv.worker.js ──► IndexedDB ──► grid.worker.js ──► DOM
                    (never an outbound data request)
```

---

## Quick start

```bash
git clone https://github.com/OWNER/aether-flow.git   # replace OWNER after publishing
cd aether-flow
npm run serve          # zero-dependency static server, no npm install needed
# open http://localhost:5173
```

If port 5173 is taken, pick another one: `PORT=5199 npm run serve` → `http://localhost:5199`. Or use `python3 -m http.server 5173`. **Do not open `index.html` via `file://`** — ES modules and module Workers require `http(s)`.

```bash
npm run verify         # syntax + import graph + tests + zero-egress audit
```

### Deploy (any of these, all free, all zero-build)

Pick a host that gives AetherFlow its **own origin**. IndexedDB is isolated per origin: any other site on the same origin can read the local files AetherFlow stored. For a tool whose whole promise is "your files never leave your device", a shared origin is a privacy hole, not a footnote.

| Host | Setup | Origin isolation |
| --- | --- | --- |
| Cloudflare Pages (`*.pages.dev`) | Connect repo, **leave Build command empty**, output dir `/`. `_headers` ships the CSP. | Dedicated subdomain — recommended. |
| Vercel (`*.vercel.app`) | Import repo, no framework preset, no build command. `vercel.json` ships the CSP. | Dedicated subdomain — recommended. |
| Custom domain on either of the above | Add your own domain in the host's dashboard. A dedicated origin is the safest home for real files. | Dedicated origin — recommended. |
| GitHub Pages | Settings → Pages → Deploy from branch → `main` / `/root`. | Convenient, but **not recommended for real files**: every Pages site under the same account shares `https://<user>.github.io`, so another of your Pages sites can read this workspace's IndexedDB data. |

> `_headers` is a **Cloudflare Pages** convention — it is ignored by GitHub Pages, Vercel and the local `server.js`. Vercel uses `vercel.json` and the local server sets headers in code. GitHub Pages cannot send response headers at all, so the `<meta http-equiv="Content-Security-Policy">` in `index.html` is the fallback; meta-CSP cannot enforce `frame-ancestors`, which is one more reason not to put real files there.

---

## What to try (15 seconds)

1. **Drop a CSV** anywhere (or double-click empty space / press `⌘K` → `Import`). Watch the **real** two-phase progress bar: parsing bytes, then batched IndexedDB writes.
2. **Scroll** 100,000 rows. The app boots with an in-memory 100k demo; `⌘K → stress-100k` reloads it any time. The Benchmark HUD shows `DOM nodes` staying constant and `Query ms` from the Worker.
3. Press **`⌘K`** (Windows: `Ctrl+K`) → type `validate` → run `Validate all rows`. Edit a numeric cell to `abc`: the cell turns red with a `!` marker and the edit is **rejected**.
4. `⌘K` → `sort mrr descending`, or click a header (Shift = multi-sort). Double-click a column edge to auto-fit.
5. `⌘K` → `brief` → **Export Brief**: get a **single self-contained `.html`**. Double-click it: 100k rows, filterable, virtual-scrolled, genuinely read-only, zero network.
6. Open the **Network panel**: 0 outbound data requests after load. The status bar shows the live Egress Ledger count.
7. **Refresh the page**: your files, column widths, sort order and edits are all still there (in IndexedDB — as long as the browser has kept site data).
8. Click **Backup** → `.aether` file. Restore it on another machine, or save it into a local synced folder. **This is the only thing that can restore your data** — see the honest limits below.

---

## Feature reference

Everything below ships in the sample site. Every action is registered through the public SDK, so the site is the first consumer of its own API.

### Grid & navigation

| Feature | What it does |
| --- | --- |
| **Virtual scroller** | Constant DOM pool at any dataset size — only visible rows are rendered; 100,000 rows is the hard acceptance baseline. |
| **Sort & filter** | Worker-offloaded sort, Shift-click multi-sort, global search across all columns, per-column filter row (toggleable). Queries return index arrays; stale answers are discarded by request id. |
| **Inline editing** | Double-click a cell to edit; keyboard navigation; `role="grid"`, `aria-sort`, live-region toasts. |
| **Column layout** | Double-click a column edge to auto-fit; reorder columns; hide / show columns; `Reset column layout` restores the defaults. |
| **Appearance** | Light / dark theme, three row densities (`compact` / `comfortable` / `relaxed`). |
| **Selection & bulk bar** | Row checkboxes, select-all, export selection, bulk delete with a confirmation step. |
| **Benchmark HUD** | Live `DOM nodes`, `FPS` and `Query ms`; toggleable. |
| **Per-file state** | Column widths, order, hidden columns, density, sort and committed edits are stored under `layout:<fileId>` / `edits:<fileId>` — switching files never leaks another file's state. Invalid-cell markers are in-memory only. |

### Files & import

| Feature | What it does |
| --- | --- |
| **Local file tree** | Import several files, switch between them, delete one (with confirmation). Rows live in IndexedDB, never in a sync log. |
| **Streaming parse** | `File.stream()` → `csv.worker.js` incremental state machine → batched IndexedDB writes, with a **real** byte/row progress bar (never a fake timer). Handles quoted fields, escaped quotes, embedded newlines, CRLF and arbitrary chunk boundaries. |
| **Encoding** | UTF-8 BOM, UTF-16LE BOM, UTF-16BE BOM. GBK and Windows-1252 exports are detected as **candidates** and flagged ambiguous so you confirm the 20-row preview before import — no silent mojibake. Genuinely undecodable bytes (real corruption) still fail with a clear re-export hint. |
| **Date ambiguity** | Slash-dates where both parts are ≤ 12 (e.g. `3/4/2025`) are flagged at import and you are asked to choose **DD/MM vs MM/DD** before anything is written. Cancelling leaves the raw string untouched (flagged invalid) — AetherFlow **never guesses** the order and never aborts the import. |
| **Import recipes** | The encoding / delimiter / header-row / skip-row / date-order you chose for a file is saved locally and re-applied on the next import of the same file. Review or delete them with `⌘K → recipes`. Local-only; they never leave the device. |
| **Delimiter sniffing** | Comma, semicolon, tab and pipe, chosen per file; commas inside quoted cells do not win. |
| **Lossless import** | The default rule is **trim only**. Currency symbols, date spellings and newlines are preserved. Aggressive normalization is an explicit, confirmed command — never a side effect of importing. |
| **Surplus fields** | Rows longer than the header keep their tail in `__extra`; nothing is silently dropped. |
| **Import warnings** | The guessed delimiter, detected encoding, stripped BOM and extra-column count are surfaced as user-visible warnings. A plain comma/UTF-8/no-BOM file stays quiet. |
| **Value fidelity** | UTC-safe date rendering (no local-timezone day shift), leading zeros (`00123`) and >2^53 identifiers preserved in the grid and in Briefs. |
| **Schema inference** | Header sanitization, column type detection, sample-based inference with buffered rows replayed once the schema is known. |

### Editing & data quality

| Feature | What it does |
| --- | --- |
| **Column validation** | `columns[].validate` accepts a function, a named rule or an array. Built-ins: `required`, `number`, `integer`, `percent`, `email`, `isoDate`, `maxLength`. Illegal edits are rejected, marked with a red border + `!`, and custom rules can be registered through the SDK. |
| **Full-table validation** | `Validate all rows` scans 100k rows and yields to the UI every 5,000 rows; `Clear invalid markers` resets the flags. |
| **Explicit Clean data** | `trim` / whitespace collapse / ISO date normalization / numeric normalization as a **confirmed, explicitly opt-in** command. It rewrites cell values and says so before running, with a one-step **Undo last clean**. |
| **Bulk delete + Undo** | Confirmation required, one transaction, and a one-step `Undo last bulk delete`. |
| **Visible write failures** | A failed IndexedDB write rolls back the optimistic UI and raises a visible error — it is never swallowed. |
| **Data Health Report** | A local, zero-dependency scan (`⌘K → health`) over the in-memory rows — **it never changes your data**. Six checks: missing values, leading/trailing whitespace, type mismatch, duplicate rows, date-format mix, and irrecoverable numeric/ID corruption (scientific notation, leading-zero loss). Findings are sorted High → Medium → Info by affected rows and shown in a right-side panel. The optional Region / Industry Rule Pack switch is opt-in: header detection only *suggests* a pack, which is applied only when you explicitly enable it or declare the region/industry — never auto-applied. Each finding is tagged with its pack id (`region.us`, `form.email`, …) or `Built-in`. |
| **Fixable vs Unresolved** | Each finding is `fixable` (one-click **Apply** runs the same dry-run Cleanse Preview the explicit Clean command uses — nothing is written until you confirm) or `unresolved` (red border, preserved as-is, never silently dropped or auto-replaced). `⌘K → issues` lists every flagged cell with one-click **Locate**; `⌘K → clear-invalid` resets the markers. |

### Analysis & delivery

| Feature | What it does |
| --- | --- |
| **Brief — read-only HTML** | The deliverable. One self-contained `.html` with inlined CSS, escaped JSON payload and a tiny virtual renderer. Inline CSP, no write path, no network. Horizontal header sync, debounced search, a 25 MB ceiling (with an O(1) sampled size estimate) and numeric fidelity. The internal SDK id is still `snapshot-html`. |
| **CSV export** | Current view or current selection; Excel-safe BOM; spreadsheet formula-injection guard (genuine negative numbers stay numbers). When a normalize or rule-pack rewrite is applied, the original value is preserved in a `… (raw)` column in the exported CSV (the caller keeps `raw`); desensitized and Markdown exports omit raw so PII is not re-exposed. |
| **`.aether` backup / restore** | SHA-256 checksum with a labelled FNV fallback, integrity verification on restore, atomic generation-staged import and single-swap restore. |
| **Save to local synced folder** | `showSaveFilePicker()` writes the backup into a folder your *own* sync client already manages — no OAuth, no cloud API. Falls back to a plain download when unavailable. |
| **Mini chart** | Hand-written Canvas bar / line chart from the selected numeric column; no charting library. |

### Demos & non-product surfaces

These are kept to prove an SPI works. They are **not** part of the reporting product and are labelled `DEMO` in the UI.

| Feature | What it does |
| --- | --- |
| **AI Rules · Bring Your Own Key (BYOK)** | Bring your own API key + endpoint; AetherFlow sends **only the table schema + your instruction** and never your row data. The model returns JSON rules, which are validated against a fixed vocabulary and executed **locally** behind a confirm dialog. Opt-in and default-closed: until you configure an endpoint, the egress allowlist is empty and every outbound request is blocked. Reachable from the `⌘K` command, marked `experimental`. |
| **100k stress demo** | One command reloads the synthetic 100,000-row dataset for benchmarking. |

### Privacy, state & reliability

| Feature | What it does |
| --- | --- |
| **Zero-egress boundary** | CSP relaxed to `connect-src 'self' http: https:` *only* so your configured BYOK endpoint can be reached — but the runtime Egress Guard is the real boundary: it blocks and records `fetch` / XHR / `sendBeacon` / WebSocket / EventSource and cross-origin Workers, permitting **only** the single origin you configured. With no endpoint set the allowlist is empty and every request is blocked. A visible Egress Ledger and `npm run audit` failing CI on any network primitive outside the guard (or on legacy sync storage / OAuth references) back the claim. |
| **Atomic writes** | Imports stage a whole new generation and flip the file pointer only after every batch succeeds; restores swap `files` + `meta` in one step; bulk delete is one transaction. A failed import or restore leaves the previous workspace untouched. |
| **Persistence aids** | `storage.persist()`, a **last-activity marker** (a timestamp, *not* a data copy), a pre-unload reminder, and an explicit `TEMPORARY MODE` warning when IndexedDB is unavailable and the MemoryVault fallback is in use. |
| **Multi-tab warning** | A `BroadcastChannel` presence guard warns when another tab has the workspace open. It does **not** merge or lock — the last save wins. |
| **Offline shell** | `sw.js` precaches same-origin **code** only, never rows or `.aether` files. A cache miss returns an explicit 503 with a reconnect hint instead of a blank page. |
| **Capability self-check** | One command reports the active vault, persistent-storage grant, File System Access, module Worker support and the outbound-request count. |

### Commands (`⌘K` / `Ctrl+K`)

The palette has fuzzy matching and full keyboard control. Every built-in command is SDK-registered, so extension commands appear alongside them.

| Command | What it does |
| --- | --- |
| `Import local CSV / TSV` | Open the file picker. |
| `Restore .aether backup` | Verify checksum and atomically restore a backup file. |
| `Export current view as CSV` | Download the current view (Excel-safe BOM). |
| `Export .aether backup` | Download a portable backup. |
| `Save backup to a local synced folder` | Write via File System Access. |
| `Export Brief (read-only HTML)` | Generate the self-contained, double-clickable Brief. |
| `Validate all rows` | Chunked full-table validation scan. |
| `Clear invalid markers` | Reset validation flags. |
| `Undo last bulk delete` | Re-insert the last deleted selection. |
| `Clean data (explicit)` | Confirmed trim / collapse / date / numeric normalization. |
| `Undo last clean` | Revert the most recent Clean-data pass (one step). |
| `Chart the selected numeric column` | Open the Canvas mini chart. |
| `AI Rules · Bring Your Own Key` | Open the BYOK panel: describe a rule in plain language; with an endpoint + key configured, AetherFlow sends only the schema + instruction, previews the returned rules, and applies them locally after you confirm. |
| `Load 100,000-row stress demo` | Reload the benchmark dataset. |
| `Toggle benchmark HUD` | Show / hide FPS, DOM nodes and query ms. |
| `Toggle column filter row` | Show / hide per-column filters. |
| `Cycle row density` | `compact` → `comfortable` → `relaxed`. |
| `Toggle light / dark theme` | Switch the visual theme. |
| `Focus global search` | Jump to the all-column search box. |
| `Reset column layout` | Restore widths, order and hidden columns. |
| `Show outbound request ledger` | Report blocked outbound attempts (must stay 0). |
| `Show saved import recipes` | List the per-file encoding/delimiter/date-order choices remembered locally; delete any. |
| `Run Data Health Report` | Scan rows for missing / whitespace / type / duplicate / date-format / ID-corruption issues; open the right-side panel (read-only until you choose to apply or flag). |
| `Show Unresolved (Manual Review Required)` | List every flagged cell with one-click Locate; these are preserved as-is, never auto-changed. |
| `Show this browser's capabilities` | Report vault, storage grant, FSA, Worker support, egress count. |

---

## Guarantees — and the honest limits

We would rather be precise than impressive.

| Claim | Precise meaning |
| --- | --- |
| **0 outbound data requests** | After page load, the app issues **no** `fetch`, `XHR`, `sendBeacon`, `WebSocket` or `EventSource` — unless you opt into BYOK, in which case *only* the single endpoint you configured is reachable, and *only* the table schema + your instruction are sent (never row values). With BYOK off, the allowlist is empty and nothing is reachable. CSP `connect-src 'self' http: https:` permits your endpoint; the runtime Egress Guard is the real boundary and blocks + logs everything else. |
| **Your data stays on this device** | Files are parsed in a Worker and written to IndexedDB. Nothing is sent anywhere. "Data stays on this device **as long as site data is kept**." |
| **Not permanent storage** | Browsers may evict site data under disk pressure, and clearing site data / switching devices always loses it. There is **no automatic data copy, and no periodic snapshots**: the status bar's "Last activity …" is only a timestamp, and the pre-unload reminder only warns. **If site data is evicted, only an exported `.aether` file can restore it.** |
| **Writes are atomic; deletion is reversible one step** | Imports stage a new generation and swap the file pointer only after every batch succeeds; restores swap `files` + `meta` together; bulk delete runs in one transaction and offers a one-step Undo. A failed write rolls the UI back and shows an error — it never fails silently and never leaves a half-written workspace. |
| **`.aether` checksum is not a signature** | SHA-256 (with a labelled FNV fallback) detects **accidental corruption** — a truncated or bit-flipped file. It is not a MAC or a digital signature and does **not** prove authenticity or prevent tampering: anyone who can edit the file can recompute the checksum. It catches damage, not forgery. |
| **100,000 rows** | Hard acceptance baseline: constant DOM pool, Worker-offloaded sort/filter. Large files show a **real progress bar** while they parse. We do **not** claim a 500 MB file renders instantly — sharded indexing for that scale is a later milestone. |
| **No cloud sync** | There is no OAuth, no Drive API, no Airtable connector, no relay. Multi-device handoff is a `.aether` file; `Save to local folder` lets you write it into a folder your *own* sync client (iCloud Drive, Drive Desktop) already manages. |
| **Single instance** | No cross-device realtime collaboration. Multi-tab editing is not safe — see *Known limitations*. |
| **Browser support** | Verified by **Node logic + integration tests** using a DOM shim; a real-browser matrix is **CI work in progress**, not a shipped guarantee. Module Workers, `File.stream()` and the `showSaveFilePicker` → plain-download fallback are **not yet exercised** by real-browser tests. No claim of writing back into user folders on iOS. |

Non-goals: cloud sync, accounts, subscriptions, Pro tiers, row limits, multi-tenant, server-side AI, generic file sharing.

### Known limitations

- **Single instance, no version check.** Opening the workspace in two tabs can overwrite edits — the last save wins. A tab guard warns you, but there is no merge or OT.
- **Undo is one step.** It covers bulk delete and the last Clean-data pass; there is no general undo/redo history covering cell edits or imports.
- **The offline shell needs one online visit.** `sw.js` precaches same-origin code only; a cold offline launch before that first online load has nothing cached. It never caches rows or `.aether` files.
- **AI is Bring-Your-Own-Key, not a built-in feature.** BYOK is opt-in and default-closed. AetherFlow sends only the table schema + your instruction and never your row data, and the model's rules run locally behind a confirm dialog. No model ships with the product.
- **A Brief is a read-only table today.** It contains rows, a filter and virtual scroll — no charts, KPI cards or narrative summary yet. Those are a later milestone. "snapshot" in the backup sections below means a *data snapshot*, a different thing.
- **Checksum ≠ signature.** It detects accidental corruption, not tampering (see above).
- **No automatic data snapshot.** Nothing copies your rows in the background. Export a `.aether` file yourself.
- **Backup format is versioned but has no migration chain.** `.aether` carries `format: 'aether'` and `version: 1`; restore rejects newer versions. There is no upgrader that converts a future v2 file back to v1.
- **Scale and collaboration are later milestones.** 500 MB streaming-parse sharding and canvas/OT collaboration are not implemented.

---

## Architecture

```
┌─ Shell (English · WCAG · Cmd+K) ────────────────────────────────────────────┐
│  Local Files tree  │  Zenith grid (virtual scroll, validation, bulk)        │
└────────────────────┴───────────────────────────────────────────────────────┘
┌─ SDK (public API · SPI registries · Hook bus · stability tiers) ────────────┐
│  commands / validators / exporters / parsers / storage / charts …          │
└────────────────────────────────────────────────────────────────────────────┘
┌─ Workers (all same-origin module Workers; main thread never parses/sorts) ─┐
│  csv.worker.js   File.stream() → encoding/delimiter → CSV state machine    │
│  grid.worker.js  holds dataset, answers filter+sort with index arrays      │
└────────────────────────────────────────────────────────────────────────────┘
┌─ Storage ──────────────────────────────────────────────────────────────────┐
│  IDBVault: files / rows(composite key) / meta(layout:<fileId>,             │
│            edits:<fileId>, lastActivity)                                    │
│            generation-staged import + single-swap restore                  │
│  MemoryVault: in-memory fallback when IndexedDB is unavailable (temporary) │
└────────────────────────────────────────────────────────────────────────────┘
┌─ Offline shell ────────────────────────────────────────────────────────────┐
│  sw.js precaches same-origin CODE only (never rows / .aether files);        │
│  first offline launch requires one prior online visit                       │
└────────────────────────────────────────────────────────────────────────────┘
```

**Two-channel rule (deliberate):** row data lives in IndexedDB and never goes into a sync log. A future OT layer would transmit only small `TableDelta` operations and view state. Putting 100k rows × per-cell operations into a hub log would explode it on day one.

**Trust boundary:** a runtime Egress Guard that blocks and records every outbound attempt, a CSP relaxed to `connect-src 'self' http: https:` *only* so your configured BYOK endpoint can be reached (everything else is blocked and logged), and `npm run audit` which fails CI on any network primitive outside the guard, any `localStorage` / `sessionStorage`, or any OAuth reference in shipped code.

---

## Open interfaces

Everything a user might want to connect is behind a small, versioned SDK. The sample site registers its own commands, validators and exporters through it — it is the first consumer of its own API.

```js
import { AetherFlow } from './src/sdk/index.js';

// Add a domain-specific validation rule
AetherFlow.validators.register('sku', (v) => /^[A-Z]{3}-\d{5}$/.test(v) || 'Use ABC-12345');

// Add a command to the Cmd+K palette
AetherFlow.commands.register('export-bates', {
  title: 'Export Bates-numbered CSV',
  keywords: 'legal discovery export bates',
  run: () => AetherFlow.get('exporters', 'csv')(),
});

// React to any edit (future OT / audit / automation)
AetherFlow.on('meta:delta', (op) => console.log(op));
```

`window.AetherFlow` is exposed in the console, so you can try this without editing a file.

Every extension declares a manifest with an `egress` promise:

```js
export const manifest = {
  id: 'aether.parser.dicom',
  api: '^1.0',
  egress: 'none',            // 'none' | 'explicit' | 'required'
  permissions: ['files.read', 'metadata.write'],
  provides: ['parser:dcm'],
  subscribe: ['file:ingest'],
};
```

An `egress: 'explicit'` extension must **also** relax the CSP — two visible, reviewable steps, so nobody breaks the 0-request promise by accident. See [`docs/api.md`](docs/api.md), [`examples/`](examples/) and [`customers/_template/`](customers/_template/).

**Extension safety, stated plainly:** same-origin ES modules have full DOM / IndexedDB / file-handle rights. The core cannot sandbox them. Treat bundled extensions as fully trusted code; use an `iframe sandbox` + capability whitelist for third-party code. See `SECURITY.md`.

---

## Product kernel & private delivery

- **Open:** this repository, MIT, self-hostable, no account, no build step, no data sent anywhere.
- **Custom delivery:** private deployments, domain-specific extensions under `customers/<name>/`, integration into an organisation's own origin, acceptance scripts and support. All of it runs on the **same kernel** — customer differences land in extensions, never in a core fork.
- **Not offered:** hosting, SaaS, a managed control plane, data processing on our side, encryption at rest by default, or any service that receives your rows.
- **Shadow IT is real:** if employees use the free kernel on company data, that is a compliance question for the organisation, not a technical failure of the tool. A private engagement exists to answer it with a defined deployment, support boundary and acceptance script.

See [`COMMERCIAL.md`](COMMERCIAL.md) for the exact boundary and [`docs/licensing-decision.md`](docs/licensing-decision.md) for the licensing decision record.

---

## Layout

```
index.html  _headers  vercel.json  server.js  sw.js
COMMERCIAL.md  CLA.md  SECURITY.md  CONTRIBUTING.md  CHANGELOG.md  LICENSE
styles/     grid.css · theme-dark.css · app.css
src/
  shell/    app.js (bootstrap) · egress.js (guard + ledger) · tabs.js (tab guard)
  sdk/      index.js (the ONLY public surface)
  main.js   Grid — Zenith core with IndexedDB persistence + validation
  core/     StateManager · VirtualScroll · ZenithAdapter
            grid.worker.js · csv.worker.js
  storage/  idb.js (IDBVault + MemoryVault) · backup.js (.aether)
  io/       ingest.js · cleanse.js · recipe.js · byok.js · schema.js · health.js · snapshot-html.js · snapshot-runtime.js
  ui/       palette.js · chart.js · files.js · status.js · byok-settings.js · byok-preview.js · health-report.js · issue-list.js · cleanse-preview.js · date-ambiguity.js · import-preview.js · recipe-list.js
  utils/  components/  data/  extensions/
scripts/    check.mjs · audit.mjs · smoke.mjs · browser-smoke.mjs
docs/       api.md · licensing-decision.md
.github/workflows/verify.yml
examples/ customers/_template/ tests/
```

`snapshot-html.js` / `snapshot-runtime.js` keep their historical module names because they are referenced by the public SDK and by tests; the **product name** of the file they produce is **Brief**.

## Stability & versioning

`stable` follows semver with a two-minor deprecation notice; `beta` / `experimental` may change; `internal` modules must not be imported by extensions. `CHANGELOG.md` records every public-surface change.

## Contributing

Zero runtime dependencies is a hard rule — see `CONTRIBUTING.md`. `npm run verify` must pass; CI additionally runs `scripts/smoke.mjs` and a (non-blocking) Playwright browser smoke. Contributions are accepted under the DCO sign-off and the contributor terms in `CLA.md`.

## License

MIT — see `LICENSE`. The vendored Zenith core is MIT as well. No GPL/AGPL code, no third-party parser, no external font or icon dependency.

An optional commercial agreement is available for private delivery engagements. It is **additive to MIT, not a substitute**: MIT already permits commercial use, modification and redistribution, so **no signature is needed to use this code commercially**. What a signed agreement can add is a warranty, indemnity, a support commitment, trademark permission and terms for privately commissioned extensions. See `COMMERCIAL.md`. The AetherFlow name and mark are not granted by the MIT license.

---

*AetherFlow is an open product kernel. Private deployments and custom delivery are built on top of that same kernel — the data still never leaves the user's computer.*
