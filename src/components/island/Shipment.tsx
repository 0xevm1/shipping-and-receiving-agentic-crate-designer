"use client";

import { describeShipment } from "@/domain/shipment";
import { volume, weight } from "@/lib/units";
import { useDesigner } from "@/state/store";
import "./shipment.css";

/**
 * Which crate type of a split batch is on screen (#25). The 3D view, Layouts, Cut list and
 * Checks all follow it. Renders nothing for a single crate.
 */
export function CrateTypePicker() {
  const plan = useDesigner((s) => s.plan);
  const crateIndex = useDesigner((s) => s.crateIndex);
  const setCrateIndex = useDesigner((s) => s.setCrateIndex);
  if (!plan.split || plan.crates.length < 2) return null;
  return (
    <div className="seg ship-seg" role="group" aria-label="Crate type on screen">
      {plan.crates.map((c, i) => (
        <button key={c.label} type="button" aria-pressed={i === crateIndex} onClick={() => setCrateIndex(i)}>
          Crate {c.label}
          <small>
            {c.count} × {c.quantity} {c.quantity === 1 ? "part" : "parts"}
          </small>
        </button>
      ))}
    </div>
  );
}

/** "Ships as 3 × crate A (64 each) + 1 × crate B (8)", with the shipment's gross and volume. */
export function ShipmentSummary() {
  const plan = useDesigner((s) => s.plan);
  const units = useDesigner((s) => s.units);
  if (!plan.split) return null;
  const { totals } = plan;
  return (
    <section className="ship" aria-label="Shipment">
      <div className="ship-eyebrow">Shipment · {totals.crates} crates</div>
      <p className="ship-plan">
        Ships as <b>{describeShipment(plan)}</b>
      </p>
      <div className="line">
        {totals.parts} parts at <span className="mono">{volume(totals.volumeM3, units)}</span>, gross{" "}
        <span className="mono">{weight(totals.grossKg, units)}</span> in all
      </div>
      {plan.unmet ? (
        <p className="ship-note warn">{plan.unmet}</p>
      ) : (
        <p className="ship-note">One crate would be over the per-crate limits in Shop standards, so the batch is split.</p>
      )}
      <CrateTypePicker />
    </section>
  );
}
