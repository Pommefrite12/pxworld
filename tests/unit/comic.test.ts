import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import { PANELS, PANEL_HEIGHT, PANEL_WIDTH } from "@/lib/doom/comic";

const dir = join(process.cwd(), "public", "story");
const texts = { en: en.comic, fr: fr.comic } as const;

describe("the comic strip of the story", () => {
  it("has six pictures, each a 960×540 PNG small enough to load quickly on a phone", async () => {
    expect([...PANELS]).toEqual([1, 2, 3, 4, 5, 6]);
    for (const n of PANELS) {
      const file = join(dir, `panel-${n}.png`);
      const meta = await sharp(readFileSync(file)).metadata();
      expect([meta.format, meta.width, meta.height], `panel-${n}.png`).toEqual(["png", PANEL_WIDTH, PANEL_HEIGHT]);
      expect(statSync(file).size, `panel-${n}.png weighs`).toBeLessThan(400_000);
    }
  });

  it("tells each picture in both languages: a title, a caption and a description of the image for those who cannot see it", () => {
    for (const [lang, c] of Object.entries(texts)) {
      for (const n of PANELS) {
        const p = (c.panels as Record<string, { title: string; text: string; alt: string }>)[`p${n}`];
        expect(p, `${lang} p${n}`).toBeDefined();
        expect(p!.title.length, `${lang} p${n} title`).toBeGreaterThan(5);
        expect(p!.text.length, `${lang} p${n} text`).toBeGreaterThan(30);
        expect(p!.alt.length, `${lang} p${n} alt`).toBeGreaterThan(30);
        expect(p!.alt, `${lang} p${n}: the description says something other than the caption`).not.toBe(p!.text);
      }
      expect(Object.keys(c.panels), lang).toHaveLength(PANELS.length);
    }
  });

  it("says in both languages that it is a fiction, and ends on the line of the site", () => {
    expect(texts.en.fiction).toMatch(/fiction/i);
    expect(texts.fr.fiction).toMatch(/fiction/i);
    expect(texts.en.panels.p6.text).toContain("Save the world. And the pizza with it.");
    expect(texts.fr.panels.p6.text).toContain("Sauvez le monde. Et la pizza avec.");
  });

  it("does not serve the source cutout of the generator (only the six finished pictures)", () => {
    expect(() => statSync(join(process.cwd(), "public", "story", "hooded.png"))).toThrow();
  });
});
