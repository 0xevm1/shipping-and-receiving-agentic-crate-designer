/**
 * Who is calling (#46, #60). There are no accounts yet, so every request acts for the default
 * org. Route Handlers get their `OrgContext` only from here, so adding auth (a session, an API
 * key) is a change to this one function: resolve the caller, check they may act for the org,
 * then `orgContext(id)`.
 */
import { DEFAULT_ORG, type OrgContext } from "./db/org";

export function callerOrg(request: Request): OrgContext {
  void request;
  return DEFAULT_ORG;
}
