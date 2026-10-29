import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/layout/PageShell";
import { ProfileForm } from "@/components/account/ProfileForm";
import { Link } from "@/i18n/navigation";
import { requirePageViewer } from "@/lib/auth/guards";
import { getUserStats } from "@/lib/data/parcels";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false } };

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const v = await requirePageViewer(locale, "/account");
  const [t, f, stats] = await Promise.all([getTranslations("account"), getFormatter(), getUserStats(v.user.id)]);
  return (
    <PageShell width="max-w-3xl">
      <h1 className="text-3xl font-extrabold">{t("title")}</h1>
      <p className="mt-1 text-ink-soft">{t("memberSince", { date: f.dateTime(v.profile.created_at, { dateStyle: "long" }) })}</p>
      <dl className="my-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="card p-4"><dt className="text-xs text-ink-faint">{t("parcels")}</dt><dd className="pixel-display text-4xl" data-testid="stat-parcels">{f.number(stats.parcels)}</dd></div>
        <div className="card p-4"><dt className="text-xs text-ink-faint">{t("pixels")}</dt><dd className="pixel-display text-4xl" data-testid="stat-pixels">{f.number(stats.pixels)}</dd></div>
        <div className="card col-span-2 flex items-center justify-between gap-3 p-4 sm:col-span-1">
          <Link href="/account/parcels" className="btn btn-ink btn-sm">{t("myParcels")}</Link>
          <Link href="/account/orders" className="btn btn-ghost btn-sm">{t("orders")}</Link>
        </div>
      </dl>
      <ProfileForm initial={{ username: v.profile.username, country: v.profile.country, bio: v.profile.bio, avatarId: v.profile.avatar_path ? v.profile.id : null, avatarV: (v.profile.avatar_path ?? "").slice(-16) }} />
      <p className="mt-4 text-sm text-ink-soft">{t("publicProfile")} <Link className="font-semibold text-cobalt underline" href={`/u/${v.profile.username}`}>/u/{v.profile.username}</Link></p>
    </PageShell>
  );
}
