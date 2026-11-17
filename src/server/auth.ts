/**
 * Who is calling (#46, #60). Route Handlers get their `OrgContext` only from here.
 *
 * - `callerOrg(request)`: the UI's routes. No accounts yet, so every request acts for the default
 *   org; sessions replace this one function later.
 * - `authenticate(request, …)` (#46 slice 7, docs/QUEUE.md "API keys"): for routes scripts call.
 *   - `Authorization: Bearer <key>`: an API key (CLI, ERP, batch scripts). Unknown, malformed or
 *     revoked → 401. The key's org is the context.
 *   - Otherwise, a request from the app's own pages (`Sec-Fetch-Site: same-origin`, which browsers
 *     set and page scripts can't change) is the UI: `DEFAULT_ORG` until there are sessions.
 *   - Otherwise → 401 when the route requires a key (`/designs` does), else `DEFAULT_ORG`.
 *
 * The same-origin marker is routing, not security: a non-browser client can send any header. It
 * keeps scripts on keys from day one; real UI auth (sessions) replaces it later.
 */
import type { ApiKeyStore } from "./db/apiKeys";
import { DEFAULT_ORG, type OrgContext, orgContext } from "./db/org";
import { ApiFailure } from "./http";

export function callerOrg(request: Request): OrgContext {
  void request;
  return DEFAULT_ORG;
}

export type AuthResult = { org: OrgContext; via: "api-key"; keyId: string; keyName: string } | { org: OrgContext; via: "ui" | "anonymous" };

export interface AuthenticateOptions {
  keys: Pick<ApiKeyStore, "verify">;
  /** Refuse callers that are neither the UI nor holding a key. */
  requireKeyOutsideUi?: boolean;
}

/** True for a request from this app's own pages. */
export function isSameOriginUi(request: Request): boolean {
  return request.headers.get("sec-fetch-site") === "same-origin";
}

const unauthorized = (message: string) => new ApiFailure(401, "unauthorized", message);

export async function authenticate(request: Request, { keys, requireKeyOutsideUi = false }: AuthenticateOptions): Promise<AuthResult> {
  const header = request.headers.get("authorization");
  if (header !== null) {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
    if (!match) throw unauthorized("Send the API key as Authorization: Bearer <key>.");
    const key = await keys.verify(match[1]!);
    if (!key) throw unauthorized("That API key isn't valid, or it was revoked.");
    return { org: orgContext(key.orgId), via: "api-key", keyId: key.id, keyName: key.name };
  }
  if (isSameOriginUi(request)) return { org: DEFAULT_ORG, via: "ui" };
  if (requireKeyOutsideUi) throw unauthorized("This endpoint needs an API key: send Authorization: Bearer <key> (bun run apikey:create).");
  return { org: DEFAULT_ORG, via: "anonymous" };
}
