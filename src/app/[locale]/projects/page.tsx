import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/layout/PageShell";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { Link } from "@/i18n/navigation";
import { fundedCampaigns, isProjectSort, openCampaigns, type PublicCampaign } from "@/lib/data/campaigns";
import { formatMoney, DEFAULT_PRICING } from "@/lib/grid/pricing";
import { getPricing } from "@/lib/data/map";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "projects" });
  return { title: t("title"), description: t("lead") };
}

async function safe<T>(p: Promise<T[]>): Promise<T[]> {
  try { return await p; } catch (e) { console.error("projects query failed", (e as Error).message); return []; }
}

/** The public list of group projects: the ones collecting now, and the ones that were funded. */
export default async function Projects({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ sort?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { sort: sortParam } = await searchParams;
  const sort = isProjectSort(sortParam) ? sortParam : "ending";
  const [t, f, open, funded, pricing] = await Promise.all([
    getTranslations("projects"), getFormatter(), safe<PublicCampaign>(openCampaigns(sort, 48)), safe<PublicCampaign>(fundedCampaigns(12)),
    getPricing().catch(() => DEFAULT_PRICING),
  ]);
  void f;
  const grid = (items: PublicCampaign[]) => <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{items.map((c) => <ProjectCard key={c.id} c={c} />)}</ul>;
  return (
    <PageShell>
      <h1 className="text-4xl font-extrabold">{t("title")}</h1>
      <p className="mt-2 max-w-2xl text-lg text-ink-soft">{t("lead")}</p>

      <section aria-labelledby="how" className="card mt-6 p-5">
        <h2 id="how" className="text-lg font-extrabold">{t("how.title")}</h2>
        <ol className="mt-3 grid gap-3 text-sm text-ink-soft sm:grid-cols-3">
          {(["s1", "s2", "s3"] as const).map((k, i) => (
            <li key={k} className="flex gap-3"><span className="pixel-display text-3xl leading-none text-signal" aria-hidden>{i + 1}</span><span>{t(`how.${k}`, { min: formatMoney(pricing.campaignMinContributionCents, locale, pricing.currency) })}</span></li>
          ))}
        </ol>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/map" className="btn btn-primary btn-sm" data-testid="projects-start">{t("start")}</Link>
          <Link href="/account/campaigns" className="btn btn-ghost btn-sm">{t("mine")}</Link>
        </div>
      </section>

      <section aria-labelledby="collecting" className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="collecting" className="text-2xl font-extrabold">{t("collecting")}</h2>
          <nav aria-label={t("sortLabel")} className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-ink-faint">{t("sortLabel")}</span>
            {(["ending", "new", "funded"] as const).map((s) => (
              <Link key={s} href={{ pathname: "/projects", query: { sort: s } }} aria-current={sort === s ? "true" : undefined} data-testid={`sort-${s}`}
                className={`btn btn-sm ${sort === s ? "btn-ink" : "btn-ghost"}`}>{t(`sort.${s}`)}</Link>
            ))}
          </nav>
        </div>
        <div className="mt-4">{open.length === 0 ? <p className="card p-6 text-sm text-ink-soft" data-testid="projects-empty">{t("empty")}</p> : grid(open)}</div>
      </section>

      <section aria-labelledby="funded" className="mt-12">
        <h2 id="funded" className="text-2xl font-extrabold">{t("recentlyFunded")}</h2>
        <div className="mt-4">{funded.length === 0 ? <p className="card p-6 text-sm text-ink-soft">{t("emptyFunded")}</p> : grid(funded)}</div>
      </section>
    </PageShell>
  );
}
