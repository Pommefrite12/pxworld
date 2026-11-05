import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/layout/PageShell";
import { Link } from "@/i18n/navigation";
import { topCreations, topCreators } from "@/lib/data/ranking";
import { assetUrl } from "@/lib/images/sizes";
import { RANKING_BOARDS, RANKING_PERIODS, isRankingBoard, isRankingPeriod, type RankedCreation, type RankedCreator } from "@/lib/ranking";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "ranking" });
  return { title: t("title"), description: t("lead") };
}

async function safe<T>(p: Promise<T[]>): Promise<T[]> {
  try { return await p; } catch (e) { console.error("ranking query failed", (e as Error).message); return []; }
}

/** The medal colour of the first three ranks. */
const rankTone = (rank: number) => (rank === 1 ? "text-signal" : rank === 2 ? "text-cobalt" : rank === 3 ? "text-mint" : "text-ink-faint");

/** The most liked creations and creators, over all time, the last month or the last week. */
export default async function Ranking({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ board?: string; period?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const board = isRankingBoard(sp.board) ? sp.board : "creations";
  const period = isRankingPeriod(sp.period) ? sp.period : "all";
  const [t, f] = await Promise.all([getTranslations("ranking"), getFormatter()]);
  const rows = board === "creations" ? await safe<RankedCreation>(topCreations(period)) : await safe<RankedCreator>(topCreators(period));
  const region = new Intl.DisplayNames([locale], { type: "region" });
  const tab = (active: boolean) => `btn btn-sm ${active ? "btn-ink" : "btn-ghost"}`;
  return (
    <PageShell>
      <h1 className="text-4xl font-extrabold">{t("title")}</h1>
      <p className="mt-2 max-w-2xl text-lg text-ink-soft">{t("lead")}</p>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={t("boardLabel")} className="flex gap-1.5">
          {RANKING_BOARDS.map((b) => (
            <Link key={b} href={{ pathname: "/ranking", query: { board: b, period } }} aria-current={board === b ? "true" : undefined} data-testid={`board-${b}`} className={tab(board === b)}>{t(`boards.${b}`)}</Link>
          ))}
        </nav>
        <nav aria-label={t("periodLabel")} className="flex flex-wrap gap-1.5">
          {RANKING_PERIODS.map((p) => (
            <Link key={p} href={{ pathname: "/ranking", query: { board, period: p } }} aria-current={period === p ? "true" : undefined} data-testid={`period-${p}`} className={tab(period === p)}>{t(`periods.${p}`)}</Link>
          ))}
        </nav>
      </div>

      {rows.length === 0 ? <p className="card mt-6 p-8 text-center text-ink-soft" data-testid="ranking-empty">{t("empty")}</p> : (
        <ol className="mt-6 space-y-2" data-testid="ranking-list" data-board={board} data-period={period}>
          {board === "creations"
            ? (rows as RankedCreation[]).map((r) => (
              <li key={r.code}>
                <Link href={`/p/${r.code}`} className="card flex items-center gap-4 p-3 transition hover:-translate-y-0.5" data-testid="ranking-row">
                  <span className={`pixel-display w-12 shrink-0 text-center text-4xl ${rankTone(r.rank)}`} data-testid="ranking-rank">{r.rank}</span>
                  <span className="checker grid h-16 w-16 shrink-0 place-items-center rounded-lg">
                    <img src={assetUrl(r.asset_id, 128)} alt="" width={r.w} height={r.h} loading="lazy" className="pixelated h-full w-full object-contain" style={{ imageRendering: "pixelated" }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold" data-testid="ranking-title">{r.title ?? "—"}</span>
                    <span className="block truncate text-sm text-ink-soft">{t("by", { name: r.username })}{r.country ? ` · ${region.of(r.country) ?? r.country}` : ""} · <span className="pixel-num">{r.w}×{r.h}</span></span>
                  </span>
                  <span className="shrink-0 text-right"><span className="pixel-display block text-3xl text-signal" data-testid="ranking-likes">♥ {f.number(r.likes)}</span><span className="sr-only">{t("likes", { n: r.likes })}</span></span>
                </Link>
              </li>
            ))
            : (rows as RankedCreator[]).map((r) => (
              <li key={r.username}>
                <Link href={`/u/${r.username}`} className="card flex items-center gap-4 p-3 transition hover:-translate-y-0.5" data-testid="ranking-row">
                  <span className={`pixel-display w-12 shrink-0 text-center text-4xl ${rankTone(r.rank)}`} data-testid="ranking-rank">{r.rank}</span>
                  <span className="checker grid h-16 w-16 shrink-0 place-items-center rounded-lg" title={r.top_title ?? undefined}>
                    <img src={assetUrl(r.top_asset_id, 128)} alt="" width={64} height={64} loading="lazy" className="pixelated h-full w-full object-contain" style={{ imageRendering: "pixelated" }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold" data-testid="ranking-title">{r.username}</span>
                    <span className="block truncate text-sm text-ink-soft">{t("creationsCount", { n: r.parcels })}{r.country ? ` · ${region.of(r.country) ?? r.country}` : ""}{r.top_title ? ` · ${t("best", { title: r.top_title })}` : ""}</span>
                  </span>
                  <span className="shrink-0 text-right"><span className="pixel-display block text-3xl text-signal" data-testid="ranking-likes">♥ {f.number(r.likes)}</span><span className="sr-only">{t("likes", { n: r.likes })}</span></span>
                </Link>
              </li>
            ))}
        </ol>
      )}
      <p className="mt-6 max-w-2xl text-xs text-ink-faint">{t("rules")}</p>
    </PageShell>
  );
}
