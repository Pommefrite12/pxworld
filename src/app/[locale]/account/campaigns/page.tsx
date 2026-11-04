import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/layout/PageShell";
import { CancelCampaignButton } from "@/components/account/CancelCampaignButton";
import { Link } from "@/i18n/navigation";
import { requirePageViewer } from "@/lib/auth/guards";
import { campaignsOf } from "@/lib/data/campaigns";
import { formatMoney } from "@/lib/grid/pricing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false } };

/** The projects of the signed-in user: what they asked several people to fund, and where each one stands. */
export default async function MyCampaigns({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const v = await requirePageViewer(locale, "/account/campaigns");
  const [t, f, items] = await Promise.all([getTranslations("account.campaigns"), getFormatter(), campaignsOf(v.user.id)]);
  const tone = { pending: "", open: "!bg-mint/15 !text-[#0b7a5a]", funded: "!bg-mint/15 !text-[#0b7a5a]", expired: "", cancelled: "", rejected: "!bg-danger/10 !text-danger" } as const;
  return (
    <PageShell width="max-w-3xl">
      <Link href="/account" className="text-sm font-semibold text-cobalt underline">{t("back")}</Link>
      <h1 className="mt-2 text-3xl font-extrabold">{t("title")}</h1>
      <p className="mt-1 text-ink-soft">{t("lead")}</p>
      {items.length === 0 ? (
        <div className="card mt-6 p-8 text-center" data-testid="campaigns-empty">
          <p className="text-ink-soft">{t("empty")}</p>
          <Link href="/map" className="btn btn-primary mt-4">{t("start")}</Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {items.map((c) => (
            <li key={c.id} className="card flex flex-col gap-3 p-4 sm:flex-row" data-testid="campaign-item">
              <div className="checker grid h-28 w-28 shrink-0 place-items-center rounded-xl">
                <img src={`/api/campaigns/${c.id}/image`} alt="" width={c.width} height={c.height} className="h-full w-full object-contain" style={{ imageRendering: "pixelated" }} />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-bold">{c.title} {c.kind === "water" && <span className="chip">{t("water")}</span>}</p>
                <p><span className={`chip ${tone[c.status]}`} data-testid="campaign-status">{t(`status.${c.status}`)}</span></p>
                <p className="text-sm text-ink-soft">
                  {t("goal", { goal: formatMoney(Number(c.goal_cents), locale, c.currency) })} · {t("zone", { w: c.w, h: c.h, x: c.x, y: c.y })} · {t("days", { n: c.duration_days })}
                </p>
                {(c.status === "open" || c.status === "funded") && (
                  <p className="text-sm font-semibold" data-testid="campaign-raised">
                    {t("raised", { raised: formatMoney(Number(c.raised_cents), locale, c.currency), goal: formatMoney(Number(c.goal_cents), locale, c.currency) })} · {t("contributors", { n: c.contributors })}
                  </p>
                )}
                {c.refunds_due > 0 && <p className="text-xs font-semibold text-warn" data-testid="campaign-refunds">{t("refundsDue", { n: c.refunds_due })}</p>}
                <p className="text-xs text-ink-faint">
                  {c.status === "open" && c.deadline ? t("until", { date: f.dateTime(c.deadline, { dateStyle: "long" }) }) : t("sent", { date: f.dateTime(c.created_at, { dateStyle: "long" }) })}
                </p>
                {c.status === "rejected" && c.rejection_reason && <p className="text-sm font-semibold text-danger" data-testid="campaign-reason">{t("reason", { reason: c.rejection_reason })}</p>}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {(c.status === "open" || c.status === "funded") && <Link href={`/projects/${c.code}`} className="btn btn-ghost btn-sm" data-testid="campaign-public">{t("view")}</Link>}
                  {(c.status === "pending" || c.status === "open") && <CancelCampaignButton id={c.id} />}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
