"use client";

import { useDesigner } from "@/state/store";
import styles from "./CrateTypePicker.module.css";

/**
 * Which crate type of a split batch is on screen. The 3D view, Layouts, Cut list and
 * Checks all follow it. Renders nothing for a single crate. `flush` drops the space below it,
 * for the end of a block.
 */
export function CrateTypePicker({ flush }: { flush?: boolean }) {
  const plan = useDesigner((s) => s.plan);
  const crateIndex = useDesigner((s) => s.crateIndex);
  const setCrateIndex = useDesigner((s) => s.setCrateIndex);
  if (!plan.split || plan.crates.length < 2) return null;
  return (
    <div className={`seg ${styles.picker}${flush ? ` ${styles.flush}` : ""}`} role="group" aria-label="Crate type on screen">
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

/** The Cut list's choice between one crate type's list and the whole shipment's. */
export function CutScopeToggle({ whole, onChange }: { whole: boolean; onChange: (scope: "crate" | "shipment") => void }) {
  return (
    <div className={`seg ${styles.picker} ${styles.scope}`} role="group" aria-label="Cut list for">
      <button type="button" aria-pressed={!whole} onClick={() => onChange("crate")}>
        This crate
      </button>
      <button type="button" aria-pressed={whole} onClick={() => onChange("shipment")}>
        Whole shipment
      </button>
    </div>
  );
}
