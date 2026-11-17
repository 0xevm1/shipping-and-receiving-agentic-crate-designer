import { computeDesign, DEFAULT_SETTINGS, type DesignPart } from "./design";
import type { CrateDesign } from "./crate";
import type { Message } from "./message";
import { ANY_FACES, AS_MODELLED_FACES, type RestingFace } from "./orientations";
import type { CrateSettings } from "./schema";
import { DEFAULT_STANDARDS, mergeStandards, parseStandards, type DeepPartial, type ShopStandards } from "./standards";

/** Shared builders for the domain's unit tests. Not imported by the app. */

/** The standards with a patch applied; throws if the result is not valid. */
export function custom(patch: DeepPartial<ShopStandards>, base: ShopStandards = DEFAULT_STANDARDS): ShopStandards {
  const r = parseStandards(mergeStandards(base, patch));
  if (!r.ok) throw new Error(r.error);
  return r.standards;
}

/** The default settings with a patch applied. */
export const settings = (patch: Partial<CrateSettings> = {}): CrateSettings => ({ ...DEFAULT_SETTINGS, ...patch });

/** The recommended crate for `part` under the patched settings and standards. */
export function designOf(part: DesignPart, patch: Partial<CrateSettings> = {}, standards: ShopStandards = DEFAULT_STANDARDS): CrateDesign {
  return computeDesign(part, settings(patch), null, standards).design!;
}

/** The `app` field of a design file written by a test. */
export const TEST_APP = { name: "crate-designer", version: "0.0.0-test" } as const;

/**
 * A check message as the metric UI reads it ("2,489 mm", "1,240 kg"): what the domain tests pin.
 * The domain cannot import the renderer in `lib/message.ts`, so this spells out the metric rule.
 */
export function metricText(m: Message): string {
  return m
    .map((p) => {
      if (typeof p === "string") return p;
      if (p.kind === "length") return `${Math.round(p.mm).toLocaleString("en-US")} mm`;
      const tenth = Math.round(p.kg * 10) / 10;
      return `${Math.abs(tenth) < 100 ? tenth : Math.round(p.kg).toLocaleString("en-US")} kg`;
    })
    .join("");
}

/**
 * A wall-clock budget that follows machine load (#48). A fixed CPU loop takes about 3.5 ms on an
 * idle laptop; when the machine is busy it takes proportionally longer, and so does the code
 * under test. The budget is `ms` or `ratio` loop-times, whichever is larger, so it is never
 * tighter than `ms` and a 10x regression still fails when the machine is idle.
 */
export function loadAwareBudget(ms: number, ratio: number): number {
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    let x = 0;
    for (let n = 0; n < 3e6; n++) x += Math.sqrt(n);
    if (x < 0) throw new Error("unreachable: keeps the loop from being optimised away");
    times.push(performance.now() - t0);
  }
  return Math.max(ms, ratio * times.sort((a, b) => a - b)[2]);
}

/** The faces a part may rest on for the old "Keep parts upright" switch: on is the model's own base, off is any face. */
export const facesFor = (keepUpright: boolean): readonly RestingFace[] => (keepUpright ? AS_MODELLED_FACES : ANY_FACES);
