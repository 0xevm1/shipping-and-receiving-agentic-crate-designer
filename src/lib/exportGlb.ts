import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Scene, Vector3, type Object3D } from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ASSEMBLY_NAMES } from "@/domain/crate";
import { ASSEMBLIES, type CrateDesign, type MemberKind } from "@/domain/crate";
import { partFinish } from "@/domain/partDetails";
import type { Vec3 } from "@/domain/schema";
import { cradleGeometry } from "./cradleGeometry";
import { cloneWithMaterial, partMaterial, WOOD } from "./sceneMaterials";

/**
 * The assembled crate as a GLB, for customers' and engineering's own 3D tools.
 *
 * Built fresh from the design data, never from the live viewer scene, so exploded offsets,
 * fades, ghosting and highlights can't leak into the file. The file follows the input GLB
 * convention (spec §4): metres, Z up. The only conversion is mm → m (× 0.001), baked into
 * positions and board sizes; there is no Y-up rotation.
 *
 * The file's origin is the crate's centre of gravity (boards and parts), and every node above
 * the meshes has no transform of its own, like the `world` node of the sample part files. So
 * whatever a 3D tool pivots on (the scene origin, or the origin of `Crate` or of an assembly
 * when that node is selected), the crate turns about its balance point, never about a corner.
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
  /** The model already turned to Z up (`framedScene`). */
  scene: Object3D;
  /** Millimetres per model unit (1000 for metre files, 25.4 for inches). */
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

/** The exported file's origin, in the design's crate-interior mm: the loaded crate's centre of gravity. */
export const cratePivotMm = (design: CrateDesign): Vec3 => design.handling.cogMm;

/**
 * The export scene: assembled crate in metres, Z up, its centre of gravity on the origin,
 * optionally with the parts in their slots. `extras` (plain JSON, such as the engine's stamp) is
 * written as the glTF scene's `extras` and reads back as the loaded scene's `userData`.
 */
export function buildCrateScene(design: CrateDesign, part?: PartModel | null, extras?: Record<string, string>): Scene {
  const scene = new Scene();
  if (extras) scene.userData = { ...extras };
  const crate = new Group();
  crate.name = CRATE_NODE;
  // The pivot is taken off every mesh and part; `Crate` and the assembly groups stay at the origin.
  const [px, py, pz] = cratePivotMm(design);
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
      // Cradles keep their notches: the viewer's solid, scaled to metres.
      const geometry = m.cradle ? cradleGeometry(m).scale(M_PER_MM, M_PER_MM, M_PER_MM) : new BoxGeometry(sx * M_PER_MM, sy * M_PER_MM, sz * M_PER_MM);
      const mesh = new Mesh(geometry, materials[m.kind]);
      mesh.name = `${m.label} ${n}`;
      mesh.position.set((m.min[0] + sx / 2 - px) * M_PER_MM, (m.min[1] + sy / 2 - py) * M_PER_MM, (m.min[2] + sz / 2 - pz) * M_PER_MM);
      group.add(mesh);
    }
  }

  if (part) crate.add(partsGroup(design, part, [px, py, pz]));
  return scene;
}

/** A copy of the part per slot, with the same transform as `PartInstances` (in metres), measured from `pivot`. */
function partsGroup(design: CrateDesign, part: PartModel, [px, py, pz]: Vec3): Group {
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
    placed.position.set((slot.min[0] + a / 2 - px) * M_PER_MM, (slot.min[1] + b / 2 - py) * M_PER_MM, (slot.min[2] + c / 2 - pz) * M_PER_MM);
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
export async function exportCrateGlb(design: CrateDesign, part?: PartModel | null, extras?: Record<string, string>): Promise<ArrayBuffer> {
  const scene = buildCrateScene(design, part, extras);
  const result = await new GLTFExporter().parseAsync(scene, { binary: true });
  if (!(result instanceof ArrayBuffer)) throw new Error("GLTFExporter did not return binary data.");
  return result;
}

/** Part models kept for the next export; a custom part has a new object URL on every load, so only the last few are kept. */
const MAX_CACHED_SCENES = 4;
const partScenes = new Map<string, Promise<Object3D>>();

/** The part's model, loaded once per URL (the viewer has usually fetched it already, so this hits the cache). */
export function loadPartScene(url: string): Promise<Object3D> {
  let p = partScenes.get(url);
  if (!p) {
    p = new GLTFLoader().loadAsync(url).then((g) => g.scene);
    p.catch(() => partScenes.delete(url));
    partScenes.set(url, p);
    while (partScenes.size > MAX_CACHED_SCENES) partScenes.delete(partScenes.keys().next().value as string);
  }
  return p;
}
