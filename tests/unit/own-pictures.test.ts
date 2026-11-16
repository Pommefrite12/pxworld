import { describe, expect, it } from "vitest";
import { MAX_OWN_PICTURES, OWN_PICTURE_MIN_PX, ownPictureMin } from "@/components/map/ownPictures";

const f = (v: number[]) => Float32Array.from(v);
const reach = (sizes: number[], t: number) => sizes.filter((s) => s >= t).length;

describe("which parcels of a view fetch their own picture", () => {
  it("everybody that is big enough does while the view is not crowded", () => {
    expect(ownPictureMin(f([13, 40, 200]), 3)).toBe(OWN_PICTURE_MIN_PX);
    expect(ownPictureMin(f([]), 0)).toBe(OWN_PICTURE_MIN_PX);
    const exactly = Array.from({ length: MAX_OWN_PICTURES }, (_, i) => 12 + i);
    expect(ownPictureMin(f(exactly), exactly.length)).toBe(OWN_PICTURE_MIN_PX);
  });

  it("keeps the biggest ones when the view is crowded, never more than the limit", () => {
    const sizes = Array.from({ length: 1000 }, (_, i) => 12 + i * 0.1); // 12 … 111.9
    const t = ownPictureMin(f(sizes), sizes.length);
    expect(reach(sizes, t)).toBeLessThanOrEqual(MAX_OWN_PICTURES);
    expect(reach(sizes, t)).toBe(MAX_OWN_PICTURES); // distinct sizes: exactly the limit, the biggest ones
    expect(t).toBeGreaterThan(OWN_PICTURE_MIN_PX);
  });

  it("with ties, takes the next size up rather than going over the limit", () => {
    const sizes = [...Array.from({ length: 100 }, () => 20), ...Array.from({ length: 100 }, () => 30)]; // 200 parcels, two sizes
    const t = ownPictureMin(f(sizes), sizes.length, 150);
    expect(t).toBe(30);
    expect(reach(sizes, t)).toBe(100);
  });

  it("nobody is preferred when everyone has the same size and they are too many", () => {
    const sizes = Array.from({ length: 400 }, () => 24);
    expect(ownPictureMin(f(sizes), sizes.length)).toBe(Infinity);
    expect(reach(sizes, Infinity)).toBe(0);
  });

  it("only looks at the first `count` entries (the array is reused from one frame to the next)", () => {
    const buf = new Float32Array(500).fill(999);
    buf.set([15, 25, 35]);
    expect(ownPictureMin(buf, 3)).toBe(OWN_PICTURE_MIN_PX);
  });
});
