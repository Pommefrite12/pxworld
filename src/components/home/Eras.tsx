import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { EraItem } from "./EraItem";

/** The stations of the story, in the order they happened. The first four pictures are the owner's own; the last is the map itself. */
const ERAS = ["cave", "hieroglyphs", "manuscript", "photography", "pixelworld"] as const;
const PICTURE: Record<(typeof ERAS)[number], string> = { cave: "cave", hieroglyphs: "hieroglyphs", manuscript: "manuscript", photography: "photography", pixelworld: "world" };

/**
 * "Every era leaves a trace. Here is ours.": how people have always handed their time down — the cave wall, the stone, the manuscript, the
 * photograph — and Pixel World as the next one. Each of the first four is only a date and a title (the picture speaks); the last one has its sentence and the way in. A gold thread with a square for each era, the picture on one side and the words on the other
 * (the other way round on the next one); on a phone the thread runs down the left. Server markup, pictures loaded lazily; the only script is `EraItem`'s, which makes each station appear as the visitor scrolls down to it (nothing is hidden without it).
 */
export async function Eras() {
  const t = await getTranslations("home");
  return (
    <section className="border-t-2 border-line py-16 sm:py-24" aria-labelledby="h-eras" data-testid="home-eras">
      <div className="mx-auto w-[min(1180px,100%-2.5rem)]">
        <p className="eyebrow">{t("eras.eyebrow")}</p>
        <h2 id="h-eras" className="mt-1 max-w-[18em] text-balance font-display text-[clamp(1.7rem,3.6vw,2.6rem)] font-extrabold leading-[1.08]">{t("eras.title")}</h2>
        <p className="mt-3 max-w-[40em] text-[1.05rem] text-ink-soft">{t("eras.lead")}</p>
        <ol className="eras mt-12">
          {ERAS.map((k) => {
            const last = k === "pixelworld", pic = PICTURE[k];
            return (
              <EraItem key={k} era={k}>
                <figure className={`era-pic px-card ${last ? "px-card-gold" : ""} p-2`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a picture of the story, in two sizes */}
                  <img src={`/eras/${pic}-720.webp`} srcSet={`/eras/${pic}-720.webp 720w, /eras/${pic}-1200.webp 1200w`} sizes="(min-width: 768px) 540px, calc(100vw - 4.5rem)" width={1200} height={900} alt={t(`eras.${k}.alt`)} loading="lazy" decoding="async" className="block h-auto w-full" />
                </figure>
                <div className="era-text">
                  <p className="eyebrow">{t(`eras.${k}.when`)}</p>
                  <h3 className="mt-1 font-display text-[clamp(1.4rem,2.6vw,1.9rem)] font-extrabold leading-tight">{t(`eras.${k}.title`)}</h3>
                  {last && <p className="mt-2 max-w-[30em] text-[1.05rem] text-ink-soft">{t("eras.pixelworld.text")}</p>}
                  {last && <Link href="/map?buy=1" className="btn btn-primary mt-5 min-h-[3.25rem] px-7 text-[1.05rem]" data-testid="eras-leave-trace">{t("hero.primary")}</Link>}
                </div>
              </EraItem>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
