"use client";

import { ASSEMBLIES, type CrateDesign } from "@/domain/crate";
import type { DesignField } from "@/domain/diff";
import { ASSEMBLY_NAMES } from "@/domain/crate";
import { countKind } from "@/domain/members";
import { cautionVerdict, layoutName, usd } from "@/lib/format";
import { plywoodLabel, sectionLabel } from "@/lib/lumber";
import { dims, dimsOther, lengthUnit, partWeight, volume, weight } from "@/lib/units";
import type { CheckItem } from "@/lib/checks";
import { useDesigner } from "@/state/store";
import { Flash } from "../shell/ChangeFeedback";
import { SavedDesigns } from "./SavedDesigns";
import { Scorecard } from "./Scorecard";
import styles from "./OverviewTab.module.css";
import { ShipmentSummary } from "./Shipment";

/** The answer at a glance: outside size, then how it is built, then where the weight is. */
export function OverviewTab({ design, checks }: { design: CrateDesign; checks: readonly CheckItem[] }) {
  const part = useDesigner((s) => s.part);
  const units = useDesigner((s) => s.units);
  const crateType = useDesigner((s) => (s.plan.split ? s.plan.crates[s.crateIndex] : null));
  const auto = useDesigner((s) => s.settings.panelThickness === "auto");
  const setHover = useDesigner((s) => s.setHover);
  const setTab = useDesigner((s) => s.setTab);
  const { layout, construction: c } = design;
  // Parts in the crate on screen: the whole batch, or one crate type's share of a split.
  const quantity = layout.slots.length;
  const posts = countKind(design.members, "blocking");
  const bearers = countKind(design.members, "bearer");
  const separators = countKind(design.members, "separator");
  const cradles = countKind(design.members, "cradle");
  // Imperial uses shop names: "1/2″" plywood, "1x4" cleats, "4x4" skids.
  const ply = (v: number) => plywoodLabel(v, units);
  const section = (a: number, b: number) => sectionLabel(a, b, units);
  const maxAssembly = Math.max(...Object.values(design.tareKgByAssembly));

  return (
    <>
      <ShipmentSummary />
      <h2>
        {crateType ? `Crate ${crateType.label}: ${quantity}` : `Crate for ${quantity}`} × {part.name}
        {crateType && <small className={styles.each}>{crateType.count > 1 ? `${crateType.count} of these` : "one of these"}</small>}
      </h2>
      {/* Values an edit changed flash gold for 1.2 s. */}
      <div className={styles.big} data-testid="outside-size">
        <Flash on={["outside"]}>{dims(layout.external, units)}</Flash>
        <small>{lengthUnit(units)}</small>
      </div>
      <div className="line">Outside, length × width × height</div>
      <div className="line">
        <span className="mono muted">{dimsOther(layout.external, units)}</span>
      </div>
      <Verdict cautions={checks.filter((c) => c.level === "caution").map((c) => c.title)} onReview={() => setTab("checks")} />
      <div className="line">
        Ships at <span className="mono">{volume(layout.externalVolumeM3, units)}</span>, gross{" "}
        <Flash on={["gross"]} className="mono">
          {weight(design.grossKg, units)}
        </Flash>
      </div>
      <Scorecard design={design} />

      <ul className={styles.chain} data-testid="build-chain">
        <Step name="Parts" value={weight(design.payloadKg, units)} flash={["payload"]}>
          {quantity} × {partWeight(part.mass_kg, units)}, {part.material ?? "material not given"}
        </Step>
        <Step name="Layout" value={layout.counts.join(" × ")} flash={["grid"]}>
          {layoutName(layout)}. Inside is {dims(layout.interior, units)} {lengthUnit(units)}
        </Step>
        <Step name="Walls and lid" value={`${ply(c.panelMm)} ply`} flash={["panel"]}>
          {auto ? "Sized for the load" : "Set by hand"}, stiffened with <span className="nominal">{section(c.cleat.thick, c.cleat.wide)}</span> cleats
        </Step>
        <Step name="Base" value={`${c.skidCount} skids`} flash={["skidCount"]}>
          <Flash on={["skid"]} className="nominal">
            {section(c.skid.wide, c.skid.tall)}
          </Flash>{" "}
          skids under a{" "}
          {c.joist && (
            <>
              <span className="nominal">
                {c.joist.count} {section(c.joist.wide, c.joist.tall)}
              </span>{" "}
              joists and a{" "}
            </>
          )}
          <Flash on={["floor"]}>{ply(c.floorMm)}</Flash> floor, open for forklift tines. Rated {weight(design.structure.ratedPayloadKg, units)} of parts
        </Step>
        {cradles > 0 ? (
          <Step name="Cradles" value={`${cradles} cradles`}>
            Notched saddles along each part, {posts} end stop{posts === 1 ? "" : "s"}
          </Step>
        ) : (
          <Step name="Blocking" value={`${posts} posts`}>
            {bearers} bearer{bearers === 1 ? "" : "s"} underneath
            {separators > 0 && `, ${separators} layer separator${separators === 1 ? "" : "s"}`}
          </Step>
        )}
        <Step name="Gross weight" value={weight(design.grossKg, units)} flash={["gross"]} end>
          empty crate <Flash on={["tare"]}>{weight(design.tareKg, units)}</Flash>, ~{design.screws} screws, about {usd(design.materialCostUsd)} of wood
        </Step>
      </ul>

      <h3>Crate weight by assembly</h3>
      <div className={styles.bars}>
        {ASSEMBLIES.filter((a) => design.tareKgByAssembly[a] > 0).map((a) => {
          const kg = design.tareKgByAssembly[a];
          const on = () => setHover({ assembly: a, source: "list" });
          const off = () => setHover(null);
          return (
            <div
              key={a}
              className={styles.barrow}
              data-testid="weight-bar"
              role="group"
              aria-label={`${ASSEMBLY_NAMES[a]}, ${weight(kg, units)}`}
              tabIndex={0}
              onMouseEnter={on}
              onMouseLeave={off}
              onFocus={on}
              onBlur={off}
            >
              <span>{ASSEMBLY_NAMES[a]}</span>
              <span className={styles.v}>{weight(kg, units)}</span>
              <span className={styles.track}>
                <i style={{ width: `${Math.max(2, (kg / maxAssembly) * 100).toFixed(0)}%` }} />
              </span>
            </div>
          );
        })}
      </div>

      {/* The design library: save, list and reuse this part's designs; share links. */}
      <SavedDesigns />
    </>
  );
}

/** The checks at a glance, so a caution isn't only a small badge on another tab. */
function Verdict({ cautions, onReview }: { cautions: readonly string[]; onReview: () => void }) {
  if (!cautions.length) {
    return (
      <p className={styles.verdict} data-testid="verdict">
        <i aria-hidden="true" />
        All checks clear
      </p>
    );
  }
  const text = cautionVerdict(cautions);
  return (
    <button type="button" className={`${styles.verdict} ${styles.caution}`} data-testid="verdict" title={`${text}. Open Checks.`} onClick={onReview}>
      <i aria-hidden="true" />
      <span>{text}</span>
      <span className={styles.go} aria-hidden="true">
        Checks →
      </span>
    </button>
  );
}

interface StepProps {
  name: string;
  value: string;
  /** Diff fields that make the value flash when an edit changes them. */
  flash?: readonly DesignField[];
  end?: boolean;
  children: React.ReactNode;
}

function Step({ name, value, flash = [], end, children }: StepProps) {
  return (
    <li className={end ? styles.end : undefined}>
      <b>{name}</b>
      <Flash on={flash} className={styles.v}>
        {value}
      </Flash>
      <small>{children}</small>
    </li>
  );
}
