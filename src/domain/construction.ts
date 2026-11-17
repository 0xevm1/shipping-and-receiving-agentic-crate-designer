import type { CrateSettings, Vec3 } from "./schema";
import { DEFAULT_STANDARDS, type ShopStandards } from "./standards";
import type { LaidSection, StructureMaterials, StructurePlan } from "./structure";

/**
 * Board sizes for a crate: the panel and floor plywood and the cleat stock picked from the
 * payload, and the base and lid the structural sizing then settles on (`structure.ts`).
 */

export interface Construction {
  panelMm: number;
  floorMm: number;
  /** The skid section `planStructure` chose. */
  skid: { wide: number; tall: number };
  /** Cleat section for the wall and lid frames. */
  cleat: { thick: number; wide: number };
  skidCount: number;
  /** Floor joists across the skids: section as laid (`wide` along X, `tall`) and count; null when none. */
  joist: { wide: number; tall: number; count: number } | null;
  /** Lid edge and cross members: section as laid, cross-member count, and whether they are joists on edge. */
  lid: { wide: number; tall: number; count: number; joists: boolean };
  /** Bottom of the skids to the top of the floor, mm: skids + joists + floor. */
  baseMm: number;
}

/** What `resolveConstruction` picks from the payload alone; `minSkid` is the smallest skid allowed. */
interface ConstructionMaterials {
  panelMm: number;
  floorMm: number;
  minSkid: { wide: number; tall: number };
  cleat: { thick: number; wide: number };
}

/** Choose board sizes from payload mass, using the shop's stock and thresholds. */
export function resolveConstruction(
  settings: CrateSettings,
  payloadKg: number,
  standards: ShopStandards = DEFAULT_STANDARDS,
): ConstructionMaterials {
  const { stock, construction: rule } = standards;
  const ply = stock.panelPlywoodMm;
  const panelMm =
    settings.panelThickness !== "auto"
      ? settings.panelThickness
      : payloadKg <= rule.panelLightMaxKg
        ? ply.light
        : payloadKg <= rule.panelMediumMaxKg
          ? ply.medium
          : ply.heavy;
  const minSkid = payloadKg <= rule.heavySkidOverKg ? stock.skidMm.standard : stock.skidMm.heavy;
  return { panelMm, floorMm: stock.floorPlywoodMm, minSkid: { ...minSkid }, cleat: { ...stock.cleatMm } };
}

/** The materials `planStructure` sizes from: skid stock from the smallest allowed skid up, by strength. */
export function structureMaterials(c: ConstructionMaterials, standards: ShopStandards = DEFAULT_STANDARDS): StructureMaterials {
  const modulus = (k: LaidSection) => k.wide * k.tall * k.tall;
  const { standard, heavy } = standards.stock.skidMm;
  const skids = [standard, heavy]
    .filter((k) => modulus(k) >= modulus(c.minSkid))
    .sort((a, b) => modulus(a) - modulus(b) || a.wide * a.tall - b.wide * b.tall);
  return { panelMm: c.panelMm, floorMm: c.floorMm, cleat: c.cleat, skids: skids.map((k) => ({ wide: k.wide, tall: k.tall })) };
}

/** What the structure adds to the interior on each axis: fed to the packer, per layout. */
export function structureAllowance(c: Pick<Construction, "panelMm" | "cleat">, plan: Pick<StructurePlan, "baseMm" | "lid">): Vec3 {
  const wall = 2 * (c.panelMm + c.cleat.thick);
  return [wall, wall, plan.baseMm + c.panelMm + plan.lid.member.tall];
}

/** The construction a finished structure plan settles on, on top of the materials picked for the payload. */
export function constructionFor(materials: ConstructionMaterials, structure: StructurePlan): Construction {
  const { base, lid } = structure;
  return {
    panelMm: materials.panelMm,
    floorMm: materials.floorMm,
    skid: base.skid,
    cleat: materials.cleat,
    skidCount: base.skidCount,
    joist: base.joist ? { ...base.joist, count: base.joistCount } : null,
    lid: { ...lid.member, count: lid.count, joists: lid.joists },
    baseMm: structure.baseMm,
  };
}
