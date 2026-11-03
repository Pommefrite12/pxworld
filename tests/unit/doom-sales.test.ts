import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/http/errors";
import { assertStoryAllowsSales, salesClosedByStory } from "@/lib/doom/sales";

const END = "2027-02-12T22:00:00Z", T = Date.parse(END);

describe("the story closes the shop at zero", () => {
  it("never closes it while no end date is configured", () => {
    for (const v of [undefined, null, "", "   ", "not a date"]) expect(salesClosedByStory(v, Date.now())).toBe(false);
    expect(() => assertStoryAllowsSales(undefined, Date.now())).not.toThrow();
  });
  it("keeps it open until the very instant of the end, then closes it for good", () => {
    expect(salesClosedByStory(END, T - 1)).toBe(false);
    expect(salesClosedByStory(END, T)).toBe(true);
    expect(salesClosedByStory(END, T + 365 * 86_400_000)).toBe(true);
  });
  it("refuses a new purchase with its own error once the world has ended, and says nothing before", () => {
    expect(() => assertStoryAllowsSales(END, T - 60_000)).not.toThrow();
    try { assertStoryAllowsSales(END, T + 1); throw new Error("should have refused"); }
    catch (e) { expect(e).toBeInstanceOf(HttpError); expect((e as HttpError).status).toBe(403); expect((e as HttpError).code).toBe("px_world_ended"); }
  });
  it("understands the dates the site's own clock understands (a time zone offset included)", () => {
    expect(salesClosedByStory("2027-02-12T23:00:00+01:00", T)).toBe(true);
    expect(salesClosedByStory("2027-02-12T23:00:00+01:00", T - 1)).toBe(false);
  });
});
