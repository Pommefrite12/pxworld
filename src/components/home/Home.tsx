import { getFormatter, getTranslations } from "next-intl/server";
import { ArchiveChips } from "@/components/archive/ArchiveChips";
import { Footer } from "@/components/layout/Footer";
import { SiteHeader, type HeaderViewer } from "@/components/layout/SiteHeader";
import { Link } from "@/i18n/navigation";
import type { Trace } from "@/lib/data/parcels";
import { daysLeft, editionProgress, type PublicEdition } from "@/lib/edition";
import { assetUrl } from "@/lib/images/sizes";
import { Eras } from "./Eras";
import { HeroWorld, Sparks } from "./HeroWorld";
import { PixelIcon } from "./PixelIcon";

const SEGMENTS = 50;

/**
 * The home page: the planisphere of the world (a picture, so the page scrolls), what this is in one sentence, three gestures, what people have
 * just archived (real, validated traces only: the section is absent while there are none), where the edition stands (the database's state:
 * pre-launch, open, closed), and a word on why. The interactive map is one click away (`/map`).
 */
export async function Home({ viewer, edition, traces }: { viewer: HeaderViewer | null; edition: PublicEdition | null; traces: Trace[] }) {
  const [t, tn, te, ta, f] = await Promise.all([getTranslations("home"), getTranslations("nav"), getTranslations("archive.editions"), getTranslations("archive.page"), getFormatter()]);
  const day = (iso: string | null) => (iso ? f.dateTime(new Date(iso), { dateStyle: "long" }) : "");
  const state = edition?.state ?? null;
  const left = edition ? daysLeft(edition) : null;
  const filled = edition ? Math.round(editionProgress(edition) * SEGMENTS) : 0;
  const nb = (c: React.ReactNode) => <span className="whitespace-nowrap">{c}</span>;
  const editionName = edition ? (te.has(edition.slug) ? te(edition.slug) : edition.name) : null;

  return (
    <>
      <SiteHeader viewer={viewer} cta={<Link href="/map?buy=1" className="btn btn-primary btn-sm hidden sm:inline-flex" data-testid="header-leave-trace">{tn("leaveTrace")}</Link>} />
      <main id="main">
        {/* ---------------------------------------------------------------- the planisphere and the sentence */}
        <section aria-label={t("hero.eyebrow")} className="relative isolate overflow-hidden border-b-2 border-line sm:flex sm:min-h-[min(86svh,760px)] sm:items-center">
          <div className="absolute inset-0 -z-10 max-sm:relative max-sm:inset-auto max-sm:z-0 max-sm:h-[300px] max-sm:overflow-hidden">
            <HeroWorld label={t("hero.mapLabel")} markers={traces.map((x) => ({ code: x.code, x: x.x + x.w / 2, y: x.y + x.h / 2, assetId: x.asset_id }))} />
            <div className="hero-veil" />
            <Sparks />
          </div>
          <div className="relative mx-auto w-full max-w-[1180px] px-5 pb-10 pt-2 sm:py-24" data-testid="home-hero">
            <p className="eyebrow">{t("hero.eyebrow")}{editionName ? ` · ${editionName}` : ""}</p>
            <h1 className="mt-2 max-w-[10.5em] text-balance font-display text-[2.3rem] font-extrabold leading-[1.02] sm:text-[clamp(2.3rem,5.2vw,4.4rem)]" data-testid="home-title">
              {t.rich("hero.title", { gold: (c) => <span className="text-signal">{c}</span>, nb })}
            </h1>
            <p className="mt-4 max-w-[22em] font-display text-[clamp(1.2rem,2.3vw,1.7rem)] font-bold leading-snug text-cobalt" data-testid="home-hook">{t("hero.hook")}</p>
            <p className="mt-3 max-w-[27em] text-[1.05rem] text-ink-soft sm:text-[clamp(1.05rem,1.5vw,1.2rem)]">{t("hero.subtitle")}</p>
            <div className="mt-7 flex flex-wrap gap-3 max-sm:[&>a]:flex-1 max-sm:[&>a]:basis-full">
              <Link href="/map?buy=1" className="btn btn-primary min-h-[3.25rem] px-7 text-[1.05rem]" data-testid="home-leave-trace">{t("hero.primary")}</Link>
              <Link href="/map" className="btn btn-secondary min-h-[3.25rem] px-7 text-[1.05rem]" data-testid="home-explore">{t("hero.secondary")}</Link>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- every era leaves a trace */}
        <Eras />

        {/* ---------------------------------------------------------------- three gestures */}
        <section className="py-14 sm:py-20" aria-labelledby="h-steps">
          <div className="mx-auto w-[min(1180px,100%-2.5rem)]">
            <p className="eyebrow">{t("steps.eyebrow")}</p>
            <h2 id="h-steps" className="mt-1 text-balance font-display text-[clamp(1.7rem,3.6vw,2.6rem)] font-extrabold leading-[1.08]">{t("steps.title")}</h2>
            <ol className="mt-8 grid gap-5 sm:grid-cols-3" data-testid="home-steps">
              {(["one", "two", "three"] as const).map((k, i) => (
                <li key={k} className="px-card px-6 pb-7 pt-6">
                  <PixelIcon name={(["select", "archive", "pass"] as const)[i]!} />
                  <p className="eyebrow mt-4">{i + 1}</p>
                  <h3 className="mt-0.5 font-display text-[1.3rem] font-bold">{t(`steps.${k}.title`)}</h3>
                  <p className="mt-1.5 text-ink-soft">{t(`steps.${k}.text`)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------------------------------------------------------------- what has just been archived: real traces only */}
        {traces.length > 0 && (
          <section className="pb-14 sm:pb-20" aria-labelledby="h-recent" data-testid="home-recent">
            <div className="mx-auto w-[min(1180px,100%-2.5rem)]">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div><p className="eyebrow">{t("recent.eyebrow")}</p><h2 id="h-recent" className="mt-1 font-display text-[clamp(1.7rem,3.6vw,2.6rem)] font-extrabold leading-[1.08]">{t("recent.title")}</h2><p className="mt-2 text-ink-soft">{t("recent.lead")}</p></div>
                <Link href="/discover" className="btn btn-secondary btn-sm">{t("recent.all")} <span aria-hidden>›</span></Link>
              </div>
              <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {traces.slice(0, 6).map((x) => (
                  <li key={x.code}>
                    <Link href={`/archive/${x.code}`} className="px-card block p-3.5 pb-4" data-testid="home-trace" data-code={x.code}>
                      <span className="checker block bg-paper p-2.5 shadow-[inset_0_0_0_2px_var(--color-line)]">
                        {/* eslint-disable-next-line @next/next/no-img-element -- a pixel creation, drawn crisp */}
                        <img src={assetUrl(x.asset_id, 512)} alt="" className="mx-auto block aspect-[1/0.62] w-full object-contain [image-rendering:pixelated]" loading="lazy" />
                      </span>
                      <span className="mt-3 block font-display text-[1.1rem] font-bold leading-tight">{x.title ?? ta("untitled")}</span>
                      <ArchiveChips className="mt-1.5" category={x.category} placeLabel={x.place_label} placeCountry={x.place_country} />
                      <span className="mt-1.5 block text-[0.82rem] text-ink-soft">{t("recent.by", { author: x.username })}{x.activated_at ? ` · ${ta("archivedOn", { date: f.dateTime(x.activated_at, { dateStyle: "medium" }) })}` : ""}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* ---------------------------------------------------------------- the time: where the edition stands */}
        <section className="relative overflow-hidden border-y-2 border-line bg-gradient-to-b from-paper-2 to-paper py-14 sm:py-20" aria-labelledby="h-time" data-testid="home-time" data-state={state ?? "unknown"}>
          <div className="mx-auto grid w-[min(1180px,100%-2.5rem)] items-center gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
            <div>
              {editionName && <p className="eyebrow">{editionName}</p>}
              <h2 id="h-time" className="mt-1 text-balance font-display text-[clamp(1.7rem,3.6vw,2.6rem)] font-extrabold leading-[1.08]">{t("time.title")}</h2>
              <p className="mt-3 max-w-[40em] text-[1.05rem] text-ink-soft">{t("time.lead")}</p>
              <ol className="mt-8 grid grid-cols-2 gap-x-2 gap-y-4 text-[0.84rem] text-ink-soft sm:grid-cols-4" aria-hidden>
                {([
                  ["opening", state && state !== "prelaunch", edition?.opensAt ? t("time.onDate", { date: day(edition.opensAt) }) : ""],
                  ["span", state && state !== "prelaunch", t("time.toArchive")],
                  ["closing", state === "closed", edition?.closesAt ? t("time.onDate", { date: day(edition.closesAt) }) : ""],
                  ["archive", state === "closed", t("time.explorable")],
                ] as const).map(([k, on, sub]) => (
                  <li key={k} className="relative pt-4">
                    <i className={`absolute left-0 top-0 h-2.5 w-2.5 ${on ? "bg-signal shadow-[0_0_8px_rgb(214_171_114/0.6)]" : "bg-sky-2"}`} />
                    <b className="block text-[0.92rem] text-ink">{t(`time.${k}`)}</b>{sub}
                  </li>
                ))}
              </ol>
            </div>
            {edition && (
              <div className="px-card px-card-gold px-card-glass px-6 pb-7 pt-6" data-testid="home-plate">
                {state === "prelaunch" && (
                  <>
                    <p className="eyebrow">{editionName}</p>
                    <p className="mt-2 font-display text-[2rem] font-extrabold leading-tight" data-testid="home-plate-title">{t("time.prelaunchTitle")}</p>
                    <div className="seg-bar my-4" data-tone="off" aria-hidden>{Array.from({ length: SEGMENTS }, (_, i) => <i key={i} />)}</div>
                    <p className="text-sm text-ink-soft">{t("time.prelaunchNote")}</p>
                  </>
                )}
                {state === "open" && (
                  <>
                    <p className="eyebrow">{t("time.openLeft")}</p>
                    <p className="mt-2 flex items-baseline gap-3"><span className="clock-n text-[clamp(4.4rem,8vw,6rem)]" data-testid="home-days-left">{left}</span><span className="text-[1.15rem] font-bold">{left === 1 ? t("time.dayOne") : t("time.dayMany")}</span></p>
                    <div className="seg-bar my-4 h-3" aria-hidden>{Array.from({ length: SEGMENTS }, (_, i) => <i key={i} className={i < filled ? "on" : ""} />)}</div>
                    <p className="text-sm text-ink-soft">{t.rich("time.openNote", { date: day(edition.closesAt), b: (c) => <b className="text-ink">{c}</b> })}</p>
                  </>
                )}
                {state === "closed" && (
                  <>
                    <p className="eyebrow">{editionName}</p>
                    <p className="mt-2 font-display text-[2rem] font-extrabold leading-tight text-ink" data-testid="home-plate-title">{t("time.closedTitle")}</p>
                    <div className="seg-bar my-4" data-tone="dim" aria-hidden>{Array.from({ length: SEGMENTS }, (_, i) => <i key={i} className="on" />)}</div>
                    <p className="text-sm text-ink-soft">{t.rich("time.closedNote", { date: day(edition.closedAt ?? edition.closesAt), b: (c) => <b className="text-ink">{c}</b> })}</p>
                    <Link href="/map" className="btn btn-primary mt-4">{t("time.explore")}</Link>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ---------------------------------------------------------------- why */}
        <section className="py-14 sm:py-20" aria-labelledby="h-why">
          <div className="mx-auto w-[min(1180px,100%-2.5rem)]">
            <div className="px-card px-card-gold grid items-center gap-6 px-6 py-7 sm:grid-cols-[1fr_auto] sm:px-8">
              <p id="h-why" className="max-w-[36em] text-balance font-display text-[clamp(1.2rem,2.2vw,1.65rem)] font-semibold leading-snug">{t("manifest.a")} <span className="text-signal">{t("manifest.b")}</span></p>
              <Link href="/about" className="btn btn-nav" data-testid="home-about">{t("manifest.more")} <span aria-hidden>›</span></Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
