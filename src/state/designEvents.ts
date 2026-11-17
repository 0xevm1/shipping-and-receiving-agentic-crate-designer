import type { DesignResult } from "@/domain/design";

/** Which input an edit came from, so the change note can sit by it. */
export type ChangeSource = "name" | "material" | "mass" | "frame" | "rules" | "layout";

/**
 * What a design action did, told to the view store (`viewStore.ts`) once the design store has
 * been updated. This is the one place the design reaches into how it is shown: the design store
 * never writes view state, and the view store never writes the design.
 *
 * - `opened`: a part or a saved design was put on screen (`setPart`, `loadDesign`, `restoreDesign`).
 * - `edited`: an input changed and the design was recomputed (rules, layout pick, ranking, shop
 *   standards, a mass edit). `source` is the input behind a change note; null when there is none
 *   (a standards change). `partReplaced` is true when the part object changed (a mass edit).
 * - `refined`: the result was refreshed with the camera and the layout pick kept: a name or
 *   material edit (with a `source`) or a profile measured from the model (without one).
 * - `crate-switched`: another crate type of a split batch was selected.
 *
 * `prev` and `next` are the shown crate's result before and after.
 */
export type DesignEdit =
  | { type: "opened"; restored: boolean; prev: DesignResult; next: DesignResult }
  | { type: "edited"; source: ChangeSource | null; partReplaced: boolean; prev: DesignResult; next: DesignResult }
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
