import { useEffect, useMemo, useState } from "react";
import type { CrateSettings } from "@/domain/schema";
import { sweepQuantities, type QuantitySweep } from "@/domain/sweep";
import { useDesigner } from "./store";

/**
 * The quantity sweep (spec §7.16) is about 30–150 ms, so it runs this long after the last change
 * to the part, the packing rules (not the quantity) or the standards, not on every slider step.
 */
export const SWEEP_DELAY_MS = 250;

/** The sweep's inputs: the quantity is left out, since the sweep tries every one. */
interface SweepInputs {
  part: ReturnType<typeof useDesigner.getState>["part"];
  rules: Omit<CrateSettings, "quantity">;
  standards: ReturnType<typeof useDesigner.getState>["standards"];
}

/**
 * The best-quantity sweep for the part on screen, derived from the store without adding to it.
 * `current` is false while a rule change is waiting to be swept (the last result for the same part
 * is kept, so the hint doesn't flicker). Runs on the main thread after a short pause; an engine worker can take it
 * over without changing this hook's shape.
 */
export function useBestQuantity(): { sweep: QuantitySweep | null; current: boolean } {
  const part = useDesigner((s) => s.part);
  const standards = useDesigner((s) => s.standards);
  const { keepUpright, maxLayers, partGapMm, wallClearanceMm, panelThickness } = useDesigner((s) => s.settings);
  const inputs = useMemo<SweepInputs>(
    () => ({ part, standards, rules: { keepUpright, maxLayers, partGapMm, wallClearanceMm, panelThickness } }),
    [part, standards, keepUpright, maxLayers, partGapMm, wallClearanceMm, panelThickness],
  );
  const [done, setDone] = useState<{ inputs: SweepInputs; sweep: QuantitySweep } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDone({ inputs, sweep: sweepQuantities(inputs.part, { ...inputs.rules, quantity: 1 }, inputs.standards) }), SWEEP_DELAY_MS);
    return () => clearTimeout(t);
  }, [inputs]);
  // Another part's result is never shown, even while this part's sweep is waiting.
  const sweep = done && done.inputs.part === part ? done.sweep : null;
  return { sweep, current: done?.inputs === inputs };
}
