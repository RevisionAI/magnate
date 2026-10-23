// Shared constants for the W3 families. The flag bits and facade styles mirror
// `materials/CityMaterial.ts` (FLAG_*) and `GeoBuilder.ts` (`Facade`); they are duplicated here so that
// factories, which run inside the chunk Web Worker, never import three.js just for a few numbers.
// `__tests__/familiesA.test.ts` asserts that both copies agree.

export const FL_OWNER_ROOF = 1;
export const FL_VEG = 2;
export const FL_PAVED = 4;
export const FL_SNOW = 8;

/** Facade style ids (art §3.5). Styles 7 (RETAIL-UPPER) and 8 (CIVIC arched) are not in the shader yet. */
export const FAC = { NONE: 0, HOUSE: 1, APARTMENT: 2, CURTAIN: 3, SHOP: 4, INDUSTRIAL: 5, OFFICE: 6 } as const;

/** `extra.z` value meaning "no company owner". */
export const OWNER_NONE = 255;

/** Emissive bytes (`extra.x`): glow = em/255 × own colour × night × 2.4 × 1.6 (art §3.5). */
export const EM = { lamp: 255, sign: 150, soft: 80, faint: 40 } as const;

/** Ground-level patches sit just above the chunk ground (y = 0) so they never z-fight with it. */
export const Y_GROUND = 0.04;
/** Paint (stall lines, crossings, court markings) sits on top of ground patches. */
export const Y_PAINT = 0.07;

/** Plot edge in metres (art §2.1). Mirrors `scene/units.ts`; footprints in plots × this = lot metres. */
export const PLOT_M = 24;

/** Minimum distance between a building mass and the lot edge (art §3.2). */
export const LOT_MARGIN = 1.0;
/** Minimum distance between any ground patch and the lot edge (keeps a seam of chunk ground between lots). */
export const EDGE_MARGIN = 0.3;
