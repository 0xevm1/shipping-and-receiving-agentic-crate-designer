"use client";

import { useRef, useState } from "react";
import { DEFAULT_STANDARDS, mergeStandards, parseStandards, sameStandards, standardsFromJson, standardsToJson, type ShopStandards } from "@/domain/standards";
import { downloadText } from "@/lib/download";
import { nominalLumber } from "@/domain/lumber";
import { plywoodText } from "@/lib/lumber";
import { editUnit, groupDigits, type Units } from "@/lib/units";
import { useDesigner } from "@/state/store";
import { useView } from "@/state/viewStore";
import { STANDARD_GROUPS, readStandard, standardPatch, type Field } from "./standardsFields";
import rule from "./rule.module.css";
import styles from "./ShopStandards.module.css";

/** " mm", "%", "×" or nothing, after a number. */
const withUnit = (unit: string) => (!unit || unit === "%" || unit === "×" ? unit : ` ${unit}`);

/** Rounds away floating-point noise from scaling (0.03 × 100). */
const tidy = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * The shop's house rules, editable. Collapsed by default: most days nobody changes them. The
 * roughly ninety inputs are only rendered while it is open. Changes apply to the crate at once
 * and are saved in this browser.
 */
export function ShopStandards() {
  const standards = useDesigner((s) => s.standards);
  const units = useView((s) => s.units);
  const { resetStandards, setStandards } = useDesigner.getState();
  const customised = !sameStandards(standards, DEFAULT_STANDARDS);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const load = async (file: File) => {
    let text: string;
    try {
      text = await file.text();
    } catch {
      return setStatus(`Not loaded: ${file.name} could not be read.`);
    }
    const r = standardsFromJson(text);
    if (!r.ok) return setStatus(`Not loaded: ${r.error}`);
    const error = setStandards(r.standards);
    setStatus(error ? `Not loaded: ${error}` : `Loaded ${file.name}.`);
  };

  const download = () => {
    try {
      downloadText("shop-standards.json", standardsToJson(standards), "application/json");
      setStatus("Standards downloaded.");
    } catch {
      setStatus("Download is blocked here.");
    }
  };

  return (
    <details className={styles.root} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className={styles.summary}>
        <b>Shop standards</b>
        <span className={styles.sub}>· house rules for every crate</span>
        {customised && <span className={styles.badge}>Customised</span>}
      </summary>
      <p className={`lede ${styles.intro}`}>
        The stock, thresholds, limits, rates and shop times every crate is designed to and costed with. Changes apply at once and are saved in this browser.{" "}
        {units === "imperial" ? "Sizes are in inches, weights in lb and times in minutes." : "Sizes are in mm, weights in kg and times in minutes."}
      </p>

      {open &&
        STANDARD_GROUPS.map((g) => (
          <section key={g.title} aria-label={g.title}>
            <h3 className={styles.group}>{g.title}</h3>
            {g.fields.map((f) => (
              <StandardInput key={`${f.path.join(".")}-${units}`} field={f} standards={standards} units={units} onChange={setStandards} />
            ))}
          </section>
        ))}

      <div className={`actions ${styles.actions}`}>
        <button type="button" className="btn" onClick={resetStandards} disabled={!customised}>
          Reset to defaults
        </button>
        <button type="button" className="btn" onClick={download}>
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
        {/* Always in the DOM: a live region has to exist before its text changes to be announced. */}
        <span className="status" role="status">
          {status}
        </span>
      </div>
    </details>
  );
}

/** A number field: applies as soon as the text is a valid standard; invalid text is outlined and reverts on blur. */
function StandardInput({
  field: f,
  standards,
  units,
  onChange,
}: {
  field: Field;
  standards: ShopStandards;
  units: Units;
  onChange: (patch: ReturnType<typeof standardPatch>) => string | null;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scale = f.scale ?? 1;
  // The stored standard is metric; the unit conversion happens only here, at the edge.
  const conv = editUnit(f.dim, units);
  const unit = conv.unit ?? f.unit;
  const stored = readStandard(standards, f.path);
  const value = tidy(conv.show(stored) * scale);
  const fallback = tidy(conv.show(readStandard(DEFAULT_STANDARDS, f.path)) * scale);
  const changed = stored !== readStandard(DEFAULT_STANDARDS, f.path);
  const hint = typeof f.hint === "function" ? f.hint(units) : f.hint;
  const name = units === "imperial" ? shopName(f, standards) : undefined;
  const id = `std-${f.path.join("-")}`;

  const commit = (text: string) => {
    setDraft(text);
    const blank = text.trim() === "";
    const n = blank && f.zero ? 0 : Number(text);
    if ((blank && !f.zero) || !Number.isFinite(n)) return setError("Enter a number.");
    const patch = standardPatch(f.path, blank ? 0 : conv.store(n / scale));
    // The domain splits a failure into the field and its message; this field shows the message.
    const check = parseStandards(mergeStandards(standards, patch));
    if (!check.ok) return setError(check.message ?? check.error);
    setError(onChange(patch));
  };

  return (
    <div className={changed ? `${rule.rule} ${rule.compact} ${styles.changed}` : `${rule.rule} ${rule.compact}`}>
      <b>
        <label htmlFor={id}>{f.label}</label>
      </b>
      <span className={styles.field}>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step={f.step ?? conv.step}
          placeholder={f.zero}
          value={draft ?? (f.zero && value === 0 ? "" : value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => {
            setDraft(null);
            setError(null);
          }}
        />
        <span className={styles.unit}>{unit}</span>
      </span>
      {error ? (
        <small id={`${id}-error`} className={rule.error} role="alert">
          {error}
        </small>
      ) : (
        (hint || name || changed) && <small>{[hint, name, changed && `Default ${groupDigits(fallback)}${withUnit(unit)}.`].filter(Boolean).join(" ")}</small>
      )}
    </div>
  );
}

/** What the shop calls this stock in imperial ("1x4", "3/4″ plywood"), or nothing when it has no name. */
function shopName(f: Field, standards: ShopStandards): string | undefined {
  const mm = readStandard(standards, f.path);
  if (f.dim === "plywood") return `Sold as ${plywoodText(mm)} plywood.`;
  if (f.dim === "lumber" && f.pair) {
    const nominal = nominalLumber(mm, readStandard(standards, f.pair));
    return nominal ? `The section is ${nominal}.` : undefined;
  }
  return undefined;
}
