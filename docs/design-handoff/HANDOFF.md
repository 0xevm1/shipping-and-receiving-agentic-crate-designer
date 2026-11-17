# Design handoff: Crate Designer UI redesign

**For:** a Claude Code session working in this repo.
**From:** a design exploration done outside the repo, as a single-file HTML prototype.
**Date:** 2026-11-16.

Your job is to rebuild the app's interface to match the prototype, **on top of the existing
codebase**. Keep the domain layer, the tests and the three.js / react-three-fiber viewer. Do not
port the prototype's code.

Read `CLAUDE.md`, `AGENTS.md` and `docs/SPECIFICATION.md` first. They win over this file wherever
they conflict, except for spec §8 (UI), which this redesign replaces and which you must update in
the same change.

---

## 1. What is in this folder

| File | Use it for |
|---|---|
| `reference/prototype.html` | The design, runnable. Open it in a browser at desktop width (≥ 1200 px). This is the source of truth for look and behaviour |
| `reference/style.css` | Exact colours, type, spacing, glass treatment. Port the values, not the selectors |
| `reference/template.html` | DOM structure and all interface copy |
| `reference/app.js` | Behaviour reference: idle animation, mode cycling, fades, dimension lines, part loading. Search for the function names given below |
| `reference/domain.js` | **Do not port.** A quick JS re-implementation of `src/domain/` so the prototype could run standalone |

### What not to carry over

- **The renderer.** The prototype draws with hand-written WebGL because its sandbox could not load
  three.js. The real app keeps `@react-three/fiber` and `drei`.
- **The GLB parser** in `app.js`. Keep `useGLTF`.
- **`domain.js`.** `src/domain/` is the only place for business rules. The prototype's numbers
  matched the real app for PART-003 × 8 (1102 × 1082 × 809 mm, 101 kg tare, ~308 screws), but one
  rule was guessed: bearer width is `min(89, 0.35 × part width)` there. Ignore it.
- **The fonts.** The prototype falls back to Baskerville / Avenir Next / SF Mono because it could
  not load web fonts. See §3.

---

## 2. Who it is for

A project manager on the factory floor who owns shipping and receiving. Parts get dropped off and
they have to decide how to crate them. Today that is tribal knowledge and one-off solutions, and
this person is the bottleneck. The screen should answer "what crate do I build for this?" at a
glance, with the 3D view as the main element and detail one click away.

---

## 3. Visual system

Dark, full-bleed 3D scene with "liquid glass" overlays. Three type roles, one warm accent.

| Token | Value | Used for |
|---|---|---|
| Scene background | vertical gradient `#17130F` (bottom) → `#0C1621` (top), slight vignette | Canvas clear / page background |
| Text | `#EEF0F2` primary, `#B9C0C8` soft, `#8B949E` muted | |
| Hairline | `rgba(255,255,255,0.12)` | Dividers inside glass |
| Amber | `#EDA94D` | The answer (outside size, gross weight), selected layout, warnings |
| Ice | `#7FD0FF` | Selection only: highlighted boards, pinned cut-list row, part dimension lines |
| Green | `#7BD88F` | Passed checks |

**Glass** (islands and pills): `background: linear-gradient(165deg, rgba(120,124,130,0.22),
rgba(30,32,36,0.34))`, `backdrop-filter: blur(16px) saturate(170%)`, 1 px border
`rgba(255,255,255,0.16)`, inset top highlight `rgba(255,255,255,0.22)`, drop shadow
`0 18px 44px rgba(0,0,0,0.38)`. Islands use a 30 px radius, pills are fully round. The user asked
for this level of translucency explicitly; do not make it more opaque.

**Type**

- Display serif for the app name (roman, 34 px), island titles (italic, 25 px) and the outside size
  (roman, 40 px, amber). Recommended: **Instrument Serif** through `next/font/google`.
- Sans for labels and body, 13–15 px. Geist Sans is already loaded and is fine.
- Mono for every measured value and for the small status text. Geist Mono is already loaded.
- The tagline beside the app name is the one tracked-out uppercase mono label. Do not add more.

**Scene**

- Wood stays warm and well lit against the dark floor. Existing `COLORS` in `CrateModel.tsx` are
  close; bearers and blocking are darker (`~#85522B`) so dunnage reads apart from the crate.
- Floor: faint grid, 500 mm squares (1 ft in imperial), fading with distance. A soft warm light
  pool under the crate instead of a dark contact shadow.
- Board edges stay dark brown. Highlighted boards turn ice blue with light edges.

---

## 4. Layout

Everything sits above the fold at desktop width. Nothing scrolls except the island's panel.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Crate Designer  SHIPPING AND RECEIVING              ┌───────────────────┐ │
│ PART-001 · 4140 steel · 21.5 kg each                │ Part name  [Load] │ │
│ 360 × 220 × 258 mm · model matches catalog          │   (rotating part) │ │
│                                                     │ ┌───────────────┐ │ │
│                                                     │ │ tabs          │ │ │
│              3D crate, full bleed                   │ └───────────────┘ │ │
│              centred in the free space              │  selected panel   │ │
│                                                     │  (scrolls)        │ │
│                                                     └───────────────────┘ │
│ Drop a .glb file anywhere            (mode icon) [mm kg|in lb] [View] [Hide panels] │
└───────────────────────────────────────────────────────────────────────────┘
```

| Region | Contents | Notes |
|---|---|---|
| Top left, floating text | App name, tagline, two mono lines of part metadata | No glass. Line 1: id, material, mass each. Line 2: size, model check |
| Upper right, one island (440 px wide) | Part name + "Load a part" pill; rotating part view (170 px tall); tabs; the selected tab's panel | The tabs are part of the island, at the bottom of its head |
| Bottom left, floating text | "Drop a .glb file anywhere" and any load error | No glass, no button |
| Bottom right, view bar | Mode icon (bare, no pill), units pill, "View" pill with popover, "Hide panels" pill | |

The crate is centred in the area the panels leave free, not in the window. The prototype does this
with a clip-space shift (`freeArea()` and `viewProj()` in `app.js`). In three.js use
`camera.setViewOffset` or an equivalent projection offset, and fit the bounding sphere to the free
rectangle rather than the full canvas.

Below ~980 px wide the prototype stacks: text, canvas (54 vh), view bar, island. Keep a stacked
fallback but desktop is the priority.

---

## 5. Tabs

One panel shows at a time. This is the "detail view": the main screen is not overloaded, and
depth is one click away.

| Tab | Contents |
|---|---|
| **Overview** (default) | Title "Crate for N × part". Outside size, large and amber. Other-unit size, shipping volume, gross weight. A vertical chain: Parts → Layout → Walls and lid → Base → Blocking → Gross weight (last dot amber). Then crate weight by assembly as thin bars; hovering a bar highlights that assembly in 3D |
| **Layouts** | A sentence on why the recommended layout won. One card per layout: a small top-view and side-view drawing, grid description, outside size, orientation, volume, a bar comparing volume. Badges "recommended" and "may tip". First four shown, then "Show all N layouts" |
| **Cut list** | Grouped by assembly: Base, Side walls, End walls, Lid, Inside the crate. Columns: piece, stock, cut, qty. Hovering a row highlights those boards and fades everything else; clicking pins it. Totals for plywood, lumber and screws. Download and copy buttons |
| **Rules** | Quantity (stepper plus the part's suggested quantities), keep upright, most layers, gap between parts, clearance to walls, wall and lid plywood, reset |
| **Checks** | Every check listed, passed ones included, cautions first. A count badge on the tab when there are cautions |

Quantity lives in Rules because the user asked for the quantity pill to be removed from the part
area. It is still the main input, so treat its placement as open and confirm with the user if it
feels buried.

---

## 6. 3D behaviour

### View modes

Three modes: **closed** (everything on), **open** (lid and front wall hidden), **exploded** (walls
out 320 mm, lid up 420 mm). These correspond to today's `assembled`, `cutaway` and `exploded` in
`CrateModel.tsx`.

- One bare icon in the view bar shows the current mode. Each click steps closed → open → exploded.
- Transitions are continuous, not a swap: explode distance eases, and the lid and front wall
  **fade** in and out by opacity. The current `isVisible()` on/off test needs to become an alpha.
- The "View" popover holds finer control: camera presets (3D, Top, Front, End), switches for lid,
  front wall, blocking, parts and size labels, and a continuous "Pull apart" slider.

### Idle animation

- When there has been no pointer, wheel or key input anywhere on the page for **6 s**, the crate
  turns about the vertical axis at **0.3 rad/s** and steps through the sequence
  **closed → exploded → open → exploded → repeat**.
- **Every mode lasts half a revolution.** The transition to the next mode starts 0.12 of a turn
  before the switch and eases slowly (rate ≈ 1.5 /s, against ≈ 10 /s for a user-triggered change),
  so it lands as the half-turn completes.
- Any input stops it immediately. It also holds still while a cut-list row is pinned or a board is
  hovered. It resumes from the mode on screen.
- It runs on first load.
- Respect `prefers-reduced-motion`: no auto-rotation, mode changes are instant.
- With drei, `OrbitControls` `autoRotate` covers the turning; the idle timer, sequence and eased
  fades live in a `useFrame` hook. See `frame()`, `SEQ`, `applyMode()` in `app.js`.

### Part view (in the island)

- The part on its own, no crate, transparent background, slowly turning (0.45 rad/s).
- Click or touch stops it; drag turns it, scroll zooms. Double-click resets tilt and zoom.
- It starts turning again after the same 6 s of idle, from the angle it was left at.
- Implement as a second small `<Canvas>` or a drei `<View>`.

### Dimension lines

- **Crate:** three lines for outside length, width and height, with mono pill labels. Length along
  the front bottom edge, width along the right bottom edge, height at the back right corner. They
  stay visible in every mode; when exploded they slide outward by the wall offset so they clear the
  pieces, and the numbers stay the assembled size.
- **Part:** in open and exploded modes, one part (top layer, front row, rightmost) carries its own
  three dimensions along the edges of its bounding box, in ice blue. Hidden when closed.
- Both sets follow the "Size labels" switch.
- drei `<Line>` plus `<Html>` labels work. Draw them without depth testing so they are never buried.

### Picking and highlight

- Hovering a board shows a small glass tooltip: piece name, stock, cut, how many in the crate.
- Clicking a board pins its cut-list group, opens the Cut list tab and scrolls to the row. A small
  ice-blue bar "Showing N × piece" with "Show everything" appears in the view bar. Escape clears it.
- While a group is focused (pinned, or hovered from the cut list or weight bars), every other
  board and all parts draw at about 7–10 % opacity so hidden boards show through.

### Hide panels

Fades out everything except the "Show panels" pill and re-fits the crate to the whole canvas.

---

## 7. Loading a part

- The steel bracket (PART-001) is preloaded as the example. There is no part switcher.
- A different part comes in through "Load a part" (file picker) or by dropping a `.glb` anywhere on
  the page. A full-page veil reads "Drop a .glb file to load the part" while dragging.
- If the file name matches a catalog entry's `model`, use that entry's mass, material and
  suggested quantities, and run the existing bounds check.
- Dropping a `parts.json` alongside adds its entries to the lookup first.
- An unrecognised GLB has no mass. The prototype uses a **10 kg stand-in**, shows an editable mass
  field in the metadata line, and raises a caution in Checks until a real value is entered. Mass is
  never inferred from the mesh (spec §6.1).
- Reject text `.gltf` and Draco / Meshopt-compressed files with a plain message.
- Files are read as metres, Z up, like the samples. The prototype treats a model more than 20 m
  across as millimetres. Keep or drop that heuristic deliberately.

This is GitHub issue **#3** (upload a custom GLB with user-entered mass and material).

---

## 8. Mapping onto the existing code

| Area | Today | Change |
|---|---|---|
| `src/components/CrateDesigner.tsx` | Three-column grid, light theme, owns `settings`, `layoutKey`, `mode`, `measured` | Becomes the full-bleed shell with overlay regions. Add state for: active tab, units, loaded part, hover / pin, view toggles, panels hidden |
| `src/components/ControlsPanel.tsx` | Left column inputs, part cards | Split up. Packing inputs and quantity → Rules tab. Part cards go away |
| `src/components/SummaryPanel.tsx` | Stats, warnings, `AlternativesTable`, `CutList` | Split into Overview, Layouts (cards with drawings), Cut list (grouped, hover-linked), Checks |
| `src/components/viewer/CrateViewer.tsx` | Canvas, lights, `CameraRig`, `ContactShadows`, `Grid`, light background | Dark scene, light pool, view offset for the free area, idle rotation, dimension lines. Keep the single Z-up → Y-up transform here |
| `src/components/viewer/CrateModel.tsx` | Boxes with `Edges`, `ViewMode`, on/off `isVisible`, fixed `EXPLODE_MM` | Continuous explode factor and per-face opacity; hover / pin / ghost states; pointer events for picking |
| `src/components/viewer/PartInstances.tsx` | Clones the GLB per slot | Add ghost opacity. Reuse the loaded scene for the island's part view |
| `src/app/globals.css`, `layout.tsx` | Light tokens, Geist | Dark tokens from §3, add the display serif |

### Domain changes this design needs

Make these in `src/domain/`, with tests, and update spec §6–§7 in the same change.

1. **Assembly and face on each `Member`.** The UI groups the cut list by assembly and moves or
   fades boards by face (`lid`, front side, back side, each end, base, inside). `CrateModel` infers
   this from geometry today. Tag it where the member is created instead.
2. **Finer BOM labels.** The cut list distinguishes side rail / side upright / end rail / end
   upright / lid edge cleat / lid cross cleat. Today these are all `cleat` or `lid-cleat`, and
   `BomLine` has no assembly. Add a label and assembly to the grouping key.
3. **`computeDesign` must accept a part that is not in the catalog.** It currently calls
   `getPart(settings.partId)`. A loaded GLB needs a `Part` built at runtime; `PartSchema` requires
   `density_kg_m3` and `material`, which a bare GLB does not have.
4. **Checks that report passes.** `warnings[]` only carries problems. The Checks tab lists passed
   rules too ("Fits a standard trailer door", "Stable footprint", "Every part is blocked in",
   "Within the standard base rating"). Either return structured checks from the domain or derive
   them from the same constants.
5. **Units.** A display-only metric / imperial toggle: mm ↔ in (one decimal for overall sizes,
   nearest 1/16 in for cuts), kg ↔ lb, m³ ↔ ft³. Conversion stays out of the domain (spec §4).
   This is issue **#15**.
6. **Why this layout.** One sentence comparing the recommended layout with the next one. Issue
   **#11**.

### Things that already exist and should be reused

`computeDesign`, `enumerateLayouts`, `compareLayouts`, `designCrate`, `bomToCsv`, `downloadText`,
the `CameraRig` fitting maths, the `LoadingOverlay` approach (DOM overlay, never drei `<Html>` as a
Suspense fallback), and `next/dynamic` with `ssr: false` for the canvas.

---

## 9. Suggested order

1. Dark tokens, fonts, full-bleed shell with the four regions, existing panels dropped into tabs.
2. Viewer restyle: background, floor, light pool, free-area centring.
3. Domain: member assembly / face, BOM labels, structured checks. Tests first.
4. Continuous modes: explode factor, opacity fades, mode icon, View popover.
5. Cut list ↔ 3D linking: hover, pin, ghosting, tooltip.
6. Dimension lines, crate then part.
7. Part view in the island; idle rotation and mode cycling.
8. Part loading (issue #3), then units (#15).
9. Update `docs/SPECIFICATION.md` §8 and anything in §6–§7 that changed.

Each step is shippable on its own. Per `CLAUDE.md`: open a GitHub issue, branch as
`<type>/<issue>-<slug>`, and run `bun run test`, `bun run lint` and `bun run build` before pushing.

---

## 10. Acceptance checks

- At 1440 × 900 nothing scrolls except the island's panel, and the crate is fully visible beside it.
- PART-003 × 8 with default rules shows 1102 × 1082 × 809 mm and about 308 screws, as the real app
  does today. The redesign must not change any domain output; compare a few part / quantity pairs
  before and after. (The prototype shows 932 × 652 × 497 mm for PART-001 × 4, but that figure comes
  from the prototype's own port and was not checked against this repo.)
- Leave the page alone for 6 s: the crate turns and goes closed → exploded → open → exploded, half
  a turn each, with the lid and front wall fading rather than popping. Move the mouse: it stops.
- Grab the part in the island: it stops. Leave it 6 s: it turns again from where it was.
- Hover a cut-list row: those boards turn ice blue and the rest fade. Click a board in 3D: the Cut
  list tab opens on its row.
- Drop `PART-002-long-steel-shaft.glb`: mass and material fill in from the catalog. Drop an unknown
  GLB: a mass field appears and Checks shows a caution until it is filled.
- Size labels remain in exploded mode. Part dimensions show in open and exploded, not closed.
- With reduced motion on, nothing auto-rotates.
- Existing tests in `src/domain/domain.test.ts` still pass.

---

## 11. Known gaps in the prototype

Treat these as untested when you rebuild them:

- Only ever checked as still screenshots at about 1240 px wide. The animation timing, the idle
  resume, drag-and-drop loading and the narrow layout were never watched running.
- The cut-list download and copy buttons were not tested; the prototype's sandbox may block both.
- Glass legibility was checked against the dark floor, not with the lit crate passing behind the
  island during rotation.
- Persistence, sharing by URL and a printable build sheet are out of scope here (issues #14, #9).
