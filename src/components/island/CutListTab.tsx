"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ASSEMBLIES, type BomLine, type CrateDesign } from "@/domain/crate";
import { ASSEMBLY_NAMES } from "@/domain/crate";
import { describeShipment, shipmentBom } from "@/domain/shipment";
import { currentDesignText } from "@/lib/currentDesign";
import { bomToCsv, shipmentToCsv } from "@/lib/csv";
import { downloadText } from "@/lib/download";
import { cutListFileName, designFileName } from "@/lib/fileNames";
import { cutText, groupThousands, stockText } from "@/lib/format";
import { PRINT_PATH, printHash } from "@/lib/printLink";
import { sheetsHint, sheetsTotal } from "@/lib/sheets";
import { area, groupDigits, lengthUnit, run } from "@/lib/units";
import { useDesigner } from "@/state/store";
import { useWholeShipment } from "@/state/totalPlan";
import { useView } from "@/state/viewStore";
import { CrateTypePicker, CutScopeToggle } from "./CrateTypePicker";
import styles from "./CutListTab.module.css";

/**
 * Cut list grouped by assembly. Hovering a row lights those boards in 3D and
 * fades the rest; clicking pins it (Escape or "Show everything" clears).
 * For a split batch it shows the crate type on screen, or the whole shipment.
 */
export function CutListTab({ design }: { design: CrateDesign }) {
  const part = useDesigner((s) => s.part);
  const units = useView((s) => s.units);
  const quantity = useDesigner((s) => s.settings.quantity);
  const plan = useDesigner((s) => s.plan);
  // With Parts to ship set (#140) "Whole shipment" is the job's total plan, not the plan of the crate on screen.
  const shipment = useWholeShipment();
  const settings = useDesigner((s) => s.settings);
  const crateIndex = useDesigner((s) => s.crateIndex);
  const pin = useView((s) => s.pin);
  const hoverKey = useView((s) => s.hover?.key);
  const { setHover, setPin } = useView.getState();
  const [status, setStatus] = useState("");
  const [scope, setScope] = useState<"crate" | "shipment">("crate");
  const pinnedRow = useRef<HTMLTableRowElement>(null);
  const canWhole = plan.split || !!shipment.total;
  const whole = canWhole && scope === "shipment";
  const wholePlan = shipment.plan;
  const crateType = plan.crates[crateIndex];

  // A board clicked in 3D opens this tab on its row.
  useEffect(() => {
    pinnedRow.current?.scrollIntoView({ block: "nearest" });
  }, [pin]);

  const all = whole ? shipmentBom(wholePlan) : null;
  const lines: BomLine[] = all ? all.lines : design.bom;
  const totals = all ?? design;
  const csv = () => (whole ? shipmentToCsv(part, wholePlan, units) : bomToCsv(part, design, units));
  const csvName = whole
    ? cutListFileName({ partId: part.id, quantity: wholePlan.totals.parts, split: true, whole, crateLabel: crateType.label })
    : cutListFileName({ partId: part.id, quantity, split: plan.split, whole, crateLabel: crateType.label });
  /** The design file (§6.5) for the design on screen: the download. */
  const designText = () => currentDesignText(useDesigner.getState()) ?? "";
  /** The print link's file: the crate on screen, or with Parts to ship set (#140) the whole shipment, which the document then describes. */
  const printText = () =>
    shipment.total
      ? (currentDesignText({
          part,
          settings: { ...settings, quantity: shipment.total.types[0].quantity },
          plan: shipment.plan,
          result: shipment.plan.crates[0].result,
          ranking: "volume",
          total: shipment.total,
        }) ?? "")
      : designText();

  /** Runs one download or copy, says how it went, and counts a success as the design's first export. */
  const runExport = async (action: () => void | Promise<void>, okMessage: string, failMessage: string) => {
    try {
      await action();
      setStatus(okMessage);
      useView.getState().markExported();
    } catch {
      setStatus(failMessage);
    }
  };

  return (
    <>
      <h2>{!canWhole ? "Cut list" : whole ? "Cut list for the whole shipment" : `Cut list for crate ${crateType.label}`}</h2>
      {canWhole && <CutScopeToggle whole={whole} onChange={setScope} />}
      {whole ? (
        <p className="lede">
          Every crate: {groupThousands(describeShipment(wholePlan))}. Quantities are for all {groupDigits(wholePlan.totals.crates)} crates
          {shipment.total ? `, ${groupDigits(wholePlan.totals.parts)} parts to ship` : ""}.
        </p>
      ) : (
        <>
          {plan.split && <CrateTypePicker />}
          <p className="lede">
            {plan.split && `For one crate ${crateType.label}; build ${crateType.count}. `}
            <span className="hint-mouse" data-testid="hint-mouse">
              Point at a row to see where those boards go. Click it to keep them lit.
            </span>
            <span className="hint-touch" data-testid="hint-touch">
              Tap a row to light those boards in 3D and keep them lit. Tap it again to let go.
            </span>
          </p>
        </>
      )}
      <table className={styles.cut}>
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
                <tr className={styles.grp}>
                  <td colSpan={4} className="eyebrow-label">
                    {ASSEMBLY_NAMES[a]}
                  </td>
                </tr>
                {group.map((l) => {
                  const cells = (
                    <>
                      <td data-testid="cut-piece">
                        {whole ? (
                          l.label
                        ) : (
                          // The row's click is the mouse shortcut; this button is the keyboard and screen-reader control.
                          <button type="button" className={styles.pick} aria-pressed={pin === l.key}>
                            {l.label}
                          </button>
                        )}
                      </td>
                      <td className="nominal" data-testid="cut-stock">
                        {stockText(l, units)}
                      </td>
                      <td data-unit={units === "metric" ? "mm" : undefined} data-testid="cut-size">
                        {cutText(l, units)
                          .split(" × ")
                          .map((d, i) => (
                            <Fragment key={i}>
                              {i > 0 && " × "}
                              <span className="nw">{d}</span>
                            </Fragment>
                          ))}
                      </td>
                      <td data-testid="cut-qty">{groupDigits(l.qty)}</td>
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
                      className={`${styles.row}${hoverKey === l.key ? ` ${styles.hl}` : ""}${pin === l.key ? ` ${styles.pin}` : ""}`}
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
      <div className={styles.totals}>
        <div>
          <b>{groupThousands(area(totals.plywoodM2, units))}</b>plywood
        </div>
        <div>
          <b>{groupThousands(run(totals.lumberM, units))}</b>lumber
        </div>
        <div title={sheetsHint(totals.sheets, units)} data-testid="sheets-needed">
          <b>{sheetsTotal(totals.sheets)}</b>plywood sheets
        </div>
        <div>
          <b>~{groupDigits(totals.screws)}</b>wood screws
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
            const tab = window.open(`${PRINT_PATH}${printHash(printText(), units, true)}`, "_blank");
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
