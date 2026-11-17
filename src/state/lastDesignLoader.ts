import { catalog } from "@/domain/catalog";
import { planShipment } from "@/domain/shipment";
import { currentDesignFile } from "@/lib/currentDesign";
import { designFilePart, loadDesign } from "@/lib/loadPart";
import { browserIdb, loadLastGlb, saveLastGlb } from "./glbCache";
import { createDebouncedSaver, saveLastDesign, type LastDesign } from "./lastDesignStorage";
import { useLibrary } from "./libraryStore";
import { beginLoad, type LoadTicket } from "./loadSequence";
import { browserStorage, type KeyValueStore } from "./standardsStorage";
import { useDesigner, type DesignerState } from "./store";
import { useView, type Tab } from "./viewStore";
import type { LoadedPart } from "@/lib/part";

/** The design on screen as a last-design entry, or null when there is no crate to keep. */
export function lastDesignOf(s: Pick<DesignerState, "part" | "settings" | "plan" | "result" | "ranking">, tab: Tab): LastDesign | null {
  const design = currentDesignFile(s);
  return design ? { design, tab, ranking: s.ranking } : null;
}

/**
 * Reopens the last-opened crate (spec §9) through the design-file path (`loadDesign`), with
 * its tab and ranking, after the saved standards and units are applied. A custom part's GLB comes
 * from IndexedDB; when it isn't there (never kept, over the cap, or another file) the default
 * part stays, the load row names the file, and loading it reopens the design (like a shared
 * custom-part link). Anything else that fails falls back to the default part with a warning.
 * True when the crate was reopened. Nothing is applied once `ticket` is no longer current (the
 * person loaded something else while this was reading), and then it resolves false.
 */
export async function restoreLastDesign(saved: LastDesign, idb: IDBFactory | null = browserIdb(), ticket: LoadTicket = beginLoad()): Promise<boolean> {
  const file = saved.design;
  const inCatalog = file.part.source === "catalog" && catalog.parts.some((p) => p.id === file.part.id);
  try {
    let glbs: File[] = [];
    if (!inCatalog) {
      const kept = await loadLastGlb(idb);
      if (!ticket.current()) return false;
      if (!kept || kept.name !== file.part.model) {
        useLibrary.getState().setPendingShare(file);
        useView.getState().setLoadMessage(`Load ${file.part.model} to reopen your last crate (${file.settings.quantity} × ${file.part.name}).`, "error");
        return false;
      }
      glbs = [new File([kept.bytes], kept.name, { type: "model/gltf-binary" })];
    }
    const s = useDesigner.getState();
    const outcome = await loadDesign(file, glbs, catalog.parts, s.standards, useView.getState().units);
    if (!ticket.current()) {
      if (outcome.part?.modelUrl.startsWith("blob:")) URL.revokeObjectURL(outcome.part.modelUrl);
      return false;
    }
    if (!outcome.part || !outcome.design) {
      console.warn(`Last-opened crate not reopened, opening the default part. ${outcome.message}`);
      return false;
    }
    const { settings, layoutKey, crateIndex, ranking } = outcome.design;
    const plan = planShipment(outcome.part, settings, layoutKey, s.standards, ranking);
    if (!plan.crates[crateIndex]?.result.design) {
      console.warn("Last-opened crate no longer makes a crate, opening the default part.");
      // The part will not be shown, so its object URL would never be released.
      if (outcome.part.modelUrl.startsWith("blob:")) URL.revokeObjectURL(outcome.part.modelUrl);
      return false;
    }
    useDesigner.getState().restoreDesign(outcome.part, settings, layoutKey, crateIndex, ranking);
    useView.getState().setTab(saved.tab);
    // Only what came out differently is worth a line; the crate itself shows it reopened.
    const lead = `Design loaded: ${file.settings.quantity} × ${outcome.part.name}.`;
    const notes = outcome.message.startsWith(lead) ? outcome.message.slice(lead.length).trim() : "";
    if (notes) useView.getState().setLoadMessage(`Reopened. ${notes}`);
    return true;
  } catch (e) {
    console.warn("Last-opened crate not reopened, opening the default part.", e);
    return false;
  }
}

type Watched = Pick<DesignerState, "part" | "settings" | "plan" | "result" | "ranking">;
const changed = (a: Watched, b: Watched) =>
  a.part !== b.part || a.settings !== b.settings || a.result !== b.result || a.plan !== b.plan || a.ranking !== b.ranking;

/**
 * Saves the crate on screen on every change (debounced), and a newly loaded custom part's GLB
 * bytes to IndexedDB. A pending save is written when the page is hidden, so a quick reload keeps
 * the last edit. A state with no crate isn't saved: the last one that had a crate is kept.
 * With `saveNow`, the crate on screen is saved straight away (a share link just opened it).
 * Returns a cleanup function.
 */
export function watchLastDesign({
  saveNow = false,
  storage = browserStorage(),
  idb = browserIdb(),
}: { saveNow?: boolean; storage?: KeyValueStore | null; idb?: IDBFactory | null } = {}) {
  // The last GLB kept, so the same part re-loaded (e.g. its name edited) isn't written again.
  let keptUrl: string | null = null;
  const keepGlb = async (part: LoadedPart) => {
    if (part.modelUrl === keptUrl || !part.model) return;
    keptUrl = part.modelUrl;
    try {
      const bytes = await (await fetch(part.modelUrl)).arrayBuffer();
      const r = await saveLastGlb(part.model, bytes, idb);
      if (r === "too-big") console.warn(`${part.model} is over 50 MB, so it isn't kept for the next visit.`);
    } catch (e) {
      console.warn("Couldn't keep the part's model for the next visit.", e);
    }
  };
  const saver = createDebouncedSaver<LastDesign>((d) => saveLastDesign(d, storage));
  // The crate is the design store's; the tab it was on is the view's. Either changing saves.
  const schedule = () => {
    const d = lastDesignOf(useDesigner.getState(), useView.getState().tab);
    if (d) saver.schedule(d);
  };
  const unsubscribeDesign = useDesigner.subscribe((s, prev) => {
    if (changed(s, prev)) schedule();
    if (s.part !== prev.part && s.part.modelUrl.startsWith("blob:") && designFilePart(s.part).source === "custom") void keepGlb(s.part);
  });
  const unsubscribeView = useView.subscribe((s, prev) => {
    if (s.tab !== prev.tab) schedule();
  });
  if (saveNow) schedule();
  const onHide = () => saver.flush();
  window.addEventListener("pagehide", onHide);
  const onVisibility = () => document.visibilityState === "hidden" && saver.flush();
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    saver.flush();
    unsubscribeDesign();
    unsubscribeView();
    window.removeEventListener("pagehide", onHide);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
