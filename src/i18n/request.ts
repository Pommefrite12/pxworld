import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

type Messages = Record<string, unknown>;
const isObject = (v: unknown): v is Messages => typeof v === "object" && v !== null && !Array.isArray(v);
/** `fallback` with everything `own` has put on top of it (objects merge, anything else replaces). */
export function withFallback(fallback: Messages, own: Messages): Messages {
  const out: Messages = { ...fallback };
  for (const [k, v] of Object.entries(own)) out[k] = isObject(v) && isObject(out[k]) ? withFallback(out[k] as Messages, v) : v;
  return out;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const base = (await import("../messages/en.json")).default as unknown as Messages;
  if (locale === "en") return { locale, messages: base };
  // English fills what a language does not translate (the staff back office, the legal texts of a language not reviewed yet): a missing key never breaks a page
  return { locale, messages: withFallback(base, (await import(`../messages/${locale}.json`)).default as unknown as Messages) };
});
