import { describe, expect, it } from "vitest";
import { buildBom, tellApart } from "./bom";
import type { Member } from "./members";

const block = (length: number, variant?: Member["variant"]): Member => ({
  kind: "blocking",
  material: "lumber",
  assembly: "inside",
  face: "inside",
  label: variant ? "Shaped block" : "Blocking post",
  ...(variant && { variant }),
  bomKey: "",
  min: [0, 0, 0],
  size: [89, 38, length],
});

describe("buildBom: pieces that share a name", () => {
  it("lettered by size, largest cut first, when a crate has several sizes of one piece", () => {
    const members = [block(60, "shaped-block"), block(120, "shaped-block"), block(120, "shaped-block"), block(300)];
    const lines = buildBom(members);
    expect(lines.map((l) => [l.label, l.qty])).toEqual([
      ["Shaped block B", 1],
      ["Shaped block A", 2],
      ["Blocking post", 1],
    ]);
    // Only the line's display label changes: the boards keep their name and variant.
    expect(members.filter((m) => m.label === "Shaped block")).toHaveLength(3);
    expect(lines.every((l) => l.name === (l.label.startsWith("Shaped") ? "Shaped block" : "Blocking post"))).toBe(true);
  });

  it("leaves ordinary pieces of different sizes under one name", () => {
    expect(buildBom([block(300), block(200)]).map((l) => l.label)).toEqual(["Blocking post", "Blocking post"]);
  });

  it("leaves a lone piece's name alone", () => {
    expect(buildBom([block(60, "shaped-block")])[0].label).toBe("Shaped block");
  });

  it("starts again on merged lines, so a shipment's sizes are lettered together", () => {
    const [a] = buildBom([block(60, "shaped-block")]);
    const [b] = buildBom([block(120, "shaped-block")]);
    expect(a.label).toBe("Shaped block");
    const merged = tellApart([{ ...a }, { ...b }]);
    expect(merged.map((l) => l.label)).toEqual(["Shaped block B", "Shaped block A"]);
  });
});
