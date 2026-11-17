"use client";

import { useEffect } from "react";
import { watchLastDesign } from "@/state/lastDesignLoader";
import { openShareLink } from "@/state/shareLink";
import { startSavedState } from "@/state/startup";

/**
 * Applies what this browser saved once the app has mounted (`startSavedState`, spec §9), then
 * keeps saving the crate on screen and follows share links pasted into the address bar.
 * Done in an effect, not in the store's initial state, so the server render and the first client
 * render match (no hydration mismatch).
 */
export function SavedStateLoader() {
  useEffect(() => {
    let stopWatching: (() => void) | null = null;
    let cancelled = false;

    // The startup runs once per page load even when StrictMode mounts this twice; only the
    // watcher belongs to a mount, and starts after the decision so the default crate never
    // overwrites the saved one.
    void startSavedState().then((source) => {
      if (!cancelled) stopWatching = watchLastDesign({ saveNow: source === "share" });
    });

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
