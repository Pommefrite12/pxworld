import { describe, expect, it } from "vitest";
import { HERITAGE, HERITAGE_BLOCK, HERITAGE_RES, heritagePlan } from "@/lib/demo/heritage";
import { Canvas, C } from "@/lib/demo/scene";
import { HERITAGE_I18N, HERITAGE_LANGS } from "@/lib/demo/heritage-i18n";
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
      const draw = (seed: number) => { const k = new Canvas(e.w, e.h, C.black, seed, 2); e.draw(k); return k.finish().data; };
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
    }
  });

  it("draws every picture finer than the parcel: a whole number of dots per pixel, a tenth of a pixel at the default fineness", () => {
    expect(HERITAGE_RES).toBe(10); // the finest the site accepts (0.1 px)
    for (const p of heritagePlan(2)) { const r = p.render!(p.w, p.h, p.seed); expect([r.w, r.h]).toEqual([p.w * 2, p.h * 2]); }
    const first = heritagePlan()[0]!, r = first.render!(first.w, first.h, first.seed);
    expect([r.w, r.h]).toEqual([first.w * HERITAGE_RES, first.h * HERITAGE_RES]);
    expect(r.w * r.h).toBeLessThanOrEqual(4_000_000); // CREATION_MAX_DOTS
  });

  it("is PIXEL ART all through: each art pixel is a block of identical dots, edges are hard, backgrounds are dithered steps (a small palette, not a smooth gradient)", () => {
    expect(HERITAGE_BLOCK).toBe(5); // half a pixel of the grid: a 30 × 30 parcel is drawn on a 60 × 60 grid of visible pixels
    for (const p of heritagePlan()) {
      const r = p.render!(p.w, p.h, p.seed), b = HERITAGE_BLOCK, colours = new Set<number>();
      for (let y = 0; y < r.h; y += b) for (let x = 0; x < r.w; x += b) {
        const q = (y * r.w + x) * 3, ref = [r.data[q]!, r.data[q + 1]!, r.data[q + 2]!];
        colours.add((ref[0]! << 16) | (ref[1]! << 8) | ref[2]!);
        for (let j = 0; j < b; j++) for (let i = 0; i < b; i++) {
          const t = ((y + j) * r.w + x + i) * 3;
          if (r.data[t] !== ref[0] || r.data[t + 1] !== ref[1] || r.data[t + 2] !== ref[2]) throw new Error(`${p.title}: the block at ${x},${y} is not one colour`);
        }
      }
      expect(colours.size, `${p.title} has a small palette (a smooth gradient has thousands of colours)`).toBeLessThan(450);
    }
  });

  it("has the title and the sentence of every picture in English, Spanish and Chinese (and nothing for a picture that does not exist)", () => {
    expect(Object.keys(HERITAGE_I18N).sort()).toEqual(HERITAGE.map((e) => e.id).sort());
    const cjk = /[\u4e00-\u9fff]/;
    for (const e of HERITAGE) for (const l of HERITAGE_LANGS) {
      const [title, text] = HERITAGE_I18N[e.id]![l];
      expect(title.trim().length, `${e.id} ${l} title`).toBeGreaterThan(0); expect(title.length, `${e.id} ${l} title is short`).toBeLessThanOrEqual(60); // the share image cuts at 60
      expect(text.trim().length, `${e.id} ${l} sentence`).toBeGreaterThan(10);
      if (l === "zh") { expect(cjk.test(title), `${e.id} zh title is Chinese`).toBe(true); expect(cjk.test(text), `${e.id} zh sentence is Chinese`).toBe(true); }
      else expect(cjk.test((title + text).replace("(永)", "")), `${e.id} ${l} has no Chinese (but the character the calligraphy picture is about)`).toBe(false);
      if (l === "en") expect(title, `${e.id} en title is not the French one by mistake`).not.toMatch(/^(Les|Le|La|L'|Des|Du)\b/);
    }
    // each language says something of its own (not the French sentence copied)
    for (const l of ["en", "es"] as const) expect(HERITAGE.filter((e) => HERITAGE_I18N[e.id]![l][1] === e.text)).toEqual([]);
    // the plan carries them, keyed by language, ready for the database
    const first = heritagePlan(2)[0]!;
    expect(Object.keys(first.i18n ?? {}).sort()).toEqual(["en", "es", "zh"]);
    expect(first.i18n!.en).toEqual({ title: HERITAGE_I18N[HERITAGE[0]!.id]!.en[0], description: HERITAGE_I18N[HERITAGE[0]!.id]!.en[1] });
  });
});
