import { describe, expect, it } from "vitest";
import { freeAvailable, freePresets, isFreeSelection, type FreeInfo } from "@/lib/free";

const info = (over: Partial<FreeInfo> = {}): FreeInfo => ({ open: true, reason: null, userReason: null, endsAt: "2027-01-01T00:00:00Z", maxArea: 24, cap: 5000, placed: 0, used: 0, lifetimeMax: 3, ...over });

describe("free imprints, as the interface decides", () => {
  it("is available only while the period is open AND this account has not used it", () => {
    expect(freeAvailable(info())).toBe(true);
    expect(freeAvailable(info({ open: false, reason: "ended" }))).toBe(false);
    expect(freeAvailable(info({ userReason: "standing" }))).toBe(false);
    expect(freeAvailable(info({ userReason: "lifetime" }))).toBe(false);
    expect(freeAvailable(null)).toBe(false);
    expect(freeAvailable(undefined)).toBe(false);
  });

  it("a selection is a free one when it is land, from 1 pixel to the biggest free size, and free is available", () => {
    expect(isFreeSelection(info(), { w: 1, h: 1 }, "land")).toBe(true);
    expect(isFreeSelection(info(), { w: 4, h: 6 }, "land")).toBe(true); // 24
    expect(isFreeSelection(info(), { w: 5, h: 5 }, "land")).toBe(false); // 25: the smallest paid parcel
    expect(isFreeSelection(info(), { w: 0, h: 4 }, "land")).toBe(false);
    expect(isFreeSelection(info(), { w: 3, h: 3 }, "water")).toBe(false); // land only
    expect(isFreeSelection(info({ userReason: "standing" }), { w: 3, h: 3 }, "land")).toBe(false);
    expect(isFreeSelection(info({ maxArea: 9 }), { w: 4, h: 3 }, "land")).toBe(false); // the biggest size is a setting
    expect(isFreeSelection(null, { w: 3, h: 3 }, "land")).toBe(false);
  });

  it("offers only sizes that fit the biggest free size, and never one as big as a paid parcel", () => {
    expect(freePresets(24).map((p) => `${p.w}x${p.h}`)).toEqual(["1x1", "2x2", "3x3", "4x4", "4x6"]);
    expect(freePresets(9).map((p) => `${p.w}x${p.h}`)).toEqual(["1x1", "2x2", "3x3"]);
    expect(freePresets(24).every((p) => p.w * p.h < 25)).toBe(true);
  });
});
