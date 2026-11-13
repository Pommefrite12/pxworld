import type { Metadata } from "next";
import { DEFAULT_PRICING } from "@/lib/grid/pricing";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { MapShell } from "@/components/map/MapShell";
import { getHeaderViewer, getSessionUser } from "@/lib/auth/session";
import { getFreeStatus } from "@/lib/data/free";
import { getEdition } from "@/lib/data/edition";
import { toPublicEdition } from "@/lib/edition";
import { getPricing, getPublicStats } from "@/lib/data/map";
import { headers } from "next/headers";
import { requestCurrency } from "@/lib/currency-server";
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
  const owner = p.tier === "illustration" ? t("illustration") : p.owner.username; // an illustration has no author
  const description = p.creation?.description ?? t("shareDescription", { owner, w: p.w, h: p.h, area: f.number(p.area) });
  const url = `${siteUrl()}${path(locale, code)}`;
  const image = `${siteUrl()}/api/og/parcel/${code}${locale === "fr" ? "?lang=fr" : ""}`; // in the language of the page
  return {
    title: `${title} — ${owner}`,
    description,
    alternates: { canonical: url, languages: Object.fromEntries(locales.map((l) => [l, `${siteUrl()}${path(l, code)}`])) },
    openGraph: { type: "website", url, title: `${title} — ${owner}`, description, images: [{ url: image, width: 1200, height: 630, alt: title }], locale },
    twitter: { card: "summary_large_image", title: `${title} — ${owner}`, description, images: [image] },
    robots: { index: !p.hidden },
  };
}

/** Permanent URL of a parcel: opens the map at the right place and zoom, with the parcel card open. */
export default async function ParcelPage({ params }: { params: Promise<{ locale: string; code: string }> }) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  const p = await getPublicParcel(code);
  if (!p) notFound();
  if (p.status === "covered") redirect({ href: `/archive/${p.code}`, locale }); // covered: not on the map any more, its place is the archive
  const currency = requestCurrency(await headers()); // euros in the euro area, dollars elsewhere
  const [stats, pricing, viewer, t, edition, free] = await Promise.all([getPublicStats().catch(() => null), getPricing(currency).catch(() => null), getHeaderViewer(), getTranslations("parcel"), getEdition().catch(() => null), getSessionUser().then((u) => getFreeStatus(u?.id ?? null), () => getFreeStatus(null))]);
  const scale = Math.max(0.5, Math.min(24, 360 / Math.max(p.w, p.h)));
  return (
    <main id="main">
      {/* Crawlable summary of what the map shows */}
      <article className="sr-only">
        <h1>{p.creation?.title ?? t("untitled")}</h1>
        <p>{p.tier === "illustration" ? t("illustration") : p.owner.username} — {p.w}×{p.h} px ({p.x}, {p.y})</p>
        {p.creation?.description && <p>{p.creation.description}</p>}
      </article>
      <MapShell
        stats={stats}
        viewer={viewer}
        edition={edition ? toPublicEdition(edition) : null}
        free={free}
        pricing={pricing ?? DEFAULT_PRICING}
        initial={{ camera: { x: p.x + p.w / 2 - 190 / scale, y: p.y + p.h / 2, scale }, parcelCode: p.code, buy: null }}
      />
    </main>
  );
}
