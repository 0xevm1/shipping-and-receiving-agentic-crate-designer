import { create } from "zustand";
import { downloadBytes } from "@/lib/download";
import { useDesigner } from "./store";
import { useView } from "./viewStore";

/** The busy state shows at least this long, so a fast export still registers (not with reduced motion). */
export const MIN_BUSY_MS = 1500;
/** How long "Downloaded …" stays up. */
export const DONE_NOTE_MS = 8000;
/** A failure stays up longer, since it asks the person to do something. */
export const ERROR_NOTE_MS = 15000;

export type ExportState = { kind: "idle" } | { kind: "busy" } | { kind: "done"; name: string } | { kind: "error"; message: string };

const ERROR_TEXT = "The export could not be made here. Try again, or use the separate downloads in the Cut list tab.";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The one export run behind the Export pill: one click downloads `crate-<part>-x<qty>.zip`
 * (the engine's `buildBundleZip`, loaded with its PDF, ZIP and GLB code on first use). A second click while busy does nothing.
 * The outcome note clears itself, a failure after a longer time than a success.
 */
export const useExportRun = create<{ state: ExportState; run: () => Promise<void> }>((set, get) => {
  let noteTimer: ReturnType<typeof setTimeout> | undefined;
  /** Shows an outcome, then goes back to idle unless something newer replaced it. */
  const show = (state: ExportState, ms: number) => {
    set({ state });
    noteTimer = setTimeout(() => get().state === state && set({ state: { kind: "idle" } }), ms);
  };

  return {
    state: { kind: "idle" },
    run: async () => {
      const s = useDesigner.getState();
      const { units } = useView.getState();
      if (get().state.kind === "busy" || !s.result.design || s.plan.problem) return;
      clearTimeout(noteTimer);
      set({ state: { kind: "busy" } });
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // The design as it is now, whatever is edited while the files are made.
      const at = new Date();
      try {
        const work = (async () => {
          const [{ buildBundleZip }, { urlModelReader }] = await Promise.all([import("@/engine/files"), import("@/engine/glb")]);
          const input = {
            part: s.part,
            settings: s.settings,
            plan: s.plan,
            crateIndex: s.crateIndex,
            standards: s.standards,
            units,
            ranking: s.ranking,
            layoutKey: s.layoutKey,
            generatedAt: at.toISOString(),
          };
          return buildBundleZip(input, urlModelReader, at);
        })();
        const [{ name, zip }] = await Promise.all([work, reduce ? null : wait(MIN_BUSY_MS)]);
        downloadBytes(name, zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer, "application/zip");
        useView.getState().markExported();
        show({ kind: "done", name }, DONE_NOTE_MS);
      } catch (e) {
        console.error("Export failed", e);
        show({ kind: "error", message: e instanceof Error && e.name === "NoCrateError" ? e.message : ERROR_TEXT }, ERROR_NOTE_MS);
      }
    },
  };
});

/** The outcome as one line: "Downloaded crate-PART-001-x4.zip", an error, or nothing. */
export const exportNote = (st: ExportState) => (st.kind === "done" ? `Downloaded ${st.name}` : st.kind === "error" ? st.message : "");
