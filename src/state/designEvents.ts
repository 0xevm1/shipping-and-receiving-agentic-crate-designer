import type { DesignResult } from "@/domain/design";

/**
 * Which input an edit came from, so the change note can sit by it. `recommended`: the quantity
 * sweep's recommendation, applied for a newly loaded part (spec §7.16).
 */
export type ChangeSource = "name" | "material" | "mass" | "cog" | "frame" | "rules" | "layout" | "recommended";

/**
 * What a design action did, told to the view store (`viewStore.ts`) once the design store has
 * been updated. This is the one place the design reaches into how it is shown: the design store
 * never writes view state, and the view store never writes the design.
 *
 * - `opened`: a part or a saved design was put on screen (`setPart`, `loadDesign`, `restoreDesign`).
 * - `edited`: an input changed and the design was recomputed (rules, layout pick, ranking, shop
 *   standards, a mass edit, the file's units or up axis, an applied recommendation). `source` is
 *   the input behind a change note; null when there is none (a standards change). `partReplaced`
 *   is true when the part object changed (a mass edit). `note` is what the change note says
 *   instead of the diff's summary ("Set to the recommended 34 per crate").
 * - `refined`: the result was refreshed with the camera and the layout pick kept: a name or
 *   material edit (with a `source`) or a profile measured from the model (without one).
 * - `crate-switched`: another crate type of a split batch was selected.
 *
 * `prev` and `next` are the shown crate's result before and after. The design store announces an
 * edit when its design lands, which with the engine's Web Worker is a few ms after the action.
 */
export type DesignEdit =
  | { type: "opened"; restored: boolean; prev: DesignResult; next: DesignResult }
  | { type: "edited"; source: ChangeSource | null; partReplaced: boolean; prev: DesignResult; next: DesignResult; note?: string }
  | { type: "refined"; source: ChangeSource | null; prev: DesignResult; next: DesignResult }
  | { type: "crate-switched" };

type Listener = (edit: DesignEdit) => void;
const listeners = new Set<Listener>();

/** Listens for design edits. Returns the function that stops listening. */
export function onDesignEdit(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * Announces an edit, synchronously, so by the time a design action returns the view has already
 * reacted. Called by the design store right after its own `set`, never by components.
 */
export function emitDesignEdit(edit: DesignEdit): void {
  for (const listener of [...listeners]) listener(edit);
}
