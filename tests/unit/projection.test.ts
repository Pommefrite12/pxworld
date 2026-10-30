import { describe, expect, it } from "vitest";
import { GEO, GRID_HEIGHT, GRID_WIDTH } from "@/lib/grid/constants";
import { LAT_MAX, lonLatToPixel, metersPerPixel, pixelToLonLat, PROJ_R, PROJ_RY, SEAM_X, wrapLon } from "@/lib/grid/projection";

describe("Web-Mercator grid projection", () => {
  it("keeps every country whole: Greenland's tip, Chile's southernmost islands, Russia's far east", () => {
    const north = lonLatToPixel({ lon: -30.6, lat: 83.67 }); // Kaffeklubben Ø, the northernmost land of the planet
    expect(north.y).toBeGreaterThan(0);
    expect(lonLatToPixel({ lon: -68.7, lat: -56.52 }).y).toBeLessThan(GRID_HEIGHT); // Diego Ramírez (Chile)
    const dezhnev = lonLatToPixel({ lon: -169.65, lat: 66.07 }); // easternmost point of Russia
    expect(dezhnev.x).toBeLessThan(GRID_WIDTH);
    expect(dezhnev.x).toBeGreaterThan(SEAM_X); // on the same side of the map as the rest of Russia
    expect(lonLatToPixel({ lon: 178, lat: -17.8 }).x).toBeLessThan(SEAM_X); // Fiji is not split either
    expect(lonLatToPixel({ lon: -179, lat: -17.8 }).x).toBeGreaterThan(SEAM_X);
    expect(LAT_MAX).toBe(GEO.latMax);
  });

  it("round-trips every latitude inside the frame", () => {
    for (let lat = -56.5; lat <= 83.5; lat += 3.7) {
      for (const lon of [-179.9, -73, 0, 2.35, 151.2, 179.9, -168.4]) {
        const p = lonLatToPixel({ lon, lat });
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(GRID_WIDTH);
        const b = pixelToLonLat(p.x, p.y);
        expect(b.lon).toBeCloseTo(lon, 8);
        expect(b.lat).toBeCloseTo(lat, 8);
      }
    }
  });

  it("puts the map's edge in the Bering Strait: Alaska on the west edge, Chukotka on the east edge, nothing repeated", () => {
    expect(lonLatToPixel({ lon: GEO.lonMin, lat: 0 }).x).toBe(0);
    expect(lonLatToPixel({ lon: -168.09, lat: 65.6 }).x).toBeLessThan(100); // Cape Prince of Wales
    expect(wrapLon(-180)).toBe(180);
    expect(wrapLon(180)).toBe(180); // the antimeridian is one line, not two edges
    expect(wrapLon(181)).toBe(181);
    expect(wrapLon(-169)).toBe(191);
  });

  it("is conformal up to the fixed vertical fit: 1° east vs 1° north keeps the same ratio at every latitude", () => {
    const fit = PROJ_RY / PROJ_R;
    expect(fit).toBeGreaterThan(0.94);
    expect(fit).toBeLessThan(0.97);
    for (const lat of [0, 30, 48.85, 65, 80]) {
      const a = lonLatToPixel({ lon: 10, lat }), east = lonLatToPixel({ lon: 10.01, lat });
      const north = lonLatToPixel({ lon: 10, lat: lat + 0.01 });
      // 0.01° east covers 0.01°·cos(lat) of ground, 0.01° north ≈ 0.01° of ground: dx/dy = cos(lat) / fit
      expect((east.x - a.x) / (a.y - north.y)).toBeCloseTo(Math.cos((lat * Math.PI) / 180) / fit, 2);
    }
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
