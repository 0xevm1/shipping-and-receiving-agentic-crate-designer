import type { DesignPart } from "@/domain/schema";
import { planShipment, type ShipmentPlan } from "@/domain/shipment";
import { candidateQuantities } from "@/domain/sweep";
import { bomToCsv, shipmentToCsv } from "@/lib/csv";
import { cutListFileName } from "@/lib/fileNames";
import { metricText } from "@/lib/message";
import { canonicalJson } from "./canonical";
import type { CutListRequest, CutListResponse, DesignRequest, DesignResponse, DesignSummary, EngineStamp } from "./schemas";
import { sha256Text } from "./sha256";
import { ENGINE_VERSION } from "./version";

/**
 * The crate engine (spec §5.1): the domain's rules plus the file builders, behind one set
 * of calls that run the same in a browser tab, a Web Worker and Node. Everything here is pure
 * and synchronous; the GLB, PDF and ZIP builders are async and loaded on demand
 * (`./glb`, `./files`).
 */

/** Bumped when the shape of the hashed input changes, so old and new hashes never collide. */
const INPUT_HASH_SCHEMA = 1;

/** The fields of a part the engine designs from; a loaded part's model URL, file name and load facts are not inputs. */
export const designPartOf = (p: DesignPart): DesignPart => ({
  id: p.id,
  name: p.name,
  mass_kg: p.mass_kg,
  dimensions_mm: p.dimensions_mm,
  material: p.material,
  profile: p.profile,
  // The suggested quantities choose the sweep's recommendation (#133), so they travel with the part
  // and are hashed with it: the server's sweep and the PDF's quantity rationale read them.
  ...(p.suggested_quantities ? { suggested_quantities: candidateQuantities(p.suggested_quantities) } : {}),
});

/**
 * SHA-256 of the canonical design request (spec §5.1): part (design fields only), settings
 * (which hold the quantity), standards, layout pick and ranking. Two requests with equal
 * values hash the same in every runtime, whatever order their keys were set in.
 */
export function inputHash(req: DesignRequest): string {
  const { part, settings, standards, layoutKey, ranking } = req;
  return sha256Text(canonicalJson({ v: INPUT_HASH_SCHEMA, part: designPartOf(part), settings, standards, layoutKey: layoutKey ?? null, ranking }));
}

/** The stamp every engine output carries. */
export const stamp = (req: DesignRequest): EngineStamp => ({ engineVersion: ENGINE_VERSION, inputHash: inputHash(req) });

/** The plan's headline numbers: outside size, weights, screws and cost per crate type, and the totals. */
export function summarize(plan: ShipmentPlan): DesignSummary {
  const { totals } = plan;
  return {
    quantity: totals.parts,
    split: plan.split,
    crates: plan.crates.map(({ label, count, quantity, result: { design } }) => ({
      label,
      count,
      quantity,
      layoutKey: design?.layout.key ?? null,
      outsideMm: design ? [...design.layout.external] : null,
      grossKg: design?.grossKg ?? null,
      tareKg: design?.tareKg ?? null,
      screws: design?.screws ?? null,
      costUsd: design?.cost.totalUsd ?? null,
    })),
    totals: { crates: totals.crates, parts: totals.parts, grossKg: totals.grossKg, tareKg: totals.tareKg, volumeM3: totals.volumeM3, costUsd: totals.costUsd },
    // The problem's detail carries its sizes as data (spec §7); the summary is mm and kg, like the API.
    problem: plan.problem ? { id: plan.problem.id, title: plan.problem.title, detail: metricText(plan.problem.detail) } : null,
  };
}

/** One design: how the batch ships (`planShipment`), its summary, and the stamp. Never throws for valid input. */
export function designShipment(req: DesignRequest): DesignResponse {
  const plan = planShipment(req.part, req.settings, req.layoutKey, req.standards, req.ranking);
  return { ...stamp(req), summary: summarize(plan), plan };
}

/**
 * The cut list CSV, exactly as the Cut list tab downloads it: the crate type at `crateIndex`, or
 * every crate of a split batch with `scope: "shipment"`. Throws when there is no crate.
 */
export function cutList(req: CutListRequest, plan: ShipmentPlan = designShipment(req).plan): CutListResponse {
  const crateType = plan.crates[req.crateIndex] ?? plan.crates[0];
  const design = crateType?.result.design;
  if (!design) throw new Error(plan.problem ? `${plan.problem.title}. ${plan.problem.detail}` : "There is no crate to list.");
  const whole = plan.split && req.scope === "shipment";
  const csv = whole ? shipmentToCsv(req.part, plan, req.units) : bomToCsv(req.part, design, req.units);
  const fileName = cutListFileName({ partId: req.part.id, quantity: req.settings.quantity, split: plan.split, whole, crateLabel: crateType.label });
  return { ...stamp(req), fileName, csv };
}
