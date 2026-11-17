import { BoxGeometry, DataTexture, Group, Mesh, MeshStandardMaterial } from "three";
import { describe, expect, it, vi } from "vitest";
import { disposeScene } from "./disposeScene";

describe("disposeScene", () => {
  it("disposes each geometry, material and texture once, however many meshes share them", () => {
    const geometry = new BoxGeometry();
    const map = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    const material = new MeshStandardMaterial({ map });
    const other = new MeshStandardMaterial({ map });
    const spies = [geometry, map, material, other].map((r) => vi.spyOn(r, "dispose"));

    const root = new Group();
    root.add(new Mesh(geometry, material), new Mesh(geometry, [material, other]));
    // A clone shares geometry and material with its source.
    root.add(root.children[0].clone());
    disposeScene(root);

    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it("leaves the scene graph readable", () => {
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(1, 2, 3)));
    disposeScene(root);
    expect(root.children).toHaveLength(1);
    expect((root.children[0] as Mesh).geometry.getAttribute("position")).toBeDefined();
  });
});
