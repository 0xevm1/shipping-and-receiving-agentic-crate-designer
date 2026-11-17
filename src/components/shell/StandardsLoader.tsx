"use client";

import { useEffect } from "react";
import { useDesigner } from "@/state/store";

/**
 * Applies the shop standards saved in this browser once the app has mounted. Done in an
 * effect, not in the store's initial state, so the server render and the first client
 * render match (no hydration mismatch); the design then updates to the saved standards.
 */
export function StandardsLoader() {
  useEffect(() => {
    useDesigner.getState().loadSavedStandards();
  }, []);
  return null;
}
