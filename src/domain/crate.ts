import { buildBom, screwCount } from "./bom";
import { constructionFor, resolveConstruction, structureMaterials } from "./construction";
import { crateCost, estimateLabour, freightTerms } from "./cost";
import { addCradleDunnage, usesCradles } from "./cradles";
import { evaluateChecks } from "./crateChecks";
import type { CrateDesign } from "./crateDesign";
import { addDunnage } from "./dunnage";
import { analyseHandling } from "./handling";
import { materialTotals } from "./materials";
import type { AddMember, Member } from "./members";
import type { Layout } from "./packing";
import { restraint, usableProfile } from "./profile";
import type { CrateSettings, DesignPart } from "./schema";
import { addShell } from "./shell";
import { DEFAULT_STANDARDS, type ShopStandards } from "./standards";
import { planStructure } from "./structure";

/**
 * Turns a packing layout into a buildable wooden crate: every board as an axis-aligned box,
 * plus a cut list, weights, fastener count and checks. This module only wires the steps
 * together; each lives in its own module:
 *
 * - `construction.ts`: board sizes picked from the payload and the structural plan,
 * - `shell.ts`: floor, skids, walls and lid; `dunnage.ts` and `cradles.ts`: what holds the parts,
 * - `bom.ts`: the cut list and screw schedule; `materials.ts`: weights and wood quantities,
 * - `crateChecks.ts` and `handling.ts`: the rules.
 *
 * Every size, threshold, limit and rate comes from the shop standards (`standards.ts`).
 * Coordinates: interior min corner at the origin (top face of the floor), Z up, X along the
 * crate's length (skids run along X, forklift entry from the ends).
 */

// The crate's public types and entry points, importable from this one path.
export { ASSEMBLIES, ASSEMBLY_NAMES } from "./members";
export type { Assembly, Face, Member, MemberKind } from "./members";
export type { BomLine, ScrewLine } from "./bom";
export { screwSchedule } from "./bom";
export type { Check } from "./check";
export type { Construction } from "./construction";
export { resolveConstruction, structureAllowance, structureMaterials } from "./construction";
export type { CrateDesign } from "./crateDesign";
export { SHAPED_BLOCK } from "./dunnage";

export function designCrate(
  part: DesignPart,
  settings: CrateSettings,
  layout: Layout,
  standards: ShopStandards = DEFAULT_STANDARDS,
): CrateDesign {
  const payloadKg = part.mass_kg * settings.quantity;
  const materials = resolveConstruction(settings, payloadKg, standards);
  const structure = planStructure(layout, structureMaterials(materials, standards), payloadKg, settings.partGapMm, standards);
  const construction = constructionFor(materials, structure);

  const members: Member[] = [];
  const add: AddMember = (kind, material, tag, min, size, cradle) => {
    if (size.every((s) => s > 0.5)) members.push({ kind, material, ...tag, bomKey: "", min, size, ...(cradle && { cradle }) });
  };
  addShell(layout.interior, construction, add, standards);

  // Slender parts lying flat sit in notched cradles; everything else is blocked,
  // shaped to the part when it has a measured profile.
  const cradled = usesCradles(part.dimensions_mm, layout, standards);
  const profile = cradled ? null : usableProfile(part);
  if (cradled) addCradleDunnage(layout, settings, standards, add);
  const pieces = cradled ? [] : addDunnage(layout, settings, construction.panelMm, standards, add, profile);

  const bom = buildBom(members);
  const { volumeM3, tareKg, tareKgByAssembly, plywoodM2, lumberM } = materialTotals(members, standards);
  const costPerM3 = standards.rates.costUsdPerM3;
  const materialCostUsd = volumeM3.plywood * costPerM3.plywood + volumeM3.lumber * costPerM3.lumber;
  const screws = screwCount(members, layout.interior, standards);
  const grossKg = payloadKg + tareKg;
  const labour = estimateLabour(bom, screws, layout.counts[2], standards);
  const freight = freightTerms(grossKg, layout.external, standards);
  // Read-only over the finished members and part placements.
  const handling = analyseHandling(members, layout, part.mass_kg, standards);

  const design: CrateDesign = {
    layout,
    construction,
    members,
    bom,
    payloadKg,
    tareKg,
    tareKgByAssembly,
    grossKg,
    plywoodM2,
    lumberM,
    screws,
    materialCostUsd,
    labour,
    cost: crateCost(materialCostUsd, screws, labour.costUsd, standards),
    freight,
    structure,
    handling,
    checks: [],
  };
  if (profile) {
    const boxPieces = addDunnage(layout, settings, construction.panelMm, standards, () => {}, null);
    design.shapedBlocking = {
      shaped: restraint(profile, layout, pieces),
      boundingBox: restraint(profile, layout, boxPieces),
      blocks: members.filter((m) => m.variant === "shaped-block").length,
    };
  }
  design.checks = evaluateChecks(design, part, settings, standards);
  return design;
}
