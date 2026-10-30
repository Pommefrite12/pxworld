import { describe, expect, it } from "vitest";
import { GRID_WIDTH } from "@/lib/grid/constants";
import { lonLatToPixel } from "@/lib/grid/projection";
import { flatScaleForRadius, project, radiusForFlatScale, unproject } from "@/lib/globe/orthographic";

describe("orthographic globe maths", () => {
  it("puts the centre of the view at the centre of the disc, facing the viewer", () => {
    const p = project(2.35, 48.85, 2.35, 48.85);
    expect(p.x).toBeCloseTo(0, 12);
    expect(p.y).toBeCloseTo(0, 12);
    expect(p.z).toBeCloseTo(1, 12);
  });

  it("keeps north up and east to the right", () => {
    expect(project(10, 0, 0, 0).x).toBeGreaterThan(0); // east of the centre → right
    expect(project(0, 10, 0, 0).y).toBeGreaterThan(0); // north of the centre → up
    expect(project(0, 10, 0, 45).y).toBeLessThan(project(0, 30, 0, 45).y); // still monotonic when tilted
  });

  it("hides the far side: z turns negative past 90° from the centre", () => {
    expect(project(180, 0, 0, 0).z).toBeCloseTo(-1, 12);
    expect(project(89, 0, 0, 0).z).toBeGreaterThan(0);
    expect(project(91, 0, 0, 0).z).toBeLessThan(0);
  });

  it("round-trips lon/lat through the disc for any view", () => {
    for (const [lon0, lat0] of [[0, 0], [2.35, 48.85], [-120, -33], [150, 70], [-179, 5]] as const) {
      for (const [lon, lat] of [[lon0 + 10, lat0 + 5], [lon0 - 30, lat0 - 10], [lon0, lat0]] as const) {
        const p = project(lon, lat, lon0, lat0);
        if (p.z <= 0) continue;
        const back = unproject(p.x, p.y, lon0, lat0)!;
        const wrap = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;
        expect(wrap(back.lon - lon)).toBeCloseTo(0, 8);
        expect(back.lat).toBeCloseTo(lat, 8);
      }
    }
  });

  it("has no point outside the unit disc", () => {
    expect(unproject(1.01, 0, 0, 0)).toBeNull();
    expect(unproject(0.7, 0.8, 0, 0)).toBeNull();
    expect(unproject(1, 0, 0, 0)!.lon).toBeCloseTo(90, 9);
  });

  it("hands over to a flat map that looks the same at the centre of the view", () => {
    for (const lat of [0, 30, 48.85, 70]) {
      const r = 1100;
      const s = flatScaleForRadius(r, lat);
      expect(radiusForFlatScale(s, lat)).toBeCloseTo(r, 6);
      // 1° of longitude spans the same number of screen pixels on the globe and on the flat map
      const globePx = ((r * Math.cos((lat * Math.PI) / 180) * Math.PI) / 180);
      const flatPx = (lonLatToPixel({ lon: 11, lat }).x - lonLatToPixel({ lon: 10, lat }).x) * s;
      expect(flatPx).toBeCloseTo(globePx, 6);
    }
    // a globe filling a laptop screen corresponds to a flat zoom that is usable (≥ the flat map's fit scale ≈ 0.036)
    expect(flatScaleForRadius(1200, 48)).toBeGreaterThan(0.036);
    expect(flatScaleForRadius(1200, 48)).toBeLessThan(0.5);
    expect(GRID_WIDTH).toBe(40000);
  });
});
