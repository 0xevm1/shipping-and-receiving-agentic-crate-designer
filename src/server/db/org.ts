/**
 * Org scoping (#46, #60). Every repository call takes an `OrgContext`, and the only ways to get
 * one are `orgContext(id)` (after the caller has authorised the org) and `DEFAULT_ORG`. A plain
 * `{ orgId }` object is not an `OrgContext`, at compile time (the brand) or at run time (the
 * registry), so no query runs for an org nobody vouched for.
 */
declare const orgContextBrand: unique symbol;

export type OrgContext = { readonly orgId: string; readonly [orgContextBrand]: true };

const issued = new WeakSet<object>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Seeded by the first migration (`db/migrations/0001_seed_default_org.sql`). */
export const DEFAULT_ORG_ID = "00000000-0000-4000-8000-000000000001";

export function orgContext(orgId: string): OrgContext {
  if (!UUID.test(orgId)) throw new Error(`Not an org id: ${JSON.stringify(orgId)}`);
  const ctx = Object.freeze({ orgId }) as OrgContext;
  issued.add(ctx);
  return ctx;
}

/** The single org the prototype runs as, until there are accounts. */
export const DEFAULT_ORG: OrgContext = orgContext(DEFAULT_ORG_ID);

export class MissingOrgContextError extends Error {
  constructor() {
    super("Refusing to query without an OrgContext (use orgContext(id) or DEFAULT_ORG).");
    this.name = "MissingOrgContextError";
  }
}

/** Throws unless `ctx` came from `orgContext` / `DEFAULT_ORG`. Returns its org id. */
export function requireOrg(ctx: OrgContext): string {
  if (typeof ctx !== "object" || ctx === null || !issued.has(ctx)) throw new MissingOrgContextError();
  return ctx.orgId;
}
