"use client";

import { useState } from "react";
import type { CrateDesign } from "@/domain/crate";
import type { CrateSettings } from "@/domain/schema";
import { length, lengthUnit, weight } from "@/lib/units";
import { useDesigner } from "@/state/store";
import { ShopStandards } from "./ShopStandards";

const MAX_QTY = 200;
const GAP_MAX_MM = 150;
const PANELS: CrateSettings["panelThickness"][] = ["auto", 12, 15, 19];

/** Packing rules, including quantity — the main input. The crate updates as you go. */
export function RulesTab({ design }: { design: CrateDesign }) {
  const settings = useDesigner((s) => s.settings);
  const suggested = useDesigner((s) => s.part.suggested_quantities);
  const split = useDesigner((s) => s.plan.split);
  const units = useDesigner((s) => s.units);
  const standards = useDesigner((s) => s.standards);
  const minGap = standards.construction.minBlockingGapMm;
  const floorMm = design.construction.floorMm;
  const { setSettings, resetRules } = useDesigner.getState();
  const setQty = (q: number) => setSettings({ quantity: Math.max(1, Math.min(MAX_QTY, Math.round(q) || 1)) });
  const mm = (v: number) => `${length(v, units)} ${lengthUnit(units)}`;

  return (
    <>
      <h2>Packing rules</h2>
      <p className="lede">Change these when a part needs different handling. The crate updates as you go.</p>

      <div className="rule">
        <b>How many parts</b>
        <div className="seg qty">
          <button type="button" className="step" aria-label="One fewer" onClick={() => setQty(settings.quantity - 1)}>
            −
          </button>
          <QuantityInput value={settings.quantity} onCommit={setQty} />
          <button type="button" className="step" aria-label="One more" onClick={() => setQty(settings.quantity + 1)}>
            +
          </button>
          <span className="sep" />
          {suggested.map((n) => (
            <button key={n} type="button" className="seg-chip" aria-pressed={settings.quantity === n} onClick={() => setQty(n)}>
              {n}
            </button>
          ))}
        </div>
        <small>{split ? "Too much for one crate: the Overview shows how the batch ships." : "One crate holds the whole batch."}</small>
      </div>

      <div className="rule">
        <b>Keep parts upright</b>
        <input
          type="checkbox"
          className="switch"
          aria-label="Keep parts upright"
          checked={settings.keepUpright}
          onChange={(e) => setSettings({ keepUpright: e.target.checked })}
        />
        <small>Turn off to let parts lie on their side or stand on end.</small>
      </div>

      <div className="rule">
        <b>Most layers allowed</b>
        <div className="seg" role="group" aria-label="Most layers allowed">
          {[1, 2, 3, 4].map((n) => (
            <button key={n} type="button" aria-pressed={settings.maxLayers === n} onClick={() => setSettings({ maxLayers: n })}>
              {n}
            </button>
          ))}
        </div>
        <small>A plywood separator goes between layers.</small>
      </div>

      <div className="rule">
        <b>Gap between parts</b>
        <output>{mm(settings.partGapMm)}</output>
        <input
          type="range"
          min={0}
          max={GAP_MAX_MM}
          step={5}
          aria-label="Gap between parts"
          value={settings.partGapMm}
          onChange={(e) => setSettings({ partGapMm: Number(e.target.value) })}
        />
        <small>Filled with wood blocking. Under {mm(minGap)} leaves no room for it.</small>
      </div>

      <div className="rule">
        <b>Clearance to walls</b>
        <output>{mm(settings.wallClearanceMm)}</output>
        <input
          type="range"
          min={0}
          max={GAP_MAX_MM}
          step={5}
          aria-label="Clearance to walls"
          value={settings.wallClearanceMm}
          onChange={(e) => setSettings({ wallClearanceMm: Number(e.target.value) })}
        />
        <small>Bearers go underneath, blocking at the sides.</small>
      </div>

      <div className="rule">
        <b>Wall and lid plywood</b>
        <div className="seg" role="group" aria-label="Wall and lid plywood">
          {PANELS.map((p) => (
            <button key={p} type="button" aria-pressed={settings.panelThickness === p} onClick={() => setSettings({ panelThickness: p })}>
              {p === "auto" ? "Auto" : p}
            </button>
          ))}
        </div>
        <small>
          {settings.panelThickness === "auto"
            ? `Auto picked ${design.construction.panelMm} mm for ${weight(design.payloadKg, units)} of parts. The floor is always ${floorMm} mm.`
            : `Thickness in mm. The floor is always ${floorMm} mm.`}
        </small>
      </div>

      <div className="actions" style={{ marginTop: 16 }}>
        <button type="button" className="btn" onClick={resetRules}>
          Reset rules
        </button>
      </div>

      <ShopStandards />
    </>
  );
}

/** Typed quantity: updates live on valid input, and snaps back to the real value on blur. */
function QuantityInput({ value, onCommit }: { value: number; onCommit: (q: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      min={1}
      max={MAX_QTY}
      inputMode="numeric"
      aria-label="Quantity"
      value={draft ?? value}
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value !== "") onCommit(Number(e.target.value));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
