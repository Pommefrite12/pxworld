import { describe, expect, it } from "vitest";
import { legalInEnglishOnly, localeNames, locales, isLocale } from "@/i18n/routing";
import { ogLang, ogLangQuery } from "@/lib/og/lang";
import { requestLocale, stripeLocale } from "@/lib/stripe/locale";
import { countryNamer, nameLang } from "@/components/map/countryName";

describe("the four languages", () => {
  it("are English (the default, at /), French, Spanish and Simplified Chinese, each with a name in its own language", () => {
    expect([...locales]).toEqual(["en", "fr", "es", "zh"]);
    expect(localeNames).toEqual({ en: "English", fr: "Français", es: "Español", zh: "简体中文" });
    expect(["en", "fr", "es", "zh"].every(isLocale)).toBe(true);
    expect(isLocale("de")).toBe(false);
  });
  it("show their legal texts in English, with a mention, until the lawyer has reviewed them (Spanish and Chinese only)", () => {
    expect([...legalInEnglishOnly]).toEqual(["es", "zh"]);
  });
  it("have their own share-image words for French and Spanish; Chinese (no letters in the pixel font) and the rest are English", () => {
    expect([ogLang("fr"), ogLang("es"), ogLang("zh"), ogLang("en"), ogLang(null), ogLang("de")]).toEqual(["fr", "es", "en", "en", "en", "en"]);
    expect([ogLangQuery("en"), ogLangQuery("fr"), ogLangQuery("es"), ogLangQuery("zh")]).toEqual(["", "?lang=fr", "?lang=es", ""]);
  });
  it("give Stripe's pages their language (it has all four) and refuse anything else", () => {
    expect([stripeLocale("fr"), stripeLocale("es"), stripeLocale("zh"), stripeLocale("en"), stripeLocale("xx")]).toEqual(["fr", "es", "zh", "en", "en"]);
    expect([requestLocale("es"), requestLocale("zh"), requestLocale("de"), requestLocale(undefined), requestLocale({})]).toEqual(["es", "zh", "en", "en", "en"]);
  });
  it("name the countries in the language of the page: French and English from the data, Spanish and Chinese from the language data of the browser", () => {
    const c = { code: "DE", en: "Germany", fr: "Allemagne" };
    expect([nameLang("fr"), nameLang("es"), nameLang("zh"), nameLang("en"), nameLang("de"), nameLang(undefined)]).toEqual(["fr", "es", "zh", "en", "en", "en"]);
    expect([countryNamer("en")(c), countryNamer("fr")(c), countryNamer("es")(c), countryNamer("zh")(c)]).toEqual(["Germany", "Allemagne", "Alemania", "德国"]);
    expect(countryNamer("es")({ code: null, en: "Somaliland", fr: "Somaliland" })).toBe("Somaliland"); // a place without a country code keeps its English name
  });
});
