/**
 * Unit constants for the domain, which works in mm and kg (spec §4). One place for each
 * conversion; `src/lib/units.ts` keeps its own copies for display until it imports these.
 */

export const MM_PER_IN = 25.4;
export const MM_PER_FT = 304.8;
export const IN3_PER_FT3 = 1728;
export const LB_PER_KG = 2.20462;

export const MM_PER_M = 1000;
export const MM2_PER_M2 = 1e6;
export const MM3_PER_M3 = 1e9;
