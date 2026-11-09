# extensions/

Put your own code here. The core never needs to be forked.

An extension is an ES module that imports **only** `src/sdk/index.js` and calls
`register(...)` / `on(...)` at bootstrap. See `examples/custom-validator.js` and
`examples/custom-exporter.js` for two complete, runnable examples.

Rules:

- Declare a manifest with `egress: 'none'` by default. A network capability
  requires `egress: 'explicit'` **and** a CSP change — both are reviewable.
- Same-origin modules are fully trusted (they can reach DOM, IndexedDB and file
  handles). There is no sandbox in the core; see `SECURITY.md`.
- Only depend on the `stable` / `beta` public surface. `internal` modules are
  off-limits and may change without notice.
- No runtime dependencies. `npm run audit` scans this directory too.
- One customer = one `customers/<name>/` directory, not a git branch. See
  `customers/_template/manifest.js`.

Reserved SPI slots (not yet implemented in the open-source core, deliberately
kept in the registry so custom work has a stable place to land):
`IdentityResolver`, `AuditSink`, `TransportLink`, `Connector`, `WorkflowState`,
`AIProvider`. These are the parts a typical enterprise engagement pays for.
