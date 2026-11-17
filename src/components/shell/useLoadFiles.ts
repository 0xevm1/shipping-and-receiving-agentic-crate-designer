"use client";

import { useCallback } from "react";
import { catalog } from "@/domain/catalog";
import { loadPartFiles } from "@/lib/loadPart";
import { useDesigner } from "@/state/store";

/**
 * Load picked or dropped files as the current part, or open a saved design (spec §6.4),
 * reporting problems and what changed in the load row.
 */
export function useLoadFiles() {
  return useCallback(async (list: FileList | File[]) => {
    const s = useDesigner.getState();
    s.setLoadMessage("");
    try {
      const outcome = await loadPartFiles([...list], [...catalog.parts, ...s.extraParts]);
      if (outcome.catalogAdditions.length) s.addCatalogParts(outcome.catalogAdditions);
      if (outcome.part && outcome.design) s.loadDesign(outcome.part, outcome.design.settings, outcome.design.layoutKey);
      else if (outcome.part) s.setPart(outcome.part);
      s.setLoadMessage(outcome.message);
    } catch (err) {
      s.setLoadMessage(err instanceof Error ? err.message : "That file could not be read.");
    }
  }, []);
}
