import { GEO, GRID_HEIGHT, GRID_WIDTH } from "./constants";

/**
 * Web-Mercator on the grid: x is linear in longitude, y follows the Mercator stretch, so shapes stay faithful locally
 * (what people expect from an online map).
 *
 *   x = (lon − lonMin) / 360 · W                       lon wrapped into [lonMin, lonMin + 360)
 *   y = (M(latMax) − M(φ)) · Ry                         M(φ) = asinh(tan φ)
 *
 * `Ry` fits the Mercator band latMin…latMax exactly into the grid height. That is ≈ 5 % less than the horizontal scale
 * (`PROJ_R` = W / 2π), so the map is a Mercator that is 5 % flatter than a pure one: invisible, and it lets the whole
 * inhabited world (Greenland's tip to Chile's southernmost islands) fit in the 8:5 frame.
 *
 * Pure and dependency-free (relative imports only): also used by the data build script (scripts/build-world-data.mts).
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Pixels per radian of longitude. */
export const PROJ_R = GRID_WIDTH / (2 * Math.PI);

/** Latitude beyond which the standard Web-Mercator square is cut; input is clamped here so tan() never explodes. */
export const MERCATOR_MAX_LAT = 85.0511287798;

const mercY = (latDeg: number): number => {
  const lat = Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, latDeg));
  return Math.asinh(Math.tan(lat * RAD));
};

const M_TOP = mercY(GEO.latMax);
const M_BOTTOM = mercY(GEO.latMin);
/** Mercator ordinates of the top and bottom edge of the grid (used by the globe shader to find a texture row). */
export const MERCATOR_TOP = M_TOP;
export const MERCATOR_BOTTOM = M_BOTTOM;

/** Pixels per unit of Mercator ordinate (vertical scale of the frame). */
export const PROJ_RY = GRID_HEIGHT / (M_TOP - M_BOTTOM);

/** Latitude of the top edge of the grid. */
export const LAT_MAX: number = GEO.latMax;
/** West and east edge of the map (degrees; the east edge is expressed beyond 180° when the map is shifted). */
export const LON_MIN: number = GEO.lonMin;
export const LON_MAX: number = GEO.lonMin + 360;

export interface LonLat {
  lon: number;
  lat: number;
}

/** Longitude into [lonMin, lonMin + 360): the one place a given meridian has on this map. */
export const wrapLon = (lon: number): number => (((lon - LON_MIN) % 360) + 360) % 360 + LON_MIN;

/** Linear (unwrapped) longitude → x. Used for geometry that was made continuous across the antimeridian. */
export const lonToX = (lon: number): number => ((lon - LON_MIN) / 360) * GRID_WIDTH;
export const latToY = (lat: number): number => (M_TOP - mercY(lat)) * PROJ_RY;

/** The antimeridian (180°) runs through the map at this x: polygons that the source data cut there meet along it. */
export const SEAM_X = lonToX(180);

/** Longitude/latitude (degrees) → fractional grid coordinates. Latitudes beyond ±85.05° are clamped. */
export function lonLatToPixel({ lon, lat }: LonLat): { x: number; y: number } {
  return { x: lonToX(wrapLon(lon)), y: latToY(lat) };
}

export function pixelToLonLat(x: number, y: number): LonLat {
  let lon = LON_MIN + (x / GRID_WIDTH) * 360;
  if (lon > 180) lon -= 360;
  return { lon, lat: Math.atan(Math.sinh(M_TOP - y / PROJ_RY)) * DEG };
}

/** Ground size of one pixel (metres) *horizontally* at a latitude: ≈ 1 002 m at the equator, shrinking with cos(lat). */
export function metersPerPixel(latDeg: number): number {
  return ((2 * Math.PI * 6_378_137) / GRID_WIDTH) * Math.cos(latDeg * RAD);
}
