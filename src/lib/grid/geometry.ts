import { GRID_HEIGHT, GRID_WIDTH, HARD_MAX_AREA, MAX_SIDE, MIN_AREA } from "./constants";

/** An axis-aligned rectangle of virtual pixels. x/y = top-left cell, w/h = size in cells. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type RectError =
  | "not_integer"
  | "non_positive"
  | "out_of_bounds"
  | "side_too_large"
  | "area_too_small"
  | "area_too_large";

export const area = (r: Pick<Rect, "w" | "h">): number => r.w * r.h;

/** Inclusive-exclusive right/bottom edges. */
export const right = (r: Rect): number => r.x + r.w;
export const bottom = (r: Rect): number => r.y + r.h;

/** True if the two rectangles share at least one pixel (touching edges do NOT intersect). */
export function intersects(a: Rect, b: Rect): boolean {
  return a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);
}

export function contains(outer: Rect, px: number, py: number): boolean {
  return px >= outer.x && px < right(outer) && py >= outer.y && py < bottom(outer);
}

export interface RectLimits {
  minArea: number;
  maxArea: number;
}

/** Pure validation shared by client, server and tests. The database re-checks everything. */
export function validateRect(r: Rect, limits: Partial<RectLimits> = {}): RectError | null {
  const minArea = limits.minArea ?? MIN_AREA;
  const maxArea = Math.min(limits.maxArea ?? HARD_MAX_AREA, HARD_MAX_AREA);
  if (![r.x, r.y, r.w, r.h].every(Number.isSafeInteger)) return "not_integer";
  if (r.w < 1 || r.h < 1) return "non_positive";
  if (r.x < 0 || r.y < 0 || right(r) > GRID_WIDTH || bottom(r) > GRID_HEIGHT) return "out_of_bounds";
  if (r.w > MAX_SIDE || r.h > MAX_SIDE) return "side_too_large";
  if (area(r) < minArea) return "area_too_small";
  if (area(r) > maxArea) return "area_too_large";
  return null;
}

/** Moves a rectangle (keeping its size) so that it lies fully inside the grid. */
export function clampToGrid(r: Rect): Rect {
  const w = Math.min(r.w, GRID_WIDTH);
  const h = Math.min(r.h, GRID_HEIGHT);
  return {
    w,
    h,
    x: Math.max(0, Math.min(Math.round(r.x), GRID_WIDTH - w)),
    y: Math.max(0, Math.min(Math.round(r.y), GRID_HEIGHT - h)),
  };
}

/** Rectangle centred on a pixel coordinate, snapped to integers and clamped to the grid. */
export function centeredRect(cx: number, cy: number, w: number, h: number): Rect {
  return clampToGrid({ x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h });
}

export function findCollision<T extends Rect>(candidate: Rect, others: Iterable<T>): T | null {
  for (const o of others) if (intersects(candidate, o)) return o;
  return null;
}

/* ------------------------------ geography ------------------------------ */

export { lonLatToPixel, pixelToLonLat, metersPerPixel, type LonLat } from "./projection";

/* ------------------------------ permalinks ------------------------------ */

/** Compact, human-readable location code: "x.y.wxh", e.g. "12034.8812.20x20". */
export function formatRectCode(r: Rect): string {
  return `${r.x}.${r.y}.${r.w}x${r.h}`;
}
