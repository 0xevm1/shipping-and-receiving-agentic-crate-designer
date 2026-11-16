"use client";

import { Edges } from "@react-three/drei";
import type { CrateDesign, Member, MemberKind } from "@/domain/crate";
import type { Vec3 } from "@/domain/schema";

export type ViewMode = "assembled" | "cutaway" | "exploded";

const COLORS: Record<MemberKind, string> = {
  skid: "#a87a46",
  floor: "#dcc08f",
  side: "#e2c693",
  end: "#dabb85",
  lid: "#e6cd9f",
  cleat: "#c4945a",
  "lid-cleat": "#c4945a",
  separator: "#d6b680",
  bearer: "#9c6b3a",
  blocking: "#9c6b3a",
};

const EXPLODE_MM = 250;

/** Renders every board of the crate as a box. Coordinates are crate-interior mm. */
export function CrateModel({ design, mode }: { design: CrateDesign; mode: ViewMode }) {
  const interior = design.layout.interior;
  return (
    <group>
      {design.members.map((m, i) => {
        if (!isVisible(m, mode)) return null;
        const offset = mode === "exploded" ? explodeOffset(m, interior) : [0, 0, 0];
        const center: Vec3 = [
          m.min[0] + m.size[0] / 2 + offset[0],
          m.min[1] + m.size[1] / 2 + offset[1],
          m.min[2] + m.size[2] / 2 + offset[2],
        ];
        return (
          <mesh key={i} position={center} castShadow receiveShadow>
            <boxGeometry args={m.size} />
            <meshStandardMaterial color={COLORS[m.kind]} roughness={0.85} />
            <Edges color="#6b4a26" threshold={15} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Cutaway hides the lid and the front (−Y) wall so the parts are visible. */
function isVisible(m: Member, mode: ViewMode): boolean {
  if (mode !== "cutaway") return true;
  if (m.kind === "lid" || m.kind === "lid-cleat") return false;
  const inFrontOfInterior = m.min[1] + m.size[1] <= 0.5;
  return !(inFrontOfInterior && (m.kind === "side" || m.kind === "cleat"));
}

/** Pushes walls outward and the lid upward, based on which side of the interior a board sits. */
function explodeOffset(m: Member, [L, W]: Vec3): Vec3 {
  if (m.kind === "lid" || m.kind === "lid-cleat") return [0, 0, EXPLODE_MM * 1.5];
  if (m.kind !== "side" && m.kind !== "end" && m.kind !== "cleat") return [0, 0, 0];
  const max = [m.min[0] + m.size[0], m.min[1] + m.size[1]];
  const dx = max[0] <= 0.5 ? -1 : m.min[0] >= L - 0.5 ? 1 : 0;
  const dy = max[1] <= 0.5 ? -1 : m.min[1] >= W - 0.5 ? 1 : 0;
  return [dx * EXPLODE_MM, dy * EXPLODE_MM, 0];
}
