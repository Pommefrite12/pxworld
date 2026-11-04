import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { fundedPercent, timeLeft } from "@/lib/campaign";
import type { PublicCampaign } from "@/lib/data/campaigns";
import { formatMoney } from "@/lib/grid/pricing";

/** The bar of a project: how much of the goal is paid. */
export function Progress({ percent, label }: { percent: number; label: string }) {
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label} className="h-3 w-full overflow-hidden rounded-[4px] bg-paper-2 shadow-[inset_0_0_0_1.5px_var(--color-line)]">
      <div className="h-full bg-signal" style={{ width: `${percent}%` }} />
    </div>
  );
}

/** What is left, in the most useful unit. */
export async function timeLeftLabel(seconds: number): Promise<string> {
  const t = await getTranslations("projects.left");
  const l = timeLeft(seconds);
  if (l.over) return t("over");
  if (l.days >= 1) return t("days", { n: l.days });
  if (l.hours >= 1) return t("hours", { n: l.hours });
  return t("minutes", { n: Math.max(1, l.minutes) });
}

export async function ProjectCard({ c }: { c: PublicCampaign }) {
  const [t, f, locale] = await Promise.all([getTranslations("projects"), getFormatter(), getLocale()]);
  const raised = Number(c.raised_cents), goal = Number(c.goal_cents);
  const pct = fundedPercent(raised, goal);
  return (
    <li>
      <Link href={`/projects/${c.code}`} className="card group block overflow-hidden transition hover:-translate-y-0.5" data-testid="project-card">
        <div className="checker grid aspect-square place-items-center p-2">
          <img src={`/api/campaigns/${c.id}/image?max=512`} alt={c.title} width={c.width} height={c.height} loading="lazy" className="pixelated h-full w-full object-contain" style={{ imageRendering: "pixelated" }} />
        </div>
        <div className="space-y-2 p-3">
          <p className="truncate text-sm font-bold" data-testid="project-title">{c.title}{c.kind === "water" && <span className="chip ml-1.5">{t("water")}</span>}</p>
          <p className="truncate text-xs text-ink-soft">{t("by", { name: c.username })} · <span className="pixel-num">{c.w}×{c.h}</span></p>
          <Progress percent={pct} label={t("percent", { pct })} />
          <p className="flex items-baseline justify-between gap-2 text-xs">
            <span className="pixel-num font-semibold" data-testid="project-raised">{t("raisedOf", { raised: formatMoney(raised, locale, c.currency), goal: formatMoney(goal, locale, c.currency) })}</span>
          </p>
          <p className="flex items-baseline justify-between gap-2 text-xs text-ink-soft">
            <span>{c.contributors > 0 ? t("contributors", { n: f.number(c.contributors) }) : t("noContributors")}</span>
            {c.status === "funded" ? <span className="chip !bg-mint/15 !text-[#0b7a5a]">{t("status.funded")}</span> : <span>{await timeLeftLabel(c.seconds_left)}</span>}
          </p>
        </div>
      </Link>
    </li>
  );
}
