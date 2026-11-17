import type { Check } from "./check";
import type { Ranking } from "./design";
import { ANY_FACES, AS_MODELLED_FACES, canonicalFaces, RESTING_FACES, type RestingFace } from "./orientations";
import type { CrateSettings, DesignPart, Vec3 } from "./schema";
import { planShipment, type ShipmentPlan } from "./shipment";
import { DEFAULT_STANDARDS, type ShopStandards } from "./standards";

/**
 * Which faces of a part it may rest on (spec §7.1) as the person sees it: the three presets, how
 * a face is named so it can be told from the others, and the one-click offer to lay the parts
 * down when the chosen design would tip. Pure, like the rest of the domain.
 */

/** "any" (every face), "modelled" (the model's own base only) or "choose" (any other set). */
export type RestingPreset = "any" | "modelled" | "choose";

const sameFaces = (a: readonly RestingFace[], b: readonly RestingFace[]) => a.length === b.length && a.every((f, i) => f === b[i]);

/** The preset a set of faces is, "choose" when it is neither of the other two. */
export function restingPreset(faces: readonly RestingFace[]): RestingPreset {
  const canonical = canonicalFaces(faces) ?? [];
  if (sameFaces(canonical, ANY_FACES)) return "any";
  if (sameFaces(canonical, AS_MODELLED_FACES)) return "modelled";
  return "choose";
}

/** The faces a preset allows; "choose" keeps the ones given (the person picks from there). */
export function presetFaces(preset: RestingPreset, current: readonly RestingFace[]): RestingFace[] {
  if (preset === "any") return [...ANY_FACES];
  if (preset === "modelled") return [...AS_MODELLED_FACES];
  return [...current];
}

/** `faces` with `face` allowed or not, in the canonical order. Never empty: the last face stays on. */
export function toggleFace(faces: readonly RestingFace[], face: RestingFace, allowed: boolean): RestingFace[] {
  const next = RESTING_FACES.filter((f) => (f === face ? allowed : faces.includes(f)));
  return next.length > 0 ? next : [...faces];
}

/** Where each face is on the part as modelled, for telling the two faces of one size apart. */
export const FACE_NAMES: Record<RestingFace, string> = {
  "-z": "Bottom",
  "+z": "Top",
  "-y": "Front",
  "+y": "Back",
  "-x": "Left",
  "+x": "Right",
};

/** The face's two sides in mm, longer first: the 360 × 220 face of a 360 × 220 × 90 part. */
export function faceSize(face: RestingFace, dims: Vec3): [number, number] {
  const [x, y, z] = dims;
  const sides = face.endsWith("x") ? [y, z] : face.endsWith("y") ? [x, z] : [x, y];
  return sides[0] >= sides[1] ? [sides[0], sides[1]] : [sides[1], sides[0]];
}

/** One short phrase for the rule, for the explanations and the layout text. */
export function describeFaces(faces: readonly RestingFace[]): string {
  const preset = restingPreset(faces);
  if (preset === "modelled") return "parts kept upright";
  if (preset === "any") return "parts may rest on any face";
  return `parts rest only on the ${faces.map((f) => FACE_NAMES[f].toLowerCase()).join(", ")} ${faces.length === 1 ? "face" : "faces"}`;
}

/** Ids of the two checks about tipping: tip-over risk (a tall crate) and top-heavy (the centre of gravity). */
const TIP_CHECKS: readonly Check["id"][] = ["stable", "cog-tip"];

const tips = (checks: readonly Check[]) => checks.some((c) => TIP_CHECKS.includes(c.id) && c.level === "caution");

/** A way of resting the parts on more faces that clears the tipping cautions. */
export interface LayDownOffer {
  /** The rule to take: the faces now allowed plus the new ones. */
  restingFaces: RestingFace[];
  /** Faces that become allowed. */
  added: RestingFace[];
  /** The crate this gives (the recommended layout, outside mm) and the way the part lies in it. */
  outsideMm: Vec3;
  orientationLabel: string;
  /** True when the parts lie on a side or stand on an end, rather than sit right way up or upside down. */
  lyingDown: boolean;
}

/**
 * The faces to add to the rule, one candidate at a time: both faces of each axis not yet covered
 * (a part rested on the opposite face has the same footprint, so a covered axis adds no layout),
 * then every uncovered axis at once.
 */
function candidates(allowed: readonly RestingFace[]): RestingFace[][] {
  const axes = ["z", "y", "x"].filter((a) => !allowed.some((f) => f.endsWith(a)));
  const faces = (as: string[]) => RESTING_FACES.filter((f) => as.some((a) => f.endsWith(a)));
  const each = axes.map((a) => faces([a]));
  return axes.length > 1 ? [...each, faces(axes)] : each;
}

/**
 * When the crate on screen (`crateIndex` of `plan`) has a tip-over or top-heavy caution and
 * allowing the part to rest on more faces gives a crate with neither, the way to do it: the
 * smallest widening of the rule that works, and the crate it gives. Null when nothing is
 * cautioned, when no widening helps, or when the rule already allows every face.
 *
 * The widened design is the one the app would show after taking the offer: settings changed,
 * layout pick cleared, ranked as now.
 */
export function layDownOffer(input: {
  part: DesignPart;
  settings: CrateSettings;
  standards?: ShopStandards;
  ranking?: Ranking;
  plan: ShipmentPlan;
  crateIndex: number;
}): LayDownOffer | null {
  const { part, settings, plan, crateIndex, standards = DEFAULT_STANDARDS, ranking = "volume" } = input;
  const shown = plan.crates[crateIndex]?.result.design;
  if (!shown || !tips(shown.checks)) return null;
  for (const added of candidates(settings.restingFaces)) {
    const restingFaces = RESTING_FACES.filter((f) => settings.restingFaces.includes(f) || added.includes(f));
    const wider = planShipment(part, { ...settings, restingFaces }, null, standards, ranking);
    const design = wider.crates[Math.min(crateIndex, wider.crates.length - 1)]?.result.design;
    if (design && !wider.problem && !tips(design.checks)) {
      return {
        restingFaces,
        added,
        outsideMm: [...design.layout.external],
        orientationLabel: design.layout.orientation.label,
        lyingDown: !design.layout.orientation.upright,
      };
    }
  }
  return null;
}
