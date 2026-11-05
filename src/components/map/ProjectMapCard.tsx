"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Progress } from "@/components/projects/Progress";
import { fundedPercent, timeLeft } from "@/lib/campaign";
import { formatMoney } from "@/lib/grid/pricing";
import type { MapProject } from "@/lib/map/projects";

/** The small card that opens when somebody clicks a group project on the map: what it is, how far it is, and the way to its page. */
export function ProjectMapCard({ p, onClose }: { p: MapProject; onClose: () => void }) {
  const t = useTranslations("projects");
  const tl = useTranslations("projects.left");
  const f = useFormatter();
  const locale = useLocale();
  const pct = fundedPercent(p.raisedCents, p.goalCents);
  const l = timeLeft(p.secondsLeft);
  const left = l.over ? tl("over") : l.days >= 1 ? tl("days", { n: l.days }) : l.hours >= 1 ? tl("hours", { n: l.hours }) : tl("minutes", { n: Math.max(1, l.minutes) });
  return (
    <aside aria-label={p.title} className="card pointer-events-auto w-full max-w-sm animate-rise space-y-3 p-3.5 sm:w-80" data-testid="project-map-card">
      <div className="flex items-start gap-3">
        <div className="checker grid h-16 w-16 shrink-0 place-items-center rounded-lg">
          <img src={`/api/campaigns/${p.id}/image?max=128`} alt="" width={64} height={64} className="pixelated h-full w-full object-contain" style={{ imageRendering: "pixelated" }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="chip">{t("status.open")}{p.water ? ` · ${t("water")}` : ""}</p>
          <h2 className="mt-1 truncate text-base font-extrabold leading-tight" data-testid="project-map-title">{p.title}</h2>
          <p className="pixel-num text-xs text-ink-faint">{p.w}×{p.h} px</p>
        </div>
        <button className="btn btn-ghost btn-icon btn-sm shrink-0 text-lg" onClick={onClose} aria-label={t("close")} data-testid="project-map-close">×</button>
      </div>
      <div>
        <Progress percent={pct} label={t("percent", { pct })} />
        <p className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
          <span className="pixel-num font-semibold">{t("raisedOf", { raised: formatMoney(p.raisedCents, locale, p.currency), goal: formatMoney(p.goalCents, locale, p.currency) })}</span>
          <span className="text-ink-soft">{left}</span>
        </p>
        <p className="text-xs text-ink-soft">{p.contributors > 0 ? t("contributors", { n: f.number(p.contributors) }) : t("noContributors")}</p>
      </div>
      <Link href={`/projects/${p.code}`} className="btn btn-primary w-full" data-testid="project-map-open">{t("viewProject")}</Link>
    </aside>
  );
}
