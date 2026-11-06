import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ArchiveChips } from "@/components/archive/ArchiveChips";
import { ShareButton } from "@/components/archive/ShareButton";
import { PageShell } from "@/components/layout/PageShell";
import { Link } from "@/i18n/navigation";
import { getEdition } from "@/lib/data/edition";
import { getPublicParcel } from "@/lib/data/parcels";
import { siteUrl } from "@/lib/env";
import { assetUrl } from "@/lib/images/sizes";
import { locales } from "@/i18n/routing";
import { hostOf } from "@/lib/security/url";

export const dynamic = "force-dynamic";

const path = (locale: string, code: string) => `${locale === "en" ? "" : `/${locale}`}/archive/${code}`;

export async function generateMetadata({ params }: { params: Promise<{ locale: string; code: string }> }): Promise<Metadata> {
  const { locale, code } = await params;
  const p = await getPublicParcel(code).catch(() => null);
  if (!p) return { title: "Pixel World", robots: { index: false } };
  const t = await getTranslations({ locale, namespace: "archive.page" });
  const title = p.creation?.title ?? t("untitled");
  const description = p.creation?.description ?? t("descriptionFallback", { author: p.owner.username });
  const url = `${siteUrl()}${path(locale, code)}`;
  const image = `${siteUrl()}/api/og/parcel/${code}`;
  return {
    title: `${title} — ${p.owner.username}`,
    description,
    alternates: { canonical: url, languages: Object.fromEntries(locales.map((l) => [l, `${siteUrl()}${path(l, code)}`])) },
    openGraph: { type: "article", url, title: `${title} — ${p.owner.username}`, description, images: [{ url: image, width: 1200, height: 630, alt: title }], locale },
    twitter: { card: "summary_large_image", title: `${title} — ${p.owner.username}`, description, images: [image] },
    robots: { index: Boolean(p.creation) && !p.hidden },
  };
}

/**
 * The page of ONE trace in the archive: the creation, its title and description, who made it, when it was archived (the day the payment
 * was confirmed), what it is about and where, which edition it belongs to, and a way to share it. Readable on its own, without the map
 * (the permanent address /p/<code> opens the map on the parcel, with its card).
 */
export default async function ArchivePage({ params }: { params: Promise<{ locale: string; code: string }> }) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  const p = await getPublicParcel(code);
  if (!p) notFound();
  const [t, f, edition] = await Promise.all([getTranslations("archive.page"), getFormatter(), getEdition()]);
  const te = await getTranslations("archive.editions");
  const c = p.creation;
  const title = c?.title ?? t("untitled");
  const shown = Math.max(1, Math.floor(512 / Math.max(p.w, p.h)));
  const size = shown >= 1 && Math.max(p.w, p.h) <= 512 ? { width: p.w * shown, height: p.h * shown } : { width: 512, height: Math.round((512 * p.h) / p.w) };
  const editionName = p.edition ? (te.has(p.edition.slug) ? te(p.edition.slug) : p.edition.name) : null;
  return (
    <PageShell width="max-w-3xl">
      <article data-testid="archive-page" data-code={p.code}>
        <p className="text-sm font-semibold uppercase tracking-wide text-ink-faint">{t("eyebrow")}{editionName ? ` · ${editionName}` : ""}</p>
        <h1 className="mt-1 text-3xl font-extrabold leading-tight sm:text-4xl" data-testid="archive-title">{title}</h1>
        <p className="mt-2 text-ink-soft">
          {t("by")} <Link href={`/u/${p.owner.username}`} className="font-semibold text-ink underline underline-offset-2" data-testid="archive-author">{p.owner.username}</Link>
          {" · "}<span data-testid="archive-date">{p.activated_at ? t("archivedOn", { date: f.dateTime(p.activated_at, { dateStyle: "long" }) }) : ""}</span>
        </p>
        {c && <ArchiveChips className="mt-3" category={c.category} placeLabel={c.place_label} placeCountry={c.place_country} />}

        <div className="checker mt-6 grid place-items-center rounded-2xl p-4 shadow-float" style={{ minHeight: 160 }}>
          {c ? (
            // eslint-disable-next-line @next/next/no-img-element -- a pixel creation, drawn crisp at an integer scale
            <img src={assetUrl(c.asset_id, 1024)} alt={t("imageAlt", { title })} className="max-w-full" style={{ imageRendering: "pixelated", ...size }} data-testid="archive-image" />
          ) : (
            <p className="max-w-md px-4 py-10 text-center text-ink-soft" data-testid="archive-pending">{p.hidden ? t("hidden") : t("pending")}</p>
          )}
        </div>

        {c?.description && <p className="mt-6 max-w-2xl whitespace-pre-line text-lg" data-testid="archive-description">{c.description}</p>}
        {c?.link_url && (
          <p className="mt-3"><a href={c.link_url} target="_blank" rel={`noopener noreferrer nofollow ugc${c.is_commercial ? " sponsored" : ""}`} className="break-all font-semibold text-cobalt underline underline-offset-2">{hostOf(c.link_url)} ↗</a></p>
        )}

        <dl className="mt-8 grid grid-cols-2 gap-4 border-t border-line pt-5 text-sm sm:grid-cols-4">
          <div><dt className="text-ink-faint">{t("edition")}</dt><dd className="font-semibold" data-testid="archive-edition">{editionName ?? "—"}</dd></div>
          <div><dt className="text-ink-faint">{t("size")}</dt><dd className="pixel-num font-semibold">{t("size_value", { w: p.w, h: p.h })}</dd></div>
          {p.kind === "water" && <div className="sm:col-span-1"><dt className="sr-only">{t("size")}</dt><dd className="font-semibold">{t("kindWater")}</dd></div>}
          <div><dt className="sr-only">♥</dt><dd className="font-semibold">{t("likes", { n: p.likes })}</dd></div>
        </dl>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <ShareButton title={`${title} — ${p.owner.username}`} text={t("shareText", { title })} />
          <Link href={`/p/${p.code}`} className="btn btn-ghost" data-testid="archive-on-map">{t("seeOnMap")}</Link>
        </div>
        {edition?.state === "closed" && <p className="mt-8 rounded-2xl bg-paper-2 p-4 text-sm text-ink-soft" data-testid="archive-closed">{t("closedNote")}</p>}
      </article>
    </PageShell>
  );
}
