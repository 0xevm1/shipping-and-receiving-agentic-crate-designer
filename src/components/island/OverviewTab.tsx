"use client";

import { ASSEMBLIES, type CrateDesign } from "@/domain/crate";
import type { DesignField } from "@/domain/diff";
import { ASSEMBLY_NAMES } from "@/domain/export";
import { layoutName } from "@/lib/format";
import { plywoodText, sectionText } from "@/lib/lumber";
import { dims, dimsOther, lengthUnit, partWeight, volume, weight } from "@/lib/units";
import { useDesigner } from "@/state/store";
import { Flash } from "../shell/ChangeFeedback";
import { SavedDesigns } from "./SavedDesigns";
import { Scorecard } from "./Scorecard";
import { ShipmentSummary, shipmentStyles } from "./Shipment";

/** The answer at a glance: outside size, then how it is built, then where the weight is. */
export function OverviewTab({ design }: { design: CrateDesign }) {
  const part = useDesigner((s) => s.part);
  const units = useDesigner((s) => s.units);
  const crateType = useDesigner((s) => (s.plan.split ? s.plan.crates[s.crateIndex] : null));
  const auto = useDesigner((s) => s.settings.panelThickness === "auto");
  const setHover = useDesigner((s) => s.setHover);
  const { layout, construction: c } = design;
  // Parts in the crate on screen: the whole batch, or one crate type's share of a split (#25).
  const quantity = layout.slots.length;
  const imperial = units === "imperial";
  const count = (kind: string) => design.members.filter((m) => m.kind === kind).length;
  const posts = count("blocking");
  const bearers = count("bearer");
  const separators = count("separator");
  const cradles = count("cradle");
  // Imperial uses shop names (#15): "1/2″" plywood, "1x4" cleats, "4x4" skids.
  const ply = (v: number) => (imperial ? plywoodText(v) : `${v} mm`);
  const section = (a: number, b: number) => (imperial ? sectionText(a, b) : `${a} × ${b}`);
  const maxAssembly = Math.max(...Object.values(design.tareKgByAssembly));

  return (
    <>
      <ShipmentSummary />
      <h2>
        {crateType ? `Crate ${crateType.label}: ${quantity}` : `Crate for ${quantity}`} × {part.name.toLowerCase()}
        {crateType && <small className={shipmentStyles.each}>{crateType.count > 1 ? `${crateType.count} of these` : "one of these"}</small>}
      </h2>
      {/* Values an edit changed flash gold for 1.2 s (#39). */}
      <div className="big">
        <Flash on={["outside"]}>{dims(layout.external, units)}</Flash>
        <small>{lengthUnit(units)}</small>
      </div>
      <div className="line">Outside, length × width × height</div>
      <div className="line">
        <span className="mono muted">{dimsOther(layout.external, units)}</span>
      </div>
      <div className="line">
        Ships at <span className="mono">{volume(layout.externalVolumeM3, units)}</span>, gross{" "}
        <Flash on={["gross"]} className="mono">
          {weight(design.grossKg, units)}
        </Flash>
      </div>
      <Scorecard design={design} />

      <ul className="chain">
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
          empty crate <Flash on={["tare"]}>{weight(design.tareKg, units)}</Flash>, ~{design.screws} screws, about $
          {Math.round(design.materialCostUsd)} of wood
        </Step>
      </ul>

      <h3>Crate weight by assembly</h3>
      <div className="bars">
        {ASSEMBLIES.filter((a) => design.tareKgByAssembly[a] > 0).map((a) => {
          const kg = design.tareKgByAssembly[a];
          const on = () => setHover({ assembly: a, source: "list" });
          const off = () => setHover(null);
          return (
            <div key={a} className="barrow" tabIndex={0} onMouseEnter={on} onMouseLeave={off} onFocus={on} onBlur={off}>
              <span>{ASSEMBLY_NAMES[a]}</span>
              <span className="v">{weight(kg, units)}</span>
              <span className="track">
                <i style={{ width: `${Math.max(2, (kg / maxAssembly) * 100).toFixed(0)}%` }} />
              </span>
            </div>
          );
        })}
      </div>

      {/* The design library (#14): save, list and reuse this part's designs; share links. */}
      <SavedDesigns />
    </>
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
    <li className={end ? "end" : undefined}>
      <b>{name}</b>
      <Flash on={flash} className="v">
        {value}
      </Flash>
      <small>{children}</small>
    </li>
  );
}
