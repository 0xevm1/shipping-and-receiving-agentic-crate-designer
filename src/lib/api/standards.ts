/**
 * Request and response shapes for `/api/v1/standards` (#46, #19): the org's shop rates and limits.
 * Pure Zod over the domain's `ShopStandardsSchema`, shared by the Route Handler and any client;
 * docs/API.md "Shop standards" is the reference.
 *
 *   GET /api/v1/standards   the org's current standards (the shipped defaults when it has none)
 *   PUT /api/v1/standards   store a new version, optimistic on `baseVersion`
 */
import { z } from "zod";
import { ShopStandardsSchema } from "@/domain/standards";

const STANDARDS_SOURCES = ["org", "default"] as const;

export const StandardsResponseSchema = z.object({
  standards: ShopStandardsSchema,
  /** The stored version (1, 2, …); null while the org runs on the shipped defaults. Send it back as `baseVersion`. */
  version: z.int().positive().nullable(),
  /** `org`: a stored version; `default`: the org has none, so these are `DEFAULT_STANDARDS`. */
  source: z.enum(STANDARDS_SOURCES),
  /** When the version was stored; null for the defaults. */
  updatedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type StandardsResponse = z.infer<typeof StandardsResponseSchema>;

/**
 * `PUT /api/v1/standards`: a complete standards object (validated like an imported standards file,
 * without filling gaps from the defaults) and the version it was based on (null when the GET said
 * `default`). A stale `baseVersion` gets 409 `version_conflict` with the current standards.
 */
export const PutStandardsRequestSchema = z.object({
  standards: z.unknown(),
  baseVersion: z.int().positive().nullable(),
});
export type PutStandardsRequest = z.infer<typeof PutStandardsRequestSchema>;
