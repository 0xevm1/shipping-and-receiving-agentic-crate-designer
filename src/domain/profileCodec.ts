import { deflateSync, inflateSync } from "fflate";
import { z } from "zod";
import { FACE_IDS, type FaceDepth, type FaceId, type PartProfile } from "./profile";
import { Vec3Schema } from "./schema";

/**
 * A part profile as it is written into a design file (spec §6.4): small enough for a share link.
 *
 * The profile is a few thousand depth samples (up to ~40,000 for the sample parts, 140 KB as
 * JSON). Shaped blocking depends on every one of them, so the file must keep them exactly:
 * a rounded profile would plan a slightly different crate from the one that was saved. The
 * depths are whole tenths of a millimetre, so they are stored as integers, each as the
 * difference from the sample before it, zigzag-varint packed, deflated and base64 encoded.
 * Lossless, and 0.4 to 2 KB for the three catalog parts. Pure.
 */

export const EncodedProfileSchema = z.object({
  version: z.literal(1),
  sizeMm: Vec3Schema,
  cellMm: z.number().positive(),
  /** `[cols, rows]` of each face, in `FACE_IDS` order. */
  grids: z.array(z.tuple([z.number().int().positive(), z.number().int().positive()])).length(FACE_IDS.length),
  /** The depths of every face in turn, packed as described above. */
  data: z.string(),
});
export type EncodedProfile = z.infer<typeof EncodedProfileSchema>;

/** Beyond this many samples a profile is refused: a damaged or hostile file, not a real part. */
const MAX_SAMPLES = 400_000;

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(text: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function encodeProfile(profile: PartProfile): EncodedProfile {
  const bytes: number[] = [];
  for (const id of FACE_IDS) {
    let prev = 0;
    for (const depth of profile.faces[id].depth) {
      const tenths = Math.round(depth * 10);
      let z = tenths >= prev ? (tenths - prev) * 2 : (prev - tenths) * 2 - 1;
      while (z >= 128) {
        bytes.push((z % 128) | 128);
        z = Math.floor(z / 128);
      }
      bytes.push(z);
      prev = tenths;
    }
  }
  return {
    version: 1,
    sizeMm: profile.sizeMm,
    cellMm: profile.cellMm,
    grids: FACE_IDS.map((id) => [profile.faces[id].cols, profile.faces[id].rows]),
    data: toBase64(deflateSync(Uint8Array.from(bytes), { level: 9 })),
  };
}

const decoded = new WeakMap<EncodedProfile, PartProfile | null>();

/** The profile back, exactly; null when the data is damaged or does not match its grids. */
export function decodeProfile(encoded: EncodedProfile): PartProfile | null {
  if (!decoded.has(encoded)) decoded.set(encoded, decode(encoded));
  return decoded.get(encoded) ?? null;
}

function decode({ sizeMm, cellMm, grids, data }: EncodedProfile): PartProfile | null {
  const samples = grids.reduce((n, [c, r]) => n + c * r, 0);
  if (samples > MAX_SAMPLES) return null;
  const packed = fromBase64(data);
  if (!packed) return null;
  let bytes: Uint8Array;
  try {
    bytes = inflateSync(packed, { out: new Uint8Array(samples * 5) });
  } catch {
    return null;
  }
  let at = 0;
  const faces = {} as Record<FaceId, FaceDepth>;
  for (const [i, id] of FACE_IDS.entries()) {
    const [cols, rows] = grids[i];
    const depth: number[] = [];
    let prev = 0;
    for (let n = 0; n < cols * rows; n++) {
      let z = 0;
      let scale = 1;
      for (;;) {
        if (at >= bytes.length) return null;
        const b = bytes[at++];
        z += (b & 127) * scale;
        if (b < 128) break;
        scale *= 128;
      }
      prev += z % 2 === 0 ? z / 2 : -(z + 1) / 2;
      depth.push(prev / 10);
    }
    faces[id] = { cols, rows, depth };
  }
  return { version: 1, sizeMm, cellMm, faces };
}
