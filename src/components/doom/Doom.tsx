"use client";

import { useFormatter, useTranslations } from "next-intl";
import { pad2 } from "@/lib/doom/clock";
import { useDoom } from "./useDoom";
import { startFinale, useFinaleDuring } from "./finaleStore";

/**
 * "100 days to save the world" — the parts of the interface that belong to the story (art direction "Glitch").
 * Every part renders nothing while the countdown is off, so the site stays exactly as it was until a date is set.
 */

/** The thin scrolling strip above the header: the story's messages, with hazard stripes at both ends. Decoration only. */
export function DoomTicker() {
  const d = useDoom();
  const t = useTranslations("doom");
  if (!d) return null;
  const text = (d.remaining.over ? t("tickerOver") : t("ticker")).repeat(3);
  return (
    <div className="doom-ticker" data-phase={d.phase} aria-hidden="true" data-testid="doom-ticker">
      <div className="doom-ticker-run"><span>{text}</span><span>{text}</span></div>
    </div>
  );
}

/** "J-87" next to the logo, on every page. */
export function DoomChip() {
  const d = useDoom();
  const t = useTranslations("doom");
  if (!d) return null;
  return (
    <span className="doom-chip hidden sm:inline" title={t("chipLabel", { days: d.remaining.days })} data-testid="doom-chip">
      {t("chip", { days: d.remaining.days })}
    </span>
  );
}

/** The countdown itself, top of the map: days, hours, minutes, seconds. */
export function DoomPlate() {
  const d = useDoom();
  const t = useTranslations("doom");
  if (!d) return null;
  const { days, hours, minutes, seconds, over } = d.remaining;
  const group = (value: number, label: string, glitch = false) => (
    <div className={`doom-group${glitch && !over ? " glitch" : ""}`}>
      <b className="doom-n">{pad2(value)}</b>
      <i>{label}</i>
    </div>
  );
  return (
    <section className="doom-plate" role="timer" aria-label={t("plateLabel")} data-phase={d.phase} data-testid="doom-plate">
      <div className="doom-plate-top"><span>{over ? t("warnOver") : t("warn")}</span><span>{d.preview ? t("preview") : t("fiction")}</span></div>
      <div className="doom-digits">
        {group(days, t("days"))}<span className="doom-sep" aria-hidden="true">:</span>
        {group(hours, t("hours"))}<span className="doom-sep" aria-hidden="true">:</span>
        {group(minutes, t("minutes"))}<span className="doom-sep" aria-hidden="true">:</span>
        {group(seconds, t("seconds"), true)}
      </div>
      <p className="sr-only">{over ? t("warnOver") : t("timeLeft", { days, hours, minutes })}</p>
    </section>
  );
}

/** The sentence of the current chapter of the story, under the countdown. `survivors` = real parcels, never invented. */
export function DoomMessage({ survivors }: { survivors: number }) {
  const d = useDoom();
  const during = useFinaleDuring();
  const t = useTranslations("doom");
  if (!d) return null;
  const text = d.phase === 5 ? (during ? t("during") : t("phase5", { n: survivors })) : t(`phase${d.phase}`);
  return <p className="doom-msg" data-testid="doom-message">{text}</p>;
}

/** After the end: play the destruction again (the countdown's big moment, for showing it to somebody). */
export function DoomReplay({ className = "" }: { className?: string }) {
  const d = useDoom();
  const during = useFinaleDuring();
  const t = useTranslations("doom");
  if (!d || !d.remaining.over || during) return null;
  return <button type="button" className={`btn btn-secondary btn-sm pointer-events-auto ${className}`} onClick={() => startFinale(true)} data-testid="doom-replay">{t("replay")}</button>;
}

/** "Saved world": the real share of the land that has been acquired (and so would survive), the real number of parcels. */
export function DoomStats({ fillPercent, soldPixels, parcels, compact = false }: { fillPercent: number; soldPixels: number; parcels: number; compact?: boolean }) {
  const d = useDoom();
  const t = useTranslations("doom");
  const f = useFormatter();
  if (!d) return null;
  const pctLabel = f.number(fillPercent / 100, { style: "percent", ...(fillPercent < 1 ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 1 }) });
  const danger = f.number(Math.max(0, 100 - fillPercent) / 100, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const CELLS = 30, filled = soldPixels > 0 ? Math.max(1, Math.round((fillPercent / 100) * CELLS)) : 0;
  return (
    <section aria-label={t("saved")} className={`card doom-card pointer-events-auto w-full max-w-[22rem] ${compact ? "p-3" : "p-3 sm:p-4"}`} data-testid="doom-stats">
      <p className="doom-card-lab">{t("saved")}</p>
      <p className="doom-big" data-testid="doom-saved-percent">{pctLabel}</p>
      <div className="doom-seg" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fillPercent * 10000) / 10000} aria-valuetext={pctLabel} aria-label={t("saved")}>
        {Array.from({ length: CELLS }, (_, i) => <i key={i} className={i < filled ? "" : `bad${i % 7 === 3 ? " x" : i % 11 === 5 ? " y" : ""}`} />)}
      </div>
      {!compact && <p className="mt-2 hidden text-[0.8rem] text-ink-soft sm:block">{t("savedLine", { n: parcels, danger })}</p>}
      <DoomReplay className="mt-2 w-full sm:hidden" />
    </section>
  );
}
