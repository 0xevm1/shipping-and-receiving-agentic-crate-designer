"use client";

import { useState, type CSSProperties, type KeyboardEvent } from "react";
import { cleanPartDetails, MATERIAL_SUGGESTIONS, PART_MATERIAL_MAX, PART_NAME_MAX } from "@/domain/partDetails";
import { fieldWidthCh, formatMass, massUnit, parseMass, stepMass } from "@/lib/partFields";
import { dims, lengthUnit, partWeight, weight } from "@/lib/units";
import { modelMatchesCatalog } from "@/state/checks";
import { useDesigner, type ChangeSource } from "@/state/store";
import { ChangeNote, Flash } from "./ChangeFeedback";
import { ExportPill } from "./ExportPill";

/** Edits from the header's own fields; their change note shows under the header (#39). */
const PART_SOURCES: readonly ChangeSource[] = ["name", "material", "mass"];

/**
 * Top left: app name, then what is shipping, read as a sentence (#40):
 *
 *     id · name
 *     material · mass each · crate gross
 *     measured size · model check
 *     [Export]  (#51: one-click .zip; hidden with the header by Hide panels)
 *
 * For a part loaded without catalog data, name, material and mass are inline underlined
 * fields. Catalog parts show the same sentence as plain text.
 */
export function PartHeader() {
  const part = useDesigner((s) => s.part);
  const measured = useDesigner((s) => s.measured);
  const units = useDesigner((s) => s.units);
  const match = modelMatchesCatalog(part, measured);

  const modelNote =
    match === null ? (part.readAsMm ? "file read as millimetres" : "size measured from the file") : match ? "model matches catalog" : "model does not match catalog";

  return (
    <header className="tl">
      <div className="brandrow">
        <h1 className="brand">Crate Designer</h1>
        <span className="tagline">Shipping and receiving</span>
      </div>
      <div className="partmeta">
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
        {measured && (
          <div>
            {dims(measured, units)} {lengthUnit(units)} · <span className={match === false ? "warn" : ""}>{modelNote}</span>
          </div>
        )}
        <ChangeNote sources={PART_SOURCES} />
      </div>
      <ExportPill />
    </header>
  );
}

/** " · crate gross 20 kg", flashing when an edit moves it; nothing while there is no design. */
function Gross() {
  const gross = useDesigner((s) => s.result.design?.grossKg);
  const units = useDesigner((s) => s.units);
  const crates = useDesigner((s) => (s.plan.split ? s.plan.totals : null));
  if (gross === undefined) return null;
  // A split batch (#25): the shipment, not one crate.
  if (crates) {
    return (
      <>
        {" "}
        · <span>{crates.crates} crates,</span> <span>{weight(crates.grossKg, units)} gross in all</span>
      </>
    );
  }
  return (
    <>
      {" "}
      {/* One unbreakable group; on phones "crate" is visually dropped (still read) so the line fits (#62). */}
      ·{" "}
      <span className="nw">
        <span className="crate-word">crate </span>gross <Flash on={["gross"]}>{weight(gross, units)}</Flash>
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
  const units = useDesigner((s) => s.units);
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
          <span className="pf-tag" title={STAND_IN_HINT}>
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
            <div key={f} id={errorId(f)} className="pf-error">
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
  /** The stored value as text; shown whenever the field isn't being edited. */
  value: string;
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
 * An input styled as text with an underline (`.pf`, globals.css), sized to its content.
 * `draft` is the text being typed; null means "show the stored value".
 */
function InlineField(p: InlineFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? p.value;

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
  const className = ["pf", p.standIn && draft === null ? "standin" : "", p.error ? "bad" : ""].filter(Boolean).join(" ");

  return (
    <input
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
      onBlur={() => {
        if (!save()) finish();
      }}
    />
  );
}
