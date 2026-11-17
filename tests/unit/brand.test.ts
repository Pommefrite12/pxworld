import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "use-intl/core";
import { describe, expect, it } from "vitest";
import { BRAND, BRAND_ICU, BRAND_LOGO_TEXT, BRAND_UPPER, icuEscape } from "@/lib/brand";
import { withBrand, withFallback } from "@/i18n/request";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import es from "@/messages/es.json";
import zh from "@/messages/zh.json";

/** The name of the site is written in one place (`src/lib/brand.ts`): renaming the site must be a one-line change. */
const SRC = path.resolve(__dirname, "../../src");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css|json)$/.test(f) ? [p] : [];
  });
/** A line of code or text; the comments (`//`, `*`, `/*`) may talk about the site freely. */
const isComment = (l: string) => /^\s*(\/\/|\*|\/\*)/.test(l);

describe("the name of the site", () => {
  it("is set in src/lib/brand.ts and is not empty", () => {
    expect(BRAND.name.trim().length).toBeGreaterThan(0);
    expect(BRAND_UPPER).toBe(BRAND.name.toUpperCase());
    expect(BRAND.wordmark.lead + BRAND.wordmark.rest).not.toBe("");
  });

  it("is written nowhere else in src/ (code, styles, message files): everything reads it from the brand file", () => {
    const needles = [...new Set([BRAND.name, BRAND_UPPER])];
    const found: string[] = [];
    for (const f of files(SRC)) {
      if (f === path.join(SRC, "lib/brand.ts")) continue;
      readFileSync(f, "utf8").split("\n").forEach((l, i) => {
        if (!isComment(l) && needles.some((n) => l.includes(n))) found.push(`${path.relative(SRC, f)}:${i + 1}`);
      });
    }
    expect(found).toEqual([]);
  });

  it("is filled in the messages of the four languages through {brand}, and no {brand} is left", () => {
    for (const [lang, own] of [["en", en], ["fr", fr], ["es", es], ["zh", zh]] as const) {
      const text = JSON.stringify(withBrand(lang === "en" ? en as never : withFallback(en as never, own as never)));
      expect(text, lang).not.toMatch(/\{brand(Logo)?\}/);
      expect(text, lang).toContain(BRAND_ICU); // (the form made safe for ICU: an apostrophe is doubled, and shown as one)
    }
    for (const own of [en, fr, es, zh]) expect(JSON.stringify(own)).toContain("{brand}");
  });

  it("the label of the logo link contains the text the logo shows (WCAG 2.5.3: label in name), in every language", () => {
    for (const [lang, own] of [["en", en], ["fr", fr], ["es", es], ["zh", zh]] as const) {
      const label = (withBrand(lang === "en" ? en : withFallback(en as never, own as never)) as typeof en).nav.home;
      expect(label.toLowerCase(), lang).toContain(BRAND_LOGO_TEXT.toLowerCase());
    }
  });

  it("can be any name: apostrophes, accents and braces come out as written", () => {
    for (const name of ["L'Aube", "Où?", "Mon {Monde}", "Terra Nova", "世界"]) {
      const messages = withBrand(withFallback(en as never, fr as never), { brand: icuEscape(name), brandLogo: icuEscape(name.replace(/\W/g, "").toLowerCase()) });
      const t = createTranslator({ locale: "fr", messages: messages as never }) as unknown as (key: string) => string;
      expect(t("meta.siteName"), name).toBe(name);
      expect(t("nav.home"), name).toContain(name.replace(/\W/g, "").toLowerCase());
      expect(t("meta.description"), name).toContain(name);
    }
    expect(BRAND_ICU).toBe(icuEscape(BRAND.name));
  });
});
