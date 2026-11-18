# Architecture walkthrough

Written to be said out loud. **One-minute version: 1 minute. Full walk: about 10 minutes.**
It orders the story and points at files; the detail is in [SPECIFICATION.md](SPECIFICATION.md) (§ links below).

## The one-minute version

Crate Designer takes a part (a GLB, plus its mass from `parts.json` or typed in) and a quantity, and designs the wooden crate
to ship them in: outside size, gross weight, every board as a cut list, cost, build time, freight class and a list of checks,
shown in 3D and exported as a PDF, GLB, CSV and design file.

All of it is one pure, synchronous function chain in `src/domain`, in mm and kg, Z up. Everything else either feeds it or shows
its answer:

```
part + settings + shop standards
  → engine.designShipment          one request, stamped with engineVersion + inputHash      src/engine/engine.ts
    → planShipment                 one crate, or N identical crates + a remainder            src/domain/shipment.ts
      → computeDesign              per crate type                                           src/domain/design.ts
        → enumerateLayouts         every orientation × grid, base sized per candidate        src/domain/packing.ts
        → rank                     stable, then volume (or cost / freight class)             compareLayouts, rankByObjective
        → designCrate              shell, dunnage, structure, BOM, checks, handling, cost    src/domain/crate.ts
  → CrateDesign → 3D viewer, Overview / Layouts / Cut list / Rules / Checks, exports
```

The same engine runs in a Web Worker in the page, in Node on the server, and in the CLI, so they can't disagree.

## Layers, and why ([§5](SPECIFICATION.md#5-architecture))

| Layer | Holds | May import |
|---|---|---|
| `src/domain` | Every business rule. Pure TypeScript, mm/kg, Z up. No three, React, zustand or DOM | nothing above it |
| `src/lib` | Edge code: units to text, file loading and checking, PDF/GLB/CSV builders | domain |
| `src/engine` | The facade the page, worker, server and CLI call; stamps every output | lib, domain |
| `src/state` | zustand stores, persistence, the engine worker client, job sync | engine, lib, domain |
| `src/server` | Postgres, blob storage, events, queue (#46). Only `src/app` imports it | engine, lib, domain |
| `src/components`, `src/app` | Rendering and routes | everything below |

- **Lint enforces it** (`eslint.config.mjs`, `no-restricted-imports`), type-only imports and tests included. Why: the rules stay
  testable in Node in milliseconds, and the server can run them without a browser.
- **Units become text in one place:** `src/lib/units.ts` (`weight`, `dims`), `src/lib/lumber.ts` (nominal names like `2x4`,
  `3/4″`) and `renderMessage` in `src/lib/message.ts`. The domain never formats a number.
- **mm becomes Y-up metres in one place:** `MM_TO_M` and `domainToWorld` in `src/components/viewer/scene.ts`, applied once by
  the root group in `CrateViewer.tsx`. Everything inside it uses domain coordinates. The exported GLB stays Z up in metres.
- **Two stores:** `useDesigner` (`src/state/store.ts`) is the design; `useView` (`viewStore.ts`) is how it's shown. They meet
  in one place, `designEvents.ts`. Per-frame animation lives outside React in `motion.ts`.

## The data model in six types ([§6](SPECIFICATION.md#6-data-model))

| Type | File | What it is |
|---|---|---|
| `DesignPart` | `domain/schema.ts` | id, name, mass, bounding-box size; optional material, measured `profile`, centre of gravity `cog`, suggested quantities |
| `CrateSettings` | `domain/schema.ts` | quantity, resting faces, max layers, part gap, wall clearance, panel thickness (or `auto`) |
| `ShopStandards` | `domain/standards.ts` | the shop's rules as data: stock, defaults, construction, limits, rates, labour, structure, freight, handling, cradles |
| `Layout` | `domain/packing.ts` | orientation, grid counts, interior and external size, clearance, slots, `stable` |
| `Member` / `BomLine` | `domain/members.ts`, `bom.ts` | one board as an axis-aligned box, tagged with assembly, face and label; the cut-list line it belongs to |
| `Check` + `Message` | `domain/check.ts`, `message.ts` | `ok` / `caution` / `info`, with a sentence whose lengths and masses stay data until the edge renders them |

`designCrate` returns them together as a `CrateDesign`. The **design file** (`domain/designFile.ts`, format 5,
[§6.5](SPECIFICATION.md#65-design-file-designfileschema-28)) round-trips part, settings, ranking and layout key. It has a
migration for every older format.

## Three algorithms for a whiteboard

**1. Packing and ranking** ([§7.2](SPECIFICATION.md#72-packing-enumeratelayouts), `packing.ts`)
- *Idea:* identical parts mean every slot is the same rotated bounding box. So try each of the 12 axis-aligned orientations
  the allowed resting faces permit, every layer count and every `nx × ny` grid; skip grids with an empty row or layer. Add
  clearance and the structure around it. Rank stable first (height ≤ 1.5 × narrowest side), then smallest volume (3% counts as a
  tie), then lowest.
- *Invariant a test pins:* the bounding box of all boards equals `layout.external`
  (`domain.test.ts` "keeps the crate exterior equal to the bounds of its boards"), and the 18-case baseline is unchanged.
- *Where it breaks:* no nesting or interlocking. An L-shaped part ships in its box, so utilisation is pessimistic.

**2. Structural sizing** ([§7.15](SPECIFICATION.md#715-structural-sizing-srcdomainstructurets-7), `structure.ts`)
- *Idea:* hand formulas a shop can check. Skids are simply supported beams at their ends, checked in bending, shear and bearing
  (SPF No. 2, ×1.5 load factor). Start with the spacing rule's skid count and the smallest section. Go heavier, then add skids
  (never closing the 200 mm fork opening). Add floor joists above 450 kg or when the floor fails. The weakest check is the
  base rating.
- *Invariant:* the spec's worked example (`structure.test.ts` "works through the spec's example"), and the outside size still
  matches the boards. The packer calls `planStructure` for every candidate, because the base height depends on the span.
- *Where it breaks:* strength only: no deflection, joints, point loads or racking. An engineer reviews unusual loads.

**3. Shaped blocking** ([§7.5b](SPECIFICATION.md#75b-shaped-blocking-srcdomainprofilets-16), `profile.ts`)
- *Idea:* the browser rasterises the mesh onto a depth grid for each of the six faces (milliseconds, at idle). The domain
  rotates that profile with the layout, slides each post to where it touches the most surface, and adds blocks into recesses,
  stopping at the shallowest point so a block never cuts into the part. PART-003 × 8: 10% contact and 65 mm of free movement
  becomes 63% and 0 mm.
- *Invariant:* a box-shaped profile reproduces bounding-box blocking exactly, and no profile means exactly the old blocking
  (`profile.test.ts`).
- *Where it breaks:* it's a grid sample (about 1/100 of the part), so it misses thin features and undercuts. It never shrinks the crate.

## Five decisions, and the alternative I rejected ([§11](SPECIFICATION.md#11-decision-log))

1. **Bounding-box grid packing plus shape-following blocking**, not true 3D nesting. The grid is exact, fast (1–2 ms at 200
   parts) and explainable; the shape matters where the part touches the wood, so it went into the blocking.
2. **Every rule is a shop standard**, not a constant in code. One zod-validated `ShopStandards` object is passed into the
   domain and edited in the Rules tab. It turns the PM's tribal knowledge into data and keeps the domain pure.
3. **One engine, local first; the server re-computes to trust.** The rejected alternative was a server that designs and a
   browser that displays. The browser designs instantly (2–4 ms in a worker, no network). The server only shares and runs
   headless jobs. A save is re-designed on the server and stored only if the `engineVersion`, `inputHash` and summary match
   (`server/jobs/verify.ts`). The parity tests prove Node and the browser give identical output.
4. **One versioned design file for every handoff**, not a format per feature. Download design, the zip and the print route all
   use it, and saved designs and share links used it too. Old files migrate on read. Since #150, handoffs are manual: the design
   file or the Export specs zip.
5. **End-to-end tests read a probe, not pixels, and are opt-in.** The 3D state can't be read from the DOM, so test builds expose
   `window.__crate` (`viewer/E2EProbe.tsx`). Specs wait on it instead of sleeping. The suite is slow, so it runs on demand,
   not on every PR. Unit tests own the numbers.

Runner-up: **freight as class and weights, not dollars.** LTL prices depend on the lane and tariff, so invented rates would mislead.

## Known limits and what comes next ([§12](SPECIFICATION.md#12-known-limitations-and-roadmap))

- No nesting; shaped blocking is a grid sample; structure is strength only; splits are only N identical crates plus a remainder.
- The centre of gravity is estimated in the browser, assuming uniform density. An API-only job uses the box centre.
- The server (#46) has no accounts yet: the UI acts for one default org, and scripts use API keys (`src/server/auth.ts`).
  Accounts, Box import and projects are #60. Docs catch-up is #146.
- For "what if they hand me X", use [demo-cheat-sheet.md](demo-cheat-sheet.md): every row was run in the live app.

## A 10-minute file tour

1. `src/domain/design.ts`: `computeDesign`. Input problem → rank layouts → design the winner. The whole pipeline is on one screen.
2. `src/domain/packing.ts`: `enumerateLayouts` and `compareLayouts`. The grid loop and the ranking.
3. `src/domain/crate.ts`: `designCrate`. Shell, dunnage or cradles, structure, BOM, checks, handling, cost, in that order.
4. `src/domain/structure.ts`: `sizeBase`. The beam formulas; `structure.test.ts` works the spec's example through them.
5. `src/domain/standards.ts`: the shop's rules as one schema with defaults.
6. `src/engine/engine.ts`: `designShipment`, the stamp, and why the same call runs everywhere.
7. `src/state/store.ts`: how an edit becomes a worker request and lands as a design (`designedFrom`).
8. `src/components/viewer/CrateViewer.tsx` and `scene.ts`: the one transform into three.js.
9. `src/lib/printable.ts`: one `PrintableDesign` model feeds the print route and the PDF (`exportPdf.ts`).
10. `src/server/jobs/verify.ts`: the server doesn't trust the browser; it re-designs and compares.
