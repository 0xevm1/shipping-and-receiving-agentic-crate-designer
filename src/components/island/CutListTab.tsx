"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ASSEMBLIES, type BomLine, type CrateDesign } from "@/domain/crate";
import { ASSEMBLY_NAMES } from "@/domain/assemblyNames";
import { describeShipment, shipmentBom } from "@/domain/shipment";
import { currentDesignText } from "@/lib/currentDesign";
import { bomToCsv, shipmentToCsv } from "@/lib/csv";
import { downloadText } from "@/lib/download";
import { cutListFileName, designFileName } from "@/lib/fileNames";
import { cutText, stockText } from "@/lib/format";
import { PRINT_PATH, printHash } from "@/lib/printLink";
import { area, lengthUnit, run } from "@/lib/units";
import { useDesigner } from "@/state/store";
import { CrateTypePicker, shipmentStyles } from "./Shipment";

/**
 * Cut list grouped by assembly. Hovering a row lights those boards in 3D and
 * fades the rest; clicking pins it (Escape or "Show everything" clears).
 * For a split batch it shows the crate type on screen, or the whole shipment.
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
  const csv = () => (whole ? shipmentToCsv(part, plan, units) : bomToCsv(part, design, units));
  const csvName = cutListFileName({ partId: part.id, quantity, split: plan.split, whole, crateLabel: crateType.label });
  /** The design file (§6.5) for the design on screen: the download, and the print link. */
  const designText = () => currentDesignText(useDesigner.getState()) ?? "";

  /** Runs one download or copy, says how it went, and counts a success as the design's first export. */
  const runExport = async (action: () => void | Promise<void>, okMessage: string, failMessage: string) => {
    try {
      await action();
      setStatus(okMessage);
      useDesigner.getState().markExported();
    } catch {
      setStatus(failMessage);
    }
  };

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
            {plan.split && `For one crate ${crateType.label}; build ${crateType.count}. `}Point at a row to see where those boards go. Click it to
            keep them lit.
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
                      <td>
                        {whole ? (
                          l.label
                        ) : (
                          // The row's click is the mouse shortcut; this button is the keyboard and screen-reader control.
                          <button type="button" className="pick" aria-pressed={pin === l.key}>
                            {l.label}
                          </button>
                        )}
                      </td>
                      <td className="nominal">{stockText(l, units)}</td>
                      <td>
                        {cutText(l, units)
                          .split(" × ")
                          .map((d, i) => (
                            <Fragment key={i}>
                              {i > 0 && " × "}
                              <span className="nw">{d}</span>
                            </Fragment>
                          ))}
                      </td>
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
                      onMouseEnter={enter}
                      onMouseLeave={leave}
                      onFocus={enter}
                      onBlur={leave}
                      onClick={toggle}
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
          onClick={() => runExport(() => downloadText(csvName, csv()), "Cut list downloaded.", "Download is blocked here. Use Copy cut list.")}
        >
          Download cut list
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => runExport(() => navigator.clipboard.writeText(csv()), "Cut list copied.", "Copy is blocked here.")}
        >
          Copy cut list
        </button>
        <button
          type="button"
          className="btn"
          title="Save the part, rules and layout to open again with Load a part"
          onClick={() =>
            runExport(
              () => downloadText(designFileName(part.id, quantity), designText(), "application/json"),
              "Design downloaded.",
              "Download is blocked here.",
            )
          }
        >
          Download design (.json)
        </button>
        <button
          type="button"
          className="btn"
          title="Crate spec, build sheet and shipping label, ready to print or save as PDF"
          onClick={() => {
            // The design travels in the URL hash (src/lib/printLink.ts); the new tab opens the print dialog.
            const tab = window.open(`${PRINT_PATH}${printHash(designText(), units, true)}`, "_blank");
            setStatus(tab ? "Print view opened in a new tab." : "The new tab was blocked. Allow pop-ups for this site and try again.");
          }}
        >
          Print / save PDF
        </button>
        <span className="status" role="status">
          {status}
        </span>
      </div>
    </>
  );
}
