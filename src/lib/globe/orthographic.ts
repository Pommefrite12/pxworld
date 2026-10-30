import { GRID_WIDTH } from "../grid/constants";

/**
 * Orthographic view of the Earth as seen from far away, centred on (lon0, lat0). Pure maths, shared by the globe
 * renderer, its labels and the hand-off to the flat map. Angles in degrees at the API, radians inside.
 *
 * On the unit sphere seen from outside: x → screen right, y → screen up (north), z → towards the viewer.
 * A point is visible when z > 0.
 */
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export interface GlobePoint { x: number; y: number; z: number }

export function project(lon: number, lat: number, lon0: number, lat0: number): GlobePoint {
  const p = lat * RAD, p0 = lat0 * RAD, dl = (lon - lon0) * RAD;
  return {
    x: Math.cos(p) * Math.sin(dl),
    y: Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(dl),
    z: Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(dl),
  };
}

/** Inverse: a point of the unit disc (x right, y up) → lon/lat, or null outside the globe. */
export function unproject(x: number, y: number, lon0: number, lat0: number): { lon: number; lat: number } | null {
  const d2 = x * x + y * y;
  if (d2 > 1) return null;
  const z = Math.sqrt(1 - d2), p0 = lat0 * RAD;
  const lat = Math.asin(Math.max(-1, Math.min(1, z * Math.sin(p0) + y * Math.cos(p0))));
  let lon = lon0 + Math.atan2(x, z * Math.cos(p0) - y * Math.sin(p0)) * DEG;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { lon, lat: lat * DEG };
}

/**
 * Hand-off to the flat map. The flat map is conformal: one radian of longitude is `s·W/2π` screen pixels there, at
 * every latitude. On a globe of radius r (screen px) one radian of longitude is `r·cos(lat)` px at latitude `lat`.
 * Equating the two gives the flat-map zoom that looks like the globe at its centre.
 */
export const flatScaleForRadius = (radiusPx: number, latDeg: number): number =>
  (2 * Math.PI * radiusPx * Math.max(0.2, Math.cos(latDeg * RAD))) / GRID_WIDTH;

/** Inverse of {@link flatScaleForRadius}. */
export const radiusForFlatScale = (scale: number, latDeg: number): number =>
  (scale * GRID_WIDTH) / (2 * Math.PI * Math.max(0.2, Math.cos(latDeg * RAD)));

/** Globe zoom range: 1 = the whole planet in view, HANDOFF_ZOOM = close enough to continue on the flat map. */
export const GLOBE_MIN_ZOOM = 1;
export const GLOBE_HANDOFF_ZOOM = 3;
export const GLOBE_MAX_LAT = 85;
