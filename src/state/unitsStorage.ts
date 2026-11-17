import type { Units } from "@/lib/units";
import { browserStorage, type KeyValueStore } from "./standardsStorage";

/** A US shop floor works in inches and pounds (#15); metric is one toggle away. */
export const DEFAULT_UNITS: Units = "imperial";

/**
 * The display units chosen in this browser (spec §9). The key carries a version, like the
 * shop standards, so a future format starts fresh instead of misreading old data.
 */
export const UNITS_STORAGE_KEY = "crate-designer.units.v1";

const isUnits = (v: string): v is Units => v === "metric" || v === "imperial";

/** The saved units, or null when nothing (or nothing valid) is saved, so the default applies. */
export function loadUnits(storage: KeyValueStore | null = browserStorage()): Units | null {
  let text: string | null = null;
  try {
    text = storage?.getItem(UNITS_STORAGE_KEY) ?? null;
  } catch {
    // Treated as nothing saved.
  }
  if (text === null) return null;
  if (isUnits(text)) return text;
  console.warn(`Saved units "${text}" ignored, using ${DEFAULT_UNITS}.`);
  return null;
}

/** Saves the choice, either way, so a later change of default doesn't flip it. */
export function saveUnits(units: Units, storage: KeyValueStore | null = browserStorage()) {
  try {
    storage?.setItem(UNITS_STORAGE_KEY, units);
  } catch (e) {
    console.warn("Couldn't save the units.", e);
  }
}
