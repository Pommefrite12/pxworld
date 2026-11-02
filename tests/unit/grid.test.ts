import { describe, expect, it } from "vitest";
import {
  DEFAULT_UNIT_PRICE_CENTS, GEO, GRID_HEIGHT, GRID_WIDTH, MIN_AREA, PRESET_SIZES, TOTAL_PIXELS,
} from "@/lib/grid/constants";
import {
  area, centeredRect, clampToGrid, findCollision, formatRectCode, intersects, lonLatToPixel, pixelToLonLat, validateRect,
} from "@/lib/grid/geometry";
import { LAT_MAX } from "@/lib/grid/projection";
import { DEFAULT_PRICING, enoughLand, formatMoney, quote } from "@/lib/grid/pricing";

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
    const tl = lonLatToPixel({ lon: GEO.lonMin, lat: LAT_MAX });
    expect(tl.x).toBe(0);
    expect(tl.y).toBeCloseTo(0, 6);
    const bottom = lonLatToPixel({ lon: 0, lat: GEO.latMin });
    expect(bottom.y).toBeCloseTo(GRID_HEIGHT, 6);
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

describe("coastal pricing: land at full price, sea at a percentage", () => {
  it("a parcel entirely on land costs area × unit price, whatever the sea percentage", () => {
    expect(quote({ w: 10, h: 10 }, 100, { landPixels: 100, seaPercent: 50 }).totalCents).toBe(10_000);
    expect(quote({ w: 10, h: 10 }, 100, { landPixels: 100, seaPercent: 50 }).seaPixels).toBe(0);
  });
  it("the sea pixels of a coastal parcel are offered by default, or charged at the configured percentage", () => {
    const free = quote({ w: 20, h: 20 }, 100, { landPixels: 300 });
    expect(free).toMatchObject({ area: 400, landPixels: 300, seaPixels: 100, totalCents: 30_000 });
    expect(quote({ w: 20, h: 20 }, 100, { landPixels: 300, seaPercent: 50 }).totalCents).toBe(30_000 + 5_000);
    expect(quote({ w: 20, h: 20 }, 100, { landPixels: 300, seaPercent: 100 }).totalCents).toBe(40_000);
  });
  it("rounds the sea part down like the database does (integer arithmetic)", () => {
    // 7 sea pixels × 99 cents × 33 % = 228.69 → 228
    expect(quote({ w: 10, h: 10 }, 99, { landPixels: 93, seaPercent: 33 }).totalCents).toBe(93 * 99 + 228);
  });
  it("needs a minimum share of land, and never zero land", () => {
    expect(enoughLand(50, 100, 50)).toBe(true);
    expect(enoughLand(49, 100, 50)).toBe(false);
    expect(enoughLand(0, 100, 50)).toBe(false);
    expect(enoughLand(1, 100, 1)).toBe(true);
    expect(enoughLand(100, 100, 100)).toBe(true);
    expect(enoughLand(99, 100, 100)).toBe(false);
    expect(enoughLand(101, 100, 50)).toBe(false); // more land than pixels is nonsense
  });
});

describe("pricing", () => {
  it("charges €0.10 per pixel by default", () => {
    expect(DEFAULT_UNIT_PRICE_CENTS).toBe(10);
    expect(DEFAULT_PRICING.unitPriceCents).toBe(10);
    expect(quote({ w: 10, h: 10 }).totalCents).toBe(1_000); // €10
    expect(quote({ w: 20, h: 20 }).totalCents).toBe(4_000); // €40
    expect(quote({ w: 200, h: 200 }).totalCents).toBe(400_000); // €4,000
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
    expect(formatMoney(10, "en")).toBe("€0.10"); // the unit price itself
    expect(formatMoney(10, "fr").replace(/\s/g, " ")).toBe("0,10 €");
    expect(formatMoney(10_000, "fr").replace(/\s/g, " ")).toBe("100 €");
  });
});
