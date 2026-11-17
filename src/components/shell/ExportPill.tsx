"use client";

import { cautionNote } from "@/lib/format";
import { allChecks, cautionCount } from "@/lib/checks";
import { exportNote, useExportRun } from "@/state/exportRun";
import { useDesigner } from "@/state/store";
import styles from "./ExportPill.module.css";

const EXPORT_TITLE = "Download a .zip with the 3D model, the PDF (spec, build sheet, label), the cut list and the design file";
const CAUTION_NOTE_ID = "export-caution";

/**
 * The Export pill, under the part header: one click downloads `crate-<part>-x<qty>.zip` with the
 * GLB, the PDF, the cut list, the design file and a README, all made in the browser
 * (`src/lib/exportBundle.ts`). The bundle code and jsPDF load only on the first click.
 *
 * Idle → busy ("Exporting…" with a spinner, held for at least 1.5 s; with reduced motion, no
 * spin and no hold) → "Downloaded crate-PART-001-x4.zip", or a plain error. The note is a
 * `role="status"` live region, so screen readers hear the outcome. The run and its state are
 * kept in `src/state/exportRun.ts`.
 *
 * Exporting is never blocked by cautions (no confirm dialog), but it isn't silent about them: a
 * small amber dot on the pill, and the count in its tooltip and accessible description.
 */
export function ExportPill() {
  const canExport = useDesigner((s) => !!s.result.design && !s.plan.problem);
  const cautions = useDesigner((s) => (s.result.design ? cautionCount(allChecks(s.result.design.checks, s.part, s.measured)) : 0));
  const state = useExportRun((s) => s.state);
  const run = useExportRun((s) => s.run);
  const busy = state.kind === "busy";
  const note = exportNote(state);
  const caution = canExport ? cautionNote(cautions) : "";

  return (
    <div className={styles.row}>
      <button
        type="button"
        className={busy ? `${styles.pill} ${styles.busy}` : styles.pill}
        disabled={!canExport}
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        aria-describedby={caution ? CAUTION_NOTE_ID : undefined}
        title={canExport ? (caution ? `${EXPORT_TITLE}. ${caution}.` : EXPORT_TITLE) : "There is no crate to export"}
        onClick={run}
      >
        {busy ? <span className={styles.spin} aria-hidden="true" /> : <DownloadIcon />}
        <span>{busy ? "Exporting…" : "Export specs"}</span>
        {caution && <span className={styles.dot} aria-hidden="true" data-testid="export-caution-dot" />}
      </button>
      {caution && (
        <span id={CAUTION_NOTE_ID} className="sr-only">
          {caution}
        </span>
      )}
      <span className={state.kind === "error" ? `${styles.note} ${styles.bad}` : styles.note} role="status" data-testid="export-note">
        {note}
      </span>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 11.5v2h11v-2" />
    </svg>
  );
}
