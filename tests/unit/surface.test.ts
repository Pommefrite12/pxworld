import { describe, expect, it } from "vitest";
import { GRID_HEIGHT, GRID_WIDTH, GEO } from "@/lib/grid/constants";
import { latToY, lonToX, metersPerPixel, pixelToLonLat } from "@/lib/grid/projection";
import { areaKm2, areaKm2At, formatKm2, pixelKm2AtLat, rowKm2 } from "@/lib/grid/surface";

describe("surface of a parcel in km²", () => {
  it("is about 1 km² per pixel on the equator and shrinks with cos²(latitude)", () => {
    expect(pixelKm2AtLat(0)).toBeGreaterThan(1.0);
    expect(pixelKm2AtLat(0)).toBeLessThan(1.1);
    expect(pixelKm2AtLat(60)).toBeCloseTo(pixelKm2AtLat(0) / 4, 8);
    expect(pixelKm2AtLat(48.85)).toBeCloseTo(pixelKm2AtLat(0) * Math.cos((48.85 * Math.PI) / 180) ** 2, 8);
  });

  it("agrees with the ground size of a pixel: horizontal metres × vertical metres", () => {
    // vertical size from two neighbouring rows, converted back to the sphere: dy pixels ↔ dφ radians of latitude
    for (const lat of [0, 20, 45, 70]) {
      const y = latToY(lat);
      const dphi = ((pixelToLonLat(0, y - 0.5).lat - pixelToLonLat(0, y + 0.5).lat) * Math.PI) / 180;
      const heightKm = (6_378.137 * dphi);
      const widthKm = metersPerPixel(lat) / 1000;
      expect(widthKm * heightKm).toBeCloseTo(pixelKm2AtLat(lat), 2);
    }
  });

  it("sums the rows of a parcel: the same parcel is bigger near the equator than near the pole", () => {
    const eq = areaKm2({ y: Math.round(latToY(0)) - 50, w: 100, h: 100 });
    const north = areaKm2({ y: Math.round(latToY(70)) - 50, w: 100, h: 100 });
    expect(eq).toBeGreaterThan(10_000);
    expect(eq).toBeLessThan(11_000);
    expect(north).toBeLessThan(eq / 5);
    expect(north).toBeGreaterThan(eq / 12);
  });

  it("is exact for one row and additive across rows", () => {
    const y = 12_345;
    expect(areaKm2({ y, w: 1, h: 1 })).toBeCloseTo(rowKm2(y), 12);
    expect(areaKm2({ y, w: 10, h: 3 })).toBeCloseTo(10 * (rowKm2(y) + rowKm2(y + 1) + rowKm2(y + 2)), 9);
    expect(areaKm2({ y, w: 10, h: 10 })).toBeCloseTo(areaKm2({ y, w: 10, h: 4 }) + areaKm2({ y: y + 4, w: 10, h: 6 }), 9);
  });

  it("is consistent with the indicative size used before a spot is chosen", () => {
    const y = Math.round(latToY(30));
    const exact = areaKm2({ y: y - 10, w: 20, h: 20 });
    const approx = areaKm2At(20, 20, 30);
    expect(Math.abs(exact - approx) / approx).toBeLessThan(0.02);
  });

  it("ignores nothing and invents nothing: empty or out-of-grid parcels have no surface", () => {
    expect(areaKm2({ y: 0, w: 0, h: 10 })).toBe(0);
    expect(areaKm2({ y: 0, w: 10, h: 0 })).toBe(0);
    expect(areaKm2({ y: GRID_HEIGHT + 10, w: 10, h: 10 })).toBe(0);
    expect(areaKm2({ y: GRID_HEIGHT - 5, w: 10, h: 100 })).toBeCloseTo(10 * [0, 1, 2, 3, 4].reduce((s, i) => s + rowKm2(GRID_HEIGHT - 5 + i), 0), 9);
  });

  it("the whole grid is a plausible share of the planet's surface (a sphere is 510 million km²)", () => {
    const world = areaKm2({ y: 0, w: GRID_WIDTH, h: GRID_HEIGHT });
    expect(world).toBeGreaterThan(300e6); // the frame leaves out the polar caps beyond 83.8°N and 56.7°S
    expect(world).toBeLessThan(510e6);
    // that band of a sphere, computed in closed form: 2π R² (sin φmax − sin φmin)
    const band = 2 * Math.PI * 6_378.137 ** 2 * (Math.sin((GEO.latMax * Math.PI) / 180) - Math.sin((GEO.latMin * Math.PI) / 180));
    expect(world / band).toBeGreaterThan(0.99);
    expect(world / band).toBeLessThan(1.01);
    expect(lonToX(GEO.lonMin + 360)).toBe(GRID_WIDTH);
  });

  it("formats km² readably, with fewer decimals as numbers grow", () => {
    expect(formatKm2(0.256, "en")).toBe("0.26");
    expect(formatKm2(12.34, "en")).toBe("12.3");
    expect(formatKm2(1_054.6, "en")).toBe("1,055");
    expect(formatKm2(1_054.6, "fr").replace(/\s/g, " ")).toBe("1 055");
    expect(formatKm2(42_184, "en", { compact: true })).toBe("42.2K");
    expect(formatKm2(105, "en", { compact: true })).toBe("105");
    expect(formatKm2(0, "en")).toBe("—");
    expect(formatKm2(Number.NaN, "en")).toBe("—");
  });
});
