"use client";

import { create } from "zustand";
import { downloadBytes } from "@/lib/exportGlb";
import { useDesigner } from "@/state/store";

/** The busy state shows at least this long, so a fast export still registers (not with reduced motion). */
export const MIN_BUSY_MS = 1500;
/** How long "Downloaded …" stays up. */
const NOTE_MS = 8000;

export type ExportState = { kind: "idle" } | { kind: "busy" } | { kind: "done"; name: string } | { kind: "error"; message: string };

const ERROR_TEXT = "The export could not be made here. Try again, or use the separate downloads in the Cut list tab.";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let noteTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * The one export run behind the Export pill (#51): one click downloads
 * `crate-<part>-x<qty>.zip` (`src/lib/exportBundle.ts`, loaded on first use). A second click
 * while busy does nothing.
 */
export const useExportRun = create<{ state: ExportState; run: () => Promise<void> }>((set, get) => ({
  state: { kind: "idle" },
  run: async () => {
    const s = useDesigner.getState();
    if (get().state.kind === "busy" || !s.result.design || s.plan.problem) return;
    clearTimeout(noteTimer);
    set({ state: { kind: "busy" } });
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The design as it is now, whatever is edited while the files are made.
    const at = new Date();
    try {
      const work = (async () => {
        const { browserMakers, buildBundle, zipBundle } = await import("@/lib/exportBundle");
        const input = { part: s.part, settings: s.settings, plan: s.plan, crateIndex: s.crateIndex, standards: s.standards, units: s.units, ranking: s.ranking, generatedAt: at.toISOString() };
        const bundle = await buildBundle(input, await browserMakers(s.part));
        return { name: bundle.name, zip: zipBundle(bundle.files, at) };
      })();
      const [{ name, zip }] = await Promise.all([work, reduce ? null : wait(MIN_BUSY_MS)]);
      downloadBytes(name, zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer, "application/zip");
      useDesigner.getState().markExported();
      set({ state: { kind: "done", name } });
      noteTimer = setTimeout(() => get().state.kind === "done" && set({ state: { kind: "idle" } }), NOTE_MS);
    } catch (e) {
      console.error("Export failed", e);
      set({ state: { kind: "error", message: e instanceof Error && e.name === "NoCrateError" ? e.message : ERROR_TEXT } });
    }
  },
}));

/** The outcome as one line: "Downloaded crate-PART-001-x4.zip", an error, or nothing. */
export const exportNote = (st: ExportState) => (st.kind === "done" ? `Downloaded ${st.name}` : st.kind === "error" ? st.message : "");
