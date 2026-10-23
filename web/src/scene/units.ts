// World-space conventions shared by every scene module.
//   +X = east, +Z = south, +Y = up. 1 unit = 1 metre.
//   A city is a grid of plots; plot (0,0) is the north-west corner.

/** Edge length of one city plot in metres. */
export const PLOT_SIZE = 24;

/** Centre of plot (px, pz) in world space for a city of gridW × gridH plots (city centred on the origin). */
export function plotCenter(px: number, pz: number, gridW: number, gridH: number): { x: number; z: number } {
  return {
    x: (px + 0.5 - gridW / 2) * PLOT_SIZE,
    z: (pz + 0.5 - gridH / 2) * PLOT_SIZE,
  };
}

/** Centre of a footprint whose north-west plot is (px, pz). */
export function footprintCenter(
  px: number,
  pz: number,
  w: number,
  h: number,
  gridW: number,
  gridH: number,
): { x: number; z: number } {
  return {
    x: (px + w / 2 - gridW / 2) * PLOT_SIZE,
    z: (pz + h / 2 - gridH / 2) * PLOT_SIZE,
  };
}

/** Plot indices under a world-space point (may be out of range). */
export function plotAt(x: number, z: number, gridW: number, gridH: number): { px: number; pz: number } {
  return {
    px: Math.floor(x / PLOT_SIZE + gridW / 2),
    pz: Math.floor(z / PLOT_SIZE + gridH / 2),
  };
}
