import { describe, expect, it } from "vitest";
import { editionProgress } from "@/lib/edition";
import { MAP_PARAMS, opensTheMap } from "@/lib/home";

describe("which addresses open the map and which the home page", () => {
  it("the bare address is the home page, in every language", () => {
    expect(opensTheMap({})).toBe(false);
    expect(opensTheMap({ utm_source: "newsletter", ref: "x" })).toBe(false); // a campaign tag is not a map link
    expect(opensTheMap({ preview: "J-9" })).toBe(false); // the preview of the old countdown story does not exist any more: the home page
  });

  it("every address that used to be a link to the map still is one: camera, parcel, buy mode, resumed purchase, the debug flags", () => {
    for (const p of [{ x: "1" }, { z: "2" }, { p: "abcdef0123" }, { buy: "1" }, { bx: "1" }, { hud: "" }, { perf: "" }, { bk: "water" }]) expect(opensTheMap(p), JSON.stringify(p)).toBe(true);
    expect(MAP_PARAMS).toContain("bw");
    expect(MAP_PARAMS).toContain("bh");
  });
});

describe("how much of the edition is gone (the progress bar of the home page)", () => {
  const e = (state: "prelaunch" | "open" | "closed", serverNow: string) => ({ state, opensAt: "2026-11-01T00:00:00Z", closesAt: "2027-02-09T00:00:00Z", serverNow });

  it("is 0 before the opening and 1 once closed, whatever the clock says", () => {
    expect(editionProgress({ ...e("prelaunch", "2026-12-01T00:00:00Z"), opensAt: null, closesAt: null })).toBe(0);
    expect(editionProgress(e("closed", "2026-11-02T00:00:00Z"))).toBe(1);
  });

  it("follows the SERVER's clock in between, never leaves 0..1", () => {
    expect(editionProgress(e("open", "2026-11-01T00:00:00Z"))).toBe(0);
    expect(editionProgress(e("open", "2026-12-21T00:00:00Z"))).toBeCloseTo(0.5, 5); // 50 of the 100 days
    expect(editionProgress(e("open", "2027-02-09T00:00:00Z"))).toBe(1);
    expect(editionProgress(e("open", "2026-10-01T00:00:00Z"))).toBe(0);
    expect(editionProgress(e("open", "2027-06-01T00:00:00Z"))).toBe(1);
  });
});
