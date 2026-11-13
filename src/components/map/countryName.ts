/**
 * The name of a country in the language of the page. The data holds English and French; Spanish and Chinese come from the browser's own language data
 * (`Intl.DisplayNames`, by ISO code). Cities keep their English (or French) names in every other language: the data has no more.
 */
export type NameLang = "en" | "fr" | "es" | "zh";
export const nameLang = (v: string | undefined | null): NameLang => (v === "fr" || v === "es" || v === "zh" ? v : "en");

export function countryNamer(lang: NameLang): (c: { code: string | null; en: string; fr: string }) => string {
  if (lang === "en") return (c) => c.en;
  if (lang === "fr") return (c) => c.fr;
  let names: Intl.DisplayNames | null = null;
  try { names = new Intl.DisplayNames([lang], { type: "region" }); } catch { /* an old browser: English */ }
  const cache = new Map<string, string>();
  return (c) => {
    let n = cache.get(c.code ?? c.en);
    if (n === undefined) {
      try { n = names && c.code && /^[A-Za-z]{2}$/.test(c.code) ? names.of(c.code) ?? c.en : c.en; } catch { n = c.en; }
      cache.set(c.code ?? c.en, n);
    }
    return n;
  };
}
