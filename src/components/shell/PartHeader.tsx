"use client";

import { useState } from "react";
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
        <div>
          <b>{part.id}</b> · {part.material ?? "material not given"} ·{" "}
          {part.catalogDims ? `${partWeight(part.mass_kg, units)} each` : <MassInput key={part.id} />}
        </div>
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

/** Editable mass for a part loaded without catalog data. Always kg; the domain works in kg. */
function MassInput() {
  const mass = useDesigner((s) => s.part.mass_kg);
  const setPartMass = useDesigner((s) => s.setPartMass);
  const [text, setText] = useState(String(mass));
  return (
    <>
      <input
        type="number"
        min={0.01}
        step={0.1}
        value={text}
        aria-label="Mass of one part in kilograms"
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (v > 0) setPartMass(v);
        }}
      />{" "}
      kg each
    </>
  );
}
