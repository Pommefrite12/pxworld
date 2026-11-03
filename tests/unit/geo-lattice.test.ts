import { describe, expect, it } from "vitest";
import { Geo } from "@/components/map/geo";
import { GRID_HEIGHT, GRID_WIDTH } from "@/lib/grid/constants";

const ring = (pts: number[]) => { const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1); return { pts: Float64Array.from(pts), x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; };
const geo = (rings: ReturnType<typeof ring>[]) => new Geo(rings as never, [] as never, [] as never, { cell: 2500, cellSmall: 500, cellCommune: 250, q: 4, g: [], c1: [], c2: [], m: [] });

describe("the land lattice (a point on every land cell of a grid laid over the world)", () => {
  it("samples only land: a square covering the western half gives exactly the western half of the cells", () => {
    const west = ring([0, 0, GRID_WIDTH / 2, 0, GRID_WIDTH / 2, GRID_HEIGHT, 0, GRID_HEIGHT]);
    const pts = geo([west]).landLattice(40, 20);
    expect(pts.length / 2).toBe(40 * 20 / 2);
    for (let i = 0; i < pts.length; i += 2) { expect(pts[i]!).toBeLessThan(GRID_WIDTH / 2); expect(pts[i + 1]!).toBeGreaterThan(0); expect(pts[i + 1]!).toBeLessThan(GRID_HEIGHT); }
  });
  it("follows the even-odd rule: a hole in a continent is not land", () => {
    const outer = ring([0, 0, GRID_WIDTH, 0, GRID_WIDTH, GRID_HEIGHT, 0, GRID_HEIGHT]);
    const hole = ring([GRID_WIDTH * 0.25, GRID_HEIGHT * 0.25, GRID_WIDTH * 0.75, GRID_HEIGHT * 0.25, GRID_WIDTH * 0.75, GRID_HEIGHT * 0.75, GRID_WIDTH * 0.25, GRID_HEIGHT * 0.75]);
    const pts = geo([outer, hole]).landLattice(40, 20);
    expect(pts.length / 2).toBe(40 * 20 - 20 * 10); // the middle half of the middle half is water
  });
  it("is empty for a world without land", () => {
    expect(geo([]).landLattice(16, 10)).toHaveLength(0);
  });
});
