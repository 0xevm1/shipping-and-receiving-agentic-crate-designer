# Client-side data store — plan & recommendation

**Status:** planned, not implemented. The first pass keeps state in React (`useState` + a pure
`computeDesign()`). Nothing is persisted yet.

## What needs storing

| Entity | Source | Notes |
|---|---|---|
| Part | `parts.json` today; user-added parts later | Catalog rows mirror `PartSchema` in `src/domain/schema.ts` |
| Part model | GLB blob | Bundled parts are served from `/public/parts`; uploaded parts need blob storage |
| Crate design | User | Settings (`CrateSettingsSchema`) + chosen layout key + name |
| Design revision | User | Snapshot every save, so a shipped crate can be traced back exactly |
| Cut list | Derived | Recompute from settings, but snapshot on "release to shop" |

This data is relational: designs reference parts, revisions reference designs, and BOM lines
belong to revisions. Typical queries are things like "all designs for PART-002" or "every
released crate over 500 kg".

## Recommendation: SQLite WASM (`@sqlite.org/sqlite-wasm`) on OPFS, in a Web Worker

- **Relational and queryable.** It matches the data shape above. Joins and aggregates come free,
  and the same SQL schema can move to a server-side SQLite/Postgres when designs need sharing
  across a team.
- **Persistent and fast.** Use the `opfs-sahpool` VFS (Origin Private File System). Unlike the
  plain `opfs` VFS, it doesn't need `SharedArrayBuffer`, so there's **no COOP/COEP header
  requirement**. That matters in Next.js, because those headers break third-party embeds.
- **Off the main thread.** OPFS sync access handles only work in a worker. The worker owns the
  database, and the UI talks to it through a small message-based repository API. That keeps the
  three.js render loop smooth.
- **Official build.** Maintained by the SQLite project, not a third-party fork.

Trade-offs to accept:

- About 1 MB of WASM to download (lazy-load it after first paint).
- `opfs-sahpool` has no multi-tab concurrency: a second tab can't open the database. Mitigate
  with a `BroadcastChannel` "leader tab", or show "open in another tab".
- Safari/Firefox OPFS support is fine in current versions. Very old browsers would need an
  IndexedDB fallback.

### Alternatives considered

| Option | Why not (for now) |
|---|---|
| IndexedDB via Dexie | Simplest and smallest, but not relational: joins and aggregates are hand-written. A good fallback |
| PGlite (Postgres WASM) | Heavier (~3 MB). Only worth it if the server will be Postgres and we want identical SQL |
| `sql.js` | In-memory only. Persistence means exporting the whole DB on every save |
| localStorage | 5 MB cap, synchronous, strings only. Fine for "last settings", not for designs or GLBs |

## Proposed schema

See [`schema.sql`](./schema.sql). Key points:

- `dimensions` are stored as three columns, not JSON, so they can be filtered with SQL.
- `crate_design.settings_json` holds the zod-validated `CrateSettings`. It is validated on read
  with the same schema, so old rows that no longer match are caught.
- Revisions are append-only, which gives an audit trail for what was actually built.
- GLBs for user-uploaded parts go in OPFS as files. The DB stores the path, not a BLOB.

## Integration sketch

```
UI (React) ──postMessage──▶ db.worker.ts ──▶ sqlite3 + opfs-sahpool ──▶ OPFS
     ▲                              │
     └──────── typed results ◀──────┘
```

1. `src/db/db.worker.ts` calls `sqlite3InitModule()` then `installOpfsSAHPoolVfs()`, runs the
   migrations in `schema.sql`, and seeds `part` from `parts.json` if the table is empty.
2. `src/db/repository.ts` exposes async `listParts()`, `saveDesign()`, `listDesigns(partId)` and
   `getRevision(id)`. Every row is parsed with the zod schemas, so the UI never sees untyped data.
3. `CrateDesigner` loads from the repository instead of importing `catalog.ts` directly.
   `computeDesign()` stays pure and unchanged.
