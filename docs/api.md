# AetherFlow public API · v1.0.0

The **only** supported import for extensions is `src/sdk/index.js`.

```js
import { AetherFlow, defineModule, STABILITY } from '../src/sdk/index.js';
// or, in a bundler: import { AetherFlow } from 'aether-flow/sdk';
```

`window.AetherFlow` is available in the browser console of the sample site.

## Stability tiers

| Tier | Meaning |
| --- | --- |
| `stable` | Semver-protected. Deprecation announced at least 2 minor releases ahead. |
| `beta` | Signature may change; documented in CHANGELOG. |
| `experimental` | No guarantees. |
| `internal` | Not importable by extensions. CI checks the sample site. |

`apiVersion: 1.0.0` · `version: 0.1.0` · `STABILITY.STABLE | BETA | EXPERIMENTAL | INTERNAL`.

---

## Core

### `AetherFlow.commands.register(name, impl, opts)` — **stable**
`impl` is `{ title, keywords?, hint?, run }` (or a plain function). `run` may be
async. Commands appear in the Cmd+K palette automatically.
```js
AetherFlow.commands.register('hello', {
  title: 'Say hello', keywords: 'greet demo', hint: 'example',
  run: () => console.log('hello'),
}, { stability: STABILITY.STABLE, description: 'Example command' });
```
Returns an unregister function. **Errors:** `Invalid stability: …`.

### `AetherFlow.validators.register(name, fn, opts)` — **stable**
`fn(value, row) → true | false | string`. A string becomes the cell's tooltip.
Named rules become usable as `columns[].validate: 'name'`.
```js
AetherFlow.validators.register('sku', v => /^[A-Z]{3}-\d{5}$/.test(v) || 'Use ABC-12345');
```
Built-ins: `required, number, integer, percent, email, isoDate, maxLength`.

### `AetherFlow.exporters.register(name, fn, opts)` — **stable**
`fn(selection, opts) → Blob | void`. Built-ins: `csv`, `aether-backup`,
`local-folder` (beta), `snapshot-html` (the **Brief** exporter — the user-facing
product name is Brief; the SDK id is kept stable).

### `AetherFlow.on(topic, handler)` / `emit(topic, payload)` — **stable**
Wildcard `'*'` receives `(topic, payload)`. Handler exceptions are caught and
logged so a broken extension cannot take down the grid.

| Topic | Payload |
| --- | --- |
| `file:ingest` | `{ id, name, rows }` |
| `file:indexed` | `{ id, descriptor }` |
| `file:changed` | `{ id, name }` |
| `file:deleted` | `{ id }` |
| `meta:delta` | `{ id, field, value }` — emitted on every committed edit |
| `view:state` | `{ sorters, filters }` |
| `batch:merged` | `{ added, changed, conflict }` (S2) |
| `sync:op` | OT operation (S3) |
| `ai:chunk` / `ai:state` | streamed insight / `idle\|loading\|streaming\|error` |
| `audit:append` | `{ action, at, … }` |
| `plugin:loaded` | `{ id, api }` |
| `egress:declared` | `{ count, last }` |
| `command:run` / `command:error` | `{ name, error? }` |
| `chart:open` | `{ field, count }` |

### `AetherFlow.register(kind, name, impl, opts)` / `get` / `list` — **stable**
Generic form of any registry. **Errors:** `Unknown extension kind: …`.

### `AetherFlow.getLedger()` — **stable**
Returns a copy of `[{ when, kind, target, by }]`. Empty array = 0 outbound
attempts. `setLedgerProvider(fn)` is host-only wiring.

### `defineModule(manifest, create)` — **stable**
```js
export const { manifest, create } = defineModule({
  id: 'aether.parser.dicom',
  egress: 'none',               // 'none' | 'explicit' | 'required'
  permissions: ['files.read', 'metadata.write'],
  provides: ['parser:dcm'],
  subscribe: ['file:ingest'],
}, (ctx) => ({ match, parse }));
```
Defaults `api: '^1.0'`, `egress: 'none'`, `stability: 'stable'`.

---

## SPIs

| SPI | Key methods | Stability | Typical implementation |
| --- | --- | --- | --- |
| `StorageAdapter` | `open / get / put / putMany / getAll / getRows / delete / deleteRows / clear / estimate` | **stable** | `IDBVault`, `MemoryVault`, customer encrypted/sharded vault |
| `Parser` | `match(file)`, `parse(blob) → { rows, columns, header }` | **stable** (core: CSV/TSV) | XLSX, PDF, DICOM, MSG, proprietary formats |
| `Validator` | `(value, row) → true \| string` | **stable** | domain rules, uniqueness, cross-field checks |
| `Exporter` | `(selection, opts) → Blob` | **stable** | Bates numbering, load files, custom reports |
| `ChartType` | `draw(canvas, values, opts)` | **beta** | sparkline, histogram, scatter |
| `FileSource` | `list / read / write / watch?` | **beta** | local folder, OPFS, customer file gateway |
| `Indexer` | `extract(file) → descriptor` | **beta** | custom metadata, EXIF stripping, fingerprints |
| `IdentityResolver` | `current() → { actor, roles }` | **experimental** | local role profile / WebAuthn / Entra ID (explicit) |
| `AuditSink` | `append(entry)` | **experimental** | evidence pack export / customer SIEM (explicit) |
| `AIProvider` | `suggest(ctx) → instruction` (BYOK: schema + instruction in, validated JSON rules out) | **experimental** | Bring-Your-Own-Key / local rules |
| `TransportLink` | `post / close / onMessage` | **experimental** | BroadcastChannel / file handoff / private relay (explicit) |
| `Connector` | `pull() → rows` | **experimental** | customer DMS / Sheets / Airtable (explicit) |
| `WorkflowState` | `transition(from, action, actor)` | **experimental** | review / approval / retention |

### StorageAdapter contract (`src/storage/idb.js`)

- `rows` uses a composite key `[fileId, id]` and a `byFile` index.
- `putMany(store, values, onProgress, batchSize = 2000)` commits in bounded
  transactions and calls `onProgress(done, total)` with **real** counts.
- `getRows(fileId)` returns plain records; `get('meta', key)` returns
  `{ key, value }` or `undefined`.
- Implementations must never throw on missing IndexedDB — return a fallback.
- **Error codes:** `Vault is not open`, `IndexedDB unavailable`,
  `IndexedDB upgrade blocked by another tab`.

### Per-file metadata keys

Layout, edits and validation markers are **namespaced per file**, not global.
The shell and the Grid both call `metaKey(kind, fileId)` exported from
`src/main.js`, which returns `` `${kind}:${fileId || 'default'}` ``.

| Key | Value |
| --- | --- |
| `layout:<fileId>` | column widths / order / hidden / density / sorters |
| `edits:<fileId>` | committed cell edits for that file |
| `lastActivity` | a timestamp **only** — a last-activity marker, **not** a data copy |

**Validation markers are not persisted at all.** `Grid.invalid` is an in-memory
`Map` that resets on reload; there is no `invalid:<fileId>` key.

A global `layout` / `edits` key (0.1.0) is no longer written. There is **no
automatic snapshot**: only an explicit `.aether` export can restore rows if site
data is evicted. The `.aether` checksum detects accidental corruption; it is
not a signature and does not prevent tampering.

### Grid context switching — `setContext(fileId)` / `flushPending()`

Host-only methods on the `Grid` instance (`src/main.js`):

- `await grid.setContext(fileId)` switches the per-file storage namespace. It
  **awaits `flushPending()` first**, which commits any debounced layout/edit
  writes to the *old* `fileId` before the context changes.
- **Call and await `setContext()` before `loadData()` or `replaceColumns()`**
  when opening another file. Otherwise a pending write can land on the newly
  opened file — showing or even erasing the wrong file's edits.
- `await grid.flushPending()` is also safe on its own (e.g. before a manual
  export or a teardown); it resolves after all pending meta writes settle.
- `grid.resetLayout()` flushes internally before clearing the current file's
  `layout:` / `edits:` keys.

### Column definition (`Grid`)

```js
{
  field: 'mrr', header: 'MRR', width: 130, type: 'number', align: 'right',
  pinned: 'left', sortable: true, resizable: true, filterable: true,
  editable: true,
  validate: ['required', 'number'],   // function | named rule | array
}
```
`type`: `text | number | currency | date | check`. `validate` may also be a
function `(value, row) => true | string`. Illegal edits are rejected and the
cell is marked; `Grid.validateAll()` fills the invalid map for the whole table.

### Grid hooks (host-only, passed to `new Grid(...)`)

`storage`, `fileId`, `initialLayout`, `initialEdits`, `onEdit(op)`,
`onInvalid(msg)`, `onStats(stats)`, `onNotice(msg, kind)`. `initialLayout` and
`initialEdits` are read through the namespaced keys above. `onEdit` is the exact
seam an OT engine or an audit extension subscribes to.

---

## Egress policy

| `egress` | Requirement |
| --- | --- |
| `none` (default) | `npm run audit` fails on any network primitive in shipped code. CSP is `connect-src 'self' http: https:`, but the runtime guard keeps the allowlist empty until the user configures a BYOK endpoint, so no data connection is possible. |
| `explicit` | Must ALSO relax the CSP. Ledger records `{who, when, target, declaredBy}`; UI badge switches from `0 outbound` to `N outbound`. |
| `required` | Not permitted in the open-source core. Custom builds only. |

Two independent actions are required to break the 0-request promise, so it
cannot happen by accident — and the change is visible in review.

## Extension safety

Same-origin ES modules have full DOM / IndexedDB / file-handle rights; the core
**cannot** sandbox them. T1 = bundled first-party code (fully trusted, default).
T2 = `iframe sandbox` + `postMessage` capability whitelist for third-party code.
T3 = signed manifest + allowlist + SRI for regulated deployments. See
`SECURITY.md`.

## Change history

- `1.0.0` (2026-11-07, S0/S1) — initial public surface. All registries and the
  hook bus are `stable`; chart / FileSource / Indexer are `beta`; identity,
  audit, AI, transport, connector and workflow SPIs are reserved as
  `experimental` for custom work.
- Per-file metadata keys (`layout:<fileId>` / `edits:<fileId>`),
  `Grid.setContext(fileId)` / `flushPending()`, the corruption-only checksum
  wording and the `sw.js` offline shell are documented above. These are
  behaviour/doc corrections on top of the same `0.1.0` SDK surface; public
  signatures are unchanged.
