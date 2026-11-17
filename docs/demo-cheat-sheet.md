# Demo cheat sheet

What the app does with inputs it may not have seen. Every "does" cell was run in the live app
(production build, 1440 × 900, MM KG) for #114; numbers are from that run. The rows for the faces a
part may rest on, the size limit, the part's centre of gravity, the quantity note and hand-carry
crates were run again for #139, after those tickets merged. Test files:
`bun run fixtures`, listed in `fixtures/scenarios/README.md`. The app opens in **inches**: use
**MM KG** (bottom right) to read the numbers below. Drop a `parts.json` with the `.glb` to give a
part its mass; a `.glb` alone gets a 10 kg stand-in and a caution. Every file you drop is checked
first (#106): when something is wrong or assumed, the toast says it in a line and **Details**
opens the **File check** report (it stays under **File check**, by Load a part, until the next load).

## Handled: say it with confidence

| If they ask | Do | The app does | Decided by |
|---|---|---|---|
| A 1,500 kg part | `heavy-1500kg.glb` | 1,076 × 876 × 886 crate, no cautions. Base rated 2,031 kg, 3 skids 4x6, "skid shear governs" | `structure.ts` `sizeBase` (spec §7.15) |
| 2,000 kg parts, 8 of them | `heavy-2000kg.glb`, Quantity 8 | 8 crates of one; caution "One part alone is over the per-crate limit (1,000 kg gross or the base rating…)" | `shipment.ts` `planShipment`, `limits.perCrate.maxGrossKg` |
| An 8,000 kg part | `overweight-8000kg.glb` | Caution "Over the base rating": rated 2,592 kg, "skid bending governs". It still draws a crate | `structure.ts`, check `base-rating` |
| Wider or taller than the door | `wider-than-door.glb`, `taller-than-door.glb` | Caution "Too big for a 53' dry van", names Width or Height against 2,489 / 2,743 mm. A tall one also gets tip-over and top-heavy | `crateChecks.ts` `door`, `limits.trailerMm` |
| Longer than 8 ft | `longer-than-8ft.glb` | Info "LTL length surcharge likely" (crate is 2,762 long; limit 2,438) | check `oversize`, `limits.ltlExcessiveLengthMm` |
| Odd quantity (7, 13) | Rules → Quantity | Packs them (7: 938 × 658 × 823; 13: 2,008 × 938 × 500). The 1, 4, 8 buttons are only suggestions | `packing.ts` `enumerateLayouts` |
| 200 parts | Quantity 200 | 7 crates: 6 of 30 plus 1 of 20, each 2,176 × 936 × 971 for the 30. Header shows the shipment total | `planShipment`, `limits.perCrate` |
| 500 parts | Quantity 500 | The quantity stops at 200 (6 crates of 30 plus 1 of 20) and a note under it says so: "One crate holds at most 200. To ship 500, use Parts to ship on the Overview." **Go to Parts to ship** opens the Overview with 500 typed in the field (the shared job's field; it needs the server). Type the total there and press Enter for the split | `quantityCap.ts` `quantityCapNote`, `RulesTab.tsx`, #111 |
| Max crate weight | Shop standards → Max gross per crate 100, Quantity 8 | 4 crates of 2, 652 × 522 × 497 each | `limits.perCrate.maxGrossKg` |
| Draco, Meshopt, text .gltf, not a GLB, damaged file, an empty or flat model | `draco.glb` etc. | A message in the top toast that says what is wrong and what to do ("draco.glb can't be opened. That .glb uses Draco compression, which the viewer can't read. Export it again without Draco compression."), with Details and a dismiss button. The crate on screen is not touched | `fileCheck.ts` `checkFiles`, `domain/glbInfo.ts`, spec §6.6 |
| A `parts.json` entry with a missing field | `parts-missing-field.json` + `missing-field.glb` | The entry is skipped and named: toast "parts-missing-field.json: 1 entry skipped (SCN-900: mass_kg). missing-field.glb: loaded with stand-in details." The part loads with the 10 kg stand-in (crate 462 × 362 × 439). Details: "SCN-900 has no mass_kg, so it was skipped. Add the mass of one part in kilograms, like 12.5." Only `id`, `name`, `model` and `mass_kg` are required: `parts-lenient.json` + `tall-part.glb` loads with no material, size or quantities | `fileCheck.ts`, `schema.ts` `CatalogEntry`, spec §6.1 |
| A `parts.json` with a typo, an odd field, a newer version | `parts-trailing-comma.json`, `parts-bad-entries.json` + `heavy-1500kg.glb`, `parts-ignored-fields.json` + `tall-part.glb` | Not JSON: "…unexpected "]" at line 4, column 3" and nothing changes. Six bad entries: each named with its field, the good one loads. A `schema_version` of 2.0, an unknown `model_units` and unknown fields: it loads, and the report names each ("parts-ignored-fields.json: 7 fields ignored, newer schema_version, unknown model_units.") | `fileCheck.ts`, spec §6.6 (the rules, with their codes) |
| Two `.glb` files at once | `heavy-1500kg.glb` + `tiny-light.glb` | "Opened heavy-1500kg.glb. The app designs one part at a time, so tiny-light.glb was not used." Drop the second alone to design it. No chooser | `fileCheck.ts` `glb-extra`, spec §6.6 |
| An absurd mass | `lopsided.glb` alone, type 99999999 in the header's mass | Accepted, with a warning under the header ("99,999,999 kg is more than 20,000 kg, the most one part is taken to weigh. Check for an extra digit or the wrong unit."), a Checks caution "Part mass looks wrong", and the scorecard drops the freight class and says its weights and cost are not real (it was class 50). The same limit warns for a `parts.json` mass | `fileCheck.ts` `MAX_PLAUSIBLE_MASS_KG`, `massWarning` |
| A file in inches, or Y up | `bracket-inches.glb`, `shaft-inches.glb`, `bracket-y-up.glb` (in `fixtures/units-axis/`) | The header has **File units** and **Up axis** selects for a loaded file. The units are guessed from the size and can be overridden: the inch bracket (14 units) is read as inches, 360 × 220 × 258 mm (toast: "units guessed from the size"); the 60 in shaft reads as a 60 mm part (240 × 240 × 317 crate) until **File units** is set to inches: 1,530 × 172 × 172 mm, crate 1,692 × 334 × 411. A Y-up bracket lies on its side (crate 522 × 420 × 459) until **Up axis** is Y up (522 × 382 × 497). A `parts.json` with `model_units` skips the guess | `partFrame.ts`, `setPartFrame`, #105; `model_units`, #106 |
| Model size differs from `parts.json` | `parts-size-mismatch.json` + `size-mismatch.glb` | Caution "3D model does not match the catalog": 360 × 220 × 300 vs 360 × 220 × 258. Tolerance 1 mm. The File check report says the same as a warning | `fileCheck.ts` `MODEL_TOLERANCE_MM`, `sizeMatches` |
| Only some plywood in stock | Shop standards → Stock on hand: set Heavy, then Medium, then Light panel plywood, and Floor, to 18 | Walls and lid and the floor are all 18 mm; 4 brackets go from 932 × 652 × 497 to 944 × 664 × 502. Set in the other order the field refuses ("light ≤ medium ≤ heavy") | `standards.ts` `stock.panelPlywoodMm` |
| Crates stacked on each other | Shop standards → Structure → Stacked on the lid 500 | Lid is resized, crate 70 mm taller (497 to 567); check "Lid carries the stacking load: rated 528 kg" | `structure.ts` `sizeLid`, `structure.lidStackKg` |
| Cheapest, not smallest | Layouts → Crate cost / Freight class | Re-ranks the layouts with the reason. For 8 brackets all three rankings pick the same crate | `design.ts` `rankLayouts`, spec §7.2 |
| "Must fit a pallet position / door" | Shop standards → Limits → Max crate length 1,220 and Max crate width 1,020 (mm); `pallet-overhang.glb` (1,300 × 1,100 × 1,000 mm), Quantity 4 | 4 crates of one, caution "Over the per-crate limit: One part alone is over the per-crate limit (… outside length 1,220 mm, width 1,020 mm at most …), so each part ships in its own crate." Length and width may swap; height never does. A batch that is bigger than the limit splits into crates that fit it, as for weight. **At Quantity 1 nothing is said**: a single part is never split, so it stays "All checks clear" (see the known gaps) | `shipment.ts` `withinSizeLimit`, `limits.perCrate.maxOutsideMm`, spec §7.10, #108 |
| Tall part, "this face down" | `parts.json` + `tall-part.glb` (150 × 150 × 1,200 mm, 12 kg), Checks | Stands up as modelled in a 312 × 312 × 1,439 mm crate: cautions "Tip-over risk" (4.61× the short side) and "Top-heavy" (tips at 12°), plus forklift and pallet jack. Checks offers "Laying the parts down gives a stable crate" (1,362 × 312 × 389 mm); its button, "Allow resting on the front and back faces", clears both tipping cautions (1.25×, tips at 40°). Forklift and pallet jack stay cautions (the 134 mm opening). Rules → **Faces a part may rest on** (As modelled, Any face, Choose) sets it by hand | `restingFaces.ts` `layDownOffer`, #109 |
| Lopsided part | `parts.json` + `lopsided.glb` (120 kg, shaft with a block on one end) | Opens at 4 per crate. Caution "Off-centre centre of gravity": 232 mm toward the right end, over the 137 mm limit, "The part's own centre of gravity is estimated from the model's mesh (uniform density)". The header shows the centre too. If you know it, type it into the header's centre-of-gravity field (mm, or inches) or give `cog_mm` in `parts.json`: the check then says it is the one supplied. With neither it is assumed at the middle of the box and says so | `cog.ts` `estimateCog`, `handling.ts`, spec §7.14, #110 |
| A tiny, light part | `parts.json` + `tiny-light.glb` (40 × 30 × 20 mm, 0.05 kg) | Opens at 8 per crate: 292 × 272 × 341 mm, gross 10.1 kg. Check "Light enough to carry by hand" (limit 23 kg, a Shop standard) in place of the forklift and pallet jack cautions. Still "Mostly empty space" and "A cardboard box may be enough" | `handling.ts` `handCarryMaxKg`, #113 |
| A narrower door | Shop standards → Trailer door width 600 | The 4-bracket crate repacks from 932 × 652 to 1,192 × 522 so it passes | `shipment.ts` `withinOutsideLimits` (layouts outside the door are passed over when one fits) |

## Known gaps: say "not yet, tracked as #N" and what you would do

| If they ask | The app does today | Ticket |
|---|---|---|
| A crate bigger than a plywood sheet | Cut list has panels 2,168 × 1,568 mm; no splice | #107 |
| Forks from the side | End entry only; Checks say "Forklift fits from the ends" | #112 |
| A size limit and one part | A single part (Quantity 1) over the Max crate size is not flagged: `pallet-overhang.glb` with a 1,220 × 1,020 limit is "All checks clear". From Quantity 2 up it says so | spec §7.10 |
| A part's centre of gravity through the API | A job made only through the API designs with the centre at the middle of the box until a caller sends `cog`; the browser estimates it | spec §7.14 |

## Out of scope: one line each

- **Two different parts in one crate:** the brief says copies of *a* part.
- **Export shipping (ISPM-15, ocean, air):** domestic only (spec §7.7, #13).
- **Foam, bags, metal brackets:** the brief excludes them; the crate is wood and screws.
- **Nesting by true shape:** parts pack by bounding box; blocking follows the shape (#16). The "Mostly empty space" check says so.

## If something goes wrong live

- **Wrong rules:** Rules → **Reset rules** (keeps the quantity). Wrong house rules: Rules → Shop standards → **Reset to defaults**.
- **Wrong crate on screen:** reload. The last crate comes back (200 parts, reloaded: same 7 crates).
- **A file did not load:** read the toast at the top (an error stays until dismissed); **Details** has the whole File check. The old crate is still valid.
- **Something looks off after a load:** the **File check** button by **Load a part** (with a count) opens the report for the last load; **Copy report** gives it as text.
- **Numbers look foreign:** the in / mm toggle is bottom right (**IN LB** / **MM KG**).
- **Part units and up axis:** the header's **File units** and **Up axis** selects (for a loaded file, not the three catalog parts) re-read it at once. The units are only guessed from the size, so a part that looks 25 times too small or large is the first thing to check; Y up is never guessed.
- **Export button:** reads **Export Packing Specs**; it is green, and shows a dot when there are cautions.
