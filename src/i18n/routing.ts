import { defineRouting } from "next-intl/routing";

/** Add a language: create src/messages/<code>.json and append the code here. Nothing else changes. */
export const locales = ["en", "fr"] as const;
export type Locale = (typeof locales)[number];

export const routing = defineRouting({
  locales,
  defaultLocale: "en",
  localePrefix: "as-needed", // English at /, French at /fr
});

export const localeNames: Record<Locale, string> = { en: "English", fr: "Français" };
export const isLocale = (v: string): v is Locale => (locales as readonly string[]).includes(v);
