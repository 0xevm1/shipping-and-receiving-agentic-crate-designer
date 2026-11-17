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

Requirements: [Bun](https://bun.sh) 1.3+, Node 24 and **Docker** (Docker Desktop, or Engine
with the compose plugin), running.

```bash
git clone git@github.com:0xevm1/shipping-ui.git
cd shipping-ui
bun install
bun run dev          # Docker must be running → http://localhost:3000
bun run worker       # optional, in a second terminal: background sweeps and large bundles
```

`bun run dev` starts Postgres and an S3-compatible blob emulator in Docker
(`docker-compose.yml`), migrates the database, prints the emulator's console URL and then starts
Next.js on the host. [`docs/POSTGRES.md`](docs/POSTGRES.md) covers the data store, the scripts,
`.env.local` and the overrides for running several worktrees at once.

| Command | What it does |
|---|---|
| `bun run dev` | `infra:up`, `db:migrate`, then the dev server with hot reload (`bun run dev:app` skips the Docker steps) |
| `bun run infra:up` / `infra:down` | Start (and wait for) / stop Postgres and the blob emulator; `db:up` / `db:down` are aliases |
| `bun run db:migrate` / `db:reset` / `db:psql` | Apply `db/migrations/` / drop and re-migrate the database / open `psql` on it |
| `bun run db:generate` | Write the next migration after changing `src/server/db/schema.ts` |
| `bun run test:integration` | Integration tests against the Docker Postgres (`*.integration.test.ts`; run `infra:up` first) |
| `bun run build && bun run start` | Production build and serve (`build` also bundles the server's engine worker thread, `engine:build`) |
| `bun run worker` | The background job worker: claims queued sweeps from Postgres and runs them on worker threads ([docs/QUEUE.md](docs/QUEUE.md)) |
| `bun run crate -- part.glb --mass 21.5` | The command line: best quantity, ranked crates and files for a part ([Command line](#command-line)) |
| `bun run apikey:create -- --name x` | Create an API key for scripts (`apikey:list`, `apikey:revoke -- --id …`) |
| `bun run test` | Unit tests (vitest); no database needed |
| `bun run e2e` | End-to-end UI tests (Playwright): builds the app with the test hook, serves it on port 3320 (`E2E_PORT` changes it), runs every flow and saves screenshots to the git-ignored `e2e/screenshots/`. First run `bunx playwright install chromium` once. Locally it uses 1 to 3 workers (`E2E_WORKERS`). `bun run e2e:ui` opens Playwright's UI mode; `bun run e2e:docs-shots` copies chosen shots into `docs/screenshots/` |
| `bun run format` / `bun run format:check` | Prettier (`.prettierrc`: 160 columns); CI runs the check |
| `bun run knip` | Unused files, exports and dependencies (a report; it has known findings) |
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
- **Docker** (Docker Desktop, or Engine with the compose plugin) runs Postgres and the blob
  emulator for `bun run dev` and the integration tests. `bun run build`, `bun run test` and the
  pre-commit hook don't need it. No environment variables are needed: the defaults match
  `docker-compose.yml`, and `.env.example` lists what `.env.local` can override. The sample GLBs
  are bundled in `public/parts/`.

### Environment

No variables are needed for local work: the defaults match `docker-compose.yml`. Copy
`.env.example` to `.env.local` to change any of them (full list:
[docs/POSTGRES.md](docs/POSTGRES.md#environment), [docs/QUEUE.md](docs/QUEUE.md)).

| Variable | Default | |
|---|---|---|
| `DATABASE_URL` | built from `DB_PORT`, `DB_NAME` | Postgres; set it for a hosted database |
| `DB_PORT`, `DB_NAME` | `5432`, `crate_designer` | The Docker Postgres's host port and database |
| `BLOB_ENDPOINT`, `BLOB_REGION`, `BLOB_BUCKET` | `http://localhost:9000`, `us-east-1`, `crate-designer-dev` | Blob storage (S3 API) |
| `BLOB_ACCESS_KEY_ID`, `BLOB_SECRET_ACCESS_KEY` | the emulator's | Server-only; never `NEXT_PUBLIC_` |
| `BLOB_FORCE_PATH_STYLE`, `BLOB_PUBLIC_ENDPOINT` | `true`, `BLOB_ENDPOINT` | Path-style URLs; the host written into presigned URLs |
| `ENGINE_POOL_SIZE`, `QUEUE_CONCURRENCY` | CPUs − 1 (1–4), `2` | Engine worker threads; queue jobs at once per worker |
| `CRATE_API_URL`, `CRATE_API_KEY` | `http://localhost:3000`, none | The command line's server and key |

**Real S3 or GCS.** Pointing the `BLOB_*` variables at a real bucket works without code changes:
the app speaks only the S3 API. For AWS S3 leave `BLOB_ENDPOINT` empty and set
`BLOB_FORCE_PATH_STYLE=false`; for Cloudflare R2 use the account endpoint and region `auto`; for
Google Cloud Storage use `BLOB_ENDPOINT=https://storage.googleapis.com` with HMAC keys. In each case
set `BLOB_REGION`, `BLOB_BUCKET` and the key pair, and give the bucket a CORS rule allowing `GET`
from the app's origin (`infra/blob-cors.json`). Details:
[docs/BLOB_STORAGE.md](docs/BLOB_STORAGE.md#one-api-s3).

**Several worktrees at once.** Each needs its own Docker project and ports (and a Playwright port,
`E2E_PORT`). Put them in the worktree's `.env.local`:

```bash
COMPOSE_PROJECT_NAME=crate-wt2
DB_PORT=55432
BLOB_PORT=59000
BLOB_CONSOLE_PORT=59001
BLOB_ENDPOINT=http://localhost:59000
E2E_PORT=3321
```

`bun run e2e` uses its own database, `crate_designer_e2e` (`E2E_DB_NAME`), and the
`crate-designer-test` bucket, so it never touches the dev data; without Docker the specs that need
the server skip.

## Command line

`bun run crate` designs the crate for a part without the browser: the best quantity per crate,
the ranked shortlist and, with `--total`, how N parts ship. It calls the app's API
(`POST /api/v1/designs`), or with `--offline` runs the same engine in its own process.

```bash
bun run apikey:create -- --name my-laptop          # once; prints the key
export CRATE_API_KEY=cdk_…
bun run crate -- public/parts/PART-001-machined-steel-bracket.glb --mass 21.5 --total 40 --out ./out
bun run crate -- part.glb --mass 21.5 --total 40 --out ./out --offline   # no server, no database
```

| Option | |
|---|---|
| `--mass <kg>` | Mass of one part (required; never read from the mesh) |
| `--total <n>` | Total parts to ship: adds the even split over crates |
| `--material`, `--density`, `--name` | Part facts, as for an upload |
| `--freight-rates <json or @file>` | LTL rates, `{"usdPerCwtByClass": {"70": 41.5}, "minimumUsd": 95}`; without them no freight dollars appear |
| `--out <dir>` | Output directory (default `./crate-out`) |
| `--offline` | Run the engine here; also writes the crate GLB, PDF, cut list, `design.json` and README |
| `--api <url>`, `--key <key>` | API base URL and key (default `$CRATE_API_URL` or `http://localhost:3000`, `$CRATE_API_KEY`) |

Both modes write `designs.json` (ranked configurations, recommendation and rationale, the 1–200
curve, the total plan) and `ranking.csv`. The API needs a key from scripts; the app's own pages
don't. Details, the job queue and the worker threads: [docs/QUEUE.md](docs/QUEUE.md).

## Pull requests

Every pull request to `main`, and every push to `main`, runs
[CI](.github/workflows/ci.yml): **`checks`**, which does `bun install --frozen-lockfile`,
Prettier check, `docker compose config`, lint, typecheck, unit tests and build; and
**`integration`**, which checks that `db/migrations/` matches the schema, starts Postgres and the
blob emulator from `docker-compose.yml`, migrates an empty database and runs
`bun run test:integration`.

**Green `checks` and `integration` runs are required before merging.** GitHub can't enforce this on a private
repo without GitHub Pro, so it's a team rule for now. The workflow file has the `gh api` command
that adds a ruleset requiring the job on `main` once the repo is upgraded or made public.

**End-to-end tests run on demand.** The Playwright suite is slow, so it is not part of the
pre-commit hook or of pull-request CI. Run it when you want it:

- on GitHub: **Actions → E2E → Run workflow** and pick the branch
  ([`e2e.yml`](.github/workflows/e2e.yml)), or `gh workflow run e2e.yml --ref <branch>`. An
  optional `filter` input runs part of the suite (a spec path or a Playwright option). The run
  uploads the screenshots (`e2e-screenshots`) and the HTML report (`playwright-report`) as
  artifacts, even when a test fails;
- locally: `bun run e2e`, or `bun run e2e e2e/<spec>` for one spec.

**UI changes:** put a screenshot of the change in the PR (`e2e/screenshots/` has them after a run). Specs are named by topic
(`design-library.spec.ts`, with `.narrow` and `.mobile` suffixes for the other viewports), find things by role, label or test
id, never by CSS class, and share their helpers in `e2e/helpers/` (spec §10).

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
   - A newly loaded part, and the sample part on a first visit, opens at the **recommended
     quantity per crate** and its crate, without you choosing one ("Set to the recommended 34
     per crate"); a saved design, a design file, a share link or your last crate keeps its own.
2. **Set the quantity and packing rules** in the **Rules** tab: quantity, keep upright, most
   layers, gap between parts, clearance to walls, and plywood thickness (or Auto). Under the
   quantity, **Best: N per crate** says why that quantity wins, with **Use** to go back to it.
   **Why this crate?** explains it in plain words: what was compared, how it is scored (crate
   cost per part, broken into wood, screws and labour; freight not priced without rates), why
   this quantity beat the next best (with a cost-per-part curve), what stopped a larger crate,
   and what it assumes. The spec and comparison PDFs print the same explanation.
3. **Get the best layout automatically.** The app tries every orientation and grid that holds
   the batch, and ranks them stable first, then smallest outside volume, then lowest height.
   **Layouts** shows each option with top and side drawings, and says why the recommended one
   won. Each card also shows what it costs to build and its freight class against the
   recommendation ("+$26 · same class 65"), and **Rank by** re-ranks by **Crate cost** or
   **Freight class** instead of volume. A crate that may tip or leaves parts loose never wins on
   cost or freight; Volume is the default.
4. **See the crate in 3D:** closed, open (lid and front wall fade away) or exploded, with size
   labels. The real part models sit in each slot. With the size labels come gold
   **fork-entry arrows** at both ends, one per opening between the skids, and, only when the centre of gravity is off-centre or high,
   the **centre-of-gravity mark** stencilled on the outside faces. An arrow the crate hides from
   the current camera fades out, and the straight-on Top, Front and End views leave out the size
   line that points at you. In the open and exploded views the part's three sizes share one pill.
   Drag to turn, right-drag (or two fingers on a touch screen) to pan, scroll to zoom (the **View**
   menu says so); a pan never takes the crate out from the free area, and picking a camera preset in
   **View** puts the view back. Left alone for 5 s, the crate slowly turns and
   cycles through the modes, easing back to the middle first if you had panned. If the browser takes
   the graphics away, a cover with a **Bring back the 3D view** button replaces the blank canvas.
5. **Read off the build data:**
   - **Overview:** outside size, a one-line verdict ("All checks clear", or "1 caution: parts
     are not restrained" linking to Checks), gross weight, then the **scorecard** (#17): crate cost
     (material and labour), build time, the estimated LTL freight class with its density in
     lb/ft³, and the dimensional weight. For a split batch the Shipment block at the top carries
     the whole shipment's cost and labour. Then how it's built, and crate weight by assembly. After
     the first export since your last edit (cut list, design file, 3D model or the Export pill's
     .zip) the scorecard heading says how long the design took: "Designed in 1 m 12 s"
   - **Cut list:** grouped by assembly (base, side walls, end walls, lid, inside); on a phone each
     row stacks so nothing scrolls sideways. Point at (or focus) a row
     to light those boards in 3D; click a board in 3D to find its row
   - **Checks:** every rule of thumb, passed ones included (53' dry van door and length,
     tip-over, blocking, stack load, base rating, centre of gravity, forklift and pallet-jack
     entry, LTL length surcharge, and a hint when a cardboard box may be enough). The **base
     rating** is computed from the skids, floor and joists (#7): "Base rated 859 kg; this
     crate's payload is 645 kg (75%)"
6. **Switch units** between in / lb (the default, for a US shop floor) and mm / kg; the choice is
   remembered in this browser. Everything follows it: the Checks tab, the print spec and the PDF say "98.0 in" and "lb" in imperial, never "mm" or "kg". A mass shows one decimal under 100 and whole numbers from 100 ("47.4 lb", "297 lb"). **Download or copy the cut list** as CSV, in the selected units. In
   imperial, lumber goes by its nominal name (1x4, 2x4, 4x4, 4x6), plywood by the thickness it is
   sold as (1/2″, 5/8″, 3/4″) and cuts by fractional inches to the nearest 1/16″.
7. **Download the crate as a 3D model**, inside the .zip from the **Export specs** pill: the assembled crate in metres, Z up, every board a named mesh
   grouped by assembly, with the parts in their slots.
8. **Set the shop standards** (the house rules every crate is built to) at the bottom of the
   **Rules** tab, under **Shop standards**: lumber and plywood on hand, default gap, clearance
   and layers, the panel and skid thresholds, cleat and skid spacing, the trailer, LTL, carton,
   stack and per-crate limits, the cradle rules for long parts, the **structural rules**
   (allowable lumber and plywood stresses, load factor, minimum fork opening, floor-joist
   threshold and spacing, a stacking load for the lid), densities, material costs, screw spacing and screw price,
   the **labour rate and shop times** (minutes per cut, set-up, screw, assembly step and per
   crate), the dimensional-weight divisor, and **handling** (forklift and pallet-jack tine width,
   spread and clearance under the floor, the off-centre limit and the smallest tip angle). A change
   re-designs the crate at once (for example, a higher plywood cost raises the Overview's
   "$ of wood"). Changes are saved in this browser, a **Customised** tag shows when any value
   differs from the shipped defaults, and **Reset to defaults** puts them back. **Download
   standards** / **Load standards** move them between machines as a JSON file.
9. **Save the design** with **Download design (.json)** in the Cut list tab, and reopen it later
   through **Load a part** or a drop. It restores the part, rules, ranking and layout, and the
   part's measured shape, so the reopened crate, a share link, the print and the zip are all the
   same crate; for a custom part, add its `.glb` in the same pick or drop. The format is in
   spec §6.5.
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
    - **Shipping label** for the dock: part number, quantity, gross weight, THIS SIDE UP, the
      fork-entry arrows in the openings between the skids, and the centre-of-gravity mark.

    A split batch gets the plan, then a spec, build sheet and label per crate type. The design
    travels in the link itself, so nothing is uploaded. Spec §7.11.
11. **Export everything in one click** (#51): the green **Export specs** pill under the part lines
    downloads `crate-PART-001-x4.zip`, made in the browser (nothing is uploaded):
    - `crate-PART-001-x4.glb`, the assembled crate with the parts (one per crate type for a
      split batch: `…-crate-A.glb`, `…-crate-B.glb`);
    - `crate-PART-001-x4.pdf`, a real PDF file with the crate spec, build sheet and shipping
      label of step 10, for every crate type (drawn with jsPDF; the PDF, ZIP and GLB code
      loads only when you export);
    - `cut-list.csv` in the selected units (a split batch: one per crate type plus
      `shipment-cut-list.csv`);
    - `design.json`, which reopens with **Load a part**;
    - `README.txt`: what each file is for, the app version, the date and the units.

    The pill shows "Exporting…" for at least 1.5 s (no hold or spinner with reduced motion),
    then "Downloaded crate-PART-001-x4.zip". The separate downloads above stay. Spec §7.13.

    **Download all** (#46), the outlined pill beside it, downloads one .zip comparing the design
    on screen with the best quantities per crate: a folder each with the GLB, PDF and cut list, a
    `manifest.json` (engine version, input hash, every file's size and SHA-256) and a
    `comparison.pdf` (quantity per crate, crates, outside size, gross, cost per part, and why the
    recommended quantity won). Every file carries the engine version and input hash; each PDF
    states the quantity rationale and the constraint that stopped a larger crate. No freight
    dollars appear (there are no freight rates). Spec §7.17.
12. **Split a big batch across crates** (#25). When one crate would be over the per-crate
    limits (1,000 kg gross by default, the trailer door and floor, and an optional most parts
    per crate, all in Shop standards → Limits), the batch ships as N identical crates plus at
    most one smaller remainder crate. The plan uses the fewest crates, then the least outside
    volume, then the most even split. The Overview says "Ships as 6 × crate A (30 each) + 1 ×
    crate B (20)" with the shipment's gross and volume, and **Crate A / Crate B** switches the
    crate shown in 3D, Layouts, Cut list and Checks. The Cut list can show **This crate** or
    the **Whole shipment**. Batches that fit one crate look exactly as before. Spec §7.10.
13. **Keep a design library and share designs** (#14). At the bottom of the **Overview**,
    **Save design** stores the crate on screen with a name and optional notes. When that part is
    loaded again (the catalog part, or a custom GLB with the same file name and size), its
    saved designs are listed with quantity, outside size, gross and date, and **Use** brings one
    back in a click, through the same path as opening a design file. Rename and delete (with
    undo) are inline; **Export library** / **Import library** move the whole library between
    machines as one JSON file. **Copy share link** puts the design in the URL hash
    (`#design=…`, never sent to a server). Opening the link restores a catalog part fully; for a
    custom part it names the `.glb` to load. A damaged link keeps the default crate and says
    why. Spec §9.
14. **Pick up where you left off** (#71). A refresh, or reopening the tab, brings back the crate
    that was last on screen: the part, every rule, the picked layout, the crate type of a split,
    the ranking and the open tab (the units and shop standards are remembered as before). It is
    saved in this browser a moment after each change. A loaded `.glb` is kept too (in
    IndexedDB, the last one only, up to 50 MB); a bigger one isn't, and the reload opens the
    default part with a note naming the file to load. To start fresh, just load another part or
    design: whatever is on screen is what gets remembered. A share link in the URL wins over the
    remembered crate. Spec §9.

### The crate it designs

- **Base:** a plywood floor on lumber skids. Forklift entry is from the ends.
- **Handling (#8):** the combined centre of gravity of the crate and the parts (each part
  assumed to have its CoG at its bounding-box centre) is checked for being off-centre (over 10%
  of the length or width: mark it) or top-heavy (static tip angle under 30°), and the openings
  between the skids are checked for a forklift (75 mm clear, 100 mm tines) and a pallet jack
  (85 mm clear, 180 mm forks at a 520–690 mm spread), with the load between the tines. All of
  these are shop standards. Spec §7.14.
- **Walls and lid:** plywood panels, each stiffened by a frame of 1×4 cleats.
- **Inside:** wood holds the parts in place. Bearers lift the bottom layer, a plywood separator
  sits between layers, and blocking posts fill every gap.
- **Shaped blocking (#16):** once a part's model is on screen, the app measures its outline from
  each side (a depth grid per bounding-box face, about 5 ms). Posts then sit where the part is
  solid, and shaped blocks reach into its recesses. For eight open-top housings (PART-003) the
  blocking face touching the part goes from 10% to 63%, and the most a part can slide falls from
  65 mm to 0, for 44 extra blocks. The Checks tab says "shaped to the part" with those numbers.
  Slender parts lying flat sit in cradles instead (#6). Without the analysis, blocking follows
  the bounding box as before. Spec §7.5b.
- **Long parts sit in cradles** (#6, spec §7.5a): a slender part (longest side at least 3× its
  middle side, like the 1.53 m shaft) rests in notched wooden saddles across its length, one
  150 mm in from each end and at most 600 mm apart, with a round seat a quarter of the part's
  height deep (a flat pocket for a non-round section). Stacked layers get stacking cradles,
  notched under and over, instead of a separator, and end stops hold each part along its axis.
  The cradles show notched in 3D and are in the cut list, screws, labour and build sheet.
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
- **Accounts.** The shop standards, the display units, the design library and
  the last-opened crate are saved in the browser's `localStorage` (and the last loaded `.glb` in
  IndexedDB), per browser, under versioned keys; bad data is
  skipped with a warning). Designs also move as JSON files (one design, or the whole library)
  and share links. The shared store is Postgres (#46), being built in slices: a part's
  configurations can be saved to a shared job on the server that every open tab sees
  ([`docs/API.md`](docs/API.md), [`docs/POSTGRES.md`](docs/POSTGRES.md)); spec §9 has the details.
  Saves are local first: with the server or its database down they are kept in this browser,
  marked "Not synced yet", and sent by themselves within a few seconds of the server coming back
  (`docs/API.md` "Offline"). Until then nobody else sees them.
- **Material properties.** An entered material sets the part's look and labels only. It doesn't
  change the mass or any rule.

## Conventions

| | |
|---|---|
| **Units, internally** | Millimetres and kilograms everywhere in `src/domain/`. The app shows inches and pounds by default, with a metric toggle; units are converted only at the UI and export edges (`src/lib/units.ts`, `src/lib/lumber.ts`) |
| **Axes** | Right-handed, **Z up**: the same frame as the source GLBs. X is the crate's long axis (the skids run along X) |
| **GLB files** | Metres, Z up, not centred on their origin. The viewer scales by ×1000 and re-centres each part on its bounding box. A loaded file more than 20 units across is read as millimetres, and the UI says so |
| **three.js** | Y up, metres. A single root group in `CrateViewer` rotates Z-up → Y-up and scales mm → m; the few world-space users (camera framing, floor) convert with the helpers in `viewer/scene.ts` |
| **Crate origin** | The interior min corner, on the top face of the floor |

## Key assumptions

The values below are the **shipped shop standards** (`DEFAULT_STANDARDS` in
`src/domain/standards.ts`). A PM can change any of them in the app (Rules → Shop standards).

- **Packing uses bounding boxes.** Each part is treated as its axis-aligned bounding box. This is
  exact for boxy parts and wastes space on irregular ones, such as the open housing. There's no
  nesting. Blocking, though, is shaped to the part's measured outline once the model has been
  analysed (#16).
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
- **Per-crate limits:** at most 1,000 kg gross (a handling limit) and within the crate's
  computed base rating, and the 53' dry van door and floor; no part-count limit. None of the
  sample parts splits at its suggested quantities.
- **Structural sizing** (#7, spec §7.15): skids, floor joists and the lid are sized by simple
  allowable-stress formulas for **SPF No. 2** lumber (Fb 875 psi × 1.3, Fv 135 psi, Fc⊥ 425 psi)
  and sheathing plywood (about 870 psi), with a **1.5 load factor**, the skids taken as supported
  only at their ends. The smallest skid section that passes is used, then more skids (never
  closer than a 200 mm fork opening); a payload over 450 kg, or a floor that can't span the
  skids, gets 2×4 floor joists across the skids. Wood and screws only. Strength only: no
  deflection, joint or point-load checks, so heavy or unusual loads still need an engineer.
  Crates aren't assumed to be stacked; enter a stacking load to size the lid for it.
- **Stability:** a crate counts as "stable" if its outside height is at most 1.5× its narrowest
  base side.
- **Screw count** is an estimate:
  - cleats: one every 150 mm
  - panel joints: one every 200 mm
  - skids: one every 300 mm
  - blocking: 2 per block
  - cradles: 4 per cradle
- **Cradles** (Shop standards → Cradles): slender at longest ÷ middle ≥ 3, cradles at most
  600 mm apart and 150 mm in from the ends, notches 25% of the part's height deep, sections
  within 10% of square taken as round, 38 mm (2×) boards.

All of these live in one zod-validated object, `ShopStandards` (`src/domain/standards.ts`, spec
§6.4), which `computeDesign` takes as its last argument. There are no rule constants left in
`crate.ts` or `packing.ts`.

## Project layout

```
src/domain/        pure TypeScript (mm, kg, Z-up), no React, three.js or DOM; all crate logic, unit-tested
src/lib/           edge code, may import domain: display units, cut-list formatting, part-file
                   loading, part analysis for shaped blocking, the checks the UI shows, the
                   export document, the Export pill's .zip and PDF (tested)
src/engine/        the crate engine, may import lib and domain: one API (design, cut list,
                   Export .zip, per-artifact GLB / PDF / CSV builders and the multi-configuration
                   bundle) that runs the same in the page, a Web Worker and Node, every output
                   stamped with engineVersion and inputHash (spec §5.1, §7.17)
src/state/         may import engine, lib and domain: zustand stores, persistence, loading
                   flows, the engine's Web Worker and its client, per-frame animation values
src/server/        server-only (Postgres via drizzle, S3 blob storage, the job queue, the engine's
                   worker_threads pool, API keys, #46), may import engine, lib and domain; only
                   src/app/ may import it (Route Handlers in src/app/api/v1/)
src/cli/           bun run crate (#46): may import engine, lib and domain; talks to the API, or
                   runs the engine in-process with --offline
src/components/    may import everything below except src/server/: shell/ (overlays), island/
                   (tabs), viewer/ (three.js via react-three-fiber); src/app/ is the same layer
```

Styles: each component has its own CSS module (`Name.module.css` next to it). The only global CSS is
`src/app/globals.css` (design tokens, base rules), `src/app/ui.css` (the few shared primitives, in a
cascade layer that component styles always beat) and the designer's page in `src/app/(designer)/`;
the `/print` route loads only the tokens and its own `print.css` (spec §13).

Imports point down only (components and app, then state, then engine, then lib, then domain;
src/server/ beside state, used only by src/app/). ESLint enforces it (`eslint.config.mjs`,
`bun run lint`), including for type-only imports and tests. The page designs in a Web Worker,
so typing and dragging never wait for the crate.

```
src/data/          parts.json catalog
public/parts/      GLB models
public/            also site.webmanifest and its 192/512 icons (tab icons: src/app/icon.svg etc.)
e2e/               Playwright end-to-end UI tests (bun run e2e)
db/migrations/     SQL migrations written by drizzle-kit (bun run db:generate)
infra/             blob emulator bucket setup (CORS) for docker-compose.yml
scripts/           infra, worker (job queue), apikey, blob-gc, pre-commit
docs/              SPECIFICATION.md, API.md, POSTGRES.md, BLOB_STORAGE.md, QUEUE.md, design-handoff/
```

## Docs

- [`docs/SPECIFICATION.md`](docs/SPECIFICATION.md): the full spec covering the data model,
  algorithms, construction rules, invariants, decisions and roadmap.
- [`docs/API.md`](docs/API.md): the `/api/v1` HTTP API: parts, design jobs, server-verified
  configuration saves, error codes, idempotency and the events each write emits.
- [`docs/POSTGRES.md`](docs/POSTGRES.md): the Postgres data store: tables, org scoping,
  scripts, environment and ports.
- [`docs/BLOB_STORAGE.md`](docs/BLOB_STORAGE.md): GLBs and generated files in S3-compatible
  storage: object keys, the part upload API, presigned downloads, orphan cleanup. Pointing the
  `BLOB_*` variables at real AWS S3, Cloudflare R2 or GCS (S3 XML API with HMAC keys) works
  without code changes.
- [`docs/QUEUE.md`](docs/QUEUE.md): the Postgres job queue (SKIP LOCKED, NOTIFY, leases,
  retries, dead letter), the engine's worker threads, `POST /api/v1/designs`, API keys and the
  `bun run crate` command line.
- [`docs/LOAD_TEST.md`](docs/LOAD_TEST.md): the saves-and-live-events load test (`bun run load`),
  its measured limits, and when to move off LISTEN/NOTIFY.
- [`docs/design-handoff/`](docs/design-handoff/HANDOFF.md): the UI design handoff and its
  runnable prototype.

The roadmap is tracked as GitHub issues: see the
[shipping-ui issues](https://github.com/0xevm1/shipping-ui/issues).
