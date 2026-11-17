# Crate Designer

<p align="center">
  <a href="https://github.com/0xevm1/shipping-ui/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/0xevm1/shipping-ui/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://bun.sh"><img alt="Bun 1.3.5" src="https://img.shields.io/badge/Bun-1.3.5-F9F1E1?style=for-the-badge&labelColor=002548&logoColor=white&logo=bun"></a>
  <a href="https://nextjs.org"><img alt="Next.js 16.4.6" src="https://img.shields.io/badge/Next.js-16.4.6-000000?style=for-the-badge&labelColor=002548&logoColor=white&logo=nextdotjs"></a>
  <a href="https://react.dev"><img alt="React 19.3.0" src="https://img.shields.io/badge/React-19.3.0-149ECA?style=for-the-badge&labelColor=002548&logoColor=white&logo=react"></a>
  <a href="https://www.typescriptlang.org"><img alt="TypeScript 5.9.3" src="https://img.shields.io/badge/TypeScript-5.9.3-3178C6?style=for-the-badge&labelColor=002548&logoColor=white&logo=typescript"></a>
  <a href="https://threejs.org"><img alt="three.js r187" src="https://img.shields.io/badge/three.js-r187-049EF4?style=for-the-badge&labelColor=002548&logoColor=white&logo=threedotjs"></a>
  <a href="https://r3f.docs.pmnd.rs"><img alt="React Three Fiber 9.8.2" src="https://img.shields.io/badge/React_Three_Fiber-9.8.2-F3A000?style=for-the-badge&labelColor=002548&logoColor=white&logo=react"></a>
  <a href="https://drei.docs.pmnd.rs"><img alt="drei 10.7.9" src="https://img.shields.io/badge/drei-10.7.9-F3A000?style=for-the-badge&labelColor=002548&logoColor=white"></a>
  <a href="https://zustand.docs.pmnd.rs"><img alt="Zustand 5.1.0" src="https://img.shields.io/badge/Zustand-5.1.0-453F39?style=for-the-badge&labelColor=002548&logoColor=white"></a>
  <a href="https://zod.dev"><img alt="Zod 4.6.7" src="https://img.shields.io/badge/Zod-4.6.7-3E67B1?style=for-the-badge&labelColor=002548&logoColor=white&logo=zod"></a>
  <a href="https://tailwindcss.com"><img alt="Tailwind CSS 4.3.3" src="https://img.shields.io/badge/Tailwind_CSS-4.3.3-06B6D4?style=for-the-badge&labelColor=002548&logoColor=white&logo=tailwindcss"></a>
  <a href="https://vitest.dev"><img alt="Vitest 5.1.0" src="https://img.shields.io/badge/Vitest-5.1.0-6E9F18?style=for-the-badge&labelColor=002548&logoColor=white&logo=vitest"></a>
  <a href="https://eslint.org"><img alt="ESLint 9.39.5" src="https://img.shields.io/badge/ESLint-9.39.5-4B32C3?style=for-the-badge&labelColor=002548&logoColor=white&logo=eslint"></a>
</p>

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

- **This project uses [Bun](https://bun.sh)** (1.3+) to install packages and run every script;
  the lockfile is `bun.lock`. Next.js itself runs on Node 20+. Verified on Bun 1.3.5, Node 24,
  Next.js 16.4 and three.js r187.
- **Bun only:** a `preinstall` check (`scripts/require-bun.mjs`) stops `npm`, `yarn` or `pnpm`
  installs with a message pointing to `bun install`.
- **Use `bun run test`, not `bun test`.** `bun test` runs Bun's own test runner instead of
  vitest.
- **Pinned versions:** `package.json` lists exact versions only (#23), and `bunfig.toml` makes
  `bun add` save exact versions too. To upgrade, bump a version deliberately
  (`bun add three@0.188.0`), then run the tests, lint and build.
- Nothing else is needed: no environment variables, backend or database. The sample GLBs are
  bundled in `public/parts/`.

## Pull requests

Every pull request to `main`, and every push to `main`, runs
[CI](.github/workflows/ci.yml): `bun install --frozen-lockfile`, lint, typecheck, tests and
build. **A green CI run is required before merging.** GitHub can't enforce this on a private
repo without GitHub Pro, so it's a team rule for now. The workflow file has the `gh api`
command that adds a ruleset requiring CI on `main` once the repo is upgraded or made public.

## Who it's for

The **project manager who owns shipping and receiving**. Parts get dropped off and they have to
decide how to crate them, today from tribal knowledge. They need a crate the shop can build that
protects the parts, is cheap and fast to make, and is easy to handle with a forklift. The screen
answers "what crate do I build for this?" at a glance, and the shop gets a cut list, not a CAD
model.

## What v1 does

The 3D crate fills the screen. A glass panel on the right holds the part and the details, one
tab at a time.

1. **Start with a part.** The steel bracket (PART-001) is preloaded. To crate another part,
   click **Load a part** or drop a `.glb` anywhere on the page.
   - If the file name matches a catalog entry (`src/data/parts.json`), its mass, material and
     usual quantities fill in, and the model's size is checked against the catalog.
   - For an unknown file, enter its name, material and mass in the top-left header. The
     material field suggests common alloys and takes any text; aluminum draws lighter than
     steel. A 10 kg stand-in mass is used, with a warning, until you enter one. Mass is never
     guessed from the mesh.
2. **Set the quantity and packing rules** in the **Rules** tab: quantity, keep upright, most
   layers, gap between parts, clearance to walls, and plywood thickness (or Auto).
3. **Get the best layout automatically.** The app tries every orientation and grid that holds
   the batch, and ranks them stable first, then smallest outside volume, then lowest height.
   **Layouts** shows each option with top and side drawings, and says why the recommended one
   won.
4. **See the crate in 3D:** closed, open (lid and front wall fade away) or exploded, with size
   labels. The real part models sit in each slot. Left alone for 6 s, the crate slowly turns and
   cycles through the modes.
5. **Read off the build data:**
   - **Overview:** outside size, gross weight, how it's built, and crate weight by assembly
   - **Cut list:** grouped by assembly (base, side walls, end walls, lid, inside). Point at a row
     to light those boards in 3D; click a board in 3D to find its row
   - **Checks:** every rule of thumb, passed ones included (53' dry van door and length,
     tip-over, blocking, stack load, base rating, LTL length surcharge, and a hint when a
     cardboard box may be enough)
6. **Switch units** between mm / kg and in / lb, and **download or copy the cut list** as CSV.

### The crate it designs

- **Base:** a plywood floor on lumber skids. Forklift entry is from the ends.
- **Walls and lid:** plywood panels, each stiffened by a frame of 1×4 cleats.
- **Inside:** wood holds the parts in place. Bearers lift the bottom layer, a plywood separator
  sits between layers, and blocking posts fill every gap.
- **Fasteners:** wood screws only.
- **Sizing:** board sizes go up with payload mass.

## Scope and non-goals

**In scope:** one part type per crate, any quantity from 1 to 200, wood plus basic fasteners only,
**domestic shipping only** (US truckload or LTL in a 53' dry van).

**Out of scope for v1 (deliberately):**

- **Disposable packing materials** (foam, bubble wrap, stretch film). The brief excludes them.
- **Mixed-part crates.** A crate never mixes part numbers.
- **Export shipping.** No ISPM-15 lumber, ocean containers or air freight.
- **Certified engineering.** Sizing rules are reasonable shop defaults. They are not ASTM D6039
  or a structural calculation.
- **Metal hardware** (brackets, banding, lag bolts).
- **Persistence and accounts.** Nothing is saved yet. The plan is in
  [`docs/DATA_STORE.md`](docs/DATA_STORE.md).
- **Material properties.** An entered material sets the part's look and labels only. It doesn't
  change the mass or any rule.

## Conventions

| | |
|---|---|
| **Units, internally** | Millimetres and kilograms everywhere in `src/domain/`. The mm / in toggle is display-only (`src/lib/units.ts`) |
| **Axes** | Right-handed, **Z up**: the same frame as the source GLBs. X is the crate's long axis (the skids run along X) |
| **GLB files** | Metres, Z up, not centred on their origin. The viewer scales by ×1000 and re-centres each part on its bounding box. A loaded file more than 20 units across is read as millimetres, and the UI says so |
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
- **Part masses** come from the catalog as given, or from the user for unknown files (as do
  their name and material). They are
  never derived from mesh volume.
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
src/lib/           display units, cut-list formatting, part-file loading (tested)
src/state/         zustand store; per-frame animation values; checks for the UI
src/components/    shell/ (overlays), island/ (tabs), viewer/ (three.js via react-three-fiber)
src/data/          parts.json catalog
public/parts/      GLB models
docs/              SPECIFICATION.md, DATA_STORE.md, schema.sql, design-handoff/
```

## Docs

- [`docs/SPECIFICATION.md`](docs/SPECIFICATION.md): the full spec covering the data model,
  algorithms, construction rules, invariants, decisions and roadmap.
- [`docs/DATA_STORE.md`](docs/DATA_STORE.md): the client-side persistence plan (SQLite WASM on
  OPFS).
- [`docs/schema.sql`](docs/schema.sql): the proposed tables.
- [`docs/design-handoff/`](docs/design-handoff/HANDOFF.md): the UI design handoff and its
  runnable prototype.

The roadmap is tracked as GitHub issues: see the
[shipping-ui issues](https://github.com/0xevm1/shipping-ui/issues).
