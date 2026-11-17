"use client";

import type { CrateDesign } from "@/domain/crate";
import { densityText, elapsedText, hoursText, usd } from "@/lib/format";
import { weightFromLb } from "@/lib/units";
import { useDesigner } from "@/state/store";
import styles from "./Scorecard.module.css";

/**
 * The design scorecard: what the crate costs to build and how it looks to a freight
 * booker, under the outside size on the Overview. Numbers come from the domain
 * (`design.cost`, `design.labour`, `design.freight`); this only formats them.
 */
export function Scorecard({ design }: { design: CrateDesign }) {
  const units = useDesigner((s) => s.units);
  const rate = useDesigner((s) => s.standards.labour.rateUsdPerHour);
  const plan = useDesigner((s) => (s.plan.split ? s.plan : null));
  const designedInMs = useDesigner((s) => s.designedInMs);
  const { cost, labour, freight } = design;
  const lb = (v: number) => weightFromLb(v, units);

  return (
    <section className={styles.card} aria-label="Scorecard">
      <div className={styles.eyebrow}>Scorecard{plan ? " · each crate" : ""}</div>
      <dl className={styles.grid}>
        <div>
          <dt>Crate cost</dt>
          <dd className={styles.value}>{usd(cost.totalUsd)}</dd>
          <dd>
            {usd(cost.materialUsd)} material + {usd(cost.labourUsd)} labour
          </dd>
        </div>
        <div>
          <dt>Build time</dt>
          <dd className={styles.value}>{hoursText(labour.hours)}</dd>
          <dd>labour at {usd(rate)}/h</dd>
        </div>
        <div>
          <dt>Freight class</dt>
          <dd className={styles.value}>{design.freightClass}</dd>
          <dd>est., {densityText(design.densityLbFt3, units)}</dd>
        </div>
        <div>
          <dt>Dim weight</dt>
          <dd className={styles.value}>{lb(design.dimWeightLb)}</dd>
          <dd>
            ÷ {freight.dimDivisorIn3PerLb} in³/lb, gross {lb(freight.grossLb)}
          </dd>
        </div>
      </dl>
      <p className={styles.note}>
        Material is {usd(cost.woodUsd)} of wood and {usd(cost.fastenersUsd)} of screws. The class is an estimate from the NMFC density scale; rates
        come from the shop standards.
      </p>
      {plan && (
        <p className={styles.note}>
          Whole shipment: <b>{usd(plan.totals.costUsd)}</b> to build {plan.totals.crates} crates, <b>{hoursText(plan.totals.labourHours)}</b> of
          labour, {lb(plan.totals.dimWeightLb)} dim weight.
        </p>
      )}
      {designedInMs !== null && (
        <p className={`${styles.note} ${styles.clock}`} role="status">
          Designed in {elapsedText(designedInMs)}
        </p>
      )}
    </section>
  );
}
