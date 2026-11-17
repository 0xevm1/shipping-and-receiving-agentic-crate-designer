import type { Check } from "./check";
import { handlingChecks } from "./handling";
import { nominalLumber } from "./lumber";
import { dimsMessage, joinMessages, kg, mm, msg, parts, shopMm, type Message } from "./message";
import type { CrateDesign } from "./crateDesign";
import type { Layout } from "./packing";
import type { Restraint } from "./profile";
import type { CrateSettings, DesignPart } from "./schema";
import type { ShopStandards } from "./standards";
import { MM_PER_FT } from "./units";

/** The rules a designed crate is held to (spec §7.7), each reported whether it passes or not. */

/** "4x6" for standard US lumber, otherwise the actual size in mm. */
function sectionName(a: number, b: number): Message {
  const name = nominalLumber(a, b);
  return name ? parts(name) : msg`${shopMm(a)} × ${shopMm(b)}`;
}

/**
 * The narrowest gap beside a part in the drawn crate, where blocking posts go: the
 * per-axis wall clearance (larger than the setting when a tiny crate was padded), and
 * the part gap only on an axis with more than one part.
 */
function smallestSideGap(layout: Layout, partGapMm: number): { mm: number; where: string } {
  const [nx, ny] = layout.counts;
  const [clearX, clearY] = layout.clearance;
  const gaps = [
    ...(nx > 1 || ny > 1 ? [{ mm: partGapMm, where: "between parts" }] : []),
    clearX === clearY ? { mm: clearX, where: "to the walls" } : { mm: clearX, where: "to the end walls" },
    ...(clearX === clearY ? [] : [{ mm: clearY, where: "to the side walls" }]),
  ];
  return gaps.reduce((a, b) => (b.mm < a.mm ? b : a));
}

/**
 * The shaped-blocking sentence for the `blocking` check (spec §7.5b): the restraint metric for
 * this crate against bounding-box blocking, or an empty message when blocking follows the bounding box.
 */
function shapedText(d: CrateDesign): Message {
  const s = d.shapedBlocking;
  if (!s) return [];
  const pct = (r: Restraint) => `${Math.round(r.contact * 100)}%`;
  // Infinite only if nothing on some side touches the part: say so rather than print "Infinity".
  const shift = (r: Restraint) => {
    const most = Math.max(...r.freeMm);
    return Number.isFinite(most) ? msg`${shopMm(most)}` : parts("unlimited");
  };
  const blocks = s.blocks ? ` with ${s.blocks} shaped block${s.blocks === 1 ? "" : "s"} in its recesses` : "";
  const touch = `${pct(s.shaped)} of the blocking face touches it (bounding box: ${pct(s.boundingBox)})`;
  return msg` They are shaped to the part${blocks}: ${touch}, and the most a part can shift is ${shift(s.shaped)} (bounding box: ${shift(s.boundingBox)}).`;
}

/**
 * The computed base rating (spec §7.15): "Base rated 1,240 kg; this crate's payload is 820 kg
 * (66%)", with the skids, joists and floor, and what governs.
 */
function baseRatingCheck(d: CrateDesign, standards: ShopStandards): Check<"base-rating"> {
  const c = d.construction;
  const { ratedPayloadKg: rated, base } = d.structure;
  const pct = rated > 0 ? `${Math.round((d.payloadKg / rated) * 100)}%` : "over";
  const head = msg`Base rated ${kg(Math.floor(rated))}; this crate's payload is ${kg(d.payloadKg)} (${pct}).`;
  const joists = c.joist ? msg`, ${c.joist.count} ${sectionName(c.joist.wide, c.joist.tall)} floor joists` : [];
  const built = msg`${c.skidCount} × ${sectionName(c.skid.wide, c.skid.tall)} skids${joists} and a ${shopMm(c.floorMm)} floor`;
  const governs = `${base.governing.label} governs`;
  if (base.ok && d.payloadKg <= rated) {
    const detail = msg`${head} ${built}, sized for ${standards.structure.loadFactor}× the load (${governs}).`;
    return { id: "base-rating", level: "ok", title: "Within the base rating", detail };
  }
  const detail = msg`${head} Even ${built} can't carry it (${governs}). Split the batch, or add heavier skid or joist stock.`;
  return { id: "base-rating", level: "caution", title: "Over the base rating", detail };
}

/** Only when crates may be stacked (`structure.lidStackKg` > 0): whether the lid carries it. */
function lidRatingCheck(d: CrateDesign): Check<"lid"> | null {
  const lid = d.structure.lid;
  if (lid.stackKg <= 0 || lid.capacityKg === null) return null;
  const c = d.construction.lid;
  const frame = msg`${c.count} ${sectionName(c.wide, c.tall)} ${c.joists ? "joists on edge" : "cross cleats"}`;
  const head = msg`Sized for ${kg(lid.stackKg)} stacked on top; rated ${kg(lid.capacityKg)}`;
  if (lid.ok) return { id: "lid", level: "ok", title: "Lid carries the stacking load", detail: msg`${head}, with ${frame}.` };
  const detail = msg`${head} even with ${frame}. Don't stack on this crate, or add heavier joist stock.`;
  return { id: "lid", level: "caution", title: "Lid can't take the stacking load", detail };
}

/** Every rule of thumb, reported whether it passes or not. Order is fixed; the UI sorts. */
export function evaluateChecks(d: CrateDesign, part: DesignPart, settings: CrateSettings, standards: ShopStandards): Check[] {
  const checks: Check[] = [];
  const lim = standards.limits;
  const minBlockingGap = standards.construction.minBlockingGapMm;
  const [eL, eW, eH] = d.layout.external;
  const nz = d.layout.counts[2];

  const van = lim.trailerMm;
  const tooBig = [
    eL > van.interiorLength && msg`Length is over the ${mm(van.interiorLength)} trailer floor.`,
    eW > van.doorWidth && msg`Width is over the ${mm(van.doorWidth)} door opening.`,
    eH > van.doorHeight && msg`Height is over the ${mm(van.doorHeight)} door opening.`,
  ].filter((m): m is Message => !!m);
  const door: Check<"door"> = tooBig.length
    ? {
        id: "door",
        level: "caution",
        title: "Too big for a 53' dry van",
        detail: msg`${joinMessages(tooBig, " ")} Confirm open-deck or oversize transport with the carrier.`,
      }
    : {
        id: "door",
        level: "ok",
        title: "Fits a 53' dry van",
        detail: msg`Within the ${mm(van.doorWidth)} × ${mm(van.doorHeight)} door and the ${mm(van.interiorLength)} floor.`,
      };
  checks.push(door);

  const ratio = eH / Math.min(eL, eW);
  checks.push(
    d.layout.stable
      ? {
          id: "stable",
          level: "ok",
          title: "Stable footprint",
          detail: msg`Height is ${ratio.toFixed(2)}× the short side. The limit is ${lim.stableHeightRatio}×.`,
        }
      : {
          id: "stable",
          level: "caution",
          title: "Tip-over risk",
          detail: msg`Height is ${ratio.toFixed(2)}× the short side, over the ${lim.stableHeightRatio}× limit. Strap it down or pick a lower layout.`,
        },
  );

  const posts = d.members.filter((m) => m.kind === "blocking" && m.variant !== "shaped-block").length;
  const cradles = d.members.filter((m) => m.kind === "cradle").length;
  const held = cradles
    ? msg`${cradles} notched cradles hold the parts across their length, and ${posts} end stops hold them along it.`
    : msg`${posts} blocking posts hold the parts on all four sides.${shapedText(d)}`;
  const tightest = smallestSideGap(d.layout, settings.partGapMm);
  const betweenParts = tightest.where === "between parts";
  const gapText = msg`${shopMm(tightest.mm)} ${betweenParts ? "gap" : "clearance"} ${tightest.where}`;
  checks.push(
    tightest.mm < minBlockingGap
      ? {
          id: "blocking",
          level: "caution",
          title: "Parts are not restrained",
          detail: msg`The ${gapText} is under the ${shopMm(minBlockingGap)} that blocking needs. Widen ${betweenParts ? "the gap between parts" : "the clearance to walls"}.`,
        }
      : {
          id: "blocking",
          level: "ok",
          title: "Every part is blocked in",
          detail: msg`${held} The smallest gap is ${shopMm(tightest.mm)}, ${tightest.where}.`,
        },
  );

  if (nz > 1) {
    const stackedKg = part.mass_kg * (nz - 1);
    checks.push(
      stackedKg > lim.stackKg
        ? {
            id: "stack",
            level: "caution",
            title: "Heavy stack on the bottom layer",
            detail: msg`Each bottom position carries ${kg(stackedKg)} from above. Consider fewer layers.`,
          }
        : {
            id: "stack",
            level: "ok",
            title: "Stack load is light",
            detail: msg`Each bottom position carries ${kg(stackedKg)} from above. The limit is ${kg(lim.stackKg)}.`,
          },
    );
  }

  checks.push(baseRatingCheck(d, standards));
  const lidCheck = lidRatingCheck(d);
  if (lidCheck) checks.push(lidCheck);

  checks.push(...handlingChecks(d.handling, standards));

  if (eL > lim.ltlExcessiveLengthMm) {
    const ft = Math.round((lim.ltlExcessiveLengthMm / MM_PER_FT) * 10) / 10;
    checks.push({
      id: "oversize",
      level: "info",
      title: "LTL length surcharge likely",
      detail: msg`Length is over ${mm(lim.ltlExcessiveLengthMm)} (${ft} ft). Most LTL carriers add an excessive-length charge.`,
    });
  }
  if (d.layout.utilization < lim.lowUtilization) {
    checks.push({
      id: "utilization",
      level: "info",
      title: "Mostly empty space",
      detail: parts("Parts are packed by their bounding box, so irregular shapes leave air. A nested layout could be smaller."),
    });
  }
  const [iL, iW, iH] = d.layout.interior;
  const box = lim.cardboard;
  if (part.mass_kg <= box.partKg && d.payloadKg <= box.payloadKg && iL + iW + iH <= box.boxDimSumMm) {
    const within = msg`parts up to ${kg(box.partKg)}, payload up to ${kg(box.payloadKg)}, ${mm(box.boxDimSumMm)} L + W + H`;
    checks.push({
      id: "cardboard",
      level: "info",
      title: "A cardboard box may be enough",
      detail: msg`${kg(d.payloadKg)} in a ${dimsMessage([iL, iW, iH])} space is within the shop's carton limits (${within}). The crate design is still here if you want one.`,
    });
  }
  return checks;
}
