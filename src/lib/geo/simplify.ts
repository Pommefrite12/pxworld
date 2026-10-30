/**
 * Douglas–Peucker simplification of a flat [x0,y0,x1,y1,…] polyline (iterative, so rings of 100 000+ points are safe).
 * Points closer than `tol` to the simplified line are dropped; the first and last points are always kept.
 */
export function simplify(pts: ArrayLike<number>, tol: number): number[] {
  const n = pts.length >> 1;
  if (n <= 2 || tol <= 0) return Array.from(pts);
  const keep = new Uint8Array(n);
  keep[0] = 1; keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  const tol2 = tol * tol;
  while (stack.length) {
    const hi = stack.pop()!, lo = stack.pop()!;
    if (hi <= lo + 1) continue;
    const ax = pts[2 * lo]!, ay = pts[2 * lo + 1]!, bx = pts[2 * hi]!, by = pts[2 * hi + 1]!;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let best = -1, bestD = tol2;
    for (let i = lo + 1; i < hi; i++) {
      const px = pts[2 * i]!, py = pts[2 * i + 1]!;
      let d: number;
      if (len2 === 0) d = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
      }
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push(lo, best, best, hi); }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i]!, pts[2 * i + 1]!);
  return out;
}
