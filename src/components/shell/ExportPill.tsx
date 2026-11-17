"use client";

import { cautionNote } from "@/lib/format";
import { allChecks, cautionCount } from "@/lib/checks";
import { useDownloadAll } from "@/state/downloadAll";
import { exportNote, useExportRun } from "@/state/exportRun";
import { useDesigner } from "@/state/store";
import { useView } from "@/state/viewStore";
import styles from "./ExportPill.module.css";

const EXPORT_TITLE = "Download a .zip with the 3D model, the PDF (spec, build sheet, label), the cut list and the design file";
const CAUTION_NOTE_ID = "export-caution";
const ALL_TITLE =
  "Download one .zip comparing the design on screen with the shared job's saved configurations (or, with none saved, the best quantities per crate): a folder each (3D model, PDF, cut list), a manifest and a comparison PDF";

/**
 * The Export pill, under the part header: one click downloads `crate-<part>-x<qty>.zip` with the
 * GLB, the PDF, the cut list, the design file and a README, all made in the browser
 * (`src/lib/exportBundle.ts`, built by the engine's `buildBundleZip`). The bundle code, jsPDF and the GLB exporter load only on the first click.
 *
 * Idle → busy ("Exporting…" with a spinner, held for at least 1.5 s; with reduced motion, no
 * spin and no hold) → "Downloaded crate-PART-001-x4.zip", or a plain error. The note is a
 * `role="status"` live region, so screen readers hear the outcome. The run and its state are
 * kept in `src/state/exportRun.ts`.
 *
 * Exporting is never blocked by cautions (no confirm dialog), but it isn't silent about them: a
 * small amber dot on the pill, and the count in its tooltip and accessible description.
 *
 * **Download all** beside it (outlined, secondary) downloads one .zip with a folder per
 * configuration (the design on screen and the sweep's shortlist), a manifest and a comparison
 * PDF (spec §7.17), also made in the browser; its run is `src/state/downloadAll.ts`.
 */
export function ExportPill() {
  const canExport = useDesigner((s) => !!s.result.design && !s.plan.problem);
  const findings = useView((s) => s.fileReport?.findings);
  const cautions = useDesigner((s) => (s.result.design ? cautionCount(allChecks(s.result.design.checks, s.part, s.measured, findings)) : 0));
  const state = useExportRun((s) => s.state);
  const run = useExportRun((s) => s.run);
  const busy = state.kind === "busy";
  const note = exportNote(state);
  const caution = canExport ? cautionNote(cautions) : "";
  const all = useDownloadAll((s) => s.state);
  const runAll = useDownloadAll((s) => s.run);
  const allBusy = all.kind === "busy";
  const allNote = exportNote(all);

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
        <span>{busy ? "Exporting…" : "Export Packing Specs"}</span>
        {caution && <span className={styles.dot} aria-hidden="true" data-testid="export-caution-dot" />}
      </button>
      <button
        type="button"
        className={allBusy ? `${styles.pill} ${styles.secondary} ${styles.busy}` : `${styles.pill} ${styles.secondary}`}
        disabled={!canExport}
        aria-disabled={allBusy || undefined}
        aria-busy={allBusy || undefined}
        title={canExport ? ALL_TITLE : "There is no crate to export"}
        onClick={() => runAll()}
        data-testid="download-all"
      >
        {allBusy ? <span className={styles.spin} aria-hidden="true" /> : <StackIcon />}
        <span>{allBusy ? "Bundling…" : "Download all"}</span>
      </button>
      {caution && (
        <span id={CAUTION_NOTE_ID} className="sr-only">
          {caution}
        </span>
      )}
      <span className={state.kind === "error" ? `${styles.note} ${styles.bad}` : styles.note} role="status" data-testid="export-note">
        {note}
      </span>
      <span className={all.kind === "error" ? `${styles.note} ${styles.bad}` : styles.note} role="status" data-testid="download-all-note">
        {allNote}
      </span>
    </div>
  );
}

/** Stacked sheets: several configurations in one download. */
function StackIcon() {
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
      <path d="M8 2.5 14 5.5 8 8.5 2 5.5zM2 8.5l6 3 6-3M2 11.5l6 3 6-3" />
    </svg>
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
