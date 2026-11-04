import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/layout/PageShell";
import { ContributeForm } from "@/components/projects/ContributeForm";
import { Progress, timeLeftLabel } from "@/components/projects/ProjectCard";
import { Link } from "@/i18n/navigation";
import { getViewer } from "@/lib/auth/session";
import { fundedPercent } from "@/lib/campaign";
import { publicCampaign } from "@/lib/data/campaigns";
import { getPricing } from "@/lib/data/map";
import { DEFAULT_PRICING, formatMoney } from "@/lib/grid/pricing";
import { hostOf } from "@/lib/security/url";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string; code: string }> }): Promise<Metadata> {
  const { locale, code } = await params;
  const c = await publicCampaign(code).catch(() => null);
  if (!c) return { robots: { index: false } };
  const t = await getTranslations({ locale, namespace: "projects" });
  return { title: `${c.title} · ${t("title")}`, description: c.description ?? t("lead"), robots: { index: c.status === "open" || c.status === "funded" } };
}

/** One group project: its creation, its goal and progress, and the way to chip in. Contributions are anonymous: only totals are shown. */
export default async function Project({ params }: { params: Promise<{ locale: string; code: string }> }) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  if (!/^[0-9a-f]{10}$/.test(code)) notFound();
  const [t, f, c, viewer, pricing] = await Promise.all([
    getTranslations("projects"), getFormatter(), publicCampaign(code), getViewer(), getPricing().catch(() => DEFAULT_PRICING),
  ]);
  if (!c) notFound();
  const money = (cents: number) => formatMoney(cents, locale, c.currency);
  const raised = Number(c.raised_cents), goal = Number(c.goal_cents), held = Number(c.held_cents);
  const pct = fundedPercent(raised, goal);
  const open = c.status === "open" && c.seconds_left > 0;
  // what a new contribution may still take: the goal, minus what is paid, minus what other people are paying right now
  const remaining = Math.max(0, goal - raised - held);
  const mapHref = `/map?x=${Math.round(c.x + c.w / 2)}&y=${Math.round(c.y + c.h / 2)}&z=${c.w >= 300 ? 0.6 : 1.5}`;
  const showImage = c.status === "open" || c.status === "funded";
  return (
    <PageShell>
      <Link href="/projects" className="text-sm font-semibold text-cobalt underline">{t("backToList")}</Link>
      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        {/* on a phone the title, the progress and the button come first: the picture and the story follow */}
        <div className="order-2 lg:order-1">
          <div className="checker grid place-items-center rounded-[var(--radius-card)] p-4 shadow-[0_0_0_1.5px_var(--color-line)]">
            {showImage
              ? <img src={`/api/campaigns/${c.id}/image?max=1024`} alt={c.title} width={c.width} height={c.height} className="pixelated max-h-[34rem] w-auto max-w-full object-contain" style={{ imageRendering: "pixelated" }} data-testid="project-image" />
              : <div className="grid h-64 w-full place-items-center text-sm text-ink-faint">{t(`status.${c.status as "expired" | "cancelled"}`)}</div>}
          </div>
          {c.description && <p className="mt-5 max-w-2xl whitespace-pre-line text-lg" data-testid="project-description">{c.description}</p>}
          <dl className="mt-5 grid max-w-2xl grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div className="card p-3"><dt className="text-xs text-ink-faint">{t("goal")}</dt><dd className="pixel-num font-semibold">{money(goal)}</dd></div>
            <div className="card p-3"><dt className="text-xs text-ink-faint">{t("size")}</dt><dd className="pixel-num font-semibold">{c.w}×{c.h} · {f.number(c.area)} px</dd></div>
            <div className="card col-span-2 p-3 sm:col-span-1"><dt className="text-xs text-ink-faint">{t("creator")}</dt><dd className="font-semibold"><Link className="underline" href={`/u/${c.username}`}>{c.username}</Link></dd></div>
          </dl>
          <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <Link href={mapHref} className="font-semibold text-cobalt underline">{t("seeOnMap")}</Link>
            {c.link_url && <a className="text-cobalt underline" href={c.link_url} target="_blank" rel={`noopener noreferrer nofollow ugc${c.is_commercial ? " sponsored" : ""}`}>{hostOf(c.link_url)} ↗</a>}
            {c.is_commercial && <span className="chip !bg-warn/15 !text-warn">{t("ad")}</span>}
            {c.kind === "water" && <span className="chip">{t("water")}</span>}
          </p>
        </div>

        <aside aria-label={t("form.title")} className="card order-1 h-fit space-y-4 p-5 lg:order-2 lg:sticky lg:top-6" data-testid="project-panel" data-status={c.status}>
          <div>
            <p className="flex items-center gap-2"><span className={`chip ${c.status === "funded" ? "!bg-mint/15 !text-[#0b7a5a]" : ""}`} data-testid="project-status">{t(`status.${c.status as "open" | "funded" | "expired" | "cancelled"}`)}</span></p>
            <h1 className="mt-2 text-2xl font-extrabold leading-tight" data-testid="project-heading">{c.title}</h1>
          </div>
          {(c.status === "open" || c.status === "funded") && (
            <div>
              <Progress percent={pct} label={t("percent", { pct })} />
              <p className="mt-2 flex items-baseline justify-between gap-2">
                <span className="pixel-display text-3xl text-signal" data-testid="project-raised">{money(raised)}</span>
                <span className="text-sm text-ink-soft">{t("ofGoal", { goal: money(goal) })}</span>
              </p>
              <p className="mt-1 flex flex-wrap items-baseline justify-between gap-2 text-sm text-ink-soft">
                <span data-testid="project-contributors">{c.contributors > 0 ? t("contributors", { n: f.number(c.contributors) }) : t("noContributors")}</span>
                {c.status === "open" && <span data-testid="project-left">{await timeLeftLabel(c.seconds_left)}</span>}
              </p>
              {c.deadline && c.status === "open" && <p className="text-xs text-ink-faint">{t("endsOn", { date: f.dateTime(c.deadline, { dateStyle: "long" }) })}</p>}
            </div>
          )}
          {c.status === "funded" && (
            <div className="rounded-[8px] bg-mint/12 px-3 py-3 text-sm font-semibold text-[#0b7a5a]" data-testid="project-funded">
              <p>{t("banner.funded")}</p>
              {c.parcel_code && <Link href={`/p/${c.parcel_code}`} className="btn btn-primary btn-sm mt-3" data-testid="project-parcel">{t("banner.seeParcel")}</Link>}
            </div>
          )}
          {(c.status === "expired" || c.status === "cancelled") && <p className="rounded-[8px] bg-paper-2 px-3 py-3 text-sm font-semibold text-ink-soft" data-testid="project-ended">{t(`banner.${c.status}`)}</p>}
          {open && (
            <>
              <ContributeForm projectId={c.id} currency={c.currency} minCents={pricing.campaignMinContributionCents} remainingCents={remaining} signedIn={Boolean(viewer)} signInHref={`/auth/sign-in?next=${encodeURIComponent(`${locale === "en" ? "" : `/${locale}`}/projects/${c.code}`)}`} />
              {viewer?.user.id === c.creator_id && <p className="text-xs text-ink-faint">{t("form.yours")}</p>}
            </>
          )}
        </aside>
      </div>
    </PageShell>
  );
}
