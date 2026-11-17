"use client";

import { describeShipment } from "@/domain/shipment";
import { renderMessage } from "@/lib/message";
import { useDesigner } from "@/state/store";
import { useView } from "@/state/viewStore";
import type { PlanView } from "@/state/totalPlan";
import { CrateTypePicker } from "./CrateTypePicker";
import styles from "./Shipment.module.css";

/**
 * The Overview's shipment when the shared job has a total quantity (spec §7.10, §7.16): the same
 * `planTotal` split the shared job section shows, so the page never shows two different splits.
 * The crate on screen is one crate; when it is itself over a per-crate limit, its own split
 * (`planShipment`) is named as what is on screen, not as the shipment.
 */
export function TotalShipmentSummary({ plan }: { plan: PlanView }) {
  const units = useView((s) => s.units);
  const screen = useDesigner((s) => s.plan);
  const crates = plan.crates.reduce((n, c) => n + c.count, 0);
  return (
    <section className={styles.ship} aria-label="Shipment" data-testid="total-shipment">
      <div className={`eyebrow-label ${styles.eyebrow}`}>
        Shipment · {plan.total} parts{crates ? ` · ${crates} ${crates === 1 ? "crate" : "crates"}` : ""}
      </div>
      <p className={styles.plan}>
        {crates ? (
          <>
            Ships as <b>{describeShipment(plan)}</b>
          </>
        ) : (
          <b>No plan passes every check</b>
        )}
      </p>
      {plan.scoreUsdPerPart !== null && <div className="line">{`$${plan.scoreUsdPerPart.toFixed(2)} per part in crate cost`}</div>}
      <p className={styles.note}>{renderMessage(plan.rationale, units)}</p>
      <p className={styles.note}>
        From the job&apos;s total (Parts to ship, under Shared job).
        {screen.split ? ` The ${screen.totals.parts} parts on screen are over one crate's limits, so they show as ${describeShipment(screen)}.` : ""}
      </p>
      <CrateTypePicker flush />
    </section>
  );
}
