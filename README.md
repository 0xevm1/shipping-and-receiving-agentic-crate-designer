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
| `bun run e2e` | End-to-end UI tests (Playwright): builds the app with the test hook, serves it on port 3320, runs every flow and saves screenshots to `e2e/screenshots/`. First run `bunx playwright install chromium` once. `bun run e2e:ui` opens Playwright's UI mode |
| `bun run lint` | ESLint |
| `bun run typecheck` | `next typegen` (route types), then `tsc --noEmit` |

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
- **Pre-commit hook:** `bun install` installs a git pre-commit hook
  ([simple-git-hooks](https://github.com/toplenboren/simple-git-hooks), via `prepare`). Every
  commit runs ESLint on the staged files, `bun run typecheck` and `bun run test` (4-6 s), and
  the output names the step that failed. It works in `git worktree`s too. In an emergency, skip it
  with `git commit --no-verify`; CI still runs every check.
- Nothing else is needed: no environment variables, backend or database. The sample GLBs are
  bundled in `public/parts/`.

## Pull requests

Every pull request to `main`, and every push to `main`, runs
[CI](.github/workflows/ci.yml) as two jobs:

- **`checks`:** `bun install --frozen-lockfile`, lint, typecheck, unit tests and build.
- **`e2e`:** the Playwright suite (`bun run e2e`) in headless Chromium against a production
  build. It uploads the screenshots (`e2e-screenshots`) and the HTML report
  (`playwright-report`) as artifacts, even when a test fails.

**A green CI run (both jobs) is required before merging.** GitHub can't enforce this on a
private repo without GitHub Pro, so it's a team rule for now. The workflow file has the `gh api`
command that adds a ruleset requiring both jobs on `main` once the repo is upgraded or made
public.

**UI changes:** run `bun run e2e` before you push, update the specs in `e2e/` when the
behaviour changes, and attach screenshots from `e2e/screenshots/` (or the CI artifact) to the
PR instead of hand-captured ones.

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
   won. Each card also shows what it costs to build and its freight class against the
   recommendation ("+$26 · same class 65"), and **Rank by** re-ranks by **Crate cost** or
   **Freight class** instead of volume. A crate that may tip or leaves parts loose never wins on
   cost or freight; Volume is the default.
4. **See the crate in 3D:** closed, open (lid and front wall fade away) or exploded, with size
   labels. The real part models sit in each slot. Left alone for 5 s, the crate slowly turns and
   cycles through the modes.
5. **Read off the build data:**
   - **Overview:** outside size, gross weight, then the **scorecard** (#17): crate cost
     (material and labour), build time, the estimated LTL freight class with its density in
     lb/ft³, and the dimensional weight; for a split batch, the whole shipment's cost. Then how
     it's built, and crate weight by assembly. After the first export (cut list, design file
     or 3D model) a note says how long the design took: "Designed in 1 m 12 s"
   - **Cut list:** grouped by assembly (base, side walls, end walls, lid, inside). Point at a row
     to light those boards in 3D; click a board in 3D to find its row
   - **Checks:** every rule of thumb, passed ones included (53' dry van door and length,
     tip-over, blocking, stack load, base rating, LTL length surcharge, and a hint when a
     cardboard box may be enough)
6. **Switch units** between in / lb (the default, for a US shop floor) and mm / kg; the choice is
   remembered in this browser. **Download or copy the cut list** as CSV, in the selected units. In
   imperial, lumber goes by its nominal name (1x4, 2x4, 4x4, 4x6), plywood by the thickness it is
   sold as (1/2″, 5/8″, 3/4″) and cuts by fractional inches to the nearest 1/16″.
7. **Download the crate as a 3D model** (View → "Download 3D model (.glb)"): the assembled crate
   in metres, Z up, every board a named mesh grouped by assembly, with the parts in their slots
   unless "Include parts" is off.
8. **Set the shop standards** (the house rules every crate is built to) at the bottom of the
   **Rules** tab, under **Shop standards**: lumber and plywood on hand, default gap, clearance
   and layers, the panel and skid thresholds, cleat and skid spacing, the trailer, LTL, carton,
   stack and base-rating limits, densities, material costs, screw spacing and screw price,
   the **labour rate and shop times** (minutes per cut, set-up, screw, assembly step and per
   crate), and the dimensional-weight divisor. A change
   re-designs the crate at once (for example, a higher plywood cost raises the Overview's
   "$ of wood"). Changes are saved in this browser, a **Customised** tag shows when any value
   differs from the shipped defaults, and **Reset to defaults** puts them back. **Download
   standards** / **Load standards** move them between machines as a JSON file.
9. **Save the design** with **Download design (.json)** in the Cut list tab, and reopen it later
   through **Load a part** or a drop. It restores the part, rules and layout; for a custom
   part, add its `.glb` in the same pick or drop. The format is in spec §6.5.
10. **Print the hand-off, or save it as a PDF** (#26): **Print / save PDF** in the Cut list tab
    opens the export document in a new tab and its print dialog (choose "Save as PDF"; Letter
    paper). It has three parts, in the selected units:
    - **Crate spec** for the PM and logistics: the part, quantity, outside size, gross, tare and
      payload, volume, dimensional weight and density in lb/ft³, the layout and why it won,
      the runner-up, and every check.
    - **Build sheet** for the shop: top, front and end views and two sections through the load,
      drawn from the design's boards; the cut list grouped by stock with totals; a fastener
      schedule; and the assembly order (base → walls → load parts → blocking and separators →
      lid).
    - **Shipping label** for the dock: part number, quantity, gross weight, THIS SIDE UP and
      the fork-entry marks.

    A split batch gets the plan, then a spec, build sheet and label per crate type. The design
    travels in the link itself, so nothing is uploaded. Spec §7.11.
11. **Split a big batch across crates** (#25). When one crate would be over the per-crate
    limits (1,000 kg gross by default, the trailer door and floor, and an optional most parts
    per crate, all in Shop standards → Limits), the batch ships as N identical crates plus at
    most one smaller remainder crate. The plan uses the fewest crates, then the least outside
    volume, then the most even split. The Overview says "Ships as 6 × crate A (30 each) + 1 ×
    crate B (20)" with the shipment's gross and volume, and **Crate A / Crate B** switches the
    crate shown in 3D, Layouts, Cut list and Checks. The Cut list can show **This crate** or
    the **Whole shipment**. Batches that fit one crate look exactly as before. Spec §7.10.
11. **Keep a design library and share designs** (#14). At the bottom of the **Overview**,
    **Save design** stores the crate on screen with a name and optional notes. When that part is
    loaded again (the catalog part, or a custom GLB with the same file name and size), its
    saved designs are listed with quantity, outside size, gross and date, and **Use** brings one
    back in a click, through the same path as opening a design file. Rename and delete (with
    undo) are inline; **Export library** / **Import library** move the whole library between
    machines as one JSON file. **Copy share link** puts the design in the URL hash
    (`#design=…`, never sent to a server). Opening the link restores a catalog part fully; for a
    custom part it names the `.glb` to load. A damaged link keeps the default crate and says
    why. Spec §9.

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
- **A database and accounts.** The shop standards, the display units and the design library
  are saved in the browser's `localStorage` (per browser, under versioned keys; bad data is
  skipped with a warning). Designs also move as JSON files (one design, or the whole library)
  and share links. The plan for a real store, SQLite WASM on OPFS, is in
  [`docs/DATA_STORE.md`](docs/DATA_STORE.md); spec §9 has the details.
- **Material properties.** An entered material sets the part's look and labels only. It doesn't
  change the mass or any rule.

## Conventions

| | |
|---|---|
| **Units, internally** | Millimetres and kilograms everywhere in `src/domain/`. The app shows inches and pounds by default, with a metric toggle; units are converted only at the UI and export edges (`src/lib/units.ts`, `src/lib/lumber.ts`) |
| **Axes** | Right-handed, **Z up**: the same frame as the source GLBs. X is the crate's long axis (the skids run along X) |
| **GLB files** | Metres, Z up, not centred on their origin. The viewer scales by ×1000 and re-centres each part on its bounding box. A loaded file more than 20 units across is read as millimetres, and the UI says so |
| **three.js** | Y up, metres. A single root group in `CrateViewer` rotates Z-up → Y-up and scales mm → m. Nothing else converts |
| **Crate origin** | The interior min corner, on the top face of the floor |

## Key assumptions

The values below are the **shipped shop standards** (`DEFAULT_STANDARDS` in
`src/domain/standards.ts`). A PM can change any of them in the app (Rules → Shop standards).

- **Packing uses bounding boxes.** Each part is treated as its axis-aligned bounding box. This is
  exact for boxy parts and wastes space on irregular ones, such as the open housing. There's no
  nesting.
- **Units:** a domestic US shop floor, so the app opens in inches and pounds and names stock the
  way a crew does. Metric is one toggle away. The shop standards are still entered in mm and kg.
- **Lumber sizes** are nominal US sizes, with actual dimensions in mm:
  - 1x4 cleats are 19 × 89
  - 4x4 skids are 89 × 89
  - 4x6 skids are 89 × 140, used when the payload is over 700 kg
  - blocking is 89 wide (3 1/2″), cut to fit each gap, so in imperial it reads as its size and
    the stock it is ripped from, e.g. "1 15/16″ × 3 1/2″ from 4x4"
  - a custom size that isn't standard stock shows in fractional inches
- **Plywood:** the floor is always 19 mm (3/4″). With Auto, walls and lid are 12 mm (1/2″) up to
  150 kg of payload, 15 mm (5/8″) up to 500 kg, and 19 mm (3/4″) above that.
- **Densities and cost are placeholders:** plywood 600 kg/m³ and lumber 480 kg/m³. Cost uses
  $1,100/m³ for plywood and $650/m³ for lumber. It's only good for comparing layouts, not for
  quoting.
- **Labour is a placeholder model** (spec §7.12): $35/h, 0.75 min per lumber cut, 3 min per
  plywood piece, 2 min per distinct cut size, 0.15 min (9 s) per screw, 6 min per assembly step
  (base, four walls, lid, dunnage per layer) and 15 min handling per crate. Screws are $8 per
  100. For PART-001 × 4 that is 2 h 43 m and $95 of labour on $91 of material: a $186 crate.
  Time a few real crates and enter the shop's own numbers.
- **Freight is in booking terms, not dollars:** gross lb, outside ft³ (inches rounded up),
  dimensional weight at **139 in³/lb**, density in lb/ft³ and an **estimated** NMFC class from
  the 13-sub density scale in force since July 2025. A carrier can class some commodities
  differently or re-class on inspection.
- **Time to design, manual baseline (an assumption to correct):** designing one crate by hand
  (measure the part, sketch the crate, work out the cut list and screws, price it) is taken to
  take the PM **about 45 minutes** per new part or quantity. The app's "Designed in …" note,
  from loading the part to the first export, is the number to compare with. Tell us the real
  figure and we'll update this line.
- **Part masses** come from the catalog as given, or from the user for unknown files (as do
  their name and material). They are
  never derived from mesh volume.
- **Per-crate limits:** at most 1,000 kg gross (the standard base rating) and the 53' dry van
  door and floor; no part-count limit. None of the sample parts splits at its suggested
  quantities.
- **Stability:** a crate counts as "stable" if its outside height is at most 1.5× its narrowest
  base side.
- **Screw count** is an estimate:
  - cleats: one every 150 mm
  - panel joints: one every 200 mm
  - skids: one every 300 mm
  - blocking: 2 per block

All of these live in one zod-validated object, `ShopStandards` (`src/domain/standards.ts`, spec
§6.4), which `computeDesign` takes as its last argument. There are no rule constants left in
`crate.ts` or `packing.ts`.

## Project layout

```
src/domain/        pure TypeScript, no React; all crate logic, unit-tested
src/lib/           display units, cut-list formatting, part-file loading, the export document (tested)
src/state/         zustand store; per-frame animation values; checks for the UI
src/components/    shell/ (overlays), island/ (tabs), viewer/ (three.js via react-three-fiber)
src/data/          parts.json catalog
public/parts/      GLB models
public/            also site.webmanifest and its 192/512 icons (tab icons: src/app/icon.svg etc.)
e2e/               Playwright end-to-end UI tests (bun run e2e)
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
