/**
 * The language of a share image: French and Spanish have their own words; everything else is English (the pixel font and the renderer's font
 * have no Chinese letters, so a Chinese page is shared with English words; a title or a name that uses letters they lack is set in the
 * renderer's own font, see `fitsPixelFont`).
 */
export type OgLang = "en" | "fr" | "es";
export const ogLang = (v: string | null | undefined): OgLang => (v === "fr" || v === "es" ? v : "en");
/** The query string that asks for it (empty for English: the default). */
export const ogLangQuery = (locale: string): string => (ogLang(locale) === "en" ? "" : `?lang=${ogLang(locale)}`);
