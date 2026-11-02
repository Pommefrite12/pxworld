import { describe, expect, it } from "vitest";
import { cellWindows, decodeDelta, landPixelsInWindow } from "@/lib/geo/landmask";

const square = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1];

describe("land pixels in a window (even-odd, pixel centres)", () => {
  it("counts a window fully inside a polygon, fully outside, and straddling an edge", () => {
    const land = [square(0, 0, 100, 100)];
    expect(landPixelsInWindow(land, 10, 10, 20, 20)).toBe(400);
    expect(landPixelsInWindow(land, 200, 200, 20, 20)).toBe(0);
    expect(landPixelsInWindow(land, 90, 90, 20, 20)).toBe(100); // a 10×10 corner is land
  });

  it("a pixel is land when its centre is inside: an edge at x = 10.51 includes pixel 10 (centre 10.5), x = 10.5 or 10.49 do not", () => {
    expect(landPixelsInWindow([square(0, 0, 10.51, 5)], 0, 0, 20, 5)).toBe(11 * 5);
    expect(landPixelsInWindow([square(0, 0, 10.5, 5)], 0, 0, 20, 5)).toBe(10 * 5); // half-open: the centre on the edge is outside
    expect(landPixelsInWindow([square(0, 0, 10.49, 5)], 0, 0, 20, 5)).toBe(10 * 5);
  });

  it("holes (lakes, seas inside a country) are subtracted and islands inside holes added back", () => {
    const rings = [square(0, 0, 100, 100), square(20, 20, 80, 80), square(40, 40, 60, 60)]; // land, lake, island in the lake
    expect(landPixelsInWindow(rings, 0, 0, 100, 100)).toBe(100 * 100 - 60 * 60 + 20 * 20);
    expect(landPixelsInWindow(rings, 25, 25, 10, 10)).toBe(0); // inside the lake
    expect(landPixelsInWindow(rings, 45, 45, 10, 10)).toBe(100); // on the island
  });

  it("handles concave shapes and diagonal edges", () => {
    const triangle = [0, 0, 100, 0, 0, 100];
    const full = landPixelsInWindow([triangle], 0, 0, 100, 100);
    expect(full).toBeGreaterThan(4800);
    expect(full).toBeLessThan(5200); // half of 100 × 100
    const l = [0, 0, 20, 0, 20, 4, 4, 4, 4, 20, 0, 20];
    expect(landPixelsInWindow([l], 0, 0, 20, 20)).toBe(20 * 4 + 4 * 16);
  });

  it("is exact on the windows' own coordinates (not only at the origin)", () => {
    const land = [square(1000, 2000, 1100, 2050)];
    expect(landPixelsInWindow(land, 1050, 2000, 100, 100)).toBe(50 * 50);
    expect(landPixelsInWindow(land, 1000, 2000, 100, 50)).toBe(100 * 50);
  });

  it("decodes the delta-encoded rings of the data files", () => {
    const pts = decodeDelta([400, 800, 40, 0, 0, 40, -40, 0], 4); // (100,200) → (110,200) → (110,210) → (100,210)
    expect(Array.from(pts)).toEqual([100, 200, 110, 200, 110, 210, 100, 210]);
  });

  it("splits a rectangle into the grid cells it touches, covering every pixel exactly once", () => {
    const rect = { x: 2490, y: 4990, w: 30, h: 30 }; // sits on a corner shared by four 2 500-px cells
    const windows = [...cellWindows(rect, 2500)];
    expect(windows.map((w) => [w.cx, w.cy])).toEqual([[0, 1], [1, 1], [0, 2], [1, 2]]);
    expect(windows.reduce((s, w) => s + w.w * w.h, 0)).toBe(30 * 30);
    expect([...cellWindows({ x: 10, y: 10, w: 20, h: 20 }, 2500)]).toHaveLength(1);
  });
});
