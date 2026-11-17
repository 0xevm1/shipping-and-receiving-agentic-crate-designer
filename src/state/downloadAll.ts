import { create } from "zustand";
import type { QuantitySweep } from "@/domain/sweep";
import type { DesignRequest } from "@/engine/schemas";
import { downloadBytes } from "@/lib/download";
import { DONE_NOTE_MS, ERROR_NOTE_MS, MIN_BUSY_MS, type ExportState } from "./exportRun";
import { useDesigner } from "./store";

const ERROR_TEXT = "The bundle could not be made here. Try again, or use Export specs for the design on screen.";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The design on screen as an engine request. */
export function currentRequest(s: ReturnType<typeof useDesigner.getState>): DesignRequest {
  return { part: s.part, settings: s.settings, standards: s.standards, layoutKey: s.layoutKey, ranking: s.ranking };
}

/**
 * The configurations Download all bundles today: the design on screen, then the sweep's
 * shortlist (spec §7.16), each at its quantity and layout with the same rules. The bundle drops
 * duplicates. A job's saved configurations can be passed to `run` instead.
 */
export function shortlistConfigs(current: DesignRequest, sweep: QuantitySweep | null): DesignRequest[] {
  const picks = (sweep?.shortlist ?? []).filter((p) => p.ok && p.crate);
  return [current, ...picks.map((p) => ({ ...current, settings: { ...current.settings, quantity: p.quantity }, layoutKey: p.crate!.layoutKey }))];
}

/**
 * The Download all run (spec §7.17): one ZIP with a folder per configuration (GLB, PDF, CSV), a
 * manifest and a comparison summary, built in the browser by the engine's `buildMultiBundleZip`
 * (loaded, with the sweep's file code, PDF, ZIP and GLB code, on the first click). Nothing goes to
 * a server.
 *
 * `run(configs)` takes any plain array of design requests; without one it bundles the design on
 * screen and the sweep's shortlist. Same states and timings as the Export pill (`exportRun.ts`).
 */
export const useDownloadAll = create<{ state: ExportState; run: (configs?: DesignRequest[]) => Promise<void> }>((set, get) => {
  let noteTimer: ReturnType<typeof setTimeout> | undefined;
  const show = (state: ExportState, ms: number) => {
    set({ state });
    noteTimer = setTimeout(() => get().state === state && set({ state: { kind: "idle" } }), ms);
  };

  return {
    state: { kind: "idle" },
    run: async (configs) => {
      const s = useDesigner.getState();
      if (get().state.kind === "busy" || (!configs && (!s.result.design || s.plan.problem))) return;
      clearTimeout(noteTimer);
      set({ state: { kind: "busy" } });
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // The design as it is now, whatever is edited while the files are made.
      const current = currentRequest(s);
      const units = s.units;
      const at = new Date().toISOString();
      try {
        const work = (async () => {
          const [{ buildMultiBundleZip, sweepFor }, { urlModelReader }] = await Promise.all([import("@/engine/artifacts"), import("@/engine/glb")]);
          return buildMultiBundleZip(configs ?? shortlistConfigs(current, sweepFor(current)), urlModelReader, { units, generatedAt: at });
        })();
        const [{ name, zip }] = await Promise.all([work, reduce ? null : wait(MIN_BUSY_MS)]);
        downloadBytes(name, zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer, "application/zip");
        useDesigner.getState().markExported();
        show({ kind: "done", name }, DONE_NOTE_MS);
      } catch (e) {
        console.error("Download all failed", e);
        show({ kind: "error", message: ERROR_TEXT }, ERROR_NOTE_MS);
      }
    },
  };
});
