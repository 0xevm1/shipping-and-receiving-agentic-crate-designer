"use client";

import { useEffect } from "react";
import { useDesigner } from "@/state/store";

/**
 * Applies what this browser saved (the shop standards and the display units) once the app has
 * mounted. Done in an effect, not in the store's initial state, so the server render and the
 * first client render match (no hydration mismatch); the design and text then update.
 */
export function SavedStateLoader() {
  useEffect(() => {
    const s = useDesigner.getState();
    s.loadSavedUnits();
    s.loadSavedStandards();
  }, []);
  return null;
}
