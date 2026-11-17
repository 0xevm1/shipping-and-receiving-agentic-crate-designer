import { describe, expect, it } from "vitest";
import { DEFAULT_ORG } from "../db/org";
import { ApiFailure } from "../http";
import { authenticate } from "./authenticate";

const ORG = "11111111-1111-4111-8111-111111111111";
const keys = {
  async verify(key: string) {
    return key === "cdk_good" ? { id: "k1", orgId: ORG, name: "erp", prefix: "cdk_good", createdAt: new Date(), lastUsedAt: null, revokedAt: null } : undefined;
  },
};
const req = (headers: Record<string, string> = {}) => new Request("http://localhost/api/v1/designs", { method: "POST", headers });

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    if (e instanceof ApiFailure) return e.status;
    throw e;
  }
}

describe("authenticate", () => {
  it("an API key gives its org", async () => {
    const r = await authenticate(req({ Authorization: "Bearer cdk_good" }), { keys, requireKeyOutsideUi: true });
    expect(r).toMatchObject({ via: "api-key", keyId: "k1", keyName: "erp" });
    expect(r.org.orgId).toBe(ORG);
  });

  it("refuses an unknown or revoked key, or a malformed header, even from the UI", async () => {
    expect(await status(authenticate(req({ Authorization: "Bearer cdk_bad" }), { keys }))).toBe(401);
    expect(await status(authenticate(req({ Authorization: "Basic abc", "Sec-Fetch-Site": "same-origin" }), { keys }))).toBe(401);
  });

  it("the app's own pages are the default org", async () => {
    const r = await authenticate(req({ "Sec-Fetch-Site": "same-origin" }), { keys, requireKeyOutsideUi: true });
    expect(r).toEqual({ org: DEFAULT_ORG, via: "ui" });
  });

  it("anyone else needs a key where the route asks for one", async () => {
    expect(await status(authenticate(req(), { keys, requireKeyOutsideUi: true }))).toBe(401);
    expect(await status(authenticate(req({ "Sec-Fetch-Site": "cross-site" }), { keys, requireKeyOutsideUi: true }))).toBe(401);
    expect(await authenticate(req(), { keys })).toEqual({ org: DEFAULT_ORG, via: "anonymous" });
  });
});
