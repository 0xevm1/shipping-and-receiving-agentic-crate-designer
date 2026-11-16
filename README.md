# Crate Designer

A prototype that designs wooden shipping crates for one or more identical machined parts. Pick a
part and a quantity. The app packs the parts, builds the crate around them out of plywood and
lumber, and renders the result in 3D. It also gives a cut list, weights and warnings.

**Who it's for:** the shipping/packaging lead or shop carpenter who today sizes crates by hand
from part drawings.

## Run it

```bash
bun install
bun run dev        # http://localhost:3000
bun run test       # domain unit tests (vitest) — note: `bun test` would run Bun's own runner instead
```

Uses [Bun](https://bun.sh) 1.3+ as the package manager (`bun.lock`); Next.js itself still runs on Node 20+. Tested on Node 24, Next.js 16, three.js r187.

## What it does

1. **Part:** choose from the catalog (`src/data/parts.json`, validated with zod at load time).
2. **Quantity and packing rules:** keep parts upright or allow any orientation, the maximum
   number of stacked layers, the gap between parts, and the clearance to the walls.
3. **Layout search:** enumerates every orientation × nx·ny·nz grid that holds the quantity, and
   ranks them: stable crates first, then smallest external volume, then lowest height. The best
   layout is chosen automatically. Any of the alternatives can be picked from the table.
4. **Crate construction:** a plywood floor on lumber skids (forklift entry from the ends),
   plywood walls and lid with 1×4 cleat frames, and screws only (no metal brackets). Inside,
   wood dunnage holds the parts: bearers under the bottom layer, a plywood separator between
   layers, and blocking posts in every gap. Board sizes scale with payload mass.
5. **Outputs:** external and interior dimensions (mm and inches), tare, gross, space
   utilization, a rough material cost, a cut list (downloadable CSV) and warnings (oversize,
   tip-over, heavy stacks, ISPM-15).
6. **3D view:** cutaway, assembled or exploded. The real GLB is placed in every slot, and the
   GLB's measured bounds are checked against the catalog dimensions.

## Architecture

```
src/
  data/parts.json            catalog (copied from Sample Parts/)
  domain/                    pure TypeScript, no React; unit-tested
    schema.ts                zod schemas: Part, PartsCatalog, CrateSettings
    catalog.ts               parse + lookup
    orientations.ts          6 axis-aligned rotations; rotated bbox via three.js math
    packing.ts               grid enumeration + ranking → Layout
    crate.ts                 Layout → boards (Member[]), BOM, weights, screws, warnings
    design.ts                computeDesign(settings) — the single entry point the UI calls
    export.ts                cut list CSV
  components/
    CrateDesigner.tsx        page state (settings, selected layout, view mode)
    ControlsPanel.tsx        inputs
    SummaryPanel.tsx         stats, warnings, alternatives, cut list
    viewer/                  client-only (next/dynamic, ssr:false)
      CrateViewer.tsx        <Canvas>, lights, camera framing
      CrateModel.tsx         one box mesh per board
      PartInstances.tsx      GLB loaded once, cloned per slot
docs/
  DATA_STORE.md              client-side persistence plan (SQLite WASM + OPFS)
  schema.sql                 proposed tables
```

**Key decisions**

- **One coordinate convention.** The domain works in millimetres, Z-up, the same as the GLBs.
  A single root group in the viewer rotates Z-up → Y-up and scales mm → m, so nothing else
  converts units.
- **The domain is pure and synchronous.** `computeDesign()` is cheap (it searches a few hundred
  layouts), so the UI just recomputes it in `useMemo` on every input change. No store library is
  needed yet.
- **Orientation math is shared.** Packing and rendering both use the same three.js `Euler`, so
  the packed bounding boxes and the rendered models can't disagree.
- **Packing uses bounding boxes.** It's exact for boxes and conservative for irregular parts
  (no nesting). This is the main efficiency limit; see the next steps.
- **Every board is an explicit box.** The same `Member[]` list drives the 3D view, the cut
  list, the weight and the screw count, so they always agree.

## Assumptions and limits

- Catalog masses are used as given (not derived from the mesh). Material densities: plywood
  600 kg/m³, lumber 480 kg/m³. Cost rates are placeholders.
- Construction rules (panel thickness by payload, skid size, cleat spacing ≤ 600 mm, skid count
  by width) are reasonable shop defaults, not certified engineering. They live as named
  constants at the top of `src/domain/crate.ts`.
- Crates hold one part type only, which the brief requires.
- Nothing is persisted yet. See `docs/DATA_STORE.md`.

## Next steps

- Persist designs and revisions with SQLite WASM (see the plan).
- Upload a GLB for a new part. Its bounds come from the mesh; mass is entered by the user.
- Nested or interlocking packing for irregular parts (alternating orientations, convex-hull
  checks).
- Constraints such as maximum crate size and maximum gross weight per crate (which would split
  a batch across several crates), plus shop-specific lumber stock.
- Printable build sheet with dimensioned drawings.
