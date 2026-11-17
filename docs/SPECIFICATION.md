# Crate Designer — Specification

> **Purpose of this document:** the single source of truth for what the app does and why. It is
> written so that a new contributor, or a new AI session with no prior context, can change the
> code safely. If code and spec disagree, fix one of them in the same PR.
>
> **Status:** v1 prototype with the #20 UI redesign. Last updated 2026-11-16.

---

## 1. Problem

Hadrian ships precision metal parts. Heavy or large parts go in custom wooden crates, designed
around the part's geometry. A crate may hold one part, a few identical parts, or a whole batch.
It must protect the contents in transit while staying cheap to build, easy to handle and
economical to ship. Today this takes someone who understands the part's geometry, material and
shipping needs.

**Brief constraints (hard):**

- The crate is wood plus basic fasteners only. No metal brackets.
- Don't model disposable packing (foam, bubble wrap).
- One part type per crate. Crates never mix parts.
- The input is the provided GLB models and `parts.json`.

## 2. Users and goals

| User | Goal | What they need from the app |
|---|---|---|
| Shipping / packaging lead | Choose a crate for a batch quickly | Outside dimensions, gross weight, warnings, comparable alternatives |
| Shop carpenter | Build it | Cut list (stock, cut size, quantity), screw count, a 3D view of how it goes together |
| Logistics / quoting | Estimate freight | Outside dimensions, volume, gross weight |

**Success for v1:** for each sample part at each suggested quantity, a user gets a sensible,
buildable crate design and cut list in under a minute, without needing CAD.

## 3. Glossary

| Term | Meaning |
|---|---|
| **Part** | A catalog entry (`PartSchema`) and its GLB |
| **Slot** | One part's position in the crate: its rotated bounding box placed on a grid |
| **Layout** | Orientation + grid counts `[nx, ny, nz]` + interior/exterior size + slots |
| **Interior** | Clear space inside the walls, floor and lid: `[L, W, H]` |
| **External** | Overall crate size, including cleats and skids |
| **Member** | One physical board, modelled as an axis-aligned box |
| **Dunnage** | Internal wood that restrains the parts: bearers, blocking, separators |
| **Skid** | Lumber runner under the floor, along X. Forklift tines go between skids |
| **Cleat** | 1×4 frame board screwed to the outside of a panel to stiffen it |

## 4. Conventions (do not break)

- **Units:** everything in `src/domain/` is **mm** and **kg**. Conversion to inches and pounds
  happens only at the edges: the UI and the CSV export.
- **Frame:** right-handed, **Z up**, the same as the GLBs. **X is the crate's long axis**: the
  packer only keeps layouts where interior `L ≥ W`.
- **Crate origin:** the interior min corner, which is the top face of the floor. Walls sit
  outside `[0, L] × [0, W]`, and the floor and skids are at negative Z.
- **GLBs** are in metres, Z up, and **not centred**. Measured bounds in mm:

  | Part | Size | Bounding-box centre |
  |---|---|---|
  | PART-001 | 360 × 220 × 258 | (0, 0, 129) |
  | PART-002 | 1530 × 172 × 172 | (25, 0, 0) |
  | PART-003 | 435 × 445 × 254 | (2.5, −7.5, 127) |

  These match `dimensions_mm` in `parts.json`.
- **Rendering:** three.js is Y up and in metres. Exactly **one** transform does the conversion
  for the scene graph: the root `<group rotation={[-π/2,0,0]} scale={MM_TO_M}>` in
  `CrateViewer.tsx`. Everything inside it uses domain coordinates. Domain front (−Y) faces world
  +Z; domain +X stays world +X. The unit constants and the one point converter live in
  `viewer/scene.ts` (`MM_TO_M`, `domainToWorld`); the few things that work in world space outside
  that group use them (`framing.ts` projecting label anchors, `Floor.tsx`, the part turntable's
  model-unit scale) and define no conversion of their own.
- **Exported GLB** (`src/lib/exportGlb.ts`) follows the input GLB convention, not three.js's:
  metres, **Z up**. The only conversion from the domain is × 0.001 (mm → m); there is no Y-up
  rotation in the file.
- **Loaded GLBs** are read as metres, Z up, like the samples. A file more than **20 units**
  across is read as millimetres instead (`MM_FILE_THRESHOLD` in `src/lib/loadPart.ts`), and the
  UI says so ("file read as millimetres", plus an info check).
- **Units in the UI (#15):** **imperial (in / lb) is the default**, for a domestic US shop floor;
  metric (mm / kg) is one toggle away and the choice is saved per browser (§9). The toggle
  changes only formatting (`src/lib/units.ts`, `src/lib/lumber.ts`): the domain, the design file
  and the shop standards stay in mm and kg; the mass field shows and accepts the selected unit
  and stores kg; the CSV follows the selected units (§7.6). **One rule for a mass shown to
  people (#62):** in the displayed unit, one decimal under 100 ("47.4 lb", "8 kg", a trailing
  .0 dropped) and whole numbers from 100 ("297 lb"). It lives once in `weight` / `partWeight`
  (`src/lib/units.ts`) and serves the header, Overview, Checks, print and PDF. The CSV and the
  design JSON keep their own precision (they are data), and change notes ("Gross 16 → 20 kg")
  stay whole units through `weightWhole`, because they say how far a value moved. In imperial,
  stock uses shop names:
  - **Lumber** by nominal S4S name (`NOMINAL_LUMBER`, 1 mm tolerance): 19 × 89 → `1x4`,
    38 × 89 → `2x4`, 89 × 89 → `4x4`, 89 × 140 → `4x6`, and the other common sections
    (1x2 … 1x12, 2x2 … 2x12, 4x8, 6x6, 6x8).
  - **Plywood** by the thickness it is sold as: 6 → `1/4″`, 9 → `3/8″`, 12 → `1/2″`,
    15 / 16 → `5/8″`, 18 / 19 → `3/4″`, 25 → `1″`; other thicknesses to the nearest 1/16″.
  - **Blocking and bearers** are cut to the gap, so they read as their size and the smallest
    stock that covers it: "1 15/16″ × 3 1/2″ from 4x4" (a gap that is itself stock, e.g. 38 mm,
    is just `2x4`).
  - **Anything else** (custom shop standards) is fractional inches, e.g. `1″ × 3 15/16″`.
  - Cuts and other shop sizes are inches to the nearest 1/16″, reduced (`35 7/16″`, `3/4″`,
    `12″`); overall sizes are inches to one decimal.

  The Cut list, Overview ("stiffened with 1x4 cleats", "4x4 skids under a 3/4″ floor"), Rules
  (plywood buttons and the Auto note), 3D tooltips and change notes all use these names; metric
  is unchanged. Nominal names keep a plain `x`: the spans that show them carry `.nominal`
  (`font-feature-settings: "calt" 0`), because Inter's contextual alternates would draw "4x4"
  as "4×4" (#62). Real dimensions ("932 × 652 × 497") use the true `×` character.
- **Rotations** are XYZ-order Euler angles in multiples of π/2. Packing uses the exact integer
  rotation matrix of those angles (`orientations.ts`, no three.js in the domain) and the viewer
  applies the same angles with three.js's `Euler`; a test compares the two for every orientation,
  so packed bounding boxes always match the rendered models.

## 5. Architecture

```
parts.json ──zod──▶ catalog.ts          GLB file ──▶ lib/loadPart.ts (validate, measure, match catalog)
                         │                              │
                         ▼                              ▼
   localStorage ◀──▶ state/store.ts (zustand): part, settings, standards, layoutKey, view, hover, pin, …
   (standards only)      │  recompute() on every input change
                         ▼
          state/engineClient.ts ──postMessage──▶ state/engine.worker.ts (Web Worker; §5.1)
                         │  (in-thread where there is no worker: SSR, tests)   │
                         ▼                                                     ▼
          engine/engine.ts: designShipment(request) → { plan, summary, engineVersion, inputHash }
                         │
                         ▼
          domain/shipment.ts: planShipment → domain/design.ts: computeDesign(part, settings, layoutKey?, standards?)
                         │        (standards = ShopStandards, domain/standards.ts, §6.4)
           ┌─────────────┼───────────────────┐
           ▼             ▼                   ▼
   resolveConstruction  enumerateLayouts     designCrate
   (board sizes from    (packing.ts:         (crate.ts: tagged members, BOM,
    payload mass)        ranked Layout[])     weights, screws, checks)
                         │
                         ▼
               DesignResult { layouts, design }
                         │
     ┌───────────────────┴─────────────────────┐
     ▼                                         ▼
 DOM overlays (shell/, island/)        3D scene (viewer/, react-three-fiber)
                                       reads `motion.ts` for per-frame values
```

- **Layers, enforced by lint.** Arrows point down only; `eslint.config.mjs` (`no-restricted-imports`,
  `no-restricted-globals`) fails `bun run lint` on any import that points up, type-only imports
  included, in code and in tests:

  ```
  src/components/, src/app/   render; may import everything below (components: not src/server)
  src/state/                  zustand stores and persistence, the engine's Web Worker and its
                              client; may import engine, lib and domain
  src/server/                 server-only data access (Postgres, blob storage, #46); may import engine, lib and
                              domain; only src/app/ imports it, and postgres / drizzle-orm /
                              @aws-sdk are banned outside it
  src/engine/                 the crate engine (§5.1): runs unchanged in a page, a Web Worker and
                              Node; may import lib and domain; no DOM globals, no Node built-ins
                              (its tests excepted), and not lib's browser-only modules
                              (`lib/download`, `lib/partProfile`). A server or CLI imports it too
  src/lib/                    edge code: formatting, file loading, exports; may import domain
  src/domain/                 pure TypeScript, mm/kg, Z-up; imports nothing above it, and no
                              three, react, zustand or DOM globals
  ```

  The one exception is `src/domain/orientations.parity.test.ts`, which may import three.js to
  check the domain's rotations against it. Shared code that two layers need goes in the lower
  one (`LoadedPart` and `modelUrl` are in `lib/part.ts`; `checks.ts` is in `lib`).
- **The domain layer is pure and synchronous.** It has no React, DOM or I/O, and it is fully
  unit-tested. `computeDesign` is cheap (6 orientations × at most a few hundred grids), so the
  store re-runs it on every input change, through the engine (§5.1), in a Web Worker.
- **One store, two kinds of state.**
  - `src/state/store.ts` (zustand) holds everything the UI renders from: the part, settings,
    the shop standards (§6.4), the design result, units, tab, view targets, hover / pin, tooltip, panel
    visibility, the free-area insets, and a `fit` request counter for the camera. Any change to
    the part, settings, standards or layout key goes through `recompute()`, which also drops a pin whose
    cut-list line no longer exists. The edit is stored at once; its plan lands when the engine's
    worker answers (a few ms), with `designedFrom`, the inputs and stamp it was made from (§5.1).
  - `src/state/motion.ts` holds values that change every frame (eased explode distance, lid and
    front-wall opacity, idle auto-play bookkeeping, last-input time). They live outside React on
    purpose, so animation never re-renders the UI.
- **The viewer is client-only.** Both canvases are loaded with `next/dynamic` and
  `{ ssr: false }` inside client components, because WebGL doesn't exist on the server.

### 5.1 The crate engine (`src/engine/`, #46)

One engine designs crates and builds their files, wherever it runs: the page, a Web Worker, and
Node (a server or CLI, later). It is a facade over `src/domain` plus the file builders in
`src/lib`, with no browser-only or Node-only imports at its top level; the lint rule for
`src/engine` (§5) keeps it that way, and the parity test proves it.

| Call (`src/engine/…`) | Does |
|---|---|
| `engine.ts` `designShipment(request)` | `planShipment` on a `DesignRequest`; returns `{ plan, summary, engineVersion, inputHash }`. Pure and synchronous; never throws for valid input |
| `engine.ts` `cutList(request)` | The Cut list tab's CSV and file name (crate type or, for a split batch, the shipment), stamped |
| `engine.ts` `inputHash(request)`, `summarize(plan)` | The stamp's hash; the headline numbers (outside size, gross, tare, screws, cost per crate type, totals, problem) |
| `sweep.ts` `runSweep(request)`, `rankConfigurations(request)` | The quantity sweep (§7.16) as an engine call: `SweepRequestSchema` (part, rules = settings without the quantity, standards, optional freight rates, `maxQuantity`, `total`), stamped with `engineVersion` and `sweepInputHash` (canonical `{ v: 1, kind: "sweep", part, rules, standards, freightRates, maxQuantity, total }`). `rankConfigurations` adds every shortlisted quantity designed in full, ranked best first: the headless answer of `POST /api/v1/designs`, the queue's sweep job and the CLI ([QUEUE.md](QUEUE.md)) |
| `files.ts` `buildBundleZip(input, reader)` | The Export package (§7.13) as a ZIP, stamped (every file in it carries the stamp). Loads the bundle, PDF (jsPDF), ZIP (fflate) and GLB code with `import()` on first use |
| `artifacts.ts` `buildArtifact(kind, request, reader)` | One artifact (`glb`, `pdf`, `csv`) for one configuration: `{ bytes, contentType, fileName, engineVersion, inputHash, sha256 }` (§7.17) |
| `artifacts.ts` `buildMultiBundleZip(configs, reader, options)` | Download all: a ZIP with a folder per configuration, `manifest.json` and `comparison.pdf` (§7.17) |
| `glb.ts` | Runtime adapters for GLBs: `urlModelReader` (browser, `GLTFLoader` on the model URL, cached), `bytesModelReader` / `parseGlb` (any runtime, `GLTFLoader.parse` on bytes), `crateGlb` (`GLTFExporter`, adding a minimal `FileReader` where the runtime has none, as Node) |
| `schemas.ts` | zod schemas for every call: `DesignRequestSchema` (part, settings, standards, layoutKey, ranking), `DesignResponseSchema`, `DesignSummarySchema`, `EngineStampSchema`, `CutListRequestSchema` / `CutListResponseSchema`, and the worker messages. The browser, server and CLI validate the same types; the page's own calls are typed and skip parsing |

**Stamps.** Every engine output carries `engineVersion` and `inputHash`:

- **`engineVersion`** = `ENGINE_VERSION` (`version.ts`): the package version plus
  `ENGINE_REVISION`, as `0.1.0+engine.3`. **Rule:** bump `ENGINE_REVISION` in the same change as
  anything that gives a different output for the same input (a rule, a constant, an algorithm, a
  default standard, or the text of a generated file). A refactor that leaves every output
  identical doesn't bump it. The parity baseline (below) shows which kind a change is: if it had
  to be re-written, bump.
- **`inputHash`** = SHA-256 (hex) of the canonical JSON of
  `{ v: 1, part, settings, standards, layoutKey, ranking }` (`engine.ts`, `canonical.ts`,
  `sha256.ts`):
  - `part` is the design fields only (`id`, `name`, `mass_kg`, `dimensions_mm`, `material`,
    `profile`): a loaded part's model URL, file name, units and load facts are not inputs, so a
    blob URL never changes the hash. The quantity is `settings.quantity`. `layoutKey` is the
    user's pick (null for the recommended one).
  - Canonical JSON: keys sorted at every depth, `undefined` properties left out, numbers in
    JavaScript's shortest round-trip form with `-0` as `0`, typed arrays as arrays; NaN, ±Infinity,
    functions and class instances throw.
  - SHA-256 is a synchronous pure-TypeScript implementation, checked against the FIPS vectors and
    Web Crypto, so the hash is the same in the page, the worker and Node.
  - `v` is bumped if the hashed shape changes, so old and new hashes never collide. The engine
    version is not in the hash: equal inputs hash the same across versions, and a server compares
    both before trusting a result.
  - File outputs (`cutList`, `buildBundleZip`, `buildArtifact`) carry their design's stamp; their
    own options (units, scope, crate type, time) are not hashed. The stamp is also written
    **inside** every file the engine builds (§7.17): the GLB's scene `extras`, the PDF's keywords
    and page footer, a `# Engine …, input …` line in the CSV, `engine` in `design.json`, and two
    lines of `README.txt`. `cutList`'s own CSV text (the Cut list tab's download, the parity
    baseline) has no stamp line.

**In the browser.** `src/state/engineClient.ts` runs the engine in a Web Worker
(`src/state/engine.worker.ts`, bundled by Next.js from `new Worker(new URL(…, import.meta.url))`),
started on the first edit. It is latest-wins: one request in flight; a newer one replaces one
still waiting, so a burst of edits (a held arrow key on a slider) costs at most two designs.
The quantity sweep (`engine.sweep`, behind `useBestQuantity`) runs in the same worker on a lane of
its own, latest-wins too, so a sweep never delays a design.
Where there is no worker (server rendering, vitest in Node or jsdom) or it fails (an error, a
request that can't be cloned), it designs in the page instead, before returning, so the store
and its tests stay synchronous there. The first design (the preloaded part) is made in the page.

The store applies an edit at once, so its control never lags, and lands the design with the
inputs it was made from (`designedFrom`, with the stamp) when the worker answers; the crate type
to show and the `restoring` hold wait for the design. The e2e probe reports `quantity`, `partId`
and `massAssumed` from `designedFrom`, so a spec that waits on them waits for the design too.

**On the server.** Engine work never runs on the thread that serves requests and SSE streams: a
`worker_threads` pool (`src/server/workers/`) runs it from one bundled file
(`bun run engine:build`), in Next.js, the queue worker (`bun run worker`) and tests alike; a test
holds the main thread's event-loop lag under 50 ms during full sweeps. Background sweeps go
through a Postgres job queue (`queue_job`, `FOR UPDATE SKIP LOCKED`, `NOTIFY crate_jobs` plus
polling, leases, retries, dead letter). See [QUEUE.md](QUEUE.md).

**Downloads.** The Export pill builds its ZIP through `buildBundleZip` with `urlModelReader`; the
PDF, ZIP and GLB code is loaded only then, and nothing goes to a server. The same call in Node
takes `bytesModelReader(glbBytes)`.

**On the server.** A configuration saved from the browser (`POST /api/v1/jobs/:id/configs`,
`docs/API.md`) is not trusted: the server runs `designShipment` on the same request and stores it
only if its `engineVersion`, `inputHash` and summary (as canonical JSON) are the browser's
(`src/server/jobs/verify.ts`). Another engine version is `409` and the tab is asked to reload;
any other difference is `422`. Parity is what makes an honest save always match.

**Parity.** `parity.node.test.ts` (Node) and `parity.jsdom.test.ts` (jsdom) run the three sample
parts at each suggested quantity and compare against one committed baseline,
`src/engine/__snapshots__/parity.json`: the summary (outside size, gross, tare, screws, cost),
the `inputHash`, a SHA-256 of the whole plan, and the cut-list CSVs. Both pass only if both
runtimes give identical results, equal to the app's as the baseline was written. A change that
moves any of it fails both; re-write the baseline with `bunx vitest run src/engine/parity -u` and
bump `ENGINE_REVISION`.

### File map

| File | Responsibility |
|---|---|
| `src/domain/schema.ts` | zod schemas and types: `Part`, `CrateSettings`, `DesignPart`, `Vec3`; `normalizeSettings` (the store boundary) |
| `src/domain/glb.ts` | GLB checks shared by the browser and the upload API (#46): `glbProblem` (magic, version, chunks, Draco / Meshopt), `looksLikeTextGltf`, the user-facing `GLB_MESSAGES`, `MAX_GLB_BYTES` (50 MB, API only), `glbSizeUnits` (bounding box from accessor min / max, no three.js), `unitsToMm` (the 20-unit mm rule), `idFromFile` / `nameFromFile` |
| `src/domain/catalog.ts` | Parses `parts.json` at module load (fails loudly). `getPart`. Data only: the `/parts/…` model URL is built in `lib/part.ts` |
| `src/domain/orientations.ts` | The 6 orientations; `rotationMatrix()` (integer, as three.js's XYZ Euler) and `rotatedSize()` |
| `src/domain/standards.ts` | `ShopStandardsSchema`, `DEFAULT_STANDARDS`, `minInteriorMm()`, merging, parsing and the JSON file format (§6.4) |
| `src/domain/packing.ts` | `enumerateLayouts()` |
| `src/domain/cradles.ts` | Cradles for slender parts (#6, §7.5a): `isSlender`, `usesCradles`, `cradleStations`, `notchFor`, `addCradleDunnage`, and the notch outline (`cradleProfile`, `cradleSolidAt`) |
| `src/lib/cradleGeometry.ts` | A cradle's notched solid (its profile extruded) for the 3D view and the GLB (`components/viewer/cradleGeometry.ts` re-exports it) |
| `src/lib/sceneMaterials.ts` | The wood colours and part material the viewer and the GLB share (`components/viewer/scene.ts` re-exports them), so `lib` imports nothing from `components` |
| `src/domain/crate.ts` | `designCrate`: wires the steps below into a `CrateDesign`, and re-exports the crate's public types and entry points (`Member`, `BomLine`, `Check`, `CrateDesign`, `ASSEMBLIES`, `SHAPED_BLOCK`, `screwSchedule`, ...) so importers keep one path |
| `src/domain/members.ts` | The boards: `Member`, `MemberKind`, `MemberVariant` (shaped blocks and stacking cradles, found by variant not label), `Assembly`, `Face`, `ASSEMBLIES` and `ASSEMBLY_NAMES` (how each assembly is named for people), the cradle `Notch` types, `memberBounds()`, `sortDesc()` |
| `src/domain/check.ts` | `Check` and its id groups, each owned by the module that produces it (`crateChecks.ts`, `handling.ts`, `shipment.ts`) |
| `src/domain/construction.ts` | `resolveConstruction` (§7.3: panel, floor, cleat and the smallest skid from the payload), `structureMaterials`, `structureAllowance`, `constructionFor` |
| `src/domain/shell.ts` | `addShell`: floor, joists, skids, the four walls and the lid as boards (§7.4) |
| `src/domain/dunnage.ts` | `addDunnage` (§7.5): bearers, separators, blocking posts and shaped blocks; `SHAPED_BLOCK`; the `insideTag` and `placementKey` helpers `cradles.ts` shares |
| `src/domain/bom.ts` | `buildBom` (the cut list) and `screwSchedule` / `screwCount` (§7.6) |
| `src/domain/materials.ts` | `memberKg`, `materialTotals`: tare by assembly, wood volumes, plywood area and lumber length from the boards |
| `src/domain/crateDesign.ts` | The `CrateDesign` type |
| `src/domain/crateChecks.ts` | `evaluateChecks` and the base-rating, lid, blocking, door, stack, LTL, utilization and cardboard checks (§7.7) |
| `src/domain/lumber.ts` | `NOMINAL_LUMBER` and `nominalLumber()`: the plain-`x` names ("4x6") check text uses; `src/lib/lumber.ts` formats this one table |
| `src/domain/units.ts` | `MM_PER_IN`, `MM_PER_FT`, `LB_PER_KG`, `IN3_PER_FT3` and the mm to m conversions the domain uses |
| `src/domain/profile.ts` | Shaped blocking (#16, §7.5b): the `PartProfile` type, `usableProfile`, rotating a profile into the crate (`sideGrid`), post placement and shaped blocks (`planShapedBlocking`, `slotPlans`), and the restraint metric (`restraint`) |
| `src/domain/message.ts` | `Message`: sentences with lengths and masses as data (`msg`, `mm`, `shopMm`, `kg`), so checks stay unit-free (#62, §7.7) |
| `src/domain/handling.ts` | Centre of gravity, fork openings, tine placement and the handling checks (`analyseHandling`, `forkOpenings`, `placeTines`, `handlingChecks`; §7.14, #8). Read-only over the members |
| `src/domain/cost.ts` | Labour estimate, crate cost, LTL freight terms and the NMFC density scale (`estimateLabour`, `crateCost`, `freightTerms`, `freightClassFor`, `NMFC_DENSITY_SCALE`; §7.12, #17) |
| `src/domain/structure.ts` | Structural sizing (§7.15, #7): `planStructure()` sizes the skids, floor joists and lid from the load and spans, and rates the base (`sizeBase`, `sizeLid`, `estimateDeadLoad`, the member checks) |
| `src/domain/sweep.ts` | Choosing the best quantity (#46, §7.16): `sweepQuantities()` (the curve over 1–200 per crate, hard checks first, cost per part, the recommendation and shortlist), `planTotal()` and `evenSplit()` (total-quantity mode), `FreightRatesSchema` / `freightCostUsd()` (caller-supplied rates) |
| `src/domain/shipment.ts` | `planShipment()`: one crate, or N identical crates plus a remainder when one crate would break a per-crate limit (§7.10); `shipmentBom()`, `describeShipment()` |
| `src/domain/design.ts` | `computeDesign()`, `rankLayouts()` and its input checks (`DesignProblem`, `MAX_PART_MM`), `explainLayout()`, `settingsFromStandards()`, `DEFAULT_SETTINGS` |
| `src/domain/envelope.ts` | The versioned-envelope reader and writer (`readEnvelope`, `writeEnvelope`, `hasKind`): JSON → kind → version → migrations → "newer version" error, shared by the design file, the library, the shop standards file and the last-design entry |
| `src/domain/profileCodec.ts` | `encodeProfile` / `decodeProfile`: a part profile packed losslessly for the design file (§6.5) |
| `src/domain/designFile.ts` | The saved design file (§6.5): `DesignFileSchema`, `serializeDesign` (app name and version passed in), `parseDesignFile` (version check and migrations), `fileProfile`, `restoreDesign` (its notes are typed `Message`s) |
| `src/domain/designLibrary.ts` | The design library (#14, §9): `partKey`, entries (`createEntry`, rename, remove / restore, `mergeEntries`, `entriesForPart`), the versioned envelope (`libraryToJson`, `parseLibrary`) |
| `src/domain/shareLink.ts` | Share links (#14, §9): base64url, `shareHash` / `shareUrl`, `readShareHash` (validated by `parseDesignFile`) |
| `src/domain/diff.ts` | `diffDesigns()`: which design values an edit changed, old → new (§8.5a) |
| `src/domain/partDetails.ts` | Validation of user-entered name, material and mass (`cleanPartDetails`), material suggestions, `partFinish()` (aluminum or steel look) |
| `src/domain/testFixtures.ts` | Shared test builders: `custom` standards, `settings`, `designOf` |
| `src/domain/domain.test.ts` | Invariant, regression-baseline and feature tests (§10) |
| `src/domain/hardening.test.ts` | Edge-case and bad-input tests (§10) |
| `src/domain/standards.test.ts` | Standards schema, defaults, and designs under custom standards (§10) |
| `src/lib/units.ts` | Display-only unit formatting (mm ↔ in, kg ↔ lb, m³ ↔ ft³, 1/16″ fractions, the one mass rule) |
| `src/lib/message.ts` | `renderMessage`: check messages (typed quantities) rendered for the selected units (#62, §7.7) |
| `src/lib/part.ts` | `LoadedPart` (a part with its model URL and load facts), `catalogPart()` and `modelUrl()` |
| `src/lib/checks.ts` | Domain checks plus file-dependent checks (model size, stand-in mass), sorted; `cautionCount` |
| `src/lib/lumber.ts` | US shop names (#15): the nominal-lumber names from `domain/lumber.ts` (`sectionText`), plywood by sold thickness (`plywoodText`), `lumberText` (blocking "from 4x4"), `sectionText` |
| `src/lib/format.ts` | Cut-list stock / cut text, layout descriptions, `documentDate` (the date in a given time zone), `boardTooltipDetail` (the board tooltip's second line); scorecard text (`usd`, `usdDelta`, `hoursText`, `elapsedText`, `densityText`, `densityDelta`) |
| `src/lib/loadPart.ts` | Loading a part in the browser: GLB validation (from `domain/glb.ts`), measuring with three.js, catalog matching, `parts.json` merging, opening a design file; `designFilePart` |
| `src/lib/partProfile.ts` | Part analysis (#16, §7.5b): `buildPartProfile()` rasterises the mesh into a depth grid per bounding-box face; `scheduleProfile()` runs it once per model when the browser is idle, cached by model URL |
| `src/lib/currentDesign.ts` | `currentDesignText()` / `currentDesignFile()`: the design on screen as a design file (§6.5) with its part outline and ranking, for the download, the print link, the library and share links |
| `src/lib/appInfo.ts` | `APP`: the name and version written into design files and the README |
| `src/lib/csv.ts` | `bomToCsv()` and `shipmentToCsv()` in the selected units (CSV keeps data precision) |
| `src/lib/download.ts` | `downloadText()` and `downloadBytes()`: the one browser download edge |
| `src/lib/memberBounds.ts` | `memberBounds()`: the box around a set of members, for the GLB, the label and the drawings |
| `src/lib/partFields.ts` | The header's mass field: kg / lb text ↔ kg (`formatMass`, `parseMass`), ↑ / ↓ steps, fallback field widths |
| `src/lib/changes.ts` | A design diff as screen text: `changeSummary` ("Crate grew: 2176 × 936 × 831 mm, 878 kg"), `changeNote` (the full "Gross 16 → 20 kg, outside … → … mm") or "No change to the crate" (#62) |
| `src/lib/printable.ts` | The export document's model (#26, §7.11): `buildPrintable` (plan → `PrintableDesign`), `printableFromDesignFile`, freight terms, the cut list by stock, fasteners, assembly steps (`stepOfMember`) and the label |
| `src/lib/drawings.ts` | `crateDrawings`: top, front and end views and two sections projected from the members, as data in mm |
| `src/lib/printLink.ts` | The print route's URL hash: the design file as base64url (the share link's encoding), plus the units (`printHash`, `readPrintHash`) |
| `src/app/print/page.tsx`, `print.css` | The print route and its Letter print styles. The route sits outside the `(designer)` group, so it loads `globals.css` and `print.css` only |
| `src/app/globals.css` | Global CSS, loaded on every route: the design tokens (custom properties, including the `--z-*` stacking scale), the `@layer` order, the base element rules, and the one list of breakpoints |
| `src/app/ui.css` | The shared UI primitives in `@layer ui`: `glass`, `card`, `seg`, `pillbtn`, `btn`, `linkbtn`, `iconbtn`, `switch`, `lede`, `subhead`, `line`, `actions`, `mono`, `muted`, `nw`, `nominal`, `tight`, `sr-only`, `eyebrow-label`, `hint-mouse` / `hint-touch`. Used as plain string class names; everything else is a module (§13) |
| `src/app/(designer)/layout.tsx`, `designer.css`, `page.tsx` | The route group (no URL segment) for `/`: it loads `ui.css` and `designer.css` (the dark, full-window, never-scrolling page) |
| `src/components/print/*.tsx` | `PrintView` (reads the hash, opens the print dialog), `PrintDocument` (the pages), `DrawingSvg` |
| `src/lib/exportBundle.ts` | The Export pill's package (#51, §7.13): `buildBundle` (file list, names, CSVs, design file, README; GLB and PDF makers injected), `zipBundle` (fflate). The engine's `buildBundleZip` wires in the makers |
| `src/lib/exportPdf.ts` | `printableToPdf`: the `PrintableDesign` as a vector PDF with jsPDF (#51); loaded only with `import()` |
| `src/components/shell/ExportPill.tsx` | The green Export pill under the part header, its idle / busy / done / error states, and an amber dot with a tooltip and description ("2 cautions, see Checks") when the design has cautions; exporting is never blocked |
| `src/state/exportRun.ts` | `useExportRun`: the one export run and its state, behind the Export pill (the engine's `buildBundleZip`, loaded on first use); a success note clears after 8 s, an error after 15 s |
| `src/engine/engine.ts` | The crate engine (§5.1): `designShipment`, `cutList`, `inputHash`, `stamp`, `summarize` |
| `src/engine/schemas.ts` | zod request and response schemas for the engine's calls, and the worker messages (§5.1) |
| `src/engine/version.ts` | `ENGINE_REVISION` and `ENGINE_VERSION` (§5.1: when to bump) |
| `src/engine/canonical.ts`, `sha256.ts` | Canonical JSON and a synchronous SHA-256, for `inputHash` |
| `src/engine/glb.ts` | GLB adapters: `urlModelReader` (browser), `bytesModelReader` / `parseGlb` (any runtime), `crateGlb`, `ensureFileReader`; loaded with `import()` |
| `src/engine/files.ts` | `buildBundleZip`: the Export package in any runtime, PDF / ZIP / GLB code loaded on first use |
| `src/engine/artifacts.ts` | `buildArtifact` (one stamped GLB, PDF or CSV), `buildMultiBundleZip` (Download all), `sweepFor`, the manifest types (§7.17) |
| `src/engine/artifactCases.ts` | The artifact parity cases: each sample part at its recommended quantity, and the CSV baseline text (`__snapshots__/artifacts-csv.txt`) |
| `src/lib/comparison.ts`, `comparisonPdf.ts` | The multi-configuration comparison summary (`buildComparison`, pure) and its one-sheet PDF (`comparisonToPdf`, jsPDF through `exportPdf.ts`'s `Writer`) |
| `src/state/downloadAll.ts` | `useDownloadAll`: the Download all run beside the Export pill (`run(configs?)`; default `defaultConfigs`: the design on screen plus the job's saved configurations (`savedConfigRequests`), else the sweep's shortlist (`shortlistConfigs`)) |
| `src/server/artifacts/` | Server-built files (#46 slice 6): `configurationArtifact`, `jobBundle`, `createBundleHandler` (`service.ts`), build-once storage (`store.ts` `storeOnce`: single flight, advisory lock, object then row then `artifact.ready`), the part model from blob storage (`model.ts`) |
| `src/lib/api/artifacts.ts` | Artifact and bundle response schemas, `artifactHref` / `bundleHref` / `parseConfigsParam` (client-safe) |
| `src/components/island/SharedJobFiles.tsx` | The Shared job's server file links per configuration and its whole-job downloads |
| `src/engine/parityCases.ts` | The browser / Node parity cases and the baseline text (`__snapshots__/parity.json`) |
| `src/state/engineClient.ts` | `engine`: the page's engine client, a Web Worker with an in-thread fallback, latest-wins (`createEngineClient`) |
| `src/state/engine.worker.ts` | The engine's Web Worker entry (designs and sweeps, `engine/run.ts`) |
| `src/engine/sweep.ts` | `runSweep`, `rankConfigurations`, `SweepRequestSchema`, `sweepInputHash`, `DEFAULT_SWEEP_RULES` (§5.1, §7.16) |
| `src/engine/run.ts` | `runWorkerRequest`: one worker message's call, shared by the worker and its test stand-in |
| `src/lib/api/designs.ts` | `POST /api/v1/designs` fields and response schemas, client-safe ([QUEUE.md](QUEUE.md)) |
| `src/server/workers/` | The engine's `worker_threads` pool (`pool.ts`, `engine.ts` `getEnginePool`) and thread entry (`engineThread.ts`, bundled by `bun run engine:build`) |
| `src/server/queue/`, `src/server/db/queue.ts` | The Postgres job queue: enqueue / claim / lease / retry / dead letter, the runner, LISTEN, job kinds (`enqueueSweep`, `enqueueBundle`) |
| `src/server/auth.ts`, `src/server/db/apiKeys.ts` | `authenticate(request)` → `OrgContext` (API key, or the UI's same-origin marker); hashed API keys |
| `src/cli/` | `bun run crate`: argument parsing, the API call, the in-process `--offline` run |
| `src/state/fakeEngineWorker.ts` | A stand-in worker for tests (answers on `flush()`) |
| `src/lib/exportGlb.ts` | The assembled crate as GLB (`buildCrateScene`, `exportCrateGlb`): fresh scene from the design, named boards grouped by assembly, optional parts; cached part loading (`loadPartScene`). Runtime-neutral apart from that loader; the engine's `glb.ts` wraps it for Node |
| `src/state/bestQuantity.ts` | `useBestQuantity`: the quantity sweep (§7.16) for the part and rules on screen, derived from the store (nothing added to it), asked of the engine worker 250 ms after the last change |
| `src/components/island/BestQuantity.tsx` | The best-quantity hint and its **Use** action on the Rules tab (§7.16) |
| `src/state/store.ts` | The zustand store and its actions; `currentMode()`, `lastChange`; designs through the engine client, `designedFrom` (§5.1) |
| `src/state/persist.ts` | The `localStorage` primitives: `KeyValueStore`, `browserStorage()`, `readJson` (missing, throwing or invalid data gives a fallback) and `writeJson` (never throws, returns whether it stored) (§9) |
| `src/state/standardsStorage.ts` | `loadStandards` / `saveStandards` over `persist.ts`; re-exports `KeyValueStore` and `browserStorage` (§9) |
| `src/state/unitsStorage.ts` | `DEFAULT_UNITS` (imperial) and `loadUnits` / `saveUnits` over `persist.ts` (§9) |
| `src/state/libraryStorage.ts` | `loadLibrary` / `saveLibrary` over `persist.ts` (§9) |
| `src/state/libraryStore.ts` | `useLibrary`: the design library's own small zustand store (save, rename, delete / undo, import / export, a shared custom design waiting for its GLB) |
| `src/state/motion.ts` | Per-frame animation values and idle timing constants |
| `src/components/shell/DesignerShell.tsx` | Full-bleed layout; the narrow-screen drawer, hamburger and summary chip; idle input tracking, Escape, drag-and-drop (file drags only), free-area insets, tooltip |
| `src/components/shell/useFocusTrap.ts` | `useFocusTrap` for the drawer (focus in, Tab wraps, focus back to the hamburger); `FOCUSABLE` includes `summary`; `trapTarget` is the pure wrap rule |
| `src/components/shell/usePopover.ts` | `usePopover`: open state, Escape (focus back to the trigger), press outside and focus-out close it |
| `src/components/shell/LoadToast.tsx` | The load message as a glass toast under the part header: a note (`role="status"`, goes after 9 s) or an error (`role="alert"`, stays until dismissed); a dismiss button |
| `src/components/shell/PartHeader.tsx` | Top left: app name, the part as a sentence with the crate gross; inline name, material and mass fields for unknown parts (§8.5) |
| `src/components/shell/ChangeFeedback.tsx` | `ChangeNote` (what an edit moved, `role="status"`) and `Flash` (gold highlight on a changed value) |
| `src/components/shell/ViewBar.tsx` | Bottom right: pin bar, mode icon, units, View popover (`usePopover`), Hide panels |
| `src/components/shell/useLoadFiles.ts` | The thin hook over `loadPickedFiles`; re-exports `openDesignFile` for `SavedDesigns` |
| `src/state/partLoader.ts` | `applyOutcome`, `openDesignFile()` (library, share links) and `loadPickedFiles()` (picked / dropped files, and a waiting shared design, forgotten only once it opened); each load takes a ticket and only the latest is applied |
| `src/state/loadSequence.ts` | `beginLoad()`: the load ticket; `current()` is false once a later load started |
| `src/state/startup.ts` | `createStartup` / `startSavedState`: the run-once startup (saved units, standards, library, then share link, last crate or default) that survives StrictMode's second effect run |
| `src/components/shell/SavedStateLoader.tsx` | Runs `startSavedState()` once, then keeps saving (`watchLastDesign`) and follows `hashchange` share links |
| `src/state/lastDesignLoader.ts` | `restoreLastDesign()` (with a load ticket) and `watchLastDesign()`: reopens the last-opened crate, and saves it (debounced) plus a custom GLB's bytes (§9) |
| `src/state/lastDesignStorage.ts` | The last-opened crate in `localStorage`: envelope (read by `domain/envelope.ts`), validation, precedence, debounced saver (§9). Imports no GLB code; `lastDesignOf` (the store state as an entry) is in `lastDesignLoader.ts` |
| `src/state/glbCache.ts` | The last custom GLB's bytes in IndexedDB, one record, 50 MB cap (§9) |
| `src/state/shareLink.ts` | `openShareLink()`: reads `#design=…`, opens it or explains why not, tidies the URL (§9) |
| `src/components/island/*.tsx` | The island and its five tabs. `Island.tsx` owns the WAI-ARIA tabs (§8.3a) and computes `allChecks` once for the tab badges, the Overview verdict and the Checks tab |
| `src/components/island/SavedDesigns.tsx` | "Saved designs" at the bottom of the Overview (#14): save, list, reuse, rename, delete with undo, library file, share link (`SavedDesigns.module.css`) |
| `src/components/island/Scorecard.tsx` | The Overview's design scorecard (#17): crate cost, build time, freight class and density, dimensional weight, the time to design in the heading row (`Scorecard.module.css`) |
| `src/components/island/CrateTypePicker.tsx` | `CrateTypePicker` (which crate type of a split batch is on screen; Overview, Layouts, Cut list, Checks) and `CutScopeToggle` (the Cut list's This crate / Whole shipment); one module for both |
| `src/components/island/rule.module.css` | One rule row (title, control, note), shared by the Rules tab and Shop standards (`.compact`), with the touch-sized sliders and switches |
| `src/components/island/ShopStandards.tsx` | The Shop standards editor at the bottom of the Rules tab; its inputs render only while the section is open (`ShopStandards.module.css`) |
| `src/components/island/standardsFields.ts` | The typed table of editable standards (`StandardPath` is every numeric path in `ShopStandards`, so a typo fails to compile), `readStandard`, `standardPatch`; `standardsFields.test.ts` checks every path resolves and no hint carries ticket numbers |
| `src/lib/fileNames.ts` | File names of the cut list CSV and the design file |
| `src/lib/events.ts` | Live event types (#46 §3), shared by server and browser: `CRATE_EVENT_TYPES`, payload schemas (`parseEventPayload`, 4 KB cap), the NOTIFY payload and the SSE message (`JobEventMessageSchema`); `CRATE_EVENTS_CHANNEL` |
| `src/lib/jobEvents.ts` | `subscribeJobEvents(jobId, onEvent)`: EventSource on `/api/v1/events` that resumes from the last id and delivers each event once |
| `src/lib/api/jobs.ts` | Zod shapes of `/api/v1/jobs*` (#46 slice 5), shared by the Route Handlers and the browser: create, snapshot, save configuration, patch, the 409 bodies; reference in `docs/API.md` |
| `src/state/jobApi.ts` | The browser's calls to `/api/v1/parts` and `/api/v1/jobs*`; never throws, and any network error or 5xx is `offline` |
| `src/state/jobSync.ts` | `useJobSync` and `startJobSync`: the part on screen as a shared job on the server (register or upload the part, open or reuse its job, snapshot, events); `saveConfiguration` (the one save path, for the offline queue to wrap), `selectConfiguration`, `configurationBody` |
| `src/components/island/SharedJob.tsx` | "Shared job" under Saved designs on the Overview: save to the job, the job's configurations (use, recommend), connection status, the reload prompt (`SharedJob.module.css`) |
| `src/server/jobs/` | Jobs and configurations logic behind the Route Handlers: `jobs.ts` (create, snapshot, save, patch), `verify.ts` (recompute and compare a saved configuration), `idempotency.ts` (`Idempotency-Key`), `hooks.ts` (`onJobCreated`, for the queue's sweep) |
| `src/server/auth.ts` | `callerOrg(request)`: the default org until there are accounts; the one place auth plugs in |
| `src/components/viewer/CrateViewer.tsx` | Main canvas (kept mounted whatever the design does); the Z-up → Y-up root transform; lights; loading overlay; the context-lost cover; releases a replaced part's GLB from drei's cache |
| `src/components/viewer/CrateViewer.module.css` | The context-lost cover |
| `src/components/viewer/PartViewSlot.tsx` | The part view's box in the island (its module sets the size and the drawer sizes), shared by the `PartView` canvas and the loading placeholder |
| `src/components/viewer/StageMessage.tsx` | A line centred over the 3D stage ("Loading model…", why there is no crate); shared by the shell and the viewer |
| `src/components/shell/Tooltip.tsx` | The hover tooltip over the 3D view |
| `src/components/viewer/Director.tsx` | Applies the framing: view offset, presets, eased moves, bounded panning, fades, idle auto-play |
| `src/components/viewer/framing.ts` | Pure camera maths: presets, mode zoom, `fitGoal`, what must stay on screen (`keepInView`), keeping a panned crate in the free area (`keepCrateInFreeArea`) |
| `src/components/viewer/CrateModel.tsx` | One box per `Member` (a notched solid for cradles, #6); explode, fades, highlight, ghosting, picking |
| `src/components/viewer/PartInstances.tsx` | GLB loaded once, cloned per slot, re-centred, measured, ghosted |
| `src/components/viewer/DimensionLines.tsx` | Draws the size lines; positions the DOM labels each frame; shows the part's lines once the inside is open; drives the photon pulse |
| `src/components/viewer/sizeLines.ts` | Pure size-line geometry (`buildLines`, label anchors, the dimension hidden per preset, label text) |
| `src/components/viewer/forkArrows.ts` | Pure fork-arrow size and placement, and the occlusion test that hides an arrow behind the crate |
| `src/components/viewer/probeStats.ts` | What the scene reports to the e2e hook (`probeStats`); writes are gated by `NEXT_PUBLIC_E2E` |
| `src/components/viewer/dimensionPulse.ts` | Pure photon paths (`pulsePaths`) and the 10 s pulse clock (#65) |
| `src/components/viewer/PhotonLayer.ts` | One `Points` of photons per line group, updated per frame (#65) |
| `src/components/viewer/SizeLabels.tsx` | The DOM elements for the size labels, derived from the design, units and view (nothing is stored) |
| `src/components/viewer/Floor.tsx` | Grid and warm light pool |
| `src/components/viewer/PartView.tsx` | The island's turntable canvas |
| `src/components/viewer/scene.ts` | Units and shared constants (`MM_TO_M`, `FOV_DEG`, click slop, far plane), colours, explode offsets, opacity rules, highlight rules, part material |
| `src/components/viewer/HandlingMarks.tsx` | The 3D centre-of-gravity stencils on the outside faces (only when a CoG check is a caution, #87), and the fork-entry arrows at both ends, which fade out when the crate hides them (#8, §8.4) |
| `src/components/viewer/E2EProbe.tsx` | Read-only `window.__crate` test hook (typed with the store's types); only in `NEXT_PUBLIC_E2E=1` builds (§10) |
| `playwright.config.ts`, `e2e/*.spec.ts`, `e2e/helpers/` | End-to-end UI tests and their shared helpers (`bun run e2e`, §10); screenshots go to the git-ignored `e2e/screenshots/` |
| `scripts/docs-shots.mjs` | `bun run e2e:docs-shots`: copies chosen e2e screenshots into `docs/screenshots/` on request |
| `.prettierrc`, `.prettierignore`, `knip.json` | Formatting (`bun run format`, checked in CI) and the unused-code report (`bun run knip`) |

## 6. Data model

### 6.1 Catalog (`parts.json` → `PartsCatalogSchema`)

```ts
Part {
  id: string                       // "PART-001"
  name: string
  model: string                    // "*.glb", served from /public/parts/
  material: string                 // "4140 steel", "6061-T6 aluminum"
  density_kg_m3: number
  mass_kg: number                  // supplied value; never derived from the mesh
  dimensions_mm: [x, y, z]         // bbox in the model frame
  suggested_quantities: number[]   // shown as quick-pick buttons
}
```

The catalog-level field `model_units` must be the literal `"meters"`.

The catalog holds no shape data beyond the bounding box. A part's **profile** (its outline from
each side, #16) is measured from the GLB in the browser after the crate first renders (§7.5b),
and is never written to `parts.json`, design files or share links.

### 6.2 Settings (`CrateSettingsSchema`)

| Field | Type / range | Default | Effect |
|---|---|---|---|
| `quantity` | int 1–200 | 4 | Number of parts |
| `keepUpright` | bool | true | Allow only the 2 orientations that keep model Z vertical |
| `maxLayers` | int 1–6 (UI offers 1–4) | 2 (`defaults.maxLayers`) | Upper limit on `nz` |
| `partGapMm` | 0–300 | 50 (`defaults.partGapMm`) | Clear gap between adjacent parts, filled by blocking |
| `wallClearanceMm` | 0–300 | 50 (`defaults.wallClearanceMm`) | Gap to the walls, floor and lid |
| `panelThickness` | `"auto"` \| mm (6 to 50) | auto | Plywood for walls, lid and separators. The Rules tab offers the thicknesses in `stock.panelPlywoodMm` (12, 15, 19 by default); a design saved with another one still opens |

The part is not a setting. It is passed to `computeDesign` separately, and loading a new part
resets `quantity` to that part's first suggested quantity.

The defaults for gap, clearance and layers come from the shop standards
(`settingsFromStandards`, §6.4): **Reset rules** goes back to them (keeping the quantity), and
changing one of those three standards also applies it to the current rules. `DEFAULT_SETTINGS`
is `settingsFromStandards(DEFAULT_STANDARDS)`. The setting ranges above are input validation,
not house rules, so they are not standards.

**Validation at the store boundary.** Every settings change goes through `normalizeSettings`
(`schema.ts`) in the store's `setSettings`, so the domain only ever sees values the schema
accepts:

- **Clamped:** a finite number outside its range is clamped into it, and `quantity` and
  `maxLayers` are rounded to integers. Typing 500 gives 200; a gap of −20 gives 0.
- **Rejected:** NaN, ±Infinity, a value of the wrong type, or a panel size that isn't on the list
  is ignored field by field, and the previous value stays. Unknown keys are dropped.
- **Told (#36):** `settingsAdjustments(patch, current)` lists the numeric fields that were
  clamped, rounded or rejected, without changing `normalizeSettings`. When a typed quantity
  isn't taken as given, the Rules tab shows a short polite note under the field
  (`role="status"`, `clampNote` in `src/lib/clampNote.ts`): "Quantity is 1–200; set to 200",
  "Quantity is a whole number; set to 4", or "Not a number; kept 4". It fades over 5 s and is
  then cleared; with reduced motion it appears and goes without animation. Quantity is the only
  typed rule; the sliders and buttons can't leave their ranges.

`setPartDetails` (§6.2a) likewise ignores a mass that isn't a finite number above zero. As a
second line of defence, `computeDesign` re-checks its input and returns a `problem` rather than
throwing (§7.9).

### 6.2a The part being designed

`computeDesign` takes a **`DesignPart`**: `id`, `name`, `mass_kg`, `dimensions_mm`, and an
optional `material`. Catalog parts satisfy it. So does a GLB loaded at runtime, which has
measured dimensions and possibly no material.

The UI wraps it in a **`LoadedPart`** (`src/lib/part.ts`), which adds:

- `modelUrl` (a `/parts/…` path or a `blob:` URL)
- `mmPerUnit` (1000 for metre files, 1 for files read as millimetres)
- `suggested_quantities`
- `catalogDims`, the catalog size used for the model check (absent for unknown files)
- `massAssumed`, true when a 10 kg stand-in is in use (`STAND_IN_MASS_KG`)
- `readAsMm`

Mass is never inferred from the mesh.

**Profile (#16).** `DesignPart` has an optional `profile` (`PartProfile`, §7.5b), so a
`LoadedPart` can carry one. It is absent when a part is loaded; `PartInstances` measures it once
the model is on screen and the store's `setPartProfile(modelUrl, profile)` adds it and
re-designs, keeping the layout pick and the camera. A profile for a model that is no longer
loaded, or a failed analysis (`null`), changes nothing. Name, material and mass edits keep it; a
new part or design starts without one.

**Entered details.** For an unknown part (no `catalogDims`) the user can edit the **name**,
**material** and **mass** through the store action `setPartDetails({ name?, material?, mass_kg? })`.
Input is checked by `cleanPartDetails` (`src/domain/partDetails.ts`):

- `name`: whitespace and control characters collapsed, then 1–80 characters (`PART_NAME_MAX`).
- `material`: tidied the same way, at most 60 characters (`PART_MATERIAL_MAX`). Blank clears it,
  and the UI shows "material not given". Free text; `MATERIAL_SUGGESTIONS` are only offered.
- `mass_kg`: a finite number above 0. Any accepted mass, even 10, clears `massAssumed`.

Invalid input changes nothing and returns a message. Catalog parts are read-only. A mass change
recomputes the design and resets the layout pick, like any other input. A name or material
change refreshes the result but keeps the layout pick and the camera. Every accepted change
records what it moved in `lastChange` (§8.5a), even when nothing did.

**Material → look.** `partFinish(material)` returns `"aluminum"` when the text contains "alum"
(case-insensitive, so "aluminium" counts) and `"steel"` for everything else, including no
material. `partMaterial()` in `scene.ts` draws aluminum lighter and smoother. The material text
also shows in the part header, the Overview "Parts" step, the 3D part tooltip and the CSV header;
the name shows in the island title, the Overview heading, the tooltip and the CSV header.
### 6.3 Derived types

- **`Layout`:** `key`, `orientation`, `cellSize` (rotated bbox), `counts [nx,ny,nz]`,
  `interior`, `clearance` (per axis, §7.2), `external`, `externalVolumeM3`, `utilization`, `stable`, and `slots[]`. Each slot
  has `index [i,j,k]` and `min` (slot min corner).
- **`Member`:** `{ kind, material, assembly, face, label, bomKey, min, size }`.
  - `kind` is one of `skid`, `floor`, `side`, `end`, `lid`, `cleat`, `lid-cleat`, `separator`,
    `bearer`, `blocking`.
  - `assembly` is one of `base`, `sides`, `ends`, `lid`, `inside` (`ASSEMBLIES`, in build order).
  - `face` is one of `base`, `side-` (the front wall), `side+`, `end-`, `end+`, `lid`, `inside`.
    The viewer moves boards by face when exploded and fades the `lid` and `side-` faces.
  - `label` is the shop name of the piece (§7.4). `bomKey` links the board to its cut-list line.
- **`BomLine`:** `{ key, assembly, label, kind, material, stock, cut, stockMm, cutMm, qty }`.
  `stockMm` and `cutMm` are numbers so the UI can format them in either unit system.
- **`Check`:** `{ id, level: "ok" | "caution" | "info", title, detail }` (§7.7).
- **`CrateDesign`:**
  - `layout` and `construction` (`panelMm`, `floorMm`, `skid {wide, tall}`, `cleat {thick, wide}`, `skidCount`)
  - `members[]` and `bom[]`
  - `payloadKg`, `tareKg`, `tareKgByAssembly`, `grossKg`
  - `plywoodM2`, `lumberM`, `screws`, `materialCostUsd` (wood only)
  - `labour` (`LabourEstimate`: counts, minutes per activity, `totalMin`, `hours`, `costUsd`),
    `cost` (`CrateCost`: `woodUsd`, `fastenersUsd`, `materialUsd`, `labourUsd`, `totalUsd`) and
    `freight` (`FreightTerms`: `grossLb`, `outsideIn`, `volumeFt3`, `dimWeightLb`,
    `dimDivisorIn3PerLb`, `densityLbFt3`, `freightClass`) (#17, §7.12)
  - `handling` (`Handling`: the centre of gravity `cogMm` in the crate-interior frame, its
    height and tip angle, the fork openings and the device fits) (#8, §7.14). The freight class,
    density, dimensional weight and CoG each live in one place (`freight.*`, `handling.cogMm`)
  - `checks[]`
  - `shapedBlocking?`: `{ shaped, boundingBox, blocks }`, set only when blocking was shaped to a
    part profile (§7.5b): the restraint of this crate's blocking, of bounding-box blocking for the
    same layout, and the number of shaped blocks
- **`LayoutExplanation`** (from `explainLayout`, §7.8).
- **`DesignResult`:** `{ layouts, design, problem }`. `problem` (`DesignProblem`:
  `{ id, title, detail }`) is set exactly when `design` is null (§7.9).

### 6.4 Shop standards (`ShopStandardsSchema`, #19)

The house rules every crate is designed to: what lumber and plywood the shop has, the defaults,
the thresholds for choosing stock, the limits the checks test, and material rates. Before #19
they were constants in `crate.ts` and `packing.ts`, known in full only to the PM. Now they are
one zod-validated object in `src/domain/standards.ts`, and `computeDesign(part, settings,
layoutKey?, standards = DEFAULT_STANDARDS)` passes it down to `resolveConstruction`,
`enumerateLayouts`, `designCrate`, the dunnage, the screw estimate and the checks. Nothing in
the domain reads a rule from a module constant. **With `DEFAULT_STANDARDS`, every design is
exactly what it was before** (the 18-case baseline in §10 was unchanged by #19; #6's cradles
later re-captured the PART-002 rows on purpose; #7's structural sizing left it unchanged, §7.15).

Units are fixed per field (mm, kg, kg/m³, USD/m³, USD per 100 screws, minutes, USD/h, in³/lb),
whatever the display units.

| Group / field | Default | Used by |
|---|---|---|
| **`stock`** — what the shop keeps on hand | | |
| `cleatMm {thick, wide}` | 19 × 89 (1×4) | Wall and lid frames; wall allowance; minimum interior = 2 × `wide` (§7.2) |
| `skidMm.standard {wide, tall}` | 89 × 89 (4×4) | Skids: structural sizing tries it first (§7.15) |
| `skidMm.heavy {wide, tall}` | 89 × 140 (4×6) | Skids when the standard section fails, and always above `construction.heavySkidOverKg` |
| `floorPlywoodMm` | 19 | The floor |
| `panelPlywoodMm {light, medium, heavy}` | 12 / 15 / 19 | Auto wall, lid and separator plywood (§7.3) |
| `blockWidthMm` | 89 | Blocking posts and bearers (§7.5) |
| `joistMm {thick, wide}` | 38 × 89 (2×4) | Floor joists on edge across the skids, and lid joists when crates are stacked (§7.15, #7) |
| **`defaults`** — what a new crate starts with | | |
| `partGapMm`, `wallClearanceMm`, `maxLayers` | 50, 50, 2 | Settings defaults (§6.2); same ranges as the settings |
| `volumeTolerance` | 0.03 | Layout volumes within 3% tie, and the lower crate wins (§7.2, §7.8) |
| **`construction`** — when to use which stock | | |
| `panelLightMaxKg`, `panelMediumMaxKg` | 150, 500 | Auto panel thresholds by payload (§7.3) |
| `heavySkidOverKg` | 700 | Heavy skids at least, above this payload (sizing may pick them sooner) |
| `skidSpacingMm` | 800 | Fewest skids = `max(2, ceil(extW / spacing) + 1)`; sizing may add more (§7.15) |
| `maxCleatSpacingMm` | 600 | Wall uprights and lid cross cleats (§7.4) |
| `minBlockingGapMm` | 19 | Smallest gap that gets a blocking post; the `blocking` check |
| **`limits`** — what the checks test (§7.7) | | |
| `trailerMm {interiorLength, interiorWidth, interiorHeight, doorWidth, doorHeight}` | 16000, 2565, 2794, 2489, 2743 | `door` |
| `ltlExcessiveLengthMm` | 2438 (8 ft) | `oversize` |
| `cardboard {partKg, payloadKg, boxDimSumMm}` | 15, 25, 1905 | `cardboard` |
| `stackKg` | 100 | `stack` |
| `stableHeightRatio` | 1.5 | `Layout.stable`, ranking and the `stable` check |
| `lowUtilization` | 0.25 | `utilization` |
| `perCrate.maxGrossKg` | 1000 (a handling limit) | Shipment planning (§7.10): a heavier crate is split. The computed base rating (§7.15) also applies |
| `perCrate.maxParts` | 0 (no limit) | Shipment planning: most parts in one crate |
| **`rates`** — material properties, prices and fastening (§7.6) | | |
| `densityKgM3 {plywood, lumber}` | 600, 480 | Tare weight |
| `costUsdPerM3 {plywood, lumber}` | 1100, 650 | `materialCostUsd` (placeholders) |
| `screwSpacingMm {cleat, skid, panelJoint}` | 150, 300, 200 | Screw estimate |
| `screwCostUsdPer100` | 8 | Fasteners in the crate cost (§7.12, #17; placeholder) |
| **`labour`** — shop times and rate (§7.12, #17; placeholders) | | |
| `rateUsdPerHour` | 35 | Labour cost = build hours × rate |
| `lumberCutMin`, `plywoodCutMin` | 0.75, 3 | Minutes per lumber piece and per plywood piece |
| `setupMin` | 2 | Minutes per distinct cut size (a saw set-up) |
| `screwMin` | 0.15 | Minutes per screw (9 s) |
| `assemblyStepMin` | 6 | Minutes per assembly step: base, four walls, lid, dunnage per layer |
| `handlingMin` | 15 | Minutes per crate: moving, marking, staging |
| **`structure`** — structural sizing (§7.15, #7) | | |
| `lumberBendingMPa` | 7.8 | Allowable bending stress Fb of the lumber: SPF No. 2, 875 psi × size factor 1.3 |
| `lumberShearMPa` | 0.93 | Allowable shear Fv: SPF No. 2, 135 psi |
| `lumberBearingMPa` | 2.93 | Allowable bearing across the grain Fc⊥: SPF No. 2, 425 psi |
| `plywoodBendingMPa` | 6.0 | Allowable bending of the floor and lid plywood, on its gross section (about 870 psi) |
| `loadFactor` | 1.5 | Design load = this × the weight carried (handling shocks, uneven support) |
| `supportLengthMm` | 100 | Length of skid on each end support, for bearing |
| `minForkOpeningMm` | 200 | Skids are never added past this clear gap between them |
| `joistOverKg` | 450 | Payload above this always gets floor joists |
| `maxJoistSpacingMm` | 400 | Floor joists at most this far apart, centre to centre |
| `lidStackKg` | 0 (not stacked) | Weight on the lid it is sized for; 0 keeps the nominal lid |
| **`freight`** — LTL terms (§7.12, #17) | | |
| `dimDivisorIn3PerLb` | 139 | Dimensional weight = outside in³ / divisor |
| **`handling`** — centre of gravity and lifting (§7.14, #8) | | |
| `forklift {minClearMm, tineWidthMm, spreadMm {min, max}}` | 75, 100, 250–1100 | `forklift`: Class II tines about 4″ wide and 1.5–2″ thick, so 3″ clear leaves room for a tine that isn't level; tines slide from about 10″ to 43″ apart, outside to outside |
| `palletJack {minClearMm, tineWidthMm, spreadMm {min, max}}` | 85, 180, 520–690 | `pallet-jack`: forks about 7″ wide and 2.9–3.2″ high lowered; a narrow (20.5″) to a standard (27″) jack |
| `cogOffsetRatio` | 0.1 | `cog-offset`: past 10% of the length or width from the middle, mark the CoG (the ISO 7000-0627 centre-of-gravity mark of ISO 780, MIL-STD-129's centre-of-balance marking) |
| `minTipAngleDeg` | 30 | `cog-tip`: under 30° the crate tips at under 0.58 g sideways, close to the 0.5 g lateral that US cargo securement (49 CFR 393.102) designs for |
| **`cradle`** — cradles for slender parts (§7.5a, #6) | | |
| `slenderRatio` | 3 | A part is slender when longest ÷ middle side ≥ this (1.5–50) |
| `maxSpacingMm` | 600 | Cradles along the part at most this far apart, centre to centre |
| `endOffsetMm` | 150 | End cradles' centre lines this far in from each part end (cut to ¼ of a short part) |
| `notchDepth` | 0.25 | Notch depth as a fraction of the part's height (0.05–0.45) |
| `roundTolerance` | 0.1 | Cross-section sides within 10% count as round: a circular seat, not a flat pocket |
| `thickMm` | 38 | Cradle board thickness along the part (2× lumber) |

**Validation.** Every number is finite and inside a sane range (for example cleat spacing
100–5000 mm, so a typo can't make thousands of boards). Across fields: panel plywood must go
`light ≤ medium ≤ heavy`, `panelLightMaxKg ≤ panelMediumMaxKg`, a device's spread must go
`min ≤ max` and be at least two tines wide, the trailer door can't be
bigger than the trailer inside, the end-cradle offset can't be more than the cradle spacing, and blocking can't be wider than the minimum interior (two
cleats), or a bearer would poke through a wall. The structure group (#7) has ranges too: a load
factor of 1–5, stresses above zero, joist spacing 100–2000 mm and a stacking load of 0 or more.
`parseStandards` returns the first problem as
`"path: message"`.

**What is deliberately not a standard:** geometry that keeps the model consistent rather than a
shop choice — the 0.5 mm smallest board, bearers at 20% and 80% of the part width, at least two
skids and two uprights per wall, the six orientations — plus input validation: the settings
ranges (§6.2), `MAX_PART_MM` (20 m, a units-mistake guard, §7.9) and the manual panel choices
12 / 15 / 19 mm in the Rules tab (`CrateSettingsSchema`). Auto picks from `panelPlywoodMm`;
choosing by hand still offers the three standard sheets.

**In the store.** `standards` starts as `DEFAULT_STANDARDS` (frozen). `setStandards(patch)`
deep-merges a partial patch onto the current standards (`mergeStandards`, which ignores
`__proto__`-style keys), validates the result, and either re-designs and saves it or returns the
error and changes nothing. Changed `defaults.partGapMm`, `wallClearanceMm` or `maxLayers` are
carried into the current settings. `resetStandards()` goes back to the defaults. Both reset the
layout pick, like any other input.

**JSON file.** `standardsToJson` writes
`{ "kind": "crate-designer/shop-standards", "version": 1, "standards": {…} }`.
`standardsFromJson` accepts that envelope or a bare standards object, fills missing fields from
the defaults (so a file can hold only the house's differences), and rejects invalid JSON, a
different `version`, or an invalid value.

**In the UI.** Rules → **Shop standards · house rules for every crate**, a `<details>` section
collapsed by default. Ten groups (Stock on hand, Defaults, Construction, Cradles, Limits,
Structure, Rates, Labour, Freight, Handling) of number fields with units, laid out like the other `.rule` rows. A field applies as soon as its
text is a valid standard; invalid text is outlined in gold with the reason and reverts on blur.
A changed field is tinted and says its default. A **Customised** tag shows when anything
differs from `DEFAULT_STANDARDS`; **Reset to defaults**, **Download standards** and **Load
standards** sit at the bottom. Ratios are shown as % (`volumeTolerance`, `lowUtilization`).

### 6.5 Design file (`DesignFileSchema`, #28)

A saved design is a JSON file, downloaded from the Cut list tab with **Download design
(.json)** as `crate-design-{part id}-x{quantity}.json` (and packed as `design.json` in the
Export pill's .zip, §7.13), and opened again through **Load a part**
or a drop (§8.5). `src/domain/designFile.ts` writes it (`serializeDesign`) and reads it
(`parseDesignFile`); both are pure and unit-tested. The design library and share links (#14,
§9) store and carry this same format.

```jsonc
{
  "kind": "crate-design",          // tells it apart from a parts.json catalog
  "schemaVersion": 2,              // DESIGN_SCHEMA_VERSION
  "app": { "name": "crate-designer", "version": "0.1.0" },   // package.json version
  "savedAt": "2026-11-16T12:00:00.000Z",
  "engine": { "version": "0.1.0+engine.2", "inputHash": "3f2a…" },  // optional; only in files the engine built (§5.1)
  "part": {
    "source": "catalog",           // "catalog": bundled in /public/parts; "custom": the user's GLB
    "id": "PART-001",
    "name": "Machined steel bracket",
    "material": "4140 steel",      // optional
    "mass_kg": 21.5,
    "massAssumed": true,           // optional; only written when the 10 kg stand-in is in use
    "dimensions_mm": [360, 220, 258],
    "model": "PART-001-machined-steel-bracket.glb",
    "outline": { "version": 1, "sizeMm": [360, 220, 258], "cellMm": 3.5,   // optional: the measured
                 "grids": [[63, 74], …], "data": "eJz…" }                 // part profile, packed
  },
  "settings": { "quantity": 4, "keepUpright": true, "maxLayers": 2,
                "partGapMm": 50, "wallClearanceMm": 50, "panelThickness": "auto" },
  "ranking": "volume",             // "volume" | "cost" | "density" (§7.2)
  "layoutKey": "u:870x590x358:221", // Layout.key of the layout on screen
  "summary": {                     // for people, and to check a reopened design
    "quantity": 4,
    "layout": "2 × 2 × 1, As modeled",
    "outsideMm": [932, 652, 497],  // rounded
    "grossKg": 134.9               // one decimal
    // "shipment": [{ "count": 6, "quantity": 30 }, { "count": 1, "quantity": 20 }]
    //   only for a batch split across crates (#25, §7.10); the summary above then
    //   describes the crate type that was on screen
    // "shapeUnknown": true  only from the 1 → 2 migration (see Versions)
  }
}
```

- **Source.** A part is `catalog` when the bundled catalog has the same id and model, even if
  its GLB was loaded from disk. Anything else, including entries from a dropped `parts.json`, is
  `custom`.
- **Validation.** `parseDesignFile` never throws. It checks, in order: the text is JSON; `kind`
  is `"crate-design"`; `schemaVersion` is a whole number from 1 up to the app's version; then the
  zod schema. `settings` must already pass `CrateSettingsSchema` (out-of-range values are
  rejected, not clamped). Unknown extra keys are dropped. Each failure is one plain sentence,
  naming the field when there is one (`part.mass_kg: …`).
- **The same file, the same crate.** Shaped blocking (§7.5b) depends on the part's measured
  outline, and the layout list and its "why" (§7.8) on the ranking. The app measures the
  outline from the model a moment after it first renders, so a file that left out either would
  rebuild a different crate (the print and the reload once showed 12 fewer blocks, a lighter
  gross and fewer screws). So the file carries both: `ranking`, and `part.outline`, the profile
  packed by `src/domain/profileCodec.ts`. The packing is lossless (depths are whole tenths of a
  millimetre, stored as differences, zigzag-varint, deflated by fflate, base64), so the planned
  crate is identical, not approximately so. It costs 0.4 to 2.7 KB per file for the catalog
  parts (raw JSON is 18 to 138 KB). `outline` is optional: it is absent when the model had not
  been measured yet at save time (the file then describes the bounding-box crate it was saved
  with) and a damaged outline is refused like any other bad field. An outline measured on
  another size is ignored (`usableProfile`).
- **Versions.** A file from a newer format is refused ("saved by a newer version of the app;
  format N, this app reads up to M"). An older one runs through the migrations one version at
  a time before validation (`readEnvelope`, `src/domain/envelope.ts`). Format 2 added `ranking`
  and `part.outline`. The 1 → 2 migration sets `ranking: "volume"` (every older file was
  ranked that way) and marks the summary `shapeUnknown`, because an older file's summary may
  include shaped blocks that the file has no outline for.
- **Restoring** (`loadDesign` in `loadPart.ts`, then `restoreDesign`):
  - A `catalog` part is rebuilt from the bundled catalog entry and its `/public/parts` model.
  - A `custom` part (or a catalog id this app doesn't have) needs its GLB in the same pick or
    drop. The file named `model` is used, or the only GLB if there is one. The saved name,
    material, mass and stand-in flag are restored and stay editable. The saved size is kept
    when the measured model is within 0.5 mm of it per axis; otherwise the crate is sized to
    the file and the message says so. Without a GLB nothing changes, and the message names the
    file to add.
  - Settings are restored as saved. The saved layout key is restored if that layout still
    exists; otherwise the recommended layout is used and the message says so.
  - The part gets the file's outline (when it fits the model), and the plan is made with the
    file's ranking, so the rebuilt crate is the saved one: the app after a reload, a share link,
    the library, `/print` and the zip agree.
  - The rebuilt crate is compared with `summary`. If the outside size or gross differs (for
    example, a catalog mass or a shop rule changed), the message gives the new and the saved
    values in the selected units ("Gross is now 304 lb (was 298 lb)."). For a format 1 file
    (`shapeUnknown`) with no outline to use, a difference is not reported at all: the viewer
    measures the model and the saved crate comes back, so a note about file history would only
    be noise.
  - **A split batch (#25):** the design is rebuilt with this browser's shop standards and
    re-planned (§7.10). The crate type on screen when it was saved (the one whose part count is
    `summary.quantity`) is shown again. If the plan differs from `summary.shipment` (for
    example, a different max gross per crate), the message says "The batch now ships as …
    (was …)". A single-crate file has no `shipment` and is byte-identical to before.
  - The load message starts "Design loaded: {quantity} × {name}." and adds any of those notes.
  - **Wording of load messages:** short, plain, in the selected units, and never about file
    history. An error says what happened and what to do ("That isn't a .glb file. Choose a .glb
    or a design .json."). A message with no part opened is an error (`loadMessageKind`), shown
    with `role="alert"` until dismissed; a note goes by itself (§8.2).
## 7. Algorithms

### 7.1 Orientations

There are six axis-aligned rotations, one per permutation of the bbox axes. Mirror images are
excluded.

| id and label | Euler (XYZ) | upright |
|---|---|---|
| `as-modeled` "As modeled" | (0, 0, 0) | ✓ |
| `turned` "Turned 90°" | (0, 0, π/2) | ✓ |
| `on-side-x` "On its side" | (π/2, 0, 0) | |
| `on-side-x-turned` "On its side, turned 90°" | (π/2, 0, π/2) | |
| `on-end-y` "On end" | (0, π/2, 0) | |
| `on-end-y-turned` "On end, turned 90°" | (0, π/2, π/2) | |

`rotatedSize(size, o)` rotates a centred box with three.js and returns its new AABB size,
rounded to 0.001 mm.

### 7.2 Packing (`enumerateLayouts`)

Inputs: `partSize`, `n`, `keepUpright`, `maxLayers`, gap `g`, clearance `c`, separator thickness
`s` (= panel thickness), `structureAllowance`, and `minInteriorMm` (`minInteriorMm(standards)` =
2 × `stock.cleatMm.wide` = 178 by default), plus the standards for the stability ratio and
volume tolerance.

For each allowed orientation, with rotated cell `[a, b, h]`:

```
for nz in 1..min(maxLayers, n):
  perLayer = ceil(n / nz);            skip if perLayer·(nz−1) ≥ n     (empty top layer)
  for nx in 1..perLayer:
    ny = ceil(perLayer / nx);         skip if (nx−1)·ny ≥ perLayer    (empty column)
    content  = [ nx·a + (nx−1)·g,  ny·b + (ny−1)·g,  nz·h + (nz−1)·(g + s) ]
    cl[axis] = max(c, (minInteriorMm − content[axis]) / 2)             (per-axis clearance)
    interior = content + 2·cl
    skip if interior.L < interior.W                                    (X is the long axis)
    dedupe on (rounded interior, nx, ny, nz)
    external = interior + structureAllowance
```

- **Minimum interior:** a very small part's crate is padded to at least 178 mm on each axis, with
  the extra split evenly as clearance (`layout.clearance`), so the part stays centred and the top
  and bottom rails of each wall and the lid's edge cleats fit without overlapping. For every
  sample part at the default clearance `cl = c` on all axes, so their results are unchanged.
- **Slots** are filled layer by layer, then row by row, then column by column, until there are
  `n`. Slot min = `[cl₀ + i(a+g), cl₁ + j(b+g), cl₂ + k(h+g+s)]`.
- **There is always a layout** for valid input: `nz = 1, nx = n, ny = 1` passes both skips, and
  the orientation set always contains a cell and its 90° turn (`as-modeled` / `turned`), one of
  which has `a ≥ b` and so `L ≥ W`. The `no-layout` problem (§7.9) is only a safety net.
- **Speed:** at quantity 200 (the maximum), `computeDesign` takes 1–2 ms for each sample part
  with `keepUpright` on or off and `maxLayers` 1–4, and about 5 ms for a 20 m part (measured on
  an M-series Mac). The hardening tests fail when the median of 5 runs is over 50 ms.
- **Key format:** `"{u|s}:{L}x{W}x{H}:{nx}{ny}{nz}"`. `u`/`s` means upright or not, and the
  dimensions are rounded mm. Keys are only used to select a layout in the UI; they aren't stored.

**Ranking (`compareLayouts`):**

1. `stable` first. Stable means `external.H ≤ 1.5 × min(external.L, external.W)`
   (`limits.stableHeightRatio`).
2. Smaller `externalVolumeM3`. Volumes within **3%** of each other (`defaults.volumeTolerance`)
   count as equal.
3. Lower external height.

Element `[0]` is the recommended layout.

**Ranking option (#17, `Ranking`: `volume` | `cost` | `density`).** `volume` is the ranking
above and the default, so the regression baseline doesn't move. `cost` and `density` re-rank
the same layouts with `rankByObjective`, which designs each crate (5–15 ms at the sample
parts' larger quantities) and sorts by, in order:

1. **Hard constraints**, never traded for cost or freight: within the per-crate limits (shipment
   planning only, §7.10), `stable`, every part blocked in (the `blocking` check passes), and for
   `density` no LTL excessive-length charge (the `oversize` check), so a long single row can't
   win on class alone.
2. **The objective:** `cost` = lowest `cost.totalUsd` (to the cent); `density` = lowest
   estimated `freightClass`, then lightest gross (to the lb), because LTL charges by class and
   weight.
3. **Ties** keep the default order.

`computeDesign(part, settings, layoutKey?, standards?, ranking = "volume")` and
`planShipment(…, ranking)` take it; the split itself is still chosen by volume, and each crate
type's layouts are re-ranked.

`utilization = n·a·b·h / (L·W·H)` uses the interior and part bounding boxes.

### 7.3 Construction sizing (`resolveConstruction`)

Values are the defaults; the standards field is in brackets (§6.4).

| Item | Rule |
|---|---|
| Panel plywood (walls, lid, separators) | Auto: payload ≤ 150 kg [`construction.panelLightMaxKg`] → **12 mm** [`stock.panelPlywoodMm.light`]; ≤ 500 kg [`panelMediumMaxKg`] → **15 mm** [`medium`]; otherwise **19 mm** [`heavy`]. Overridable by hand with 12 / 15 / 19 |
| Floor plywood | Always **19 mm** [`stock.floorPlywoodMm`] |
| Skids | Sized per layout from the load and spans (§7.15, #7): the smallest of **89 × 89** (4×4) [`stock.skidMm.standard`] and **89 × 140** (4×6) [`stock.skidMm.heavy`] that passes. Payload over 700 kg [`construction.heavySkidOverKg`] starts at 4×6 |
| Skid count | At least `max(2, ceil(externalWidth / 800) + 1)` [`construction.skidSpacingMm`], more if no section passes (§7.15), evenly spread across the width |
| Floor joists | 2×4 on edge [`stock.joistMm`] across the skids, when the payload is over 450 kg or the floor fails over the skids (§7.15) |
| Cleats | **19 × 89** (1×4) [`stock.cleatMm`], returned as `construction.cleat` |

**`structureAllowance`** is what the structure adds to the interior. Here `t` is the panel
thickness and `ct` is the cleat thickness (19, `construction.cleat.thick`). Since #7 it is worked
out per layout, because the base is sized for that layout's spans: the packer calls
`planStructure` for each grid (§7.15) and `designCrate` makes the same call, so the boards'
bounds still equal `layout.external`.

```
[ 2(t + ct),  2(t + ct),  baseMm + t + lid.tall ]
baseMm = skid.tall + (joists ? joist.tall : 0) + floor     (lid.tall = ct for the nominal lid)
```

### 7.4 Crate geometry (`designCrate`)

All coordinates are relative to the interior origin, with `cw = 89` (cleat width,
`stock.cleatMm.wide`).

| Member | Min corner → size |
|---|---|
| Floor | x, y from `−t−ct`, spanning the full external footprint; z ∈ [−floor, 0] |
| Floor joists (#7) | When the base has them: on edge across the full external width (Y), spread evenly along X from end to end; z ∈ [−floor−joist.tall, −floor] |
| Skids | Under the floor (or the joists), full external length along X; z ∈ [−baseMm, −baseMm + skid.tall] |
| Side walls (±Y) | Panel x ∈ [−t, L+t], thickness t, outside y ∈ [0, W], height H |
| Side cleats | Outside each side panel. Top and bottom horizontals, plus verticals at ≤ 600 mm spacing (`construction.maxCleatSpacingMm`) |
| End walls (±X) | Panel spans y ∈ [0, W], fitted between the side panels |
| End cleats | Outside each end panel. They span the full external width, so they wrap the corners over the side cleats |
| Lid | Panel over x ∈ [−t, L+t], y ∈ [−t, W+t] at z = H. Two long edge cleats on top, plus cross-cleats at ≤ 600 mm. When crates may be stacked (#7) the frame is sized for the load: more cleats, or 2×4 joists on edge (§7.15) |

Each member is tagged where it is created:

| Assembly | Face | Labels |
|---|---|---|
| `base` | `base` | Floor, Floor joist (kind `joist`, #7), Skid |
| `sides` | `side-` (front) / `side+` (back) | Side panel, Side rail (top and bottom cleats), Side upright (vertical cleats) |
| `ends` | `end-` / `end+` | End panel, End rail, End upright |
| `lid` | `lid` | Lid panel, Lid edge cleat, Lid cross cleat (Lid edge joist, Lid joist when stacking needs joists) |
| `inside` | `inside` | Bearer, Layer separator, Blocking post, Shaped block (§7.5b); for slender parts (§7.5a) Cradle, Stacking cradle, End stop |

**Invariant:** the bounding box of all members equals `layout.external`, which is tested.

### 7.5 Dunnage (inside the crate)

- **Bearers:** under each bottom-layer part, two 89-wide (`stock.blockWidthMm`) strips running along X, at 20% and 80%
  of the part's width. Their height equals the floor clearance (`layout.clearance[2]`), and there
  are none when it is 0. A strip that would poke into a side wall (a narrow part with little
  side clearance) is moved inward to touch the wall instead.
- Dunnage uses the per-axis `layout.clearance` for the gaps at the walls, so a padded tiny crate
  is blocked in like any other. With zero gap and clearance there is no dunnage at all, no board
  has zero size (members under 0.5 mm on any axis are never created), and the `blocking` check
  reports "Parts are not restrained".
- **Separators:** one plywood sheet across the whole interior between each pair of layers, of
  thickness `t`.
- **Blocking posts:** one per side (±X, ±Y) of every part, centred on that side (or, with a part
  profile, placed as §7.5b describes):
  - **Width:** 89 (`stock.blockWidthMm`), or the part's side length if that is shorter.
  - **Thickness:** equal to the gap on that side (the clearance at a wall, or `partGap` next to
    another part).
  - **Height:** from the layer's floor (the crate floor or a separator) up to the next separator,
    or for the top layer, to the part's top. This means the posts also carry the layer above.
  - Posts are only made when the gap is ≥ 19 mm (`construction.minBlockingGapMm`).
  - Posts shared by two neighbouring parts are de-duplicated by rounded position and size.
- **Slender parts** get cradles instead of all of the above (§7.5a).

### 7.5a Cradles for slender parts (`src/domain/cradles.ts`, #6)

A round shaft on two flat bearers with one post per side can roll, bow and slide. Real shaft
crates sit the part in **notched wooden saddles** across its length, with stops at the ends.
Values are the defaults; the standards field is in brackets (§6.4, group `cradle`).

**Which parts.** `isSlender(dims, standards)`: the part's **longest side ÷ its middle side ≥ 3**
[`slenderRatio`]. It reads the part's own dimensions, not the layout. PART-002 (1530 × 172 ×
172) is 8.9 and qualifies; PART-001 (1.4) and PART-003 (1.02) do not, and their crates are
unchanged. A flat plate (600 × 500 × 10) is 1.2: thin, but not long. **Ownership:** cradles own
slender parts and the general / geometry-aware blocking (#16) owns the rest, using the same
predicate. `designCrate` takes the cradle path (`usesCradles`) when the part is slender **and**
its long axis lies horizontal in the layout (along X or, for a wide batch, Y). A slender part
stood on end (a layout the user picks) has no length to cradle and keeps the general blocking.

**Stations.** `cradleStations(start, length)`: the end cradles' centre lines **150 mm in from
each end** [`endOffsetMm`] (cut to a quarter of the length on a short part, so the two don't
meet), and the rest evenly between them **at most 600 mm apart** [`maxSpacingMm`]: `count =
max(2, ceil((length − 2·150) / 600) + 1)`. The 1530 mm shaft gets 4, 410 mm apart. Every part in
a row along the long axis shares the stations, and every layer uses the same ones, so stacked
cradles line up.

**The notch.** `notchFor(width, height)`: depth = **25% of the part's height** [`notchDepth`]. A
cross-section whose sides are within 10% [`roundTolerance`] is taken as **round** and gets a
circular seat of the part's radius; its opening is the chord at that depth, `2√(d(2r − d))`
(shaft: r = 86, d = 43, opening 149 mm). Any other section gets a **flat** pocket as wide as the
part. The bounding box can't tell round from square, so a square bar also gets a round seat.

**Members** (all `assembly: "inside"`, `face: "inside"`, lumber, so the Blocking switch fades
them like other dunnage):

| Label | Kind | Geometry |
|---|---|---|
| Cradle | `cradle` | At each station, on the floor: **38 mm** thick along the part [`thickMm`], spanning the interior **wall to wall** across it, from z = 0 to the part's bottom + notch depth (the part rests on the notch bottom; the bottom layer's parts sit at the floor clearance, so the shaft's cradle is 50 + 43 = 93 mm tall). One `top` notch per part in the row. Replaces the bearers and the side posts |
| Stacking cradle | `cradle` | Between each pair of layers, at the same stations: from the lower part's top − notch depth to the upper part's bottom + notch depth, with `bottom` notches over the layer below and `top` notches for the layer above. The part gap and the separator's thickness become wood between the notches, so **there is no separator sheet**; the layers' cradles stack into one column. Only where the upper layer has parts |
| End stop | `blocking` | At both ends of every column of parts, in the gap to the end wall or the next part, from the floor to the top of the column. Width and minimum gap as blocking posts (`stock.blockWidthMm`, `construction.minBlockingGapMm`); de-duplicated |

Packing is untouched: the layout, slot positions and outside size are the packer's. A cradle
member is still its bounding box, with `cradle: { axis, notches }` (`CradleProfile`) for the
notches; each `Notch` has its centre, width, depth, shape, radius and face. BOM, weight and
cost use the box (the stock it is cut from). `cradleProfile(member)` gives the outline in the
board's plane (round notches as 16-segment arcs), and `cradleSolidAt(member, at)` the solid Z
range at a point along it.

**Outputs.**

- **Cut list:** Cradle and Stacking cradle lines, stock "{38} × {height}" cut to the interior
  width; imperial reads e.g. "1 1/2″ × 3 11/16″ from 2x6" (cut to size, like blocking). Pieces
  with a different notch count are different lines (key suffix `|n notches`, `BomLine.notches`).
- **Screws** (§7.6): 4 per cradle, two at each end: "Cradles to floor", and "Stacking cradles
  through the side walls". End stops are 2 each, and the blocking line is titled "End stops".
- **Labour** (§7.12): each notch is one more lumber cut.
- **Checks:** the `blocking` pass names them: "4 notched cradles hold the parts across their
  length, and 2 end stops hold them along it."
- **3D:** each cradle is its profile extruded through its thickness (`cradleGeometry`), with
  edges drawn above 20°, so the notch reads clearly; it picks, tooltips, highlights and ghosts
  like any board. The GLB export uses the same solid.
- **Overview:** a "Cradles" step ("N cradles", the end stops) in place of "Blocking".
- **Build sheet** (§7.11): floor cradles are placed in "Load the parts", with the notch size
  ("a round seat of 86 mm radius, 43 mm deep and 149 mm across"); stacking cradles and end
  stops in "Blocking and separators". Section A–A shows the floor cradles under the parts (seen
  below the cut) and the end stops; Section B–B cuts the cradles through the notch, so each shows
  its solid part only. Both titles name the cradles.

### 7.5b Shaped blocking (`src/domain/profile.ts`, #16)

Bounding-box blocking touches only what reaches the bounding box. On the open-top housing
(PART-003) that is a base-plate edge, a tab and a boss: a post can sit over an opening, and the
part can slide up to 65 mm before it meets one. With a **part profile**, posts sit on solid
material and **shaped blocks** reach into the recesses, so blocking touches the real surfaces.

**Profile** (`PartProfile`, measured by `buildPartProfile` in `src/lib/partProfile.ts`):

```ts
PartProfile {
  version: 1
  sizeMm: [x, y, z]       // the bounding box it was measured on, in the part's own frame
  cellMm: number          // grid spacing: longest side / 100, at least 2, rounded up to 0.5 mm
  faces: Record<"-x" | "+x" | "-y" | "+y" | "-z" | "+z", {
    cols, rows,           // whole cells close to cellMm; X faces are Y × Z, Y faces X × Z, Z faces X × Y
    depth: number[]       // row-major, mm (0.1) from that bounding-box face inward to the first surface; -1 = no material
  }>
}
```

- **Analysis:** every triangle is rasterised onto the three axis planes at the cell centres,
  keeping the nearest surface from each side (a depth buffer), so the cost is triangles × cells
  covered, not one ray per cell. All six faces, so any orientation works.
- **When:** once per model, in the browser, when it is idle after the crate first renders
  (`scheduleProfile` in `PartInstances`, `requestIdleCallback` with a 1.5 s timeout), cached by
  model URL. Measured: **2–19 ms** per sample part in Node (the test limit is 200 ms) and about
  **5 ms** for PART-003 in headless Chromium. It never blocks the first render.
- **Fallback:** without a usable profile, blocking is exactly §7.5. That covers a part not
  analysed yet, an analysis that throws (no triangles) or runs past 1 s (`PROFILE_BUDGET_MS`), a
  profile whose size is more than 1 mm from the part's (`PROFILE_SIZE_TOLERANCE_MM`).
- **Cradles first:** a layout that `usesCradles` (§7.5a, a slender part lying flat, such as the
  shaft) has cradles instead of blocking posts, so the profile isn't used. A slender part stood
  on end keeps general blocking, and that blocking is shaped.

**Placing the blocking** (`planShapedBlocking`). The slots share one orientation, so the plans are
worked out once per orientation and slot size, and cached on the profile.

1. The profile is rotated into the crate with the layout's orientation (an integer rotation
   matrix, the same XYZ Euler as three.js) and resampled on each vertical side of the slot: depth
   by position along the side and height up the part (`sideGrid`).
2. Each post keeps its §7.5 size and gap, but slides along its side to the position where the
   post and its shaped blocks **touch the largest share of the surface** within 2 mm
   (`CONTACT_TOLERANCE_MM`). Ties go to the centre, so a box-shaped part keeps the centred post
   exactly. A post between two parts is scored on both parts' faces.
3. **Shaped blocks** ("Shaped block" in the cut list, `kind: "blocking"`, 89 wide like the post)
   are screwed to the post's inner face. Each run of heights whose recess depths are within 10 mm
   of each other (`SHAPED_BAND_TOLERANCE_MM`) gets one block reaching to the shallowest point of
   that run, so it never cuts into the part. A run that meets a shallower height stops half a
   cell short, because the step lies somewhere between two samples. No block is made for a recess
   under 6 mm (`MIN_SHAPED_BLOCK_DEPTH_MM`, the post is close enough) or over 100 mm
   (`MAX_SHAPED_BLOCK_DEPTH_MM`, it would be a cantilever reaching over a low wall into the open
   top), or for a run under 19 mm tall (`MIN_SHAPED_BLOCK_HEIGHT_MM`).
4. X-side posts are placed first; a Y-side position whose blocks would meet an X-side block near
   a corner is skipped.

Shaped blocks lie inside the part's bounding box, beside the part, so the crate's size, layout
and packing never change; only the dunnage, weight, cost and screws (2 per block) do.

**Restraint metric** (`restraint`). Both kinds of blocking are scored against the profile on
every slot side, over the part's height, on the profile grid:

- **Contact:** the share of the blocking face beside the parts that is within 2 mm of a part
  surface. Blocking over an opening or a recess counts against it.
- **Free movement:** per crate axis, the furthest any part can slide toward a side before it
  meets the blocking there (`Infinity` when nothing on that side stops it).

| Sample, quantity | Contact: bounding box → shaped | Free movement X, Y: bounding box → shaped | Shaped blocks |
|---|---|---|---|
| PART-003 × 8 | 10% → **63%** | 65, 5 mm → **0, 0 mm** | 44 |
| PART-003 × 1 | 10% → 66% | 65, 5 mm → 0, 0 mm | 6 |
| PART-001 × 4 | 11% → 64% | 0, 0 mm → 0, 0 mm | 12 |

The rest of the shaped blocking face is over openings or recesses deeper than 100 mm. The price
for PART-003 × 8 is 44 blocks: about 10 kg, $58 and an hour more build time than bounding-box
blocking (205 vs 195 kg gross, $360 vs $302).

The `blocking` check says so (§7.7): "24 blocking posts hold the parts on all four sides. They
are shaped to the part with 44 shaped blocks in its recesses: 63% of the blocking face touches it
(bounding box: 10%), and the most a part can shift is 0 mm (bounding box: 65 mm). The smallest gap is
50 mm, between parts."

### 7.6 Outputs

- **Mass:**
  - `payloadKg = mass_kg × quantity`
  - `tareKg = Σ volume × density`, with plywood at 600 kg/m³ and lumber at 480 kg/m³
    (`rates.densityKgM3`)
  - `grossKg = payloadKg + tareKg`
  - `tareKgByAssembly` splits `tareKg` by assembly (for the Overview's weight bars)
- **Material totals:** plywood area is the sum of each sheet's two largest dimensions multiplied
  together. Lumber length is the sum of each board's longest dimension.
- **Cost:** `Σ volume × rate`, with plywood at $1,100/m³ and lumber at $650/m³
  (`rates.costUsdPerM3`). The shipped values are **placeholders**, good only for comparing
  designs; a shop can enter its own prices. This is `materialCostUsd`, the wood only (the
  Overview's "$ of wood"); `cost` adds screws and labour (§7.12).
- **Screws** (spacings from `rates.screwSpacingMm`: `cleat` 150, `skid` 300, `panelJoint` 200):
  - each cleat: `ceil(len/150)+1`
  - each skid: `ceil(len/300)+1`; with floor joists (#7) instead 2 where each joist crosses a
    skid, plus `ceil(len/300)+1` along each joist (floor to joists)
  - each block or bearer: 2
  - each cradle or stacking cradle: 4 (#6, §7.5a)
  - walls-to-floor plus lid-to-walls: `2·ceil(2(L+W)/200)`
  - corners: `4·ceil(H/200)`
  - `screwSchedule(members, interior, standards)` returns these line by line (floor to skids,
    side and end wall cleats, walls to floor, corners, bearers, cradles, stacking cradles,
    blocking (titled "End stops" in a cradled crate), lid cleats, lid to walls; with floor joists,
    joists to skids and floor to joists), each with its assembly and spacing, for the build sheet's fastener schedule (#26);
    `screws` is its sum, so the estimate is unchanged.
- **BOM:** members are grouped by `(assembly, label, stock, cut)`; that string is the line's
  `key` and each member's `bomKey`.
  - **Plywood:** stock is `"{thickness} mm"` and cut is `"{largest} × {second}"`.
  - **Lumber:** stock is `"{smallest} × {middle}"` and cut is `"{length}"`.
  - Regrouping by label instead of kind changes how many lines there are, not the total quantity.
- **CSV** (`bomToCsv`, and `shipmentToCsv` for a split batch) **follows the selected units**
  (#15), so it is imperial by default. Five `#` header lines (part id and name; part material and
  mass each; external size and gross, or the crate count and gross for a shipment; layout; the
  units), then `component,material,stock,cut_in,qty` (or `cut_mm`) with component as
  `"{Assembly}: {label}"`, then a final wood-screws line.
  - **Imperial** is plain ASCII, so spreadsheets don't garble it: `# Units: inches (cuts to the
    nearest 1/16) and pounds; lumber by nominal size`, mass each to 2 decimals in lb, gross in
    whole lb, stock by nominal name (`4x4`, `1x4`, `1/2 in` plywood, `1 15/16 in x 3 1/2 in
    from 4x4` blocking) and cuts as `36 11/16 in` or `35 3/16 in x 14 1/8 in`.
  - **Metric** is as before plus the units line: `# Units: mm and kg`, stock as `19 × 89` or
    `12 mm`, cuts in whole mm (`1082`, `932 x 652`).
  - The export document (#26, §7.11) follows the same rule: the selected units, imperial by
    default, with the same names (`src/lib/lumber.ts`).

### 7.7 Checks

`designCrate` returns every rule, passed or not, in a fixed order. The UI sorts cautions first,
then passes, then info.

**Shipping is domestic only** (US truckload or LTL in a 53' dry van). Export concerns (ISPM-15
lumber, ocean containers, air freight) are out of scope, so there is no export check.

| id | Pass (`ok`) | Problem | Rule |
|---|---|---|---|
| `door` | Fits a 53' dry van | caution: Too big for a 53' dry van | external L ≤ 16000 mm, W ≤ 2489 mm, H ≤ 2743 mm (`limits.trailerMm`) |
| `stable` | Stable footprint | caution: Tip-over risk | `layout.stable` (H ≤ 1.5 × short side, `limits.stableHeightRatio`) |
| `blocking` | Every part is blocked in ("… The smallest gap is 50 mm, between parts.") | caution: Parts are not restrained ("The 10 mm gap between parts is under the 19 mm that blocking needs. …") | The smallest side gap in the drawn crate ≥ 19 mm (`construction.minBlockingGapMm`). For a cradled slender part (§7.5b) the pass text names the cradles and end stops instead of the posts. The side gaps are `layout.clearance` on X and Y (more than the setting when a tiny crate was padded, §7.2) and the part gap only when there is more than one part along X or Y. The text names the smallest gap and where it is: between parts, to the walls, to the end walls (X) or to the side walls (Y) (#36). With shaped blocking (§7.5b) the pass text adds "They are shaped to the part with N shaped blocks in its recesses: C% of the blocking face touches it (bounding box: B%), and the most a part can shift is F mm (bounding box: G mm)." ("unlimited" when nothing on some side touches the part); the post count leaves out the shaped blocks |
| `stack` | Stack load is light | caution: Heavy stack on the bottom layer | mass × (nz − 1) ≤ 100 kg (`limits.stackKg`); only reported when nz > 1 |
| `base-rating` | Within the base rating ("Base rated 859 kg; this crate's payload is 645 kg (75%). 3 × 4x6 skids, 7 2x4 floor joists and a 19 mm floor, sized for 1.5× the load (skid bending governs).") | caution: Over the base rating ("… Even 3 × 4x6 skids … can't carry it (skid bending governs). Split the batch, or add heavier skid or joist stock.") | payload ≤ the computed base rating (§7.15, #7; it replaced the fixed 1,000 kg `limits.baseRatingKg`). Sections are named with a plain `x` ("4x4", "4x6", "2x4"; the table is `src/domain/lumber.ts`), or in mm for non-standard stock |
| `lid` | Lid carries the stacking load | caution: Lid can't take the stacking load | Only when `structure.lidStackKg` > 0 (§7.15): the lid's rated stacking load ≥ `lidStackKg` |
| `cog-offset`, `cog-tip`, `forklift`, `pallet-jack` | §7.14 | §7.14 | Centre of gravity and handling (#8), in this order after `base-rating` |
| `oversize` | — | info: LTL length surcharge likely | external L > 2438 mm (8 ft, `limits.ltlExcessiveLengthMm`; the text gives the limit in feet) |
| `utilization` | — | info: Mostly empty space | utilization < 25% (`limits.lowUtilization`) |
| `cardboard` | — | info: A cardboard box may be enough | part mass ≤ 15 kg, payload ≤ 25 kg and interior L + W + H ≤ 1905 mm (`limits.cardboard`). The text states those three limits as configured ("… within the shop's carton limits (parts up to 15 kg, payload up to 25 kg, 1,905 mm L + W + H).") |
| `crate-limit` | Within the per-crate limits | caution: Over the per-crate limit | Only on a split batch (§7.10), added by `planShipment` to each crate type: ok names the plan and the limits; caution when one part alone is over them |

The figures in this table are the defaults; the checks read the standards passed in.

**Trailer limits.** Typical published dimensions for a 53' × 102" dry van are an interior of
about 52'6" × 101" × 110" and a rear door opening of about 98–100" × 108–110". The door, not the
interior, limits width and height, so the check uses the low end of the door range: 98" (2489
mm) wide and 108" (2743 mm) high, and the 52'6" (16000 mm) floor for length. Separately, most LTL
carriers add an excessive-length accessorial for handling units over 8 ft, which `oversize`
notes. Forklift and pallet-jack handling is §7.14.

**When a crate is overkill.** The brief says smaller aluminum parts might ship in ordinary
cardboard boxes. `cardboard` suggests it, while still producing the crate design, when:

- each part is ≤ 15 kg, light enough not to punch through corrugated board. The 11.8 kg
  aluminum housing qualifies; the 21.5 kg steel bracket and 27 kg steel shaft do not.
- the payload is ≤ 25 kg, which leaves room for the box and dunnage under the 65 lb (29.5 kg)
  gross limit of a 32 ECT single-wall box (NMFC Item 222 / UFC Rule 41). That rating is the
  reason for the default; the shop's limit is the setting, and it is what the check's text states.
- the crate interior's L + W + H is ≤ 1905 mm (75 in), the same rule's size limit for that box.

Of the sample parts at their suggested quantities, only a single PART-003 triggers it (11.8 kg,
interior 545 × 535 × 354 mm). That is deliberate: one housing fits in a carton, while four or
more (47 kg and up) and the steel parts justify a crate.

**Check text and units (#62).** `Check.detail` is a `Message` (`src/domain/message.ts`), not a
string: plain text interleaved with typed quantities, built with the `msg` tagged template
(`msg\`Within the ${mm(2489)} door\``). `mm(v)` is an overall length, `shopMm(v)` a shop
measurement (gap, clearance, floor, tine) and `kg(v)` a mass, all in mm and kg, so the domain
stays unit-free and the numbers stay data. `renderMessage(message, units)`
(`src/lib/message.ts`) is the one place they become text: metric reads "2,489 mm" and
"1,240 kg" as before; imperial gives "98.0 in" for overall lengths, the nearest 1/16″ ("3 1/2″")
for shop measurements, and lb by the one mass rule above. Every consumer renders at the edge:
the Checks tab, the shipment note (`ShipmentPlan.unmet`), the print document and so the PDF
(`buildPrintable` renders for its `units`), and the file-dependent checks below. The exported
README.txt, CSV and design JSON quote no check text: the JSON stays metric and the CSV already
follows the toggle. Tests render with `metricText`.

The UI adds two checks that depend on the loaded file (`src/state/checks.ts`):

- **`model`:** ok when the measured GLB is within ±1 mm of the catalog size; caution when it
  isn't; info ("Size comes from the model file") for parts with no catalog entry.
- **`mass`:** a caution while a stand-in mass is in use.

The Checks tab badge counts cautions.

### 7.8 Why this layout (`explainLayout`)

This compares the layout on screen with the recommendation (`layouts[0]`) and the runner-up
(`layouts[1]`):

| kind | When |
|---|---|
| `only` | One layout fits |
| `picked` | The user chose a non-recommended layout. Carries `morePct`, its extra volume over the recommendation |
| `stable` | Recommended, and the runner-up would tip |
| `smaller` | Recommended, and the runner-up ships `nextMorePct` ≥ 3% more volume (`defaults.volumeTolerance`) |
| `tie` | Recommended, and the volumes are within 3%, so the lower crate won |
| `ranked` | Recommended under the `cost` or `density` ranking (#17). Carries `by` |

`explainLayout(layouts, shown, standards?, ranking?)` takes the same standards and ranking as
the design, so its "tie" matches the ranking's tolerance and a re-ranked recommendation isn't
called "the smallest".

### 7.9 When there is no crate (`DesignProblem`)

`computeDesign` never throws. When it can't design, it returns `design: null`, `layouts: []` and
the first `problem` that applies:

| id | When | What the user is told |
|---|---|---|
| `part-size` | A dimension is 0, negative, NaN or infinite (e.g. a flat model) | Every side must be longer than zero |
| `part-too-large` | The longest side is over 20 m (`MAX_PART_MM` in `design.ts`) | The size, and to check the file's units |
| `part-mass` | Mass is not a finite number above zero | Enter a mass above zero |
| `settings` | Settings fail `CrateSettingsSchema` (only if the store boundary was bypassed) | Which field, and to reset the rules |
| `standards` | Custom standards fail `ShopStandardsSchema` (only if `setStandards` was bypassed; the shipped defaults are not re-parsed) | Which field, and to reset the shop standards |
| `no-layout` | Packing returned nothing (unreachable for valid input, §7.2) | Try more layers, smaller gaps or turning off upright |

The island shows the title and detail in place of the tabs' content (with Reset rules for
`settings` and `no-layout`), and the canvas shows the title.

Very small parts (down to sub-millimetre) get the minimum 178 mm interior (§7.2). Very large ones
up to 20 m get a normal design, with the `oversize` and `door` checks as they apply. The 3D view
pushes the camera's far plane and orbit limit out for crates too large for the defaults (200 m
and 60 m).

### 7.10 Shipment planning (`planShipment`, #25)

A large batch can't always go in one crate: 200 brackets is over 4,300 kg of payload. A PM
needs "this batch ships as N crates", each buildable, handleable and within limits.

**Limits per crate** (shop standards, §6.4):

- gross ≤ the smaller of `limits.perCrate.maxGrossKg` (1,000 kg, a handling limit) and the
  crate's computed base rating as a gross weight, `structure.ratedPayloadKg + tareKg`
  (`crateGrossLimitKg`; #7, §7.15). Each candidate crate is designed anyway, so this costs
  nothing extra, and the bisection still terminates;
- outside L ≤ `trailerMm.interiorLength`, W ≤ `doorWidth`, H ≤ `doorHeight` (the `door` check's
  limits, `withinOutsideLimits`);
- parts ≤ `limits.perCrate.maxParts`, when it is above 0.

With the defaults, no sample part splits at its suggested quantities.

**`planShipment(part, settings, layoutKey?, standards)`** returns `{ split, crates, totals,
unmet, problem }`. `crates` holds one or two **crate types** (`{ label, count, quantity,
result }`, where `result` is a full `DesignResult` for `quantity` parts: layouts, design, cut
list and checks). `totals` sums crates, parts, payload, tare, gross, outside volume, wood cost,
and (#17) total crate cost (`costUsd`), build time (`labourHours`) and dimensional weight
(`dimWeightLb`), each crate type × its count.

1. **One crate when it fits.** If the crate for the whole batch is within every limit, the plan
   is that crate: `computeDesign`'s own result, value for value (tested on every sample part ×
   suggested quantity × keep-upright, so the 18-case baseline can't move). A single part is
   never split (Q = 1 stays as today, with its `door` or `base-rating` cautions). **A layout
   pick counts:** when `layoutKey` is one of the whole batch's layouts and the crate on it is
   within every limit, the batch ships as that one crate even if the recommended layout's crate
   isn't. This is what makes applying the quantity sweep's recommendation (§7.16: quantity and
   layout) plan as exactly that crate: the sweep's hard checks (`door`, `base-rating`, gross and
   part limits) imply these limits, so a crate it passes never splits.
2. **Layouts that fit the trailer first.** For any part count, if the recommended layout is over
   the trailer limits but others aren't, the ones that fit are ranked ahead (each in its usual
   order) and the best of them is recommended.
3. **Largest crate:** `kMax`, the most parts that fit one crate, by bisection over
   `1 … min(Q − 1, maxParts, floor(maxGross / part mass))` (fit is taken to fall as k grows;
   with #7 the base grows with k, so the rating usually rises with it, and only runs out when
   the stock does).
4. **Fewest crates:** `N = ceil(Q / kMax)`. Every k from `ceil(Q / N)` to `kMax` ships in N
   crates, as `floor(Q / k)` identical crates of k plus at most one remainder crate of
   `r = Q − floor(Q / k)·k < k` parts.
5. **Then least outside volume, then the most even split.** The candidates' total outside
   volume comes from the layouts alone (`rankLayouts`, no crate designed). Volumes within
   `defaults.volumeTolerance` (3%) of the least feasible volume tie; among those the smallest
   `k − r` wins (0 when there is no remainder), then the smaller volume, then the larger k. Only
   front-runners are designed, to confirm they fit. Example: PART-001 × 200 ships as
   6 × crate A (30 each) + 1 × crate B (20), 7 crates; PART-003 × 10 with at most 4 per crate is
   2 × 4 + 1 × 2.
6. **When even one part is over the limits,** every part ships in its own crate, `unmet` says
   why, and each crate's `crate-limit` check is a caution.
7. **Layout picks:** besides keeping a batch whole (step 1), `layoutKey` applies to the first
   crate type that has that layout; a split itself always uses the recommended layouts.

On a split, every crate type gets the `crate-limit` check (§7.7); its text names the limits as
"1,000 kg gross or the base rating, the trailer door and floor". `shipmentBom(plan)` merges the
cut lists for the whole shipment (each type's quantities × its count; equal pieces merged by
`BomLine.key`, each piece's sizes kept together), with summed plywood, lumber and screws;
`shipmentToCsv` writes it with a "# Shipment of …" header. `describeShipment` gives
"6 × crate A (30 each) + 1 × crate B (20)".

**Speed:** at quantity 200, a split takes about 5–15 ms for the sample parts; a pathological
case (a tiny part with only a part-count limit, where about 100 candidate k tie on crate count)
takes about 150 ms. The tests fail above 200 ms and 500 ms.

**In the store:** `plan`, `crateIndex` (the crate type on screen) and `result`, which is always
`plan.crates[crateIndex].result`, so the 3D view, Layouts, Cut list and Checks follow the
selected type unchanged. `setCrateIndex(i)` switches type (clears the pin and hover, re-frames,
records no change note). An edit keeps the type while the new plan has it, else shows A.

### 7.11 Export document (`PrintableDesign`, #26)

The PM's hand-off: logistics books freight from the crate spec, the shop builds from the build
sheet, and the dock ships with the label. It is a print-styled route, `/print`, saved as a PDF
with the browser's "Save as PDF". There is no server, and every drawing is vector SVG.

**Model.** `buildPrintable({ part, plan, standards, units, ranking, generatedAt, timeZone })` in
`src/lib/printable.ts` is pure and unit-tested. It turns a shipment plan (§7.10) into a
`PrintableDesign` of rows, sentences, tables and drawing data, already formatted in the selected
units. The print page only renders it (`src/components/print/PrintDocument.tsx`), so a
programmatic PDF export (#51) can build the same model and lay it out itself.
`printableFromDesignFile(text, standards, units, generatedAt, timeZone?)` rebuilds it from a design
file (§6.5) the way reopening the file does, and also returns the reopen notes (worded in
`units`). The part comes from the file with its measured outline, and the plan is made with the
file's ranking, so the print is the crate that was saved: same shaped blocks, gross, screws and
lumber as the app and the zip.

**Ranking and date.** The ranking is an input: "why this layout won" and the runner-up follow
it (`explainLayout(layouts, layout, standards, ranking)`), under cost and density as under
volume, in the print, the PDF and the zip. The document date is the date on the clock where it
was made, in the device's time zone, not UTC (`documentDate`, with the zone as a parameter so it
is testable). The same date is in the PDF header and the zip's README.txt.

**Pages**, in print order (Letter, 0.5″ margins, a page break between sheets):

1. **Crate spec** (PM and logistics): the part (id, name, material, mass each, quantity). For a
   split batch, the plan follows ("Ships as 6 × crate A (30 each) + 1 × crate B (20)", crates,
   parts, gross and volume in all, and `unmet` if any). Then there is **one section per crate
   type** with:
   - parts in the crate, outside L × W × H, gross, tare and payload (each with the other units
     under it), and volume;
   - **freight:** dimensional weight (outside L × W × H in cubic inches ÷ 139, the common
     domestic divisor `DIM_DIVISOR_IN3_PER_LB`, rounded up; in kg when metric), billable weight
     (the larger of gross and dimensional), and density in **lb/ft³** (gross ÷ outside volume,
     with kg/m³ under it when metric). A **freight class** row appears only when the design
     carries a `freightClass`;
   - the layout on screen, why it won (`explainLayout`, worded as in the Layouts tab), and the
     runner-up (the next layout in rank order, with its size, volume and the difference);
   - every check (the domain checks plus the stand-in mass caution), cautions first, marked
     Pass, Caution or Info.
2. **Build sheet**, one per crate type, on two pages:
   - **Drawings** (`crateDrawings`, `src/lib/drawings.ts`), projected from the design's
     members, never from the 3D view:
     - outside **top**, **front** (from −Y) and **end** (from +X), painted far to near, each
       with its overall length and its height or width;
     - **Section A–A**, a plan cut halfway up the bottom layer: walls, uprights and blocking
       posts are cut and hatched, parts are dashed, and the interior L and W are dimensioned;
     - **Section B–B**, a side cut through the front row of parts: blocking, separators, lid
       and floor are cut, the bearers under the row are seen beyond the cut, and the interior
       L and H are dimensioned.
     - For a cradled slender part (#6, §7.5a), A–A also shows the floor cradles seen below the
       cut, B–B cuts the cradles through the notch (only the solid part is drawn), and both
       titles name the cradles.

     Dimensions are shop sizes: fractional inches to 1/16″, or whole mm.
   - **Cut list by stock:** the crate's cut list regrouped by stock name (`stockText`). Each
     group lists its pieces with assembly, cut and quantity, plus the group's piece count and
     its running length (lumber) or area (plywood). Plywood, lumber and screw totals follow.
   - **Fasteners:** `screwSchedule` line by line, with each spacing in the selected units, and
     the total (equal to the screw estimate).
   - **Assembly order:** (the fasteners and the assembly order are kept together: if they do
     not fit under the cut list, both start the next page, so no step is alone on a page.
     `stepOfMember` assigns each cut-list line its step from its assembly and kind: bearers and
     floor cradles go before the parts, all other inside pieces after.) 1 Base (with floor joists, #7: "screw 7 2x4 floor joists on edge across
     them … and screw the floor to the joists", and "The base is rated for … of parts"), 2 Walls, 3 Load the parts (bearers first), 4 Blocking and
     separators (layer by layer when stacked), 5 Lid. Each step has a sentence, the pieces it
     uses and its screws. Every cut-list piece is in exactly one step, and the steps' screws
     sum to the schedule's total.
3. **Shipping label**, exactly one page per crate type (the end view scales to the room the
   page has left, and `e2e/print.spec.ts` checks the page count in print media):
   - part number and name, quantity ("4 PCS"), and outside size;
   - gross weight in the selected units, with the other units under it;
   - "THIS SIDE UP" with the ISO 780 two-arrow mark;
   - the crate type and count, for a split batch;
   - the crate's end, with the skids and a **fork-entry arrow** in each opening between them
     ("FORK ENTRY FROM THE ENDS"). The openings are `design.handling.openings` (§7.14), the
     same ones the forklift and pallet-jack checks measure (`PrintableLabel.openings`);
   - the **centre-of-gravity** mark (ISO 7000-0627, the quartered circle) at the design's
     `handling.cogMm`, projected onto the end view (`cogEnd`: Y and Z from the outside
     bottom-left corner). Every design has a CoG, so the mark is always drawn.

**How the design reaches the page.** The Cut list's **Print / save PDF** serializes the design
on screen as a design file (§6.5, `serializeDesign`) and opens
`/print#design={base64url}&u={units}&print=1` in a new tab (`src/lib/printLink.ts`). The design parameter is the share link's (`design`, §9); the older `d` is still read, so links made before #62 open. The print tab
reads the hash and rebuilds the plan with **this browser's saved shop standards** (the file holds
none, as when reopening it). It renders the document, waits for the fonts and calls
`window.print()`. The toolbar (screen only) has its own Print / save PDF button and says that
⌘P / Ctrl+P works too. The hash is used rather than `sessionStorage` because:

- it needs nothing from the opener, so a reload or a bookmarked tab still works, and tests can
  open the route directly;
- it never reaches a server;
- it is the same file format a share link (#14) can use, and the file is small (about 1 KB of
  base64).

Without a design, or with a damaged one, the page says how to open it. Any reopen notes (a
changed plan or size under other standards) show above the document, on screen only.

**Print CSS** (`src/app/print/print.css`, imported only by the route, which loads no designer CSS, and scoped to
`.print-doc`): `@page { size: letter; margin: 0.5in }`, `break-after: page` per sheet, and
`break-inside: avoid` on spec sections, cut-list groups, steps and figures. It is black on
white; the label's crate-type bar is the only filled block (`print-color-adjust: exact`). On
screen, each sheet is an 8.5 × 11 in white page on grey.

### 7.12 Cost, labour and freight (`src/domain/cost.ts`, #17)

The stakeholder metrics are **total crate cost** and **potential freight cost**, with **time to
design** as a reference. `designCrate` computes all three parts below for every crate; every
rate and time is a shop standard (§6.4). No freight dollar rates are invented: a freight
booker prices LTL from class, weight and lane, so the app gives the class and weights.

**Labour (`estimateLabour(bom, screws, layers, standards)`).** Build time in minutes:

```
cutting   = lumber pieces × lumberCutMin + plywood pieces × plywoodCutMin
setup     = distinct cut sizes × setupMin            (one per material|stock|cut in the cut list)
fastening = screws × screwMin
assembly  = (6 + layers) × assemblyStepMin            (base, 4 walls, lid, dunnage per layer)
handling  = handlingMin                               (per crate)
hours     = Σ / 60;   labour $ = hours × rateUsdPerHour
```

Pieces are the cut list's quantities (one cut per lumber piece; one plywood piece is a rip and a
cross-cut, hence its own time). Each cradle notch (#6, `BomLine.notches`) counts as one more
lumber cut. The same size in two assemblies is one set-up.

**Cost (`crateCost`).** `woodUsd` = `materialCostUsd` (§7.6); `fastenersUsd` = screws / 100 ×
`rates.screwCostUsdPer100`; `materialUsd` = wood + fasteners; `totalUsd` = material + labour.
For a split batch each crate type has its own cost and `plan.totals.costUsd` is the shipment's.

**Freight terms (`freightTerms(grossKg, external, standards)`), domestic LTL:**

- **Outside size** in inches, each side rounded **up** to the next whole inch, as carriers
  measure; **volume** = L × W × H / 1728 ft³.
- **Gross** = `grossKg` × 2.20462 lb.
- **Dimensional weight** = `ceil(L × W × H in³ / freight.dimDivisorIn3PerLb)`, 139 in³/lb by
  default (the common domestic divisor). Shown for reference; LTL normally bills on class and
  actual weight.
- **Density** = gross lb / ft³.
- **Estimated freight class** (`freightClassFor`) from `NMFC_DENSITY_SCALE`, the NMFC 13-sub
  density scale (NMFTA Docket 2025-1, in effect from 19 July 2025; the source is cited in the
  code). A density is in a bracket from its lower bound up to, but not including, the next:

  | lb/ft³ | <1 | 1 | 2 | 4 | 6 | 8 | 10 | 12 | 15 | 22.5 | 30 | 35 | ≥50 |
  |---|---|---|---|---|---|---|---|---|---|---|---|---|---|
  | **Class** | 400 | 300 | 250 | 175 | 125 | 100 | 92.5 | 85 | 70 | 65 | 60 | 55 | 50 |

  Zero, negative or non-numeric density is class 400. It is an **estimate**: some commodities
  have their own NMFC item, and a carrier can re-class on inspection.

**Worked example: PART-001 × 4 with the shipped standards** (tested in `cost.test.ts`):

| | Count | Minutes |
|---|---|---|
| Lumber cuts | 47 × 0.75 | 35.25 |
| Plywood cuts | 6 × 3 | 18 |
| Cut sizes (set-ups) | 11 × 2 | 22 |
| Screws | 202 × 0.15 | 30.3 |
| Assembly steps | (6 + 1 layer) × 6 | 42 |
| Handling | 1 × 15 | 15 |
| **Build time** | | **162.55 min = 2 h 43 m** |

Labour 2.709 h × $35 = **$94.82**; wood $75.16 + screws 202 / 100 × $8 = $16.16 → material
**$91.32**; **crate cost $186.14**. Freight: 932 × 652 × 497 mm → 37 × 26 × 20 in = 19,240 in³ =
11.13 ft³; gross 134.9 kg = 297.5 lb; dimensional weight ⌈19,240 / 139⌉ = **139 lb**; density
297.5 / 11.13 = **26.7 lb/ft³ → class 65**.

**Time to design.** The store records `designStartedAt` when the app mounts with the preloaded
part (unless the last-opened crate is reopened, which leaves the clock stopped, §9) and again on
every `setPart` / `loadDesign`, and `designedInMs` at the first export or
download after that (Download or Copy cut list, Download design (.json), the Export pill's .zip);
later exports don't move it, but an edit clears it (it would describe a design that is gone) and
the next export records the time to the edited design. The scorecard shows "Designed in 1 m 12 s"
in its heading row, muted, in a region that is always mounted: showing or clearing it moves nothing. The manual
baseline it compares with is an assumption in the README.

### 7.13 Export package (the Export pill, #51)

One click gives the PM everything a crate needs to leave the building: the shop, logistics and
engineering each get their file. Everything is made in the browser; nothing is uploaded.

**`crate-{part}-x{quantity}.zip`** (`{part}` is the part id with anything but letters, digits,
`.`, `_` and `-` turned into `-`, since a custom id comes from a file name):

| File | What | From |
|---|---|---|
| `crate-PART-001-x4.glb` | The assembled crate with the parts in place (metres, Z up) | `exportCrateGlb` (#27) |
| `crate-PART-001-x4.pdf` | Crate spec, build sheet and shipping label, every crate type | `printableToPdf(buildPrintable(…))` |
| `cut-list.csv` | The cut list in the selected units (§7.6) | `bomToCsv` |
| `design.json` | The design file (§6.5), re-importable with Load a part | `serializeDesign`, as Download design (.json) |
| `README.txt` | What each file is for, the part, the quantity (and the split), the date, the app name and version, and the units | `readme` |

**A split batch** (§7.10) packs every crate type: `…-crate-A.glb` and `…-crate-B.glb` (one GLB
per type), one PDF with a spec section, build sheet and label per type, `cut-list-crate-A.csv`
and `cut-list-crate-B.csv` (one crate of each type) plus `shipment-cut-list.csv`
(`shipmentToCsv`, every piece for all crates). `design.json` records the crate type on screen,
as Download design (.json) does. The zip entries are stamped with the export time.

**The PDF** (`src/lib/exportPdf.ts`) lays out the same `PrintableDesign` the `/print` route
renders, in the same order and with the same text: the crate spec (part; the shipment plan;
per crate type size and weight, freight, the layout, why it won, the runner-up, every check),
then per crate type the build sheet (the five drawings; the cut list by stock with totals,
the fastener schedule and its total, the five assembly steps with their pieces and screws) and
the shipping label (part number and name, quantity, gross in both units, outside size, the
crate-type bar for a split, THIS SIDE UP with the ISO 780 arrows, the end with skids and fork
arrows in the openings, the centre-of-gravity mark). Letter pages with 0.5″ margins; a sheet's
header repeats when it runs onto another page, and every page has "page i of n".

- **Vector throughout.** Text uses the PDF's built-in Helvetica; the drawings are drawn from
  `crateDrawings` as rectangles, hatching lines, dashed part outlines and dimension lines,
  rather than through an SVG converter. That keeps the PDF code DOM-free, so it is unit-tested
  in Node, and adds one dependency (`jspdf`) instead of two.
- **Characters.** The built-in fonts are WinAnsi, so `pdfSafe` spells the few characters outside
  it (`″` → ` in`, `–` → `-`, `≥` → `>=`, `→` → `->`); Latin-1 (`×`, `·`, `³`) is kept.
- **Differences from `/print`:** the page layout is the PDF's own, not the browser's (pixel
  parity is not a goal). Fasteners and assembly order stack instead of sitting side by side, so
  the assembly order can run onto another page. No section is left out.
- It is written uncompressed (the zip compresses it), so its text can be checked in tests.

**Loading.** `jspdf` (about 125 KB gzipped), the bundle code and the GLB exporter load with
`import()` on the first click, never with the page, through the engine's `buildBundleZip` (§5.1).
`fflate` (`zipSync`) zips.

**The pill** (§8.2): idle "Export specs"; busy "Exporting…" with a spinner, held for at least
`MIN_BUSY_MS` (1.5 s) even when the work is faster, so the action registers; with
`prefers-reduced-motion`, no spin and no hold. On success the file downloads,
`markExported()` stops the design clock (§7.12) and a `role="status"` note says "Downloaded
crate-PART-001-x4.zip" for 8 s. On failure the note says so in one sentence and the pill is idle
again. It is disabled when there is no crate (§7.9). The design is read at the click, so an
edit during the busy state doesn't change the package.

**The separate downloads stay** in the Cut list tab (CSV and Copy, Download design (.json),
Print / save PDF): someone who wants one file gets it in one click, and the print route is still
the quickest way to paper. **The pill is the one export control** (#62): its run and state live in
`src/state/exportRun.ts`, and a second click while busy does nothing. The View popover
has no export button (#77 added one; the user removed it as a duplicate). A design with
cautions still exports (no confirm dialog), but the pill carries an amber dot, a `title` and an
`aria-describedby` note such as "1 caution, see Checks". The zip replaced #27's
"Download 3D model (.glb)" and its "Include parts" switch; its GLB always includes the parts.

**Stamps and the quantity (#46).** Built by the engine, every file in the package carries
`engineVersion` and `inputHash` (§5.1): the GLB's scene `extras`, the PDF's keywords and a footer
line on every page, a `# Engine …` line in each CSV, `engine` in `design.json` and two README lines.
The PDF also has a **Quantity per crate** section after the part (§7.17), and its creation date
is the export time and its file id comes from the hash, so equal inputs at the same time give
equal bytes.

### 7.14 Centre of gravity and handling (`src/domain/handling.ts`, #8)

`analyseHandling(members, layout, partKg, standards)` reads the finished crate: the members
`designCrate` built and the part placements (`layout.slots`). It never changes the
construction, so it follows whatever skids, bearers, blocking or cradles the construction rules
produce (#6, #7, #16). `designCrate` stores the result as `design.handling` and
`design.handling.cogMm`, and appends `handlingChecks` to the checks after `base-rating`.

**Frame.** Everything is in the crate-interior frame of `Member` (§4): origin at the interior min
corner on top of the floor, Z up, X along the length. The ground is the bottom of the skids
(`handling.groundZ`, −(floor + skid height)). Forks enter from the ends (−X and +X), between the
skids, which run the full length.

**Combined centre of gravity.** The mass-weighted mean of:

- every board, at its box centre, with mass = volume × `rates.densityKgM3` of its material (the
  tare model of §7.6, so the boards sum to `tareKg`);
- every part, at the centre of its packed bounding box (`slot.min + cellSize / 2`), with the
  part's mass. **Without mesh analysis a part's own CoG is assumed to be its bounding-box
  centre.** A part whose mass sits off its box centre (a flanged shaft, a bracket with a heavy
  base) moves the true CoG by up to half its box in that direction.

The total equals `grossKg`. A full, symmetric grid puts the CoG on both centre lines; a part
missing from the last slot of a partial layer moves it away from that slot.

**Offset.** `offsetMm = CoG − the middle of the outside footprint` (X, Y), named in the text as
"toward the left end / right end" (−X / +X, as seen from the front) and "toward the front /
back" (−Y / +Y).

**Tip angle.** The static tip angle is `atan(d / h)`: `h` is the CoG height above the ground and
`d` is the horizontal distance from the CoG to the nearest edge of the base the crate stands on
(the outline of the skids). Past that tilt the CoG passes over the edge and the crate tips. The
sideways tip acceleration is `tan(angle)` g.

**Fork openings.** `forkOpenings(members)` sorts the `skid` members across Y; each gap between
neighbours is an opening (`y`, `width`). Its clear height is from the ground to the lowest
non-skid board over that gap: normally the floor, so the skid height; anything hung under the
floor (a joist from structural sizing) lowers it.

**Devices.** A device is two tines of `tineWidthMm` whose outside spread can be anywhere in
`spreadMm` (`placeTines`). It fits when both tines lie inside openings that are tall enough
(both in one wide opening, or one in each), the spread is in range, and **the CoG lies between
the tine centre lines**, so the load can't roll off a tine. The pallet jack's range covers a
narrow (20.5″) and a standard (27″) jack; any one jack has a fixed spread.

**Checks** (thresholds are the `handling` standards, §6.4):

| id | Pass (`ok`) | Problem | Rule |
|---|---|---|---|
| `cog-offset` | Centre of gravity near the middle ("It is on both centre lines, within 10% of the length (93 mm) and width (65 mm). 265 mm above the ground.") | caution: Off-centre centre of gravity ("Centre of gravity is 120 mm toward the left end; mark it on the crate. The limit is 10% …") | \|offset X\| ≤ `cogOffsetRatio` × outside length and \|offset Y\| ≤ `cogOffsetRatio` × outside width |
| `cog-tip` | Low centre of gravity ("… the crate tips over a side only past 51°. The limit is 30°.") | caution: Top-heavy ("… tips over a side at 24°, under the 30° limit. Strap it down, mark the centre of gravity, or pick a lower layout.") | tip angle ≥ `minTipAngleDeg` |
| `forklift` | Forklift fits from the ends ("Forklift: fits from the ends, 89 mm clear under the floor, needs 75 mm. Room between the skids for 100 mm tines at a 250 mm–1,100 mm spread, …") | caution: Forklift may not fit (too low: "… 70 mm clear under the floor, needs 75 mm. Use taller skids."; too narrow: "the widest opening between the skids is 156 mm; it needs room for …") | `placeTines` with `handling.forklift` |
| `pallet-jack` | Pallet jack fits from the ends; also **"Pallet jack won't fit: use a forklift"** ("The widest gap between the skids is 474 mm. A pallet jack needs 520 mm–690 mm across its forks.") when only the width rules the jack out and a forklift fits | caution: Pallet jack may not fit (too low, or too narrow while a forklift doesn't fit either) | `placeTines` with `handling.palletJack` |

A crate needs one way to be lifted. A small crate too narrow for a pallet jack is a fact of its
size rather than a defect, so while a forklift fits it is a pass (an answered question: use a
forklift, not an open one), and the default PART-001 × 4
crate (one 474 mm opening, under a jack's 520 mm spread) still has no cautions. Too little height
under the floor is always a caution.

With the defaults, the sample parts at their suggested quantities: every CoG is on the centre
lines (full grids) and every tip angle is 36° or more. The forklift fits all but the single
bracket (204 mm opening) and the single shaft (156 mm): forks can't go in from the ends of a
crate that narrow, so both devices are cautions there. The pallet jack fits only PART-003 × 8,
whose 1,102 mm wide crate has a middle skid and two 408 mm openings.

**Where it shows.** The Checks tab and the export document list the four checks (§7.11). The
3D view marks the CoG and the fork entry (§8.4). The shipping label draws the CoG mark on the
end view and the fork arrows in `design.handling.openings` (§7.11).

### 7.15 Structural sizing (`src/domain/structure.ts`, #7)

Before #7 the base was picked from mass thresholds: 4×4 skids, 4×6 above 700 kg of payload, a
skid every 800 mm, and a flat "1,000 kg base rating" that only produced a warning. Now the skids,
the floor joists and (when crates are stacked) the lid are sized from the load and the spans,
with simple, documented, conservative timber rules, and the base is **rated** from its members.
Everything is wood and wood screws: no metal plates, brackets or bolts.

**Where it runs.** `planStructure(grid, materials, payloadKg, partGap, standards)` is pure. The
packer calls it for every candidate layout (through `structureAllowance`, §7.3), because the
base height depends on the spans; `designCrate` calls it with the chosen layout, gets the same
answer, and builds the members from it. The result is `CrateDesign.structure`:
`{ base, lid, dead, baseMm, ratedPayloadKg }`, and `construction` carries `skid`, `skidCount`,
`joist {wide, tall, count} | null`, `lid {wide, tall, count, joists}` and `baseMm`.

**Allowable stresses** (shop standards, `structure`, §6.4). Spruce-Pine-Fir No. 2, NDS
Supplement (2018) Table 4A reference values, allowable-stress design:

| Value | psi | MPa (standard) | Note |
|---|---|---|---|
| Bending Fb | 875 × 1.3 = 1,137 | 7.8 (`lumberBendingMPa`) | 1.3 is the NDS size factor for a 4×6, the lowest of the stock sections (4×4 and 2×4 are 1.5); no repetitive-member or load-duration increase |
| Shear Fv | 135 | 0.93 (`lumberShearMPa`) | |
| Bearing across the grain Fc⊥ | 425 | 2.93 (`lumberBearingMPa`) | |
| Plywood bending | about 870 | 6.0 (`plywoodBendingMPa`) | On the gross section, a conservative figure for sheathing-grade plywood bent across its supports; check it against the supplier's panel values |

On top of the allowable stresses (which already carry the design-value margin), every load is
multiplied by `loadFactor` (1.5) for handling shocks and uneven support. A shop with other
lumber (Southern Pine, Douglas Fir-Larch) enters its own values.

**Loads.** `f` = `loadFactor`, g = 9.81 N/kg; everything in N and mm, so stresses are MPa.

- **Dead load** (`estimateDeadLoad`): the crate's weight above the skids, worked out from the
  layout before the crate is drawn (the packer has no members yet): the plywood (floor, walls,
  lid, separators) and the wall and lid framing exactly, and the dunnage as an upper bound (four
  full-height posts as thick as the widest gap, and two bearers, per part). `contents` is the
  part of it inside the crate (separators and dunnage). It is never below the drawn crate's
  weight, which is tested, so the rating errs low.
- **Skids carry everything:** `W = f g (payload + dead)`.
- **Floor and joists carry the contents:** `W_c = f g (payload + contents)`, spread over the
  interior footprint `A = L × W`, a pressure `q = W_c / A`. The walls stand on the floor's edge,
  over the outer skids.

**Members and checks.** Each check is linear in its load, so it gives the most load the member
carries; less the dead weight on that member, it is the payload the member allows. The smallest
is the **base rating**, `ratedPayloadKg`, and that check **governs**.

| Member | Model | Checks |
|---|---|---|
| Skid, `b` wide × `h` tall, `n` skids | Simply supported at its two ends (on blocks, uneven ground, or fork tines near the ends), span `L = extL`. An inner skid carries its share of the floor either side, `W_s = W / (n − 1)`; with 2 skids each carries `W / 2` | bending `W_s L / 8 ≤ Fb · b h² / 6`; shear `1.5 (W_s / 2) / (b h) ≤ Fv`; bearing `(W_s / 2) / (b · supportLength) ≤ Fc⊥` |
| Floor plywood, `t` thick | A simple span `s`, centre to centre of its supports (a conservative choice: the sheet is continuous). Without joists `s` is the skid spacing across the width; with joists, the joist spacing along the length | `q s² / 8 ≤ Fb_ply · t² / 6` per mm of width |
| Floor joist, 2×4 on edge (`t` = 38 along X, `h` = 89) | Across the skids under the floor, simply supported over the skid spacing `ss`, carrying a strip of floor `sj` (the joist spacing) wide | bending `q sj ss² / 8 ≤ Fb · t h² / 6`; shear `1.5 (q sj ss / 2) / (t h) ≤ Fv`; bearing on an inner skid `q sj ss / (t b) ≤ Fc⊥` |

**Choosing the base** (`sizeBase`):

1. **Skid count** starts at the spacing rule, `max(2, ceil(extW / skidSpacingMm) + 1)`, as
   before #7, and goes up to the most skids that keep `minForkOpeningMm` (200 mm) clear between
   neighbours, `floor((extW + 200) / (skid.wide + 200))`. Sizing never adds a skid past that, so
   it never narrows the fork entry below the minimum (#8 checks forklift entry itself). A crate
   too narrow for two skids and the opening keeps two skids at its edges.
2. **Skid section:** at each count, the smallest section from stock (`stock.skidMm.standard`,
   then `heavy`, by section modulus) that passes; with none, add a skid. Above
   `construction.heavySkidOverKg` only the heavy section is offered, as before.
3. **Floor joists** when the payload is over `joistOverKg` (450 kg) or the floor fails over the
   skids. They start at most `maxJoistSpacingMm` (400 mm) apart, `max(2, ceil(extL / 400) + 1)`
   evenly spread from end to end, and are closed up until the floor and joist checks pass (the
   pitch is solved directly: the floor's capacity falls as 1 / pitch², the joists' as 1 / pitch),
   keeping at least a joist's width clear between them. If they can't pass, the next skid count
   is tried.
4. **When nothing passes** (the most skids of the heaviest section, joists as close as they go),
   the strongest base tried is built, `base.ok` is false, and the `base-rating` check is a
   caution with the rating it does have. Shipment planning (§7.10) then splits the batch.

Light crates are unchanged: every sample part at its suggested quantities keeps the 4×4 skids,
the spacing-rule count and no joists, so the 18-case baseline (§10) holds.

**Lid** (`sizeLid`). Crates aren't stacked by default (`lidStackKg` 0): the lid is the nominal
frame, as before (1×4 cleats laid flat, two edge cleats and cross cleats at most 600 mm apart),
and there is no `lid` check. With a stacking load the lid carries `f g × lidStackKg` spread over
the lid; the cross members span the lid's width `lidW` and the plywood spans between them:
member bending `q p lidW² / 8 ≤ Fb · b h² / 6` and panel bending `q p² / 8 ≤ Fb_ply t² / 6` at
member pitch `p`. It tries flat cleats from the nominal count down to half the nominal spacing,
then 2×4 joists on edge (`stock.joistMm`) from the nominal count up, keeping a member's width
clear between them. Joists make the lid, and the crate, 70 mm taller; the edge members match
them, so the top stays flat for the crate above. The `lid` check reports the rated stacking load.

**Worked example** (`structure.test.ts`): a base 1200 × 1000 mm outside, interior 1100 × 900,
800 kg of payload, 150 kg of crate above the skids of which 40 kg is inside, 19 mm floor,
default standards.

| Step | Working | Result |
|---|---|---|
| Skid count | `max(2, ceil(1000 / 800) + 1)` = 3; most for a 200 mm opening `floor(1200 / 289)` = 4 | 3, centres 455.5 apart, 366.5 clear |
| 4×4 skid bending | S = 89 × 89² / 6 = 117,495 mm³; `W = 8 × 7.8 × 117,495 / (1200 × ½)` = 12,220 N = 830 kg at f = 1.5; less 150 kg dead | **680 kg < 800: fails** |
| 4×6 skid bending | S = 89 × 140² / 6 = 290,733 mm³ → 30,236 N = 2,055 kg; less 150 | 1,905 kg: passes. Shear 1,950 kg, bearing 6,939 kg |
| Joists? | 800 kg > 450 kg | yes: `ceil(1200 / 400) + 1` = 4 joists, pitch (1200 − 38) / 3 = 387.3 mm |
| Floor bending | `8 × 6.0 × (19² / 6) × 990,000 / 387.3²` = 19,058 N = 1,295 kg; less 40 inside | **1,255 kg** |
| Joist bending, shear, bearing | ss = 455.5; S = 38 × 89² / 6 = 50,166 mm³ | 2,581 / 1,559 / 3,739 kg |
| **Base rating** | the smallest: floor bending governs | **1,255 kg; 800 kg is 64%** |

And in the app, **PART-001 × 30** (645 kg of brackets in a 2176 × 936 mm crate): 3 × 4x6 skids
(4×4 would allow less than 645 kg over a 2.2 m span), 7 2×4 joists (over 450 kg), and "Base
rated 859 kg; this crate's payload is 645 kg (75%) … (skid bending governs)". The default
**PART-001 × 4** (86 kg) keeps 2 × 4×4 skids and no joists, rated 299 kg (29%), with the floor
governing.

**What it doesn't model** (kept simple on purpose; an engineer reviews unusual loads): deflection
(only strength), screw withdrawal and shear at the joints, point loads from a single heavy part
(the payload is taken as spread over the floor), racking of the walls, and the floor or joists
bearing on fork tines between the skids (#8 checks fork entry). The skid support is the
conservative end-supported case even when the crate sits flat on a trailer floor.

### 7.16 Choosing the best quantity (`src/domain/sweep.ts`, #46)

Given a part, the app recommends how many to put in one crate and which crate, without the user
choosing. `sweepQuantities(part, settings, standards, { maxQuantity?, freightRates? })` ignores
`settings.quantity` and, for every quantity per crate `q` from 1 to `SWEEP_MAX_QUANTITY` (**200**,
the quantity setting's maximum):

1. **Monotonic limits, without designing.** `q` over `limits.perCrate.maxParts` (when above 0) fails
   `max-parts`; `q × part mass` over `limits.perCrate.maxGrossKg` fails `max-gross` (the parts alone
   are over it, so every larger `q` is too).
2. **Layouts.** `rankLayouts` for `q`, with those that pass the cheap hard checks (stable, within
   the trailer door and floor, the smallest side gap ≥ `minBlockingGapMm`) moved ahead in their
   usual order. The first `SWEEP_LAYOUTS_PER_QUANTITY` (**3**) are designed.
3. **Hard checks filter first** (`hardFailure`), in this order: `door`, `stable`, `blocking`,
   `base-rating` (each a caution from §7.7), then gross over `maxGrossKg` (`max-gross`) and `q` over
   `maxParts` (`max-parts`). They are never traded for cost.
4. **Score = cost per part moved** = (crate cost + freight cost) ÷ `q`, where crate cost is
   `cost.totalUsd` (wood, screws and labour, §7.12). The cheapest passing layout is the point's
   crate. When none passes, the point is not `ok` and records the first designed layout's failing
   rule (`binding`) and that check's text (`reason`): the curve shows why.

**Freight dollars only from the caller.** `FreightRates` (`FreightRatesSchema`) is a rate sheet:
USD per cwt by NMFC class (`{ "65": 30, … }`) and a per-crate `minimumUsd`. A crate's freight is
`max(minimumUsd, gross lb / 100 × rate)`, billed on gross weight; a class with no rate takes the
next higher class's rate (dearer, so never an under-estimate), else the highest listed. **Without
rates** the sweep's `basis` is `crate-only`: the score is crate cost per part, every `freightUsd`
is null, and the rationale says freight is not priced. The app has no rates (§7.12), so the UI
always shows the crate-only score.

**Recommendation and ties.** The `ok` points sorted by `compareSweepPoints`: the lower score to the
cent per part, then **fewer crates** (the larger `q`), then **denser freight** (lb/ft³). The first
is the recommendation; the first `SWEEP_SHORTLIST_SIZE` (**5**) are the shortlist. Its rationale
names the score and **what stopped a larger crate**: the first failing quantity above it, with its
rule and text (`stoppedBy`), and whether larger passing crates cost more per part (`costLimited`).
With the defaults the sample parts are stopped by the base rating or the 1,000 kg gross limit
(PART-001 upright: 34 per crate, the base rating stops 35).

**Total-quantity mode (`planTotal(sweep, N)`).** For crate counts `c` from `⌈N / maxQuantity⌉` to
`N`, the even split `evenSplit(N, c)` puts `N mod c` crates of `⌈N / c⌉` and the rest of
`⌊N / c⌋`: sizes differ by at most one, so crates × quantity covers N and no crate holds less than
about half the others. A split counts only when every size is `ok` on the curve. The lowest cost
per part wins (crate types' costs × counts, plus freight with rates, ÷ N); ties go to fewer crates
(each `c` has one split, so density never breaks a tie here). Null when no split passes (one part
alone fails a hard check). `planShipment` (§7.10) plans the quantity on screen by the largest
crate that fits; `planTotal` plans a total by cost.

**The sweep and the shipment plan agree.** A quantity and layout from the sweep (the
recommendation or any shortlist entry) given to `planShipment` as the quantity and `layoutKey`
plan as one crate of that quantity on that layout, never a split: `planShipment` honours a picked
layout that is within the limits (§7.10 step 1), and every crate the sweep passes is. Tested for
every sample part × keep-upright, so the Rules tab's **In use**, the PDF's "Recommended" and the
bundle's `-recommended` folder all hold for the applied recommendation.

**Speed:** 30–125 ms per sample part on an M-series Mac (the gross-limit cut-off skips most of
1–200). It runs off the render thread in the engine's Web Worker (`engine.sweep`, §5.1), and on
the server in a worker thread ([QUEUE.md](QUEUE.md)). The test fails above 1.5 s or 400 ×
a fixed CPU loop's time, whichever is larger (load-aware, #48).

**In the UI:** the Rules tab shows the recommendation under "How many parts" (§8.3) with **Use**,
which sets the quantity and the recommended layout. Loading a part does not change the quantity
(it still starts at the first suggested quantity). The recommendation can move once the model's
profile is measured (§7.5b), since shaped blocking changes the crate.

### 7.17 Artifacts and the multi-configuration bundle (`src/engine/artifacts.ts`, #46)

The files a configuration leaves the building with, built by the same engine code in the page and
in Node, so the server's artifact routes (`/jobs/:id/configs/:cid/{crate.glb,spec.pdf,cutlist.csv}`,
`bundle.zip`, later) store exactly the bytes the browser would make. A **configuration** is a
`DesignRequest` (part, settings with the quantity, standards, layout pick, ranking).

**`buildArtifact(kind, request, reader)`** returns `{ kind, bytes, contentType, fileName,
engineVersion, inputHash, sha256 }`. `request` may add `units` (imperial when absent),
`crateIndex`, `generatedAt`, `timeZone`, and a precomputed `sweep` or `plan`. `reader` is the GLB
adapter (§5.1: `urlModelReader` in the browser, `bytesModelReader(bytes)` in Node; null gives the
boards only).

| Kind | File | Content type | Stamp inside |
|---|---|---|---|
| `glb` | `crate-PART-001-x4.glb` (`…-crate-A.glb` for a split batch's type at `crateIndex`) | `model/gltf-binary` | scene `extras` `{ engineVersion, inputHash }` (reads back as the scene's `userData`) |
| `pdf` | `crate-PART-001-x4.pdf`: crate spec, build sheets, labels (§7.11, §7.13), with the quantity section | `application/pdf` | keywords `engineVersion=… inputHash=…` and a footer line on every page |
| `csv` | `crate-PART-001-x4.csv`: the cut list (`…-shipment.csv`, the whole shipment, for a split batch) | `text/csv; charset=utf-8` | `# Engine 0.1.0+engine.2, input …` before the column names |

A GLB or CSV for a request with no crate (§7.9) throws `NoCrateError`; the PDF says why.

**Quantity rationale in the PDF (#26 follow-up).** The engine runs the sweep (§7.16, no freight
rates) for the request's part and rules, and the PDF's **Quantity per crate** section says:
- whether this crate **is the recommendation** (`isRecommended`: one crate type whose quantity and
  layout are the recommendation's) — "Recommended: 34 per crate" — or not — "20 per crate; the
  sweep recommends 34";
- the sweep's rationale (the score in crate cost per part and what limits it);
- **the constraint that stopped a larger crate**: "35 per crate fails the base rating" with the
  failing check's text, or "Nothing up to 200 per crate";
- "Freight: Not priced" (no rates, so no freight dollars), and, while any cost input is the
  shipped placeholder (`costsArePlaceholder(standards)`: wood prices, screw price or labour still
  equal `DEFAULT_STANDARDS`), "Costs use the shipped placeholder … not for a quote".

The `/print` route has no sweep and shows no quantity section.

**`buildMultiBundleZip(configs, reader, { units, generatedAt, timeZone })`** gives one ZIP:

```
crates-PART-001-6-configs.zip
├─ 01-x4/                        the configurations in the order given, duplicates (equal inputHash) once
│  ├─ crate-PART-001-x4.glb      one per crate type of a split batch
│  ├─ crate-PART-001-x4.pdf
│  └─ crate-PART-001-x4.csv      the cut list (…-shipment.csv for a split batch)
├─ 02-x34-recommended/           "-recommended" marks the sweep's recommendation
│  └─ …
├─ comparison.pdf                the comparison summary
└─ manifest.json
```

A configuration with no crate gets its folder with the PDF only. **`manifest.json`**:
`{ kind: "crate-designer/bundle", version: 1, engineVersion, bundleHash, created, units, part:
{ id, name }, costBasis: "crate-only", placeholderCosts, recommendation: { quantity, layoutKey,
crateCostUsdPerPart, rationale, stoppedBy: { quantity, constraint, reason } | null } | null,
configurations: [{ folder, engineVersion, inputHash, quantity, layoutKey, layout, ranking,
recommended, split, crates, perCrate, outsideMm, grossKg, crateCostUsdPerPart, problem, files }],
files }`. Every file entry is `{ path, kind, contentType, bytes, sha256 }`; `files` lists
`comparison.pdf` (the manifest doesn't list itself). `bundleHash` is the SHA-256 of the
configurations' input hashes joined by newlines; it is the comparison PDF's `inputHash`. The ZIP
entries carry `generatedAt`.

**`comparison.pdf`** (`buildComparison` in `src/lib/comparison.ts`, laid out by
`comparisonToPdf`): the part; a table with a row per configuration — folder, quantity per crate
("30 / 20" for a split), crates, outside size and gross (crate A), crate cost per part, and a note
(Recommended; the split; the hard rule a quantity fails, with its reason; or how much more per part
than the recommendation); then **Why this quantity**: the recommendation, its rationale and the
constraint that stopped a larger crate. It always says freight is not priced, and says when costs
are placeholders. **No freight dollar figure appears** in the PDFs or the manifest: the sweep is run
without rates (`costBasis: "crate-only"`).

**On the server (#46 slice 6).** `GET /api/v1/jobs/:id/configs/:cid/{crate.glb,spec.pdf,cutlist.csv}`
and `GET /api/v1/jobs/:id/bundle.zip` call these same builders on the engine's worker threads
(pool tasks `artifact` and `multiBundle`) with the configuration's stored request and the part's
model from blob storage. To make the bytes a function of the inputs alone (content-addressed
keys, one object per key however many requests race), the server writes imperial units, UTC, and
the configuration's own save time as `generatedAt` (a bundle: its newest configuration's). Files
are built on the first request and served from blob storage after; see docs/API.md "Artifacts".

**Download all (browser).** Beside the Export pill (§8.2), an outlined pill **Download all**
builds this ZIP in the page (`useDownloadAll`, `src/state/downloadAll.ts`): `run(configs?)` takes
any plain array of `DesignRequest`s; without one it bundles the design on screen, then the shared
job's saved configurations when it has any (`defaultConfigs`, `savedConfigRequests`: each saved
request's settings, layout, ranking, standards and part design fields on the part on screen, so
each folder keeps the saved `inputHash`), else the sweep's shortlist (`shortlistConfigs(current,
sweepFor(current))`, each shortlist quantity at its layout with the same rules). The Shared job
section's **Download all saved** bundles only the job's configurations. The sweep, PDF, ZIP and GLB code load
with `import()` on the first click; nothing goes to a server. States and timings are the Export
pill's: "Bundling…" with a spinner (at least 1.5 s unless reduced motion), then "Downloaded
crates-PART-001-6-configs.zip" in its own `role="status"` note, or one plain error sentence.

## 8. UI

The design source of truth is `docs/design-handoff/` (`HANDOFF.md` and a runnable prototype).
This section describes what the app implements.

**Who it's for:** the project manager who owns shipping and receiving, deciding how to crate
parts as they are dropped off. The screen answers "what crate do I build for this?" at a glance,
with the 3D view as the main element and detail one click away.

### 8.1 Visual system

Layout, glass and behaviour come from the design handoff. **Colours and type come from
hadrian.co**, read from its live CSS:

- **Colours:**
  - **Ground:** Hadrian navy `#002548`, lifted toward `#13497D` behind the crate, with a vignette.
  - **Text:** white, with soft and muted variants.
  - **Gold `#F3A000`** marks the answer, warnings, the tagline and the cut-list group headers.
  - **Sky blue `#70B8FD`** marks selection (highlighted boards, pinned rows, part dimension
    lines). It is also the floor grid colour, echoing Hadrian's blueprint line art.
  - **Green `#7BD88F`** marks passed checks. The Export pill (#51) is filled with it deepened
    to `#1E7B45` (`--green-fill`; hover `#1A6B3C`), so its white label passes AA (5.3:1), with
    a `--green` border.
- **Glass:** the island, pills and popover use a navy-tinted translucent gradient,
  `blur(16px) saturate(170%)`, a 1 px border, an inset highlight and a drop shadow. Islands
  have a 30 px radius; pills are fully round. The translucency is deliberate; don't make it more
  opaque.
- **Type:** Hadrian uses Klim's **Söhne** family, which is a licensed typeface. The app uses the
  closest open fonts, all through `next/font/google`:

  | Hadrian | Role | Here |
  |---|---|---|
  | Söhne | Display and body; headings at weight 400 with −0.03em tracking | **Inter Tight** |
  | Söhne Breit | Wide uppercase eyebrows (tagline, cut-list groups, the HADRIAN credit) | **Archivo** at `font-stretch: 125%` |
  | Söhne Mono | Measured values, and uppercase button labels | **Geist Mono** |
  | — | Narrow label under the signature | **Archivo** at `font-stretch: 62%` |
  | — | Credit signature | **Mrs Saint Delafield** |

  To use real Söhne, license it and point `--font-sans`, `--font-wide` and the mono variable at
  `next/font/local` in `src/app/layout.tsx`.
- The values (tokens) are in `src/app/globals.css`; the rest of the look is in each component's CSS module.
- **App icons (#58):** the mark is a white gear with an isometric crate in it: navy `#0C2548`
  sides and a gold `#D9A938` lid. The supplied artwork is used as is; regenerate it from the
  master SVG rather than editing the rasters.
  - `src/app/icon.svg` is the master (64 × 64 viewBox) and has no dark-mode variant. The white
    gear reads on dark tab bars; on white ones the navy and gold crate carries the mark.
  - The rasters (`src/app/favicon.ico` at 16/32/48, `icon1.png` at 96, `apple-icon.png` at 180
    and the manifest's 192 and 512 PNGs) match the SVG. They are transparent and fill the canvas
    edge to edge by choice (no padding), so iOS shows them on its own background.
  - Next's metadata file conventions generate the `<link rel="icon">` and
    `<link rel="apple-touch-icon">` tags; don't add them by hand.
  - `public/site.webmanifest` ("Crate Designer", short name "Crates", navy theme and
    background) is linked through `metadata.manifest` in `layout.tsx`. Its icons are
    `purpose: "any"`, not `maskable`, because the gear's teeth reach the edge and Android's
    mask (the centre 80% safe zone) would crop them.

### 8.2 Layout

The canvas fills the window. Four regions float above it:

| Region | Contents |
|---|---|
| Top left (no glass) | "Crate Designer", the tagline, then the part as a mono sentence: id · name; material · mass each · crate gross; measured size · model check; then the change note (§8.5a), then the green **Export** pill (#51, §7.13), left-aligned with the lines, with its status note beside it. Unknown parts get inline underlined name, material and mass fields in the same sentence (§8.5) |
| Upper right island (440 px) | Part name + "Load a part"; the turntable part view (170 px); the tabs; the selected tab's panel, which is the only thing that scrolls |
| Bottom left (no glass) | The credit: "HADRIAN × Eric White", with the name as a solid cursive signature tilted 6° up from the left (`Credit.tsx`), and "Interview Candidate" in narrow Archivo beneath, letter-spaced with SVG `textLength` to span exactly the signature's on-screen width (measured after the script font loads).  |
| Bottom right view bar | Pin bar (when pinned), mode icon, units (mm kg / in lb; in lb by default, remembered per browser, §4), View popover, Hide panels |

- **Crate centring:** the crate is centred in the area the overlays leave free, not in the
  window. `DesignerShell` measures the island and sets the insets. `Director` shifts the projection with `camera.setViewOffset` and
  fits the bounding sphere into the free rectangle (insets: left 40, top 96, right = island width
  + 56, bottom 130 px). Hide panels fades out everything except the "Show panels" pill and the
  credit, and keeps only the bottom inset so the crate clears the credit. The hidden panels are
  `visibility: hidden` after the fade (not just transparent), so their controls are out of the
  tab order and the accessibility tree.
- **981–1180 px:** as desktop, with the tagline hidden and a 420 px island.
- **Narrow screens (below 980 px, #42):** the scene stays full-bleed and the island becomes a
  drawer. `DesignerShell` switches on `matchMedia("(max-width: 980px)")`; the CSS is the
  matching `max-width: 980px` block in each module and in `designer.css` (`globals.css` lists every breakpoint).
  - **Scene:** the canvas fills the screen; `html` and `body` are `100dvh` with `overflow: hidden`,
    so the page never scrolls (`designer.css`). The viewport is `viewport-fit=cover` (`layout.tsx`) and the
    overlays keep clear of notches with `env(safe-area-inset-*)`.
  - **Header** (top left): the title at 24 px without the tagline, and the part sentence at
    11.5 px. Lines wrap between phrases, not inside a value: "crate gross 304 lb" is one
    unbreakable group, and under 430 px "crate" is visually dropped (still read by screen
    readers) so material, mass and gross share a line (#62). The header's change note floats
    under it on one line with an ellipsis (full text in its `title`), so it doesn't move the
    framing. The **Export pill** (#51) stays in the header under the part lines, 44 px tall,
    rather than moving into the drawer: it is one tap away without opening anything, it belongs
    to the part and crate the header describes, and the top inset is measured, so the crate
    moves down to make room. Its status note sits beside it, or wraps under it. **Download all**
    (§7.17), an outlined pill of the same shape, sits after it in the same row.
  - **Hamburger** (top right, 48 px, "Crate details"): opens the drawer. It has `aria-expanded`
    and `aria-controls="island"`.
  - **Drawer:** the island, full height at the right edge, `min(88vw, 440px)` wide, over a
    scrim. It is a `dialog` with `aria-modal` and is `inert` while closed. Opening it moves
    focus to its close button, Tab and Shift+Tab cycle inside it, and closing it (close button,
    scrim, or Escape) returns focus to the hamburger. Escape closes the drawer before it clears
    a pin. It slides in over 0.28 s, and just appears with `prefers-reduced-motion`. Inside: part
    name, Load a part and close, the part view (130 px; 84 px on screens under 560 px tall),
    the tabs, the panel (the only thing that scrolls), then the credit at half size (hidden on
    short screens). `drawerOpen` in the store is separate from `panelsHidden`.
  - **Foot:** the **summary chip** (always the width of the foot, outside size and gross
    weight in amber, with thousands separators, the size shortening before it can touch the weight; for a split batch, "Crate A outside" with the shown type's size and
    "Gross, 7 crates" with the shipment's gross; tapping it opens the drawer on Overview; it flashes with the Overview on an
    edit), then the compact view bar: mode icon, units and View; no Hide panels. From 600 px
    wide (tablets, phones in landscape) the chip and the bar share one row. The View popover
    opens above the whole foot, right-aligned (never over the summary chip), is at most `100vw − 24px` wide and scrolls inside when
    the screen is short. Its gesture hint names pinch and two-finger drag on touch screens.
  - **Touch targets** are at least 44 px: hamburger, close, Load a part, tabs, panel buttons,
    the bar's controls and the popover's switches. Inside the panels (#62), under the 980 px
    breakpoint or with a coarse pointer, every button, number and text field, summary and the
    Rules sliders (44 px tall, larger thumb), quantity stepper and switch (hit area padded to
    44 px) have at least 44 px hit targets; the desktop look is unchanged.
  - **Tap a board:** pins its row and switches to Cut list as on desktop (§8.4), and the shell
    opens the drawer at that row. Closing it keeps the pin and its pin bar.
  - **Idle auto-play** holds while the drawer is open (§8.4).
  - **Insets:** left and right 12 px; top is the header's bottom + 8 px and bottom is the foot's
    height + 8 px, both measured (ResizeObserver), so the crate and its size labels sit between
    the header and the summary. `Director`'s fit already takes the tighter of width and height,
    which in portrait is the width.
  - **Crossing 980 px** (a resize or rotation): going wide closes the drawer, so it is never
    left open behind the desktop island; going narrow turns Hide panels off, because the
    narrow layout has no "Show panels" pill.

### 8.3 Tabs

| Tab | Contents |
|---|---|
| **Overview** (default) | For a split batch (#25), first a **Shipment** block: "Ships as 6 × crate A (30 each) + 1 × crate B (20)", the parts, total outside volume and gross, why it is split, and the **crate type picker** (Crate A / Crate B, with count × parts), then "Crate A: 30 × part" and "6 of these". Otherwise "Crate for N × part" (the part name as typed, as the documents print it); the outside size in amber; the other-unit size; then the **verdict** (a green "All checks clear", or an amber "1 caution: parts are not restrained" button with its title, "2 cautions: a and b", "3 cautions: a and 2 more", that opens Checks); volume and gross. Then the **Scorecard** (#17, §7.12): crate cost (material + labour), build time and the labour rate, the estimated freight class with the density (lb/ft³, or kg/m³ in metric), dimensional weight with the divisor and the gross; after the first export since the last edit, "Designed in 1 m 12 s" beside the heading. For a split, the Shipment block (not the scorecard) carries the whole shipment's cost, labour and dimensional weight next to its parts, volume and gross. A chain: Parts → Layout → Walls and lid → Base → Blocking → Gross weight (last dot amber). Crate weight by assembly as bars; hovering a bar highlights that assembly in 3D. Then **Saved designs** (#14, §9): this part's saved designs, newest first (name, date, quantity, outside size, gross, notes), each with **Use**, **Rename** and **Delete** (undo for 8 s); **Save design** (name, optional notes) and **Copy share link** (the link also shows in a field, in case the clipboard is blocked); **Export library** / **Import library**. Works the same inside the narrow-screen drawer, with 44 px targets |
| **Layouts** | The `explainLayout` sentence. A **Rank by** toggle (Volume / Crate cost / Freight class, #17, §7.2; the store's `ranking`, kept across edits, not saved). Cards with a top-view and side-view SVG drawing, a grid description, outside size, orientation, volume, a cost-and-freight line (the recommended card: "$254 to build · class 65 · 29.8 lb/ft³"; the others against it: "+$26 · same class 65 · −2.2 lb/ft³", dearer and higher class in red, cheaper and lower in green; `scoreLayouts` designs only the cards on screen) and a volume bar. Badges: "recommended" and "may tip". First 4 shown, then "Show all N layouts". "Use the recommended layout" link when the user has picked another |
| **Cut list** | Grouped by assembly. Piece, stock, cut, qty (Piece never wraps and Stock gives way; the Qty column keeps its own right padding and never wraps; the cut wraps between its dimensions, so Qty is always fully inside the panel, #62). When the panel is narrower than 380 px (a phone's drawer) each row stacks (container query on `.panel`): piece and stock on one line, cut (with its unit) and "× qty" on the next, so nothing scrolls sideways and the heading row stays for screen readers only. Each row's first cell holds a real `<button aria-pressed>` (the keyboard and screen-reader control); hover or focus highlights the row, the row click (mouse) or the button (Enter / Space) pins. The hint reads "Point at a row… Click it…" with a mouse and "Tap a row…" where there is no hover. Two pieces of one name and different sizes ("Shaped block") are lettered A, B by size in the cut list (`tellApart` in `bom.ts`; the boards keep their `label` and `variant`). Totals for plywood, lumber and screws. Download and Copy (CSV), Download design (.json), and **Print / save PDF** (#26), which opens the export document (§7.11) in a new tab with its print dialog. For a split batch: **This crate** / **Whole shipment**; this crate shows the picker and the type on screen (`…-crate-A.csv`); whole shipment lists every crate's pieces (`shipmentBom`, rows not linked to 3D, `…-shipment.csv`) |
| **Rules** | Quantity (− / input / + and the part's suggested quantities), then the **best quantity** hint (#46, §7.16: "Best: 34 per crate", the rationale with the constraint that stopped a larger crate, and **Use**, which sets that quantity and layout; "In use" when they are on screen; dimmed while a rule change waits to be swept), keep upright, most layers (1–4), gap between parts and clearance to walls (0–150 mm sliders), wall and lid plywood (Auto / 12 / 15 / 19), Reset rules (keeps quantity) |
| **Checks** | Every check, cautions first, with a gold count on the tab for cautions and a neutral count for info-level notes (each read out as "N cautions" / "N notes") |

Quantity lives in Rules, as the handoff asks. Whether that buries the main input is still an
open question for the user (see #20).

### 8.3a Tabs, focus and the panel

- **Tabs** follow the WAI-ARIA tabs pattern: a `role="tablist"` of `role="tab"` buttons with ids, `aria-controls` the one `role="tabpanel"`, which has `aria-labelledby` its tab. One tab stop (roving `tabindex`): Left / Right move and select (wrapping), Home / End go to the first / last.
- **Panel:** on desktop the island has one height (the viewport less 120 px, at most 800 px) on every tab, so switching tabs never resizes it. A 22 px mask fades the top edge of the panel's content, only while it is scrolled (`data-scrolled`, set from the scroll handler without re-rendering).
- **Saved designs:** after Save, Rename, Cancel or Delete the focus goes to a control that still exists (Save design, the row's Rename, the section heading). The status region holds text only; Undo is a button beside it. A storage failure from `remove`, `undoRemove` or `save` is shown. "Reused" is said only when the design is on screen.
- **Shop standards:** a validation error is `role="alert"` with the domain's plain message (`parseStandards` returns `path` and `message` beside `error`); a standards file that can't be read, and a failed download, say so in the live status.
- **Numbers:** one formatter per quantity in `lib/units.ts`. Masses use `weight` (one decimal under 100, whole from 100, thousands separators: "13,518 lb"; `weightFromLb` for freight weights). Plywood and sections are labelled by `plywoodLabel` / `sectionLabel` in `lib/lumber.ts`. Times like "2 h 59 m" use `.tight` (word spacing) so the monospace gaps don't read as columns.

### 8.4 3D behaviour

- **Modes:**
  - **closed:** everything on.
  - **open:** the lid and front wall fade out.
  - **exploded:** walls move out 320 mm, the lid moves up 420 mm.
  - The mode icon steps closed → open → exploded. The View popover has camera presets (3D, Top,
    Front, End), switches for lid, front wall, blocking, parts and size labels, and a
    continuous Pull apart slider. A mix that matches no mode shows the "custom" icon.
- **View popover placement and surface:** on desktop it opens over the canvas with its right
  edge 16 px left of the island, so it never covers the scorecard; on narrow screens above the
  foot. Its surface is near-opaque (0.97 / 0.98), as is the drawer's, so the crate's colours don't
  show through the blur. It closes on Escape (focus returns to View), a press outside, or focus
  leaving it; `aria-controls` is set only while it exists.
- **Load messages (`LoadToast`):** one glass toast under the part header on every layout, never
  loose text over the floor. A note ("Design loaded…", "Reopened. …") is a polite `role="status"`
  region and goes after 9 s; an error is `role="alert"`, has a gold edge and stays until
  dismissed or the next load. Both have a dismiss button.
- **Export specs:** only the header's Export pill (§7.13) exports; the View popover has no export
  button (#77 added one, removed in #62). The zip's `crate-{part id}-x{quantity}.glb` (#27) is built from the
  design data in a fresh three.js scene (`src/lib/exportGlb.ts`), never from the live viewer, so
  it is always the assembled crate: no explode offsets, fades, ghosting or highlight colours.
  - **Units and frame:** metres, Z up, like the input GLBs (§4).
  - **Origin (#81):** the `Crate` node is offset so the assembled crate's bounding-box centre is
    the file's origin (`crateCentreMm`). Viewers orbit about the origin, so the crate turns about
    its own middle; before, the origin was the inside corner of the floor and the crate swung
    around an empty point. The parts move with it, because they are children of `Crate`.
  - **Node tree:** `Crate` → `Base`, `Side walls`, `End walls`, `Lid`, `Inside the crate`
    (empty assemblies are left out), each holding one box mesh per board named
    `{label} {n}`, numbered per label across the crate (e.g. `Side rail 3`); then, with parts,
    `Parts` → `Part 1` … `Part N`, placed with the same transform as `PartInstances`
    (re-centre, `mmPerUnit` scale, slot centre, `orientation.euler`).
  - **Materials:** one per board kind, named `Wood {kind}` and coloured as `WOOD` in
    `scene.ts`; parts get `Part steel` or `Part aluminum`.
  - The part model is loaded with `GLTFLoader` and cached per URL. Exported with three's
    `GLTFExporter` (`binary: true`).
- **Framing per mode:** each mode has its own camera distance, as a fraction of the distance
  that just fits the whole scene (`MODE_ZOOM` in `framing.ts`): closed 0.68, open 0.8,
  exploded 1.0. Hide panels moves in a further ×0.82. Mode changes re-frame, so idle auto-play
  glides in and out with the modes.
- **Framing maths:** `framing.ts` holds it as pure functions (`fitGoal`, `keepInView`,
  `viewOffset`, `keepCrateInFreeArea`), unit-tested; `Director` only applies the result and eases to it.
- **Room for the size labels and fork arrows:** with size labels on, the fit also projects what
  must stay on screen (`keepInView`): the crate's three label anchors (moved out with the walls),
  each taken as about 88 × 28 px, and the tail of each fork arrow, which stands out past them
  and slides out with the end walls. It backs the camera off just enough that every one sits
  inside the free area. This only ever zooms out, so it changes nothing when they already fit
  (the default crate); it keeps a long crate's end labels from landing under the island (#43)
  and, exploded on a 360 px phone, the arrows from being clipped at the edge.
- **Panning:** the main canvas pans by right-drag (Ctrl- or Shift-drag also work, as three's
  OrbitControls defines them) and, on touch, a two-finger drag, which is also the pinch zoom.
  - **Bounded in screen terms:** once the view is panned, every controls `change` projects the
    assembled crate's outside box and, if it has strayed out of the free area (the window minus the
    insets), moves the camera and orbit target together, sideways in the view, just far enough to
    bring it back (`keepCrateInFreeArea`, `panShift`). A box that fits the free area must stay
    inside it give or take 2 % (`PAN_TOLERANCE`, under 20 px beside the island); one bigger than it (close zoom) keeps its middle
    within the middle half. So no pan puts the crate under the island, the header block or off
    screen. An unpanned view is never touched, so orbiting doesn't drift it.
  - **Deliberate input:** a pan is a `pointerdown`/`touchstart` plus a drag, so it stops idle
    auto-play like any drag, and clears the camera preset.
  - **Re-centring:** the view stays panned until the next fit: a rule or quantity change, a mode
    change, a camera preset (View > 3D is the "reset view"), Hide / Show panels, or a resize.
    When idle auto-play starts on a panned view it first eases the target back to the crate's
    middle (keeping the turn angle and zoom), so the turn is about the crate and the crate stays
    in the free area.
  - **Hint:** the View popover's last line names the gestures ("Drag to turn, scroll to zoom,
    right-drag to pan.", or the pinch and two-finger wording on touch screens), and the View
    button's `title` says it too. Nothing floats over the stage. The view has no keyboard
    controls, so none are added.
- **First framing:** OrbitControls registers as the default controls one render after
  `Director` first frames the crate. `Director` keeps the orbit target it placed and hands it to
  the controls when they arrive, so the camera orbits the crate's middle from the first frame
  (#43).
- **Continuous transitions:** `Director` eases `anim.explode`, `anim.lidAlpha` and
  `anim.frontAlpha` toward the store's targets: rate 10 /s for user changes, 1.5 /s during idle
  auto-play. `CrateModel` writes position and opacity each frame.
- **Opacity:** `setOpacity` (`scene.ts`) moves a material between the opaque and transparent
  passes and recompiles it, because three bakes an `OPAQUE` define into opaque shaders.
- **Idle auto-play:**
  - After **5 s** (6 s until #64, shortened at the user's request) with no deliberate input
    anywhere, the camera turns at
    **0.18 rad/s** (slowed from the handoff's 0.3 at the user's request) and steps closed → exploded → open → exploded → …, half a turn per mode. The
    next mode starts 0.12 turn early so it lands as the half-turn completes.
  - **Deliberate input** (#64) stops it at once and restarts the idle timer: `pointerdown` (a
    click or tap), a drag (`pointermove` with a button held, so orbiting the crate or grabbing
    the part view), `wheel`, `keydown` and `touchstart`, listened for on `window` in
    `DesignerShell` and classified by `isDeliberateInput` (`src/state/motion.ts`).
  - **Hovering is not input:** a `pointermove` with no button held, over empty canvas, a board
    or the island (cut-list rows, weight bars), neither stops nor delays it. It still holds
    while a row is pinned (pinning is a click), during an orbit drag, or while the narrow-screen
    drawer is open (#42), and resumes from the mode on screen. It runs on first load.
  - **Hover while turning:** r3f only picks on pointer events, so while auto-play turns the
    crate under a still pointer `Director` re-picks about 10 times a second
    (`events.update()`, only while the pointer is over the canvas). The board tooltip and
    highlight follow the board under the pointer.
  - With `prefers-reduced-motion` it never runs, and mode changes and camera moves are instant.
- **Centre of gravity and fork entry (#8):** shown with the size labels (the View popover's
  "Size labels" switch), by `HandlingMarks`:
  - **CoG, only when it matters (#87):** shown only when the `cog-offset` or `cog-tip` check is a
    caution; a centred, low CoG gets no 3D marker (the label and Checks still give it). It is
    drawn as a real crate marking: a flat ISO 7000-0627 quartered circle stencilled on each of
    the four outside faces, at `design.handling.cogMm` projected onto that face (along the
    face and at the CoG's height), 3 mm off the boards. The stencils are depth-tested, so only
    the faces turned to the camera show them, and each moves out with its wall when exploded.
  - **Fork entry:** a flat gold arrow on the ground at each end (−X and +X) for every opening
    between the skids (`design.handling.openings`), pointing in. They are depth-tested and slide
    out with the end walls when exploded, as the length line does. The tip stops beyond the
    width size label, which sits on the same centre line (`arrowGapMm`: the label's 110 mm + 5 %
    of the longest side, plus 36 % of that side for the fixed-size pill, plus 90 mm), so the
    arrow and "25.7 in" never overlap, closed or exploded, on a desktop or a phone (#62).
  - **Hidden behind the crate:** an end's arrows drop out (fading, over about 0.3 s) when the
    crate hides most of them from the current camera, so the far arrow never shows as a sliver
    poking out. `forkArrows.ts` samples a 3 × 3 grid over each arrow and tests the segment from the
    camera to each sample against the crate's box (its top drops to the floor as it explodes);
    an end hides above 60 % of its samples hidden and returns below 40 %, so it doesn't flicker
    while the camera turns. It is judged again only when the camera or the explode amount moves.
  - Neither can be hovered or clicked (no raycast) and neither calls `markInput`, so they never
    count as input (#64). The e2e hook reports them as `cog { mm, marker, arrows, arrowsShown,
    endsShown, arrowBox }` (`arrowBox`: the near-end arrow's screen box in CSS px).
- **Size lines:**
  - **Crate:** length along the front bottom edge, width along the right bottom edge, height at
    the back right corner. Their groups slide out with the walls when exploded; the numbers stay
    the assembled size.
  - **Part:** one part (top layer, front row, rightmost) carries ice-blue dimensions in open and
    exploded modes only. Their lines are always built and the group is shown or hidden in the
    frame loop (no geometry is rebuilt as the crate opens). The three sizes share **one** pill
    ("14.2 × 8.7 × 10.2 in") at the middle of the three edges: separate pills a few pixels
    apart overlapped with no leaders (#62 D11). As a guarantee, `DimensionLines` also runs
    `separatePills` each frame: the pills are placed in priority order (length, width, height,
    part) and a later one steps up or down, the shorter way, until it clears the earlier ones, so
    on a phone, where the crate is small, the part's pill gives way to the height pill rather than
    overlap it.
  - **Straight-on presets:** Top, Front and End leave out the crate dimension whose axis points at
    the camera (height, width, length), whose line collapses or reads as a plan dimension
    (`hiddenAxis`). Its label, lines and photons go with it; they return on any other view.
  - Lines are drei `<Line>` without depth testing.
  - **Photon pulse (#65):** an ambient animation on the lines.
    - **What it does:** about every **10 s**, a small glowing photon leaves each visible label
      in both directions and runs along its dimension line. Where that line meets a witness line,
      it splits both ways: one copy runs toward the crate corner, the other out to the tick end.
      Each photon fades at the end of its segment, so none turns back along a line it has already
      travelled.
    - **Paths:** `dimensionPulse.ts` is pure and unit-tested. It turns each dimension into a
      small graph:
      - The graph holds the dimension line and the witness lines that touch its ends. It leaves
        out other dimension lines, so the width photon doesn't climb the height line.
      - Nodes sit at segment ends, at junctions and at the label anchor.
      - A breadth-first walk from the anchor gives the photon legs, each with its path distance
        at both ends.
      - Counts: a crate dimension makes 6 legs and 4 ends; a part dimension makes 2 legs and 2
        ends.
    - **Timing:** the first pulse comes **2 s** after the size lines mount (the crate first
      frames), then one every 10 s. Each pulse takes **1.35 s** from emerging to the last fade.
      - Within one dimension, the head moves at a single speed along every branch, eased in and
        out (sine).
      - Every dimension takes the same time, so short and long ones look alike.
      - **All dimensions pulse together:** one quiet beat instead of a sweep that pulls the eye
        round the crate. (A per-dimension stagger was built, used at 0 and removed.)
      - The clock advances by the frame delta, capped at 0.1 s like `Director`.
    - **Look:** colours as the lines (`#e6eef7` crate, `#70b8fd` part).
      - Each photon is a soft dot with a white-hot core and a tail of 10% of the dimension line.
      - It uses additive blending and no depth test.
      - The lines brighten (opacity 0.65 → 0.9 → 0.65) over the pulse.
    - **Rendering:** one `Points` with a small shader per line group (`PhotonLayer`), added to
      that group, so photons follow explode, rotation and modes.
      - `DimensionLines` updates them from its single `useFrame`, with no React state per frame.
      - The `Points` is hidden between pulses.
    - **When it runs:** only with size labels on. Part photons run only while the part dimensions
      show (open and exploded).
      - Never with `prefers-reduced-motion`.
      - A hidden tab restarts the clock: the first pulse comes 2 s after return, with no queued
        burst.
      - It never calls `markInput`, so it never stops idle auto-play.
    - **Test hook:** `window.__crate` exposes `pulses` (fired) and `photonsActive` (photons on
      screen in the last frame), from `probeStats` (`viewer/probeStats.ts`): the scene components
      write it behind `NEXT_PUBLIC_E2E`, so normal builds drop the writes, and nothing in the app
      reads it.
  - **Labels** are plain DOM (`SizeLabels`), positioned each frame by projecting their anchors.
    Their text is derived from the design, units and view (`buildLines(...).labels`); the store's
    `labels` / `setLabels` are no longer used.
    drei `<Html>` is not used anywhere: each `<Html>` mounts its own React root, and unmounting
    those during a render raced in React 19.
- **Picking and highlight:**
  - **Hover a board:** a glass tooltip (piece, stock, cut, quantity) and an ice-blue highlight
    of its cut-list group. Boards under 50% opacity can't be picked; the pointer passes through
    to what is behind.
  - **Click a board:** pins its group, opens Cut list and scrolls to the row. A pin bar
    ("Showing N × piece", "Show everything") appears.
  - **Clear the pin:** Escape, clicking empty space, or "Show everything".
  - **Focus:** while a row is pinned, or a row or weight bar is hovered, everything else draws at
    7% (boards) or 10% (parts) opacity.
- **A lost WebGL context (#62 D4):** `CrateViewer` listens for `webglcontextlost` /
  `webglcontextrestored` on the canvas (cancelling the loss, so the browser may restore it). While
  lost, a navy cover with "The 3D view stopped." and a **Bring back the 3D view** button replaces
  the blank canvas (a lost canvas paints white, leaving the header unreadable). The context
  returning removes the cover; the button builds a fresh canvas (new context). Tested by forcing
  the loss with the `WEBGL_lose_context` extension.
- **The canvas stays mounted** through a problem state and while the last design is restoring
  (only the scene's contents come and go, and the message is an overlay), so the WebGL context is
  created once. `Director` re-frames when the scene returns. Part models: when the part changes,
  `CrateViewer` clears the old model's entry from drei's `useGLTF` cache. The blob URL itself is
  not revoked (the last-design loader still fetches it), and the old model's geometry and
  textures are not disposed on the GPU: a full fix needs a model registry that owns the object
  URLs and disposes the scene when the part is replaced.
- **Part view:** a second `<Canvas>` in the island turns the part at 0.25 rad/s (slowed from
  the handoff's 0.45 and reversed, at the user's request). The turn is driven from frame time in
  `useFrame`, not OrbitControls' `autoRotate`, which steps per frame and runs double speed at
  120 Hz. Dragging stops
  it (hovering doesn't, #64); it resumes from the same angle after the shared 5 s idle. Double-click resets tilt and
  zoom.
- **Floor:** a line grid of 500 mm squares (1 ft in imperial) reaching at least 5 m (or 3× the
  crate's longest side) from the crate, fading with distance from the crate rather than the
  camera, so it stays visible at every zoom and angle. drei's `<Grid>` was dropped because it
  fades by camera distance and vanished once the camera framed the crate. A warm light pool
  (a small shader) sits under the crate.

### 8.5 Loading a part

- PART-001 is preloaded at quantity 4. There is no part switcher.
- **Load a part** (file picker) or a drop anywhere loads a new part; a full-page veil shows while
  dragging.
- Dropping a `parts.json` alongside the GLB merges its valid entries into the lookup first.
- **A design file** (JSON with `"kind": "crate-design"`, §6.5) restores its part, rules and
  layout instead. A custom part's GLB goes in the same pick or drop; without it, the message
  says which file to add.
- **A known GLB** (file name equals a catalog `model`) takes that entry's mass, material and
  quantities, and gets the model check.
- **An unknown GLB** gets a name from its file name, no material, and a 10 kg stand-in mass. The
  part header shows editable **name**, **material** (with suggestions: 6061-T6 aluminum, 4140
  steel, 304 stainless steel, or any text) and **mass** fields, and a caution stays until a real
  mass is entered (§6.2a).
- **Rejected files:** text `.gltf`, Draco- or Meshopt-compressed files, and non-GLB data (bad
  magic, version or chunk lengths), each with a plain message (`GLB_MESSAGES`, `domain/glb.ts`).
  The upload API (`POST /api/v1/parts`, #46) gives the same messages and also refuses files over
  50 MB (`MAX_GLB_BYTES`); see `docs/BLOB_STORAGE.md`.
- Files are read through `URL.createObjectURL`, so nothing is uploaded anywhere.
- **A saved design** (Overview → Saved designs → Use, #14) and **a share link** open through
  the same path as a design file (`loadDesign`), so the §6.5 restore notes apply. A reused
  custom design takes the GLB already loaded (its key matches, §9).

**The part header (#40).** It reads as a sentence, not a form:

```
gearbox-cover · Gearbox cover
6061-T6 aluminum · 14.71 kg each · crate gross 20 kg
435 × 445 × 254 mm · size measured from the file
```

- **Fields are text with an underline:** no border, background or radius; they inherit the line's
  mono font. A 1 px `--hair` underline, brighter on hover; on focus a 1.5 px sky underline and
  white text (no outline box). Each field is sized to its value (`field-sizing: content`, with a
  `ch` width from `fieldWidthCh` where that isn't supported) between a minimum and maximum.
- **States, not by colour alone:** solid underline = a value; **dashed** = empty (muted italic
  placeholder: "add material", "enter mass") or a stand-in. While the mass is the stand-in, its
  underline is dashed gold with a dashed gold "stand-in" tag after the unit (this replaces the
  old warning sentence; the field's `aria-describedby` reads the full hint). Invalid text gets a
  solid gold underline, `aria-invalid`, and a one-line reason under the sentence, linked by
  `aria-describedby`.
- **Keyboard:** Tab order name → material → mass. Typing only drafts; **Enter** commits, **Escape**
  reverts, blur commits valid text and reverts invalid text to the last valid value. On the mass,
  **↑ / ↓** step 0.1 of the shown unit (Shift: 1) and commit at once.
- **Mass units:** the field shows kg, or lb (to 2 decimals) with imperial units, and accepts an
  optional trailing unit and a comma decimal mark. Lb converts to kg on commit; the store keeps kg.
  ↑ / ↓ step in the shown unit so the field never jumps by a conversion remainder.
- **Material** keeps its datalist suggestions, without the dropdown arrow.
- **Catalog parts** show the same sentence as plain text, without fields or underlines.
- **Crate gross** follows the mass on every part, in the selected units (#39).
- Narrow screens: the lines wrap; fields stay underlined.

### 8.5a Showing the effect of an edit (#39)

An edit can recalculate the crate without anything visible moving (a 1 mm part at 10 → 14.71 kg
keeps the minimum crate), so every edit gets feedback from **one diff**:

- **`diffDesigns(prev, next)`** (`src/domain/diff.ts`, pure) returns the changed fields with old and
  new values in domain units: gross, tare and payload (kg, compared to the gram), outside size,
  wall plywood, floor, skid section and count, and the layout grid. It returns `[]` when either side
  has no design.
- **`lastChange`** in the store: `{ id, at, source, changes }`, set when an input changes the design:
  `setPartDetails` (source `name`, `material` or `mass`), `setSettings` / `resetRules` (`rules`)
  and `setLayoutKey` (`layout`). Loading a part, a units change, or a design that became a problem
  doesn't set one. It clears after `CHANGE_NOTE_MS` (5 s).
- **The note** (`ChangeNote`, `role="status"`) shows a short summary of the outcome
  (`changeSummary`, #62), in the selected units:
  - the outside size changed: "Crate grew: 2176 × 936 × 831 mm, 878 kg" (or "shrank"; a mix of
    longer and lower is judged by the enclosed volume), with the new gross when it moved;
  - only the weights moved: "Crate heavier: 20 kg" (or "lighter");
  - one other change: its own detail, which is already short ("Wall plywood 1/2″ → 5/8″");
  - several other changes: "Crate changed: wall plywood, floor, +1 more";
  - nothing visible: "No change to the crate".

  The full before → after (`changeNote`: every change, "Gross 135 → 878 kg, outside 932 × 652 ×
  497 → 2176 × 936 × 831 mm, …") is the note's `title` (hover) and a visually hidden
  ("`.sr-only`") ". Details: …" for screen readers. Changes that format the same in the selected
  units are dropped (`visibleChanges`), so it never says "16 → 16 kg". The header's and the
  island's notes are one line with an ellipsis (`white-space: nowrap`); the header's stops short
  of the island on desktop. The note sits under the header for part edits and over the foot of
  the island's part view for rules and layout edits (its pill takes the pointer so the title
  shows). It fades over its last 1.5 s.
- **Highlights** (`Flash`): changed values in the header gross and the Overview (outside size,
  gross, payload, layout grid, wall plywood, skids, floor, empty crate) flash gold for 1.2 s.
- **`prefers-reduced-motion`:** no flash and no fade; the note still shows, then goes.

## 9. Persistence

**Shop standards** (§6.4) are saved in `localStorage` under `crate-designer.shop-standards.v1`
(`src/state/standardsStorage.ts`), as the same JSON envelope as the download. Every
`setStandards` / `resetStandards` saves; the defaults are saved as no entry, so a later change
to the shipped defaults reaches users who never customised them. `SavedStateLoader` applies the
saved standards in an effect after the first render, so the server render and the first client
render match; the design then re-computes once. Loading is safe: unreadable JSON, another
version or an invalid value falls back to the defaults with a `console.warn`, and storage that
is missing or throws (server, private mode, quota) is treated as empty. The version is in the
key, so an incompatible future format starts fresh rather than misreading old data.

All four saved items (standards, units, library, last design) go through `src/state/persist.ts`
with one contract: a save never throws and returns `true` only if the value is stored, so a
missing store (server, blocked) is a failed save. Standards and units save inside their
`useDesigner` actions, the library inside `useLibrary`, and the last design from a debounced
subscriber in `lastDesignLoader.ts`. The library shows the "browser refused to store it"
message when a save, rename, delete (`remove(...).saveError`) or undo fails to store.

**Display units** (#15) are saved under `crate-designer.units.v1` (`src/state/unitsStorage.ts`)
as `"imperial"` or `"metric"` on every `setUnits`. Either choice is saved, so a later change of
default doesn't flip anyone. The store starts on `DEFAULT_UNITS` (imperial), and
`SavedStateLoader` applies the saved units after mount, like the standards, so there is no
hydration mismatch. Nothing saved, an unknown value (with a `console.warn`) or storage that
throws keeps the default.

**The design library** (#14) is saved under `crate-designer.design-library.v1`
(`src/state/libraryStorage.ts`, logic in `src/domain/designLibrary.ts`), so a repeat part gets
the same proven crate in one click:

```jsonc
{
  "kind": "crate-design-library",
  "version": 1,                       // LIBRARY_VERSION, also in the storage key
  "entries": [{
    "id": "4f0c…",                    // crypto.randomUUID()
    "name": "Bracket × 8, two layers", // required, up to 80 characters
    "notes": "Proven on the March order", // optional, up to 1,000
    "savedAt": "2026-11-16T12:00:00.000Z",
    "partKey": "catalog:PART-001:PART-001-machined-steel-bracket.glb",
    "design": { "kind": "crate-design", "schemaVersion": 1, … } // the §6.5 design file, as is
  }]
}
```

- **Part identity** (`partKey`): a catalog part is its id and model; a custom part is its model
  file name and its size rounded to 1 mm (`custom:widget_v2.glb:412x288x141`). A custom part's
  name, material and mass are editable, so they are not part of the key. The key is recomputed
  from `design.part` on every read, so an edited key can't misfile an entry.
- **Listing:** the Overview lists the entries whose key matches the part on screen, newest first.
- **Reuse** goes through `loadDesign` (§6.5), the same path as a picked design file. For a
  custom part the GLB already loaded is passed along (read back from its object URL).
- **Safe load:** the envelope must be right (kind, a version from 1 up to `LIBRARY_VERSION`, an
  entries list); otherwise the library starts empty with a `console.warn`. Then each entry is
  checked on its own, its design through `parseDesignFile` (so design-file versions and
  migrations apply), and a bad entry or a repeated id is skipped with a warning while the rest
  load. Storage that is missing or throws counts as empty; a refused save (quota) keeps the
  change for the session and says so. An empty library is stored as no entry.
- **Library file:** **Export library** downloads the same envelope as
  `crate-design-library.json`; **Import library** merges one, skipping ids already saved and
  bad entries, and says how many were added and skipped. This is how designs move between
  machines until there are accounts.
- Like the standards, the library is read in `SavedStateLoader` after mount (`useLibrary`, its
  own small store, separate from the designer's).

**Share links** (#14, `src/domain/shareLink.ts`): **Copy share link** puts the design on screen
in the URL as `#design=<base64url>`: the design file (§6.5) as compact JSON, UTF-8, base64url
without padding (about 1 KB of URL). It is in the hash, so it is never sent to a server or
written to a server log.

- **Opening** (`openShareLink`, after the saved standards are applied so the design is rebuilt
  with them, and again on `hashchange`): the hash is read through `readShareHash`, which decodes
  it and validates it with `parseDesignFile`. A catalog part restores fully through
  `loadDesign`, with the §6.5 notes.
- **A custom part** can't travel in a URL, because its GLB is a local file. The message names
  it , the design waits, and loading a GLB with that file name opens it. The copy status
  warns the sender too. The message reads "This link needs widget_v2.glb. Load it (or drop it
  here) to open the 1 × Widget design." (an error: it stays until dismissed).
- **A damaged or tampered link** (bad base64, cut short, not JSON, wrong kind, a newer version,
  out-of-range settings) changes nothing: on first load the default crate stays, and the load
  row says why ("That share link is damaged or incomplete. The default crate is shown.").
- **Tidy URL:** the hash is removed with `history.replaceState` as soon as it is read, so the
  address bar is clean and a reload doesn't re-open the link over later edits.

**The last-opened crate** (#71) is saved under `crate-designer.last-design.v1`
(`src/state/lastDesignStorage.ts`, wired in `src/components/shell/lastDesignLoader.ts`), so a
refresh or a reopened tab brings back the crate on screen:

```jsonc
{
  "kind": "crate-designer.last-design",
  "version": 1,                       // LAST_DESIGN_VERSION, also in the key
  "tab": "layouts",                   // the open tab
  "ranking": "cost",                  // the #17 ranking
  "design": { "kind": "crate-design", "schemaVersion": 1, … } // the §6.5 design file, as is
}
```

- **Saving:** every change to the part, rules, layout, crate type, ranking or tab schedules a
  save, written `LAST_DESIGN_SAVE_DELAY_MS` (400 ms) after the changes stop, so typing in a field
  doesn't write on each key. A pending save is written at once when the page is hidden
  (`pagehide`, `visibilitychange`), so a quick reload keeps the last edit. A state with no crate
  (a `DesignProblem`) isn't saved; the last crate is kept. Saving starts only after the startup
  decision below, so the default crate never overwrites the saved one.
- **A custom part's GLB** lives only as an object URL, which dies on reload, so its bytes are
  kept in **IndexedDB** (`src/state/glbCache.ts`: database `crate-designer`, store `glb`, one
  record under the key `last`: `{ name, bytes: ArrayBuffer, savedAt }`). Whenever a part with a
  `blob:` model that isn't a bundled catalog part comes on screen (picked or dropped, reused from
  the library, a shared custom design), its bytes are read back from the object URL and replace
  the record. Files over `MAX_CACHED_GLB_BYTES` (50 MB) aren't kept, and the older record is
  dropped. Catalog parts need nothing kept: they restore from the bundled catalog.
- **Load precedence** (`startupSource`, in `SavedStateLoader` after the saved units, standards
  and library are applied, so the crate is rebuilt with them): (1) a share link in the URL wins,
  even a damaged one (which says the default crate is shown); (2) else the last-opened crate;
  (3) else the default part. A share link that opens is saved as the last-opened crate.
- **Reopening** goes through `loadDesign` (§6.5), the same path as a design file. A custom part
  uses the kept GLB when its name matches the saved `model`. When it doesn't (never kept, over
  the cap, IndexedDB unavailable), the default part opens, the load row says "Load widget.glb
  to reopen your last crate (2 × Widget).", and loading that file reopens the design (the pending
  design of a shared custom link). The §6.5 notes (layout no longer fits, different size) show
  as "Reopened. …"; otherwise the reopen is silent.
- **One startup:** the source is decided once per page load (`src/state/startup.ts`), so React
  StrictMode's second effect run in development can't restore the saved crate over a share link
  that the first run already opened (it removed the hash). Every load (picked, dropped, library,
  link, reopen) takes a ticket (`loadSequence.ts`); only the latest outcome is applied, so a slow
  GLB parse can't overwrite a later quick load. Production builds run effects once, so the e2e
  suite cannot cover the StrictMode case; `startup.test.ts` does.
- **Safe load:** an entry that isn't JSON, has the wrong kind or version, an unknown tab or
  ranking, or a design that fails `parseDesignFile` (bad settings, newer format) is ignored with
  a `console.warn` and the default part opens. So does a design that no longer makes a crate, a
  kept GLB that can't be read, or any error on the way. `localStorage` or IndexedDB that is
  missing, blocked or full is treated as empty and a refused save is a warning, never an error.
- **No flash and no hydration mismatch:** the restore runs in an effect after mount. While it
  runs, the store's `restoring` flag holds the 3D scene back (`CrateViewer` keeps the canvas and
  draws nothing in it), so
  the default crate doesn't flash before the remembered one.
- **Time to design (#17):** a reopened crate isn't newly designed, so `restoreDesign` leaves the
  clock stopped (`designStartedAt` null): no "Designed in" note appears for it, and an export
  records nothing. Loading a new part or design (any `setPart` / `loadDesign`) starts the clock
  as usual. When nothing is reopened (the default part, a share link, a failed restore), the
  clock starts at mount as before.
- **Starting fresh:** there is no "clear" control. Loading another part, design file, library
  design or share link replaces the remembered crate, because whatever is on screen is saved.

**Next: Postgres (#46).** Everything else lives in memory. The shared store is Postgres in
Docker, reached only from the server through `src/server/db/` (drizzle on postgres.js), with GLBs
and generated files in S3-compatible blob storage. Slice 1 is in: the compose file, migrations
in `db/migrations/`, the first tables (`org`, `part`, `part_model`, `design_job`,
`configuration`, `artifact`, `event`, `shop_standard`, `idempotency_key`), each scoped by
`org_id`, and an org-scoped repository that refuses any query without an `OrgContext`. Slice 2
adds live events: an `event` row written in the same transaction as the change NOTIFYs channel
`crate_events`, one LISTEN connection per process fans out to `GET /api/v1/events?job=…` (SSE,
resumable with `Last-Event-ID`), and `GET /api/v1/health` pings the database. Slice 5 adds the
jobs and configurations API (`docs/API.md`): when a part loads, the app opens (or reuses) a job for
it on the server and lists the job's saved configurations; **Save to job** posts the crate on
screen, which the server recomputes with the engine before storing, and other tabs see it through
the job's events. When the server or database can't be reached, saves wait on the device (below) and
everything else works as before; the browser storage above is still what reopens a crate after a
reload. See `docs/POSTGRES.md`. Slice 1a adds the blob store (`src/server/blob/`), part uploads
through `POST /api/v1/parts` and presigned model downloads: see `docs/BLOB_STORAGE.md`. (The
earlier SQLite WASM plan, `DATA_STORE.md`, was dropped for this.)

**Offline saves (#46 slice 7a).** Saves to the shared job are local first: each is written to
`localStorage` under `crate-designer.pending-changes.v1` (`src/state/pendingChanges.ts`, behind a
`PendingStore` interface) before any network call, with a client-generated id that the server
takes as its `Idempotency-Key`, and sent oldest first once the server is reachable (its event
stream open, or `GET /api/v1/health` answering; the probe backs off to at most 3 s). Until then
the Shared job section marks them **Not synced yet** and says they exist only on this device. The
last 5 opened jobs (about 1 MB of JSON) are kept under `crate-designer.job-cache.v1`
(`src/state/jobCache.ts`), so a job opened once can be reopened and saved to with the server
stopped. Version conflicts and results an earlier engine made are kept for the user to resolve,
never dropped. Like everything else here, every read and write is wrapped and a refused write is
reported, not thrown. `docs/API.md` "Offline" has the details.

The ranking option (#17) is saved only as part of the last-opened crate; the time-to-design clock is in memory only.

### 9.1 Capacity of saves and live events (#46)

Measured with `bun run load` (`docs/LOAD_TEST.md`, which has the method, the full tables and the
machine: one `next start` process on an M1 Max laptop, Postgres 18 in Docker Desktop, the load
generator on the same machine). One org, so load is varied by jobs: a save is delivered to every
stream open on its job, so the work is *saves/s × streams per job*. Limits are the highest stage
with p95 save → other tabs under 1 s and no errors.

| Limit, one process | `DB_POOL_MAX` 10 (default) | `DB_POOL_MAX` 30 |
|---|---|---|
| Saves per second (few streams) | ~60 (p95 389 ms; 70/s: 2 s) | ~100 (p95 528 ms) |
| Events delivered per second, all streams | ~1000–1200 (500 streams × 50/s: p95 745 ms) | ~2500 (1000 streams × 50/s: p95 328 ms) |
| Open SSE streams | 4000 tested at 411 deliveries/s: p95 133 ms; streams cost little until events flow | — |
| Postgres connections | pool + 1 listener, independent of the number of streams | same |
| Tab A → tab B (save to the event on the other tab) | idle p95 67 ms (target < 1 s); its snapshot re-read p95 129 ms | — |

- **Nothing was lost at any load.** Every expected delivery arrived in every stage, saturated
  ones included; `pg_notification_queue_usage()` stayed at ~0.
- **The limit is the Node event loop and the pool**, not Postgres: the engine recompute (~15 ms)
  runs on the request thread inside the save's transaction, and each delivery is one
  `listForStream` query per stream. Moving the recompute to a worker thread, coalescing the reads
  per job, and a larger pool raise both ceilings; then add instances.
- **The event-ordering lock** (`EVENT_ORDER_LOCK`) caps event-writing commits at ~220–330/s per
  database (vs 400–1000/s without it, `bun run load:lock`), about 4× the per-process save ceiling.
  Under overload it amplifies queueing, because loop lag delays the COMMIT that releases it.
- **Move to a dedicated broker** (swap the `EventBus` implementation) when, sustained and after
  those fixes, event-writing transactions exceed ~200/s across all instances, advisory-lock
  waiters average more than 1 while the app isn't CPU-bound, the NOTIFY queue stays above 1 %, or
  the deployment needs more than ~20 instances or several regions. A broker doesn't raise the
  per-process limits above.
- `GET /api/v1/health` reports the process's event-loop lag and utilisation (`eventLoop`) for
  watching this in production.

## 10. Invariants and tests

`bun run test` runs vitest over `src/**/*.test.ts`, in Node; a file can ask for jsdom with a
`// @vitest-environment jsdom` first line.

**The engine (`src/engine/*.test.ts`, §5.1)** checks: SHA-256 against the FIPS vectors and Web
Crypto at every padding length; canonical JSON (key order, `-0`, refusals); `inputHash` is stable
across key order, ignores the model URL and load facts, and changes with every design input,
including a part outline; `designShipment` equals `planShipment` and survives a structured clone
(the worker trip); the schemas accept the engine's own requests and responses and reject a
damaged outline; `cutList` equals the Cut list tab's CSV; in Node, a sample GLB is read from its
bytes, the crate GLB reads back at its outside size, and the whole Export ZIP is built with no
browser or server. **Parity:** the same sample parts × suggested quantities in Node and jsdom
match one baseline (summary, `inputHash`, plan hash, CSVs). `src/state/engineClient.test.ts`
covers the in-thread fallback, latest-wins and falling back when the worker fails;
`store.worker.test.ts` covers the store with a worker: an edit shows at once, its design lands
with `designedFrom`, quick edits build on each other, a crate type waits for its plan, and the
`restoring` hold waits for the reopened design.

**Artifacts (`src/engine/artifacts.node.test.ts`, `artifacts.jsdom.test.ts`, §7.17):** in Node,
for each sample part at its recommended quantity and layout, with `bytesModelReader`, every
artifact kind is built and stamped (`sha256` matches the bytes); the GLB reloads with `parseGlb`,
carries the stamp in `userData`, holds every part, and its crate is the outside size within 1 mm on
each axis; the PDF holds the hash, the quantity line (recommended, or "the sweep recommends") and
the constraint that stopped a larger crate; the CSV has its stamp line. The same PDF input and time
give the same bytes. The multi-configuration bundle (PART-002, current design plus shortlist and a
duplicate) has a folder per unique configuration with GLB, PDF and CSV, a manifest whose sizes and
hashes match the ZIP's files and whose input hashes match the engine's, one recommended folder, and
a comparison PDF with every folder, the rationale and constraint, "Freight is not priced", the
placeholder note and no freight dollars. **CSV parity:** Node and jsdom both match
`__snapshots__/artifacts-csv.txt` (the engine version replaced by `<engine>`).
`src/state/downloadAll.test.ts` checks the default configurations and that `run` takes any array.
`files.test.ts` checks the stamp in each file of the Export package; `standards.test.ts` checks
`costsArePlaceholder`.

**`src/domain/domain.test.ts`** checks:

- `parts.json` parses, and its ids are stable.
- The 6 orientations give 6 distinct permutations, and upright ones keep Z.
- For every part × suggested quantity:
  - exactly `quantity` slots are produced
  - every slot lies inside the interior
  - gross weight is greater than payload
- No two slots overlap.
- The shaft lies along X (cell X = 1530), with `L ≥ W` and a stable result.
- The bounding box of all members equals `layout.external`.
- `maxLayers: 1` produces only single-layer layouts.
- A part that isn't in the catalog can be designed.
- **Regression baseline:** 18 part × quantity × keepUpright cases. For each, the external size,
  gross, screws, member count, layout count and total BOM quantity must equal the values captured
  before the #20 redesign. For example, PART-003 × 8 is 1102 × 1082 × 809 mm with 308 screws.
  The six PART-002 rows were deliberately re-captured by #6 (cradles, §7.5a): same outside size
  and layouts, gross 76.25 / 120.44 / 193.08 → 70.61 / 109.30 / 180.15 kg, screws 200 / 226 /
  268 → 208 / 228 / 272, members 40 / 45 / 53 → 40 / 42 / 46 (× 1 / 2 / 4). PART-001 and
  PART-003 did not change.
- **Cradles (#6, `cradles.test.ts`):** `isSlender` picks PART-002 and not PART-001 or PART-003,
  at exactly the ratio, in any side order, and follows the standard; a flat plate isn't
  slender; a shaft stood on end keeps the general blocking. Stations: 150 mm from each end,
  ≤ 600 mm apart, at least 2, a third one exactly past 900 mm, a short part's two don't meet.
  Notches: a round seat of the part's radius, 25% deep, opening = the chord; a flat pocket as
  wide as the part; the depth follows the standard. In the shaft crate: only cradles and end
  stops inside; 4 cradles wall to wall under one shaft, top at the part's bottom + notch depth;
  one notch per shaft side by side; stacking cradles at the same stations, notched both ways,
  clear of the floor cradles, no separator; end stops from the floor to the top of the stack;
  everything inside the crate; a part along Y turns the cradles; a flat bar gets a flat
  pocket. Cut-list lines (with notch counts), 4 screws per cradle, "End stops", one lumber cut
  per notch, and the blocking check's text. The profile is counter-clockwise, inside the box
  and cut to the notch; `cradleSolidAt` is shorter through a notch. `cradleGeometry.test.ts`:
  the 3D solid fills the member box, centred, and is cut to the notch bottom.
  `printable.test.ts`: floor cradles in "Load the parts" with the notch size, stacking cradles
  and end stops in "Blocking and separators", pieces and screws still add up, and both
  sections draw the cradles (Section B–B cut down to the notch).
- Every member has an assembly, a face and a label, and each face sits on the correct side of the
  interior.
- The cut list has the finer labels, every member links to exactly one line, and line quantities
  match.
- Tare by assembly sums to tare.
- Checks report passes as well as cautions, and the stack check appears only for stacked
  layouts.
- No sample part × suggested quantity reports an `export` (ISPM-15) check.
- **Trailer limits:** a single custom part sized so the crate is exactly at, then 1 mm over, the
  53' dry van length, door width and door height gives `door` ok, then caution. `oversize`
  appears only past 2438 mm. Every sample part × suggested quantity passes both.
- **Cardboard:** a single PART-003 triggers `cardboard` and still gets a crate; no other sample
  part × suggested quantity does. The per-part and payload limits are inclusive, and a light
  but long part whose interior L + W + H is over 1905 mm doesn't trigger it.
- `explainLayout` covers `only`, the recommended layout and a user pick.

**`src/domain/hardening.test.ts`** checks edge cases and bad input (#10):

- Quantity 1 and 200 for every part, `keepUpright` on and off, `maxLayers` 1–4: every part is
  packed, the crate is sound, and the median of 5 runs of each design is under 50 ms (a median,
  so one run stalled by a busy machine doesn't fail it; #48).
- Parts of 1 mm, 0.001 mm, a 1 mm × 10 m rod and a 10 m cube, at gaps of 0 and 50: a sound crate
  with an interior of at least 178 mm. A tiny part is centred in the padded crate.
- "Sound" means: the boards' bounds equal `layout.external`, no board has zero size, dunnage stays
  inside the interior, slots lie inside the interior, and weight and screws are finite.
- Zero, negative, NaN and infinite dimensions, parts over 20 m, and bad masses each return the
  right `problem` with no design.
- Zero gap and clearance: no dunnage, no zero-size board or cut-list entry, and the blocking
  caution.
- The `blocking` check reads the drawn crate's gaps (#36): a padded 10 mm part with a 0 mm
  clearance setting passes; a 10 mm part gap or a 5 mm clearance is a caution naming that gap;
  one part per layer ignores the part gap. Bearers stay inside the walls under a narrow part.
- `normalizeSettings` clamps, rounds, rejects bad values field by field, ignores unknown keys and
  always returns settings the schema accepts. `settingsAdjustments` reports each clamp, round
  and rejection, and `clampNote` words it. Invalid settings passed straight to `computeDesign`
  return a `settings` problem.
- Across a grid of extreme sizes and settings there is always a layout, and `design` is null
  exactly when `problem` is set.

**`src/domain/standards.test.ts`** checks the shop standards (#19):

- `DEFAULT_STANDARDS` passes the schema, holds the pre-#19 values field by field, is frozen, and
  the old exports (`MIN_INTERIOR_MM`, `DRY_VAN_53FT_MM`, …, `DEFAULT_SETTINGS`) are views of it.
- The schema rejects negative, NaN and wrong-type values, a default gap outside the settings
  range, a fractional layer count, panels or thresholds out of order, a door bigger than the
  trailer, blocking wider than two cleats and a tiny cleat spacing. Deep merge leaves the base
  untouched and ignores `__proto__`.
- `computeDesign` with custom standards: passing the defaults equals passing nothing; a lower
  light-panel threshold gives 15 mm panels; plywood on hand (18 mm) shows in the cut list; a
  lower heavy-skid threshold gives 4×6 skids; a plywood rate change changes only the cost, by
  exactly the plywood volume × the rate change; a density change changes the weights; weak
  lumber (#7), a lower stack limit, trailer length or LTL length flips `base-rating`, `stack`, `door`
  and `oversize`; a wider minimum blocking gap removes the posts; tighter cleat and screw
  spacing add uprights and screws; a wider skid spacing uses fewer skids; a bigger cleat grows
  the wall allowance and the minimum interior; the stability ratio and volume tolerance change
  the `stable` check, the ranking and `explainLayout`; invalid standards passed straight in
  return a `standards` problem.
- The JSON file round-trips, a partial file is filled from the defaults, and bad JSON, an array,
  another version and an invalid value are rejected with a message.

**`src/state/standards.store.test.ts`** checks persistence (round-trip under the versioned key,
nothing stored for the defaults, fallback with one warning for bad JSON, an invalid value or
another version, throwing storage, no `window`) and the store actions (a rate re-designs the
cost, a threshold changes the panel, an invalid patch changes nothing, a changed default gap
reaches the current rules and Reset rules, `resetStandards`, standards kept across other input).

**`src/domain/partDetails.test.ts`** checks the entered-details path: names and materials are
tidied, a blank material clears it, a blank or overlong name, an overlong material and a mass
that isn't a positive number are rejected, `partFinish` maps "alum" text to aluminum and
everything else to steel, and the CSV header carries the entered name, material and mass.

**`src/domain/shipment.test.ts`** checks shipment planning (§7.10, #25): every sample part ×
suggested quantity × keep-upright is one crate equal to `computeDesign` (and keeps a layout
pick); a problem passes through; 200 brackets split within 1,000 kg with at most one smaller
remainder and correct totals; one crate fewer would be over a limit for every sample part; a
part-count limit splits evenly (8 → 2 × 4) or with a remainder (10 → 2 × 4 + 1 × 2); volumes that
tie prefer the even split; a batch too big for a smaller trailer splits with every crate
passing `door`; a layout that fits the door is recommended over a smaller one that doesn't; a
lower max gross gives more crates; a layout pick applies to its crate type; split crates get the
`crate-limit` check and single crates don't; a part over the limit alone ships one per crate with
a caution; 200 parts plan fast; the shipment cut list multiplies, merges and groups pieces, and
its CSV has the plan header.

**`src/domain/structure.test.ts`** checks structural sizing (§7.15, #7): each formula (skid
bending, shear and bearing; floor bending, falling with the span squared; joist bending, shear
and bearing) against a hand calculation; the load shares (half on two skids, `1 / (n − 1)` on an
inner skid); the worked example step by step; the skid section kept exactly at its limit and
upgraded just over it; a skid added when no section passes, never past the 200 mm fork opening;
`ok: false` with the most skids of the heaviest section when nothing passes; heavy skids above
the heavy-skid payload; joists not at 450 kg and at 450.01 kg; joists for a floor that fails
over widely spaced skids; joists closed up until every check passes, and one fewer failing; the
nominal lid when crates aren't stacked; a lid sized for 50 kg and for 500 kg (joists on edge), its
check text, its 70 mm taller crate, and a caution when it can't be done; PART-001 × 30's joists
(members, cut list, bounding box, screw lines) and its exact base-rating text; the dead-load
estimate never below the drawn crate's weight for every sample part × suggested quantity (and 30)
× keep-upright; every sample part at its suggested quantities on the nominal base; the per-crate
limit as the smaller of the gross limit and the rating; a split decided by the rating (weaker
lumber, no gross limit) with every crate within it, and stronger lumber giving fewer crates; and
the PART-001 × 200 split unchanged. **`standards.test.ts`** also checks the structure defaults,
rejects a load factor under 1, a zero or NaN stress, a negative stacking load, a tiny joist
spacing and a paper-thin joist, shows weaker plywood lowering the rating and weak stock turning
the check into a caution, and loads a standards file saved before #7 (its `baseRatingKg` is
dropped).

**`src/domain/handling.test.ts`** checks the centre of gravity and handling (#8, §7.14): the
mass-weighted mean; boards weighed by volume × density at their centres; parts at their box
centres; a symmetric crate (PART-001 × 4, PART-003 × 8, PART-002 × 2) with its CoG on both centre
lines; the combined CoG as the tare- and payload-weighted mean of the two groups; an offset load
(the same crate with its last part left out) moving the CoG toward the left end and the front by
exactly the missing moment; the frame (height above the bottom of the skids). Fork openings read
from the skid members (three skids, two openings; a board hung under the floor lowers one), and
the design's one opening as wide as the crate less two skids and as tall as a skid. Tine
placement: both tines in one opening, refused under the smallest spread, one per opening across a
middle skid, refused when the CoG can't be between them. The checks: the default crate's texts and
levels (pallet jack info), their order after `base-rating`, the offset threshold at 10% (and a
looser standard), the 30° tip threshold and the tip angle to the nearest base edge, a pallet jack
needing 90 mm against 89 mm skids (caution: "Pallet jack: enters from the ends, 89 mm clear under
the floor, needs 90 mm."), both devices passing PART-003 × 8's middle skid, both cautions for the
narrow single shaft, and heavy 4×6 skids giving 140 mm. `offsetText` wording. The standards'
defaults and the spread validation.

**`src/domain/cost.test.ts`** checks cost, labour and freight (#17, §7.12): the labour sum (cuts by
material, set-ups once per size across assemblies, screws, steps, handling) and the labour
standards; wood + screws + labour; outside inches rounded up (914.4 mm is exactly 36 in), volume,
dimensional weight rounded up to the lb (139 in³ is 1 lb, 140 is 2) with the standard's divisor;
every NMFC bracket edge (1 → 300, just under 2 → 300, 2 → 250, …, 22.49 → 70, 22.5 → 65, 49.99 → 55,
50 → 50) and class 400 for zero, negative and non-numbers; the PART-001 × 4 worked example value
for value; a labour-rate change moves only labour and total, a screw price only fasteners; more
layers add steps; standards saved before #17 load with the new defaults. The ranking option:
volume returns the layouts untouched (and `computeDesign` equals today's for every sample
part); cost picks the cheapest stable, blocked crate; density picks the lowest class, then the
lightest, and avoids the LTL length charge (PART-003 × 30); no unstable layout ranks above a
stable one; `explainLayout` says `ranked`; a split keeps its crate counts and per-crate limits
under the cost ranking. Shipment totals sum cost, labour and dim weight. **`standards.test.ts`**
also rejects a negative or over-$1,000 labour rate, NaN or negative minutes, an hour per screw,
a negative screw cost and a dim divisor outside 50–500. **`src/state/scorecard.store.test.ts`**
checks `ranking` (default volume; `setRanking` resets the pick, is kept across edits and
standards changes) and a labour-rate change re-costing the design, and the time-to-design
clock (no record before it starts, starts once, records only the first export, restarts on a
new part). **`src/lib/format.test.ts`** checks the scorecard text.

**`src/state/shipment.store.test.ts`** checks the store: one crate at start, 200 brackets show
crate A, `setCrateIndex` switches `result` (clearing the pin, re-framing, no change note, out of
range ignored), the type is kept across edits while it exists, a lower max gross re-plans, and
`loadDesign` opens the saved type.

**`src/domain/designFile.test.ts`** checks the design file (§6.5, #28):

- The written file has the kind, version, app, part, settings, layout key and summary
  (PART-001 × 4: 932 × 652 × 497 mm), is pretty-printed, and round-trips byte for byte.
- `parseDesignFile` rejects bad JSON, a non-design, a newer or missing version, a bad field
  (named in the message), out-of-range settings, a non-GLB model and an unknown source, and
  drops unknown keys.
- **Reproduction:** for every catalog part × suggested quantity × keep-upright, with the
  recommended and the runner-up layout, save → parse → restore gives no notes, the same layout,
  outside size and gross, and a byte-identical CSV cut list. A custom part does the same.
- A split batch records `summary.shipment` (single-crate files are unchanged), re-opens to the
  same plan and crate type with no notes, and with other standards notes the changed plan.
- A layout key that no longer exists falls back to the recommended layout with a note; a
  heavier catalog part or a changed summary gives a note with the new and saved values (typed
  messages, rendered here with `metricText`).
- Format 2: the ranking and the part outline are written; a format 1 file migrates (ranking
  `volume`, `shapeUnknown`).

**`src/domain/envelope.test.ts`** checks the versioned-envelope reader: a current document, every
migration from the file's version up, each refusal in the format's own words (not JSON, wrong
kind, no or fractional version, newer version, missing migration), a renamed version field, the
writer's trailing newline and `hasKind`.

**`src/lib/shapedRoundTrip.test.ts`** checks that one design file gives one crate everywhere
(§6.5): the profile packs and unpacks exactly for the three catalog parts; a damaged outline is
refused; share and print links stay under 4,000 characters (about 1.5 KB for the bracket and the
shaft, 3.5 KB for the housing, against 0.8 KB without the outline); reopening from the file
gives the saved layout, gross and cut list with no notes; the print shows the same gross, cut
list pieces and screws as the app; without the outline the bracket loses its 12 shaped blocks; a
format 1 file opens and says plainly why totals may differ (no "Gross is now"); a remaining
difference is worded in the selected units; cost and density rankings travel with the file and
explain the winner in the print model (and a hand pick still says so).

**`src/domain/designLibrary.test.ts`** checks the design library (#14): part keys (catalog by id
and model; custom by file name and rounded size, unaffected by name and mass), trimmed names and
a required name, rename / remove / restore in place, per-part listing newest first, the
versioned envelope round trip, refusal of bad JSON, another kind, a newer version or no entries,
skipping bad entries (a bad design names its field) and repeated ids, a recomputed part key, and
merging an import without duplicates.

**`src/domain/shareLink.test.ts`** checks share links: base64url round trips (empty, padding
lengths, non-ASCII) and rejects bad input; a design round-trips through `#design=…` (with or
without `#`), a custom part with non-ASCII text too; `shareUrl` keeps the query and puts the
design in the hash; a hash without a design is ignored; damaged, truncated and tampered links
(out-of-range quantity, wrong kind, newer version, not an object) are refused.

**`src/state/persist.test.ts`** checks `readJson` (missing, no store or throwing store give the
fallback silently; a rejected or throwing parser warns), `writeJson` (store, remove for null,
false for no store or a throwing store) and that all four save functions return false for null
and throwing storage. Its fixtures (`src/state/fixtures/*.json`) are the stored text of the
shop standards, library and last design, and the bare units word, under the four unchanged keys:
they must keep loading (the standards fixture must also write back byte for byte).

**`src/state/checks.test.ts`** checks `modelMatchesCatalog` (null without a size or measurement;
the 1 mm tolerance per axis) and `allChecks` (model ok / caution / info notes, the stand-in mass
caution, cautions-first sorting, domain checks left untouched).

**`src/state/library.store.test.ts`** checks the library's storage (versioned key; empty when
nothing is saved and nothing stored when empty; unreadable JSON, another kind or a newer version
fall back to empty with one warning; good entries survive bad ones; throwing storage; a failed
save with null or throwing storage) and the store reporting the storage-failed message from
save, rename, remove and undo, and
`useLibrary` (save and reload, per-part listing, a required name, rename, delete and undo saving
each time, export and import with duplicates and bad entries counted).

**`src/components/viewer/framing.test.ts`** checks the camera framing: the mode zoom, preset
angles, that every size label and fork arrow tail projects inside the free area (desktop, 390 and
360 px phones, closed, open and exploded), the pan bound and the angle helpers.
**`src/components/viewer/sizeLines.test.ts`** checks the size-line geometry, the one part pill,
the dimension left out per preset and the label text. **`src/components/viewer/forkArrows.test.ts`**
checks the arrow size and the occlusion test with its hysteresis.
**`src/components/viewer/tooltipText.test.ts`** checks the board tooltip's detail line.
**`src/components/viewer/dimensionPulse.test.ts`** checks the photon paths (#65, §8.4) on
PART-001 × 4: one pulse per label (L, W, H, then the part's three); each crate dimension gives 6
legs and 4 ends (two legs leave the anchor in opposite directions, each splits in two at its
witness line, ending at both crate corners and both tick ends); the width photon never runs up the
height line nor the height photon along the width line; each part line gives 2 legs and 2 ends;
leg times are path distances over the longest path (furthest end at 1). The 10 s clock fires
first at 2 s then every 10 s, never while off, restarts when back on, and a 60 s frame gap
(hidden tab) queues nothing.

**`src/state/lastDesignStorage.test.ts`** checks the last-opened crate (#71): the versioned
key and envelope round trip, the entry built from the store (null without a crate), nothing
saved or blocked storage giving null, nine kinds of bad or old data each ignored with a warning,
a refused save, the load precedence (share link, even a damaged one, then the last crate, then
the default) and the debounced saver (one write of the latest value; flush and cancel).
**`src/state/glbCache.test.ts`** checks the IndexedDB wrapper with `fake-indexeddb`: one record
(the last saved), the 50 MB cap (not kept, the older record dropped), bad records ignored with a
warning, and IndexedDB missing or throwing. **`src/state/lastDesignLoader.test.ts`**
reopens a catalog crate with its rules, layout, tab and ranking and the clock stopped (an export
records nothing; a new part starts it), and without the custom part's kept GLB (or with a
damaged one) keeps the default part, naming the file and holding the design until it is loaded.

**`src/lib/currentDesign.test.ts`** checks that the design on screen (PART-001 × 4) is written as
a design file that survives a share-link round trip and restores with no notes, and gives null
without a crate.

**`src/state/store.test.ts`** checks `setPartDetails`: name and material update without
changing the layout pick or re-framing, a mass recomputes the payload and clears the stand-in
flag, invalid input changes nothing, and catalog parts are read-only. `loadDesign` keeps the
given settings and layout pick (unlike `setPart`). It also checks
`lastChange`: cleared by loading a part; a mass edit on a 1 mm part records gross 16 → 20 kg and
payload with source `mass`; name and material edits record an empty diff; rules and layout edits
record theirs; a units change doesn't; and a design that becomes a problem leaves nothing.
`setPartProfile` (#16) shapes the blocking without moving the layout pick or the camera, ignores
a profile for another model or a failed analysis, drops a pin or hover on a cut-list line that is
gone, survives a mass edit and is dropped with a new
part.

**`src/domain/profile.test.ts`** checks shaped blocking (#16, §7.5b) with synthetic profiles: the
rotation matrix equals three.js's for all six orientations, and a part lying on its side shows
its +Z face on the crate's −Y side; a box-shaped profile reproduces the bounding-box blocking
exactly for every non-slender sample part × suggested quantity (contact 1, free 0); an L-shaped
side (set back 60 mm above half height) gets one shaped block in the notch, 60 deep, starting
half a cell above the step, for 100% contact (bounding box 88%) and the check text says so; a
post moves off a window through the part to just past it; a recess deeper than 100 mm gets no
block; blocks on neighbouring sides never overlap; a profile of the wrong size falls back to
identical members and checks; the shaft lying flat keeps its cradles (the profile changes
nothing) while the shaft stood on end gets shaped blocking; and without a profile PART-003 × 8 is
unchanged ("24 blocking posts … The smallest gap is 50 mm, between parts.").

**`src/lib/partProfile.test.ts`** builds profiles from the sample GLBs in Node (three's
`GLTFLoader.parse`), so the numbers are deterministic: PART-003 is 435 × 445 × 254 mm on a 4.5 mm
grid, with depths 0 at the base plate, 26 mm to the end wall, −1 above the walls, 72.5 mm to the
side wall, 0 at the boss and 219 mm down through the open top; PART-001's upright is 38 mm in;
the shaft's grid is 15.5 mm. Each sample part is analysed in under 200 ms. An empty model or an
exhausted time budget throws; `scheduleProfile` reports a failure as null and can be cancelled.
**PART-003 × 8 with its profile:** the same layout and outside size, contact 10% → 63%, free
movement [65, 5] → [0, 0] mm, 44 shaped blocks, and the exact `blocking` check text.

**`src/domain/diff.test.ts`** checks `diffDesigns`: equal designs and a missing design give `[]`;
a heavier 1 mm part changes only gross and payload; a heavy load steps up the plywood, skids,
tare and outside size; a quantity change moves the grid and outside size; changes come in
`DESIGN_FIELDS` order; and floating-point noise in weights is not a change.

**`src/lib/partFields.test.ts`** checks the header's field helpers: kg and lb display, parsing
(optional unit, comma decimal, one-line reasons for blank, non-numeric and non-positive text),
lb → kg → lb round trips, ↑ / ↓ steps in either unit with a floor, the fallback width, and the
change note text ("Gross 16 → 20 kg", lb and inch fractions, "+N more", and "No change to the
crate" when the changes round away).

**`src/lib/changes.test.ts`** checks `changeSummary` (#62): grew and shrank with the new gross
in metric and imperial, a mixed move judged by volume, the weight left out when the gross did not
move, a lone small change keeping its detail, heavier and lighter, "Crate changed: …, +N more",
and "No change to the crate".

**`src/lib/message.test.ts`** checks `renderMessage` (#62): metric reads "2,489 mm" and
"1,240 kg", imperial gives "98.0 in", "3 1/2″" and "2,734 lb", messages merge and flatten, and no
check of PART-001/002/003 at quantities 1, 8 and 40 leaves "mm" or "kg" in imperial.
`src/lib/units.test.ts` also pins the one mass rule (one decimal under 100, whole from 100).
**`src/lib/units.test.ts`** checks formatting and 1/16″ fractions, including the edges (0, under
and exactly 1/32″, 15/16″, just under an inch, whole inches, carrying into the next inch) and the
CSV's ` in` mark. **`src/lib/lumber.test.ts`** checks the nominal-name table (1x4, 2x4, 4x4,
4x6, …, either order and 1 mm of rounding, no name for non-stock), plywood by sold thickness with
the fraction fallback, blocking "from 4x4" and the fractional-inch fallback.
**`src/lib/csv.test.ts`** checks the CSV in both units: the imperial header (lb, in, the
units line, `cut_in`), nominal stock, fractional cuts and ASCII only; the metric header and
`cut_mm`; the same rows and quantities in both; and a split shipment in both.
**`src/state/units.store.test.ts`** checks the imperial default, the versioned key round trip,
nothing saved, an unknown value, storage that throws, no window, and `setUnits` /
`loadSavedUnits` in the store. **`src/lib/loadPart.test.ts`**
checks GLB validation (samples accepted; non-GLB, Draco and Meshopt rejected), names from file
names, and filtering a `parts.json`. For design files: catalog vs custom source, a catalog
design restored from the bundled catalog, a custom design without its GLB naming the file,
other JSON still read as a catalog, and plain messages for a bad design or bad JSON.
**`src/domain/glb.test.ts`** checks the shared GLB checks (damaged version, declared length and
chunk bounds; Draco and Meshopt; text glTF sniffing) and the three-free measure through node
transforms; **`src/lib/glbMeasure.parity.test.ts`** checks that measure against three.js's
`Box3.setFromObject` on every bundled GLB. The upload API's integration tests are listed in
`docs/BLOB_STORAGE.md`.

**`src/lib/printable.test.ts`** checks the export document (§7.11):

- For PART-001 × 4: the spec rows; the imperial outside size with the metric size under it;
  the dimensional weight and the lb/ft³ density; the design's freight class; the label's
  centre of gravity from the design's, on the end view mid-width and above the bottom of
  the skids; the fork-arrow openings exactly between the
  skids; why the layout won and the runner-up.
- Every check is listed with Pass / Caution; a 10 mm gap puts the blocking caution first.
- The cut list is grouped once per stock, with piece counts that match the cut list and ft /
  ft² totals.
- The fastener schedule sums to the screw estimate, with spacings in inches.
- The five assembly steps come in order, place every piece once and sum to the screws, with
  separators when the parts are stacked.
- The drawings' sizes equal the outside size, and Section A–A has four parts and blocking. The
  label has the skids.
- Metric text: mm, kg, kg/m³ and `19 × 89 lumber`.
- A split batch (200) has the plan, and one spec, five-step build sheet and label per crate
  type, each with `crate-limit`.
- The print hash round-trips the file (compacted, so the URL is shorter) and the units
  URL-safely, refuses a missing, padded, truncated or damaged hash and still reads the old `d`
  parameter. The document rebuilt from the file equals the one built from the plan.
- Every member of every catalog design (three parts × three quantities × one or two layers) maps
  to an assembly step, every step's pieces sum to the member count and its screws to the
  estimate; `stepOfMember` puts bearers and floor cradles before the parts and the rest after.
- The document date follows the time zone given (23:16 on the 16th in Los Angeles is the 16th,
  not the UTC 17th).

**`src/lib/drawings.test.ts`** checks `crateDrawings` directly: the five drawings in order, the
outside views equal the crate's size with their dimension lines (whole mm, or inches with ″),
every board painted, dashed parts per slot in each section, and for a cradled shaft the cradles
below the plan cut and cut through the notch (only the solid part) in the side section.

**`src/lib/memberBounds.test.ts`** and **`src/lib/format.test.ts`** (`documentDate`) check the
member box and the date in a time zone. **`src/lib/changes.test.ts`** pins the weight rule in
change notes: a detail in whole units, the summary's gross by the mass rule.

**`src/lib/exportBundle.test.ts`** checks the Export pill's package (#51, §7.13) with stand-in
GLB and PDF makers: the stem and zip name (a custom id made file-safe); the file list and names
for one crate, a split batch (200: a GLB and a cut list per type, the shipment cut list, one PDF
with both types) and a custom part; the CSV in imperial and metric; `design.json` parses with
`parseDesignFile` to the same part, quantity and outside size (and the split's shipment, and the
crate type on screen); README.txt names every file, the app version, the date and the units; no
crate is refused; and the zip unzips byte for byte. **`src/lib/exportPdf.test.ts`** makes real
PDFs in Node: they start `%PDF-` and end `%%EOF`, have 5 pages for PART-001 × 4 and 10 for
× 200, carry every section's text (spec headings, freight, layout reason, every check, the
drawing captions, each stock group, the fastener total, the five steps, the label), follow the
units, and `pdfSafe` spells non-WinAnsi characters.

**`src/lib/exportGlb.test.ts`** round-trips the GLB export (#27) for each sample part: export
with `GLTFExporter`, re-load with `GLTFLoader`, and check that the boards' bounds (parts
excluded) equal `layout.external` within 1 mm in metres with X, Y, Z = L, W, H (Z up, no
rotation); the node tree is `Crate` → the non-empty assemblies in build order → `Parts`; there is
one uniquely named mesh per member (`Floor 1`, `Side rail 4`, …) with `Wood …` materials; and
`Part 1…N` match the slot count and sit inside the crate. It also checks that each part's centre
is its slot centre, that parts can be left out, and the file name. Node has no `FileReader`,
which the exporter's binary path uses, so the test installs a minimal one.

When you change packing or construction rules, keep these passing. If a rule change
deliberately changes an expected value, update the test and this spec in the same PR.

### End-to-end UI tests

The suite is opt-in (slow, so not in the pre-commit hook or PR CI): run it locally with `bun run e2e`, or from the manually
triggered `E2E` workflow (`.github/workflows/e2e.yml`, with an optional `filter` input passed to `bun run e2e`).
`bun run e2e` runs Playwright (`playwright.config.ts`, specs in `e2e/`, excluded from vitest). It builds the production app with `NEXT_PUBLIC_E2E=1`, serves it on port 3320 (`E2E_PORT` changes it; a local run reuses
whatever already listens there) and drives headless Chromium with SwiftShader WebGL, so the canvas really
renders. `E2E_SKIP_BUILD=1` serves an existing e2e build. Four projects: desktop 1440 × 900 runs every spec
except `*.narrow.spec.ts` and `*.mobile.spec.ts`; narrow 900 × 900 (the drawer layout with a mouse) runs only
`*.narrow.spec.ts`; mobile-390 (390 × 844) and mobile-360 (360 × 800), both with touch, `isMobile` and 2× pixels,
run only `*.mobile.spec.ts`. Tests run with `prefers-reduced-motion: reduce`, so idle auto-play is off and
transitions are instant (§8.4); the specs that test motion (`idle-autoplay`, `dimension-pulse`, `camera`, `layout`,
`drawer.mobile`, `export-zip`, `change-note`) turn it back on for the test that needs it.

**Running:** software WebGL is CPU-heavy, so locally the suite uses a third of the cores (1 to 3 workers; set
`E2E_WORKERS` to change it) with a 60 s test timeout (`test.slow()` triples it for long flows); the E2E workflow (where `CI` is set) runs one worker
with a 120 s timeout. There are no retries: a test that needs one is flaky and gets fixed. Several worktrees can run at
once if each has its own `E2E_PORT`. `bun run typecheck` and `bun run lint` cover `e2e/` too.

**Screenshots** go only to `e2e/screenshots/` (git-ignored; the E2E workflow uploads it as `e2e-screenshots`, with the HTML
report as `playwright-report`), through one helper, `shot(page | locator, name)`: a page is shot full-page, a locator is cropped.
Names start with the spec's topic (`part-header-standin`), and a run in a project other than desktop adds the project
(`layout-closed-summary-mobile-390`). Generated files (the print PDFs) are attached to the report, not written to disk. No
spec writes into `docs/screenshots/`, so a run never dirties the repo; `bun run e2e:docs-shots` (`scripts/docs-shots.mjs`)
copies chosen shots there on request.

**Conventions for specs:**

- Find things by role, label or text. Where that isn't possible, use a `data-testid` (`size-label`, `check` with
  `data-level`, `cut-piece` / `cut-stock` / `cut-size` / `cut-qty`, `load-toast`, `change-note`, `flash`, `summary`,
  `view-popover`, and others); never a CSS class, because styles move. The two places a computed style is the behaviour under
  test are the plain "4x4" (`font-feature-settings`) and the stand-in / invalid underline styles in `part-header`.
- Prove wiring and behaviour; don't pin what a unit test owns. Read the expected numbers from `window.__crate` (the
  outside size, quantity, CoG) and check the screen shows them in the right format; assert relationships (a doubled rate
  raises the cost, the check's skid count is the cut list's). Keep an exact string only where the string is the contract (the
  zip's file names, a message a user reads, the print title).
- No fixed sleeps. Wait on the probe: `pollCrate(page, (s) => s.frames)`, `waitForFrames(page, n)`, `s.idle`, `s.pulses`. The
  few waits for real elapsed time (the 5 s idle delay, the 9 s toast, the 10 s pulse period) are bounded by `expect.poll`
  timeouts or documented as the quiet period a negative assertion needs.
- Shared locators and flows live in `e2e/helpers/` (`probe`, `locators`, `files`, `stubs`, `layout`, `format`, `shot`); import
  from `./helpers`. A flow another spec needs belongs there, not copied.

- **Test hook:** the 3D scene isn't in the DOM, so `E2EProbe` (`src/components/viewer/`) exposes a read-only
  `window.__crate` with `getState()` (typed as `CrateSnapshot`, so specs are checked at compile time): the mode from the
  view targets, view switches, camera distance, angles and target, pin and hover keys, `anim` values, auto-play, `idle` (no
  deliberate input for `IDLE_MS`), the outside size, problem id, tab, units, quantity (and part id and stand-in mass, all
  from the inputs the shown design was made from, `designedFrom`, §5.1), crate types, frame count, pulses,
  `shapedBlocking`, `profileMs` and the CoG and fork-arrow marks, and `canvasCoverage()` (share of canvas pixels
  drawn). It is loaded only when built with `NEXT_PUBLIC_E2E=1`; `next.config.ts` always inlines the flag (`"0"` when unset),
  so normal builds drop the branch and don't bundle the module.

- **Specs** (a `.narrow` or `.mobile` suffix means that project; the rest run on desktop):
  - `first-load`: PART-001 × 4 loads with the header sentence, "model matches catalog", the heading and a drawn canvas.
  - `island`: each tab's contents (Overview chain and weight bars, Layouts cards, Cut list groups, Rules controls); the tab
    strip is one tab stop with arrows, Home and End and a labelled panel; the scroll fade; one island height on every tab.
  - `rules`: quantity resizes the crate; a typed 500 clamps to 200 with a note; Reset rules keeps the quantity.
  - `units`: imperial by default (header, Overview, size labels, nominal lumber in the Overview, Cut list and CSV); the toggle;
    the mass reads the same in the header and Overview; metric survives a reload.
  - `cut-list` (`.mobile`): hover lights a row, click pins it, Escape clears it; the row is a real toggle button; the Qty
    column is visible in both units; "4x4" keeps a plain x; piece names stay on one line; on a phone each row stacks.
  - `checks`: every check is listed and the default crate has no cautions; check text follows the units; the Overview verdict
    names a caution and links to Checks; the tab counts cautions and notes apart.
  - `load-part`: a catalog GLB fills in its details; an unknown one uses a stand-in mass until entered; `.gltf` and over-20 m
    parts are refused with a message; dragging text doesn't raise the drop veil, a file does.
  - `load-messages`: the toast under the header: an error (alert) stays until dismissed, a note (status) goes by itself;
    both sit clear of the header, island and window edge at desktop and phone sizes.
  - `part-header`: the inline fields (Tab order, Enter commits, the stand-in clears, an invalid value shows its reason, imperial
    entry). `change-note`: the short note, the before → after on hover and for screen readers, the gold flash, "No change to
    the crate", one line at quantity 200.
  - `view-controls`: the mode icon, the first framing, camera presets, the switches and Pull apart, Hide panels. `view-popover`
    (`.mobile`): placement, nothing covering it, closing by Escape, focus-out and a press outside, the gesture hint.
  - `size-labels`: labels stay in the free area for every sample part and mode. `viewer` (`.mobile`): which labels each camera
    shows, the part pill, fork-arrow hiding, the arrow clear of the width label, a lost WebGL context.
  - `camera` (`.mobile`): right-drag and two-finger pan, bounded so the crate can't be lost; a preset or the idle turn returns
    to the middle. `layout` (`.narrow`, `.mobile`): only the island panel scrolls; the crate sits in the free area at load, after
    a reload, Hide / Show panels and a resize; the narrow drawer and the phone layout. `drawer.mobile`: the drawer's open and
    close paths, focus trap and return, every tab, tapping a board, Load a part, resizing across 980 px.
  - `idle-autoplay`: hover never stops auto-play, a click, drag, wheel or key does, it resumes after 5 s, and the tooltip follows
    the turning crate. `dimension-pulse`: a pulse fires after framing, splits at the witness lines and ends; none with size
    labels off or reduced motion.
  - `shop-standards`: collapsed by default with every group; a plywood rate reaches the Overview cost, survives a reload and
    resets; a lower threshold switches the plywood; bad input is flagged. `scorecard`: the Overview card, the Layouts deltas and
    ranking toggle, the labour rate, "Designed in" after the first export.
  - `design-file`: Download design (.json) and reopen it (catalog, custom with and without its model, stale layout, newer
    version). `design-library` (`.mobile`): save, list, reuse, rename, delete with undo, export and import the library, share
    links, focus after each action. `last-design`: a reload reopens the last crate (including a custom GLB from IndexedDB);
    damaged or oversize data opens the default; a share link wins.
  - `batch-split` (`.mobile`): one crate for the sample quantities; 200 splits and the crate type picker, Checks and cut list
    follow; a lower max gross changes the split; the Shipment block; layout card deltas keep units on their numbers.
  - `export-zip`: Export downloads one `.zip` with every file in the units on screen and the design re-imports; split and custom
    parts; an exploded view still exports the assembled crate; the busy state; the caution dot. `print`: the route's spec,
    build sheet and label for the default, metric and split designs; the print link and the old `#d=` link; in print media
    the label is one page and the assembly order is whole (read back with Ghostscript when installed); the print page shows
    what the app shows.
  - `cradles`, `structure`, `handling`, `shaped-blocking`: the cradles, the heavy base, the CoG and forklift checks and the
    shaped blocking reach the cut list, Checks, the 3D view and the build sheet. Their figures are the domain's.
  - `app-icons` (HTTP only): the icons, the manifest and the head links.

- **When the UI changes,** put a screenshot of the change in the PR, and update the affected spec when you next run the
  suite. Tests have no retries, so a flaky test is a bug to fix.

## 11. Decision log

| Decision | Why | Trade-off |
|---|---|---|
| Exhaustive grid enumeration over bounding boxes | Identical parts make every slot the same size. It's exact and fast, and the result is easy to explain | No nesting or interlocking for irregular parts |
| Rank stable layouts first, with a 1.5× ratio and 3% volume tolerance | The 1.0× rule rejected a single flat shaft once skids were added, so the shaft stood on end | The thresholds are heuristics |
| Domain in Z-up mm, a single render transform | Matches the source data; one place to get conversions right | Readers must know three.js is Y-up |
| Orientation math through three.js `Euler` in the domain | Packing and render can't disagree | The domain depends on `three`, which is pure math and fine in Node |
| Each board as an explicit `Member` box | One list drives the 3D view, BOM, weight and screws | No joinery detail (rabbets, overlaps) |
| zustand store, plus a separate per-frame `motion.ts` | DOM panels and the 3D scene share hover, pin and view state; per-frame values stay out of React so animation doesn't re-render | Two places to look for state |
| Assembly, face and label tagged on members in the domain | The cut list groups by assembly and the viewer fades or moves by face; inferring this from geometry in the UI was fragile | More fields on `Member` |
| Checks report passes, not only problems | The Checks tab shows what was verified, not just what failed | More strings in the domain |
| Size labels as DOM, not drei `<Html>` | `<Html>` mounts a React root per label, and unmounting those during a render raced in React 19 | Positions are projected manually each frame |
| Camera framing via `setViewOffset` toward the free area | The crate stays centred beside the island; picking and projection still use one camera | Insets are measured from the DOM |
| GLBs over 20 units across are read as millimetres | Catches the common "exported in mm" mistake; the UI says when it happened | A real 20 m+ part would be misread (none are expected) |
| No part switcher; parts come in by loading a GLB | The handoff's design; a file is how new parts arrive in practice | The demo needs the sample files at hand |
| `next/dynamic` with `ssr: false` for the viewer | WebGL only exists in the browser | No server-rendered preview of the canvas |
| Bun as package manager | The user chose it | `bun test` ≠ vitest, so always use `bun run test` |
| The load test is a Node script with its own SSE reader, not k6 or Bun (#46, `docs/LOAD_TEST.md`) | k6 needs a custom build for SSE and can't run the engine that makes valid saves; Bun's `fetch` dropped a few percent of 1000 concurrent streams that Node opened cleanly, which would read as server errors | Two runtimes in one script: Bun only makes the save bodies |
| One crate engine (`src/engine`) for page, worker and Node; the page runs it in a Web Worker (#46) | The browser and a server can't disagree, and a sweep stays off the render thread. `src/engine` sits above `src/lib` because the builders are made of lib's formatting and print model | An edit's design lands a few ms after the edit, so the store holds `designedFrom` to say which inputs the design on screen belongs to |
| Settings are clamped at the store, bad values rejected per field | A slider or typed value just past a limit should still do something useful; NaN or a wrong type has no sensible nearest value, so the last good one stays | A typed quantity that is clamped or rejected gets a short note by the field (#36); nothing else is typed |
| `computeDesign` returns a `problem` instead of throwing | The UI can always explain an empty screen, in domain wording | One more field to check alongside `design` |
| Tiny parts get a 178 mm minimum interior, padded as clearance | Keeps the cleat frame buildable and the board-bounds invariant true without special-casing the geometry | A 1 mm part ships in a crate far bigger than it needs |
| House rules are one zod-validated `ShopStandards` object passed into `computeDesign`, defaulting to `DEFAULT_STANDARDS` (#19) | Makes the PM's tribal knowledge explicit and editable; the domain stays pure (no store or storage access), and every existing call and test works unchanged with the defaults | Every domain function takes one more argument; a few exports remain as views of the defaults for tests |
| Shop standards persist in `localStorage` under a versioned key, loaded after mount | No backend yet; a PM's house rules should survive reloads. Loading after mount avoids a hydration mismatch, and invalid data falls back to the defaults with a warning | Per browser, not per shop: share them with Download / Load standards until there are accounts (§9) |
| Saved designs live in `localStorage` as the #28 design file plus name and notes, keyed by part identity; share links put the same file base64url in the URL hash (#14) | One format for files, the library and links, with one validator and its migrations; no backend needed yet; the hash never reaches a server log | Per browser, about 5 MB; a custom part's GLB can't travel in a link, so the receiver loads it; the shared Postgres store (#46, `POSTGRES.md`) replaces it |
| Standards are edited in fixed units (mm, kg, $/m³), not the display units | They are shop configuration, entered once from stock and price lists; the stock fields are actual sizes, which map to nominal names for display | An imperial user converts by hand |
| Imperial by default, with nominal lumber names and a CSV in the selected units (#15) | The shop floor is domestic US: crews think in inches, pounds, 2x4s and 3/4″ ply, and the cut list is what they saw to | Two CSV formats; a custom stock size not in `NOMINAL_LUMBER` shows as fractional inches |
| A split is N identical crates plus at most one remainder, chosen fewest crates → least volume (3% tie) → most even (#25) | Identical crates are faster to build from one cut list; a PM thinks in crate counts first, then truck space; an even split balances the crates when volume doesn't care | A mixed plan (e.g. 4 + 3 + 3) is never offered; bisection assumes fit falls as the part count grows |
| Per-crate limits reuse the trailer door and floor for size; only gross and part count are new standards | The door check already holds the handling size limit; two sources would drift | Forklift and pallet-jack fit is checked separately (§7.14), not as a size limit |
| Handling is a pure read of the finished members, in its own module, hooked into `designCrate` after the boards are built (#8) | Skid count and spacing, under-floor members and dunnage belong to the construction rules (#6, #7, #16); reading the members means any change there is handled without touching this code | Handling can only report, never fix: a crate too narrow for forks is a caution, not a re-design |
| A part's CoG is its bounding-box centre | There is no mesh mass analysis, and the catalog gives only mass and box | A part with its mass off-centre in its box moves the true CoG by up to half the box |
| Devices are two tines with a spread range that must straddle the CoG, not a single opening-width rule | One rule covers two skids (both tines in one opening) and a middle skid (one per opening), and catches a lift with the load hanging off one side | A shop with unusual equipment has to describe it as tines and a spread |
| A pallet jack that is only too narrow is info while a forklift fits | A crate needs one way to be lifted; small crates are simply too narrow for a jack, and a caution on every small crate would bury the real ones | A dock with only a pallet jack must read the info lines; too little height is always a caution |
| The CoG and fork marks go with the Size labels switch, not a new switch | They are measurement overlays like the size lines, and one switch keeps the View popover short | They can't be shown without the size labels |
| Freight as class and weights, not dollars (#17) | LTL prices depend on the lane, carrier and the shipper's negotiated tariff; invented rates would mislead. Class, density and dim weight are what a booker quotes from | No "freight $" on screen; the PM gets quotes with these terms |
| Class from the NMFC 13-sub density scale, outside inches rounded up | It is the density-based scale in force since July 2025, and carriers measure to the next inch | An estimate: commodity-specific items and re-classing on inspection aren't modelled |
| Labour from counted work (cuts, set-ups, screws, steps, handling) at editable minutes (#17) | Every count already exists in the design, so the model explains itself and a shop can calibrate it by timing a few crates | Placeholder minutes; no learning curve or batch effect for many identical crates |
| Ranking option re-ranks with hard constraints first; volume stays the default | Cost or freight must never buy a crate that tips or leaves parts loose; the default keeps every existing result | Re-ranking designs every layout (5–15 ms); the density ranking also avoids the LTL length charge, a judgement call |
| `materialCostUsd` stays wood only; `cost` holds the full breakdown | Existing callers, tests and the "$ of wood" line keep their meaning | Two cost fields to read correctly |
| The export document is a print route plus the browser's "Save as PDF", rendered from a pure `PrintableDesign` (#26) | No server and no PDF library; vector output for free; the model is tested once, and a programmatic PDF (#51) can reuse it | Page breaks are the browser's; the user picks "Save as PDF" in the dialog |
| The Export pill's PDF is drawn with jsPDF from `PrintableDesign`, drawings included, without svg2pdf (#51) | One model for print and PDF; the drawings are only rectangles and lines, so drawing them directly keeps the code DOM-free and unit-testable in Node, with one dependency | Built-in Helvetica only (non-WinAnsi characters are spelled out); the PDF's page layout is its own, not `/print`'s |
| The Export pill keeps the separate downloads (#51) | Someone who wants one file (an engineer wanting only the GLB) and the print-to-paper path stay one click away | Two ways to get each file |
| The print route gets the design as a design file in the URL hash, not through `sessionStorage` | Works on reload and when opened directly, never leaves the browser, and reuses the #28 format a share link can use | It uses the printing browser's saved shop standards, not the opener's in-memory ones (in the same browser these are the same) |
| Slender parts (longest ÷ middle ≥ 3) sit in notched cradles instead of bearers and side posts; `isSlender` reads the part's own sides, not the layout (#6) | A round shaft on flat bearers can roll and bow; real shaft crates use saddles. One predicate on the part lets the general blocking (#16) skip exactly the parts cradles own | The bounding box can't tell a round bar from a square one: a section within 10% of square gets a round seat |
| Stacked slender layers stack their cradles (notched under and over) and drop the separator (#6) | The layout and outside size stay exactly the packer's, the part gap and the separator's thickness become the wood between notches, and each layer is clamped by the one above | Load passes part → stacking cradle → part; no separator sheet protects the lower layer's finish |
| A cradle is a `Member` box plus an optional notch profile (#6) | BOM, weight, screws, drawings and highlighting keep working on boxes; only the 3D view and GLB extrude the profile | Tare and wood cost count the full box (the stock cut), not the notched solid |
| Structural sizing by allowable-stress hand formulas, SPF No. 2, with a 1.5 load factor (#7, §7.15) | A shop can follow and check every number, change the species in the standards, and the rules fit in one pure module; the base rating replaces a fixed 1,000 kg | No deflection, joint or point-load checks; the end-supported skid is conservative for a crate sitting flat |
| The base is sized per layout, inside the packer's allowance (#7) | The base height depends on the spans, so each layout's outside size must include its own skids and joists, or the boards' bounds wouldn't equal `layout.external` | The packer calls `planStructure` for every candidate (cheap arithmetic, no members), and the dead load is an estimate from the layout |
| Floor joists across the skids, under the floor, rather than more skids or joists between them (#7) | Fork tines enter from the ends between the skids, so the gaps must stay open; joists on top of the skids leave the openings clear and give the tines something to lift | The base gets 89 mm taller when it has joists |
| Joists are a new member kind, `joist`, not `bearer` (#7) | `bearer` is the dunnage under each part, inside the crate, with its own screws, drawings and labour step; a structural member in the base needs different handling | One more kind in every switch over kinds |
| The per-crate gross limit stays at 1,000 kg, now as a handling limit, alongside the computed rating (#7, #25) | Keeps today's splits and the forklift-sized crates the shop is used to; the rating only splits earlier when the base can't carry the load | Two limits to explain; a stronger base doesn't on its own allow heavier crates |
| Manual panel thickness stays 12 / 15 / 19 | `CrateSettingsSchema` and its tests fix those literals; only Auto reads `stock.panelPlywoodMm` | A shop with 18 mm stock gets it from Auto, not from the manual buttons |
| Shaped blocking from a per-face depth grid, measured in the browser and applied in the pure domain (#16) | The domain stays pure and testable (a synthetic profile in a unit test); one rasterisation pass per axis costs milliseconds, not the seconds a ray per cell would; six faces cover every orientation | The profile is a grid sample, not exact geometry; it is re-measured per session, not saved |
| Shaped blocking keeps the posts and adds blocks, rather than lengthening posts | Posts still run floor to separator and carry the layer above (§7.5); blocks only within the part's height can't hit bearers or separators | More pieces in the cut list (44 for PART-003 × 8) |
| Restraint is measured as contact share and free movement against the same profile, for both kinds of blocking | One number a PM can compare, computed the same way before and after; it is the measurable improvement #16 asked for | It scores the sampled profile, not a physics simulation; Z restraint (floor, separators, lid) is not scored |
| Layouts with cradles skip shaped blocking (`usesCradles`) | Cradles (#6) hold long parts lying flat; there are no posts to shape | A slender part stood on end is shaped like any other part |

## 12. Known limitations and roadmap

These are tracked in [GitHub issues](https://github.com/0xevm1/shipping-ui/issues):

| # | Topic |
|---|---|
| #1 | Commit the prototype as a baseline |
| #2 | README and this spec |
| #3 | Upload a custom GLB part, with user-entered name, mass and material. Loading and mass entry landed with #20; name and material entry followed |
| #4 | Capture and export LLM logs (a deliverable) |
| #5 | Architecture and decision notes for the on-site walkthrough |
| #6 | Cradles for long or cylindrical parts (§7.5a): notched saddles at ≤ 600 mm, stacking cradles between layers, end stops |
| #7 | Structural sizing rules for skids, floor and lid, replacing the mass thresholds (§7.15) |
| #8 | Centre of gravity and forklift / pallet-jack handling (§7.14): combined CoG, off-centre and tip checks, fork-entry checks, the 3D marks and the label's CoG mark. A part's own CoG is assumed to be its box centre |
| #9 | Printable shop-floor build sheet (superseded by #26) |
| #26 | Export bundle: the crate spec, build sheet and shipping label as a printable PDF (§7.11). A one-click PDF file is #51 |
| #51 | Export pill: one-click .zip with the GLB(s), a PDF file, the cut list(s), the design file and a README (§7.13) |
| #10 | Edge-case and input hardening |
| #11 | Explain why a layout was chosen (closed; `explainLayout` landed with #20) |
| #12 | Flag when a wooden crate is overkill (for example, light aluminum that a carton would do) |
| #13 | Shipping-mode constraints (LTL, container, air) |
| #14 | Design library and share links (§9): saved per part in `localStorage`, a library file to move them, designs in the URL hash; Postgres later (#46) |
| #15 | Imperial units by default with a metric toggle, nominal lumber names, CSV in the selected units |
| #16 | Geometry-aware blocking for irregular parts: shaped blocking from a measured part profile (§7.5b). Packing still uses bounding boxes, so utilization is unchanged |
| #17 | Design scorecard (§7.12): crate cost (material + labour), build time, freight class, density and dimensional weight; Layouts deltas and a ranking option; time to design |
| #19 | Shop standards configuration (§6.4). Stock, defaults, thresholds, limits, material rates and (with #17) the labour rate and shop times |
| #20 | UX redesign: full-bleed scene, glass island, tabbed detail |

Other known gaps:

- Batch splitting (#25, §7.10) offers only N identical crates plus one remainder.
- Structural sizing (#7, §7.15) checks strength only: no deflection, joint, point-load or racking
  checks, and the lid is sized only when a stacking load is entered.
- The GLB download and the view bar name the file by the batch quantity, not the crate type on
  screen.
- No top hold-down blocking under the lid.
- Shaped blocking (§7.5b) samples the mesh on a grid (about 1/100 of the part), so a feature
  thinner than a cell can be missed; it reads the first surface from each side, so it can't block
  undercuts; and it doesn't nest parts or shrink the crate.
- Separators are full-interior sheets, with no cut-outs for parts that are taller than their
  neighbours.

## 13. Working on this codebase

- Read `AGENTS.md` first. Next.js 16 has breaking changes, and its docs are in
  `node_modules/next/dist/docs/`.
- Business rules belong in `src/domain/` (pure, tested), not in components.
- **Add a rule by adding it to the shop standards**, not as a module constant: add the field
  to `ShopStandardsSchema` with a range, its value to `DEFAULT_STANDARDS`, read it from the
  `standards` argument where it applies, add a row to the editor's `GROUPS` in
  `ShopStandards.tsx`, and document it in §6.4 and §7 (citing the field). Old saved standards
  without the field still load, because stored and imported standards are merged onto the
  defaults. If a field changes meaning, bump `STANDARDS_VERSION`. Keep pure geometry (§6.4
  "deliberately not a standard") in the code.
- Adding a catalog part means:
  1. put the GLB in `public/parts/`
  2. add an entry to `src/data/parts.json`
  3. load it and check that the part line reads "model matches catalog"
- Never derive values in components that the domain should own. If the UI needs a number,
  add it to `CrateDesign` with a test.
- Inside the 3D scene, read the store with `useDesigner.getState()` in `useFrame` and write
  three.js objects directly. Subscribe with hooks only for things that change rarely.
- Don't use drei `<Html>`; use the `SizeLabels` pattern for DOM over the canvas.
- **Styles:** Tailwind v4 runs through Next's built-in PostCSS support (`postcss.config.mjs`,
  `@tailwindcss/postcss`), and only `src/app/globals.css` imports it. The scaffold's
  `@tailwindcss/turbopack` loader rule is gone (#54): it ran on every `*.css` file, turned
  `*.module.css` into global CSS (empty class names), and hot-reloaded `globals.css` one edit
  late. Don't add a `turbopack.rules` entry for CSS.
- **Where styles live.** Global CSS is three things: the design tokens and base element rules
  (`src/app/globals.css`, on every route), the shared UI primitives (`src/app/ui.css`, in
  `@layer ui`), and the designer's page (`src/app/(designer)/designer.css`). Everything else is a
  CSS module next to its component: `Name.module.css`, imported as `styles` (`styles.root`).
  - **A class that more than one component needs** is either a primitive (`ui.css`: a plain string
    in TSX, `className="btn"`) or a small component with its own module (`StageMessage`,
    `CrateTypePicker`, `PartViewSlot`, the shared `rule.module.css`). A component never imports
    another component's module.
  - **Primitives rank below modules.** The `ui` layer (declared in `globals.css`: `theme, base, ui,
    components, utilities`) is below unlayered CSS, so a module adjusts a primitive by setting the
    property on its own class and never has to out-specify it. Two cautions: the `font` shorthand
    resets `font-stretch`, so a module on `eyebrow-label` writes `font-family`, `font-size`,
    `font-weight` and `line-height` instead; and a module may restyle a primitive in context by
    name with `:global(.btn)` (the rows of Saved designs, the panel's `.seg`), nothing else uses
    `:global`.
  - **Hide panels and the drawer.** The shell sets `data-panels-hidden` on its root, and each
    overlay's module fades itself (`:global([data-panels-hidden]) .header`). The island's drawer
    state is its own `data-open`. Neither is a class another component has to know.
  - **Breakpoints** are written out in the modules (a media query can't read a custom property);
    `globals.css` lists them, and `NARROW` in `DesignerShell.tsx` must match the 980 px one. The
    cut list's row stacking is an unnamed `@container` query, which finds the island's panel
    (`container-type: inline-size` in `Island.module.css`), so no container name has to be shared between modules.
  - **Print.** `/print` is outside the `(designer)` route group, so it gets `globals.css` and
    `print.css` only. Keep designer styles out of those two files.
  - **Tests and scripts never select by class** (§10), and no class is a behaviour hook: state is
    in attributes (`aria-*`, `data-*`).
- Before you push, run `bun run test`, `bun run lint`, `bun run format:check` and `bun run build`. The e2e suite (§10)
  is opt-in: it runs from the manually triggered `E2E` workflow or `bun run e2e`, not in CI.
- Prefer roles and accessible names for anything the e2e tests need to find. Add a
  `data-testid` only where there is no accessible handle, and read 3D state through the
  `window.__crate` hook (`E2EProbe`) rather than adding DOM for tests.
