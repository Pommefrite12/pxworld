import { describe, expect, it } from "vitest";
import { normaliseLanguage, parseAnswer } from "@/lib/i18n/autotranslate";

const four = (over: Record<string, { title: string; description: string }> = {}, source = "fr") => JSON.stringify({
  source_language: source,
  fr: { title: "Titre", description: "Description" }, en: { title: "Title", description: "Description EN" },
  es: { title: "Título", description: "Descripción" }, zh: { title: "标题", description: "描述" }, ...over,
});

describe("reading Claude's answer", () => {
  it("keeps the translations into the languages other than the one the text is written in", () => {
    const r = parseAnswer(four(), { title: "Titre", description: "Description" })!;
    expect(r.source).toBe("fr");
    expect(Object.keys(r.texts).sort()).toEqual(["en", "es", "zh"]); // the original is shown in its own language: nothing is stored for it
    expect(r.texts.en).toEqual({ title: "Title", description: "Description EN" });
  });

  it("stores all four when the text is in another language (German, say)", () => {
    expect(Object.keys(parseAnswer(four({}, "de"), { title: "Titel", description: "Beschreibung" })!.texts).sort()).toEqual(["en", "es", "fr", "zh"]);
  });

  it("normalises the language code", () => {
    expect(normaliseLanguage("zh-CN")).toBe("zh");
    expect(normaliseLanguage(" EN ")).toBe("en");
    expect(normaliseLanguage("French (France)")).toBe("und"); // not a code: unknown, shown as "automatic translation" without a language
    expect(normaliseLanguage("")).toBe("und");
  });

  it("refuses anything that is not the fixed shape: not JSON, a language missing, a text that is not a string", () => {
    const t = { title: "a b c", description: "d e f" };
    expect(parseAnswer("sure! here is your translation", t)).toBeNull();
    expect(parseAnswer(JSON.stringify({ source_language: "fr", fr: { title: "x", description: "y" } }), t)).toBeNull();
    expect(parseAnswer(four({ en: { title: 5 as unknown as string, description: "x" } }), t)).toBeNull();
    expect(parseAnswer("null", t)).toBeNull();
  });

  it("keeps a missing title missing, strips control and direction characters, and bounds the length", () => {
    const r = parseAnswer(four({ en: { title: "Hello‮\u0000world", description: "x".repeat(5000) } }), { title: null, description: "Description" })!;
    expect(r.texts.en!.title).toBeNull(); // there was no title: there is none
    expect(r.texts.en!.description!.length).toBeLessThanOrEqual(800);
    const r2 = parseAnswer(four({ en: { title: "Hello‮\u0000world", description: "d" } }), { title: "Titre", description: "d" })!;
    expect(r2.texts.en!.title).toBe("Hello world"); // the direction override and the null are gone
  });

  it("falls back to the original when a translation comes back empty", () => {
    const r = parseAnswer(four({ en: { title: "", description: "" } }), { title: "Titre", description: "Description" })!;
    expect(r.texts.en).toEqual({ title: "Titre", description: "Description" });
  });
});
