import { GEO, GRID_HEIGHT, GRID_WIDTH } from "./constants";

/**
 * Web-Mercator on the grid: x is linear in longitude, y follows the Mercator stretch, so a pixel is a square of
 * ground at any latitude and shapes stay faithful locally (what people expect from an online map).
 *
 *   x = (lon + 180) / 360 · W
 *   y = (TOP − asinh(tan φ)) · R          with R = W / 2π pixels per radian
 *
 * TOP is chosen so that `GEO.latMin` lands exactly on the bottom edge of the grid.
 *
 * Pure and dependency-free (relative imports only): it is also used by the data build script (scripts/build-world-data.ts).
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Pixels per radian of longitude (and of Mercator ordinate). */
export const PROJ_R = GRID_WIDTH / (2 * Math.PI);

/** Latitude beyond which the standard Web-Mercator square is cut; input is clamped here so tan() never explodes. */
export const MERCATOR_MAX_LAT = 85.0511287798;

const mercY = (latDeg: number): number => {
  const lat = Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, latDeg));
  return Math.asinh(Math.tan(lat * RAD));
};

/** Mercator ordinate of the top edge of the grid. */
const TOP = GRID_HEIGHT / PROJ_R + mercY(GEO.latMin);

/** Latitude of the top edge of the grid (≈ 82.39°N). */
export const LAT_MAX = Math.atan(Math.sinh(TOP)) * DEG;

export interface LonLat {
  lon: number;
  lat: number;
}

/** Longitude/latitude (degrees) → fractional grid coordinates. Latitudes beyond ±85.05° are clamped. */
export function lonLatToPixel({ lon, lat }: LonLat): { x: number; y: number } {
  return {
    x: ((lon - GEO.lonMin) / (GEO.lonMax - GEO.lonMin)) * GRID_WIDTH,
    y: (TOP - mercY(lat)) * PROJ_R,
  };
}

export function pixelToLonLat(x: number, y: number): LonLat {
  return {
    lon: GEO.lonMin + (x / GRID_WIDTH) * (GEO.lonMax - GEO.lonMin),
    lat: Math.atan(Math.sinh(TOP - y / PROJ_R)) * DEG,
  };
}

/** Ground size of one pixel (metres) at a latitude: ≈ 1 002 m at the equator, shrinking with cos(lat). */
export function metersPerPixel(latDeg: number): number {
  return ((2 * Math.PI * 6_378_137) / GRID_WIDTH) * Math.cos(latDeg * RAD);
}
