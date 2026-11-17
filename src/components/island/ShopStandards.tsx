"use client";

import { useRef, useState } from "react";
import { downloadText } from "@/domain/export";
import {
  DEFAULT_STANDARDS,
  sameStandards,
  standardsFromJson,
  standardsToJson,
  type DeepPartial,
  type ShopStandards,
} from "@/domain/standards";
import { useDesigner } from "@/state/store";
import styles from "./ShopStandards.module.css";

/** One editable standard: where it lives in `ShopStandards`, and how to show it. */
interface Field {
  path: string[];
  label: string;
  unit: string;
  /** Shown value = stored value × scale (fractions shown as %). */
  scale?: number;
  step?: number;
  hint?: string;
}

interface Group {
  title: string;
  fields: Field[];
}

/** Every standard, grouped as in spec §6.4. Units are fixed: the shop works in mm and kg. */
const GROUPS: Group[] = [
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
      { path: ["construction", "heavySkidOverKg"], label: "Heavy skids over", unit: "kg" },
      { path: ["construction", "skidSpacingMm"], label: "Skid spacing", unit: "mm" },
      { path: ["construction", "maxCleatSpacingMm"], label: "Cleat spacing", unit: "mm" },
      { path: ["construction", "minBlockingGapMm"], label: "Smallest gap for blocking", unit: "mm" },
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
      { path: ["limits", "baseRatingKg"], label: "Base rating", unit: "kg" },
      {
        path: ["limits", "perCrate", "maxGrossKg"],
        label: "Max gross per crate",
        unit: "kg",
        hint: "A heavier batch is split across crates. Each crate also has to fit the trailer door and floor above.",
      },
      { path: ["limits", "perCrate", "maxParts"], label: "Max parts per crate", unit: "", step: 1, hint: "0 means no limit." },
      { path: ["limits", "stableHeightRatio"], label: "Stable height ratio", unit: "×", step: 0.1 },
      { path: ["limits", "lowUtilization"], label: "Mostly empty below", unit: "%", scale: 100 },
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
];

function read(s: ShopStandards, path: string[]): number {
  return path.reduce<unknown>((v, k) => (v as Record<string, unknown>)[k], s) as number;
}

function patchAt(path: string[], value: number): DeepPartial<ShopStandards> {
  return path.reduceRight<unknown>((v, k) => ({ [k]: v }), value) as DeepPartial<ShopStandards>;
}

/** " mm", "%", "×" or nothing, after a number. */
const withUnit = (unit: string) => (!unit || unit === "%" || unit === "×" ? unit : ` ${unit}`);

/** Rounds away floating-point noise from scaling (0.03 × 100). */
const tidy = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * The shop's house rules, editable (#19). Collapsed by default: most days nobody changes
 * them. Changes apply to the crate at once and are saved in this browser.
 */
export function ShopStandards() {
  const standards = useDesigner((s) => s.standards);
  const { resetStandards, setStandards } = useDesigner.getState();
  const customised = !sameStandards(standards, DEFAULT_STANDARDS);
  const [status, setStatus] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const load = async (file: File) => {
    const r = standardsFromJson(await file.text());
    if (!r.ok) return setStatus(`Not loaded: ${r.error}`);
    const error = setStandards(r.standards);
    setStatus(error ? `Not loaded: ${error}` : `Loaded ${file.name}.`);
  };

  return (
    <details className={styles.root}>
      <summary className={styles.summary}>
        <b>Shop standards</b>
        <span className={styles.sub}>· house rules for every crate</span>
        {customised && <span className={styles.badge}>Customised</span>}
      </summary>
      <p className="lede">
        The stock, thresholds, limits, rates and shop times every crate is designed to and costed with. Changes apply at once and are saved in this
        browser. Sizes are in mm, weights in kg and times in minutes.
      </p>

      {GROUPS.map((g) => (
        <section key={g.title} aria-label={g.title}>
          <h3 className={styles.group}>{g.title}</h3>
          {g.fields.map((f) => (
            <StandardInput key={f.path.join(".")} field={f} standards={standards} onChange={setStandards} />
          ))}
        </section>
      ))}

      <div className={`actions ${styles.actions}`}>
        <button type="button" className="btn" onClick={resetStandards} disabled={!customised}>
          Reset to defaults
        </button>
        <button type="button" className="btn" onClick={() => downloadText("shop-standards.json", standardsToJson(standards), "application/json")}>
          Download standards
        </button>
        <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
          Load standards
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="Standards file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void load(file);
            e.target.value = "";
          }}
        />
        {status && (
          <span className="status" role="status">
            {status}
          </span>
        )}
      </div>
    </details>
  );
}

/** A number field: applies as soon as the text is a valid standard; invalid text is outlined and reverts on blur. */
function StandardInput({
  field: f,
  standards,
  onChange,
}: {
  field: Field;
  standards: ShopStandards;
  onChange: (patch: DeepPartial<ShopStandards>) => string | null;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scale = f.scale ?? 1;
  const value = tidy(read(standards, f.path) * scale);
  const fallback = tidy(read(DEFAULT_STANDARDS, f.path) * scale);
  const changed = value !== fallback;
  const id = `std-${f.path.join("-")}`;

  const commit = (text: string) => {
    setDraft(text);
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n)) return setError("Enter a number.");
    setError(onChange(patchAt(f.path, n / scale)));
  };

  return (
    <div className={changed ? `rule ${styles.changed}` : "rule"}>
      <b>
        <label htmlFor={id}>{f.label}</label>
      </b>
      <span className={styles.field}>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step={f.step ?? "any"}
          value={draft ?? value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => {
            setDraft(null);
            setError(null);
          }}
        />
        <span className={styles.unit}>{f.unit}</span>
      </span>
      {error ? (
        <small id={`${id}-error`} className={styles.error}>
          {error.replace(/^[\w.]+: /, "")}
        </small>
      ) : (
        (f.hint || changed) && (
          <small>
            {f.hint}
            {f.hint && changed && " "}
            {changed && `Default ${fallback}${withUnit(f.unit)}.`}
          </small>
        )
      )}
    </div>
  );
}
