import { describe, expect, it } from "vitest";
import { HERITAGE, heritagePlan } from "@/lib/demo/heritage";
import { Canvas, C } from "@/lib/demo/scene";
import { CATEGORIES } from "@/lib/archive";

/** The "world heritage" set of the demonstration tool: 100 hand-drawn parcels, each on its real place, 50 × 50 pixels at most. */
describe("the heritage set", () => {
  it("has 100 distinct places, each with a title and a sentence of its own", () => {
    expect(HERITAGE).toHaveLength(100);
    expect(new Set(HERITAGE.map((e) => e.id)).size).toBe(100);
    expect(new Set(HERITAGE.map((e) => e.title)).size).toBe(100);
    expect(new Set(HERITAGE.map((e) => e.text)).size).toBe(100);
    for (const e of HERITAGE) {
      expect(e.title.length, e.id).toBeGreaterThanOrEqual(3);
      expect(e.text.length, e.id).toBeGreaterThanOrEqual(30);
      expect(e.text.length, e.id).toBeLessThanOrEqual(200);
      expect(e.text.endsWith("."), e.id).toBe(true);
      expect(/^[A-Z]{2}$/.test(e.country), e.id).toBe(true);
      expect(Math.abs(e.lat), e.id).toBeLessThanOrEqual(80);
      expect(Math.abs(e.lon), e.id).toBeLessThanOrEqual(180);
      expect((CATEGORIES as readonly string[]).includes(e.category), e.id).toBe(true);
    }
  });

  it("keeps every parcel within 50 × 50 pixels (and not smaller than 20 × 20)", () => {
    for (const e of HERITAGE) {
      expect(e.w, e.id).toBeLessThanOrEqual(50); expect(e.h, e.id).toBeLessThanOrEqual(50);
      expect(e.w, e.id).toBeGreaterThanOrEqual(20); expect(e.h, e.id).toBeGreaterThanOrEqual(20);
    }
  });

  it("draws a real picture for each one: several colours, not a flat fill, and the same one every time", () => {
    for (const e of HERITAGE) {
      const draw = (seed: number) => { const k = new Canvas(e.w, e.h, C.black, seed); e.draw(k); return k.r.data; };
      const a = draw(7), colours = new Map<string, number>();
      for (let i = 0; i < a.length; i += 3) { const key = `${a[i]},${a[i + 1]},${a[i + 2]}`; colours.set(key, (colours.get(key) ?? 0) + 1); }
      expect(colours.size, `${e.id} uses several colours`).toBeGreaterThanOrEqual(4);
      expect(Math.max(...colours.values()) / (a.length / 3), `${e.id} is not one flat colour`).toBeLessThan(0.8);
      expect(Buffer.from(draw(7)).equals(Buffer.from(a)), `${e.id} is deterministic`).toBe(true);
    }
  });

  it("makes a plan of exact items for the seeding tool: one account each, with an e-mail and a username of its own", () => {
    const plan = heritagePlan();
    expect(plan).toHaveLength(100);
    expect(new Set(plan.map((p) => p.emailLocal)).size).toBe(100);
    expect(new Set(plan.map((p) => p.username)).size).toBe(100);
    for (const p of plan) {
      expect(p.exact).toBe(true);
      expect(p.kind).toBe("land");
      expect(p.username.length).toBeLessThanOrEqual(24);
      expect(p.emailLocal).toMatch(/^demo-h\d{3}$/); // recognised (and removed) by `clear` like every demonstration account
      expect(p.category).toBeTruthy();
      const r = p.render!(p.w, p.h, p.seed);
      expect([r.w, r.h]).toEqual([p.w, p.h]);
    }
  });
});
