"use client";

import { ASSEMBLIES, type CrateDesign } from "@/domain/crate";
import { ASSEMBLY_NAMES } from "@/domain/export";
import { layoutName } from "@/lib/format";
import { dims, dimsOther, fraction, lengthUnit, partWeight, volume, weight } from "@/lib/units";
import { useDesigner } from "@/state/store";

/** The answer at a glance: outside size, then how it is built, then where the weight is. */
export function OverviewTab({ design }: { design: CrateDesign }) {
  const part = useDesigner((s) => s.part);
  const units = useDesigner((s) => s.units);
  const quantity = useDesigner((s) => s.settings.quantity);
  const auto = useDesigner((s) => s.settings.panelThickness === "auto");
  const setHover = useDesigner((s) => s.setHover);
  const { layout, construction: c } = design;
  const imperial = units === "imperial";
  const count = (kind: string) => design.members.filter((m) => m.kind === kind).length;
  const posts = count("blocking");
  const bearers = count("bearer");
  const separators = count("separator");
  const mm = (v: number) => (imperial ? fraction(v) : `${v} mm`);
  const section = (a: number, b: number) => (imperial ? `${fraction(a)} × ${fraction(b)}` : `${a} × ${b}`);
  const maxAssembly = Math.max(...Object.values(design.tareKgByAssembly));

  return (
    <>
      <h2>
        Crate for {quantity} × {part.name.toLowerCase()}
      </h2>
      <div className="big">
        {dims(layout.external, units)}
        <small>{lengthUnit(units)}</small>
      </div>
      <div className="line">Outside, length × width × height</div>
      <div className="line">
        <span className="mono muted">{dimsOther(layout.external, units)}</span>
      </div>
      <div className="line">
        Ships at <span className="mono">{volume(layout.externalVolumeM3, units)}</span>, gross{" "}
        <span className="mono">{weight(design.grossKg, units)}</span>
      </div>

      <ul className="chain">
        <Step name="Parts" value={weight(design.payloadKg, units)}>
          {quantity} × {partWeight(part.mass_kg, units)}, {part.material ?? "material not given"}
        </Step>
        <Step name="Layout" value={layout.counts.join(" × ")}>
          {layoutName(layout)}. Inside is {dims(layout.interior, units)} {lengthUnit(units)}
        </Step>
        <Step name="Walls and lid" value={`${mm(c.panelMm)} ply`}>
          {auto ? "Sized for the load" : "Set by hand"}, stiffened with {section(c.cleat.thick, c.cleat.wide)} cleats
        </Step>
        <Step name="Base" value={`${c.skidCount} skids`}>
          {section(c.skid.wide, c.skid.tall)} skids under a {mm(c.floorMm)} floor, open for forklift tines
        </Step>
        <Step name="Blocking" value={`${posts} posts`}>
          {bearers} bearer{bearers === 1 ? "" : "s"} underneath
          {separators > 0 && `, ${separators} layer separator${separators === 1 ? "" : "s"}`}
        </Step>
        <Step name="Gross weight" value={weight(design.grossKg, units)} end>
          empty crate {weight(design.tareKg, units)}, ~{design.screws} screws, about ${Math.round(design.materialCostUsd)} of wood
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
    </>
  );
}

function Step({ name, value, end, children }: { name: string; value: string; end?: boolean; children: React.ReactNode }) {
  return (
    <li className={end ? "end" : undefined}>
      <b>{name}</b>
      <span className="v">{value}</span>
      <small>{children}</small>
    </li>
  );
}
