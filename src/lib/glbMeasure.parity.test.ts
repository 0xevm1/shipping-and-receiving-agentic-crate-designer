// The domain's three-free GLB measure (used by the upload API, #46) against what the browser
// measures with three's GLTFLoader, for every bundled part.
import { readdirSync, readFileSync } from "node:fs";
import { Box3, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { glbSizeUnits } from "@/domain/glb";

describe("glbSizeUnits matches three.js", () => {
  for (const name of readdirSync("public/parts").filter((f) => f.endsWith(".glb"))) {
    it(name, async () => {
      const b = readFileSync(`public/parts/${name}`);
      const buffer = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      const gltf = await new GLTFLoader().parseAsync(buffer, "");
      const size = new Box3().setFromObject(gltf.scene).getSize(new Vector3());
      const ours = glbSizeUnits(new Uint8Array(buffer))!;
      expect(ours[0]).toBeCloseTo(size.x, 9);
      expect(ours[1]).toBeCloseTo(size.y, 9);
      expect(ours[2]).toBeCloseTo(size.z, 9);
    });
  }
});
