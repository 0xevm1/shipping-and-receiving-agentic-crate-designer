import { parseDesignFile, serializeDesign, type DesignFile } from "@/domain/designFile";
import type { DesignerState } from "@/state/store";
import { designFilePart } from "./loadPart";

/**
 * The design on screen as a #28 design file, exactly as "Download design (.json)" writes it, or
 * null when there is no crate. Used by the design library and share links (#14).
 */
export function currentDesignFile(
  s: Pick<DesignerState, "part" | "settings" | "plan" | "result">,
  savedAt = new Date().toISOString(),
): DesignFile | null {
  const design = s.result.design;
  if (!design) return null;
  const text = serializeDesign({ part: designFilePart(s.part), settings: s.settings, layoutKey: design.layout.key, design, plan: s.plan, savedAt });
  const r = parseDesignFile(text);
  return r.ok ? r.file : null;
}
