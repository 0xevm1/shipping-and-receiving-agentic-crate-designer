import { catalog } from "@/domain/catalog";
import type { DesignFile } from "@/domain/designFile";
import { loadDesign, loadPartFiles, type LoadOutcome } from "@/lib/loadPart";
import { useLibrary } from "./libraryStore";
import { beginLoad, type LoadTicket } from "./loadSequence";
import { useDesigner } from "./store";

type Outcome = Omit<LoadOutcome, "catalogAdditions"> & { catalogAdditions?: LoadOutcome["catalogAdditions"] };

/** Puts a load's part (and a design's rules and layout) on screen, with its message. */
export function applyOutcome(outcome: Outcome) {
  const s = useDesigner.getState();
  if (outcome.catalogAdditions?.length) s.addCatalogParts(outcome.catalogAdditions);
  if (outcome.part && outcome.design) {
    const { settings, layoutKey, crateIndex, ranking } = outcome.design;
    // The ranking is part of the design: set first, so the layout is planned and explained under it.
    if (ranking !== s.ranking) s.setRanking(ranking);
    s.loadDesign(outcome.part, settings, layoutKey, crateIndex);
  } else if (outcome.part) s.setPart(outcome.part);
  // Without a part nothing opened: the message says what to do, and stays until dismissed.
  s.setLoadMessage(outcome.message, outcome.part ? "note" : "error");
}

const failed = (err: unknown) =>
  useDesigner.getState().setLoadMessage(err instanceof Error ? err.message : "That file couldn't be read. Try it again, or choose another.", "error");

/**
 * Applies `work`'s outcome unless a later load started meanwhile. A superseded outcome is
 * dropped, and its object URL released because no part will ever show it. Resolves to the
 * outcome when it was applied, else null.
 */
async function applyLatest(ticket: LoadTicket, work: () => Promise<Outcome>): Promise<Outcome | null> {
  try {
    const outcome = await work();
    if (!ticket.current()) {
      if (outcome.part?.modelUrl.startsWith("blob:")) URL.revokeObjectURL(outcome.part.modelUrl);
      return null;
    }
    applyOutcome(outcome);
    return outcome;
  } catch (err) {
    if (ticket.current()) failed(err);
    return null;
  }
}

/**
 * Opens a parsed design file (spec §6.5): the same path as a design file picked or dropped, used
 * by the design library and share links. A custom part's GLB goes in `glbs`. True when the
 * design opened.
 */
export async function openDesignFile(file: DesignFile, glbs: File[] = []): Promise<boolean> {
  const ticket = beginLoad();
  const s = useDesigner.getState();
  s.setLoadMessage("");
  const outcome = await applyLatest(ticket, () => loadDesign(file, glbs, catalog.parts, s.standards, s.units));
  return Boolean(outcome?.part);
}

/**
 * Load picked or dropped files as the current part, or open a saved design (spec §6.4),
 * reporting problems and what changed in the load row. A shared custom-part design waiting for
 * its model (`pendingShare`) opens when a GLB with that file name is loaded, and is only
 * forgotten once it has opened.
 */
export async function loadPickedFiles(list: FileList | File[]) {
  const ticket = beginLoad();
  const s = useDesigner.getState();
  s.setLoadMessage("");
  const files = [...list];
  const pending = useLibrary.getState().pendingShare;
  const completes = pending && !files.some((f) => /\.json$/i.test(f.name)) && files.some((f) => f.name === pending.part.model);
  const outcome = await applyLatest(ticket, () =>
    completes
      ? loadDesign(pending, files.filter((f) => /\.glb$/i.test(f.name)), catalog.parts, s.standards, s.units)
      : loadPartFiles(files, [...catalog.parts, ...s.extraParts], catalog.parts, s.standards, s.units),
  );
  if (completes && outcome?.part) useLibrary.getState().setPendingShare(null);
}
