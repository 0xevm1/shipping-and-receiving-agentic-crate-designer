import { create } from "zustand";
import type { CrateSettings } from "@/domain/schema";
import type { QuantitySweep } from "@/domain/sweep";
import { sweepRequestFor } from "@/engine/request";
import { engine as appEngine, type EngineClient } from "./engineClient";
import { useDesigner, type DesignerState } from "./store";

/**
 * The quantity sweep (spec §7.16) is about 30–150 ms, so after a change to the packing rules (not
 * the quantity) or the standards it is asked for this long after the last change, not on every
 * slider step. A new part (or its measured outline) is swept at once.
 */
export const SWEEP_DELAY_MS = 250;

/** The sweep's inputs: the quantity is left out, since the sweep tries every one. */
export interface SweepInputs {
  part: DesignerState["part"];
  rules: Omit<CrateSettings, "quantity">;
  standards: DesignerState["standards"];
}

interface SweepState {
  /** The inputs on screen; null while no sweeps run (`startSweeps`). */
  inputs: SweepInputs | null;
  /** The last result, with the inputs it was swept for. */
  done: { inputs: SweepInputs; sweep: QuantitySweep } | null;
}

/** The sweeps' own small store, beside the designer's (nothing is added to it). */
export const useSweep = create<SweepState>()(() => ({ inputs: null, done: null }));

/** The sweep inputs of `s`, or `prev` itself when none of them changed. */
function sweepInputs(s: DesignerState, prev: SweepInputs | null): SweepInputs {
  const { keepUpright, maxLayers, partGapMm, wallClearanceMm, panelThickness } = s.settings;
  const rules = { keepUpright, maxLayers, partGapMm, wallClearanceMm, panelThickness };
  const same =
    prev && prev.part === s.part && prev.standards === s.standards && (Object.keys(rules) as (keyof typeof rules)[]).every((k) => prev.rules[k] === rules[k]);
  return same ? prev : { part: s.part, standards: s.standards, rules };
}

/**
 * Keeps the quantity sweep for the part and rules on screen (spec §7.16) and hands each result
 * that is still current to `applyRecommendation`, which opens a newly loaded part at the
 * recommendation. The sweep runs in the engine's Web Worker (`engine.sweep`, latest-wins: a
 * newer request replaces one still waiting), and in this thread only where there is no worker.
 * One sweeper for the page, so the hint and the recommendation on load never compete for the
 * latest-wins lane; started by `SavedStateLoader`. Returns a stop function.
 */
export function startSweeps(engine: EngineClient = appEngine, delayMs = SWEEP_DELAY_MS): () => void {
  let live = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const update = (s: DesignerState) => {
    const prev = useSweep.getState().inputs;
    const inputs = sweepInputs(s, prev);
    if (inputs === prev) return;
    useSweep.setState({ inputs });
    clearTimeout(timer);
    const run = () =>
      engine.sweep(sweepRequestFor(inputs), (out) => {
        if (!live) return;
        useSweep.setState({ done: { inputs, sweep: out.sweep } });
        // Only a result for what is on screen opens a part at its recommendation.
        if (useSweep.getState().inputs === inputs) useDesigner.getState().applyRecommendation(inputs.part, out.sweep);
      });
    timer = setTimeout(run, prev?.part === inputs.part ? delayMs : 0);
  };
  update(useDesigner.getState());
  const stop = useDesigner.subscribe((s) => update(s));
  return () => {
    live = false;
    clearTimeout(timer);
    stop();
    // A later start sweeps again: this one's result will never arrive.
    useSweep.setState({ inputs: null });
  };
}

/**
 * The best-quantity sweep for the part on screen. `current` is false while a change is waiting
 * to be swept (the last result for the same part is kept, so the hint doesn't flicker). Another
 * part's result is never shown, even while this part's sweep is waiting.
 */
export function useBestQuantity(): { sweep: QuantitySweep | null; current: boolean } {
  const part = useDesigner((s) => s.part);
  const inputs = useSweep((s) => s.inputs);
  const done = useSweep((s) => s.done);
  const sweep = done && done.inputs.part === part ? done.sweep : null;
  return { sweep, current: !!done && done.inputs === inputs };
}
