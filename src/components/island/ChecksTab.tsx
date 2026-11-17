"use client";

import { renderMessage } from "@/lib/message";
import type { CheckItem } from "@/state/checks";
import { useDesigner } from "@/state/store";
import { CrateTypePicker } from "./Shipment";

/** Every rule of thumb, passed ones included, cautions first. */
export function ChecksTab({ checks }: { checks: readonly CheckItem[] }) {
  const units = useDesigner((s) => s.units);
  return (
    <>
      <h2>Checks</h2>
      <p className="lede">Rules of thumb for a first pass. Heavy or unusual loads still need an engineering review.</p>
      <CrateTypePicker />
      {checks.map((c) => (
        <div key={c.id} className={`check ${c.level}`}>
          <i />
          <div>
            <b>{c.title}</b>
            <span>{renderMessage(c.detail, units)}</span>
          </div>
        </div>
      ))}
    </>
  );
}
