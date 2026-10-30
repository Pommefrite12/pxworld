/**
 * Pure geometry helpers shared by the map renderer (browser) and the data build script (Node): clipping of polygons and
 * polylines against axis-aligned rectangles, and extraction of "real" outlines from clipped polygons.
 */

export interface Rect4 { x0: number; y0: number; x1: number; y1: number }

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

/**
 * Liang–Barsky: the portions of a polyline (or closed ring) that lie inside `c`, as separate polylines.
 * No artificial edges are created along the clip border, so clipped coastlines never gain false lines.
 */
export function clipPolylineToRect(pts: ArrayLike<number>, c: Rect4, closed: boolean): number[][] {
  const n = pts.length >> 1;
  const out: number[][] = [];
  let cur: number[] | null = null;
  const segs = closed ? n : n - 1;
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
    if (!ok) { cur = null; continue; }
    const sx = ax + t0 * dx, sy = ay + t0 * dy, ex = ax + t1 * dx, ey = ay + t1 * dy;
    if (!cur || Math.abs(cur[cur.length - 2]! - sx) > 1e-9 || Math.abs(cur[cur.length - 1]! - sy) > 1e-9) {
      cur = [sx, sy];
      out.push(cur);
    }
    cur.push(ex, ey);
    if (t1 < 1) cur = null; // the segment leaves the rectangle: the next piece starts a new polyline
  }
  return out;
}

/** Sutherland–Hodgman polygon clip against an axis-aligned rectangle (flat [x0,y0,x1,y1…] in and out). */
export function clipPolygonToRect(pts: ArrayLike<number>, c: Rect4): number[] {
  let poly = Array.from(pts);
  poly = clipEdge(poly, 0, c.x0, true);
  poly = clipEdge(poly, 0, c.x1, false);
  poly = clipEdge(poly, 1, c.y0, true);
  return clipEdge(poly, 1, c.y1, false);
}


/**
 * The coastline of a polygon that was clipped to `c`: every edge of the ring EXCEPT those that merely run along the
 * clip rectangle (Sutherland–Hodgman closes a clipped polygon along the rectangle's border, and those artificial
 * edges must never be stroked). A genuine coast edge cannot lie exactly on the border with both ends on it, so the
 * test is exact when the clip rectangle's edges are representable (the build script cuts on multiples of 2 500 px).
 */
export function outlineWithoutClipEdges(pts: ArrayLike<number>, c: Rect4): number[][] {
  const n = pts.length >> 1;
  const out: number[][] = [];
  if (n < 2) return out;
  const onBorder = (ax: number, ay: number, bx: number, by: number) =>
    (ax === bx && (ax === c.x0 || ax === c.x1)) || (ay === by && (ay === c.y0 || ay === c.y1));
  let cur: number[] | null = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = pts[2 * i]!, ay = pts[2 * i + 1]!, bx = pts[2 * j]!, by = pts[2 * j + 1]!;
    if (onBorder(ax, ay, bx, by)) { cur = null; continue; }
    if (!cur) { cur = [ax, ay]; out.push(cur); }
    cur.push(bx, by);
  }
  // the ring is closed: when it starts and ends in the middle of a real outline, join the first and last pieces
  if (out.length > 1 && !onBorder(pts[2 * (n - 1)]!, pts[2 * (n - 1) + 1]!, pts[0]!, pts[1]!)) {
    const first = out[0]!, last = out[out.length - 1]!;
    if (last[last.length - 2] === first[0] && last[last.length - 1] === first[1]) {
      out[out.length - 1] = last.concat(first.slice(2));
      out.shift();
    }
  }
  return out;
}
