"use client";

import type { CrateDesign } from "@/domain/crate";
import { allChecks } from "@/state/checks";
import { useDesigner } from "@/state/store";

/** Every rule of thumb, passed ones included, cautions first. */
export function ChecksTab({ design }: { design: CrateDesign }) {
  const part = useDesigner((s) => s.part);
  const measured = useDesigner((s) => s.measured);
  return (
    <>
      <h2>Checks</h2>
      <p className="lede">Rules of thumb for a first pass. Heavy or unusual loads still need an engineering review.</p>
      {allChecks(design.checks, part, measured).map((c) => (
        <div key={c.id} className={`check ${c.level}`}>
          <i />
          <div>
            <b>{c.title}</b>
            <span>{c.detail}</span>
          </div>
        </div>
      ))}
    </>
  );
}
