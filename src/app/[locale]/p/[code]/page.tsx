import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { MapShell } from "@/components/map/MapShell";
import { getHeaderViewer } from "@/lib/auth/session";
import { getPricing, getPublicStats } from "@/lib/data/map";
import { getPublicParcel } from "@/lib/data/parcels";
import { siteUrl } from "@/lib/env";
import { locales } from "@/i18n/routing";

export const dynamic = "force-dynamic";

const path = (locale: string, code: string) => `${locale === "en" ? "" : `/${locale}`}/p/${code}`;

export async function generateMetadata({ params }: { params: Promise<{ locale: string; code: string }> }): Promise<Metadata> {
  const { locale, code } = await params;
  const p = await getPublicParcel(code).catch(() => null);
  if (!p) return { title: "Pixel World", robots: { index: false } };
  const t = await getTranslations({ locale, namespace: "parcel" });
  const f = await getFormatter({ locale });
  const title = p.creation?.title ?? t("untitled");
  const description = p.creation?.description ?? t("shareDescription", { owner: p.owner.username, w: p.w, h: p.h, area: f.number(p.area) });
  const url = `${siteUrl()}${path(locale, code)}`;
  const image = `${siteUrl()}/api/og/parcel/${code}`;
  return {
    title: `${title} — ${p.owner.username}`,
    description,
    alternates: { canonical: url, languages: Object.fromEntries(locales.map((l) => [l, `${siteUrl()}${path(l, code)}`])) },
    openGraph: { type: "website", url, title: `${title} — ${p.owner.username}`, description, images: [{ url: image, width: 1200, height: 630, alt: title }], locale },
    twitter: { card: "summary_large_image", title: `${title} — ${p.owner.username}`, description, images: [image] },
    robots: { index: !p.hidden },
  };
}

/** Permanent URL of a parcel: opens the map at the right place and zoom, with the parcel card open. */
export default async function ParcelPage({ params }: { params: Promise<{ locale: string; code: string }> }) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  const p = await getPublicParcel(code);
  if (!p) notFound();
  const [stats, pricing, viewer, t] = await Promise.all([getPublicStats().catch(() => null), getPricing().catch(() => null), getHeaderViewer(), getTranslations("parcel")]);
  const scale = Math.max(0.5, Math.min(24, 360 / Math.max(p.w, p.h)));
  return (
    <main id="main">
      {/* Crawlable summary of what the map shows */}
      <article className="sr-only">
        <h1>{p.creation?.title ?? t("untitled")}</h1>
        <p>{p.owner.username} — {p.w}×{p.h} px ({p.x}, {p.y})</p>
        {p.creation?.description && <p>{p.creation.description}</p>}
      </article>
      <MapShell
        stats={stats}
        viewer={viewer}
        pricing={pricing ?? { unitPriceCents: 100, currency: "eur", minArea: 100, maxArea: 250_000, salesOpen: false }}
        initial={{ camera: { x: p.x + p.w / 2 - 190 / scale, y: p.y + p.h / 2, scale }, parcelCode: p.code, buy: null }}
      />
    </main>
  );
}
