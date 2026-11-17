import type { DeepPartial, ShopStandards } from "@/domain/standards";

/** Every key path in `T` that ends at a number: the standards a person can edit. */
type NumberPaths<T> = T extends number ? [] : T extends object ? { [K in keyof T & string]: [K, ...NumberPaths<T[K]>] }[keyof T & string] : never;

/** Where a numeric standard lives in `ShopStandards`; a typo here is a compile error. */
export type StandardPath = NumberPaths<ShopStandards>;

/** One editable standard: where it lives, and how to show it. */
export interface Field {
  path: StandardPath;
  label: string;
  unit: string;
  /** Shown value = stored value × scale (fractions shown as %). */
  scale?: number;
  step?: number;
  hint?: string;
}

export interface Group {
  title: string;
  fields: Field[];
}

/** Every standard, grouped as in spec §6.4. Units are fixed: the shop works in mm and kg. */
export const STANDARD_GROUPS: Group[] = [
  {
    title: "Stock on hand",
    fields: [
      { path: ["stock", "cleatMm", "thick"], label: "Cleat thickness", unit: "mm" },
      { path: ["stock", "cleatMm", "wide"], label: "Cleat width", unit: "mm", hint: "The smallest crate inside is two cleats wide." },
      { path: ["stock", "skidMm", "standard", "wide"], label: "Skid width", unit: "mm" },
      { path: ["stock", "skidMm", "standard", "tall"], label: "Skid height", unit: "mm" },
      { path: ["stock", "skidMm", "heavy", "wide"], label: "Heavy skid width", unit: "mm" },
      { path: ["stock", "skidMm", "heavy", "tall"], label: "Heavy skid height", unit: "mm" },
      { path: ["stock", "floorPlywoodMm"], label: "Floor plywood", unit: "mm" },
      { path: ["stock", "panelPlywoodMm", "light"], label: "Light panel plywood", unit: "mm" },
      { path: ["stock", "panelPlywoodMm", "medium"], label: "Medium panel plywood", unit: "mm" },
      {
        path: ["stock", "panelPlywoodMm", "heavy"],
        label: "Heavy panel plywood",
        unit: "mm",
        hint: "Auto picks from these three. Packing rules can still force 12, 15 or 19 mm by hand.",
      },
      { path: ["stock", "blockWidthMm"], label: "Blocking width", unit: "mm" },
      {
        path: ["stock", "joistMm", "thick"],
        label: "Floor joist thickness",
        unit: "mm",
        hint: "Set on edge across the skids. Also the lid joists for stacking.",
      },
      { path: ["stock", "joistMm", "wide"], label: "Floor joist depth", unit: "mm" },
    ],
  },
  {
    title: "Defaults",
    fields: [
      { path: ["defaults", "partGapMm"], label: "New crate part gap", unit: "mm", hint: "New crates and Reset rules start from these." },
      { path: ["defaults", "wallClearanceMm"], label: "New crate wall clearance", unit: "mm" },
      { path: ["defaults", "maxLayers"], label: "New crate layers", unit: "", step: 1 },
      {
        path: ["defaults", "volumeTolerance"],
        label: "Layout volume tie",
        unit: "%",
        scale: 100,
        hint: "Layouts this close in volume count as equal, and the lower crate wins.",
      },
    ],
  },
  {
    title: "Construction",
    fields: [
      { path: ["construction", "panelLightMaxKg"], label: "Light panels up to", unit: "kg", hint: "Payload, for Auto plywood." },
      { path: ["construction", "panelMediumMaxKg"], label: "Medium panels up to", unit: "kg" },
      { path: ["construction", "heavySkidOverKg"], label: "Heavy skids over", unit: "kg", hint: "At least; structural sizing may pick them sooner." },
      { path: ["construction", "skidSpacingMm"], label: "Skid spacing", unit: "mm", hint: "At most; structural sizing may add skids." },
      { path: ["construction", "maxCleatSpacingMm"], label: "Cleat spacing", unit: "mm" },
      { path: ["construction", "minBlockingGapMm"], label: "Smallest gap for blocking", unit: "mm" },
    ],
  },
  {
    title: "Cradles",
    fields: [
      {
        path: ["cradle", "slenderRatio"],
        label: "Slender at length ÷ width",
        unit: "×",
        step: 0.1,
        hint: "A part whose longest side is at least this many times its middle side sits in notched cradles.",
      },
      { path: ["cradle", "maxSpacingMm"], label: "Cradle spacing", unit: "mm" },
      { path: ["cradle", "endOffsetMm"], label: "End cradles in from the ends", unit: "mm" },
      { path: ["cradle", "notchDepth"], label: "Notch depth", unit: "%", scale: 100, hint: "Of the part's height." },
      { path: ["cradle", "roundTolerance"], label: "Round within", unit: "%", scale: 100, hint: "Sections this close to square get a round seat." },
      { path: ["cradle", "thickMm"], label: "Cradle thickness", unit: "mm" },
    ],
  },
  {
    title: "Limits",
    fields: [
      { path: ["limits", "trailerMm", "interiorLength"], label: "Trailer floor length", unit: "mm" },
      { path: ["limits", "trailerMm", "interiorWidth"], label: "Trailer inside width", unit: "mm" },
      { path: ["limits", "trailerMm", "interiorHeight"], label: "Trailer inside height", unit: "mm" },
      { path: ["limits", "trailerMm", "doorWidth"], label: "Trailer door width", unit: "mm" },
      { path: ["limits", "trailerMm", "doorHeight"], label: "Trailer door height", unit: "mm" },
      { path: ["limits", "ltlExcessiveLengthMm"], label: "LTL surcharge over", unit: "mm" },
      { path: ["limits", "cardboard", "partKg"], label: "Carton: each part up to", unit: "kg" },
      { path: ["limits", "cardboard", "payloadKg"], label: "Carton: all parts up to", unit: "kg" },
      { path: ["limits", "cardboard", "boxDimSumMm"], label: "Carton: L + W + H up to", unit: "mm" },
      { path: ["limits", "stackKg"], label: "Stack load per part", unit: "kg" },
      {
        path: ["limits", "perCrate", "maxGrossKg"],
        label: "Max gross per crate",
        unit: "kg",
        hint: "A heavier batch is split across crates. Each crate also has to be within its computed base rating and fit the trailer door and floor above.",
      },
      { path: ["limits", "perCrate", "maxParts"], label: "Max parts per crate", unit: "", step: 1, hint: "0 means no limit." },
      { path: ["limits", "stableHeightRatio"], label: "Stable height ratio", unit: "×", step: 0.1 },
      { path: ["limits", "lowUtilization"], label: "Mostly empty below", unit: "%", scale: 100 },
    ],
  },
  {
    title: "Structure",
    fields: [
      {
        path: ["structure", "lumberBendingMPa"],
        label: "Lumber bending stress",
        unit: "MPa",
        step: 0.1,
        hint: "Allowable values. Defaults are SPF No. 2 (Fb 875, Fv 135, Fc⊥ 425 psi).",
      },
      { path: ["structure", "lumberShearMPa"], label: "Lumber shear stress", unit: "MPa", step: 0.01 },
      { path: ["structure", "lumberBearingMPa"], label: "Lumber bearing stress", unit: "MPa", step: 0.01 },
      { path: ["structure", "plywoodBendingMPa"], label: "Plywood bending stress", unit: "MPa", step: 0.1 },
      { path: ["structure", "loadFactor"], label: "Load factor", unit: "×", step: 0.1, hint: "Design load = this × (payload + crate weight)." },
      { path: ["structure", "supportLengthMm"], label: "Skid support length", unit: "mm", hint: "Skid resting on each end support." },
      { path: ["structure", "minForkOpeningMm"], label: "Min fork opening", unit: "mm", hint: "Skids are never added closer than this clear gap." },
      {
        path: ["structure", "joistOverKg"],
        label: "Floor joists over",
        unit: "kg",
        hint: "Payload. A floor that fails over the skids gets joists too.",
      },
      { path: ["structure", "maxJoistSpacingMm"], label: "Joist spacing", unit: "mm" },
      {
        path: ["structure", "lidStackKg"],
        label: "Stacked on the lid",
        unit: "kg",
        hint: "0 means crates aren't stacked, and the lid is the nominal frame.",
      },
    ],
  },
  {
    title: "Rates",
    fields: [
      { path: ["rates", "densityKgM3", "plywood"], label: "Plywood density", unit: "kg/m³" },
      { path: ["rates", "densityKgM3", "lumber"], label: "Lumber density", unit: "kg/m³" },
      { path: ["rates", "costUsdPerM3", "plywood"], label: "Plywood cost", unit: "$/m³" },
      { path: ["rates", "costUsdPerM3", "lumber"], label: "Lumber cost", unit: "$/m³" },
      { path: ["rates", "screwSpacingMm", "cleat"], label: "Screws along cleats every", unit: "mm" },
      { path: ["rates", "screwSpacingMm", "skid"], label: "Screws along skids every", unit: "mm" },
      { path: ["rates", "screwSpacingMm", "panelJoint"], label: "Screws along panel joints every", unit: "mm" },
      { path: ["rates", "screwCostUsdPer100"], label: "Screw cost", unit: "$/100", hint: "Part of the crate's material cost." },
    ],
  },
  {
    title: "Labour",
    fields: [
      {
        path: ["labour", "rateUsdPerHour"],
        label: "Labour rate",
        unit: "$/h",
        hint: "Build time × this rate is the labour in the crate cost.",
      },
      { path: ["labour", "lumberCutMin"], label: "Per lumber cut", unit: "min" },
      { path: ["labour", "plywoodCutMin"], label: "Per plywood cut", unit: "min" },
      { path: ["labour", "setupMin"], label: "Per cut size (set-up)", unit: "min", hint: "Setting a stop or fence for each distinct size." },
      { path: ["labour", "screwMin"], label: "Per screw", unit: "min" },
      {
        path: ["labour", "assemblyStepMin"],
        label: "Per assembly step",
        unit: "min",
        hint: "Base, four walls, lid, and the dunnage for each layer.",
      },
      { path: ["labour", "handlingMin"], label: "Handling per crate", unit: "min", hint: "Moving, marking and staging the finished crate." },
    ],
  },
  {
    title: "Freight",
    fields: [
      {
        path: ["freight", "dimDivisorIn3PerLb"],
        label: "Dim weight divisor",
        unit: "in³/lb",
        hint: "Outside L × W × H in inches ÷ this is the dimensional weight.",
      },
    ],
  },
  {
    title: "Handling",
    fields: [
      {
        path: ["handling", "forklift", "minClearMm"],
        label: "Forklift: clear under the floor",
        unit: "mm",
        hint: "Forks enter between the skids from the ends.",
      },
      { path: ["handling", "forklift", "tineWidthMm"], label: "Forklift: tine width", unit: "mm" },
      {
        path: ["handling", "forklift", "spreadMm", "min"],
        label: "Forklift: narrowest spread",
        unit: "mm",
        hint: "Outside to outside of the two tines.",
      },
      { path: ["handling", "forklift", "spreadMm", "max"], label: "Forklift: widest spread", unit: "mm" },
      { path: ["handling", "palletJack", "minClearMm"], label: "Pallet jack: clear under the floor", unit: "mm" },
      { path: ["handling", "palletJack", "tineWidthMm"], label: "Pallet jack: fork width", unit: "mm" },
      {
        path: ["handling", "palletJack", "spreadMm", "min"],
        label: "Pallet jack: narrowest spread",
        unit: "mm",
        hint: "A narrow jack. Each jack's spread is fixed; any in this range will do.",
      },
      { path: ["handling", "palletJack", "spreadMm", "max"], label: "Pallet jack: widest spread", unit: "mm" },
      {
        path: ["handling", "cogOffsetRatio"],
        label: "Off-centre CoG over",
        unit: "%",
        scale: 100,
        hint: "Of the length or width, from the middle. Mark the centre of gravity past it.",
      },
      {
        path: ["handling", "minTipAngleDeg"],
        label: "Top-heavy below tip angle",
        unit: "°",
        hint: "Tilt at which the centre of gravity passes the nearest skid edge.",
      },
    ],
  },
];

/** The number at `path`. The path type guarantees every step exists and the last is a number. */
export function readStandard(s: ShopStandards, path: StandardPath): number {
  let v: unknown = s;
  for (const k of path) v = (v as Record<string, unknown>)[k];
  return v as number;
}

/** A patch that sets only the number at `path`. */
export function standardPatch(path: StandardPath, value: number): DeepPartial<ShopStandards> {
  return path.reduceRight<unknown>((v, k) => ({ [k]: v }), value) as DeepPartial<ShopStandards>;
}
