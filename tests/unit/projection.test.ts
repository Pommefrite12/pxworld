import { describe, expect, it } from "vitest";
import { GRID_HEIGHT, GRID_WIDTH } from "@/lib/grid/constants";
import { LAT_MAX, lonLatToPixel, metersPerPixel, pixelToLonLat } from "@/lib/grid/projection";

describe("Web-Mercator grid projection", () => {
  it("covers the inhabited world: Cape Horn to Svalbard and northern Greenland", () => {
    expect(LAT_MAX).toBeGreaterThan(82);
    expect(LAT_MAX).toBeLessThan(83);
    expect(lonLatToPixel({ lon: -67.3, lat: -55.98 }).y).toBeLessThan(GRID_HEIGHT); // Cape Horn
    expect(lonLatToPixel({ lon: 16, lat: 80 }).y).toBeGreaterThan(0); // Svalbard
  });

  it("round-trips every latitude inside the frame", () => {
    for (let lat = -56.9; lat <= 82.3; lat += 3.7) {
      for (const lon of [-179.9, -73, 0, 2.35, 151.2, 179.9]) {
        const p = lonLatToPixel({ lon, lat });
        const b = pixelToLonLat(p.x, p.y);
        expect(b.lon).toBeCloseTo(lon, 8);
        expect(b.lat).toBeCloseTo(lat, 8);
      }
    }
  });

  it("is conformal: a pixel stays square, 1° of longitude and of latitude look equally long locally", () => {
    for (const lat of [0, 30, 48.85, 65, 80]) {
      const a = lonLatToPixel({ lon: 10, lat }), east = lonLatToPixel({ lon: 10.01, lat });
      const north = lonLatToPixel({ lon: 10, lat: lat + 0.01 * 1 });
      const dx = east.x - a.x, dy = a.y - north.y;
      // 0.01° east covers 0.01°·cos(lat) of ground, 0.01° north covers ≈0.01° of ground: ratio dx/dy must be cos(lat)
      expect(dx / dy).toBeCloseTo(Math.cos((lat * Math.PI) / 180), 2);
    }
  });

  it("is the same plane Paris is on in every web map (x linear in longitude)", () => {
    const p = lonLatToPixel({ lon: 2.3522, lat: 48.8566 });
    expect(p.x).toBeCloseTo(((2.3522 + 180) / 360) * GRID_WIDTH, 6);
    expect(p.y).toBeGreaterThan(0);
    expect(p.y).toBeLessThan(GRID_HEIGHT / 2);
  });

  it("clamps latitudes beyond the Mercator square instead of returning NaN/Infinity", () => {
    expect(Number.isFinite(lonLatToPixel({ lon: 0, lat: 90 }).y)).toBe(true);
    expect(Number.isFinite(lonLatToPixel({ lon: 0, lat: -90 }).y)).toBe(true);
  });

  it("converts pixels to ground distance with cos(lat)", () => {
    expect(metersPerPixel(0)).toBeCloseTo(1001.88, 1);
    expect(metersPerPixel(60)).toBeCloseTo(metersPerPixel(0) / 2, 6);
  });
});
