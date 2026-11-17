"use client";

import { useEffect } from "react";
import { useLibrary } from "@/state/libraryStore";
import { useDesigner } from "@/state/store";
import { openShareLink } from "./shareLinkLoader";

/**
 * Applies what this browser saved (the shop standards, the display units and the design
 * library) once the app has mounted, starts the time-to-design clock (#17), then opens a share
 * link in the URL, if any (#14). Done in an effect, not in the store's initial state, so the
 * server render and the first client render match (no hydration mismatch); the design and text
 * then update. The standards go first, so a shared design is rebuilt with them.
 */
export function SavedStateLoader() {
  useEffect(() => {
    const s = useDesigner.getState();
    s.loadSavedUnits();
    s.loadSavedStandards();
    // Time to design (#17) runs from here for the preloaded part; opening a share link restarts it.
    s.startDesignClock();
    useLibrary.getState().load();
    void openShareLink(true);
    const onHash = () => void openShareLink(false);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return null;
}
