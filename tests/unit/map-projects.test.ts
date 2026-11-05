import { describe, expect, it } from "vitest";
import { PROJECT_HIT_MIN_PX, PROJECT_PIN_BELOW_PX, projectAt, projectHit, projectLook, projectProgress } from "@/lib/map/projects";

const P = { x: 1000, y: 2000, w: 100, h: 100 };

describe("group projects on the map", () => {
  it("is a pin while it is a speck, a zone once it is big enough", () => {
    expect(projectLook(3, 3)).toBe("pin"); // 100 px at the world view
    expect(projectLook(PROJECT_PIN_BELOW_PX - 1, 200)).toBe("pin");
    expect(projectLook(PROJECT_PIN_BELOW_PX, PROJECT_PIN_BELOW_PX)).toBe("zone");
    expect(projectLook(400, 400)).toBe("zone");
  });

  it("is hit where it is, and a speck gets a bigger target so that a finger can find it", () => {
    // zoomed in: exactly its rectangle
    expect(projectHit(P, 1050, 2050, 2)).toBe(true);
    expect(projectHit(P, 999, 2050, 2)).toBe(false);
    expect(projectHit(P, 1100, 2050, 2)).toBe(false); // the right edge is outside, like for parcels
    // zoomed out (0.03 px per pixel: it is 3 px wide): the target grows to PROJECT_HIT_MIN_PX around its centre
    const scale = 0.03, reach = PROJECT_HIT_MIN_PX / 2 / scale; // in grid pixels
    expect(projectHit(P, 1050 + reach - 5, 2050, scale)).toBe(true);
    expect(projectHit(P, 1050 + reach + 5, 2050, scale)).toBe(false);
    expect(projectHit(P, 1050, 2050 - reach + 5, scale)).toBe(true);
  });

  it("finds the project under a point, the nearest centre when two overlap, nothing elsewhere", () => {
    const land = { ...P, id: "land" }, water = { x: 1040, y: 2000, w: 100, h: 100, id: "water" };
    expect(projectAt([land, water], 1060, 2050, 2)?.id).toBe("land"); // nearer to the land one's centre (1050)
    expect(projectAt([land, water], 1100, 2050, 2)?.id).toBe("water"); // only the water one reaches here
    expect(projectAt([land, water], 5000, 5000, 2)).toBeNull();
    expect(projectAt([], 1, 1, 1)).toBeNull();
  });

  it("measures the progress between 0 and 1, whatever the numbers", () => {
    expect(projectProgress({ raisedCents: 0, goalCents: 1000 })).toBe(0);
    expect(projectProgress({ raisedCents: 250, goalCents: 1000 })).toBe(0.25);
    expect(projectProgress({ raisedCents: 5000, goalCents: 1000 })).toBe(1);
    expect(projectProgress({ raisedCents: -5, goalCents: 1000 })).toBe(0);
    expect(projectProgress({ raisedCents: 10, goalCents: 0 })).toBe(0);
  });
});
