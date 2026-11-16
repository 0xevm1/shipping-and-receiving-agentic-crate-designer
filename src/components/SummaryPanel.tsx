"use client";

import type { CrateDesign } from "@/domain/crate";
import type { Layout } from "@/domain/packing";
import type { Vec3 } from "@/domain/schema";

const MAX_ALTERNATIVES = 6;

export function SummaryPanel({ design }: { design: CrateDesign }) {
  const { layout, construction } = design;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">External size</div>
        <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-900">{fmtDims(layout.external)} mm</div>
        <div className="font-mono text-xs tabular-nums text-slate-500">
          {layout.external.map((v) => (v / 25.4).toFixed(1)).join(" × ")} in · interior {fmtDims(layout.interior)} mm
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 text-center">
        <Stat label="Gross" value={`${design.grossKg.toFixed(0)} kg`} />
        <Stat label="Crate (tare)" value={`${design.tareKg.toFixed(0)} kg`} />
        <Stat label="Payload" value={`${design.payloadKg.toFixed(0)} kg`} />
        <Stat label="Space used" value={`${(layout.utilization * 100).toFixed(0)}%`} />
        <Stat label="Volume" value={`${layout.externalVolumeM3.toFixed(2)} m³`} />
        <Stat label="Material ≈" value={`$${design.materialCostUsd.toFixed(0)}`} />
      </dl>

      <div className="text-xs leading-relaxed text-slate-600">
        <span className="font-medium text-slate-800">Layout:</span> {layout.counts.join(" × ")} grid,{" "}
        {layout.orientation.label.toLowerCase()}. <span className="font-medium text-slate-800">Build:</span>{" "}
        {construction.panelMm} mm plywood walls &amp; lid, {construction.floorMm} mm floor, {construction.skidCount}{" "}
        {construction.skid.wide}×{construction.skid.tall} skids, 19×89 cleats. {design.plywoodM2.toFixed(1)} m² plywood,{" "}
        {design.lumberM.toFixed(1)} m lumber, ~{design.screws} wood screws.
      </div>

      {design.warnings.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {design.warnings.map((w, i) => (
            <li
              key={i}
              className={`rounded px-2.5 py-1.5 text-xs ${
                w.level === "caution" ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-600"
              }`}
            >
              {w.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AlternativesTable({
  layouts,
  selectedKey,
  onSelect,
}: {
  layouts: Layout[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const best = layouts[0];
  return (
    <table className="w-full text-xs tabular-nums">
      <thead className="text-left text-[11px] uppercase tracking-wider text-slate-400">
        <tr>
          <th className="py-1 font-medium">Grid</th>
          <th className="py-1 font-medium">Orientation</th>
          <th className="py-1 text-right font-medium">External mm</th>
          <th className="py-1 text-right font-medium">m³</th>
          <th className="py-1 text-right font-medium">Used</th>
        </tr>
      </thead>
      <tbody>
        {layouts.slice(0, MAX_ALTERNATIVES).map((l) => (
          <tr
            key={l.key}
            onClick={() => onSelect(l.key)}
            className={`cursor-pointer border-t border-slate-100 ${
              l.key === selectedKey ? "bg-amber-50 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <td className="py-1.5 font-mono">{l.counts.join("×")}</td>
            <td className="py-1.5">
              {l.orientation.label}
              {l === best && <span className="ml-1.5 rounded bg-emerald-100 px-1 text-[10px] text-emerald-800">best</span>}
              {!l.stable && <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10px] text-amber-800">tall</span>}
            </td>
            <td className="py-1.5 text-right font-mono">{fmtDims(l.external)}</td>
            <td className="py-1.5 text-right">{l.externalVolumeM3.toFixed(2)}</td>
            <td className="py-1.5 text-right">{(l.utilization * 100).toFixed(0)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CutList({ design }: { design: CrateDesign }) {
  return (
    <table className="w-full text-xs tabular-nums">
      <thead className="text-left text-[11px] uppercase tracking-wider text-slate-400">
        <tr>
          <th className="py-1 font-medium">Component</th>
          <th className="py-1 font-medium">Stock</th>
          <th className="py-1 text-right font-medium">Cut (mm)</th>
          <th className="py-1 text-right font-medium">Qty</th>
        </tr>
      </thead>
      <tbody>
        {design.bom.map((l, i) => (
          <tr key={i} className="border-t border-slate-100 text-slate-700">
            <td className="py-1.5 capitalize">{l.kind.replace("-", " ")}</td>
            <td className="py-1.5 text-slate-500">
              {l.stock} {l.material}
            </td>
            <td className="py-1.5 text-right font-mono">{l.cut}</td>
            <td className="py-1.5 text-right">{l.qty}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-2 py-2">
      <dt className="text-[10px] uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}

function fmtDims(v: Vec3): string {
  return v.map((n) => Math.round(n)).join(" × ");
}
