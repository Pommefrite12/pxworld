import { isLocale, type Locale } from "@/i18n/routing";

/** The language of the page that asks for a payment (any of the site's languages; English when unknown). */
export const requestLocale = (v: unknown): Locale => (typeof v === "string" && isLocale(v) ? v : "en");
/** Stripe's own pages: it has all four (`zh` is Simplified Chinese). */
export const stripeLocale = (v: string): "en" | "fr" | "es" | "zh" => (v === "fr" || v === "es" || v === "zh" ? v : "en");
