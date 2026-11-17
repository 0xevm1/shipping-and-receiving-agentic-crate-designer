import type { Check } from "@/domain/crate";
import type { Vec3 } from "@/domain/schema";
import type { LoadedPart } from "./store";

export type CheckItem = Pick<Check, "level" | "title" | "detail"> & { id: string };

/** Measured model size must be within this of the catalog size. */
export const MODEL_TOLERANCE_MM = 1;

const RANK: Record<CheckItem["level"], number> = { caution: 0, ok: 1, info: 2 };

export function modelMatchesCatalog(part: LoadedPart, measured: Vec3 | null): boolean | null {
  if (!measured || !part.catalogDims) return null;
  return measured.every((v, i) => Math.abs(v - part.catalogDims![i]) <= MODEL_TOLERANCE_MM);
}

/**
 * Domain checks plus the ones that depend on the loaded file (model size,
 * missing mass), cautions first.
 */
export function allChecks(domain: Check[], part: LoadedPart, measured: Vec3 | null): CheckItem[] {
  const items: CheckItem[] = [...domain];
  if (measured) {
    const size = measured.map((v) => Math.round(v)).join(" × ");
    const match = modelMatchesCatalog(part, measured);
    if (match === null) {
      items.push({
        id: "model",
        level: "info",
        title: "Size comes from the model file",
        detail: `Measured ${size} mm${part.readAsMm ? ", reading the file as millimetres" : ""}. The model is assumed to have Z pointing up.`,
      });
    } else if (match) {
      items.push({ id: "model", level: "ok", title: "3D model matches the catalog size", detail: `Measured ${size} mm from the model file.` });
    } else {
      items.push({
        id: "model",
        level: "caution",
        title: "3D model does not match the catalog",
        detail: `The model measures ${size} mm. The catalog says ${part.catalogDims!.join(" × ")} mm.`,
      });
    }
  }
  if (part.massAssumed) {
    items.push({
      id: "mass",
      level: "caution",
      title: "Part mass is a stand-in",
      detail: "Enter the real mass under the title. Weights and plywood thickness depend on it.",
    });
  }
  return items.sort((a, b) => RANK[a.level] - RANK[b.level]);
}
