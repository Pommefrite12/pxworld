import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/layout/PageShell";
import { CreationGrid } from "@/components/ui/CreationGrid";
import { Link } from "@/i18n/navigation";
import { largestParcels, latestCreations, mostCommented, popularCreations, type Card } from "@/lib/data/parcels";
import { localizeCards } from "@/lib/data/localize";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "discover" });
  return { title: t("title"), description: t("lead") };
}

function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-12">
      <h2 id={id} className="text-2xl font-extrabold">{title}</h2>
      {hint && <p className="mt-1 text-sm text-ink-soft">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

async function safe<T>(p: Promise<T[]>): Promise<T[]> {
  try { return await p; } catch (e) { console.error("discover query failed", (e as Error).message); return []; }
}

export default async function Discover({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("discover");
  const titled = (p: Promise<Card[]>) => safe(p).then((rows) => localizeCards(rows, locale).catch(() => rows)); // titles in the language of the page
  const [latest, large, popular, commented] = await Promise.all([titled(latestCreations(12)), titled(largestParcels(8)), titled(popularCreations(8)), titled(mostCommented(8))]);
  return (
    <PageShell>
      <h1 className="text-4xl font-extrabold">{t("title")}</h1>
      <p className="mt-2 max-w-2xl text-lg text-ink-soft">{t("lead")}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/ranking" className="btn btn-secondary btn-sm" data-testid="discover-ranking">{t("rankingLink")}</Link>
        <Link href="/projects" className="btn btn-secondary btn-sm" data-testid="discover-projects">{t("projectsLink")}</Link>
      </div>
      <Section id="latest" title={t("latest")}><CreationGrid items={latest} empty={t("empty")} /></Section>
      <Section id="large" title={t("large")} hint={t("largeHint")}><CreationGrid items={large} empty={t("empty")} /></Section>
      <Section id="popular" title={t("popular")} hint={t("popularHint")}><CreationGrid items={popular} empty={t("emptyPopular")} /></Section>
      <Section id="commented" title={t("commented")} hint={t("commentedHint")}><CreationGrid items={commented} empty={t("emptyCommented")} /></Section>
    </PageShell>
  );
}
