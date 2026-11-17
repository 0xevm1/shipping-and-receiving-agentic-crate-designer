"use client";

import { useDesigner } from "@/state/store";
import { exportNote, useExportRun } from "@/state/exportRun";

/**
 * The Export pill, under the part header: one click downloads `crate-<part>-x<qty>.zip`
 * with the GLB, the PDF, the cut list, the design file and a README, all made in the browser
 * (`src/lib/exportBundle.ts`). The bundle code and jsPDF load only on the first click.
 *
 * Idle → busy ("Exporting…" with a spinner, held for at least 1.5 s; with reduced motion, no
 * spin and no hold) → "Downloaded crate-PART-001-x4.zip", or a plain error. The note is a
 * `role="status"` live region, so screen readers hear the outcome. The run and its state are
 * kept in `exportRun.ts`.
 */
export function ExportPill() {
  const canExport = useDesigner((s) => !!s.result.design && !s.plan.problem);
  const state = useExportRun((s) => s.state);
  const run = useExportRun((s) => s.run);
  const busy = state.kind === "busy";
  const note = exportNote(state);

  return (
    <div className="exportrow">
      <button
        type="button"
        className={`exportpill${busy ? " busy" : ""}`}
        disabled={!canExport}
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        title={canExport ? "Download a .zip with the 3D model, the PDF (spec, build sheet, label), the cut list and the design file" : "There is no crate to export"}
        onClick={run}
      >
        {busy ? <span className="exportspin" aria-hidden="true" /> : <DownloadIcon />}
        <span>{busy ? "Exporting…" : "Export specs"}</span>
      </button>
      <span className={`exportnote${state.kind === "error" ? " bad" : ""}`} role="status">
        {note}
      </span>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 11.5v2h11v-2" />
    </svg>
  );
}
