import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { GlobeView } from "@/components/globe/GlobeView";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { getHeaderViewer } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "globe" });
  return { title: t("title"), robots: { index: false, follow: false } }; // prototype: kept out of search engines
}

const num = (v: string | string[] | undefined) => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null);

/** The header needs the signed-in user (a database round trip): it streams in after the globe instead of delaying it. */
async function Header() {
  const viewer = await getHeaderViewer().catch(() => null);
  return <SiteHeader viewer={viewer} />;
}

export default async function GlobePage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "globe" });
  const lon = num(sp.lon), lat = num(sp.lat), zoom = num(sp.zoom);
  const given = lon !== null && lat !== null && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;

  return (
    <main id="main" className="flex h-dvh flex-col">
      <Suspense fallback={<SiteHeader viewer={null} />}>
        <Header />
      </Suspense>
      <h1 className="sr-only">{t("title")}</h1>
      <div className="relative min-h-0 flex-1">
        {/* with no place given the globe turns by itself, centred on Europe/Africa */}
        <GlobeView initial={{ lon: given ? lon : 12, lat: given ? lat : 22, spin: !given, zoom: given && zoom !== null ? zoom : undefined }} />
      </div>
    </main>
  );
}
