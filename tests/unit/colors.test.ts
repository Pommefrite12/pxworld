import { describe, expect, it } from "vitest";
import { MAX_MIX, PALETTE, hexToInt, mixColor, strokeRun, toggleMix } from "@/lib/editor/colors";

describe("multicolour strokes", () => {
  it("cycles through the colours in order, one run at a time, and starts over", () => {
    const mix = ["#ff0000", "#00ff00", "#0000ff"];
    const seq = Array.from({ length: 10 }, (_, d) => mixColor(mix, d, 2));
    expect(seq).toEqual(["#ff0000", "#ff0000", "#00ff00", "#00ff00", "#0000ff", "#0000ff", "#ff0000", "#ff0000", "#00ff00", "#00ff00"]);
  });
  it("one colour is just that colour; a negative or silly run never breaks it", () => {
    expect(mixColor(["#123456"], 99, 4)).toBe("#123456");
    expect(mixColor(["#111111", "#222222"], -5, 0)).toBe("#111111");
    expect(mixColor(["#111111", "#222222"], 1, 0)).toBe("#222222"); // a run of 0 counts as 1
    expect(() => mixColor([], 0, 1)).toThrow();
  });
  it("a run is one brush width, but never less than a whole pixel", () => {
    expect(strokeRun(10, 10)).toBe(10); // 1 px brush at ten dots per pixel
    expect(strokeRun(1, 10)).toBe(10); // a hairline brush still changes colour once per pixel
    expect(strokeRun(50, 10)).toBe(50); // a 5 px brush: one brush width
    expect(strokeRun(1, 1)).toBe(1);
  });
  it("the mix is built by clicking: add in order, click again to remove, never empty, never more than the maximum", () => {
    let mix = ["#aaaaaa"];
    mix = toggleMix(mix, "#bbbbbb");
    mix = toggleMix(mix, "#cccccc");
    expect(mix).toEqual(["#aaaaaa", "#bbbbbb", "#cccccc"]);
    expect(toggleMix(mix, "#bbbbbb")).toEqual(["#aaaaaa", "#cccccc"]);
    expect(toggleMix(["#aaaaaa"], "#aaaaaa")).toEqual(["#aaaaaa"]); // the last colour cannot be removed
    const full = PALETTE.slice(0, MAX_MIX);
    expect(toggleMix(full, PALETTE[MAX_MIX]!)).toEqual(full); // the ninth is refused
    expect(toggleMix(full, full[0]!)).toHaveLength(MAX_MIX - 1); // but a colour can still be removed
  });
  it("converts a hex colour to its 24-bit value", () => {
    expect(hexToInt("#ff4d2e")).toBe(0xff4d2e);
    expect(hexToInt("#000000")).toBe(0);
  });
});
