import { describe, expect, it } from "vitest";
import { LIGHT_FROM, MID_FROM, TINT_HEX, WATER_TINTS, tintColor, tintIndex, tintPixels } from "@/lib/images/waterTint";

const OCEAN = [0xc9, 0xdf, 0xe8]; // the colour of free ocean on the map
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe("what is shown on water: three blues by lightness", () => {
  it("has exactly three tints, apart from each other and from the free ocean", () => {
    expect(WATER_TINTS).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(dist(WATER_TINTS[i]!, OCEAN), `tint ${i} against the ocean`).toBeGreaterThan(40);
      for (let j = i + 1; j < 3; j++) expect(dist(WATER_TINTS[i]!, WATER_TINTS[j]!), `tints ${i} and ${j}`).toBeGreaterThan(70);
    }
    // every tint is a blue: blue is the strongest channel, red the weakest
    for (const [r, g, b] of WATER_TINTS) { expect(b).toBeGreaterThan(g); expect(g).toBeGreaterThan(r); }
  });
  it("is light blue for light, medium for the middle, deep for dark", () => {
    expect(tintIndex(255, 255, 255)).toBe(0);
    expect(tintIndex(0, 0, 0)).toBe(2);
    expect(tintIndex(128, 128, 128)).toBe(1);
    expect(tintIndex(255, 0, 0)).toBe(2); // pure red is dark to the eye
    expect(tintIndex(0, 255, 0)).toBe(1); // pure green is medium
    expect(tintIndex(255, 255, 0)).toBe(0); // yellow is light
    expect(tintIndex(LIGHT_FROM, LIGHT_FROM, LIGHT_FROM)).toBe(0);
    expect(tintIndex(LIGHT_FROM - 1, LIGHT_FROM - 1, LIGHT_FROM - 1)).toBe(1);
    expect(tintIndex(MID_FROM, MID_FROM, MID_FROM)).toBe(1);
    expect(tintIndex(MID_FROM - 1, MID_FROM - 1, MID_FROM - 1)).toBe(2);
  });
  it("tints a whole RGBA picture in place and keeps its alpha; only the three colours remain", () => {
    const px = [[255, 255, 255, 255], [10, 10, 10, 255], [140, 140, 140, 128], [255, 0, 0, 255], [0, 200, 0, 255], [80, 80, 80, 0]];
    const data = new Uint8Array(px.flat());
    tintPixels(data, 4);
    const out = px.map((_, i) => [...data.subarray(i * 4, i * 4 + 4)]);
    expect(out.map((p) => p[3])).toEqual([255, 255, 128, 255, 255, 0]);
    const seen = new Set(out.map((p) => p.slice(0, 3).join(",")));
    expect([...seen].every((c) => WATER_TINTS.some((t) => t.join(",") === c))).toBe(true);
    expect(out[0]!.slice(0, 3)).toEqual([...WATER_TINTS[0]]);
    expect(out[1]!.slice(0, 3)).toEqual([...WATER_TINTS[2]]);
  });
  it("tints an RGB picture (no alpha) too", () => {
    const data = new Uint8Array([255, 255, 255, 0, 0, 0]);
    tintPixels(data, 3);
    expect([...data]).toEqual([...WATER_TINTS[0], ...WATER_TINTS[2]]);
  });
  it("gives the tint of an average colour, and the medium blue when there is none", () => {
    expect(tintColor("#ffffff")).toBe(TINT_HEX[0]);
    expect(tintColor("#000000")).toBe(TINT_HEX[2]);
    expect(tintColor("#808080")).toBe(TINT_HEX[1]);
    expect(tintColor(null)).toBe(TINT_HEX[1]);
    expect(tintColor("not a colour")).toBe(TINT_HEX[1]);
    expect(TINT_HEX.every((h) => /^#[0-9a-f]{6}$/.test(h))).toBe(true);
  });
});
