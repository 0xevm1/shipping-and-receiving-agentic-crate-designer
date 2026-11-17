/**
 * The org's shop standards on the server (#46, #19): `GET`/`PUT /api/v1/standards` and the queue's
 * sweeps read them here, so a headless sweep uses the same rates and limits the org stored.
 * Versioned rows in `shop_standard`; none means `DEFAULT_STANDARDS`. docs/API.md "Shop standards"
 * says how this copy relates to the browser's.
 */
import { DEFAULT_STANDARDS, type DeepPartial, mergeStandards, parseStandards, type ShopStandards } from "@/domain/standards";
import { PutStandardsRequestSchema, type StandardsResponse } from "@/lib/api/standards";
import type { OrgContext } from "./db/org";
import type { Repository, ShopStandardRow } from "./db/repository";
import { ApiFailure, readJson } from "./http";

const DEFAULTS: StandardsResponse = { standards: DEFAULT_STANDARDS, version: null, source: "default", updatedAt: null };

/**
 * A stored row as a response. The row is read like a standards file: fields added to the schema
 * after it was stored come from the defaults. A row that still doesn't validate (it can't be
 * written through `PUT`) gives the defaults with a warning, as the browser does with bad storage.
 */
function fromRow(row: ShopStandardRow): StandardsResponse {
  const stored = typeof row.standards === "object" && row.standards !== null ? (row.standards as DeepPartial<ShopStandards>) : {};
  const parsed = parseStandards(mergeStandards(DEFAULT_STANDARDS, stored));
  if (!parsed.ok) {
    console.warn(`shop_standard ${row.id} (version ${row.version}) is invalid, using the defaults: ${parsed.error}`);
    return DEFAULTS;
  }
  return { standards: parsed.standards, version: row.version, source: "org", updatedAt: row.createdAt.toISOString() };
}

/** The org's current standards, or the shipped defaults when it has stored none. */
export async function readOrgStandards(repo: Repository, org: OrgContext): Promise<StandardsResponse> {
  const row = await repo.standards.current(org);
  return row ? fromRow(row) : DEFAULTS;
}

/**
 * `PUT /api/v1/standards`: validates a complete standards object and stores it as the version
 * after `baseVersion`. Emits no event: a running sweep keeps the standards it started with, and
 * the browser keeps its own copy (docs/API.md "Shop standards").
 */
export async function putOrgStandards(request: Request, repo: Repository, org: OrgContext): Promise<StandardsResponse> {
  const body = PutStandardsRequestSchema.safeParse(await readJson(request));
  if (!body.success) {
    const issue = body.error.issues[0];
    throw new ApiFailure(400, "invalid_request", issue?.message ?? "Invalid request.", issue?.path.join("."));
  }
  const parsed = parseStandards(body.data.standards);
  if (!parsed.ok) throw new ApiFailure(400, "invalid_request", parsed.error, parsed.path ? `standards.${parsed.path}` : "standards");
  const row = await repo.standards.put(org, parsed.standards, body.data.baseVersion);
  if (!row) {
    throw new ApiFailure(409, "version_conflict", "Someone else changed the shop standards. Here they are now.", "baseVersion", {
      current: await readOrgStandards(repo, org),
    });
  }
  return fromRow(row);
}
