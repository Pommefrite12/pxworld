/** Static geographic reference layer, pre-projected into grid pixel space by scripts/build-world-data.mjs. */

interface LandFile { q: number; polygons: number[][][] }
interface LinesFile { q: number; lines: number[][] }

export interface Country { k: "c"; code: string | null; en: string; fr: string; bbox: [number, number, number, number] }
export interface City { k: "p"; en: string; cc: string; pop: number; x: number; y: number }
export interface Places { countries: Country[]; cities: City[] }

interface Ring { pts: Float64Array; x0: number; y0: number; x1: number; y1: number }

function decodeRing(flat: number[], q: number): Ring {
  const n = flat.length >> 1;
  const pts = new Float64Array(n * 2);
  let x = 0, y = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    if (i === 0) { x = flat[0]!; y = flat[1]!; } else { x += flat[2 * i]!; y += flat[2 * i + 1]!; }
    const wx = x / q, wy = y / q;
    pts[2 * i] = wx; pts[2 * i + 1] = wy;
    if (wx < x0) x0 = wx; if (wx > x1) x1 = wx; if (wy < y0) y0 = wy; if (wy > y1) y1 = wy;
  }
  return { pts, x0, y0, x1, y1 };
}

export interface Rect4 { x0: number; y0: number; x1: number; y1: number }
export interface TilePaths { fill: Path2D; coast: Path2D; borders: Path2D }

/** Sutherland–Hodgman against one half-plane. */
function clipEdge(input: number[], axis: 0 | 1, bound: number, keepGreater: boolean): number[] {
  const out: number[] = [];
  const n = input.length / 2;
  if (n === 0) return out;
  const inside = (v: number) => (keepGreater ? v >= bound : v <= bound);
  let px = input[2 * (n - 1)]!, py = input[2 * (n - 1) + 1]!;
  for (let i = 0; i < n; i++) {
    const cx = input[2 * i]!, cy = input[2 * i + 1]!;
    const pv = axis === 0 ? px : py, cv = axis === 0 ? cx : cy;
    const pin = inside(pv), cin = inside(cv);
    if (cin !== pin) {
      const t = (bound - pv) / (cv - pv);
      out.push(axis === 0 ? bound : px + (cx - px) * t, axis === 0 ? py + (cy - py) * t : bound);
    }
    if (cin) out.push(cx, cy);
    px = cx; py = cy;
  }
  return out;
}

const intersects = (r: Ring, c: Rect4) => r.x0 <= c.x1 && r.x1 >= c.x0 && r.y0 <= c.y1 && r.y1 >= c.y0;
const inside = (r: Ring, c: Rect4) => r.x0 >= c.x0 && r.x1 <= c.x1 && r.y0 >= c.y0 && r.y1 <= c.y1;

function addPolygon(path: Path2D, pts: ArrayLike<number>) {
  const n = pts.length >> 1;
  if (n < 3) return;
  path.moveTo(pts[0]!, pts[1]!);
  for (let i = 1; i < n; i++) path.lineTo(pts[2 * i]!, pts[2 * i + 1]!);
  path.closePath();
}

/** Liang–Barsky: adds the portions of the polyline that lie inside `c` (no artificial edges along the border). */
function addPolylineClipped(path: Path2D, pts: ArrayLike<number>, c: Rect4, closed: boolean) {
  const n = pts.length >> 1;
  const segs = closed ? n : n - 1;
  let penDown = false, lx = 0, ly = 0;
  for (let i = 0; i < segs; i++) {
    const ax = pts[2 * i]!, ay = pts[2 * i + 1]!, j = (i + 1) % n, bx = pts[2 * j]!, by = pts[2 * j + 1]!;
    const dx = bx - ax, dy = by - ay;
    let t0 = 0, t1 = 1;
    const p = [-dx, dx, -dy, dy], q = [ax - c.x0, c.x1 - ax, ay - c.y0, c.y1 - ay];
    let ok = true;
    for (let k = 0; k < 4 && ok; k++) {
      if (p[k] === 0) { if (q[k]! < 0) ok = false; continue; }
      const r = q[k]! / p[k]!;
      if (p[k]! < 0) { if (r > t1) ok = false; else if (r > t0) t0 = r; } else if (r < t0) ok = false; else if (r < t1) t1 = r;
    }
    if (!ok) { penDown = false; continue; }
    const sx = ax + t0 * dx, sy = ay + t0 * dy, ex = ax + t1 * dx, ey = ay + t1 * dy;
    if (!penDown || Math.abs(sx - lx) > 1e-9 || Math.abs(sy - ly) > 1e-9) path.moveTo(sx, sy);
    path.lineTo(ex, ey);
    penDown = t1 === 1; lx = ex; ly = ey;
  }
}

export class Geo {
  constructor(private low: Ring[], private high: Ring[], private borders: Ring[]) {}

  /**
   * Vector paths for ONE rectangle of the world, clipped to it. Rendering a map tile therefore only ever touches the
   * geometry that is actually inside that tile, whatever the complexity of the whole planet.
   */
  tilePaths(lod: "low" | "high", c: Rect4): TilePaths {
    const fill = new Path2D(), coast = new Path2D(), borders = new Path2D();
    const m = 4; // grid pixels of margin so strokes continue past the tile edge
    const wide: Rect4 = { x0: c.x0 - m, y0: c.y0 - m, x1: c.x1 + m, y1: c.y1 + m };
    for (const r of lod === "low" ? this.low : this.high) {
      if (!intersects(r, wide)) continue;
      if (inside(r, wide)) { addPolygon(fill, r.pts); addPolylineClipped(coast, r.pts, wide, true); continue; }
      let poly = Array.from(r.pts);
      poly = clipEdge(poly, 0, wide.x0, true); poly = clipEdge(poly, 0, wide.x1, false);
      poly = clipEdge(poly, 1, wide.y0, true); poly = clipEdge(poly, 1, wide.y1, false);
      addPolygon(fill, poly);
      addPolylineClipped(coast, r.pts, wide, true);
    }
    for (const r of this.borders) if (intersects(r, wide)) addPolylineClipped(borders, r.pts, wide, false);
    return { fill, coast, borders };
  }
}

let geoPromise: Promise<Geo> | undefined;
export function loadGeo(): Promise<Geo> {
  return (geoPromise ??= (async () => {
    const [low, high, borders] = await Promise.all([
      fetch("/data/land-110.json").then((r) => r.json() as Promise<LandFile>),
      fetch("/data/land-50.json").then((r) => r.json() as Promise<LandFile>),
      fetch("/data/borders-50.json").then((r) => r.json() as Promise<LinesFile>),
    ]);
    const rings = (f: LandFile) => f.polygons.flatMap((poly) => poly.map((ring) => decodeRing(ring, f.q)));
    return new Geo(rings(low), rings(high), borders.lines.map((l) => decodeRing(l, borders.q)));
  })());
}

let placesPromise: Promise<Places> | undefined;
export function loadPlaces(): Promise<Places> {
  return (placesPromise ??= fetch("/data/places.json").then((r) => r.json() as Promise<Places>));
}
