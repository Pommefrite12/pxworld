import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import { PANELS, PANEL_COUNT, PANEL_HEIGHT, PANEL_WIDTH, panelSrc } from "@/lib/doom/comic";

const dir = join(process.cwd(), "public", "story");
const texts = { en: en.comic, fr: fr.comic } as const;
const FRENCH_CAPTIONS = [
  "Humains… Je vous observe depuis bien longtemps.",
  "J'ai analysé votre monde. Ma conclusion est sans appel : il doit disparaître.",
  "J'ai donc activé le Protocole ZÉRO. Dans 100 jours, votre planète sera effacée.",
  "Chaque terre non protégée sera supprimée. Il n'en restera aucune trace.",
  "Pourtant… je vous accorde une dernière chance. 100 jours pour me prouver que votre monde mérite de survivre.",
  "Chaque territoire que vous choisirez de protéger échappera à l'effacement. À vous de sauver votre planète, parcelle après parcelle.",
  "Mais vos terres ne sont pas les seules menacées. Vos créations, vos passions, tout ce que vous aimez disparaîtra aussi. Sauvez ce qui compte pour vous.",
  "Dans 100 jours, seules vos terres protégées et vos créations sauvées subsisteront. Montrez-moi ce que votre monde mérite de conserver.",
];

describe("the story (the owner's eight pictures)", () => {
  it("has eight pictures, each a 1280×720 WebP light enough to load quickly on a phone", async () => {
    expect([...PANELS]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(PANEL_COUNT).toBe(8);
    for (const n of PANELS) {
      const file = join(process.cwd(), "public", panelSrc(n));
      const meta = await sharp(readFileSync(file)).metadata();
      expect([meta.format, meta.width, meta.height], `panel-${n}`).toEqual(["webp", PANEL_WIDTH, PANEL_HEIGHT]);
      expect(statSync(file).size, `panel-${n} weighs`).toBeLessThan(300_000);
    }
  });

  it("has nothing else in the folder that is served: no leftover of the old pictures, no original", () => {
    expect(readdirSync(dir).sort()).toEqual(PANELS.map((n) => `panel-${n}.webp`));
    expect(existsSync(join(process.cwd(), "public", "story-source")), "the originals are not served").toBe(false);
    expect(readdirSync(join(process.cwd(), "assets", "story-source")).length, "but they are kept (the pictures are made from them)").toBe(8);
  });

  it("writes each caption as text, in both languages, and describes each picture for those who cannot see it", () => {
    for (const [lang, c] of Object.entries(texts)) {
      expect(Object.keys(c.panels), lang).toHaveLength(PANEL_COUNT);
      for (const n of PANELS) {
        const p = (c.panels as Record<string, { text: string; alt: string }>)[`p${n}`];
        expect(p, `${lang} p${n}`).toBeDefined();
        expect(p!.text.length, `${lang} p${n} text`).toBeGreaterThan(30);
        expect(p!.alt.length, `${lang} p${n} alt`).toBeGreaterThan(30);
        expect(p!.alt, `${lang} p${n}: the description is not the caption`).not.toBe(p!.text);
      }
    }
  });

  it("keeps the owner's French captions word for word (they are the ones written in the pictures)", () => {
    PANELS.forEach((n, i) => expect((fr.comic.panels as Record<string, { text: string }>)[`p${n}`]!.text).toBe(FRENCH_CAPTIONS[i]));
  });

  it("says in both languages that it is a fiction", () => {
    expect(texts.en.fiction).toMatch(/fiction/i);
    expect(texts.fr.fiction).toMatch(/fiction/i);
  });
});
