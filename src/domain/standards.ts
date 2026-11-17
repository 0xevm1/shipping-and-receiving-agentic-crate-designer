import { z } from "zod";
import { CrateSettingsSchema } from "./schema";

/**
 * Shop standards: the house rules every crate is designed to (#19).
 *
 * These used to be constants scattered through `crate.ts` and `packing.ts`. They are
 * one validated object now, so a PM can see and change them, and every design is
 * built from the same rules. `DEFAULT_STANDARDS` holds the values the app shipped
 * with; with them, every design is exactly what it was before.
 *
 * Units are fixed and in the field names' comments: mm, kg, kg/m³, USD/m³, minutes, USD/h, in³/lb.
 * Values that are geometry rather than house rules (the 0.5 mm smallest board, bearer
 * positions at 20% and 80%, at least two skids and two uprights) stay in the code.
 */

const mm = (min: number, max: number) => z.number().finite().min(min).max(max);
const kg = (min: number, max: number) => z.number().finite().min(min).max(max);
const minutes = (min: number, max: number) => z.number().finite().min(min).max(max);

/** A lumber section, actual size in mm (e.g. a 1×4 is 19 × 89). */
const SectionSchema = z.object({
  thick: mm(6, 300),
  wide: mm(19, 400),
});

/**
 * A lifting device that enters between the skids from the ends (#8): two tines (forks) of
 * `tineWidthMm`, whose outside-to-outside spread can be anywhere in `spreadMm`, needing
 * `minClearMm` of height under the floor.
 */
const LiftDeviceSchema = z.object({
  minClearMm: mm(20, 400),
  tineWidthMm: mm(25, 400),
  spreadMm: z.object({ min: mm(50, 3000), max: mm(50, 3000) }),
});

const SkidSchema = z.object({
  wide: mm(38, 400),
  tall: mm(38, 400),
});

export const ShopStandardsSchema = z
  .object({
    /** What the shop keeps on hand. */
    stock: z.object({
      /** Cleat lumber for the wall and lid frames. Its width also sets the smallest interior (two cleats). */
      cleatMm: SectionSchema,
      /** Skid lumber: `standard` for most loads, `heavy` above `construction.heavySkidOverKg`. */
      skidMm: z.object({ standard: SkidSchema, heavy: SkidSchema }),
      /** Floor plywood, always this thickness. */
      floorPlywoodMm: mm(6, 50),
      /** Wall, lid and separator plywood that Auto picks from, by payload. */
      panelPlywoodMm: z.object({ light: mm(6, 50), medium: mm(6, 50), heavy: mm(6, 50) }),
      /** Width of blocking posts and bearers. */
      blockWidthMm: mm(19, 300),
    }),
    /** What a new crate starts with, and what Reset rules goes back to. */
    defaults: z.object({
      partGapMm: CrateSettingsSchema.shape.partGapMm,
      wallClearanceMm: CrateSettingsSchema.shape.wallClearanceMm,
      maxLayers: CrateSettingsSchema.shape.maxLayers,
      /** Layout volumes within this fraction count as equal, so the lower crate wins. */
      volumeTolerance: z.number().finite().min(0).max(0.5),
    }),
    /** When to use which stock. */
    construction: z.object({
      /** Auto panel: payload up to this → `light` plywood. */
      panelLightMaxKg: kg(0, 100000),
      /** Auto panel: payload up to this → `medium` plywood; above it, `heavy`. */
      panelMediumMaxKg: kg(0, 100000),
      /** Payload above this gets `heavy` skids. */
      heavySkidOverKg: kg(0, 100000),
      /** At most this much crate width per skid gap: skids = max(2, ceil(width / spacing) + 1). */
      skidSpacingMm: mm(200, 5000),
      /** Wall uprights and lid cross cleats at most this far apart. */
      maxCleatSpacingMm: mm(100, 5000),
      /** Gaps narrower than this get no blocking post. */
      minBlockingGapMm: mm(1, 300),
    }),
    /** Limits the checks test against. */
    limits: z.object({
      /** 53' dry van: interior and rear door opening. */
      trailerMm: z.object({
        interiorLength: mm(1000, 30000),
        interiorWidth: mm(500, 5000),
        interiorHeight: mm(500, 5000),
        doorWidth: mm(500, 5000),
        doorHeight: mm(500, 5000),
      }),
      /** LTL excessive-length surcharge above this crate length. */
      ltlExcessiveLengthMm: mm(500, 30000),
      /** When to suggest a carton instead of a crate. */
      cardboard: z.object({ partKg: kg(0, 1000), payloadKg: kg(0, 1000), boxDimSumMm: mm(0, 10000) }),
      /** Most mass from upper layers on each bottom position. */
      stackKg: kg(0, 100000),
      /** Most gross weight the standard base is good for. */
      baseRatingKg: kg(1, 100000),
      /** Crate height at most this × the short side counts as stable. */
      stableHeightRatio: z.number().finite().min(0.5).max(10),
      /** Below this share of the interior filled, say it is mostly air. */
      lowUtilization: z.number().finite().min(0).max(1),
      /**
       * Per-crate limits for splitting a batch across crates (#25). A crate must also fit the
       * trailer door and floor (`trailerMm`), so there is no separate size limit.
       */
      perCrate: z.object({
        /** Most gross weight one crate may have; a heavier batch is split. */
        maxGrossKg: kg(1, 100000),
        /** Most parts in one crate; 0 means no limit. */
        maxParts: z.number().int().min(0).max(200),
      }),
    }),
    /** Material properties, prices and fastening. */
    rates: z.object({
      densityKgM3: z.object({ plywood: kg(100, 2000), lumber: kg(100, 2000) }),
      costUsdPerM3: z.object({ plywood: z.number().finite().min(0).max(100000), lumber: z.number().finite().min(0).max(100000) }),
      /** One screw every this many mm along each board. */
      screwSpacingMm: z.object({ cleat: mm(25, 2000), skid: mm(25, 2000), panelJoint: mm(25, 2000) }),
      /** Wood screws, USD per 100 (#17). Part of the material cost. */
      screwCostUsdPer100: z.number().finite().min(0).max(1000),
    }),
    /**
     * Shop labour (#17, spec §7.12): the hourly rate and the minutes each step of building a
     * crate takes. Build time = cuts + set-ups + screws + assembly steps + handling.
     */
    labour: z.object({
      /** Loaded shop labour rate, USD per hour. */
      rateUsdPerHour: z.number().finite().min(0).max(1000),
      /** Minutes per lumber piece cut to length (measure, mark, cut). */
      lumberCutMin: minutes(0, 60),
      /** Minutes per plywood piece cut from a sheet (rip and cross-cut). */
      plywoodCutMin: minutes(0, 60),
      /** Minutes per distinct cut size: setting a stop or fence. */
      setupMin: minutes(0, 60),
      /** Minutes per wood screw driven. */
      screwMin: minutes(0, 10),
      /** Minutes per assembly step: base, each wall, lid, and the dunnage for each layer. */
      assemblyStepMin: minutes(0, 240),
      /** Minutes per crate for moving, marking and staging it. */
      handlingMin: minutes(0, 480),
    }),
    /** Freight terms for domestic LTL (#17, spec §7.12). */
    freight: z.object({
      /** Dimensional-weight divisor, cubic inches per lb (139 is the common domestic divisor). */
      dimDivisorIn3PerLb: z.number().finite().min(50).max(500),
    }),
    /** Centre of gravity and handling (#8, spec §7.14). */
    handling: z.object({
      /** Forklift tines, entering between the skids from the ends. */
      forklift: LiftDeviceSchema,
      /** Pallet-jack forks; the spread range covers narrow and standard jacks. */
      palletJack: LiftDeviceSchema,
      /** CoG further from the footprint centre than this share of the length (or width) is off-centre. */
      cogOffsetRatio: z.number().finite().min(0.01).max(0.5),
      /** Static tip angle (CoG to the nearest base edge) below this, in degrees, is top-heavy. */
      minTipAngleDeg: z.number().finite().min(1).max(80),
    }),
  })
  .superRefine((s, ctx) => {
    const p = s.stock.panelPlywoodMm;
    if (!(p.light <= p.medium && p.medium <= p.heavy)) {
      ctx.addIssue({ code: "custom", path: ["stock", "panelPlywoodMm"], message: "Panel plywood must go light ≤ medium ≤ heavy" });
    }
    if (s.construction.panelLightMaxKg > s.construction.panelMediumMaxKg) {
      ctx.addIssue({
        code: "custom",
        path: ["construction", "panelLightMaxKg"],
        message: "The light-panel limit can't be above the medium-panel limit",
      });
    }
    if (s.stock.blockWidthMm > minInteriorMm(s)) {
      // A bearer wider than the smallest interior would poke through the side walls.
      ctx.addIssue({ code: "custom", path: ["stock", "blockWidthMm"], message: "Blocking can't be wider than two cleats" });
    }
    for (const key of ["forklift", "palletJack"] as const) {
      const d = s.handling[key];
      if (d.spreadMm.min > d.spreadMm.max) {
        ctx.addIssue({ code: "custom", path: ["handling", key, "spreadMm"], message: "The smallest spread can't be above the largest" });
      }
      if (d.spreadMm.min < 2 * d.tineWidthMm) {
        ctx.addIssue({ code: "custom", path: ["handling", key, "spreadMm"], message: "The spread can't be less than two tines wide" });
      }
    }
    const t = s.limits.trailerMm;
    if (t.doorWidth > t.interiorWidth || t.doorHeight > t.interiorHeight) {
      ctx.addIssue({ code: "custom", path: ["limits", "trailerMm"], message: "The door can't be bigger than the trailer inside" });
    }
  });

export type ShopStandards = z.infer<typeof ShopStandardsSchema>;

/** The values the app ships with. Designs made with these match the pre-#19 designs exactly. */
export const DEFAULT_STANDARDS: ShopStandards = deepFreeze({
  stock: {
    cleatMm: { thick: 19, wide: 89 }, // 1×4
    skidMm: { standard: { wide: 89, tall: 89 }, heavy: { wide: 89, tall: 140 } }, // 4×4, 4×6
    floorPlywoodMm: 19,
    panelPlywoodMm: { light: 12, medium: 15, heavy: 19 },
    blockWidthMm: 89, // cut from 2×4 / 4×4
  },
  defaults: { partGapMm: 50, wallClearanceMm: 50, maxLayers: 2, volumeTolerance: 0.03 },
  construction: {
    panelLightMaxKg: 150,
    panelMediumMaxKg: 500,
    heavySkidOverKg: 700,
    skidSpacingMm: 800,
    maxCleatSpacingMm: 600,
    minBlockingGapMm: 19,
  },
  limits: {
    /**
     * Shipping is domestic only (US truckload or LTL), so the crate must go through the rear
     * door of a standard 53' × 102" dry van. Typical published dimensions (trailer makers' spec
     * sheets and carrier equipment guides; values vary a few inches by make and wall type):
     * interior about 52'6" × 101" × 110", door about 98–100" × 108–110". The low end of the
     * door range is used, since the door, not the interior, limits width and height.
     */
    trailerMm: {
      interiorLength: 16000, // 52'6" usable floor
      interiorWidth: 2565, // 101 in
      interiorHeight: 2794, // 110 in
      doorWidth: 2489, // 98 in
      doorHeight: 2743, // 108 in
    },
    /** Many LTL carriers' rules tariffs add an excessive-length charge over 8 ft (96 in). */
    ltlExcessiveLengthMm: 2438,
    /**
     * A carton is suggested when each part is ≤ 15 kg, the payload ≤ 25 kg (room for the box
     * under the 65 lb gross limit of a 32 ECT single-wall box, NMFC Item 222 / UFC Rule 41) and
     * the interior L + W + H ≤ 1905 mm (75 in, the same rule's size limit).
     */
    cardboard: { partKg: 15, payloadKg: 25, boxDimSumMm: 1905 },
    stackKg: 100,
    baseRatingKg: 1000,
    stableHeightRatio: 1.5,
    lowUtilization: 0.25,
    /** The standard base's 1,000 kg rating; no part-count limit. No sample part splits at its suggested quantities. */
    perCrate: { maxGrossKg: 1000, maxParts: 0 },
  },
  rates: {
    densityKgM3: { plywood: 600, lumber: 480 },
    /** Placeholder rates for a rough cost comparison between designs. */
    costUsdPerM3: { plywood: 1100, lumber: 650 },
    screwSpacingMm: { cleat: 150, skid: 300, panelJoint: 200 },
    /** Placeholder: a bulk box of #8 × 2 1/2" exterior wood screws, about $8 per 100. */
    screwCostUsdPer100: 8,
  },
  /**
   * Placeholder shop times and rate (#17), for comparing designs, not quoting. A shop should
   * time a few crates and enter its own. Worked example in spec §7.12.
   */
  labour: {
    rateUsdPerHour: 35,
    lumberCutMin: 0.75,
    plywoodCutMin: 3,
    setupMin: 2,
    screwMin: 0.15,
    assemblyStepMin: 6,
    handlingMin: 15,
  },
  /**
   * 139 in³/lb is the dimensional-weight divisor most US carriers publish for domestic
   * shipments (parcel daily rates and many LTL tariffs that apply dim weight).
   */
  freight: { dimDivisorIn3PerLb: 139 },
  /**
   * Handling (#8, spec §7.14). Typical published equipment sizes; a shop should enter its own.
   * - Forklift: Class II carriage tines are about 4″ (100 mm) wide and 1.5–2″ thick; 75 mm (3″)
   *   clear under the floor leaves room for a tine that is not quite level. The tines slide on
   *   the carriage, from about 10″ (250 mm) to 43″ (1100 mm) outside to outside.
   * - Pallet jack: forks are about 7″ (180 mm) wide and 2.9–3.2″ (75–82 mm) high when lowered,
   *   so 85 mm clear. The outside spread is fixed per jack: 20.5″ (520 mm) narrow to 27″
   *   (690 mm) standard; either will do.
   * - Off-centre: mark the centre of gravity (the ISO 7000-0627 / MIL-STD-129 centre-of-balance
   *   mark) once it is more than 10% of the length or width from the middle.
   * - Top-heavy: under 30° static tip angle the crate tips at less than 0.58 g sideways, close
   *   to the 0.5 g lateral that US cargo securement (49 CFR 393.102) designs for.
   */
  handling: {
    forklift: { minClearMm: 75, tineWidthMm: 100, spreadMm: { min: 250, max: 1100 } },
    palletJack: { minClearMm: 85, tineWidthMm: 180, spreadMm: { min: 520, max: 690 } },
    cogOffsetRatio: 0.1,
    minTipAngleDeg: 30,
  },
});

/** Smallest interior on any axis: room for the top and bottom rails of a wall without overlap. */
export function minInteriorMm(s: ShopStandards): number {
  return 2 * s.stock.cleatMm.wide;
}

/** Recursive partial, for patches from the UI or an imported file. */
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Merges `patch` onto `base` (objects recursively, everything else replaced). Doesn't validate. */
export function mergeStandards(base: ShopStandards, patch: DeepPartial<ShopStandards>): unknown {
  return merge(base, patch);
}

function merge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? base : patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    out[k] = merge(base[k], v);
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export type StandardsResult = { ok: true; standards: ShopStandards } | { ok: false; error: string };

/** Validates standards, returning the first problem in plain words. */
export function parseStandards(input: unknown): StandardsResult {
  const r = ShopStandardsSchema.safeParse(input);
  if (r.success) return { ok: true, standards: r.data };
  const issue = r.error.issues[0];
  return { ok: false, error: `${issue.path.join(".") || "Standards"}: ${issue.message}` };
}

/** File and storage format version. Bump it when a field changes meaning. */
export const STANDARDS_VERSION = 1;

/** Standards as a downloadable JSON document. */
export function standardsToJson(s: ShopStandards): string {
  return JSON.stringify({ kind: "crate-designer/shop-standards", version: STANDARDS_VERSION, standards: s }, null, 2) + "\n";
}

/**
 * Reads standards from a downloaded file (or storage). Accepts the `standardsToJson`
 * envelope or a bare standards object; a partial object is filled in from the defaults.
 */
export function standardsFromJson(text: string): StandardsResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "The file isn't valid JSON." };
  }
  if (isPlainObject(data) && "standards" in data) {
    if (data.version !== undefined && data.version !== STANDARDS_VERSION) {
      return { ok: false, error: `Standards version ${String(data.version)} isn't supported (expected ${STANDARDS_VERSION}).` };
    }
    data = data.standards;
  }
  if (!isPlainObject(data)) return { ok: false, error: "The file doesn't hold shop standards." };
  return parseStandards(mergeStandards(DEFAULT_STANDARDS, data as DeepPartial<ShopStandards>));
}

/** True when two standards objects hold the same values. */
export function sameStandards(a: ShopStandards, b: ShopStandards): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(v: unknown): unknown {
  if (!isPlainObject(v)) return v;
  return Object.fromEntries(
    Object.keys(v)
      .sort()
      .map((k) => [k, sortKeys(v[k])]),
  );
}

function deepFreeze<T>(v: T): T {
  if (isPlainObject(v)) {
    Object.values(v).forEach(deepFreeze);
    Object.freeze(v);
  }
  return v;
}
