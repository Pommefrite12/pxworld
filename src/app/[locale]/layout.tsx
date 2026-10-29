import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing, locales } from "@/i18n/routing";
import { siteUrl } from "@/lib/env";
import "../globals.css";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: `${t("siteName")} — ${t("tagline")}`, template: `%s · ${t("siteName")}` },
    description: t("description"),
    applicationName: t("siteName"),
    openGraph: { type: "website", siteName: t("siteName"), title: `${t("siteName")} — ${t("tagline")}`, description: t("description"), locale, images: [{ url: `/api/og/home?lang=${locale}`, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: `${t("siteName")} — ${t("tagline")}`, description: t("description"), images: [`/api/og/home?lang=${locale}`] },
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#fbf8f2", colorScheme: "light" };

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <html lang={locale}>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white">Skip to content</a>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
