# Crate Designer

A browser app that designs **custom wooden shipping crates** for one or more identical
machined parts. Pick a part and a quantity. The app packs the parts as compactly as it can,
builds a crate around them from plywood, lumber and wood screws, and shows the result in 3D. It
also gives a cut list, weights and handling warnings.

Built for Hadrian's Shipping Crate Designer exercise. The full behaviour (algorithms, rules,
invariants) is in [`docs/SPECIFICATION.md`](docs/SPECIFICATION.md).

## Quick start

```bash
git clone git@github.com:0xevm1/shipping-ui.git
cd shipping-ui
bun install
bun run dev          # → http://localhost:3000
```

| Command | What it does |
|---|---|
| `bun run dev` | Dev server with hot reload |
| `bun run build && bun run start` | Production build and serve |
| `bun run test` | Domain unit tests (vitest) |
| `bun run lint` | ESLint |

- **Requirements:** [Bun](https://bun.sh) 1.3+ for installing and running scripts (the lockfile
  is `bun.lock`), and Node 20+, which Next.js runs on. Verified on Bun 1.3.5, Node 24,
  Next.js 16.4, three.js r187.
- **Use `bun run test`, not `bun test`.** `bun test` runs Bun's own test runner instead of
  vitest.
- **No Bun?** `npm install && npm run dev` also works. It resolves fresh versions because
  there's no `package-lock.json`.
- Nothing else is needed: no environment variables, backend or database. The sample GLBs are
  bundled in `public/parts/`.

## Who it's for

The **shipping or packaging lead, or the shop carpenter**, who today sizes crates by hand from
part drawings. They need a crate they can build that protects the parts, is cheap and fast to
make, and is easy to handle with a forklift. They want a cut list, not a CAD model.

## What v1 does

1. **Choose a part** from the catalog (`src/data/parts.json`): 360 mm bracket, 1.53 m shaft, or
   aluminum housing.
2. **Set the quantity and packing rules:** keep parts upright, max stacked layers, gap between
   parts, clearance to walls, and plywood thickness (or Auto).
3. **Get the best layout automatically.** The app tries every orientation and grid that holds
   the batch, and ranks them stable first, then smallest outside volume, then lowest height. The
   runners-up are listed, and you can click one to switch.
4. **See the crate in 3D:** cutaway, assembled or exploded. The real part models sit in each
   slot. Each GLB's measured size is checked against the catalog.
5. **Read off the build data:**
   - outside and inside dimensions (mm and inches)
   - tare, payload and gross weight
   - space utilization and a rough material cost
   - plywood area, lumber length and screw count
   - warnings for oversize, tip-over, heavy stacks and export lumber
6. **Download the cut list** as CSV.

### The crate it designs

- **Base:** a plywood floor on lumber skids. Forklift entry is from the ends.
- **Walls and lid:** plywood panels, each stiffened by a frame of 1×4 cleats.
- **Inside:** wood holds the parts in place. Bearers lift the bottom layer, a plywood separator
  sits between layers, and blocking posts fill every gap.
- **Fasteners:** wood screws only.
- **Sizing:** board sizes go up with payload mass.

## Scope and non-goals

**In scope:** one part type per crate, any quantity from 1 to 200, wood plus basic fasteners only.

**Out of scope for v1 (deliberately):**

- **Disposable packing materials** (foam, bubble wrap, stretch film). The brief excludes them.
- **Mixed-part crates.** A crate never mixes part numbers.
- **Certified engineering.** Sizing rules are reasonable shop defaults. They are not ASTM D6039,
  ISPM-15 or a structural calculation.
- **Metal hardware** (brackets, banding, lag bolts).
- **Persistence and accounts.** Nothing is saved yet. The plan is in
  [`docs/DATA_STORE.md`](docs/DATA_STORE.md).
- **Custom part upload.** Only the three catalog parts for now (see #3).

## Conventions

| | |
|---|---|
| **Units, internally** | Millimetres and kilograms everywhere in `src/domain/`. The UI also shows inches |
| **Axes** | Right-handed, **Z up**: the same frame as the source GLBs. X is the crate's long axis (the skids run along X) |
| **GLB files** | Metres, Z up, not centred on their origin. The viewer scales by ×1000 and re-centres each part on its bounding box |
| **three.js** | Y up, metres. A single root group in `CrateViewer` rotates Z-up → Y-up and scales mm → m. Nothing else converts |
| **Crate origin** | The interior min corner, on the top face of the floor |

## Key assumptions

- **Packing uses bounding boxes.** Each part is treated as its axis-aligned bounding box. This is
  exact for boxy parts and wastes space on irregular ones, such as the open housing. There's no
  nesting.
- **Lumber sizes** are nominal US sizes, with actual dimensions in mm:
  - 1×4 cleats are 19 × 89
  - 4×4 skids are 89 × 89
  - 4×6 skids are 89 × 140, used when the payload is over 700 kg
  - blocking is 89 wide, cut to fit each gap
- **Plywood:** the floor is always 19 mm. With Auto, walls and lid are 12 mm up to 150 kg of
  payload, 15 mm up to 500 kg, and 19 mm above that.
- **Densities and cost are placeholders:** plywood 600 kg/m³ and lumber 480 kg/m³. Cost uses
  $1,100/m³ for plywood and $650/m³ for lumber. It's only good for comparing layouts, not for
  quoting.
- **Part masses** come from the catalog as given. They are not derived from mesh volume.
- **Stability:** a crate counts as "stable" if its outside height is at most 1.5× its narrowest
  base side.
- **Screw count** is an estimate:
  - cleats: one every 150 mm
  - panel joints: one every 200 mm
  - skids: one every 300 mm
  - blocking: 2 per block

All of these are named constants at the top of `src/domain/crate.ts` and
`src/domain/packing.ts`.

## Project layout

```
src/domain/        pure TypeScript, no React; all crate logic, unit-tested
src/components/    React UI; viewer/ is client-only three.js (react-three-fiber)
src/data/          parts.json catalog
public/parts/      GLB models
docs/              SPECIFICATION.md, DATA_STORE.md, schema.sql
```

## Docs

- [`docs/SPECIFICATION.md`](docs/SPECIFICATION.md): the full spec covering the data model,
  algorithms, construction rules, invariants, decisions and roadmap.
- [`docs/DATA_STORE.md`](docs/DATA_STORE.md): the client-side persistence plan (SQLite WASM on
  OPFS).
- [`docs/schema.sql`](docs/schema.sql): the proposed tables.

The roadmap is tracked as GitHub issues: see the
[shipping-ui issues](https://github.com/0xevm1/shipping-ui/issues).
