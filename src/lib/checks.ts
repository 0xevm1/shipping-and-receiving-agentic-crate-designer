import type { Check } from "@/domain/crate";
import { dimsMessage, msg, parts } from "@/domain/message";
import type { Vec3 } from "@/domain/schema";
import type { LoadedPart } from "./part";
import { frameWords } from "./partFrame";

export type CheckItem = Pick<Check, "level" | "title" | "detail"> & { id: string };

/** Measured model size must be within this of the catalog size. */
export const MODEL_TOLERANCE_MM = 1;

const RANK: Record<CheckItem["level"], number> = { caution: 0, ok: 1, info: 2 };

export function modelMatchesCatalog(part: Pick<LoadedPart, "catalogDims">, measured: Vec3 | null): boolean | null {
  if (!measured || !part.catalogDims) return null;
  return measured.every((v, i) => Math.abs(v - part.catalogDims![i]) <= MODEL_TOLERANCE_MM);
}

/**
 * Domain checks plus the ones that depend on the loaded file (model size,
 * missing mass), cautions first.
 */
export function allChecks(
  domain: Check[],
  part: Pick<LoadedPart, "catalogDims" | "massAssumed"> & Partial<Pick<LoadedPart, "modelUnits" | "upAxis" | "unitsGuessed">>,
  measured: Vec3 | null,
): CheckItem[] {
  const items: CheckItem[] = [...domain];
  if (measured) {
    const size = dimsMessage(measured.map((v) => Math.round(v)));
    const match = modelMatchesCatalog(part, measured);
    if (match === null) {
      items.push({
        id: "model",
        level: "info",
        title: "Size comes from the model file",
        detail: msg`Measured ${size}, reading the file as ${frameWords({ units: part.modelUnits ?? "m", up: part.upAxis ?? "z" })}${part.unitsGuessed ? " (the units are a guess from its size)" : ""}. If that is wrong, set the file's units and up axis under the part's size at the top left.`,
      });
    } else if (match) {
      items.push({ id: "model", level: "ok", title: "3D model matches the catalog size", detail: msg`Measured ${size} from the model file.` });
    } else {
      items.push({
        id: "model",
        level: "caution",
        title: "3D model does not match the catalog",
        detail: msg`The model measures ${size}. The catalog says ${dimsMessage(part.catalogDims!)}.`,
      });
    }
  }
  if (part.massAssumed) {
    items.push({
      id: "mass",
      level: "caution",
      title: "Part mass is a stand-in",
      detail: parts("Enter the real mass under the title. Weights and plywood thickness depend on it."),
    });
  }
  return items.sort((a, b) => RANK[a.level] - RANK[b.level]);
}

/** How many of the checks are cautions (the Checks tab badge, and the Export pill's note). */
export const cautionCount = (items: readonly Pick<CheckItem, "level">[]) => items.filter((c) => c.level === "caution").length;
