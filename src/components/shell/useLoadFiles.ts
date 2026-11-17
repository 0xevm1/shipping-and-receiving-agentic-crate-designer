"use client";

import { useCallback } from "react";
import { catalog } from "@/domain/catalog";
import type { DesignFile } from "@/domain/designFile";
import { loadDesign, loadPartFiles, type LoadOutcome } from "@/lib/loadPart";
import { useLibrary } from "@/state/libraryStore";
import { useDesigner } from "@/state/store";

/** Puts a load's part (and a design's rules and layout) on screen, with its message. */
function applyOutcome(outcome: Omit<LoadOutcome, "catalogAdditions"> & { catalogAdditions?: LoadOutcome["catalogAdditions"] }) {
  const s = useDesigner.getState();
  if (outcome.catalogAdditions?.length) s.addCatalogParts(outcome.catalogAdditions);
  if (outcome.part && outcome.design) {
    const { settings, layoutKey, crateIndex, ranking } = outcome.design;
    // The ranking is part of the design: set first, so the layout is planned and explained under it.
    if (ranking !== s.ranking) s.setRanking(ranking);
    s.loadDesign(outcome.part, settings, layoutKey, crateIndex);
  } else if (outcome.part) s.setPart(outcome.part);
  s.setLoadMessage(outcome.message);
}

const failed = (err: unknown) => useDesigner.getState().setLoadMessage(err instanceof Error ? err.message : "That file could not be read.");

/**
 * Opens a parsed design file (spec §6.5): the same path as a design file picked or dropped, used
 * by the design library and share links. A custom part's GLB goes in `glbs`.
 */
export async function openDesignFile(file: DesignFile, glbs: File[] = []) {
  const s = useDesigner.getState();
  s.setLoadMessage("");
  try {
    applyOutcome(await loadDesign(file, glbs, catalog.parts, s.standards, s.units));
  } catch (err) {
    failed(err);
  }
}

/**
 * Load picked or dropped files as the current part, or open a saved design (spec §6.4),
 * reporting problems and what changed in the load row. A shared custom-part design waiting for
 * its model opens when a GLB with that file name is loaded.
 */
export function useLoadFiles() {
  return useCallback(async (list: FileList | File[]) => {
    const s = useDesigner.getState();
    s.setLoadMessage("");
    const files = [...list];
    const pending = useLibrary.getState().pendingShare;
    if (pending && !files.some((f) => /\.json$/i.test(f.name)) && files.some((f) => f.name === pending.part.model)) {
      files.push(new File([JSON.stringify(pending)], "shared-design.json", { type: "application/json" }));
      useLibrary.getState().setPendingShare(null);
    }
    try {
      applyOutcome(await loadPartFiles(files, [...catalog.parts, ...s.extraParts], catalog.parts, s.standards, s.units));
    } catch (err) {
      failed(err);
    }
  }, []);
}
