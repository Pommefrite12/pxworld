import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/layout/PageShell";
import { CreationGrid } from "@/components/ui/CreationGrid";
import { Link } from "@/i18n/navigation";
import { editorialPicks, largestParcels, latestCreations, popularCreations, topContributors } from "@/lib/data/parcels";

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
  const [t, f] = await Promise.all([getTranslations("discover"), getFormatter()]);
  const [latest, large, popular, picks, people] = await Promise.all([safe(latestCreations(12)), safe(largestParcels(8)), safe(popularCreations(8)), safe(editorialPicks(8)), safe(topContributors(10))]);
  return (
    <PageShell>
      <h1 className="text-4xl font-extrabold">{t("title")}</h1>
      <p className="mt-2 max-w-2xl text-lg text-ink-soft">{t("lead")}</p>
      <Section id="latest" title={t("latest")}><CreationGrid items={latest} empty={t("empty")} /></Section>
      <Section id="large" title={t("large")} hint={t("largeHint")}><CreationGrid items={large} empty={t("empty")} /></Section>
      <Section id="popular" title={t("popular")} hint={t("popularHint")}><CreationGrid items={popular} empty={t("emptyPopular")} /></Section>
      <Section id="editorial" title={t("editorial")} hint={t("editorialHint")}><CreationGrid items={picks} empty={t("emptyEditorial")} /></Section>
      <Section id="people" title={t("contributors")} hint={t("contributorsHint")}>
        {people.length === 0 ? <p className="card p-6 text-sm text-ink-soft">{t("empty")}</p> : (
          <ol className="card divide-y divide-line">
            {people.map((p, i) => (
              <li key={p.username} className="flex items-center gap-4 px-5 py-3">
                <span className="pixel-display w-8 text-2xl text-ink-faint">{i + 1}</span>
                <Link href={`/u/${p.username}`} className="flex-1 font-semibold hover:underline">{p.username}</Link>
                <span className="pixel-num text-sm text-ink-soft">{t("contribution", { parcels: f.number(p.parcels), pixels: f.number(p.pixels) })}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </PageShell>
  );
}
