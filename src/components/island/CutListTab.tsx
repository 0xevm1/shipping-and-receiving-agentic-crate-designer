"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ASSEMBLIES, type BomLine, type CrateDesign } from "@/domain/crate";
import { ASSEMBLY_NAMES, bomToCsv, downloadText, shipmentToCsv } from "@/domain/export";
import { serializeDesign } from "@/domain/designFile";
import { describeShipment, shipmentBom } from "@/domain/shipment";
import { cutText, stockText } from "@/lib/format";
import { designFilePart } from "@/lib/loadPart";
import { area, lengthUnit, run } from "@/lib/units";
import { useDesigner } from "@/state/store";
import { CrateTypePicker, shipmentStyles } from "./Shipment";

/**
 * Cut list grouped by assembly. Hovering a row lights those boards in 3D and
 * fades the rest; clicking pins it (Escape or "Show everything" clears).
 * For a split batch (#25) it shows the crate type on screen, or the whole shipment.
 */
export function CutListTab({ design }: { design: CrateDesign }) {
  const part = useDesigner((s) => s.part);
  const units = useDesigner((s) => s.units);
  const quantity = useDesigner((s) => s.settings.quantity);
  const plan = useDesigner((s) => s.plan);
  const crateIndex = useDesigner((s) => s.crateIndex);
  const pin = useDesigner((s) => s.pin);
  const hoverKey = useDesigner((s) => s.hover?.key);
  const { setHover, setPin } = useDesigner.getState();
  const [status, setStatus] = useState("");
  const [scope, setScope] = useState<"crate" | "shipment">("crate");
  const pinnedRow = useRef<HTMLTableRowElement>(null);
  const whole = plan.split && scope === "shipment";
  const crateType = plan.crates[crateIndex];

  // A board clicked in 3D opens this tab on its row.
  useEffect(() => {
    pinnedRow.current?.scrollIntoView({ block: "nearest" });
  }, [pin]);

  const all = whole ? shipmentBom(plan) : null;
  const lines: BomLine[] = all ? all.lines : design.bom;
  const totals = all ?? design;
  const csv = () => (whole ? shipmentToCsv(part, plan) : bomToCsv(part, design));
  const csvName = !plan.split
    ? `crate-${part.id}-x${quantity}.csv`
    : whole
      ? `crate-${part.id}-x${quantity}-shipment.csv`
      : `crate-${part.id}-x${quantity}-crate-${crateType.label}.csv`;

  return (
    <>
      <h2>{!plan.split ? "Cut list" : whole ? "Cut list for the whole shipment" : `Cut list for crate ${crateType.label}`}</h2>
      {plan.split && (
        <div className={`seg ${shipmentStyles.picker} ${shipmentStyles.cutScope}`} role="group" aria-label="Cut list for">
          <button type="button" aria-pressed={!whole} onClick={() => setScope("crate")}>
            This crate
          </button>
          <button type="button" aria-pressed={whole} onClick={() => setScope("shipment")}>
            Whole shipment
          </button>
        </div>
      )}
      {whole ? (
        <p className="lede">
          Every crate: {describeShipment(plan)}. Quantities are for all {plan.totals.crates} crates.
        </p>
      ) : (
        <>
          {plan.split && <CrateTypePicker />}
          <p className="lede">
            {plan.split && `For one crate ${crateType.label}; build ${crateType.count}. `}Point at a row to see where those boards go.
            Click it to keep them lit.
          </p>
        </>
      )}
      <table className="cut">
        <thead>
          <tr>
            <th>Piece</th>
            <th>Stock</th>
            <th>Cut, {lengthUnit(units)}</th>
            <th>Qty</th>
          </tr>
        </thead>
        <tbody>
          {ASSEMBLIES.map((a) => {
            const group = lines.filter((l) => l.assembly === a);
            if (!group.length) return null;
            return (
              <Fragment key={a}>
                <tr className="grp">
                  <td colSpan={4}>{ASSEMBLY_NAMES[a]}</td>
                </tr>
                {group.map((l) => {
                  const cells = (
                    <>
                      <td>{l.label}</td>
                      <td>{stockText(l, units)}</td>
                      <td>{cutText(l, units)}</td>
                      <td>{l.qty}</td>
                    </>
                  );
                  // Shipment totals span crate types, so their rows don't light boards in the one crate on screen.
                  if (whole) return <tr key={l.key}>{cells}</tr>;
                  const enter = () => setHover({ key: l.key, source: "list" });
                  const leave = () => setHover(null);
                  const toggle = () => setPin(pin === l.key ? null : l.key);
                  return (
                    <tr
                      key={l.key}
                      ref={pin === l.key ? pinnedRow : undefined}
                      className={`row${hoverKey === l.key ? " hl" : ""}${pin === l.key ? " pin" : ""}`}
                      tabIndex={0}
                      aria-pressed={pin === l.key}
                      onMouseEnter={enter}
                      onMouseLeave={leave}
                      onFocus={enter}
                      onBlur={leave}
                      onClick={toggle}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggle();
                        }
                      }}
                    >
                      {cells}
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <div className="totals">
        <div>
          <b>{area(totals.plywoodM2, units)}</b>plywood
        </div>
        <div>
          <b>{run(totals.lumberM, units)}</b>lumber
        </div>
        <div>
          <b>~{totals.screws}</b>wood screws
        </div>
      </div>
      <div className="actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            try {
              downloadText(csvName, csv());
              setStatus("Cut list downloaded.");
            } catch {
              setStatus("Download is blocked here. Use Copy cut list.");
            }
          }}
        >
          Download cut list
        </button>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(csv());
              setStatus("Cut list copied.");
            } catch {
              setStatus("Copy is blocked here.");
            }
          }}
        >
          Copy cut list
        </button>
        <button
          type="button"
          className="btn"
          title="Save the part, rules and layout to open again with Load a part"
          onClick={() => {
            const { settings } = useDesigner.getState();
            try {
              const text = serializeDesign({
                part: designFilePart(part),
                settings,
                layoutKey: design.layout.key,
                design,
                plan,
                savedAt: new Date().toISOString(),
              });
              downloadText(`crate-design-${part.id}-x${quantity}.json`, text, "application/json");
              setStatus("Design downloaded.");
            } catch {
              setStatus("Download is blocked here.");
            }
          }}
        >
          Download design (.json)
        </button>
        <span className="status" role="status">
          {status}
        </span>
      </div>
    </>
  );
}
