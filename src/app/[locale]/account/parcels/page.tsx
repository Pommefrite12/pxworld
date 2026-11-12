import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/layout/PageShell";
import { Link } from "@/i18n/navigation";
import { requirePageViewer } from "@/lib/auth/guards";
import { getParcelsOf, getUserStats } from "@/lib/data/parcels";
import { assetUrl } from "@/lib/images/sizes";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false } };

export default async function MyParcels({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const v = await requirePageViewer(locale, "/account/parcels");
  const [t, f, parcels, stats] = await Promise.all([getTranslations("account.parcels"), getFormatter(), getParcelsOf(v.user.id), getUserStats(v.user.id)]);
  return (
    <PageShell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold">{t("title")}</h1>
          <p className="mt-1 text-ink-soft">{t("summary", { parcels: f.number(stats.parcels), pixels: f.number(stats.pixels) })}</p>
        </div>
        <Link href="/map" className="btn btn-primary">{t("buyMore")}</Link>
      </div>
      {parcels.length === 0 ? (
        <div className="card mt-8 p-10 text-center"><p className="text-lg font-semibold">{t("empty")}</p><Link href="/map" className="btn btn-primary mt-4">{t("findSpot")}</Link></div>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {parcels.map((p) => {
            const covered = p.status === "covered";
            const status = p.hidden ? "hidden" : p.pending_asset_id ? "pending" : p.published_asset_id ? "live" : p.last_rejection ? "rejected" : "awaiting";
            const tone = { live: "bg-mint/15 text-[#0b7a5a]", pending: "bg-warn/15 text-warn", hidden: "bg-danger/10 text-danger", rejected: "bg-danger/10 text-danger", awaiting: "bg-paper-2 text-ink-soft" }[status];
            const cx = p.x + p.w / 2, cy = p.y + p.h / 2, z = Math.max(1, Math.min(24, 600 / Math.max(p.w, p.h)));
            return (
              <li key={p.id} className="card flex gap-4 p-4" data-testid="my-parcel">
                <div className="checker grid h-28 w-28 shrink-0 place-items-center rounded-xl">
                  {p.published_asset_id
                    ? <img src={assetUrl(p.published_asset_id, 240)} alt={p.title ?? ""} className="pixelated h-full w-full object-contain" style={{ imageRendering: "pixelated" }} />
                    : <span className="px-2 text-center text-xs text-ink-faint">{t("noImage")}</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{p.title ?? t("untitled")}</p>
                  <p className="pixel-num text-xs text-ink-soft">{p.w}×{p.h} · {f.number(p.area)} px · @{p.x},{p.y}</p>
                  <span className={`chip mt-1.5 ${tone}`}>{t(`status.${status}`)}</span>
                  {p.tier === "free" && <span className="chip mt-1.5 ml-1.5" data-testid="my-parcel-free">{t("free")}</span>}
                  {covered && p.covered_at && <p className="mt-1 text-xs text-ink-soft" data-testid="my-parcel-covered">{t("covered", { date: f.dateTime(p.covered_at, { dateStyle: "long" }) })}</p>}
                  {p.last_rejection && !p.pending_asset_id && !p.published_asset_id && <p className="mt-1 text-xs text-danger">{t("rejectedBecause", { reason: p.last_rejection })}</p>}
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <Link className="btn btn-ghost btn-sm" href={covered ? `/archive/${p.code}` : `/p/${p.code}`}>{t("view")}</Link>
                    {!covered && <Link className="btn btn-ghost btn-sm" href={`/map?x=${Math.round(cx)}&y=${Math.round(cy)}&z=${Number(z.toPrecision(3))}&p=${p.code}`}>{t("onMap")}</Link>}
                    {!covered && <Link className="btn btn-ink btn-sm" href={`/account/parcels/${p.code}/edit`}>{t("edit")}</Link>}
                    {!covered && <Link className="btn btn-ghost btn-sm" href={`/account/parcels/${p.code}/edit#collab`} data-testid="draw-together-link">{t("drawTogether")}</Link>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
