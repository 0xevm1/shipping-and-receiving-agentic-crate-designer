"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ASSEMBLIES, type CrateDesign } from "@/domain/crate";
import { ASSEMBLY_NAMES, bomToCsv, downloadText } from "@/domain/export";
import { cutText, stockText } from "@/lib/format";
import { area, lengthUnit, run } from "@/lib/units";
import { useDesigner } from "@/state/store";

/**
 * Cut list grouped by assembly. Hovering a row lights those boards in 3D and
 * fades the rest; clicking pins it (Escape or "Show everything" clears).
 */
export function CutListTab({ design }: { design: CrateDesign }) {
  const part = useDesigner((s) => s.part);
  const units = useDesigner((s) => s.units);
  const quantity = useDesigner((s) => s.settings.quantity);
  const pin = useDesigner((s) => s.pin);
  const hoverKey = useDesigner((s) => s.hover?.key);
  const { setHover, setPin } = useDesigner.getState();
  const [status, setStatus] = useState("");
  const pinnedRow = useRef<HTMLTableRowElement>(null);

  // A board clicked in 3D opens this tab on its row.
  useEffect(() => {
    pinnedRow.current?.scrollIntoView({ block: "nearest" });
  }, [pin]);

  const csv = () => bomToCsv(part, design);

  return (
    <>
      <h2>Cut list</h2>
      <p className="lede">Point at a row to see where those boards go. Click it to keep them lit.</p>
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
            const lines = design.bom.filter((l) => l.assembly === a);
            if (!lines.length) return null;
            return (
              <Fragment key={a}>
                <tr className="grp">
                  <td colSpan={4}>{ASSEMBLY_NAMES[a]}</td>
                </tr>
                {lines.map((l) => {
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
                      <td>{l.label}</td>
                      <td>{stockText(l, units)}</td>
                      <td>{cutText(l, units)}</td>
                      <td>{l.qty}</td>
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
          <b>{area(design.plywoodM2, units)}</b>plywood
        </div>
        <div>
          <b>{run(design.lumberM, units)}</b>lumber
        </div>
        <div>
          <b>~{design.screws}</b>wood screws
        </div>
      </div>
      <div className="actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            try {
              downloadText(`crate-${part.id}-x${quantity}.csv`, csv());
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
        <span className="status" role="status">
          {status}
        </span>
      </div>
    </>
  );
}
