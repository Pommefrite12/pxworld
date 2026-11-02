/**
 * Which pixels of the grid are land? Pure geometry shared by the browser (the buy panel warns before you try) and the
 * server (which refuses a purchase that is not entirely on land — the browser is never trusted).
 *
 * A pixel is land when its CENTRE lies inside the land polygons (even-odd rule). No bitmap is stored: the polygons are
 * scan-converted on demand for just the window being asked about, so checking a 20×20 parcel costs one pass over the
 * edges of the (at most four) 2 500-px cells it touches, and a 1 000×1 000 parcel is still instant.
 */

/** Delta-encoded integer ring ([x0, y0, dx, dy, …], `q` units per grid pixel) → flat float coordinates in grid px. */
export function decodeDelta(flat: ArrayLike<number>, q: number): Float64Array {
  const n = flat.length >> 1;
  const pts = new Float64Array(n * 2);
  let x = 0, y = 0;
  for (let i = 0; i < n; i++) {
    if (i === 0) { x = flat[0]!; y = flat[1]!; } else { x += flat[2 * i]!; y += flat[2 * i + 1]!; }
    pts[2 * i] = x / q; pts[2 * i + 1] = y / q;
  }
  return pts;
}

/**
 * Number of land pixels inside the window [x0, x0+w) × [y0, y0+h) of the grid, given the rings (flat x,y arrays in grid
 * px, filled with the even-odd rule: an outer ring plus its holes) that cover it.
 */
export function landPixelsInWindow(rings: ArrayLike<ArrayLike<number>>, x0: number, y0: number, w: number, h: number): number {
  if (w <= 0 || h <= 0) return 0;
  const rows: number[][] = Array.from({ length: h }, () => []);
  for (let k = 0; k < rings.length; k++) {
    const ring = rings[k]!;
    const n = ring.length >> 1;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      let ax = ring[2 * i]!, ay = ring[2 * i + 1]!, bx = ring[2 * j]!, by = ring[2 * j + 1]!;
      if (ay === by) continue;
      if (ay > by) { const tx = ax, ty = ay; ax = bx; ay = by; bx = tx; by = ty; }
      // rows whose centre (y0 + r + 0.5) lies in [ay, by)
      let r0 = Math.ceil(ay - y0 - 0.5), r1 = Math.ceil(by - y0 - 0.5) - 1;
      if (r0 < 0) r0 = 0;
      if (r1 > h - 1) r1 = h - 1;
      if (r0 > r1) continue;
      const slope = (bx - ax) / (by - ay);
      for (let r = r0; r <= r1; r++) rows[r]!.push(ax + (y0 + r + 0.5 - ay) * slope);
    }
  }
  let land = 0;
  for (let r = 0; r < h; r++) {
    const xs = rows[r]!;
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // pixels whose centre (px + 0.5) lies in [xs[k], xs[k+1])
      const a = Math.max(0, Math.ceil(xs[k]! - x0 - 0.5)), b = Math.min(w, Math.ceil(xs[k + 1]! - x0 - 0.5));
      if (b > a) land += b - a;
    }
  }
  return land;
}

export interface CellRect { x: number; y: number; w: number; h: number }

/** The sub-windows of a rectangle, one per `cell`-sized grid cell it touches (the data is cut into such cells). */
export function* cellWindows(rect: CellRect, cell: number): Generator<{ cx: number; cy: number; x: number; y: number; w: number; h: number }> {
  for (let cy = Math.floor(rect.y / cell); cy <= Math.floor((rect.y + rect.h - 1) / cell); cy++) {
    for (let cx = Math.floor(rect.x / cell); cx <= Math.floor((rect.x + rect.w - 1) / cell); cx++) {
      const x = Math.max(rect.x, cx * cell), y = Math.max(rect.y, cy * cell);
      yield { cx, cy, x, y, w: Math.min(rect.x + rect.w, (cx + 1) * cell) - x, h: Math.min(rect.y + rect.h, (cy + 1) * cell) - y };
    }
  }
}
