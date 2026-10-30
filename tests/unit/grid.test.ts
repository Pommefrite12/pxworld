import { describe, expect, it } from "vitest";
import {
  GRID_HEIGHT, GRID_WIDTH, MIN_AREA, PRESET_SIZES, TOTAL_PIXELS,
} from "@/lib/grid/constants";
import {
  area, centeredRect, clampToGrid, findCollision, formatRectCode, intersects, lonLatToPixel, pixelToLonLat, validateRect,
} from "@/lib/grid/geometry";
import { LAT_MAX } from "@/lib/grid/projection";
import { formatMoney, quote } from "@/lib/grid/pricing";

describe("grid", () => {
  it("contains exactly one billion pixels", () => {
    expect(GRID_WIDTH * GRID_HEIGHT).toBe(1_000_000_000);
    expect(TOTAL_PIXELS).toBe(1_000_000_000);
  });
  it("is an 8:5 frame (a 2:1 grid of exactly 10⁹ cells cannot exist)", () => {
    expect(GRID_WIDTH / GRID_HEIGHT).toBeCloseTo(1.6, 12);
  });
  it("round-trips lon/lat ↔ pixel", () => {
    const p = lonLatToPixel({ lon: 2.35, lat: 48.85 });
    const back = pixelToLonLat(p.x, p.y);
    expect(back.lon).toBeCloseTo(2.35, 9);
    expect(back.lat).toBeCloseTo(48.85, 9);
    expect(lonLatToPixel({ lon: -180, lat: LAT_MAX })).toEqual({ x: 0, y: expect.closeTo(0, 6) });
    const br = lonLatToPixel({ lon: 180, lat: -57 });
    expect(br.x).toBe(GRID_WIDTH);
    expect(br.y).toBeCloseTo(GRID_HEIGHT, 6);
  });
});

describe("area & presets", () => {
  it("computes surfaces", () => {
    expect(area({ w: 10, h: 10 })).toBe(100);
    expect(area({ w: 200, h: 200 })).toBe(40_000);
    expect(PRESET_SIZES.map(area)).toEqual([100, 400, 2_500, 10_000, 40_000]);
  });
});

describe("validateRect", () => {
  it("accepts the minimum parcel", () => expect(validateRect({ x: 0, y: 0, w: 10, h: 10 })).toBeNull());
  it("rejects fractional / unsafe numbers", () => {
    expect(validateRect({ x: 0.5, y: 0, w: 10, h: 10 })).toBe("not_integer");
    expect(validateRect({ x: 0, y: 0, w: NaN, h: 10 })).toBe("not_integer");
    expect(validateRect({ x: 0, y: 0, w: Infinity, h: 10 })).toBe("not_integer");
  });
  it("rejects too small, non-positive and out-of-bounds parcels", () => {
    expect(validateRect({ x: 0, y: 0, w: 9, h: 10 })).toBe("area_too_small");
    expect(validateRect({ x: 0, y: 0, w: 0, h: 100 })).toBe("non_positive");
    expect(validateRect({ x: -1, y: 0, w: 10, h: 10 })).toBe("out_of_bounds");
    expect(validateRect({ x: GRID_WIDTH - 9, y: 0, w: 10, h: 10 })).toBe("out_of_bounds");
    expect(validateRect({ x: 0, y: GRID_HEIGHT - 9, w: 10, h: 10 })).toBe("out_of_bounds");
  });
  it("accepts the last valid cell block", () => {
    expect(validateRect({ x: GRID_WIDTH - 10, y: GRID_HEIGHT - 10, w: 10, h: 10 })).toBeNull();
  });
  it("honours configurable maximum area and the side cap", () => {
    expect(validateRect({ x: 0, y: 0, w: 600, h: 600 }, { maxArea: 250_000 })).toBe("area_too_large");
    expect(validateRect({ x: 0, y: 0, w: 500, h: 500 }, { maxArea: 250_000 })).toBeNull();
    expect(validateRect({ x: 0, y: 0, w: 1_001, h: 1 }, { minArea: 1 })).toBe("side_too_large");
  });
  it("min area constant is 100", () => expect(MIN_AREA).toBe(100));
});

describe("intersects", () => {
  const a = { x: 10, y: 10, w: 10, h: 10 };
  it("detects overlaps", () => {
    expect(intersects(a, { x: 15, y: 15, w: 10, h: 10 })).toBe(true);
    expect(intersects(a, { x: 10, y: 10, w: 10, h: 10 })).toBe(true);
    expect(intersects(a, { x: 12, y: 12, w: 2, h: 2 })).toBe(true);
    expect(intersects(a, { x: 0, y: 0, w: 100, h: 100 })).toBe(true);
  });
  it("treats touching edges and corners as non-overlapping", () => {
    expect(intersects(a, { x: 20, y: 10, w: 10, h: 10 })).toBe(false);
    expect(intersects(a, { x: 0, y: 10, w: 10, h: 10 })).toBe(false);
    expect(intersects(a, { x: 10, y: 20, w: 10, h: 10 })).toBe(false);
    expect(intersects(a, { x: 20, y: 20, w: 10, h: 10 })).toBe(false);
  });
  it("is symmetric and finds the colliding parcel", () => {
    const b = { x: 19, y: 19, w: 5, h: 5 };
    expect(intersects(a, b)).toBe(intersects(b, a));
    expect(findCollision(a, [{ x: 100, y: 100, w: 5, h: 5 }, b])).toBe(b);
    expect(findCollision(a, [{ x: 100, y: 100, w: 5, h: 5 }])).toBeNull();
  });
});

describe("placement helpers", () => {
  it("clamps to the grid keeping the size", () => {
    expect(clampToGrid({ x: -50, y: -5, w: 20, h: 20 })).toEqual({ x: 0, y: 0, w: 20, h: 20 });
    expect(clampToGrid({ x: GRID_WIDTH, y: GRID_HEIGHT, w: 20, h: 20 })).toEqual({
      x: GRID_WIDTH - 20, y: GRID_HEIGHT - 20, w: 20, h: 20,
    });
  });
  it("centres on a point with integer coordinates", () => {
    expect(centeredRect(100.4, 200.6, 10, 10)).toEqual({ x: 95, y: 196, w: 10, h: 10 });
  });
  it("formats a stable permalink code", () => expect(formatRectCode({ x: 1, y: 2, w: 10, h: 20 })).toBe("1.2.10x20"));
});

describe("pricing", () => {
  it("charges 1 € per pixel by default", () => {
    expect(quote({ w: 10, h: 10 }).totalCents).toBe(10_000);
    expect(quote({ w: 20, h: 20 }).totalCents).toBe(40_000);
    expect(quote({ w: 200, h: 200 }).totalCents).toBe(4_000_000);
  });
  it("follows the configured unit price", () => {
    expect(quote({ w: 10, h: 10 }, 250).totalCents).toBe(25_000);
  });
  it("rejects invalid unit prices", () => {
    expect(() => quote({ w: 10, h: 10 }, 0)).toThrow();
    expect(() => quote({ w: 10, h: 10 }, 1.5)).toThrow();
  });
  it("formats money per locale", () => {
    expect(formatMoney(10_000, "en")).toBe("€100");
    expect(formatMoney(10_050, "en")).toBe("€100.50");
    expect(formatMoney(10_000, "fr").replace(/\s/g, " ")).toBe("100 €");
  });
});
