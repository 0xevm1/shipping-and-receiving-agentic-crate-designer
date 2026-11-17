import { describe, expect, it } from "vitest";
import { artifactHref, BundleResponseSchema, bundleHref, parseConfigsParam } from "./artifacts";

const JOB = "5f0c0000-0000-4000-8000-000000000001";
const A = "c1000000-0000-4000-8000-00000000000a";
const B = "c1000000-0000-4000-8000-00000000000b";

describe("artifact links", () => {
  it("links a configuration's file through the API, as a redirect to blob storage by default", () => {
    expect(artifactHref(JOB, A, "crate.glb")).toBe(`/api/v1/jobs/${JOB}/configs/${A}/crate.glb?redirect=1`);
    expect(artifactHref(JOB, A, "spec.pdf", { redirect: false })).toBe(`/api/v1/jobs/${JOB}/configs/${A}/spec.pdf`);
  });

  it("links the job's bundle, every configuration unless some are named", () => {
    expect(bundleHref(JOB)).toBe(`/api/v1/jobs/${JOB}/bundle.zip?redirect=1`);
    expect(bundleHref(JOB, [A, B], { redirect: false })).toBe(`/api/v1/jobs/${JOB}/bundle.zip?configs=${A},${B}`);
  });

  it("reads ?configs= as a list in order, comma-separated or repeated, duplicates once", () => {
    expect(parseConfigsParam(new URLSearchParams(`configs=${B},${A}&configs=${B}`))).toEqual([B, A]);
    expect(parseConfigsParam(new URLSearchParams("configs=%20,"))).toEqual([]);
    expect(parseConfigsParam(new URLSearchParams(""))).toEqual([]);
    // The link's own query reads back as the same list.
    expect(parseConfigsParam(new URL(bundleHref(JOB, [A, B]), "http://x").searchParams)).toEqual([A, B]);
  });

  it("tells a ready bundle from a queued one", () => {
    const queued = BundleResponseSchema.parse({ status: "queued", bundleId: "abc-0.1.0_engine.3", configurationIds: [A], queueJobId: B });
    expect(queued.status).toBe("queued");
    expect(() => BundleResponseSchema.parse({ status: "ready", bundleId: "x", configurationIds: [A] })).toThrow();
  });
});
