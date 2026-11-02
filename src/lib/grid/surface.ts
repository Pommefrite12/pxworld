import { GRID_HEIGHT, GRID_WIDTH } from "./constants";
import { PROJ_R, PROJ_RY, pixelToLonLat } from "./projection";

/**
 * Real-world surface of a parcel, in km².
 *
 * A pixel is not a fixed ground area: the map is a Mercator, so it grows on the ground as you approach the equator…
 * and shrinks towards the poles. With x = R·λ and y = Ry·(M(top) − M(φ)) (M = Mercator ordinate), one pixel at latitude
 * φ covers
 *
 *     width  = R_earth · cos φ · (2π / W)            (a degree of longitude shrinks with cos φ)
 *     height = R_earth · cos φ / Ry                   (dy = Ry · dφ / cos φ  ⇒  dφ = cos φ · dy / Ry)
 *     area   = R_earth² · cos²φ / (PROJ_R · PROJ_RY)
 *
 * ≈ 1.05 km² on the equator, ≈ 0.26 km² at 60° of latitude. Parcels are rectangles of pixels, so the exact surface of a
 * parcel is the sum of its rows, each taken at the latitude of its centre. Purely informative: the PRICE is per pixel
 * (a pixel is the unit of sale), the km² tell people how much of the real world their parcel stands for.
 *
 * Pure and dependency-free (relative imports only), so it runs on the server, in the browser and in tests.
 */

/** Equatorial radius of the Earth (km): the same sphere as `metersPerPixel` in ./projection.ts. */
const EARTH_RADIUS_KM = 6_378.137;
const RAD = Math.PI / 180;

/** km² of one pixel per unit of cos²(latitude). */
const KM2_PER_PIXEL_AT_EQUATOR = (EARTH_RADIUS_KM * EARTH_RADIUS_KM) / (PROJ_R * PROJ_RY);

/** Ground area (km²) of ONE pixel whose centre is at this latitude (degrees). */
export function pixelKm2AtLat(latDeg: number): number {
  const c = Math.cos(latDeg * RAD);
  return KM2_PER_PIXEL_AT_EQUATOR * c * c;
}

/** Ground area (km²) of the pixel row `y` (its centre decides the latitude). */
export function rowKm2(y: number): number {
  return pixelKm2AtLat(pixelToLonLat(0, y + 0.5).lat);
}

/** Exact surface of a parcel: `w` pixels per row, rows `y … y+h-1`. */
export function areaKm2(r: { y: number; w: number; h: number }): number {
  const y0 = Math.max(0, Math.min(GRID_HEIGHT, r.y));
  const y1 = Math.max(y0, Math.min(GRID_HEIGHT, r.y + r.h));
  let sum = 0;
  for (let y = y0; y < y1; y++) sum += rowKm2(y);
  return sum * Math.max(0, Math.min(GRID_WIDTH, r.w));
}

/** Surface (km²) a `w × h` parcel would have centred on this latitude: used before any spot is chosen. */
export function areaKm2At(w: number, h: number, latDeg: number): number {
  return w * h * pixelKm2AtLat(latDeg);
}

/**
 * Readable km² (without the unit): 2 decimals under 10, 1 decimal under 100, whole numbers (grouped) beyond; "—" for
 * nothing. `compact` shortens big values for tight spots ("42.2K", "42,2 k"), keeping them honest to 3 digits.
 */
export function formatKm2(km2: number, locale: string, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(km2) || km2 <= 0) return "—";
  if (opts.compact && km2 >= 1_000) return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(km2);
  const digits = km2 < 10 ? 2 : km2 < 100 ? 1 : 0;
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(km2);
}
