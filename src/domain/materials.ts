import { sortDesc, type Assembly, type Member } from "./members";
import type { ShopStandards } from "./standards";
import { MM2_PER_M2, MM3_PER_M3, MM_PER_M } from "./units";

/** A board's volume in m³. */
function memberVolumeM3(m: Pick<Member, "size">): number {
  return (m.size[0] * m.size[1] * m.size[2]) / MM3_PER_M3;
}

/** A board's mass: its volume × the standard wood density (the tare model of spec §7.6). */
export function memberKg(m: Pick<Member, "size" | "material">, standards: ShopStandards): number {
  return memberVolumeM3(m) * standards.rates.densityKgM3[m.material];
}

interface MaterialTotals {
  /** Wood volume by material, m³. */
  volumeM3: { plywood: number; lumber: number };
  /** Empty-crate weight, kg. */
  tareKg: number;
  /** `tareKg` split by sub-assembly. */
  tareKgByAssembly: Record<Assembly, number>;
  /** Plywood area, counting each sheet once by its two largest sides, m². */
  plywoodM2: number;
  /** Lumber length, counting each board once by its longest side, m. */
  lumberM: number;
}

/** What the finished boards add up to: volumes, weight, plywood area and lumber length. */
export function materialTotals(members: readonly Member[], standards: ShopStandards): MaterialTotals {
  const density = standards.rates.densityKgM3;
  const volumeM3 = { plywood: 0, lumber: 0 };
  const tareKgByAssembly: Record<Assembly, number> = { base: 0, sides: 0, ends: 0, lid: 0, inside: 0 };
  let plywoodM2 = 0;
  let lumberM = 0;
  for (const m of members) {
    volumeM3[m.material] += memberVolumeM3(m);
    tareKgByAssembly[m.assembly] += memberKg(m, standards);
    const [longest, middle] = sortDesc(m.size);
    if (m.material === "plywood") plywoodM2 += (longest * middle) / MM2_PER_M2;
    else lumberM += longest / MM_PER_M;
  }
  const tareKg = volumeM3.plywood * density.plywood + volumeM3.lumber * density.lumber;
  return { volumeM3, tareKg, tareKgByAssembly, plywoodM2, lumberM };
}
