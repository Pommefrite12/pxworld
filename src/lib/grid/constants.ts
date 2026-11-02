/**
 * The Pixel World grid.
 *
 * 40 000 × 25 000 = 1 000 000 000 virtual pixels, exactly.
 *
 * Why this shape: 10^9 = 2^9 · 5^9, so a rectangle of exactly one billion
 * integer cells can only have a width/height ratio of the form 2^a·5^b with a
 * and b odd (a ratio of exactly 2:1 is impossible). The two candidates closest
 * to a world map are 8:5 (40 000 × 25 000) and 5:2 (50 000 × 20 000).
 *
 * The map uses the Web-Mercator projection every online map uses (see
 * ./projection.ts): it is conformal, so countries keep their familiar shape at
 * every latitude instead of looking stretched near the poles like they do on a
 * plate carrée. With 360° of longitude over 40 000 columns a pixel is ≈ 1 km
 * wide at the equator.
 *
 * The frame is chosen so that no country is cut: from 56.7°S (Chile's Diego
 * Ramírez islands, 56.5°S, are the southernmost) to 83.8°N (the tip of Greenland
 * is at 83.67°N), and its vertical scale is fitted to the 8:5 frame (≈ 5 % below
 * a pure Mercator). Longitude runs from 168.5°W to 191.5°E: the left/right edge
 * lies in the Bering Strait, which is the only place where the world can be cut
 * without slicing Russia or Fiji in two or showing the same land twice (only the Aleutian island of Umnak straddles it).
 *
 * The grid is VIRTUAL: nothing in the app ever materialises one object per pixel.
 * Only purchased rectangles (parcels) exist, as rows in PostgreSQL.
 */
export const GRID_WIDTH = 40_000;
export const GRID_HEIGHT = 25_000;
export const TOTAL_PIXELS = GRID_WIDTH * GRID_HEIGHT;

if (TOTAL_PIXELS !== 1_000_000_000) {
  throw new Error("Invariant broken: the grid must contain exactly 1 000 000 000 pixels");
}

/** Geographic extent of the frame (degrees). The map is 360° wide, starting at `lonMin` (the west edge). */
export const GEO = {
  lonMin: -168.5,
  latMin: -56.7,
  latMax: 83.8,
} as const;

/** Parcel limits. The database enforces the hard ones with CHECK constraints. */
export const MIN_AREA = 100;
export const MAX_SIDE = 1_000;
/** Default business cap on one parcel's area (admin-configurable, never above HARD_MAX_AREA). */
export const DEFAULT_MAX_AREA = 250_000;
export const HARD_MAX_AREA = 1_000_000;

/** Quick-pick parcel formats offered in the buy panel. */
export const PRESET_SIZES = [
  { w: 10, h: 10 },
  { w: 20, h: 20 },
  { w: 50, h: 50 },
  { w: 100, h: 100 },
  { w: 200, h: 200 },
] as const;

/**
 * Drawing precision. A parcel is exactly w × h pixels — that is what is sold, counted and priced — but a creation is
 * drawn finer: every pixel holds k × k dots, so the finest brush is 1/k of a pixel (0.1 px at k = 10).
 *
 * Finer images are bigger images, so the precision is capped by the image's size: at most CREATION_MAX_DOTS dots in total.
 * Small and medium parcels get the full 10 × 10 dots per pixel; a very large parcel gets fewer (a 500 × 500 pixel parcel:
 * 4 × 4, i.e. 0.25 px). An image of ANY whole scale from 1 (the parcel's own resolution: older creations, simple uploads)
 * up to the parcel's maximum is valid.
 */
export const CREATION_MAX_SCALE = 10;
export const CREATION_MAX_DOTS = 4_000_000;

/** Dots per pixel side for a parcel of w × h pixels: the largest k ≤ 10 with k² · w · h ≤ 4 000 000 (integer arithmetic, same as px_dot_scale in SQL). */
export function creationScale(w: number, h: number): number {
  const area = w * h;
  let k = CREATION_MAX_SCALE;
  while (k > 1 && k * k * area > CREATION_MAX_DOTS) k--;
  return k;
}

/** Default price: €0.50 per pixel, in minor units (cents). */
export const DEFAULT_UNIT_PRICE_CENTS = 50;
export const CURRENCY = "eur";

/** How long a reservation holds pixels before they are released again. */
export const RESERVATION_TTL_MINUTES = 35; // Stripe Checkout sessions cannot expire sooner than 30 min
