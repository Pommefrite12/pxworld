import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { AdminButton } from "@/components/admin/AdminButton";
import { Link } from "@/i18n/navigation";
import { campaignQueue, campaignsReviewed } from "@/lib/data/campaigns";
import { formatMoney } from "@/lib/grid/pricing";
import { hostOf } from "@/lib/security/url";

/** The group projects (parcels several people pay for): the ones waiting for a moderator, and what happened to the others. */
export default async function AdminCampaigns({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, f, queue, reviewed] = await Promise.all([getTranslations("admin.campaigns"), getFormatter(), campaignQueue(), campaignsReviewed()]);
  return (
    <div>
      <h1 className="text-3xl font-extrabold">{t("title")}</h1>
      <p className="mt-1 max-w-2xl text-ink-soft">{t("lead")}</p>

      {queue.length === 0 ? <p className="card mt-6 p-8 text-center text-ink-soft" data-testid="campaign-queue-empty">{t("empty")}</p> : (
        <ul className="mt-6 space-y-4">
          {queue.map((c) => (
            <li key={c.id} className="card flex flex-col gap-4 p-4 sm:flex-row" data-testid="campaign-queue-item">
              <div className="checker grid h-44 w-44 shrink-0 place-items-center rounded-xl">
                <img src={`/api/campaigns/${c.id}/image`} alt="" width={c.width} height={c.height} className="pixelated h-full w-full object-contain" style={{ imageRendering: "pixelated" }} />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="font-bold">{c.title} {c.is_commercial && <span className="chip !bg-warn/15 !text-warn">{t("ad")}</span>} {c.kind === "water" && <span className="chip">{t("water")}</span>}</p>
                {c.description && <p className="text-sm">{c.description}</p>}
                {c.link_url && <p className="break-all text-sm"><a className="text-cobalt underline" href={c.link_url} target="_blank" rel="noopener noreferrer nofollow">{hostOf(c.link_url)} ↗</a></p>}
                <p className="text-sm text-ink-soft">
                  {t("goal")} <strong className="text-ink" data-testid="campaign-goal">{formatMoney(Number(c.goal_cents), locale, c.currency)}</strong> · {t("zone", { w: c.w, h: c.h, x: c.x, y: c.y })} · {t("duration", { n: c.duration_days })}
                </p>
                <p className="text-xs text-ink-soft">{t("by")} <Link className="font-semibold underline" href={`/u/${c.username}`}>{c.username}</Link> · {f.dateTime(c.created_at, { dateStyle: "medium", timeStyle: "short" })}</p>
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <AdminButton payload={{ action: "review_campaign", campaignId: c.id, decision: "approve" }} label={t("approve")} tone="primary" testId="approve-campaign" />
                  <AdminButton payload={{ action: "review_campaign", campaignId: c.id, decision: "reject" }} label={t("reject")} tone="danger" askReason testId="reject-campaign" />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-10 text-xl font-extrabold">{t("handled")}</h2>
      {reviewed.length === 0 ? <p className="mt-2 text-sm text-ink-soft">{t("none")}</p> : (
        <div className="card mt-3 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm" data-testid="campaign-handled">
            <tbody>
              {reviewed.map((c) => (
                <tr key={c.id} className="border-t border-line first:border-t-0">
                  <td className="px-3 py-2 font-semibold">{c.title}</td>
                  <td className="px-3 py-2"><Link className="underline" href={`/u/${c.username}`}>{c.username}</Link></td>
                  <td className="pixel-num px-3 py-2" data-testid="campaign-money">{c.status === "rejected" ? formatMoney(Number(c.goal_cents), locale, c.currency) : `${formatMoney(Number(c.raised_cents), locale, c.currency)} / ${formatMoney(Number(c.goal_cents), locale, c.currency)}`}
                    {c.contributors > 0 && <span className="block text-xs font-normal text-ink-soft">{t("contributors", { n: c.contributors })}</span>}
                    {c.refunds_due > 0 && <span className="chip !bg-warn/15 !text-warn block" data-testid="campaign-refunds-due">{t("refundsDue", { n: c.refunds_due })}</span>}</td>
                  <td className="px-3 py-2"><span className="chip" data-testid="campaign-status">{t(`status.${c.status}`)}</span>{c.deadline && c.status === "open" && <span className="ml-2 text-xs text-ink-soft">{t("until", { date: f.dateTime(c.deadline, { dateStyle: "medium" }) })}</span>}</td>
                  <td className="px-3 py-2 text-xs text-ink-soft">{c.rejection_reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
