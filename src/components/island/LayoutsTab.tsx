"use client";

import { useState } from "react";
import type { CrateDesign } from "@/domain/crate";
import { explainLayout, scoreLayouts, type LayoutExplanation, type LayoutScore, type Ranking } from "@/domain/design";
import type { Layout } from "@/domain/packing";
import { densityDelta, densityText, describeLayout, usd, usdDelta } from "@/lib/format";
import { dims, lengthUnit, volume, type Units } from "@/lib/units";
import { useDesigner } from "@/state/store";
import { CrateTypePicker } from "./Shipment";

const FIRST_SHOWN = 4;

/** The ranking options (#17), in the order of the toggle. */
const RANKING_LABELS: { id: Ranking; label: string }[] = [
  { id: "volume", label: "Volume" },
  { id: "cost", label: "Crate cost" },
  { id: "density", label: "Freight class" },
];

/** Every way to pack the batch, recommended first, each with a top and side drawing. */
export function LayoutsTab({ design }: { design: CrateDesign }) {
  const layouts = useDesigner((s) => s.result.layouts);
  const units = useDesigner((s) => s.units);
  const setLayoutKey = useDesigner((s) => s.setLayoutKey);
  const standards = useDesigner((s) => s.standards);
  const ranking = useDesigner((s) => s.ranking);
  const setRanking = useDesigner((s) => s.setRanking);
  const part = useDesigner((s) => s.part);
  const settings = useDesigner((s) => s.settings);
  // Parts in the crate type on screen: its layouts are for this many (#25).
  const quantity = useDesigner((s) => s.plan.crates[s.crateIndex]?.quantity ?? s.settings.quantity);
  const [showAll, setShowAll] = useState(false);
  const current = design.layout;
  const best = layouts[0];

  const shown = showAll ? layouts.slice() : layouts.slice(0, FIRST_SHOWN);
  if (!shown.some((l) => l.key === current.key)) shown.push(current);
  const maxVolume = Math.max(...shown.map((l) => l.externalVolumeM3));
  // Each card's cost and freight against the recommendation (#17). Only the cards on screen are
  // designed (about 1 ms for five); the React Compiler memoizes it between renders.
  const scores = scoreLayouts(part, { ...settings, quantity }, [best, ...shown], standards);

  return (
    <>
      <h2>Ways to pack it</h2>
      <p className="lede">
        <Why explanation={explainLayout(layouts, current, standards, ranking)} onUseBest={() => setLayoutKey(null)} /> Each drawing shows the
        crate from above, then from the side.
      </p>
      <div className="seg rank" role="group" aria-label="Rank layouts by">
        {RANKING_LABELS.map((r) => (
          <button key={r.id} type="button" aria-pressed={ranking === r.id} onClick={() => setRanking(r.id)}>
            {r.label}
          </button>
        ))}
      </div>
      <CrateTypePicker />
      {shown.map((l) => (
        <button
          key={l.key}
          type="button"
          className="opt"
          aria-pressed={l.key === current.key}
          onClick={() => setLayoutKey(l.key === best.key ? null : l.key)}
        >
          <Thumb layout={l} design={design} />
          <span>
            <span className="opt-title">
              {describeLayout(l)}
              {l.key === best.key && <span className="badge">recommended</span>}
              {!l.stable && <span className="badge tall">may tip</span>}
            </span>
            <span className="opt-dims">
              {dims(l.external, units)} {lengthUnit(units)}
            </span>
            <span className="opt-meta">
              {l.orientation.label}, {volume(l.externalVolumeM3, units)}
            </span>
            <Delta score={scores.get(l.key)} best={scores.get(best.key)} isBest={l.key === best.key} units={units} />
            <span className="volbar">
              <i style={{ width: `${((l.externalVolumeM3 / maxVolume) * 100).toFixed(0)}%` }} />
            </span>
          </span>
        </button>
      ))}
      {layouts.length > FIRST_SHOWN && (
        <button type="button" className="more" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show fewer" : `Show all ${layouts.length} layouts`}
        </button>
      )}
    </>
  );
}

/** The recommended card's cost and freight; every other card's difference from it. */
function Delta({ score, best, isBest, units }: { score?: LayoutScore; best?: LayoutScore; isBest: boolean; units: Units }) {
  if (!score || !best) return null;
  if (isBest) {
    return (
      <span className="opt-delta">
        {usd(score.costUsd)} to build · class {score.freightClass} · {densityText(score.densityLbFt3, units)}
      </span>
    );
  }
  const cost = Math.round(score.costUsd - best.costUsd);
  const density = densityDelta(score.densityLbFt3 - best.densityLbFt3, units);
  const sameClass = score.freightClass === best.freightClass;
  return (
    <span className="opt-delta" title="Against the recommended layout">
      <span className={cost > 0 ? "worse" : cost < 0 ? "better" : undefined}>{usdDelta(cost)}</span>
      {" · "}
      <span className={sameClass ? undefined : score.freightClass > best.freightClass ? "worse" : "better"}>
        {sameClass ? `same class ${score.freightClass}` : `class ${best.freightClass} → ${score.freightClass}`}
      </span>
      {density && ` · ${density}`}
    </span>
  );
}

function Why({ explanation: e, onUseBest }: { explanation: LayoutExplanation; onUseBest: () => void }) {
  switch (e.kind) {
    case "only":
      return <>This is the only way to pack this batch under the current packing rules.</>;
    case "stable":
      return <>The recommended layout is the smallest crate that will not tip easily.</>;
    case "smaller":
      return <>The recommended layout is the smallest stable crate. The next option ships {e.nextMorePct}% more volume.</>;
    case "tie":
      return <>The recommended layout is the lowest of the options that tie on shipping volume.</>;
    case "ranked":
      return e.by === "cost" ? (
        <>Ranked by crate cost: the recommended layout is the cheapest stable, fully blocked crate to build.</>
      ) : (
        <>
          Ranked by freight: the recommended layout has the lowest estimated freight class, then the lightest gross, of the stable,
          fully blocked crates without an LTL length charge.
        </>
      );
    case "picked":
      return (
        <>
          Your pick ships {e.morePct > 0 ? `${e.morePct}% more volume than` : "about the same volume as"} the recommended layout.{" "}
          <button type="button" className="linkbtn" onClick={onUseBest}>
            Use the recommended layout
          </button>
        </>
      );
  }
}

/** Top view above side view, to scale, parts in slate on plywood. */
function Thumb({ layout: l, design }: { layout: Layout; design: CrateDesign }) {
  const c = design.construction;
  const wall = c.panelMm + c.cleat.thick;
  const base = c.floorMm + c.skid.tall;
  const [EL, EW, EH] = l.external;
  const [a, b, h] = l.cellSize;
  const gap = 140;
  const s = Math.min(104 / EL, 84 / (EW + EH + gap));
  const W = EL * s;
  const H = (EW + EH + gap) * s;
  const y0 = (EW + gap) * s;
  return (
    <svg width={Math.ceil(W)} height={Math.ceil(H)} viewBox={`0 0 ${W.toFixed(1)} ${H.toFixed(1)}`} aria-hidden="true">
      <rect x=".5" y=".5" width={W - 1} height={EW * s - 1} fill="#C9B48C" stroke="#E6D6B4" />
      {l.slots
        .filter((sl) => sl.index[2] === 0)
        .map((sl, i) => (
          <rect key={i} x={(wall + sl.min[0]) * s} y={(wall + sl.min[1]) * s} width={a * s} height={b * s} fill="#59636E" />
        ))}
      <rect x=".5" y={y0 + 0.5} width={W - 1} height={EH * s - 1} fill="#C9B48C" stroke="#E6D6B4" />
      <rect x=".5" y={y0 + (EH - base) * s} width={W - 1} height={base * s - 0.5} fill="#96703F" />
      {l.slots
        .filter((sl) => sl.index[1] === 0)
        .map((sl, i) => (
          <rect key={i} x={(wall + sl.min[0]) * s} y={y0 + (EH - base - sl.min[2] - h) * s} width={a * s} height={h * s} fill="#59636E" />
        ))}
    </svg>
  );
}
