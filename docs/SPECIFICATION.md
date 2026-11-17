# Crate Designer — Specification

> **Purpose of this document:** the single source of truth for what the app does and why. It is
> written so that a new contributor, or a new AI session with no prior context, can change the
> code safely. If code and spec disagree, fix one of them in the same PR.
>
> **Status:** v1 prototype. Last updated 2026-11-16.

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

- **Units:** everything in `src/domain/` is **mm** and **kg**. Conversion to inches happens only
  for display.
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
- **Rendering:** three.js is Y up and in metres. Exactly **one** transform does the conversion:
  the root `<group rotation={[-π/2,0,0]} scale={0.001}>` in `CrateViewer.tsx`. Everything inside
  it uses domain coordinates.
- **Rotations** are XYZ-order Euler angles in multiples of π/2. Packing and rendering both use
  three.js `Euler`/`Matrix4` (`orientations.ts`), so packed bounding boxes always match the
  rendered models.

## 5. Architecture

```
parts.json ──zod──▶ catalog.ts
                         │
CrateSettings ──▶ design.ts: computeDesign(settings, layoutKey?)
                         │
           ┌─────────────┼───────────────────┐
           ▼             ▼                   ▼
   resolveConstruction  enumerateLayouts     designCrate
   (board sizes from    (packing.ts:         (crate.ts: members, BOM,
    payload mass)        ranked Layout[])     weights, screws, warnings)
                         │
                         ▼
                   DesignResult { part, layouts, design }
                         │
          React (CrateDesigner, useMemo) ──▶ panels + CrateViewer (three.js)
```

- **The domain layer is pure and synchronous.** It has no React, DOM or I/O, and it is fully
  unit-tested. `computeDesign` is cheap (6 orientations × at most a few hundred grids), so the UI
  re-runs it on every input change.
- **The UI holds only:** `settings`, `layoutKey` (null means use the best), `mode` (the view
  mode) and `measured` (the GLB bounds). Changing any setting resets `layoutKey` to null.
- **The viewer is client-only.** It is loaded with `next/dynamic` and `{ ssr: false }` inside a
  client component, because WebGL doesn't exist on the server.

### File map

| File | Responsibility |
|---|---|
| `src/domain/schema.ts` | zod schemas and types: `Part`, `PartsCatalog`, `CrateSettings`, `Vec3` |
| `src/domain/catalog.ts` | Parses `parts.json` at module load (fails loudly). `getPart` and `modelUrl` |
| `src/domain/orientations.ts` | The 6 orientations; `rotatedSize()` |
| `src/domain/packing.ts` | `enumerateLayouts()`, `compareLayouts()` |
| `src/domain/crate.ts` | `resolveConstruction`, `structureAllowance`, `designCrate`, dunnage, BOM, screws, warnings |
| `src/domain/design.ts` | `computeDesign()`, `DEFAULT_SETTINGS` |
| `src/domain/export.ts` | `bomToCsv()`, `downloadText()` |
| `src/domain/domain.test.ts` | Invariant tests (§10) |
| `src/components/CrateDesigner.tsx` | Page shell and state |
| `src/components/ControlsPanel.tsx` | Inputs |
| `src/components/SummaryPanel.tsx` | Stats, warnings, alternatives table, cut list |
| `src/components/viewer/CrateViewer.tsx` | Canvas, lights, `CameraRig`, loading overlay |
| `src/components/viewer/CrateModel.tsx` | One box mesh per `Member`; cutaway and exploded logic |
| `src/components/viewer/PartInstances.tsx` | Loads the GLB once, clones it per slot, re-centres it, measures bounds |

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

### 6.2 Settings (`CrateSettingsSchema`)

| Field | Type / range | Default | Effect |
|---|---|---|---|
| `partId` | catalog id | `PART-001` | Selecting a part also resets `quantity` to its first suggested quantity |
| `quantity` | int 1–200 | 4 | Number of parts |
| `keepUpright` | bool | true | Allow only the 2 orientations that keep model Z vertical |
| `maxLayers` | int 1–6 (UI offers 1–4) | 2 | Upper limit on `nz` |
| `partGapMm` | 0–300 | 50 | Clear gap between adjacent parts, filled by blocking |
| `wallClearanceMm` | 0–300 | 50 | Gap to the walls, floor and lid |
| `panelThickness` | `"auto"` \| 12 \| 15 \| 19 | auto | Plywood for walls, lid and separators |

### 6.3 Derived types

- **`Layout`:** `key`, `orientation`, `cellSize` (rotated bbox), `counts [nx,ny,nz]`,
  `interior`, `external`, `externalVolumeM3`, `utilization`, `stable`, and `slots[]`. Each slot
  has `index [i,j,k]` and `min` (slot min corner).
- **`Member`:** `{ kind, material: "plywood"|"lumber", min: Vec3, size: Vec3 }`. `kind` is one
  of `skid`, `floor`, `side`, `end`, `lid`, `cleat`, `lid-cleat`, `separator`, `bearer`,
  `blocking`.
- **`CrateDesign`:**
  - `layout` and `construction` (`panelMm`, `floorMm`, `skid {wide, tall}`, `skidCount`)
  - `members[]` and `bom[]`
  - `payloadKg`, `tareKg`, `grossKg`
  - `plywoodM2`, `lumberM`, `screws`, `materialCostUsd`
  - `warnings[]`

## 7. Algorithms

### 7.1 Orientations

There are six axis-aligned rotations, one per permutation of the bbox axes. Mirror images are
excluded.

| id | Euler (XYZ) | upright |
|---|---|---|
| `as-modeled` | (0, 0, 0) | ✓ |
| `turned` | (0, 0, π/2) | ✓ |
| `on-side-x` | (π/2, 0, 0) | |
| `on-side-x-turned` | (π/2, 0, π/2) | |
| `on-end-y` | (0, π/2, 0) | |
| `on-end-y-turned` | (0, π/2, π/2) | |

`rotatedSize(size, o)` rotates a centred box with three.js and returns its new AABB size,
rounded to 0.001 mm.

### 7.2 Packing (`enumerateLayouts`)

Inputs: `partSize`, `n`, `keepUpright`, `maxLayers`, gap `g`, clearance `c`, separator thickness
`s` (= panel thickness), and `structureAllowance`.

For each allowed orientation, with rotated cell `[a, b, h]`:

```
for nz in 1..min(maxLayers, n):
  perLayer = ceil(n / nz);            skip if perLayer·(nz−1) ≥ n     (empty top layer)
  for nx in 1..perLayer:
    ny = ceil(perLayer / nx);         skip if (nx−1)·ny ≥ perLayer    (empty column)
    interior = [ 2c + nx·a + (nx−1)·g,
                 2c + ny·b + (ny−1)·g,
                 2c + nz·h + (nz−1)·(g + s) ]
    skip if interior.L < interior.W                                    (X is the long axis)
    dedupe on (rounded interior, nx, ny, nz)
    external = interior + structureAllowance
```

- **Slots** are filled layer by layer, then row by row, then column by column, until there are
  `n`. Slot min = `[c + i(a+g), c + j(b+g), c + k(h+g+s)]`.
- **Key format:** `"{u|s}:{L}x{W}x{H}:{nx}{ny}{nz}"`. `u`/`s` means upright or not, and the
  dimensions are rounded mm. Keys are only used to select a layout in the UI; they aren't stored.

**Ranking (`compareLayouts`):**

1. `stable` first. Stable means `external.H ≤ 1.5 × min(external.L, external.W)`
   (`STABLE_HEIGHT_RATIO`).
2. Smaller `externalVolumeM3`. Volumes within **3%** of each other (`VOLUME_TOLERANCE`) count as
   equal.
3. Lower external height.

Element `[0]` is the recommended layout.

`utilization = n·a·b·h / (L·W·H)` uses the interior and part bounding boxes.

### 7.3 Construction sizing (`resolveConstruction`)

| Item | Rule |
|---|---|
| Panel plywood (walls, lid, separators) | Auto: payload ≤ 150 kg → **12 mm**; ≤ 500 kg → **15 mm**; otherwise **19 mm**. Overridable |
| Floor plywood | Always **19 mm** |
| Skids | Payload ≤ 700 kg → **89 × 89** (4×4); otherwise **89 × 140** (4×6, tall) |
| Skid count | `max(2, ceil(externalWidth / 800) + 1)`, evenly spread across the width |
| Cleats | **19 × 89** (1×4) |

**`structureAllowance`** is what the structure adds to the interior. Here `t` is the panel
thickness and `ct` is the cleat thickness (19):

```
[ 2(t + ct),  2(t + ct),  skid.tall + floor + t + ct ]
```

### 7.4 Crate geometry (`designCrate`)

All coordinates are relative to the interior origin, with `cw = 89` (cleat width).

| Member | Min corner → size |
|---|---|
| Floor | x, y from `−t−ct`, spanning the full external footprint; z ∈ [−floor, 0] |
| Skids | Under the floor, full external length along X; z ∈ [−floor−skid.tall, −floor] |
| Side walls (±Y) | Panel x ∈ [−t, L+t], thickness t, outside y ∈ [0, W], height H |
| Side cleats | Outside each side panel. Top and bottom horizontals, plus verticals at ≤ 600 mm spacing (`MAX_CLEAT_SPACING`) |
| End walls (±X) | Panel spans y ∈ [0, W], fitted between the side panels |
| End cleats | Outside each end panel. They span the full external width, so they wrap the corners over the side cleats |
| Lid | Panel over x ∈ [−t, L+t], y ∈ [−t, W+t] at z = H. Two long edge cleats on top, plus cross-cleats at ≤ 600 mm |

**Invariant:** the bounding box of all members equals `layout.external`, which is tested.

### 7.5 Dunnage (inside the crate)

- **Bearers:** under each bottom-layer part, two 89-wide strips running along X, at 20% and 80%
  of the part's width. Their height equals the wall clearance.
- **Separators:** one plywood sheet across the whole interior between each pair of layers, of
  thickness `t`.
- **Blocking posts:** one per side (±X, ±Y) of every part, centred on that side:
  - **Width:** 89, or the part's side length if that is shorter.
  - **Thickness:** equal to the gap on that side (the clearance at a wall, or `partGap` next to
    another part).
  - **Height:** from the layer's floor (the crate floor or a separator) up to the next separator,
    or for the top layer, to the part's top. This means the posts also carry the layer above.
  - Posts are only made when the gap is ≥ 19 mm (`MIN_BLOCKING_GAP`).
  - Posts shared by two neighbouring parts are de-duplicated by rounded position and size.

### 7.6 Outputs

- **Mass:**
  - `payloadKg = mass_kg × quantity`
  - `tareKg = Σ volume × density`, with plywood at 600 kg/m³ and lumber at 480 kg/m³
  - `grossKg = payloadKg + tareKg`
- **Material totals:** plywood area is the sum of each sheet's two largest dimensions multiplied
  together. Lumber length is the sum of each board's longest dimension.
- **Cost:** `Σ volume × rate`, with plywood at $1,100/m³ and lumber at $650/m³. These are
  **placeholders**, good only for comparing designs.
- **Screws:**
  - each cleat: `ceil(len/150)+1`
  - each skid: `ceil(len/300)+1`
  - each block or bearer: 2
  - walls-to-floor plus lid-to-walls: `2·ceil(2(L+W)/200)`
  - corners: `4·ceil(H/200)`
- **BOM:** members are grouped by `(kind, stock, cut)`.
  - **Plywood:** stock is `"{thickness} mm"` and cut is `"{largest} × {second}"`.
  - **Lumber:** stock is `"{smallest} × {middle}"` and cut is `"{length}"`.
- **CSV:** header comments, then `component,material,stock,cut_mm,qty`, then a final
  wood-screws line.

### 7.7 Warnings

| Condition | Level | Message intent |
|---|---|---|
| external W or H > 2440 mm | caution | Trailer or container door clearance |
| external L > 3000 mm | info | Oversize freight |
| min(partGap, wallClearance) < 19 mm | caution | Too tight for blocking, so parts are unrestrained |
| mass × (nz − 1) > 100 kg | caution | Heavy stack on the bottom-layer positions |
| layout not stable | caution | Tip-over risk |
| gross > 1000 kg | caution | Heavier skids and floor joists needed |
| utilization < 25% | info | Bounding-box packing limitation |
| always | info | Use ISPM-15 heat-treated lumber for export |

## 8. UI

A three-column, full-viewport layout:

- **Left: controls.** Part cards, quantity (number input plus suggested-quantity buttons),
  packing options and plywood selection.
- **Centre: 3D viewer.**
  - **View modes:**
    - **Cutaway** (default) hides the lid, plus the front (−Y) side panel and its cleats.
    - **Assembled** shows everything.
    - **Exploded** moves the walls out by 250 mm and the lid up by 375 mm.
  - **GLB check badge:** shows the measured bounds and "✓ matches catalog" when they are within
    ±1 mm of `dimensions_mm`.
  - **Camera:** `CameraRig` frames the crate whenever its external size or view mode changes. It
    fits the bounding sphere to the tighter of the horizontal and vertical FOV (40° vertical),
    looking at the crate centre. It replaced drei's `<Bounds>`, which zoomed into empty space
    after layout changes.
  - **Loading:** a DOM overlay driven by `useProgress`. drei's `<Html>` must not be used as a
    Suspense fallback, because it causes React unmount-race errors.
  - **Part materials:** overridden to a neutral metal (metalness 0.35). There's no environment
    map, and fully metallic surfaces render black without one.
- **Right: results.** External size, a stats grid, a build summary, warnings, the alternatives
  table (top 6, clickable, tagged `best` or `tall`), and the cut list with CSV download.

## 9. Persistence

Not implemented in v1. State lives in memory. The plan is SQLite WASM with the `opfs-sahpool`
VFS, in a Web Worker, behind a typed repository. See `DATA_STORE.md` and `schema.sql`.

## 10. Invariants and tests

`bun run test` runs `src/domain/domain.test.ts`, which checks:

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

When you change packing or construction rules, keep these passing. If a rule change
deliberately changes an expected value, update the test and this spec in the same PR.

## 11. Decision log

| Decision | Why | Trade-off |
|---|---|---|
| Exhaustive grid enumeration over bounding boxes | Identical parts make every slot the same size. It's exact and fast, and the result is easy to explain | No nesting or interlocking for irregular parts |
| Rank stable layouts first, with a 1.5× ratio and 3% volume tolerance | The 1.0× rule rejected a single flat shaft once skids were added, so the shaft stood on end | The thresholds are heuristics |
| Domain in Z-up mm, a single render transform | Matches the source data; one place to get conversions right | Readers must know three.js is Y-up |
| Orientation math through three.js `Euler` in the domain | Packing and render can't disagree | The domain depends on `three`, which is pure math and fine in Node |
| Each board as an explicit `Member` box | One list drives the 3D view, BOM, weight and screws | No joinery detail (rabbets, overlaps) |
| `useState` + `useMemo`, no state library | Derived state is cheap and pure | Revisit when persistence arrives |
| `next/dynamic` with `ssr: false` for the viewer | WebGL only exists in the browser | No server-rendered preview of the canvas |
| Bun as package manager | The user chose it | `bun test` ≠ vitest, so always use `bun run test` |

## 12. Known limitations and roadmap

These are tracked in [GitHub issues](https://github.com/0xevm1/shipping-ui/issues):

| # | Topic |
|---|---|
| #1 | Commit the prototype as a baseline |
| #2 | README and this spec |
| #3 | Upload a custom GLB part, with user-entered mass and material |
| #4 | Capture and export LLM logs (a deliverable) |
| #5 | Architecture and decision notes for the on-site walkthrough |
| #6 | Cradles for long or cylindrical parts. Today the shaft is held only by flat bearers and one post per side |
| #7 | Structural sizing rules for skids, floor and lid, replacing the mass thresholds |
| #8 | Centre of gravity and forklift handling |
| #9 | Printable shop-floor build sheet |
| #10 | Edge-case and input hardening |
| #11 | Explain why a layout was chosen |
| #12 | Flag when a wooden crate is overkill (for example, light aluminum that a carton would do) |
| #13 | Shipping-mode constraints (LTL, container, air) |
| #14 | Shareable design via URL |
| #15 | Imperial / metric units toggle |
| #16 | Geometry-aware blocking for irregular parts |

Other known gaps:

- No limit on maximum crate size or weight, and no splitting a batch across several crates.
- No top hold-down blocking under the lid.
- Separators are full-interior sheets, with no cut-outs for parts that are taller than their
  neighbours.

## 13. Working on this codebase

- Read `AGENTS.md` first. Next.js 16 has breaking changes, and its docs are in
  `node_modules/next/dist/docs/`.
- Business rules belong in `src/domain/` (pure, tested), not in components.
- Add a new rule as a named constant at the top of `crate.ts` or `packing.ts`, and add it to
  §7 of this spec.
- Adding a part means:
  1. put the GLB in `public/parts/`
  2. add an entry to `src/data/parts.json`
  3. check that the viewer's bounds badge reads "✓ matches catalog"
- Before you push, run `bun run test`, `bun run lint` and `bun run build`.
