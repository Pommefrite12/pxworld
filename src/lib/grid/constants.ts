/**
 * The Pixel World grid.
 *
 * 50 000 × 20 000 = 1 000 000 000 virtual pixels, exactly.
 *
 * Why this shape: 10^9 = 2^9 · 5^9, so a rectangle of exactly one billion
 * integer cells can only have a width/height ratio of the form 2^a·5^b with a
 * and b odd (a ratio of exactly 2:1 is impossible). The two candidates closest
 * to a world map are 8:5 (40 000 × 25 000) and 5:2 (50 000 × 20 000).
 *
 * 5:2 maps onto an equirectangular (plate carrée) projection with SQUARE pixels:
 * 360° of longitude over 50 000 columns and 144° of latitude (84°N → 60°S) over
 * 20 000 rows are both 0.0072° per pixel (≈ 800 m at the equator). That crop
 * keeps every inhabited land mass (northern tip of Greenland: 83.6°N, Cape Horn:
 * 56°S) and drops only Antarctica's interior and the polar ocean.
 *
 * The grid is VIRTUAL: nothing in the app ever materialises one object per pixel.
 * Only purchased rectangles (parcels) exist, as rows in PostgreSQL.
 */
export const GRID_WIDTH = 50_000;
export const GRID_HEIGHT = 20_000;
export const TOTAL_PIXELS = GRID_WIDTH * GRID_HEIGHT;

if (TOTAL_PIXELS !== 1_000_000_000) {
  throw new Error("Invariant broken: the grid must contain exactly 1 000 000 000 pixels");
}

/** Geographic extent covered by the grid (equirectangular, square pixels). */
export const GEO = {
  lonMin: -180,
  lonMax: 180,
  latMax: 84,
  latMin: -60,
} as const;

export const DEGREES_PER_PIXEL = (GEO.lonMax - GEO.lonMin) / GRID_WIDTH; // 0.0072

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

/** Default price: 1 € per pixel, expressed in minor units (cents). */
export const DEFAULT_UNIT_PRICE_CENTS = 100;
export const CURRENCY = "eur";

/** How long a reservation holds pixels before they are released again. */
export const RESERVATION_TTL_MINUTES = 35; // Stripe Checkout sessions cannot expire sooner than 30 min
