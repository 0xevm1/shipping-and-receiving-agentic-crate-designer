import { describe, expect, it } from "vitest";
import { DEFAULT_ORG, DEFAULT_ORG_ID, MissingOrgContextError, orgContext } from "../db/org";
import { blobConfig, LOCAL_BLOB } from "./config";
import { artifactKey, bundleKey, modelKey, orgKeyPrefix, orgOfKey } from "./keys";

const SHA = "a".repeat(64);

describe("object keys", () => {
  it("follow the issue's layout, scoped by org", () => {
    expect(modelKey(DEFAULT_ORG, SHA)).toBe(`org/${DEFAULT_ORG_ID}/models/${SHA}.glb`);
    expect(artifactKey(DEFAULT_ORG, "f00d", "0.4.1", "spec.pdf")).toBe(`org/${DEFAULT_ORG_ID}/artifacts/f00d/0.4.1/spec.pdf`);
    expect(bundleKey(DEFAULT_ORG, "b-1")).toBe(`org/${DEFAULT_ORG_ID}/bundles/b-1.zip`);
    // The engine's "+" is written as "_" (S3 treats "+" specially).
    expect(artifactKey(DEFAULT_ORG, "f00d", "0.1.0+engine.3", "crate.glb")).toBe(`org/${DEFAULT_ORG_ID}/artifacts/f00d/0.1.0_engine.3/crate.glb`);
    expect(orgKeyPrefix(DEFAULT_ORG)).toBe(`org/${DEFAULT_ORG_ID}/`);
  });

  it("need an OrgContext", () => {
    // @ts-expect-error: a plain object is not an OrgContext.
    expect(() => modelKey({ orgId: DEFAULT_ORG_ID }, SHA)).toThrow(MissingOrgContextError);
  });

  it("refuse anything that could escape its segment", () => {
    expect(() => modelKey(DEFAULT_ORG, "ABC")).toThrow();
    expect(() => modelKey(DEFAULT_ORG, `../${SHA}`)).toThrow();
    expect(() => artifactKey(DEFAULT_ORG, "../x", "1", "crate.glb")).toThrow();
    expect(() => artifactKey(DEFAULT_ORG, "h", "..", "crate.glb")).toThrow();
    // @ts-expect-error: only the three artifact files.
    expect(() => artifactKey(DEFAULT_ORG, "h", "1", "evil.exe")).toThrow();
    expect(() => bundleKey(DEFAULT_ORG, "a/b")).toThrow();
  });

  it("give back the org of a key this app wrote, and nothing for others", () => {
    const other = orgContext("11111111-2222-4333-8444-555555555555");
    expect(orgOfKey(modelKey(other, SHA))?.orgId).toBe(other.orgId);
    expect(orgOfKey("elsewhere/x")).toBeUndefined();
    expect(orgOfKey("org/not-a-uuid/models/x.glb")).toBeUndefined();
  });
});

describe("blobConfig", () => {
  it("defaults to the compose emulator", () => {
    expect(blobConfig({})).toEqual({ ...LOCAL_BLOB, publicEndpoint: LOCAL_BLOB.endpoint, forcePathStyle: true });
  });

  it("reads BLOB_* for a real provider", () => {
    const config = blobConfig({
      BLOB_ENDPOINT: "",
      BLOB_REGION: "eu-west-2",
      BLOB_BUCKET: "crates",
      BLOB_ACCESS_KEY_ID: "AKIA",
      BLOB_SECRET_ACCESS_KEY: "s",
      BLOB_FORCE_PATH_STYLE: "false",
    });
    expect(config).toEqual({
      endpoint: undefined,
      publicEndpoint: undefined,
      region: "eu-west-2",
      bucket: "crates",
      accessKeyId: "AKIA",
      secretAccessKey: "s",
      forcePathStyle: false,
    });
    expect(blobConfig({ BLOB_ENDPOINT: "http://blob:8333", BLOB_PUBLIC_ENDPOINT: "http://localhost:9000" }).publicEndpoint).toBe("http://localhost:9000");
  });
});
