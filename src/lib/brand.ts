/**
 * THE NAME OF THE SITE — the one place where it is written.
 *
 * Renaming the site = editing this file (and nothing else): the texts of the four languages (`{brand}` in `src/messages/*.json`, filled in by
 * `src/i18n/request.ts`), the logo, the share images, the e-mails-like texts (archive manifest, Stripe descriptions, alerts, translation prompt),
 * the page titles and the tests all read it from here. `tests/unit/brand.test.ts` fails if the name is written anywhere else in `src/`.
 *
 * What is NOT renamed on purpose: technical identifiers that data or deployments already depend on (database name `pixelworld`, the storage
 * bucket `pixel-world-creations`, the salts, the archive format id `pixel-world-archive/1`, the npm package name, the migrations). Renaming those
 * would break a running site for no visible benefit; see docs/ARCHITECTURE.md ("Renaming the site").
 *
 * Pure (no `server-only`, no React): the server, the client components, the scripts and the tests can all import it.
 */

/** One piece of the logo's name: set in the site's pixel font if `pixel` (in the text colour), otherwise in the display font and the signal (gold) colour. */
export interface WordmarkPart {
  text: string;
  pixel?: boolean;
}

export interface Brand {
  /** How the name is written in sentences, titles, e-mails and metadata. */
  name: string;
  /** The name as it is drawn in the logo, piece by piece, left to right (case and spacing of the visual identity, not of sentences). */
  wordmark: WordmarkPart[];
}

/** "Hieropix": hiéro(glyphes), writing carved to last, + pix(el). Chosen by the owner (variant A of the logo board: "hiero" in gold, "pix" in the pixel font). No accent in the name, so that it is the same in a web address and in English. */
export const BRAND: Brand = {
  name: "Hieropix",
  wordmark: [{ text: "hiero" }, { text: "pix", pixel: true }],
};

/** The name in capitals, for plain-text headings (the archive's README). */
export const BRAND_UPPER = BRAND.name.toUpperCase();

/** A name made safe to be read as ICU MessageFormat (apostrophes and curly braces are escaped). */
export const icuEscape = (name: string): string => name.replace(/'/g, "''").replace(/[{}]/g, (c) => `'${c}'`);

/** The name as the logo draws it (`hiero` + `pix` → "hieropix"). The accessible name of the logo link must contain exactly this visible text (WCAG 2.5.3, "label in name"): `nav.home` uses `{brandLogo}`. */
export const BRAND_LOGO_TEXT = BRAND.wordmark.map((p) => p.text).join("");

/** What `{brand}` and `{brandLogo}` stand for in the message files. */
export const BRAND_ICU = icuEscape(BRAND.name);
export const BRAND_LOGO_ICU = icuEscape(BRAND_LOGO_TEXT);
