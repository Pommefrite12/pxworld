import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { BRAND_ICU } from "@/lib/brand";
import { routing } from "./routing";

type Messages = Record<string, unknown>;
const isObject = (v: unknown): v is Messages => typeof v === "object" && v !== null && !Array.isArray(v);
/** `fallback` with everything `own` has put on top of it (objects merge, anything else replaces). */
export function withFallback(fallback: Messages, own: Messages): Messages {
  const out: Messages = { ...fallback };
  for (const [k, v] of Object.entries(own)) out[k] = isObject(v) && isObject(out[k]) ? withFallback(out[k] as Messages, v) : v;
  return out;
}

/** Every `{brand}` of the message files becomes the name of the site (see `src/lib/brand.ts`). Done once per language, before the ICU parsing, so a name can sit next to an apostrophe (`l'{brand}`) like any other word. Lists of texts (the legal pages) are walked too. */
export function withBrand<T>(value: T, brand = BRAND_ICU): T {
  if (typeof value === "string") return value.replaceAll("{brand}", brand) as T;
  if (Array.isArray(value)) return value.map((v) => withBrand(v, brand)) as T;
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withBrand(v, brand)])) as T;
  return value;
}

/** The merged messages of each language, built once (in development they are rebuilt each time, so an edited message file shows up without a restart). */
const ready = new Map<string, Messages>();
const keep = process.env.NODE_ENV === "production";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const known = keep ? ready.get(locale) : undefined;
  if (known) return { locale, messages: known };
  const base = (await import("../messages/en.json")).default as unknown as Messages;
  // English fills what a language does not translate (the staff back office, the legal texts of a language not reviewed yet): a missing key never breaks a page
  const merged = locale === "en" ? base : withFallback(base, (await import(`../messages/${locale}.json`)).default as unknown as Messages);
  const messages = withBrand(merged);
  if (keep) ready.set(locale, messages);
  return { locale, messages };
});
