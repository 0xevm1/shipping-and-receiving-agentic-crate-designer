import type { BufferGeometry, Material, Mesh, Object3D, Texture } from "three";

/**
 * Frees the GPU resources of a loaded model: its geometries, materials and the textures the
 * materials hold. Each is disposed once, however many meshes (or clones) share it. Does not
 * touch the scene graph: the objects can still be read afterwards, and a renderer that draws
 * them again simply uploads them again.
 */
export function disposeScene(root: Object3D): void {
  const done = new Set<{ dispose(): void }>();
  const once = (resource: { dispose(): void }) => {
    if (done.has(resource)) return;
    done.add(resource);
    resource.dispose();
  };
  root.traverse((o) => {
    const mesh = o as Partial<Mesh>;
    if (mesh.geometry) once(mesh.geometry as BufferGeometry);
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials as Material[]) {
      for (const value of Object.values(material)) if ((value as Texture | null)?.isTexture) once(value as Texture);
      once(material);
    }
  });
}
