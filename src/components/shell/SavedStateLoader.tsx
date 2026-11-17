"use client";

import { useEffect } from "react";
import { loadLastDesign, startupSource } from "@/state/lastDesignStorage";
import { useLibrary } from "@/state/libraryStore";
import { useDesigner } from "@/state/store";
import { restoreLastDesign, watchLastDesign } from "./lastDesignLoader";
import { openShareLink } from "./shareLinkLoader";

/**
 * Applies what this browser saved once the app has mounted: the shop standards, the display
 * units and the design library, then the crate to open (spec §9):
 * 1. a share link in the URL,
 * 2. else the last-opened crate,
 * 3. else the default part.
 * Done in an effect, not in the store's initial state, so the server render and the first client
 * render match (no hydration mismatch). The standards go first, so the crate is rebuilt with them.
 *
 * Time to design starts here for the default part or a share link. A reopened crate keeps
 * the clock stopped (no "Designed in" note) until a new part loads: it isn't newly designed.
 * While the last crate reopens, `restoring` holds the scene back so the default crate doesn't flash.
 */
export function SavedStateLoader() {
  useEffect(() => {
    const s = useDesigner.getState();
    s.loadSavedUnits();
    s.loadSavedStandards();
    useLibrary.getState().load();
    let stopWatching: (() => void) | null = null;
    let cancelled = false;

    const saved = loadLastDesign();
    const source = startupSource(window.location.hash, saved);
    if (source === "last" && saved) s.setRestoring(true);
    void (async () => {
      if (source === "last" && saved) {
        const reopened = await restoreLastDesign(saved);
        if (!reopened) useDesigner.getState().startDesignClock();
        useDesigner.getState().setRestoring(false);
      } else {
        s.startDesignClock();
        await openShareLink(true);
      }
      // Saving starts after the decision, so the default crate never overwrites the saved one.
      if (!cancelled) stopWatching = watchLastDesign({ saveNow: source === "share" });
    })();

    const onHash = () => void openShareLink(false);
    window.addEventListener("hashchange", onHash);
    return () => {
      cancelled = true;
      stopWatching?.();
      window.removeEventListener("hashchange", onHash);
    };
  }, []);
  return null;
}
