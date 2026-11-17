import type { Check } from "@/domain/crate";
import { dimsMessage, msg, parts } from "@/domain/message";
import type { Vec3 } from "@/domain/schema";
import { countsText } from "./fileCheckReport";
import { massWarning, sizeMatches, type Finding } from "./fileCheck";
import type { LoadedPart } from "./part";
import { frameWords } from "./partFrame";

export type CheckItem = Pick<Check, "level" | "title" | "detail"> & { id: string };

const RANK: Record<CheckItem["level"], number> = { caution: 0, ok: 1, info: 2 };

export function modelMatchesCatalog(part: Pick<LoadedPart, "catalogDims">, measured: Vec3 | null): boolean | null {
  if (!measured || !part.catalogDims) return null;
  // The same tolerance the file check uses, so the report and this check agree.
  return sizeMatches(measured, part.catalogDims);
}

/**
 * Domain checks plus the ones that depend on the loaded file (model size, missing or
 * implausible mass, and one that points to the File check report when the load had problems),
 * cautions first. `fileFindings` is the last load's file check (`FileReport.findings`).
 */
export function allChecks(
  domain: Check[],
  part: Pick<LoadedPart, "catalogDims" | "massAssumed"> & Partial<Pick<LoadedPart, "modelUnits" | "upAxis" | "unitsGuessed" | "mass_kg">>,
  measured: Vec3 | null,
  fileFindings: readonly Finding[] = [],
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
  const warning = part.mass_kg === undefined ? null : massWarning(part.mass_kg);
  if (warning)
    items.push({
      id: "mass-implausible",
      level: "caution",
      title: "Part mass looks wrong",
      detail: parts(warning, " The weights, cost and freight figures all follow from it."),
    });
  const problems = fileFindings.filter((f) => f.severity !== "note");
  if (problems.length) {
    items.push({
      id: "file-check",
      level: "caution",
      title: "The files had problems",
      detail: parts(`The file check found ${countsText(problems)}. Open File check, by Load a part, to read what is wrong and what to do.`),
    });
  }
  return items.sort((a, b) => RANK[a.level] - RANK[b.level]);
}

/** How many of the checks are cautions (the Checks tab badge, and the Export pill's note). */
export const cautionCount = (items: readonly Pick<CheckItem, "level">[]) => items.filter((c) => c.level === "caution").length;
