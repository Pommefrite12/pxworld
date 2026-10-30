import { describe, expect, it } from "vitest";
import { clipPolygonToRect, clipPolylineToRect, outlineWithoutClipEdges } from "@/lib/geo/clip";
import { simplify } from "@/lib/geo/simplify";

const area = (p: number[]) => {
  let a = 0;
  for (let i = 0, n = p.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += p[2 * i]! * p[2 * j + 1]! - p[2 * j]! * p[2 * i + 1]!;
  }
  return Math.abs(a / 2);
};
const box = { x0: 0, y0: 0, x1: 10, y1: 10 };

describe("polygon clipping (map tiles only ever draw the geometry inside them)", () => {
  it("keeps a polygon that is fully inside", () => {
    const sq = [2, 2, 8, 2, 8, 8, 2, 8];
    expect(area(clipPolygonToRect(sq, box))).toBeCloseTo(36);
  });
  it("drops a polygon that is fully outside", () => {
    expect(clipPolygonToRect([20, 20, 30, 20, 30, 30, 20, 30], box)).toEqual([]);
  });
  it("cuts a polygon straddling an edge, preserving the area inside", () => {
    const sq = [5, 5, 15, 5, 15, 15, 5, 15]; // 10×10 square, a quarter lies inside
    expect(area(clipPolygonToRect(sq, box))).toBeCloseTo(25);
  });
  it("a polygon that surrounds the rectangle becomes the rectangle (land covering a whole tile)", () => {
    expect(area(clipPolygonToRect([-50, -50, 50, -50, 50, 50, -50, 50], box))).toBeCloseTo(100);
  });
  it("handles concave shapes without losing area", () => {
    const l = [0, 0, 20, 0, 20, 4, 4, 4, 4, 20, 0, 20]; // an L, 20×4 + 4×16
    expect(area(clipPolygonToRect(l, { x0: 0, y0: 0, x1: 10, y1: 10 }))).toBeCloseTo(10 * 4 + 4 * 6);
  });
});

describe("polyline clipping (coastlines and borders never gain false edges along the tile border)", () => {
  it("keeps the inside part of a crossing segment", () => {
    expect(clipPolylineToRect([-5, 5, 15, 5], box, false)).toEqual([[0, 5, 10, 5]]);
  });
  it("drops segments entirely outside", () => {
    expect(clipPolylineToRect([20, 20, 30, 30], box, false)).toEqual([]);
  });
  it("splits a path that leaves and re-enters into separate pieces", () => {
    const zig = [5, 5, 15, 5, 15, 8, 5, 8]; // out through the right edge and back in
    const pieces = clipPolylineToRect(zig, box, false);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toEqual([5, 5, 10, 5]);
    expect(pieces[1]).toEqual([10, 8, 5, 8]);
  });
  it("closed rings include the closing segment", () => {
    const tri = [2, 2, 8, 2, 8, 8];
    const open = clipPolylineToRect(tri, box, false).flat().length;
    const closed = clipPolylineToRect(tri, box, true).flat().length;
    expect(closed).toBeGreaterThan(open);
  });
  it("never emits a point outside the rectangle", () => {
    const wild = Array.from({ length: 200 }, (_, i) => Math.sin(i * 1.7) * 30 + 5);
    for (const piece of clipPolylineToRect(wild, box, true)) for (let i = 0; i < piece.length; i += 2) {
      expect(piece[i]).toBeGreaterThanOrEqual(-1e-9); expect(piece[i]).toBeLessThanOrEqual(10 + 1e-9);
      expect(piece[i + 1]).toBeGreaterThanOrEqual(-1e-9); expect(piece[i + 1]).toBeLessThanOrEqual(10 + 1e-9);
    }
  });
});

describe("outlines of clipped polygons (a clipped coast must not gain the clip rectangle's edges)", () => {
  const cell = { x0: 0, y0: 0, x1: 10, y1: 10 };
  it("returns the whole ring when the polygon is inside the cell", () => {
    const sq = [2, 2, 8, 2, 8, 8, 2, 8];
    const lines = outlineWithoutClipEdges(sq, cell);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual([2, 2, 8, 2, 8, 8, 2, 8, 2, 2]);
  });
  it("drops the edges that only run along the cell border", () => {
    const clipped = clipPolygonToRect([5, 5, 15, 5, 15, 15, 5, 15], cell); // a quarter of the square: 2 real edges, 2 artificial
    const lines = outlineWithoutClipEdges(clipped, cell);
    const length = lines.reduce((sum, l) => { let d = 0; for (let i = 2; i < l.length; i += 2) d += Math.hypot(l[i]! - l[i - 2]!, l[i + 1]! - l[i - 1]!); return sum + d; }, 0);
    expect(length).toBeCloseTo(10); // only the two 5-unit edges that lie inside the cell
  });
  it("draws nothing for a polygon that covers the whole cell", () => {
    expect(outlineWithoutClipEdges(clipPolygonToRect([-50, -50, 50, -50, 50, 50, -50, 50], cell), cell)).toEqual([]);
  });
});

describe("Douglas–Peucker simplification", () => {
  it("drops collinear points and keeps the ends", () => {
    expect(simplify([0, 0, 1, 0, 2, 0, 3, 0], 0.1)).toEqual([0, 0, 3, 0]);
  });
  it("keeps points that deviate more than the tolerance", () => {
    expect(simplify([0, 0, 1, 1, 2, 0], 0.5)).toEqual([0, 0, 1, 1, 2, 0]);
    expect(simplify([0, 0, 1, 0.2, 2, 0], 0.5)).toEqual([0, 0, 2, 0]);
  });
  it("copes with long rings without recursion", () => {
    const pts: number[] = [];
    for (let i = 0; i < 200_000; i++) pts.push(i, i % 2 === 0 ? 0 : 0.01);
    expect(simplify(pts, 0.5).length).toBe(4);
  });
});
