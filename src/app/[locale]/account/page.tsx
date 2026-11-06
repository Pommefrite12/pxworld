import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/layout/PageShell";
import { ProfileForm } from "@/components/account/ProfileForm";
import { Link } from "@/i18n/navigation";
import { requirePageViewer } from "@/lib/auth/guards";
import { getUserStats } from "@/lib/data/parcels";
import { accountNews } from "@/lib/data/news";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false } };

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const v = await requirePageViewer(locale, "/account");
  const [t, tn, f, stats, news] = await Promise.all([getTranslations("account"), getTranslations("account.news"), getFormatter(), getUserStats(v.user.id), accountNews(v.user.id)]);
  return (
    <PageShell width="max-w-3xl">
      <h1 className="text-3xl font-extrabold">{t("title")}</h1>
      <p className="mt-1 text-ink-soft">{t("memberSince", { date: f.dateTime(v.profile.created_at, { dateStyle: "long" }) })}</p>
      {news.length > 0 && (
        <section aria-label={tn("title")} className="card mt-6 space-y-2 p-4" data-testid="account-news">
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-ink-faint">{tn("title")}</h2>
          <ul className="space-y-2">
            {news.map((n, i) => (
              <li key={i} className="text-sm" data-testid={`news-${n.kind}`}>
                {n.kind === "project_open" && <>{tn("projectOpen", { title: n.title })}{n.until ? ` ${tn("until", { date: f.dateTime(n.until, { dateStyle: "long" }) })}` : ""} <Link href="/account/campaigns" className="font-semibold text-cobalt underline">{tn("see")}</Link></>}
                {n.kind === "project_rejected" && <>{tn("projectRejected", { title: n.title })}{n.reason ? ` ${tn("reason", { reason: n.reason })}` : ""} <Link href="/account/campaigns" className="font-semibold text-cobalt underline">{tn("see")}</Link></>}
                {n.kind === "project_funded" && <>{tn("projectFunded", { title: n.title })} <Link href={n.parcelCode ? `/p/${n.parcelCode}` : "/account/campaigns"} className="font-semibold text-cobalt underline">{tn("seeParcel")}</Link></>}
                {n.kind === "project_expired" && <>{tn("projectExpired", { title: n.title })} <Link href="/account/campaigns" className="font-semibold text-cobalt underline">{tn("see")}</Link></>}
                {n.kind === "comments" && <>{tn("comments", { n: n.count, title: n.title })} <Link href={`/p/${n.code}`} className="font-semibold text-cobalt underline">{tn("read")}</Link></>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <dl className="my-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="card p-4"><dt className="text-xs text-ink-faint">{t("statParcels")}</dt><dd className="pixel-display text-4xl" data-testid="stat-parcels">{f.number(stats.parcels)}</dd></div>
        <div className="card p-4"><dt className="text-xs text-ink-faint">{t("pixels")}</dt><dd className="pixel-display text-4xl" data-testid="stat-pixels">{f.number(stats.pixels)}</dd></div>
        <div className="card col-span-2 flex flex-wrap items-center justify-between gap-3 p-4 sm:col-span-3">
          <Link href="/account/parcels" className="btn btn-ink btn-sm">{t("myParcels")}</Link>
          <Link href="/account/orders" className="btn btn-ghost btn-sm">{t("ordersLink")}</Link>
          <Link href="/account/campaigns" className="btn btn-ghost btn-sm" data-testid="my-campaigns">{t("myCampaigns")}</Link>
        </div>
      </dl>
      <ProfileForm initial={{ username: v.profile.username, country: v.profile.country, bio: v.profile.bio, avatarId: v.profile.avatar_path ? v.profile.id : null, avatarV: (v.profile.avatar_path ?? "").slice(-16) }} />
      <p className="mt-4 text-sm text-ink-soft">{t("publicProfile")} <Link className="font-semibold text-cobalt underline" href={`/u/${v.profile.username}`}>/u/{v.profile.username}</Link></p>
    </PageShell>
  );
}
