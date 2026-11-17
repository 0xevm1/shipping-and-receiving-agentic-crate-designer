# Demo cheat sheet

What the app does with inputs it may not have seen. Every "does" cell was run in the live app
(production build, 1440 × 900, MM KG) for #114; numbers are from that run. Test files:
`bun run fixtures`, listed in `fixtures/scenarios/README.md`. The app opens in **inches**: use
**MM KG** (bottom right) to read the numbers below. Drop a `parts.json` with the `.glb` to give a
part its mass; a `.glb` alone gets a 10 kg stand-in and a caution.

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
| 500 parts | Quantity 500 | **Stops at 200 without saying so** (known gap, #111). Same result as 200 | `RulesTab.tsx` `MAX_QTY` |
| Max crate weight | Shop standards → Max gross per crate 100, Quantity 8 | 4 crates of 2, 652 × 522 × 497 each | `limits.perCrate.maxGrossKg` |
| Draco, Meshopt, text .gltf, not a GLB, damaged file | `draco.glb` etc. | A message in the top toast, with a dismiss button. The crate on screen is not touched | `loadPart.ts` `glbProblem`, `loadPartFiles` |
| Model size differs from `parts.json` | `parts-size-mismatch.json` + `size-mismatch.glb` | Caution "3D model does not match the catalog": 360 × 220 × 300 vs 360 × 220 × 258. Tolerance 1 mm | `lib/checks.ts` `MODEL_TOLERANCE_MM` |
| Only some plywood in stock | Shop standards → Stock on hand: set Heavy, then Medium, then Light panel plywood, and Floor, to 18 | Walls and lid and the floor are all 18 mm; 4 brackets go from 932 × 652 × 497 to 944 × 664 × 502. Set in the other order the field refuses ("light ≤ medium ≤ heavy") | `standards.ts` `stock.panelPlywoodMm` |
| Crates stacked on each other | Shop standards → Structure → Stacked on the lid 500 | Lid is resized, crate 70 mm taller (497 to 567); check "Lid carries the stacking load: rated 528 kg" | `structure.ts` `sizeLid`, `structure.lidStackKg` |
| Cheapest, not smallest | Layouts → Crate cost / Freight class | Re-ranks the layouts with the reason. For 8 brackets all three rankings pick the same crate | `design.ts` `rankLayouts`, spec §7.2 |
| A narrower door | Shop standards → Trailer door width 600 | The 4-bracket crate repacks from 932 × 652 to 1,192 × 522 so it passes | `shipment.ts` `withinOutsideLimits` (layouts outside the door are passed over when one fits) |

## Known gaps: say "not yet, tracked as #N" and what you would do

| If they ask | The app does today | Ticket |
|---|---|---|
| A file in inches, or Y up | Reads metres, or mm above 20 units. An inch bracket becomes a 14 m crate with 3 cautions. Y up is read as Z up, so a tall post lies down | #105 (pending: units and up-axis controls) |
| A `parts.json` entry with a missing field | The entry is dropped without a message; the part loads with the stand-in mass | #106 |
| A crate bigger than a plywood sheet | Cut list has panels 2,168 × 1,568 mm; no splice | #107 |
| "Must fit a pallet position / door" | Only the trailer limit applies; a 1,300 × 1,100 part gets "All checks clear" | #108 |
| Tall part, "this face down" | Stands upright: tip-over and top-heavy cautions (plus forklift and pallet jack). Keep parts upright off lays it flat. No choice of face | #109 |
| Lopsided part | Weight is at the box centre: "All checks clear" | #110 |
| Forks from the side | End entry only; Checks say "Forklift fits from the ends" | #112 |
| A tiny, light part | 240 × 240 × 317 crate for a 40 mm pin; forklift and pallet jack cautions; "Mostly empty space"; carton suggestion | #113 |

## Out of scope: one line each

- **Two different parts in one crate:** the brief says copies of *a* part.
- **Export shipping (ISPM-15, ocean, air):** domestic only (spec §7.7, #13).
- **Foam, bags, metal brackets:** the brief excludes them; the crate is wood and screws.
- **Nesting by true shape:** parts pack by bounding box; blocking follows the shape (#16). The "Mostly empty space" check says so.

## If something goes wrong live

- **Wrong rules:** Rules → **Reset rules** (keeps the quantity). Wrong house rules: Rules → Shop standards → **Reset to defaults**.
- **Wrong crate on screen:** reload. The last crate comes back (200 parts, reloaded: same 7 crates).
- **A file did not load:** read the toast at the top (it stays until dismissed). The old crate is still valid.
- **Numbers look foreign:** the in / mm toggle is bottom right (**IN LB** / **MM KG**).
- **Part units and up axis:** controls arrive with #105; until then say the file must be metres, Z up.
- **Export button:** reads **Export Packing Specs**; it is green, and shows a dot when there are cautions.
