import { describe, expect, it } from "vitest";
import {
  DEFAULT_UNIT_PRICE_CENTS, GEO, GRID_HEIGHT, GRID_WIDTH, MIN_AREA, PRESET_SIZES, TOTAL_PIXELS,
} from "@/lib/grid/constants";
import {
  area, centeredRect, clampToGrid, findCollision, formatRectCode, intersects, lonLatToPixel, pixelToLonLat, validateRect,
} from "@/lib/grid/geometry";
import { LAT_MAX } from "@/lib/grid/projection";
import { DEFAULT_PRICING, enoughForKind, enoughLand, enoughWater, formatMoney, isParcelKind, quote } from "@/lib/grid/pricing";

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
    expect(PRESET_SIZES.map(area)).toEqual([25, 100, 400, 2_500, 10_000, 40_000]);
    expect(Math.min(...PRESET_SIZES.map(area))).toBe(MIN_AREA); // the smallest preset is the smallest parcel
  });
});

describe("validateRect", () => {
  it("accepts the minimum parcel", () => {
    expect(validateRect({ x: 0, y: 0, w: 5, h: 5 })).toBeNull(); // 25 pixels
    expect(validateRect({ x: 0, y: 0, w: 25, h: 1 })).toBeNull();
  });
  it("rejects fractional / unsafe numbers", () => {
    expect(validateRect({ x: 0.5, y: 0, w: 10, h: 10 })).toBe("not_integer");
    expect(validateRect({ x: 0, y: 0, w: NaN, h: 10 })).toBe("not_integer");
    expect(validateRect({ x: 0, y: 0, w: Infinity, h: 10 })).toBe("not_integer");
  });
  it("rejects too small, non-positive and out-of-bounds parcels", () => {
    expect(validateRect({ x: 0, y: 0, w: 4, h: 6 })).toBe("area_too_small"); // 24 pixels
    expect(validateRect({ x: 0, y: 0, w: 1, h: 1 })).toBe("area_too_small");
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
  it("min area constant is 25", () => expect(MIN_AREA).toBe(25));
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

describe("water parcels: the water pixels at their own rate, the land cut away at a percentage", () => {
  it("a water parcel pays for the water it owns; the land cut away is free by default", () => {
    const q = quote({ w: 20, h: 20 }, 100, { landPixels: 100, kind: "water" });
    expect(q).toMatchObject({ kind: "water", ownedPixels: 300, cutPixels: 100, landPixels: 100, seaPixels: 300, totalCents: 30_000, waterPercent: 100 });
  });
  it("the water rate and the land cut are percentages of the land price, rounded down like the database", () => {
    expect(quote({ w: 20, h: 20 }, 100, { landPixels: 100, kind: "water", waterPercent: 150, landCutPercent: 50 }).totalCents).toBe(45_000 + 5_000);
    expect(quote({ w: 10, h: 10 }, 99, { landPixels: 7, kind: "water", waterPercent: 33, landCutPercent: 10 }).totalCents).toBe(Math.floor((93 * 99 * 33) / 100) + Math.floor((7 * 99 * 10) / 100));
  });
  it("a land parcel is priced exactly as before, whatever the water settings are", () => {
    expect(quote({ w: 20, h: 20 }, 100, { landPixels: 300, seaPercent: 50, waterPercent: 400, landCutPercent: 90 }).totalCents).toBe(30_000 + 5_000);
    expect(quote({ w: 20, h: 20 }, 100, { landPixels: 300 }).kind).toBe("land");
  });
  it("the share of water needed mirrors the share of land needed", () => {
    expect(enoughWater(50, 100, 50)).toBe(true);
    expect(enoughWater(51, 100, 50)).toBe(false);
    expect(enoughWater(100, 100, 50)).toBe(false); // all land: no water at all
    expect(enoughWater(0, 100, 100)).toBe(true);
    expect(enoughWater(1, 100, 100)).toBe(false);
    expect(enoughWater(101, 100, 50)).toBe(false);
    expect(enoughWater(-1, 100, 50)).toBe(false);
    const p = { minLandPercent: 50, minWaterPercent: 90 };
    expect(enoughForKind("land", 60, 100, p)).toBe(true);
    expect(enoughForKind("water", 60, 100, p)).toBe(false);
    expect(enoughForKind("water", 10, 100, p)).toBe(true);
  });
  it("only two kinds exist", () => {
    expect([isParcelKind("land"), isParcelKind("water"), isParcelKind("lava"), isParcelKind(undefined)]).toEqual([true, true, false, false]);
    expect(DEFAULT_PRICING).toMatchObject({ minWaterPercent: 50, waterPercent: 100, landCutPercent: 0 });
  });
});

describe("pricing", () => {
  it("charges €0.25 per pixel by default", () => {
    expect(DEFAULT_UNIT_PRICE_CENTS).toBe(25);
    expect(DEFAULT_PRICING.unitPriceCents).toBe(25);
    expect(quote({ w: 10, h: 10 }).totalCents).toBe(2_500); // €25
    expect(quote({ w: 20, h: 20 }).totalCents).toBe(10_000); // €100
    expect(quote({ w: 200, h: 200 }).totalCents).toBe(1_000_000); // €10,000
    // every pixel of the planet sold, land and water: 250 million
    expect(1_000_000_000 * DEFAULT_UNIT_PRICE_CENTS / 100).toBe(250_000_000);
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
    expect(formatMoney(50, "en")).toBe("€0.50"); // the unit price itself
    expect(formatMoney(50, "fr").replace(/\s/g, " ")).toBe("0,50 €");
    expect(formatMoney(10_000, "fr").replace(/\s/g, " ")).toBe("100 €");
  });
});

describe("drawing precision (dots per pixel)", () => {
  it("is up to 10 × 10 dots per pixel, fewer on very large parcels so that an image never exceeds 4 million dots", async () => {
    const { CREATION_MAX_DOTS, CREATION_MAX_SCALE, creationScale } = await import("@/lib/grid/constants");
    expect([CREATION_MAX_SCALE, CREATION_MAX_DOTS]).toEqual([10, 4_000_000]);
    expect(creationScale(10, 10)).toBe(10); // 0.1 px
    expect(creationScale(20, 20)).toBe(10);
    expect(creationScale(200, 200)).toBe(10); // 2 000 × 2 000 = exactly 4 M dots
    expect(creationScale(201, 200)).toBe(9);
    expect(creationScale(500, 500)).toBe(4); // 250 000 px (the default maximum area): 0.25 px
    expect(creationScale(1000, 1000)).toBe(2); // 1 000 000 px (the hard maximum): half a pixel
    expect(creationScale(1000, 250)).toBe(4);
    for (const [w, h] of [[10, 10], [37, 91], [300, 300], [999, 1000], [1000, 1000]] as const) {
      const k = creationScale(w, h);
      expect(k * k * w * h).toBeLessThanOrEqual(CREATION_MAX_DOTS); // never over the cap…
      if (k < CREATION_MAX_SCALE) expect((k + 1) ** 2 * w * h).toBeGreaterThan(CREATION_MAX_DOTS); // …and as fine as the cap allows
    }
  });
});
