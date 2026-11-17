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
  it uses domain coordinates. Domain front (−Y) faces world +Z; domain +X stays world +X.
- **Exported GLB** (`src/lib/exportGlb.ts`) follows the input GLB convention, not three.js's:
  metres, **Z up**. The only conversion from the domain is × 0.001 (mm → m); there is no Y-up
  rotation in the file.
- **Loaded GLBs** are read as metres, Z up, like the samples. A file more than **20 units**
  across is read as millimetres instead (`MM_FILE_THRESHOLD` in `src/lib/loadPart.ts`), and the
  UI says so ("file read as millimetres", plus an info check).
- **Units in the UI:** the metric / imperial toggle is display-only (`src/lib/units.ts`). The
  domain, the CSV and the mass input stay metric.
- **Rotations** are XYZ-order Euler angles in multiples of π/2. Packing and rendering both use
  three.js `Euler`/`Matrix4` (`orientations.ts`), so packed bounding boxes always match the
  rendered models.

## 5. Architecture

```
parts.json ──zod──▶ catalog.ts          GLB file ──▶ lib/loadPart.ts (validate, measure, match catalog)
                         │                              │
                         ▼                              ▼
   localStorage ◀──▶ state/store.ts (zustand): part, settings, standards, layoutKey, view, hover, pin, …
   (standards only)      │  recompute() on every input change
                         ▼
          domain/design.ts: computeDesign(part, settings, layoutKey?, standards?)
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

- **The domain layer is pure and synchronous.** It has no React, DOM or I/O, and it is fully
  unit-tested. `computeDesign` is cheap (6 orientations × at most a few hundred grids), so the
  store re-runs it on every input change.
- **One store, two kinds of state.**
  - `src/state/store.ts` (zustand) holds everything the UI renders from: the part, settings,
    the shop standards (§6.4), the design result, units, tab, view targets, hover / pin, tooltip, size labels, panel
    visibility, the free-area insets, and a `fit` request counter for the camera. Any change to
    the part, settings, standards or layout key goes through `recompute()`, which also drops a pin whose
    cut-list line no longer exists.
  - `src/state/motion.ts` holds values that change every frame (eased explode distance, lid and
    front-wall opacity, idle auto-play bookkeeping, last-input time). They live outside React on
    purpose, so animation never re-renders the UI.
- **The viewer is client-only.** Both canvases are loaded with `next/dynamic` and
  `{ ssr: false }` inside client components, because WebGL doesn't exist on the server.

### File map

| File | Responsibility |
|---|---|
| `src/domain/schema.ts` | zod schemas and types: `Part`, `PartsCatalog`, `CrateSettings`, `DesignPart`, `Vec3`; `normalizeSettings` (the store boundary) |
| `src/domain/catalog.ts` | Parses `parts.json` at module load (fails loudly). `getPart` and `modelUrl` |
| `src/domain/orientations.ts` | The 6 orientations; `rotatedSize()` |
| `src/domain/standards.ts` | `ShopStandardsSchema`, `DEFAULT_STANDARDS`, `minInteriorMm()`, merging, parsing and the JSON file format (§6.4) |
| `src/domain/packing.ts` | `enumerateLayouts()`, `compareLayouts()` |
| `src/domain/crate.ts` | `resolveConstruction`, `structureAllowance`, `designCrate`, dunnage, BOM, screws, checks; `ASSEMBLIES`; `MIN_INTERIOR_MM`, `DRY_VAN_53FT_MM`, `LTL_EXCESSIVE_LENGTH_MM` and `CARDBOARD_LIMITS` as read-only views of the defaults |
| `src/domain/design.ts` | `computeDesign()` and its input checks (`DesignProblem`, `MAX_PART_MM`), `explainLayout()`, `settingsFromStandards()`, `DEFAULT_SETTINGS` |
| `src/domain/export.ts` | `bomToCsv()`, `downloadText()`, `ASSEMBLY_NAMES` |
| `src/domain/designFile.ts` | The saved design file (§6.5): `DesignFileSchema`, `serializeDesign`, `parseDesignFile` (version check and migrations), `restoreDesign` |
| `src/domain/diff.ts` | `diffDesigns()`: which design values an edit changed, old → new (§8.5a) |
| `src/domain/partDetails.ts` | Validation of user-entered name, material and mass (`cleanPartDetails`), material suggestions, `partFinish()` (aluminum or steel look) |
| `src/domain/domain.test.ts` | Invariant, regression-baseline and feature tests (§10) |
| `src/domain/hardening.test.ts` | Edge-case and bad-input tests (§10) |
| `src/domain/standards.test.ts` | Standards schema, defaults, and designs under custom standards (§10) |
| `src/lib/units.ts` | Display-only unit formatting (mm ↔ in, kg ↔ lb, m³ ↔ ft³, 1/16″ fractions) |
| `src/lib/format.ts` | Cut-list stock / cut text, layout descriptions |
| `src/lib/loadPart.ts` | GLB validation (`glbProblem`), measuring, catalog matching, `parts.json` merging, opening a design file; `designFilePart` |
| `src/lib/partFields.ts` | The header's mass field: kg / lb text ↔ kg (`formatMass`, `parseMass`), ↑ / ↓ steps, fallback field widths |
| `src/lib/changes.ts` | A design diff as screen text: "Gross 16 → 20 kg" or "No change to the crate" |
| `src/lib/exportGlb.ts` | The assembled crate as GLB (`buildCrateScene`, `exportCrateGlb`): fresh scene from the design, named boards grouped by assembly, optional parts; cached part loading, file name, binary download |
| `src/state/store.ts` | The zustand store and its actions; `LoadedPart`, `currentMode()`, `lastChange` |
| `src/state/standardsStorage.ts` | Loads and saves the shop standards in `localStorage` (§9) |
| `src/state/motion.ts` | Per-frame animation values and idle timing constants |
| `src/state/checks.ts` | Domain checks plus file-dependent checks (model size, stand-in mass), sorted |
| `src/components/shell/DesignerShell.tsx` | Full-bleed layout; the narrow-screen drawer, hamburger, focus trap and summary chip (#42); idle input tracking, Escape, drag-and-drop, free-area insets, tooltip |
| `src/components/shell/PartHeader.tsx` | Top left: app name, the part as a sentence with the crate gross; inline name, material and mass fields for unknown parts (§8.5) |
| `src/components/shell/ChangeFeedback.tsx` | `ChangeNote` (what an edit moved, `role="status"`) and `Flash` (gold highlight on a changed value) |
| `src/components/shell/ViewBar.tsx` | Bottom right: pin bar, mode icon, units, View popover (with the GLB download), Hide panels |
| `src/components/shell/useLoadFiles.ts` | Turns picked / dropped files into the current part, or opens a design |
| `src/components/shell/StandardsLoader.tsx` | Applies the saved shop standards once the app has mounted |
| `src/components/island/*.tsx` | The island and its five tabs |
| `src/components/island/ShopStandards.tsx` | The Shop standards editor at the bottom of the Rules tab (`shopStandards.css`) |
| `src/components/viewer/CrateViewer.tsx` | Main canvas; the Z-up → Y-up root transform; lights; loading overlay |
| `src/components/viewer/Director.tsx` | Camera framing and view offset, presets, eased moves, fades, idle auto-play |
| `src/components/viewer/CrateModel.tsx` | One box per `Member`; explode, fades, highlight, ghosting, picking |
| `src/components/viewer/PartInstances.tsx` | GLB loaded once, cloned per slot, re-centred, measured, ghosted |
| `src/components/viewer/DimensionLines.tsx` | Crate and part size lines; positions the DOM labels each frame |
| `src/components/viewer/SizeLabels.tsx` | The DOM elements for the size labels |
| `src/components/viewer/Floor.tsx` | Grid and warm light pool |
| `src/components/viewer/PartView.tsx` | The island's turntable canvas |
| `src/components/viewer/scene.ts` | Colours, explode offsets, opacity rules, highlight rules, part material |
| `src/components/viewer/E2EProbe.tsx` | Read-only `window.__crate` test hook; only in `NEXT_PUBLIC_E2E=1` builds (§10) |
| `playwright.config.ts`, `e2e/*.spec.ts` | End-to-end UI tests (`bun run e2e`, §10) |

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
| `quantity` | int 1–200 | 4 | Number of parts |
| `keepUpright` | bool | true | Allow only the 2 orientations that keep model Z vertical |
| `maxLayers` | int 1–6 (UI offers 1–4) | 2 (`defaults.maxLayers`) | Upper limit on `nz` |
| `partGapMm` | 0–300 | 50 (`defaults.partGapMm`) | Clear gap between adjacent parts, filled by blocking |
| `wallClearanceMm` | 0–300 | 50 (`defaults.wallClearanceMm`) | Gap to the walls, floor and lid |
| `panelThickness` | `"auto"` \| 12 \| 15 \| 19 | auto | Plywood for walls, lid and separators |

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

`setPartMass` likewise ignores a mass that isn't a finite number above zero. As a second line of
defence, `computeDesign` re-checks its input and returns a `problem` rather than throwing
(§7.9).

### 6.2a The part being designed

`computeDesign` takes a **`DesignPart`**: `id`, `name`, `mass_kg`, `dimensions_mm`, and an
optional `material`. Catalog parts satisfy it. So does a GLB loaded at runtime, which has
measured dimensions and possibly no material.

The UI wraps it in a **`LoadedPart`** (`src/state/store.ts`), which adds:

- `modelUrl` (a `/parts/…` path or a `blob:` URL)
- `mmPerUnit` (1000 for metre files, 1 for files read as millimetres)
- `suggested_quantities`
- `catalogDims`, the catalog size used for the model check (absent for unknown files)
- `massAssumed`, true when a 10 kg stand-in is in use (`STAND_IN_MASS_KG`)
- `readAsMm`

Mass is never inferred from the mesh.

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
  - `plywoodM2`, `lumberM`, `screws`, `materialCostUsd`
  - `checks[]`
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
exactly what it was before** (the 18-case baseline in §10 is unchanged).

Units are fixed per field (mm, kg, kg/m³, USD/m³), whatever the display units.

| Group / field | Default | Used by |
|---|---|---|
| **`stock`** — what the shop keeps on hand | | |
| `cleatMm {thick, wide}` | 19 × 89 (1×4) | Wall and lid frames; wall allowance; minimum interior = 2 × `wide` (§7.2) |
| `skidMm.standard {wide, tall}` | 89 × 89 (4×4) | Skids up to `construction.heavySkidOverKg` |
| `skidMm.heavy {wide, tall}` | 89 × 140 (4×6) | Skids above it |
| `floorPlywoodMm` | 19 | The floor |
| `panelPlywoodMm {light, medium, heavy}` | 12 / 15 / 19 | Auto wall, lid and separator plywood (§7.3) |
| `blockWidthMm` | 89 | Blocking posts and bearers (§7.5) |
| **`defaults`** — what a new crate starts with | | |
| `partGapMm`, `wallClearanceMm`, `maxLayers` | 50, 50, 2 | Settings defaults (§6.2); same ranges as the settings |
| `volumeTolerance` | 0.03 | Layout volumes within 3% tie, and the lower crate wins (§7.2, §7.8) |
| **`construction`** — when to use which stock | | |
| `panelLightMaxKg`, `panelMediumMaxKg` | 150, 500 | Auto panel thresholds by payload (§7.3) |
| `heavySkidOverKg` | 700 | Heavy skids above this payload |
| `skidSpacingMm` | 800 | Skid count = `max(2, ceil(extW / spacing) + 1)` |
| `maxCleatSpacingMm` | 600 | Wall uprights and lid cross cleats (§7.4) |
| `minBlockingGapMm` | 19 | Smallest gap that gets a blocking post; the `blocking` check |
| **`limits`** — what the checks test (§7.7) | | |
| `trailerMm {interiorLength, interiorWidth, interiorHeight, doorWidth, doorHeight}` | 16000, 2565, 2794, 2489, 2743 | `door` |
| `ltlExcessiveLengthMm` | 2438 (8 ft) | `oversize` |
| `cardboard {partKg, payloadKg, boxDimSumMm}` | 15, 25, 1905 | `cardboard` |
| `stackKg` | 100 | `stack` |
| `baseRatingKg` | 1000 | `base-rating` |
| `stableHeightRatio` | 1.5 | `Layout.stable`, ranking and the `stable` check |
| `lowUtilization` | 0.25 | `utilization` |
| **`rates`** — material properties, prices and fastening (§7.6) | | |
| `densityKgM3 {plywood, lumber}` | 600, 480 | Tare weight |
| `costUsdPerM3 {plywood, lumber}` | 1100, 650 | `materialCostUsd` (placeholders) |
| `screwSpacingMm {cleat, skid, panelJoint}` | 150, 300, 200 | Screw estimate |

**Validation.** Every number is finite and inside a sane range (for example cleat spacing
100–5000 mm, so a typo can't make thousands of boards). Across fields: panel plywood must go
`light ≤ medium ≤ heavy`, `panelLightMaxKg ≤ panelMediumMaxKg`, the trailer door can't be
bigger than the trailer inside, and blocking can't be wider than the minimum interior (two
cleats), or a bearer would poke through a wall. `parseStandards` returns the first problem as
`"path: message"`.

**What is deliberately not a standard:** geometry that keeps the model consistent rather than a
shop choice — the 0.5 mm smallest board, bearers at 20% and 80% of the part width, at least two
skids and two uprights per wall, the six orientations — plus input validation: the settings
ranges (§6.2), `MAX_PART_MM` (20 m, a units-mistake guard, §7.9) and the manual panel choices
12 / 15 / 19 mm in the Rules tab (`CrateSettingsSchema`). Auto picks from `panelPlywoodMm`;
choosing by hand still offers the three standard sheets. The 29.5 kg carton rating quoted in the
`cardboard` check's text is a fact about 32 ECT board, not a setting.

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
collapsed by default. Five groups (Stock on hand, Defaults, Construction, Limits, Rates) of
number fields with units, laid out like the other `.rule` rows. A field applies as soon as its
text is a valid standard; invalid text is outlined in gold with the reason and reverts on blur.
A changed field is tinted and says its default. A **Customised** tag shows when anything
differs from `DEFAULT_STANDARDS`; **Reset to defaults**, **Download standards** and **Load
standards** sit at the bottom. Ratios are shown as % (`volumeTolerance`, `lowUtilization`).

### 6.5 Design file (`DesignFileSchema`, #28)

A saved design is a JSON file, downloaded from the Cut list tab with **Download design
(.json)** as `crate-design-{part id}-x{quantity}.json`, and opened again through **Load a part**
or a drop (§8.5). `src/domain/designFile.ts` writes it (`serializeDesign`) and reads it
(`parseDesignFile`); both are pure and unit-tested. It is the base for a design library (#14)
and share links.

```jsonc
{
  "kind": "crate-design",          // tells it apart from a parts.json catalog
  "schemaVersion": 1,              // DESIGN_SCHEMA_VERSION
  "app": { "name": "crate-designer", "version": "0.1.0" },   // package.json version
  "savedAt": "2026-11-16T12:00:00.000Z",
  "part": {
    "source": "catalog",           // "catalog": bundled in /public/parts; "custom": the user's GLB
    "id": "PART-001",
    "name": "Machined steel bracket",
    "material": "4140 steel",      // optional
    "mass_kg": 21.5,
    "massAssumed": true,           // optional; only written when the 10 kg stand-in is in use
    "dimensions_mm": [360, 220, 258],
    "model": "PART-001-machined-steel-bracket.glb"
  },
  "settings": { "quantity": 4, "keepUpright": true, "maxLayers": 2,
                "partGapMm": 50, "wallClearanceMm": 50, "panelThickness": "auto" },
  "layoutKey": "u:870x590x358:221", // Layout.key of the layout on screen
  "summary": {                     // for people, and to check a reopened design
    "quantity": 4,
    "layout": "2 × 2 × 1, As modeled",
    "outsideMm": [932, 652, 497],  // rounded
    "grossKg": 134.9               // one decimal
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
- **Versions.** A file from a newer format is refused ("saved by a newer version of the app").
  An older one runs through `MIGRATIONS` one version at a time before validation. There are
  none yet; a breaking change bumps `DESIGN_SCHEMA_VERSION` and adds one.
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
  - The rebuilt crate is compared with `summary`. If the outside size or gross differs (for
    example, a catalog mass or a shop rule changed), the message gives the new and the saved
    values.
  - The load message starts "Design loaded: {quantity} × {name}." and adds any of those notes.
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
  an M-series Mac). The hardening tests fail above 50 ms.
- **Key format:** `"{u|s}:{L}x{W}x{H}:{nx}{ny}{nz}"`. `u`/`s` means upright or not, and the
  dimensions are rounded mm. Keys are only used to select a layout in the UI; they aren't stored.

**Ranking (`compareLayouts`):**

1. `stable` first. Stable means `external.H ≤ 1.5 × min(external.L, external.W)`
   (`limits.stableHeightRatio`).
2. Smaller `externalVolumeM3`. Volumes within **3%** of each other (`defaults.volumeTolerance`)
   count as equal.
3. Lower external height.

Element `[0]` is the recommended layout.

`utilization = n·a·b·h / (L·W·H)` uses the interior and part bounding boxes.

### 7.3 Construction sizing (`resolveConstruction`)

Values are the defaults; the standards field is in brackets (§6.4).

| Item | Rule |
|---|---|
| Panel plywood (walls, lid, separators) | Auto: payload ≤ 150 kg [`construction.panelLightMaxKg`] → **12 mm** [`stock.panelPlywoodMm.light`]; ≤ 500 kg [`panelMediumMaxKg`] → **15 mm** [`medium`]; otherwise **19 mm** [`heavy`]. Overridable by hand with 12 / 15 / 19 |
| Floor plywood | Always **19 mm** [`stock.floorPlywoodMm`] |
| Skids | Payload ≤ 700 kg [`construction.heavySkidOverKg`] → **89 × 89** (4×4) [`stock.skidMm.standard`]; otherwise **89 × 140** (4×6, tall) [`stock.skidMm.heavy`] |
| Skid count | `max(2, ceil(externalWidth / 800) + 1)` [`construction.skidSpacingMm`], evenly spread across the width |
| Cleats | **19 × 89** (1×4) [`stock.cleatMm`], returned as `construction.cleat` |

**`structureAllowance`** is what the structure adds to the interior. Here `t` is the panel
thickness and `ct` is the cleat thickness (19, `construction.cleat.thick`):

```
[ 2(t + ct),  2(t + ct),  skid.tall + floor + t + ct ]
```

### 7.4 Crate geometry (`designCrate`)

All coordinates are relative to the interior origin, with `cw = 89` (cleat width,
`stock.cleatMm.wide`).

| Member | Min corner → size |
|---|---|
| Floor | x, y from `−t−ct`, spanning the full external footprint; z ∈ [−floor, 0] |
| Skids | Under the floor, full external length along X; z ∈ [−floor−skid.tall, −floor] |
| Side walls (±Y) | Panel x ∈ [−t, L+t], thickness t, outside y ∈ [0, W], height H |
| Side cleats | Outside each side panel. Top and bottom horizontals, plus verticals at ≤ 600 mm spacing (`construction.maxCleatSpacingMm`) |
| End walls (±X) | Panel spans y ∈ [0, W], fitted between the side panels |
| End cleats | Outside each end panel. They span the full external width, so they wrap the corners over the side cleats |
| Lid | Panel over x ∈ [−t, L+t], y ∈ [−t, W+t] at z = H. Two long edge cleats on top, plus cross-cleats at ≤ 600 mm |

Each member is tagged where it is created:

| Assembly | Face | Labels |
|---|---|---|
| `base` | `base` | Floor, Skid |
| `sides` | `side-` (front) / `side+` (back) | Side panel, Side rail (top and bottom cleats), Side upright (vertical cleats) |
| `ends` | `end-` / `end+` | End panel, End rail, End upright |
| `lid` | `lid` | Lid panel, Lid edge cleat, Lid cross cleat |
| `inside` | `inside` | Bearer, Layer separator, Blocking post |

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
- **Blocking posts:** one per side (±X, ±Y) of every part, centred on that side:
  - **Width:** 89 (`stock.blockWidthMm`), or the part's side length if that is shorter.
  - **Thickness:** equal to the gap on that side (the clearance at a wall, or `partGap` next to
    another part).
  - **Height:** from the layer's floor (the crate floor or a separator) up to the next separator,
    or for the top layer, to the part's top. This means the posts also carry the layer above.
  - Posts are only made when the gap is ≥ 19 mm (`construction.minBlockingGapMm`).
  - Posts shared by two neighbouring parts are de-duplicated by rounded position and size.

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
  designs; a shop can enter its own prices.
- **Screws** (spacings from `rates.screwSpacingMm`: `cleat` 150, `skid` 300, `panelJoint` 200):
  - each cleat: `ceil(len/150)+1`
  - each skid: `ceil(len/300)+1`
  - each block or bearer: 2
  - walls-to-floor plus lid-to-walls: `2·ceil(2(L+W)/200)`
  - corners: `4·ceil(H/200)`
- **BOM:** members are grouped by `(assembly, label, stock, cut)`; that string is the line's
  `key` and each member's `bomKey`.
  - **Plywood:** stock is `"{thickness} mm"` and cut is `"{largest} × {second}"`.
  - **Lumber:** stock is `"{smallest} × {middle}"` and cut is `"{length}"`.
  - Regrouping by label instead of kind changes how many lines there are, not the total quantity.
- **CSV** (always metric): four `#` header lines (part id and name; part material and mass each;
  external size and gross; layout), then
  `component,material,stock,cut_mm,qty` with component as `"{Assembly}: {label}"`, then a final
  wood-screws line.

### 7.7 Checks

`designCrate` returns every rule, passed or not, in a fixed order. The UI sorts cautions first,
then passes, then info.

**Shipping is domestic only** (US truckload or LTL in a 53' dry van). Export concerns (ISPM-15
lumber, ocean containers, air freight) are out of scope, so there is no export check.

| id | Pass (`ok`) | Problem | Rule |
|---|---|---|---|
| `door` | Fits a 53' dry van | caution: Too big for a 53' dry van | external L ≤ 16000 mm, W ≤ 2489 mm, H ≤ 2743 mm (`limits.trailerMm`) |
| `stable` | Stable footprint | caution: Tip-over risk | `layout.stable` (H ≤ 1.5 × short side, `limits.stableHeightRatio`) |
| `blocking` | Every part is blocked in ("… The smallest gap is 50 mm, between parts.") | caution: Parts are not restrained ("The 10 mm gap between parts is under the 19 mm that blocking needs. …") | The smallest side gap in the drawn crate ≥ 19 mm (`construction.minBlockingGapMm`). The side gaps are `layout.clearance` on X and Y (more than the setting when a tiny crate was padded, §7.2) and the part gap only when there is more than one part along X or Y. The text names the smallest gap and where it is: between parts, to the walls, to the end walls (X) or to the side walls (Y) (#36) |
| `stack` | Stack load is light | caution: Heavy stack on the bottom layer | mass × (nz − 1) ≤ 100 kg (`limits.stackKg`); only reported when nz > 1 |
| `base-rating` | Within the standard base rating | caution: Over 1,000 kg gross | gross ≤ 1000 kg (`limits.baseRatingKg`; the title quotes the limit). The pass text names the skids ("4×4", "4×6", or the size in mm for non-standard stock) |
| `oversize` | — | info: LTL length surcharge likely | external L > 2438 mm (8 ft, `limits.ltlExcessiveLengthMm`; the text gives the limit in feet) |
| `utilization` | — | info: Mostly empty space | utilization < 25% (`limits.lowUtilization`) |
| `cardboard` | — | info: A cardboard box may be enough | part mass ≤ 15 kg, payload ≤ 25 kg and interior L + W + H ≤ 1905 mm (`limits.cardboard`) |

The figures in this table are the defaults. `DRY_VAN_53FT_MM`, `LTL_EXCESSIVE_LENGTH_MM` and
`CARDBOARD_LIMITS` in `crate.ts` are read-only views of them, kept for tests; the checks read
the standards passed in.

**Trailer limits.** Typical published dimensions for a 53' × 102" dry van are an interior of
about 52'6" × 101" × 110" and a rear door opening of about 98–100" × 108–110". The door, not the
interior, limits width and height, so the check uses the low end of the door range: 98" (2489
mm) wide and 108" (2743 mm) high, and the 52'6" (16000 mm) floor for length. Separately, most LTL
carriers add an excessive-length accessorial for handling units over 8 ft, which `oversize`
notes. Forklift and pallet-jack handling is #8.

**When a crate is overkill.** The brief says smaller aluminum parts might ship in ordinary
cardboard boxes. `cardboard` suggests it, while still producing the crate design, when:

- each part is ≤ 15 kg, light enough not to punch through corrugated board. The 11.8 kg
  aluminum housing qualifies; the 21.5 kg steel bracket and 27 kg steel shaft do not.
- the payload is ≤ 25 kg, which leaves room for the box and dunnage under the 65 lb (29.5 kg)
  gross limit of a 32 ECT single-wall box (NMFC Item 222 / UFC Rule 41).
- the crate interior's L + W + H is ≤ 1905 mm (75 in), the same rule's size limit for that box.

Of the sample parts at their suggested quantities, only a single PART-003 triggers it (11.8 kg,
interior 545 × 535 × 354 mm). That is deliberate: one housing fits in a carton, while four or
more (47 kg and up) and the steel parts justify a crate.

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

`explainLayout(layouts, shown, standards?)` takes the same standards as the design, so its
"tie" matches the ranking's tolerance.

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
  - **Green `#7BD88F`** marks passed checks.
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
- All values are in `src/app/globals.css`.

### 8.2 Layout

The canvas fills the window. Four regions float above it:

| Region | Contents |
|---|---|
| Top left (no glass) | "Crate Designer", the tagline, then the part as a mono sentence: id · name; material · mass each · crate gross; measured size · model check; then the change note (§8.5a). Unknown parts get inline underlined name, material and mass fields in the same sentence (§8.5) |
| Upper right island (440 px) | Part name + "Load a part"; the turntable part view (170 px); the tabs; the selected tab's panel, which is the only thing that scrolls |
| Bottom left (no glass) | The credit: "HADRIAN × Eric White", with the name as a solid cursive signature tilted 6° up from the left (`Credit.tsx`), and "Interview Candidate" in narrow Archivo beneath, letter-spaced with SVG `textLength` to span exactly the signature's on-screen width (measured after the script font loads). Above it, any load message (shown only when there is one) |
| Bottom right view bar | Pin bar (when pinned), mode icon, units (mm kg / in lb), View popover, Hide panels |

- **Crate centring:** the crate is centred in the area the overlays leave free, not in the
  window. `DesignerShell` measures the island and sets the insets. `Director` shifts the projection with `camera.setViewOffset` and
  fits the bounding sphere into the free rectangle (insets: left 40, top 96, right = island width
  + 56, bottom 130 px). Hide panels fades out everything except the "Show panels" pill and the
  credit, and keeps only the bottom inset so the crate clears the credit.
- **981–1180 px:** as desktop, with the tagline hidden and a 420 px island.
- **Narrow screens (below 980 px, #42):** the scene stays full-bleed and the island becomes a
  drawer. `DesignerShell` switches on `matchMedia("(max-width: 980px)")`; the CSS is the
  matching block in `globals.css`.
  - **Scene:** the canvas fills the screen; `html` and `body` are `100dvh` with `overflow: hidden`,
    so the page never scrolls. The viewport is `viewport-fit=cover` (`layout.tsx`) and the
    overlays keep clear of notches with `env(safe-area-inset-*)`.
  - **Header** (top left): the title at 24 px without the tagline, and the part sentence at
    11.5 px. Lines wrap between phrases, not inside a value. The header's change note floats
    under it on one line with an ellipsis (full text in its `title`), so it doesn't move the
    framing. A row under the part lines is free for the coming Export pill (#51); the top inset
    is measured, so the crate moves down to make room.
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
  - **Foot:** the load message (when there is one), the **summary chip** (outside size and gross
    weight in amber; tapping it opens the drawer on Overview; it flashes with the Overview on an
    edit), then the compact view bar: mode icon, units and View; no Hide panels. From 600 px
    wide (tablets, phones in landscape) the chip and the bar share one row. The View popover
    opens upward from the right edge, is at most `100vw − 24px` wide and scrolls inside when
    the screen is short. Its gesture hint names pinch and two-finger drag on touch screens.
  - **Touch targets** are at least 44 px: hamburger, close, Load a part, tabs, panel buttons,
    the bar's controls and the popover's switches.
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
| **Overview** (default) | "Crate for N × part"; the outside size in amber; the other-unit size; volume and gross. A chain: Parts → Layout → Walls and lid → Base → Blocking → Gross weight (last dot amber). Crate weight by assembly as bars; hovering a bar highlights that assembly in 3D |
| **Layouts** | The `explainLayout` sentence. Cards with a top-view and side-view SVG drawing, a grid description, outside size, orientation, volume and a volume bar. Badges: "recommended" and "may tip". First 4 shown, then "Show all N layouts". "Use the recommended layout" link when the user has picked another |
| **Cut list** | Grouped by assembly. Piece, stock, cut, qty. Hover a row to highlight; click (or Enter / Space) to pin. Totals for plywood, lumber and screws. Download and Copy (CSV) |
| **Rules** | Quantity (− / input / + and the part's suggested quantities), keep upright, most layers (1–4), gap between parts and clearance to walls (0–150 mm sliders), wall and lid plywood (Auto / 12 / 15 / 19), Reset rules (keeps quantity) |
| **Checks** | Every check, cautions first, with a count badge on the tab when there are cautions |

Quantity lives in Rules, as the handoff asks. Whether that buries the main input is still an
open question for the user (see #20).

### 8.4 3D behaviour

- **Modes:**
  - **closed:** everything on.
  - **open:** the lid and front wall fade out.
  - **exploded:** walls move out 320 mm, the lid moves up 420 mm.
  - The mode icon steps closed → open → exploded. The View popover has camera presets (3D, Top,
    Front, End), switches for lid, front wall, blocking, parts and size labels, and a
    continuous Pull apart slider. A mix that matches no mode shows the "custom" icon.
- **GLB download (#27):** below the slider, an "Include parts" switch (on by default) and
  "Download 3D model (.glb)" save `crate-{part id}-x{quantity}.glb`. The file is built from the
  design data in a fresh three.js scene (`src/lib/exportGlb.ts`), never from the live viewer, so
  it is always the assembled crate: no explode offsets, fades, ghosting or highlight colours.
  - **Units and frame:** metres, Z up, like the input GLBs (§4).
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
  that just fits the whole scene (`MODE_ZOOM` in `Director.tsx`): closed 0.68, open 0.8,
  exploded 1.0. Hide panels moves in a further ×0.82. Mode changes re-frame, so idle auto-play
  glides in and out with the modes.
- **Room for the size labels:** with size labels on, the fit also projects the crate's three
  label anchors (moved out with the walls) at the goal angle and backs the camera off just
  enough that each label, taken as about 88 × 28 px, sits inside the free area. This only ever
  zooms out, so it changes nothing when the labels already fit (the default crate); it keeps
  a long crate's end labels from landing under the island (#43).
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
  - After **6 s** with no pointer, wheel, key or touch input anywhere, the camera turns at
    **0.18 rad/s** (slowed from the handoff's 0.3 at the user's request) and steps closed → exploded → open → exploded → …, half a turn per mode. The
    next mode starts 0.12 turn early so it lands as the half-turn completes.
  - Any input stops it at once. It holds while a row is pinned, anything is hovered or the
    narrow-screen drawer is open (#42), and resumes from the mode on screen. It runs on first load.
  - With `prefers-reduced-motion` it never runs, and mode changes and camera moves are instant.
- **Size lines:**
  - **Crate:** length along the front bottom edge, width along the right bottom edge, height at
    the back right corner. Their groups slide out with the walls when exploded; the numbers stay
    the assembled size.
  - **Part:** one part (top layer, front row, rightmost) carries ice-blue dimensions in open and
    exploded modes only.
  - Lines are drei `<Line>` without depth testing.
  - **Labels** are plain DOM (`SizeLabels`), positioned each frame by projecting their anchors.
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
- **Part view:** a second `<Canvas>` in the island turns the part at 0.25 rad/s (slowed from
  the handoff's 0.45 and reversed, at the user's request). The turn is driven from frame time in
  `useFrame`, not OrbitControls' `autoRotate`, which steps per frame and runs double speed at
  120 Hz. Dragging stops
  it; it resumes from the same angle after the shared 6 s idle. Double-click resets tilt and
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
- **Rejected files:** text `.gltf`, Draco- or Meshopt-compressed files, and non-GLB data, each
  with a plain message.
- Files are read through `URL.createObjectURL`, so nothing is uploaded anywhere.

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
- **The note** (`ChangeNote`, `role="status"`): "Gross 16 → 20 kg", up to two changes then
  "+N more", or "No change to the crate". Changes that format the same in the selected units are
  dropped (`visibleChanges`), so it never says "16 → 16 kg". It sits under the header for part
  edits and over the foot of the island's part view for rules and layout edits. It fades over its
  last 1.5 s.
- **Highlights** (`Flash`): changed values in the header gross and the Overview (outside size,
  gross, payload, layout grid, wall plywood, skids, floor, empty crate) flash gold for 1.2 s.
- **`prefers-reduced-motion`:** no flash and no fade; the note still shows, then goes.

## 9. Persistence

**Shop standards** (§6.4) are saved in `localStorage` under `crate-designer.shop-standards.v1`
(`src/state/standardsStorage.ts`), as the same JSON envelope as the download. Every
`setStandards` / `resetStandards` saves; the defaults are saved as no entry, so a later change
to the shipped defaults reaches users who never customised them. `StandardsLoader` applies the
saved standards in an effect after the first render, so the server render and the first client
render match; the design then re-computes once. Loading is safe: unreadable JSON, another
version or an invalid value falls back to the defaults with a `console.warn`, and storage that
is missing or throws (server, private mode, quota) is treated as empty. The version is in the
key, so an incompatible future format starts fresh rather than misreading old data.

A design can be saved to and reopened from a JSON file (§6.5), but isn't stored in the app.
Everything else lives in memory. The plan for designs is SQLite WASM with the `opfs-sahpool`
VFS, in a Web Worker, behind a typed repository. See `DATA_STORE.md` and `schema.sql`; shop
standards could move there (one row per shop) when accounts exist.

## 10. Invariants and tests

`bun run test` runs vitest over `src/**/*.test.ts`.

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
  packed, the crate is sound, and each design takes under 50 ms.
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
  exactly the plywood volume × the rate change; a density change changes the weights; a lower
  base rating, stack limit, trailer length or LTL length flips `base-rating`, `stack`, `door`
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

**`src/domain/designFile.test.ts`** checks the design file (§6.5, #28):

- The written file has the kind, version, app, part, settings, layout key and summary
  (PART-001 × 4: 932 × 652 × 497 mm), is pretty-printed, and round-trips byte for byte.
- `parseDesignFile` rejects bad JSON, a non-design, a newer or missing version, a bad field
  (named in the message), out-of-range settings, a non-GLB model and an unknown source, and
  drops unknown keys.
- **Reproduction:** for every catalog part × suggested quantity × keep-upright, with the
  recommended and the runner-up layout, save → parse → restore gives no notes, the same layout,
  outside size and gross, and a byte-identical CSV cut list. A custom part does the same.
- A layout key that no longer exists falls back to the recommended layout with a note; a
  heavier catalog part or a changed summary gives a note with the new and saved values.

**`src/state/store.test.ts`** checks `setPartDetails`: name and material update without
changing the layout pick or re-framing, a mass recomputes the payload and clears the stand-in
flag, invalid input changes nothing, and catalog parts are read-only. `loadDesign` keeps the
given settings and layout pick (unlike `setPart`).
flag, invalid input changes nothing, and catalog parts are read-only. It also checks
`lastChange`: cleared by loading a part; a mass edit on a 1 mm part records gross 16 → 20 kg and
payload with source `mass`; name and material edits record an empty diff; rules and layout edits
record theirs; a units change doesn't; and a design that becomes a problem leaves nothing.

**`src/domain/diff.test.ts`** checks `diffDesigns`: equal designs and a missing design give `[]`;
a heavier 1 mm part changes only gross and payload; a heavy load steps up the plywood, skids,
tare and outside size; a quantity change moves the grid and outside size; changes come in
`DESIGN_FIELDS` order; and floating-point noise in weights is not a change.

**`src/lib/partFields.test.ts`** checks the header's field helpers: kg and lb display, parsing
(optional unit, comma decimal, one-line reasons for blank, non-numeric and non-positive text),
lb → kg → lb round trips, ↑ / ↓ steps in either unit with a floor, the fallback width, and the
change note text ("Gross 16 → 20 kg", lb and inch fractions, "+N more", and "No change to the
crate" when the changes round away).

**`src/lib/units.test.ts`** checks formatting and 1/16″ fractions. **`src/lib/loadPart.test.ts`**
checks GLB validation (samples accepted; non-GLB, Draco and Meshopt rejected), names from file
names, and filtering a `parts.json`. For design files: catalog vs custom source, a catalog
design restored from the bundled catalog, a custom design without its GLB naming the file,
other JSON still read as a catalog, and plain messages for a bad design or bad JSON.

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

### End-to-end UI tests (#34)

`bun run e2e` runs Playwright (`playwright.config.ts`, specs in `e2e/`, excluded from vitest).
It builds the production app with `NEXT_PUBLIC_E2E=1`, serves it on port 3320 and drives
headless Chromium with SwiftShader WebGL, so the canvas really renders. Four projects: desktop
1440 × 900 runs every spec except `*.narrow.spec.ts` and `*.mobile.spec.ts`; narrow 900 × 900
(the drawer layout with a mouse) runs only `*.narrow.spec.ts`; mobile-390 (390 × 844) and
mobile-360 (360 × 800), both with touch, `isMobile` and 2× pixels, run only `*.mobile.spec.ts`
(#42). Tests run with `prefers-reduced-motion: reduce`, so idle auto-play is off and
transitions are instant (§8.4); one test turns motion back on. Each flow saves named full-page
screenshots to `e2e/screenshots/` (git-ignored); CI uploads them as `e2e-screenshots` with the
HTML report as `playwright-report`.

- **Test hook:** the 3D scene isn't in the DOM, so `E2EProbe` (`src/components/viewer/`)
  exposes a read-only `window.__crate` with `getState()` (mode from the view targets, view
  switches, camera distance, angles and target, pin and hover keys, `anim` values, auto-play,
  the outside size, problem id, tab, units, quantity, frame count) and `canvasCoverage()` (share
  of canvas pixels drawn). It is loaded only when built with `NEXT_PUBLIC_E2E=1`.
  `next.config.ts` always inlines the flag (`"0"` when unset), so normal builds drop the branch
  and don't bundle the module. Everything else is found by role, label or text; the only test
  id is `size-labels` (the labels are `aria-hidden`).
- **Coverage:**
  - `01-load`: PART-001 × 4, the header line and "model matches catalog", 932 × 652 × 497 mm,
    the canvas draws.
  - `02-tabs`: Overview chain and weight bars; Layouts cards with "recommended"; Cut list
    groups; Rules controls; Checks with "Fits a 53' dry van" and no count badge.
  - `03-rules`: quantity 8 gives 938 × 658 × 823; a typed 500 clamps to 200 and shows the
    note "Quantity is 1–200; set to 200"; Reset rules
    restores the defaults and keeps the quantity.
  - `04-units`: mm → in in the header, Overview (36.7 × 25.7 × 19.6 in) and size labels, and
    back.
  - `05-cutlist`: hovering a row sets the hover key, clicking pins it and shows
    "Showing N × piece", Escape clears it.
  - `06-view`: the mode icon steps closed → open → exploded with growing camera distance; the
    View popover is on top of the island (hit-tested); camera presets; switches and Pull apart;
    Hide panels keeps the credit; idle auto-play starts after 6 s without input; from the
    exploded view, "Download 3D model (.glb)" saves `crate-PART-001-x4.glb` with the `glTF`
    header, a matching length and named nodes (`Crate`, `Side walls`, `Side rail 1`, `Part 1`
    … `Part 4`), and with "Include parts" off the file has no `Parts` node; the first framing
    aims at the crate's middle; for PART-001 × 4, PART-002 × 1 and × 4 and PART-003 × 8 no
    size label overlaps the island or leaves the window, in every mode.
  - `07-load-parts` (through the hidden file input, in-memory files): a catalog GLB fills in
    mass and material (PART-002: 1692 × 334 × 411) and has no fields; an unknown GLB gets the
    stand-in tag, caution and Checks badge until name, material and mass are entered (Enter
    commits); a text `.gltf` is rejected; a 30 m part (a generated GLB read as millimetres)
    shows the over-20 m problem.
  - `08-layout`: at 1440 × 900 the document doesn't scroll and the island panel does; at
    900 px the canvas is full-bleed, the summary and view bar share the bottom row, the drawer
    opens from the hamburger with every tab and no page scroll, and a scrim click closes it.
  - `12-mobile` (#42, at 390 × 844 and 360 × 800): the page doesn't scroll, the canvas is
    full-bleed and the size labels sit between the header and the summary; the summary shows
    932 × 652 × 497 mm and the gross in amber; the hamburger opens the drawer (a modal dialog
    85–90 vw wide, focus on close), Tab stays inside it, and Escape, the scrim and the close
    button each close it and return focus to the hamburger; every tab works inside it with no
    page scroll and only the panel scrolls; drawer controls are at least 44 px; tapping the
    crate's front opens the drawer on Cut list with the pinned row in view; the view bar and
    the View popover (above the bar) stay on screen; Load a part from the drawer loads
    PART-002; resizing to 1440 px closes the drawer and shows the desktop island, back to
    narrow with Hide panels off, and landscape keeps the drawer layout; with motion on, idle
    auto-play holds while the drawer is open and starts after it closes. Screenshots
    `42-<project>-closed-summary`, `-drawer-overview`, `-drawer-cutlist-pinned` and
    `-view-popover`.
  - `11-design-json`: Download design (.json) gives `crate-design-PART-001-x4.json` with the
    expected part, settings and summary (932 × 652 × 497); a catalog design (PART-002 × 8, a
    picked layout) reopens on a fresh page with the same quantity, outside size and cut list,
    and saving it again gives the same file; a stale layout key falls back with a message; a
    custom design without its GLB names `widget_v2.glb` and changes nothing, and with it
    restores the entered name, material and mass; a newer `schemaVersion` is refused.
  - `09-part-header` (#40, #39): a catalog part reads as the same sentence with no fields; each
    field edited by keyboard in Tab order, with the stand-in (dashed) showing and clearing, no
    box, the sky focus underline and ↑ / Shift+↓ steps; an invalid mass shows its reason (gold,
    `aria-describedby`), Enter doesn't save it and Escape reverts, and blur restores a blanked
    name; a 1 mm part (generated GLB) at 10 → 14.71 kg updates the header to "crate gross
    20 kg", notes "Gross 16 → 20 kg, parts 10 → 15 kg" and highlights the Overview (motion on);
    +0.1 kg and a material edit say "No change to the crate", and the note goes; imperial mass
    shows 22.05 lb, takes 30 lb and ↑, and reads back as 13.653 kg. Header crops are saved as
    `09-header-*`.
  - `10-shop-standards`: the section is collapsed by default and shows all five groups when
    opened; changing the plywood cost to 2200 shows "Customised" and raises the Overview's
    "$ of wood", which survives a reload; Reset to defaults restores the cost (also after a
    reload); a light-panel threshold of 50 kg switches the Overview to 15 mm ply; a negative
    density is flagged and reverts on blur.
- **When the UI changes,** update the affected spec in the same PR, run `bun run e2e`, and use
  its screenshots in the PR. Tests have no retries, so a flaky test is a bug to fix.

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
| Settings are clamped at the store, bad values rejected per field | A slider or typed value just past a limit should still do something useful; NaN or a wrong type has no sensible nearest value, so the last good one stays | A typed quantity that is clamped or rejected gets a short note by the field (#36); nothing else is typed |
| `computeDesign` returns a `problem` instead of throwing | The UI can always explain an empty screen, in domain wording | One more field to check alongside `design` |
| Tiny parts get a 178 mm minimum interior, padded as clearance | Keeps the cleat frame buildable and the board-bounds invariant true without special-casing the geometry | A 1 mm part ships in a crate far bigger than it needs |
| House rules are one zod-validated `ShopStandards` object passed into `computeDesign`, defaulting to `DEFAULT_STANDARDS` (#19) | Makes the PM's tribal knowledge explicit and editable; the domain stays pure (no store or storage access), and every existing call and test works unchanged with the defaults | Every domain function takes one more argument; a few exports remain as views of the defaults for tests |
| Shop standards persist in `localStorage` under a versioned key, loaded after mount | No backend yet; a PM's house rules should survive reloads. Loading after mount avoids a hydration mismatch, and invalid data falls back to the defaults with a warning | Per browser, not per shop: share them with Download / Load standards until there are accounts (§9) |
| Standards are edited in fixed units (mm, kg, $/m³), not the display units | They are shop configuration, entered once from stock and price lists that are usually metric here | An imperial user converts by hand |
| Manual panel thickness stays 12 / 15 / 19 | `CrateSettingsSchema` and its tests fix those literals; only Auto reads `stock.panelPlywoodMm` | A shop with 18 mm stock gets it from Auto, not from the manual buttons |

## 12. Known limitations and roadmap

These are tracked in [GitHub issues](https://github.com/0xevm1/shipping-ui/issues):

| # | Topic |
|---|---|
| #1 | Commit the prototype as a baseline |
| #2 | README and this spec |
| #3 | Upload a custom GLB part, with user-entered name, mass and material. Loading and mass entry landed with #20; name and material entry followed |
| #4 | Capture and export LLM logs (a deliverable) |
| #5 | Architecture and decision notes for the on-site walkthrough |
| #6 | Cradles for long or cylindrical parts. Today the shaft is held only by flat bearers and one post per side |
| #7 | Structural sizing rules for skids, floor and lid, replacing the mass thresholds |
| #8 | Centre of gravity and forklift handling |
| #9 | Printable shop-floor build sheet |
| #10 | Edge-case and input hardening |
| #11 | Explain why a layout was chosen (closed; `explainLayout` landed with #20) |
| #12 | Flag when a wooden crate is overkill (for example, light aluminum that a carton would do) |
| #13 | Shipping-mode constraints (LTL, container, air) |
| #14 | Shareable design via URL |
| #15 | Imperial / metric units toggle (landed with #20) |
| #16 | Geometry-aware blocking for irregular parts |
| #19 | Shop standards configuration (§6.4). Stock, defaults, thresholds, limits and material rates landed; labour rates need a labour-time model first |
| #20 | UX redesign: full-bleed scene, glass island, tabbed detail |

Other known gaps:

- No limit on maximum crate size or weight beyond the 20 m part limit (§7.9), and no splitting a
  batch across several crates.
- No top hold-down blocking under the lid.
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
- **Dev server gotcha:** the scaffold's `@tailwindcss/turbopack` loader rule in `next.config.ts`
  doesn't always pick up edits to `globals.css`. If a style change doesn't show, restart
  `bun run dev` (and delete `.next/` if needed). Production builds are unaffected.
- Before you push, run `bun run test`, `bun run lint` and `bun run build`. For UI changes, also
  run `bun run e2e` and update the specs in `e2e/` (§10); CI's `e2e` job runs them on every PR.
- Prefer roles and accessible names for anything the e2e tests need to find. Add a
  `data-testid` only where there is no accessible handle, and read 3D state through the
  `window.__crate` hook (`E2EProbe`) rather than adding DOM for tests.
