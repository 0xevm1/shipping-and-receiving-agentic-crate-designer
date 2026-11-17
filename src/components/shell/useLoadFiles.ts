"use client";

import { useCallback } from "react";
import { catalog } from "@/domain/catalog";
import { loadPartFiles } from "@/lib/loadPart";
import { useDesigner } from "@/state/store";

/** Load picked or dropped files as the current part, reporting problems in the load row. */
export function useLoadFiles() {
  return useCallback(async (list: FileList | File[]) => {
    const s = useDesigner.getState();
    s.setLoadMessage("");
    try {
      const outcome = await loadPartFiles([...list], [...catalog.parts, ...s.extraParts]);
      if (outcome.catalogAdditions.length) s.addCatalogParts(outcome.catalogAdditions);
      if (outcome.part) s.setPart(outcome.part);
      s.setLoadMessage(outcome.message);
    } catch (err) {
      s.setLoadMessage(err instanceof Error ? err.message : "That file could not be read.");
    }
  }, []);
}
