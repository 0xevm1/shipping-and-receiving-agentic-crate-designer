import type { Vec3 } from "./schema";

/**
 * The boards of a crate: what a `Member` is, how it is labelled, and the sub-assemblies and faces
 * it belongs to. Types and tiny helpers only, so every other crate module can depend on this one
 * without a cycle.
 *
 * Coordinates: interior min corner at the origin (top face of the floor), Z up, X along the
 * crate's length (skids run along X, forklift entry from the ends).
 */

export type MemberKind =
  | "skid"
  | "floor"
  | "side"
  | "end"
  | "lid"
  | "cleat"
  | "lid-cleat"
  | "separator"
  | "bearer"
  | "blocking"
  | "cradle"
  /** Floor joists across the skids, under the floor. */
  | "joist";

export type WoodMaterial = "plywood" | "lumber";

/** The sub-assemblies a carpenter builds, in build order. The cut list groups by these. */
export const ASSEMBLIES = ["base", "sides", "ends", "lid", "inside"] as const;
export type Assembly = (typeof ASSEMBLIES)[number];

/**
 * Which face of the crate a board belongs to, so the viewer can move it when
 * exploded or fade it when opened. `side-` is the front (−Y) wall.
 */
export type Face = "base" | "side-" | "side+" | "end-" | "end+" | "lid" | "inside";

/** The shape of a notch: a circular seat for a round part, or a square-sided pocket. */
export type NotchShape = "round" | "flat";

/** A cut-out in a cradle, across the board's length. */
export interface Notch {
  /** Centre along the board's length axis (`CradleProfile.axis`), in crate-interior mm. */
  center: number;
  /** Opening width at the board face, mm. */
  width: number;
  /** Depth into the board from the face, mm. */
  depth: number;
  /** `round`: a circular seat of the part's radius; `flat`: a square-sided pocket. */
  shape: NotchShape;
  /** Seat radius for a round notch, mm (0 for flat). */
  radius: number;
  /** `top`: the part above sits in it; `bottom`: it fits over the part below (stacking cradle). */
  face: "top" | "bottom";
}

/** What makes a cradle more than a box: the axis it spans and its notches. */
export interface CradleProfile {
  /** The board's length axis (across the part): 1 = Y when the part lies along X. */
  axis: 0 | 1;
  notches: Notch[];
}

/**
 * A special kind of board within its `kind`, for the code that has to tell them apart (the screw
 * schedule, the shaped-blocking summary). Labels are for people and can be renamed; this is not.
 * - `shaped-block`: a `blocking` board cut to reach into a recess of the part (spec §7.5b).
 * - `stacking-cradle`: a `cradle` between layers, screwed through the side walls (spec §7.5a).
 */
export type MemberVariant = "shaped-block" | "stacking-cradle";

export interface Member {
  kind: MemberKind;
  material: WoodMaterial;
  assembly: Assembly;
  face: Face;
  /** Shop name for the piece, e.g. "Side rail". */
  label: string;
  /** Set on the boards `MemberVariant` names; absent otherwise. */
  variant?: MemberVariant;
  /** Key of the cut-list line this board belongs to. */
  bomKey: string;
  min: Vec3;
  size: Vec3;
  /** Cradles only: the notches cut into the board's bounding box. */
  cradle?: CradleProfile;
}

/** The descriptive part of a member that its builder supplies (the rest is geometry and stock). */
export type Tag = Pick<Member, "assembly" | "face" | "label" | "variant">;

/** Adds a board to the crate; boards with a side of 0.5 mm or less are dropped. */
export type AddMember = (kind: MemberKind, material: WoodMaterial, tag: Tag, min: Vec3, size: Vec3, cradle?: CradleProfile) => void;

/** Axis-aligned bounds of a set of boards: the smallest corner and the largest corner. */
export function memberBounds(members: readonly Pick<Member, "min" | "size">[]): { min: Vec3; max: Vec3 } {
  const axis = (i: number) => ({
    lo: Math.min(...members.map((m) => m.min[i])),
    hi: Math.max(...members.map((m) => m.min[i] + m.size[i])),
  });
  const [x, y, z] = [axis(0), axis(1), axis(2)];
  return { min: [x.lo, y.lo, z.lo], max: [x.hi, y.hi, z.hi] };
}

/** The values from largest to smallest, as a new array. */
export const sortDesc = (v: readonly number[]): number[] => [...v].sort((p, q) => q - p);
