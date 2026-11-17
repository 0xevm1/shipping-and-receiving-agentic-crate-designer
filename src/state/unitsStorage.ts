import type { Units } from "@/lib/units";
import { browserStorage, readJson, writeJson, type KeyValueStore } from "./persist";

/** A US shop floor works in inches and pounds; metric is one toggle away. */
export const DEFAULT_UNITS: Units = "imperial";

/**
 * The display units chosen in this browser (spec §9). The key carries a version, like the
 * shop standards, so a future format starts fresh instead of misreading old data. The stored
 * value is the bare word (`metric` / `imperial`), not JSON.
 */
export const UNITS_STORAGE_KEY = "crate-designer.units.v1";

/** The saved units, or null when nothing (or nothing valid) is saved, so the default applies. */
export function loadUnits(storage: KeyValueStore | null = browserStorage()): Units | null {
  return readJson<Units | null>(
    storage,
    UNITS_STORAGE_KEY,
    (text) =>
      text === "metric" || text === "imperial" ? { ok: true, value: text } : { ok: false, error: `"${text}" is not a unit system, using ${DEFAULT_UNITS}.` },
    null,
    "Saved units ignored:",
  );
}

/** Saves the choice, either way, so a later change of default doesn't flip it. False if it isn't stored. */
export function saveUnits(units: Units, storage: KeyValueStore | null = browserStorage()): boolean {
  return writeJson(storage, UNITS_STORAGE_KEY, units, "Couldn't save the units.");
}
