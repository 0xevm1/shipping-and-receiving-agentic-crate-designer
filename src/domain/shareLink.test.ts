import { describe, expect, it } from "vitest";
import { parts } from "./catalog";
import { computeDesign, DEFAULT_SETTINGS } from "./design";
import { parseDesignFile, serializeDesign, type DesignFile, type DesignFilePart } from "./designFile";
import { base64UrlDecode, base64UrlEncode, readShareHash, SHARE_PARAM, shareHash, shareUrl } from "./shareLink";
import { TEST_APP } from "./testFixtures";

const p = parts.find((x) => x.id === "PART-002")!;
const shaft: DesignFilePart = { source: "catalog", id: p.id, name: p.name, material: p.material, mass_kg: p.mass_kg, dimensions_mm: p.dimensions_mm, model: p.model };

function file(part: DesignFilePart = shaft): DesignFile {
  const settings = { ...DEFAULT_SETTINGS, quantity: 8, maxLayers: 3 };
  const design = computeDesign(part, settings).design!;
  const r = parseDesignFile(serializeDesign({ app: TEST_APP, part, settings, layoutKey: design.layout.key, design, savedAt: "2026-11-16T12:00:00.000Z" }));
  if (!r.ok) throw new Error(r.error);
  return r.file;
}

describe("base64url", () => {
  it.each(["", "a", "ab", "abc", '{"k":"v"}', "Gear housing · 6061-T6 ±0.1 mm — ü ß 漢字"])("round-trips %j", (text) => {
    const enc = base64UrlEncode(text);
    expect(enc).toMatch(/^[A-Za-z0-9_-]*$/);
    expect(base64UrlDecode(enc)).toBe(text);
  });

  it.each(["abc$", "a b", "%7B", "a"])("returns null for %j", (bad) => {
    expect(base64UrlDecode(bad)).toBeNull();
  });
});

describe("share links", () => {
  it("round-trips a design through the URL hash", () => {
    const f = file();
    const hash = shareHash(f);
    expect(hash.startsWith(`#${SHARE_PARAM}=`)).toBe(true);
    // Only URL-safe characters, so nothing needs escaping.
    expect(hash.slice(SHARE_PARAM.length + 2)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(readShareHash(hash)).toEqual({ ok: true, file: f });
    // Without the leading "#" too.
    expect(readShareHash(hash.slice(1))).toEqual({ ok: true, file: f });
  });

  it("round-trips a custom part with non-ASCII text", () => {
    const f = file({ source: "custom", id: "gehäuse", name: "Gehäuse ±", mass_kg: 4, dimensions_mm: [300, 200, 100], model: "gehäuse.glb" });
    expect(readShareHash(shareHash(f))).toEqual({ ok: true, file: f });
  });

  it("builds the full URL in the hash, so the design never reaches a server", () => {
    const url = shareUrl("http://localhost:3000/?x=1#old", file());
    expect(url.startsWith("http://localhost:3000/?x=1#design=")).toBe(true);
    expect(new URL(url).search).toBe("?x=1");
  });

  it.each(["", "#", "#other=1", "#foo"])("ignores a hash without a design (%j)", (hash) => {
    expect(readShareHash(hash)).toBeNull();
  });

  it("rejects a damaged or truncated link", () => {
    const hash = shareHash(file());
    for (const bad of ["#design=", "#design=***", `${hash.slice(0, hash.length / 2)}`]) {
      const r = readShareHash(bad);
      expect(r?.ok).toBe(false);
    }
  });

  it("rejects tampered values through the design file schema", () => {
    const f = file();
    const tampered = (patch: object) => `#design=${base64UrlEncode(JSON.stringify({ ...f, ...patch }))}`;
    const r1 = readShareHash(tampered({ settings: { ...f.settings, quantity: 5000 } }));
    expect(r1).toMatchObject({ ok: false });
    if (r1 && !r1.ok) expect(r1.error).toContain("settings.quantity");
    expect(readShareHash(tampered({ kind: "nope" }))).toMatchObject({ ok: false, error: "This file is not a crate design." });
    expect(readShareHash(tampered({ schemaVersion: 99 }))).toMatchObject({ ok: false });
    expect(readShareHash(`#design=${base64UrlEncode("[1,2]")}`)).toMatchObject({ ok: false });
  });
});
