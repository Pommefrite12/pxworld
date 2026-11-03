import { describe, expect, it } from "vitest";
import { ART_STYLES, renderArt } from "@/lib/demo/art";

const colours = (r: { data: Uint8Array }) => { const s = new Set<number>(); for (let i = 0; i < r.data.length; i += 3) s.add((r.data[i]! << 16) | (r.data[i + 1]! << 8) | r.data[i + 2]!); return s.size; };

describe("the generated pictures of the demonstration data", () => {
  it("has eight different styles", () => {
    expect(new Set(ART_STYLES).size).toBe(8);
  });
  for (const style of ART_STYLES) {
    it(`${style}: fills exactly the parcel (one colour triple per pixel), whatever its shape`, () => {
      for (const [w, h] of [[40, 40], [60, 60], [185, 324], [400, 120], [111, 399]] as const) {
        const r = renderArt(style, w, h, 7, "Lune");
        expect([r.w, r.h, r.data.length]).toEqual([w, h, w * h * 3]);
      }
    });
    it(`${style}: is deterministic, varies with the seed, and is never a blank square`, () => {
      const a = renderArt(style, 120, 150, 5, "Anna"), b = renderArt(style, 120, 150, 5, "Anna"), c = renderArt(style, 120, 150, 6, "Anna");
      expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
      expect(Buffer.from(a.data).equals(Buffer.from(c.data))).toBe(false);
      expect(colours(a)).toBeGreaterThanOrEqual(3);
    });
  }
  it("gives pictures that really are different across a whole plan (no two alike)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(Buffer.from(renderArt(ART_STYLES[i % 8]!, 100, 100, 1000 + i, "Z").data).toString("base64"));
    expect(seen.size).toBe(50);
  });
});
