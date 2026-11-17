"use client";

import { catalog } from "@/domain/catalog";
import { readShareHash } from "@/domain/shareLink";
import { useLibrary } from "@/state/libraryStore";
import { useDesigner } from "@/state/store";
import { openDesignFile } from "./useLoadFiles";

/**
 * Opens a share link (#14, spec §9): a design in the URL hash (`#design=…`). Called after the
 * saved standards are applied (so the design is rebuilt with them), and on `hashchange`.
 * - A catalog part opens through the same path as a design file.
 * - A custom part's GLB can't travel in a URL: the message names the file to load, and loading
 *   it opens the design.
 * - A damaged or tampered link changes nothing and says why (on first load, the default crate).
 * The hash is then removed with `replaceState`, so the address bar stays tidy and a reload
 * doesn't re-open the link over later edits.
 */
export async function openShareLink(initial: boolean) {
  const r = readShareHash(window.location.hash);
  if (!r) return;
  history.replaceState(history.state, "", window.location.pathname + window.location.search);
  const s = useDesigner.getState();
  if (!r.ok) {
    const why = r.error.replace(/^This design file/, "This share link");
    s.setLoadMessage(`Share link not opened${initial ? ", so the default crate is shown" : ""}. ${why}`);
    return;
  }
  const file = r.file;
  const inCatalog = file.part.source === "catalog" && catalog.parts.some((p) => p.id === file.part.id);
  if (!inCatalog) {
    useLibrary.getState().setPendingShare(file);
    s.setLoadMessage(
      `This link shares a ${file.settings.quantity} × ${file.part.name} design for a custom part. Load ${file.part.model} with Load a part (or drop it here) to open it.`,
    );
    return;
  }
  await openDesignFile(file);
}
