import { describe, expect, it } from "vitest";
import { clipPolygonToRect, clipPolylineToRect } from "@/components/map/geo";

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
