"use client";

import { describeShipment } from "@/domain/shipment";
import { hoursText, usd } from "@/lib/format";
import { renderMessage } from "@/lib/message";
import { volume, weight, weightFromLb } from "@/lib/units";
import { useDesigner } from "@/state/store";
import { CrateTypePicker } from "./CrateTypePicker";
import styles from "./Shipment.module.css";

/** "Ships as 3 × crate A (64 each) + 1 × crate B (8)", with the shipment's gross and volume. */
export function ShipmentSummary() {
  const plan = useDesigner((s) => s.plan);
  const units = useDesigner((s) => s.units);
  if (!plan.split) return null;
  const { totals } = plan;
  return (
    <section className={styles.ship} aria-label="Shipment">
      <div className={`eyebrow-label ${styles.eyebrow}`}>Shipment · {totals.crates} crates</div>
      <p className={styles.plan}>
        Ships as <b>{describeShipment(plan)}</b>
      </p>
      <div className="line">
        {totals.parts} parts at <span className="mono">{volume(totals.volumeM3, units)}</span>, gross{" "}
        <span className="mono">{weight(totals.grossKg, units)}</span> in all
      </div>
      <div className="line">
        <span className="mono">{usd(totals.costUsd)}</span> to build, <span className="mono tight">{hoursText(totals.labourHours)}</span> of labour,{" "}
        <span className="mono">{weightFromLb(totals.dimWeightLb, units)}</span> dim weight
      </div>
      {plan.unmet ? (
        <p className={`${styles.note} ${styles.warn}`}>{renderMessage(plan.unmet, units)}</p>
      ) : (
        <p className={styles.note}>One crate would be over the per-crate limits in Shop standards, so the batch is split.</p>
      )}
      <CrateTypePicker flush />
    </section>
  );
}
