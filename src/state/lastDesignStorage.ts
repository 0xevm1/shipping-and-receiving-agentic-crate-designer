import { RANKINGS, type Ranking } from "@/domain/design";
import { parseDesignFile, type DesignFile } from "@/domain/designFile";
import { readShareHash } from "@/domain/shareLink";
import { browserStorage, readJson, writeJson, type KeyValueStore } from "./persist";
import type { Tab } from "./store";

/**
 * The last-opened crate (spec §9): the design on screen, saved so a reload or a reopened
 * tab brings it back. The design is a design file (§6.5), so it goes through the same
 * versions, migrations and validation as a picked file; the tab and the ranking ride along.
 * A custom part's GLB bytes are kept separately, in IndexedDB (`glbCache.ts`).
 */
const LAST_DESIGN_KIND = "crate-designer.last-design";
const LAST_DESIGN_VERSION = 1;
export const LAST_DESIGN_STORAGE_KEY = `crate-designer.last-design.v${LAST_DESIGN_VERSION}`;
/** Edits are written this long after they stop, so typing in a field doesn't write on every key. */
export const LAST_DESIGN_SAVE_DELAY_MS = 400;

const TABS: readonly Tab[] = ["overview", "layouts", "cut", "rules", "checks"];

export interface LastDesign {
  design: DesignFile;
  tab: Tab;
  ranking: Ranking;
}

export function lastDesignToJson({ design, tab, ranking }: LastDesign): string {
  return JSON.stringify({ kind: LAST_DESIGN_KIND, version: LAST_DESIGN_VERSION, tab, ranking, design });
}

/** Reads a saved entry: the envelope, then the design through `parseDesignFile`. Never throws. */
export function parseLastDesign(text: string): { ok: true; value: LastDesign } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "It is not valid JSON." };
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return { ok: false, error: "It is not an object." };
  const o = json as Record<string, unknown>;
  if (o.kind !== LAST_DESIGN_KIND) return { ok: false, error: "It has the wrong kind." };
  if (o.version !== LAST_DESIGN_VERSION) return { ok: false, error: `Version ${String(o.version)} is not ${LAST_DESIGN_VERSION}.` };
  if (!TABS.includes(o.tab as Tab)) return { ok: false, error: `Unknown tab ${String(o.tab)}.` };
  if (!RANKINGS.includes(o.ranking as Ranking)) return { ok: false, error: `Unknown ranking ${String(o.ranking)}.` };
  if (typeof o.design !== "object" || o.design === null) return { ok: false, error: "It has no design." };
  const r = parseDesignFile(JSON.stringify(o.design));
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, value: { design: r.file, tab: o.tab as Tab, ranking: o.ranking as Ranking } };
}

/** The saved entry, or null. Bad or old data is ignored with a `console.warn`. */
export function loadLastDesign(storage: KeyValueStore | null = browserStorage()): LastDesign | null {
  return readJson<LastDesign | null>(storage, LAST_DESIGN_STORAGE_KEY, parseLastDesign, null, "Last-opened crate ignored, opening the default part.");
}

/** Saves the entry. False when storage is missing or refused it (e.g. quota); never throws. */
export function saveLastDesign(d: LastDesign, storage: KeyValueStore | null = browserStorage()): boolean {
  return writeJson(storage, LAST_DESIGN_STORAGE_KEY, lastDesignToJson(d), "Couldn't save the last-opened crate.");
}

/**
 * What opens on load (spec §9): a share link in the URL wins (even a damaged one, which then
 * says why the default crate is shown), else the last-opened crate, else the default part.
 */
export function startupSource(hash: string, saved: LastDesign | null): "share" | "last" | "default" {
  if (readShareHash(hash)) return "share";
  return saved ? "last" : "default";
}

/** Calls `save` with the latest scheduled value once `delayMs` passes without another. */
export function createDebouncedSaver<T>(save: (value: T) => void, delayMs = LAST_DESIGN_SAVE_DELAY_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { value: T } | null = null;
  const flush = () => {
    clearTimeout(timer);
    const p = pending;
    pending = null;
    if (p) save(p.value);
  };
  return {
    schedule(value: T) {
      pending = { value };
      clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    /** Writes a pending value now (e.g. when the page is hidden or unloaded). */
    flush,
    cancel() {
      clearTimeout(timer);
      pending = null;
    },
  };
}
