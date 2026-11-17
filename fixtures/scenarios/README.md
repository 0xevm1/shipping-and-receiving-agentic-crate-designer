# Demo scenarios (#114)

Test files for the unusual inputs and requirements an interviewer might try. Rebuild them with
`bun run fixtures` (script: `scripts/fixtures/scenarios.mjs`; the output is the same every run).
The part files are plain boxes (Z up, metres) so the numbers are easy to say out loud.

The inches, millimetres, Y-up and off-origin files are a separate set from #105, in
`fixtures/units-axis/` (script `scripts/fixtures/units-axis.mjs`).

**How to load a part with a catalog.** Choose **Load a part** (or drop on the page) and pick
`parts.json` **together with** the `.glb`, in one go. The catalog entry whose `model` is the file
name gives the mass. A `.glb` on its own gets a 10 kg stand-in mass and a caution.
`parts.json` lists every part file below except the two with their own catalog.

The app opens in inches and pounds. Switch to **MM KG** (bottom right) to read the numbers here.

## Scenarios that are a file

| Scenario | Load | Mass | What it is |
|---|---|---|---|
| Heavy part | `parts.json` + `heavy-1500kg.glb` | 1,500 kg | 900 × 700 × 500 mm block |
| Heavy part, many | `parts.json` + `heavy-2000kg.glb`, then Rules: Quantity 8 | 2,000 kg | same block |
| Over the base rating | `parts.json` + `overweight-8000kg.glb` | 8,000 kg | 1,200 × 800 × 600 mm |
| Wider than the trailer door | `parts.json` + `wider-than-door.glb` | 400 kg | plate, 2,600 × 2,600 × 300 mm |
| Taller than the trailer door | `parts.json` + `taller-than-door.glb` | 150 kg | mast, 400 × 400 × 2,800 mm |
| Longer than 8 ft | `parts.json` + `longer-than-8ft.glb` | 40 kg | rail, 2,600 × 300 × 300 mm |
| Tiny, light part | `parts.json` + `tiny-light.glb` | 0.05 kg | 40 × 30 × 20 mm |
| Lopsided part | `parts.json` + `lopsided.glb` | 120 kg | shaft with a block on one end |
| Tall part, "this face down" | `parts.json` + `tall-part.glb` (then Rules: Faces a part may rest on, Any face; or take the lay-down offer in Checks) | 12 kg | post, 150 × 150 × 1,200 mm |
| Crate bigger than a plywood sheet | `parts.json` + `bigger-than-sheet.glb`, then the Cut list | 300 kg | 2,000 × 1,400 × 800 mm |
| Part over a pallet footprint | `parts.json` + `pallet-overhang.glb` | 200 kg | 1,300 × 1,100 × 1,000 mm |
| Model size disagrees with parts.json | `parts-size-mismatch.json` + `size-mismatch.glb` | 20 kg | model is 300 mm tall, catalog says 258 |
| `parts.json` entry with a missing field | `parts-missing-field.json` + `missing-field.glb` | none in the entry | the entry has no `mass_kg`; the entry is skipped and named, and the .glb loads with the 10 kg stand-in |
| Draco compression | `draco.glb` | | plain message |
| Meshopt compression | `meshopt.glb` | | plain message |
| Text glTF | `text.gltf` | | plain message |
| Not a model (renamed) | `not-a-model.glb` | | plain message |
| Not a model (other type) | `not-a-model.txt` | | plain message |
| Damaged GLB | `damaged.glb` | | plain message |
| A GLB with nothing in it | `empty-scene.glb` | | plain message |
| Invalid JSON | `not-json.json` | | plain message |

## The file check (#106)

One file per kind of finding. The toast says it in a line and **Details** opens the report (spec §6.6).

| Load | The check says |
|---|---|
| `parts-trailing-comma.json` | error: not JSON, line 4, column 3 |
| `not-json.json` | error: not JSON, line 1, column 3 |
| `parts-wrong-shape.json` | error: a list, not `{"parts": [...]}` |
| `parts-empty.json` | error: the `parts` list is empty |
| `parts-entry-not-object.json` + `heavy-1500kg.glb` | 2 errors: entries that are a string and `null`; the good one loads |
| `parts-bad-entries.json` + `heavy-1500kg.glb` | 6 errors (mass as text, negative mass, no id, a model that isn't `.glb`, a repeated id, a repeated model); the good entry loads |
| `parts-lenient.json` + `tall-part.glb` | clean: only id, name, model and mass; the size comes from the model |
| `parts-ignored-fields.json` + `tall-part.glb` | newer `schema_version`, unknown `model_units`, 3 unknown fields (notes), 4 optional fields ignored (warnings) |
| `parts-implausible.json` + `lopsided.glb` | a mass of 99,999,999 kg, a mass of 0.0002 kg, a density and a size that can't be right (warnings); the part loads |
| `parts-units-mm.json` + `shaft-millimetres.glb` | clean: `model_units: "millimeters"` is used, not guessed |
| `parts-units-wrong.json` + `shaft-millimetres.glb` | warning: `model_units` says meters, the size only fits millimetres |
| `parts-other-models.json` + `tall-part.glb` | 2 entries name files that weren't loaded; the .glb has no entry |
| `parts-size-mismatch.json` + `size-mismatch.glb` | warning: the model is 300 mm tall, the entry says 258 |
| `heavy-1500kg.glb` + `tiny-light.glb` | note: the first opens, the second was not used (#121) |
| `draco.glb`, `meshopt.glb` | error: compression the viewer can't read |
| `damaged.glb`, `not-a-model.glb`, `renamed-gltf.glb`, `renamed-stl.glb`, `old-version.glb` | error: damaged, not a binary glTF (naming a text glTF or an STL), glTF 1.0 |
| `empty-scene.glb`, `single-point.glb`, `flat.glb` | error: no geometry, no size, zero thickness |
| `sliver.glb` | warning: almost flat (0.04%) |
| `far-from-origin.glb` | note: 866 m from the origin, where sizes lose precision |
| `text.gltf`, `not-a-model.txt` | error: text glTF; not a .glb or .json |

## Scenarios that are settings (no file)

Use the preloaded bracket (PART-001, 21.5 kg). The app opens in inches; the numbers here are for
**MM KG**.

| Scenario | Steps |
|---|---|
| Quantity 7 or 13 | Rules → Quantity. Not limited to the suggested 1, 4, 8 |
| Quantity 200 | Rules → Quantity 200 |
| Quantity 500 | Rules → Quantity 500 (the app stops at 200, see #111) |
| Maximum crate weight | Rules → Shop standards → Limits → Max gross per crate: 100. Quantity 8 |
| Only certain plywood in stock | Shop standards → Stock on hand → Heavy, then Medium, then Light panel plywood (they must stay light ≤ medium ≤ heavy), and Floor plywood: set to the thickness on the shelf |
| Crates stacked on each other | Shop standards → Structure → Stacked on the lid: 500 |
| Cheapest instead of smallest | Quantity 8, Layouts → Rank layouts by: Crate cost, or Freight class |
| Forks from the side, four-way entry | Nothing to load. Checks → "Forklift fits from the ends" (#112) |
| Door or trailer limit | Shop standards → Limits → Trailer door width / height |

## Not covered by a file

Two different parts in one crate, export shipping, foam, bags, brackets, and parts nested by true
shape are out of scope. See `docs/demo-cheat-sheet.md` for the reasons.
