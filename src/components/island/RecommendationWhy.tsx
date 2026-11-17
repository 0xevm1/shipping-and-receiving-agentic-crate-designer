"use client";

import { useMemo } from "react";
import { CONSTRAINT_TEXT, explainRecommendation, type ExplanationCurvePoint } from "@/domain/explainRecommendation";
import type { QuantitySweep } from "@/domain/sweep";
import { explanationText } from "@/lib/explanation";
import { usdCents } from "@/lib/format";
import { useDesigner } from "@/state/store";
import styles from "./RecommendationWhy.module.css";

/**
 * "Why this crate?" (spec §7.16 "Explaining the recommendation"), opened from the best-quantity
 * hint on the Rules tab: what was compared, how it is scored (with the recommended crate's cost),
 * why this quantity (a cost-per-part curve and the best few), what stopped a larger crate, and
 * what it takes into account. Every sentence and number comes from `explainRecommendation` and
 * `explanationText`, the same model the PDFs print.
 */
export function RecommendationWhy({ sweep, id }: { sweep: QuantitySweep; id: string }) {
  const units = useDesigner((s) => s.units);
  const standards = useDesigner((s) => s.standards);
  const settings = useDesigner((s) => s.settings);
  const measured = useDesigner((s) => !!s.part.profile);
  const explanation = useMemo(() => explainRecommendation(sweep, standards, settings, { measured }), [sweep, standards, settings, measured]);
  if (!explanation) return null;
  const x = explanationText(explanation, units);

  return (
    <section id={id} className={styles.why} aria-label="Why this crate?" data-testid="recommendation-why">
      <p className={styles.headline}>{x.headline}</p>
      {x.sections.map((s) => (
        <section key={s.id} className={styles.section} aria-labelledby={`${id}-${s.id}`} data-section={s.id}>
          <h3 id={`${id}-${s.id}`} className={`eyebrow-label ${styles.title}`}>
            {s.title}
          </h3>
          {s.lines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
          {s.id === "score" && (
            <table className={styles.table} aria-label={`Cost of ${x.quantity} per crate`}>
              <tbody>
                {x.costLines.map((l) => (
                  <tr key={l.label} data-total={l.total || undefined}>
                    <th scope="row">
                      {l.label}
                      {l.detail && <small>{l.detail}</small>}
                    </th>
                    <td>{l.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {s.id === "pick" && (
            <>
              <CostCurve points={explanation.curve} pick={x.quantity} />
              <table className={styles.table} aria-label="Best quantities by cost per part">
                <thead>
                  <tr>
                    <th scope="col">Per crate</th>
                    <th scope="col">Cost per part</th>
                    <th scope="col">Against the pick</th>
                  </tr>
                </thead>
                <tbody>
                  {x.ranking.map((r) => (
                    <tr key={r.quantity} data-total={r.picked || undefined}>
                      <th scope="row">{r.quantity}</th>
                      <td>{r.perPart}</td>
                      <td>{r.picked ? "recommended" : r.vsPick}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      ))}
    </section>
  );
}

const W = 320;
const H = 132;
const PAD = { l: 56, r: 10, t: 10, b: 30 };

/**
 * Cost per part over quantity per crate: the passing quantities as a line (log scale, since one
 * part alone costs several times what a full crate does per part), the pick as a gold dot, and
 * every failing quantity as a red tick on the axis. Each quantity has a hover target with its text.
 */
function CostCurve({ points, pick }: { points: ExplanationCurvePoint[]; pick: number }) {
  const ok = points.filter((p) => p.ok);
  if (!ok.length) return null;
  const n = points.length;
  const scores = ok.map((p) => p.scoreUsdPerPart!);
  const [lo, hi] = [Math.log(Math.min(...scores)), Math.log(Math.max(...scores))];
  const x = (q: number) => PAD.l + ((q - 1) / Math.max(1, n - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (hi === lo ? 0.5 : (hi - Math.log(v)) / (hi - lo)) * (H - PAD.t - PAD.b);
  // Break the line wherever a quantity fails.
  const segments: string[] = [];
  let d = "";
  for (const p of points) {
    if (!p.ok) {
      if (d) segments.push(d);
      d = "";
      continue;
    }
    d += `${d ? "L" : "M"}${x(p.quantity).toFixed(1)},${y(p.scoreUsdPerPart!).toFixed(1)}`;
  }
  if (d) segments.push(d);
  const picked = points[pick - 1];
  const failing = points.filter((p) => !p.ok);
  const firstFail = failing.find((p) => p.quantity > pick);
  const base = H - PAD.b;
  const step = (W - PAD.l - PAD.r) / Math.max(1, n - 1);
  const label = `Cost per part by quantity per crate, 1 to ${n}: ${ok.length} pass; the lowest is ${usdCents(picked.scoreUsdPerPart!)} at ${pick} per crate${
    firstFail ? `; ${firstFail.quantity} per crate fails the ${CONSTRAINT_TEXT[firstFail.binding!]}` : ""
  }.`;

  return (
    <figure className={styles.curve}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <line className={styles.axis} x1={PAD.l} x2={W - PAD.r} y1={base} y2={base} />
        {[Math.max(...scores), picked.scoreUsdPerPart!].map((v, i) => (
          <g key={i}>
            <line className={styles.grid} x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />
            <text className={styles.tick} x={PAD.l - 6} y={y(v)} textAnchor="end" dominantBaseline="middle">
              {usdCents(v)}
            </text>
          </g>
        ))}
        {[1, pick, n].map((q, i) => (
          <text key={i} className={styles.tick} x={x(q)} y={base + 14} textAnchor={q === 1 ? "start" : q === n ? "end" : "middle"}>
            {q}
          </text>
        ))}
        {segments.map((seg, i) => (
          <path key={i} className={styles.line} d={seg} />
        ))}
        {failing.map((p) => (
          <line key={p.quantity} className={styles.fail} x1={x(p.quantity)} x2={x(p.quantity)} y1={base - 7} y2={base} />
        ))}
        <circle className={styles.pick} cx={x(pick)} cy={y(picked.scoreUsdPerPart!)} r={4.5} />
        {points.map((p) => (
          <rect key={p.quantity} className={styles.hit} x={x(p.quantity) - step / 2} y={PAD.t} width={step} height={base - PAD.t}>
            <title>
              {p.ok
                ? `${p.quantity} per crate: ${usdCents(p.scoreUsdPerPart!)} a part${p.quantity === pick ? " (recommended)" : ""}`
                : `${p.quantity} per crate: fails the ${CONSTRAINT_TEXT[p.binding!]}`}
            </title>
          </rect>
        ))}
      </svg>
      <figcaption className={styles.legend}>
        <span>
          <i className={styles.keyLine} aria-hidden="true" /> cost per part (log scale)
        </span>
        <span>
          <i className={styles.keyPick} aria-hidden="true" /> recommended
        </span>
        <span>
          <i className={styles.keyFail} aria-hidden="true" /> fails a hard check
        </span>
        <span className={styles.axisNote}>quantity per crate →</span>
      </figcaption>
    </figure>
  );
}
