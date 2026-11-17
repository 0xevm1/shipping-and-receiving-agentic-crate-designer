"use client";

import { useState } from "react";
import { MATERIAL_SUGGESTIONS, PART_MATERIAL_MAX, PART_NAME_MAX } from "@/domain/partDetails";
import { dims, lengthUnit, partWeight } from "@/lib/units";
import { modelMatchesCatalog } from "@/state/checks";
import { useDesigner } from "@/state/store";

/** Top left: app name, then what is shipping — id, material, mass; measured size and model check. */
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
          <div>
            <b>{part.id}</b> · {part.material ?? "material not given"} · {partWeight(part.mass_kg, units)} each
          </div>
        ) : (
          // Remount per loaded file so the fields start from that file's values.
          <PartDetailsFields key={part.modelUrl} />
        )}
        {measured && (
          <div>
            {dims(measured, units)} {lengthUnit(units)} · <span className={match === false ? "warn" : ""}>{modelNote}</span>
          </div>
        )}
        {part.massAssumed && <div className="warn">No mass in the file. 10 kg is a stand-in, so enter the real one.</div>}
      </div>
    </header>
  );
}

/**
 * Name, material and mass for a part loaded without catalog data. Each field is
 * applied as soon as its text is valid; invalid text is outlined and reverts on blur.
 * Mass is always kg: the domain works in kg.
 */
function PartDetailsFields() {
  const part = useDesigner((s) => s.part);
  const setPartDetails = useDesigner((s) => s.setPartDetails);
  return (
    <>
      <div>
        <b>{part.id}</b> ·{" "}
        <DetailField
          className="text"
          value={part.name}
          maxLength={PART_NAME_MAX}
          label="Part name"
          apply={(t) => setPartDetails({ name: t })}
        />
      </div>
      <div>
        <DetailField
          className="text"
          value={part.material ?? ""}
          maxLength={PART_MATERIAL_MAX}
          placeholder="material"
          list="part-materials"
          label="Part material"
          apply={(t) => setPartDetails({ material: t })}
        />
        <datalist id="part-materials">
          {MATERIAL_SUGGESTIONS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>{" "}
        ·{" "}
        <DetailField
          type="number"
          value={String(part.mass_kg)}
          label="Mass of one part in kilograms"
          apply={(t) => setPartDetails({ mass_kg: t.trim() === "" ? NaN : Number(t) })}
        />{" "}
        kg each
      </div>
    </>
  );
}

interface DetailFieldProps {
  /** The value in the store; shown again on blur. */
  value: string;
  label: string;
  /** Applies the text; returns an error message if it was rejected. */
  apply: (text: string) => string | null;
  type?: "text" | "number";
  className?: string;
  maxLength?: number;
  placeholder?: string;
  list?: string;
}

function DetailField({ value, label, apply, type = "text", className, maxLength, placeholder, list }: DetailFieldProps) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  return (
    <input
      type={type}
      className={[className, error ? "bad" : ""].filter(Boolean).join(" ") || undefined}
      value={text}
      aria-label={label}
      aria-invalid={error ? true : undefined}
      title={error ?? undefined}
      maxLength={maxLength}
      placeholder={placeholder}
      list={list}
      spellCheck={false}
      autoComplete="off"
      {...(type === "number" ? { min: 0.01, step: 0.1 } : {})}
      onChange={(e) => {
        setText(e.target.value);
        setError(apply(e.target.value));
      }}
      onBlur={() => {
        // Show what was kept: the tidied text, or the last valid value.
        setText(value);
        setError(null);
      }}
    />
  );
}
