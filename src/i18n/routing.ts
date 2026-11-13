import { defineRouting } from "next-intl/routing";

/** Add a language: create src/messages/<code>.json (English completes what it leaves out), append the code here and see `docs/ARCHITECTURE.md` §5 for the few other places (share images, Stripe, country names). */
export const locales = ["en", "fr", "es", "zh"] as const;
export type Locale = (typeof locales)[number];

export const routing = defineRouting({
  locales,
  defaultLocale: "en",
  localePrefix: "as-needed", // English at /, the others at /fr, /es, /zh
});

export const localeNames: Record<Locale, string> = { en: "English", fr: "Français", es: "Español", zh: "简体中文" };

/** Languages whose legal texts (terms, privacy, rules, credits) are NOT translated yet: they are shown in English, with a mention (the lawyer reviews the English and French versions first). */
export const legalInEnglishOnly: readonly Locale[] = ["es", "zh"];
export const isLocale = (v: string): v is Locale => (locales as readonly string[]).includes(v);
