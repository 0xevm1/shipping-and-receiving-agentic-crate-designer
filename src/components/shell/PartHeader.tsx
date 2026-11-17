"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { cleanPartDetails, MATERIAL_SUGGESTIONS, PART_MATERIAL_MAX, PART_NAME_MAX } from "@/domain/partDetails";
import { modelNote } from "@/lib/format";
import { fieldWidthCh, formatMass, massUnit, parseMass, stepMass } from "@/lib/partFields";
import { canSetFrame } from "@/lib/part";
import { UNITS_LABEL, UP_LABEL, type ModelUnits, type UpAxis } from "@/lib/partFrame";
import { MODEL_UNITS, UP_AXES } from "@/domain/designFile";
import { dims, lengthUnit, partWeight, weight, weightNumber } from "@/lib/units";
import { modelMatchesCatalog } from "@/lib/checks";
import type { ChangeSource } from "@/state/designEvents";
import { useDesigner } from "@/state/store";
import { useView } from "@/state/viewStore";
import { ChangeNote, Flash } from "./ChangeFeedback";
import { ExportPill } from "./ExportPill";
import { LoadToast } from "./LoadToast";
import styles from "./PartHeader.module.css";

/** Edits from the header's own fields; their change note shows under the header. */
const PART_SOURCES: readonly ChangeSource[] = ["name", "material", "mass", "frame"];

/**
 * Top left: app name, then what is shipping, read as a sentence:
 *
 *     id · name
 *     material · mass each · crate gross
 *     measured size · model check
 *     [Export]  (one-click .zip; hidden with the header by Hide panels)
 *
 * For a part loaded without catalog data, name, material and mass are inline underlined
 * fields. Catalog parts show the same sentence as plain text.
 */
export function PartHeader() {
  const part = useDesigner((s) => s.part);
  const measured = useDesigner((s) => s.measured);
  const units = useView((s) => s.units);
  const match = modelMatchesCatalog(part, measured);
  // The file's units and axis are the user's to set on a file they loaded: always for an unknown one (even when its size
  // leaves no crate to draw, which is when a wrong guess most needs fixing), and for a catalog-named one that doesn't match.
  const showFrame = canSetFrame(part) && (!part.catalogDims || match === false);
  const size = measured ?? (showFrame ? part.dimensions_mm : null);

  return (
    <header className={styles.header} data-testid="part-header">
      <div className={styles.brandRow}>
        <h1 className={styles.brand}>Crate Designer</h1>
        <span className={`eyebrow-label ${styles.tagline}`}>Shipping and receiving</span>
      </div>
      <div className={styles.partMeta} data-testid="part-meta">
        {part.catalogDims ? (
          <>
            <div>
              <b>{part.id}</b> · {part.name}
            </div>
            <div>
              {part.material ?? "material not given"} · {partWeight(part.mass_kg, units)} each
              <Gross />
            </div>
          </>
        ) : (
          // Remount per loaded file so the fields start from that file's values.
          <PartDetailsFields key={part.modelUrl} />
        )}
        {size && (
          <div>
            {dims(size, units)} {lengthUnit(units)} · {showFrame && <FrameFields />}
            <span className={match === false ? styles.warn : ""}>{modelNote(match, part.unitsGuessed)}</span>
          </div>
        )}
        <ChangeNote sources={PART_SOURCES} variant="header" />
      </div>
      <ExportPill />
      <LoadToast />
    </header>
  );
}

/**
 * "file in [inches], [Y up] · ": what the loaded file's numbers are in and which axis points up
 * (spec §4). Choosing re-measures the part and re-plans the crate straight away.
 */
function FrameFields() {
  const units = useDesigner((s) => s.part.modelUnits);
  const up = useDesigner((s) => s.part.upAxis);
  const setPartFrame = useDesigner((s) => s.setPartFrame);
  return (
    <>
      file in{" "}
      <select className={styles.field} aria-label="File units" value={units} onChange={(e) => setPartFrame({ units: e.target.value as ModelUnits })}>
        {MODEL_UNITS.map((u) => (
          <option key={u} value={u}>
            {UNITS_LABEL[u]}
          </option>
        ))}
      </select>
      ,{" "}
      <select className={styles.field} aria-label="Up axis" value={up} onChange={(e) => setPartFrame({ up: e.target.value as UpAxis })}>
        {UP_AXES.map((a) => (
          <option key={a} value={a}>
            {UP_LABEL[a]}
          </option>
        ))}
      </select>{" "}
      ·{" "}
    </>
  );
}

/** " · crate gross 20 kg", flashing when an edit moves it; nothing while there is no design. */
function Gross() {
  const gross = useDesigner((s) => s.result.design?.grossKg);
  const units = useView((s) => s.units);
  const crates = useDesigner((s) => (s.plan.split ? s.plan.totals : null));
  if (gross === undefined) return null;
  // A split batch: the shipment, not one crate.
  if (crates) {
    return (
      <>
        {" "}
        · <span>{crates.crates} crates,</span> <span>{weight(crates.grossKg, units, true)} gross in all</span>
      </>
    );
  }
  return (
    <>
      {" "}
      {/* One unbreakable group; on phones "crate" is visually dropped (still read) so the line fits. */}·{" "}
      <span className="nw" data-testid="crate-gross">
        <span className={styles.crateWord}>crate </span>gross <Flash on={["gross"]}>{weight(gross, units, true)}</Flash>
      </span>
    </>
  );
}

type FieldId = "name" | "material" | "mass";
const errorId = (f: FieldId) => `partfield-${f}-error`;
const STAND_IN_ID = "partfield-standin";
const STAND_IN_HINT = "Stand-in: no mass came with the file, so 10 kg is used. Enter the real mass.";

/**
 * Name, material and mass for a part loaded without catalog data. Each field commits on
 * Enter or blur, reverts on Escape (and on blur when invalid), and shows why it is invalid in
 * one line under the header. Mass shows in the selected units and is stored in kg.
 */
function PartDetailsFields() {
  const part = useDesigner((s) => s.part);
  const units = useView((s) => s.units);
  const setPartDetails = useDesigner((s) => s.setPartDetails);
  const [errors, setErrors] = useState<Record<FieldId, string | null>>({ name: null, material: null, mass: null });
  const onError = (f: FieldId) => (e: string | null) => setErrors((all) => (all[f] === e ? all : { ...all, [f]: e }));
  const unit = massUnit(units);

  const massError = (t: string) => {
    const r = parseMass(t, units);
    return r.ok ? null : r.error;
  };
  const stepKeys = (e: KeyboardEvent<HTMLInputElement>, text: string) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return false;
    e.preventDefault();
    const typed = parseMass(text, units);
    const from = typed.ok ? typed.kg : part.mass_kg;
    setPartDetails({ mass_kg: stepMass(from, e.key === "ArrowUp" ? 1 : -1, e.shiftKey, units) });
    return true;
  };

  return (
    <>
      <div>
        <b>{part.id}</b> ·{" "}
        <InlineField
          field="name"
          label="Part name"
          value={part.name}
          placeholder="name the part"
          maxLength={PART_NAME_MAX}
          size={[6, 40]}
          error={errors.name}
          onError={onError("name")}
          validate={(t) => {
            const r = cleanPartDetails({ name: t });
            return r.ok ? null : r.error;
          }}
          commit={(t) => setPartDetails({ name: t })}
        />
      </div>
      <div>
        <InlineField
          field="material"
          label="Part material"
          value={part.material ?? ""}
          placeholder="add material"
          maxLength={PART_MATERIAL_MAX}
          size={[6, 30]}
          list="part-materials"
          error={errors.material}
          onError={onError("material")}
          validate={(t) => {
            const r = cleanPartDetails({ material: t });
            return r.ok ? null : r.error;
          }}
          commit={(t) => setPartDetails({ material: t })}
        />
        <datalist id="part-materials">
          {MATERIAL_SUGGESTIONS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>{" "}
        ·{" "}
        <InlineField
          field="mass"
          label={`Mass of one part in ${units === "imperial" ? "pounds" : "kilograms"}`}
          value={formatMass(part.mass_kg, units)}
          // Not being edited, it reads by the one mass rule like every other mass; while editing, the full value.
          display={weightNumber(part.mass_kg, units, false)}
          placeholder="enter mass"
          inputMode="decimal"
          size={[3, 10]}
          standIn={part.massAssumed}
          describedBy={part.massAssumed ? STAND_IN_ID : undefined}
          error={errors.mass}
          onError={onError("mass")}
          validate={massError}
          commit={(t) => {
            const r = parseMass(t, units);
            return r.ok ? setPartDetails({ mass_kg: r.kg }) : r.error;
          }}
          onKey={stepKeys}
        />{" "}
        {unit} each
        {part.massAssumed && " "}
        {part.massAssumed && (
          <span className={styles.standinTag} title={STAND_IN_HINT}>
            stand-in
          </span>
        )}
        <Gross />
      </div>
      {/* The mass field's description while it is a stand-in (hidden; read through aria-describedby). */}
      {part.massAssumed && (
        <span id={STAND_IN_ID} hidden>
          {STAND_IN_HINT}
        </span>
      )}
      {(["name", "material", "mass"] as const).map(
        (f) =>
          errors[f] && (
            <div key={f} id={errorId(f)} className={styles.error}>
              {errors[f]}
            </div>
          ),
      )}
    </>
  );
}

interface InlineFieldProps {
  field: FieldId;
  label: string;
  /** The stored value as text; what the field holds while it is being edited. */
  value: string;
  /** How the value reads when the field has no focus, if that differs (a rounded mass). */
  display?: string;
  placeholder: string;
  /** Width in `ch` for browsers without `field-sizing: content`: [min, max]. */
  size: [number, number];
  error: string | null;
  onError: (e: string | null) => void;
  /** Why the text is invalid, or null. Runs as you type; nothing is saved until commit. */
  validate: (text: string) => string | null;
  /** Saves the text; returns an error if it was rejected. */
  commit: (text: string) => string | null;
  /** Extra keys (mass ↑ / ↓). Returns true when it handled the key and the edit is done. */
  onKey?: (e: KeyboardEvent<HTMLInputElement>, text: string) => boolean;
  maxLength?: number;
  list?: string;
  inputMode?: "decimal";
  /** The value is a stand-in: dashed gold underline. */
  standIn?: boolean;
  describedBy?: string;
}

/**
 * An input styled as text with an underline (`.field`, PartHeader.module.css), sized to its content.
 * `draft` is the text being typed; null means "show the stored value".
 */
function InlineField(p: InlineFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Focus swaps a rounded display for the full value, which moves the caret: select it all, as a click into a field would expect.
  useLayoutEffect(() => {
    if (focused && p.display !== undefined && p.display !== p.value) input.current?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);
  const text = draft ?? (focused ? p.value : (p.display ?? p.value));

  const finish = () => {
    setDraft(null);
    p.onError(null);
  };
  /** Commits a changed draft. False (with the reason shown) when it is invalid. */
  const save = () => {
    if (draft === null || draft === p.value) {
      finish();
      return true;
    }
    const err = p.commit(draft);
    if (err) {
      p.onError(err);
      return false;
    }
    finish();
    return true;
  };

  const describedBy = [p.error ? errorId(p.field) : null, p.describedBy].filter(Boolean).join(" ") || undefined;
  const className = [styles.field, p.standIn && draft === null ? styles.standin : "", p.error ? styles.bad : ""].filter(Boolean).join(" ");

  return (
    <input
      ref={input}
      type="text"
      className={className}
      value={text}
      aria-label={p.label}
      aria-invalid={p.error ? true : undefined}
      aria-describedby={describedBy}
      maxLength={p.maxLength}
      placeholder={p.placeholder}
      list={p.list}
      inputMode={p.inputMode}
      spellCheck={false}
      autoComplete="off"
      // Per-field widths, as custom properties the `.field` rule reads (values computed from the text).
      style={{ "--pf-ch": fieldWidthCh(text, p.placeholder, p.size[0], p.size[1]), "--pf-min": p.size[0], "--pf-max": p.size[1] } as CSSProperties}
      onChange={(e) => {
        setDraft(e.target.value);
        p.onError(p.validate(e.target.value));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        } else if (e.key === "Escape") {
          finish();
        } else if (p.onKey?.(e, text)) {
          finish();
        }
      }}
      // Blur keeps a valid edit and drops an invalid one, back to the last valid value.
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (!save()) finish();
      }}
    />
  );
}
