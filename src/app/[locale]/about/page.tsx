import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/layout/PageShell";
import { Link } from "@/i18n/navigation";
import { requestCurrency } from "@/lib/currency-server";
import { getPricing } from "@/lib/data/map";
import { DEFAULT_PRICING, formatMoney } from "@/lib/grid/pricing";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "about" });
  return { title: t("title"), description: t("lead") };
}

/** "Learn more": the why, in a few short paragraphs (it replaces the story's picture book). Prices are the real ones, read from the shop's settings. */
export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, l] = await Promise.all([getTranslations("about"), getLocale()]);
  const pricing = (await getPricing(requestCurrency(await headers())).catch(() => null)) ?? DEFAULT_PRICING;
  const price = formatMoney(pricing.unitPriceCents, l, pricing.currency), from = formatMoney(pricing.unitPriceCents * pricing.minArea, l, pricing.currency);
  return (
    <PageShell width="max-w-3xl">
      <article data-testid="about-page">
        <h1 className="text-balance font-display text-[clamp(2rem,4.4vw,3.2rem)] font-extrabold leading-[1.05]">{t("title")}</h1>
        <p className="mt-4 text-[1.15rem] text-ink-soft">{t("lead")}</p>
        {(["why", "how", "time"] as const).map((k) => (
          <section key={k} className="mt-10"><h2 className="font-display text-[1.5rem] font-bold">{t(`${k}.title`)}</h2><p className="mt-2 max-w-2xl text-[1.05rem] leading-relaxed">{t(`${k}.text`)}</p></section>
        ))}
        <section className="mt-10"><h2 className="font-display text-[1.5rem] font-bold">{t("buy.title")}</h2><p className="mt-2 max-w-2xl text-[1.05rem] leading-relaxed" data-testid="about-price">{t("buy.text", { price, from })}</p><p className="mt-2"><Link href="/terms" className="font-semibold text-cobalt underline underline-offset-2">{t("buy.terms")}</Link></p></section>
        <div className="mt-10 flex flex-wrap gap-3"><Link href="/map?buy=1" className="btn btn-primary">{t("cta")}</Link><Link href="/map" className="btn btn-secondary">{t("explore")}</Link></div>
        <p className="mt-10 text-xs text-ink-faint">{t("draft")}</p>
      </article>
    </PageShell>
  );
}
