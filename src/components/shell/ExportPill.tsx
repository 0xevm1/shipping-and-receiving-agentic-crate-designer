"use client";

import { useEffect, useRef, useState } from "react";
import { downloadBytes } from "@/lib/exportGlb";
import { useDesigner } from "@/state/store";

/** The busy state shows at least this long, so a fast export still registers (not with reduced motion). */
export const MIN_BUSY_MS = 1500;
/** How long "Downloaded …" stays under the pill. */
const NOTE_MS = 8000;

type State = { kind: "idle" } | { kind: "busy" } | { kind: "done"; name: string } | { kind: "error"; message: string };

const ERROR_TEXT = "The export could not be made here. Try again, or use the separate downloads in the Cut list tab.";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The Export pill (#51), under the part header: one click downloads `crate-<part>-x<qty>.zip`
 * with the GLB, the PDF, the cut list, the design file and a README, all made in the browser
 * (`src/lib/exportBundle.ts`). The bundle code and jsPDF load only on the first click.
 *
 * Idle → busy ("Exporting…" with a spinner, held for at least 1.5 s; with reduced motion, no
 * spin and no hold) → "Downloaded crate-PART-001-x4.zip", or a plain error. The note is a
 * `role="status"` live region, so screen readers hear the outcome.
 */
export function ExportPill() {
  const canExport = useDesigner((s) => !!s.result.design && !s.plan.problem);
  const [state, setState] = useState<State>({ kind: "idle" });
  const busy = state.kind === "busy";
  const noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(noteTimer.current), []);

  const run = async () => {
    if (busy || !canExport) return;
    clearTimeout(noteTimer.current);
    setState({ kind: "busy" });
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The design as it is now, whatever is edited while the files are made.
    const s = useDesigner.getState();
    const at = new Date();
    try {
      const work = (async () => {
        const { browserMakers, buildBundle, zipBundle } = await import("@/lib/exportBundle");
        const input = { part: s.part, settings: s.settings, plan: s.plan, crateIndex: s.crateIndex, standards: s.standards, units: s.units, generatedAt: at.toISOString() };
        const bundle = await buildBundle(input, await browserMakers(s.part));
        return { name: bundle.name, zip: zipBundle(bundle.files, at) };
      })();
      const [{ name, zip }] = await Promise.all([work, reduce ? null : wait(MIN_BUSY_MS)]);
      downloadBytes(name, zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer, "application/zip");
      useDesigner.getState().markExported();
      setState({ kind: "done", name });
      noteTimer.current = setTimeout(() => setState((st) => (st.kind === "done" ? { kind: "idle" } : st)), NOTE_MS);
    } catch (e) {
      console.error("Export failed", e);
      setState({ kind: "error", message: e instanceof Error && e.name === "NoCrateError" ? e.message : ERROR_TEXT });
    }
  };

  const note = state.kind === "done" ? `Downloaded ${state.name}` : state.kind === "error" ? state.message : "";

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
        <span>{busy ? "Exporting…" : "Export"}</span>
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
