import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

/** The pictures of the eras of the home page (the owner's four, and the planisphere): there, in two sizes, light, and the right shape. */
const NAMES = ["cave", "hieroglyphs", "manuscript", "photography", "world"];
const ERAS = ["cave", "hieroglyphs", "manuscript", "photography", "pixelworld"] as const;

describe("the pictures of the eras", () => {
  for (const name of NAMES) {
    it(`${name}: 720 and 1200 px wide, 4:3, WebP, under 250 KB`, async () => {
      for (const w of [720, 1200]) {
        const file = path.resolve("public/eras", `${name}-${w}.webp`);
        expect(fs.existsSync(file), file).toBe(true);
        expect(fs.statSync(file).size).toBeLessThan(250_000);
        const m = await sharp(file).metadata();
        expect([m.format, m.width, m.height]).toEqual(["webp", w, (w * 3) / 4]);
      }
    });
  }
});

describe("the words of the eras", () => {
  for (const [lang, m] of [["en", en], ["fr", fr]] as const) {
    it(`${lang}: every era has a date, a title, a sentence and a description of its picture`, () => {
      for (const k of ERAS) {
        const e = m.home.eras[k];
        for (const part of ["when", "title", "text", "alt"] as const) expect(e[part].length, `${lang} ${k}.${part}`).toBeGreaterThan(3);
        expect(e.alt.length, `${lang} ${k}: a real description`).toBeGreaterThan(30);
      }
    });
  }
});
