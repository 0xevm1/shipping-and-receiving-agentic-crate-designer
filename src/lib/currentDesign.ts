import type { DesignResult, Ranking } from "@/domain/design";
import { parseDesignFile, serializeDesign, type DesignFile } from "@/domain/designFile";
import type { CrateSettings } from "@/domain/schema";
import type { ShipmentPlan, TotalSplit } from "@/domain/shipment";
import { APP } from "./appInfo";
import { designFilePart } from "./loadPart";
import type { LoadedPart } from "./part";

/** The slice of the designer's state a design file is written from (the store's state satisfies it). */
export interface Current {
  part: LoadedPart;
  settings: CrateSettings;
  plan: ShipmentPlan;
  result: DesignResult;
  ranking: Ranking;
  /** The job's total quantity when `plan` is its shipment (#140); the file then records it. */
  total?: TotalSplit | null;
}

/**
 * The design on screen as design-file text, exactly as "Download design (.json)" writes it, or
 * null when there is no crate. Carries the part's measured outline and the ranking, so the file
 * rebuilds the same crate wherever it is opened.
 */
export function currentDesignText(s: Current, savedAt = new Date().toISOString()): string | null {
  const design = s.result.design;
  if (!design) return null;
  return serializeDesign({
    part: designFilePart(s.part),
    settings: s.settings,
    layoutKey: design.layout.key,
    ranking: s.ranking,
    design,
    plan: s.plan,
    ...(s.total ? { total: s.total } : {}),
    app: APP,
    savedAt,
  });
}

/** The design on screen as a parsed design file. Used by the design library and share links. */
export function currentDesignFile(s: Current, savedAt = new Date().toISOString()): DesignFile | null {
  const text = currentDesignText(s, savedAt);
  if (text === null) return null;
  const r = parseDesignFile(text);
  return r.ok ? r.file : null;
}
