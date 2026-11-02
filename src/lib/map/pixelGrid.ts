/**
 * The map's only grid: the 1-pixel one, in the last stretch of the zoom. Everywhere else the land is clean (no 10 px or
 * 100 px lines, no dot matrix). The zoom goes up to ×48; the grid starts to show at half of that — the last doubling —
 * and is fully there a little further.
 */
export const GRID_FROM_SCALE = 24;
export const GRID_FULL_SCALE = 30;
/** Opacity of the 1 px lines once fully shown. */
export const GRID_ALPHA = 0.2;

/** Opacity of the 1-pixel grid at a zoom (screen pixels per grid pixel): 0 until `GRID_FROM_SCALE`, then fading in. */
export function gridAlpha(scale: number): number {
  const t = (scale - GRID_FROM_SCALE) / (GRID_FULL_SCALE - GRID_FROM_SCALE);
  return Math.min(1, Math.max(0, t)) * GRID_ALPHA;
}
