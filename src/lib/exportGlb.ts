import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Scene, Vector3, type Object3D } from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { cradleGeometry } from "@/components/viewer/cradleGeometry";
import { cloneWithMaterial, partMaterial, WOOD } from "@/components/viewer/scene";
import { ASSEMBLIES, type CrateDesign, type MemberKind } from "@/domain/crate";
import { ASSEMBLY_NAMES } from "@/domain/export";
import { partFinish } from "@/domain/partDetails";

/**
 * The assembled crate as a GLB (#27), for customers' and engineering's own 3D tools.
 *
 * Built fresh from the design data, never from the live viewer scene, so exploded offsets,
 * fades, ghosting and highlights can't leak into the file. The file follows the input GLB
 * convention (spec §4): metres, Z up. The only conversion is mm → m (× 0.001), baked into
 * positions and board sizes; there is no Y-up rotation.
 *
 * Node tree:
 *   Crate
 *   ├─ Base / Side walls / End walls / Lid / Inside the crate   (one mesh per board, "Side rail 3")
 *   └─ Parts                                                     ("Part 1" … "Part N", optional)
 */

const M_PER_MM = 0.001;
export const CRATE_NODE = "Crate";
export const PARTS_NODE = "Parts";

/** A loaded part model and how to scale it, as `PartInstances` uses it. */
export interface PartModel {
  scene: Object3D;
  /** Millimetres per model unit (1000 for metre files). */
  mmPerUnit: number;
  material?: string;
}

/** One named material per kind of board, coloured as in the viewer. */
function woodMaterials(): Record<MemberKind, MeshStandardMaterial> {
  const entries = Object.entries(WOOD).map(([kind, color]) => {
    const m = new MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
    m.name = `Wood ${kind}`;
    return [kind, m] as const;
  });
  return Object.fromEntries(entries) as Record<MemberKind, MeshStandardMaterial>;
}

/** The export scene: assembled crate in metres, Z up, optionally with the parts in their slots. */
export function buildCrateScene(design: CrateDesign, part?: PartModel | null): Scene {
  const scene = new Scene();
  const crate = new Group();
  crate.name = CRATE_NODE;
  scene.add(crate);

  const materials = woodMaterials();
  const counts = new Map<string, number>();
  for (const assembly of ASSEMBLIES) {
    const members = design.members.filter((m) => m.assembly === assembly);
    if (!members.length) continue;
    const group = new Group();
    group.name = ASSEMBLY_NAMES[assembly];
    crate.add(group);
    for (const m of members) {
      const n = (counts.get(m.label) ?? 0) + 1;
      counts.set(m.label, n);
      const [sx, sy, sz] = m.size;
      // Cradles keep their notches (#6): the viewer's solid, scaled to metres.
      const geometry = m.cradle ? cradleGeometry(m).scale(M_PER_MM, M_PER_MM, M_PER_MM) : new BoxGeometry(sx * M_PER_MM, sy * M_PER_MM, sz * M_PER_MM);
      const mesh = new Mesh(geometry, materials[m.kind]);
      mesh.name = `${m.label} ${n}`;
      mesh.position.set((m.min[0] + sx / 2) * M_PER_MM, (m.min[1] + sy / 2) * M_PER_MM, (m.min[2] + sz / 2) * M_PER_MM);
      group.add(mesh);
    }
  }

  if (part) crate.add(partsGroup(design, part));
  return scene;
}

/** A copy of the part per slot, with the same transform as `PartInstances` (in metres). */
function partsGroup(design: CrateDesign, part: PartModel): Group {
  const { layout } = design;
  const center = new Box3().setFromObject(part.scene).getCenter(new Vector3());
  const material = partMaterial(part.material);
  material.name = `Part ${partFinish(part.material)}`;
  const [a, b, c] = layout.cellSize;

  const group = new Group();
  group.name = PARTS_NODE;
  layout.slots.forEach((slot, i) => {
    const placed = new Group();
    placed.name = `Part ${i + 1}`;
    placed.position.set((slot.min[0] + a / 2) * M_PER_MM, (slot.min[1] + b / 2) * M_PER_MM, (slot.min[2] + c / 2) * M_PER_MM);
    placed.rotation.set(...layout.orientation.euler);
    const scaled = new Group();
    scaled.scale.setScalar(part.mmPerUnit * M_PER_MM);
    const copy = cloneWithMaterial(part.scene, material);
    copy.position.copy(center).negate();
    scaled.add(copy);
    placed.add(scaled);
    group.add(placed);
  });
  return group;
}

/** The scene as binary glTF. */
export async function exportCrateGlb(design: CrateDesign, part?: PartModel | null): Promise<ArrayBuffer> {
  const scene = buildCrateScene(design, part);
  const result = await new GLTFExporter().parseAsync(scene, { binary: true });
  if (!(result instanceof ArrayBuffer)) throw new Error("GLTFExporter did not return binary data.");
  return result;
}

const partScenes = new Map<string, Promise<Object3D>>();

/** The part's model, loaded once per URL (the viewer has usually fetched it already, so this hits the cache). */
export function loadPartScene(url: string): Promise<Object3D> {
  let p = partScenes.get(url);
  if (!p) {
    p = new GLTFLoader().loadAsync(url).then((g) => g.scene);
    p.catch(() => partScenes.delete(url));
    partScenes.set(url, p);
  }
  return p;
}

/** "crate-PART-001-x4.glb", matching the cut-list CSV name. */
export function glbFileName(partId: string, quantity: number): string {
  return `crate-${partId}-x${quantity}.glb`;
}

export function downloadBytes(filename: string, data: ArrayBuffer, type = "model/gltf-binary") {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been handled, so the download has the data.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
