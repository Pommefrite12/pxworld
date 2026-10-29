"use client";

import { useMemo } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { pixelToLonLat } from "@/lib/grid/geometry";
import { DEGREES_PER_PIXEL, TOTAL_PIXELS } from "@/lib/grid/constants";
import type { Camera } from "./engine";
import type { PublicStats } from "@/lib/data/map";

/** Pixels sold, from the database. No placeholder numbers: until the first sale it truthfully reads 0. */
export function StatsCard({ stats, compact }: { stats: PublicStats; compact: boolean }) {
  const t = useTranslations("stats");
  const f = useFormatter();
  const pct = stats.fillPercent;
  return (
    <section aria-label={t("label")} className={`card pointer-events-auto w-full max-w-[22rem] ${compact ? "p-3" : "p-4"}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{t("sold")}</p>
      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 leading-none">
        <span className="pixel-display text-[2.7rem] text-signal" data-testid="sold-pixels">{f.number(stats.soldPixels)}</span>
        <span className="pixel-num text-sm text-ink-faint">/ {f.number(TOTAL_PIXELS)}</span>
      </p>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-paper-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 10000) / 10000} aria-label={t("filled")}>
        {/* the bar is at least 2px wide as soon as one pixel is sold, so progress is always visible */}
        <div className="h-full rounded-full bg-signal" style={{ width: stats.soldPixels > 0 ? `max(3px, ${pct}%)` : 0 }} />
      </div>
      {!compact && (
        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div><dt className="text-ink-faint">{t("available")}</dt><dd className="pixel-num text-[0.8rem]">{f.number(stats.availablePixels)}</dd></div>
          <div><dt className="text-ink-faint">{t("owners")}</dt><dd className="pixel-num text-sm">{f.number(stats.owners)}</dd></div>
          <div><dt className="text-ink-faint">{t("creations")}</dt><dd className="pixel-num text-sm">{f.number(stats.publishedCreations)}</dd></div>
        </dl>
      )}
      {!compact && <p className="mt-2 text-xs text-ink-faint">{t("filledPct", { pct: f.number(pct, { maximumFractionDigits: pct < 0.01 ? 6 : 4 }) })}</p>}
    </section>
  );
}

const NICE = [1, 2, 5];
/** Round virtual-pixel length that renders between 70 and 150 CSS px, labelled with its approximate ground distance. */
function scaleBar(scale: number) {
  let len = 1;
  for (let m = 1; m < 1e6; m *= 10) for (const n of NICE) { len = n * m; if (len * scale >= 70) return { len, px: len * scale }; }
  return { len, px: len * scale };
}

export function MapControls({ cam, onZoomIn, onZoomOut, onFit, className = "" }: { cam: Camera; onZoomIn: () => void; onZoomOut: () => void; onFit: () => void; className?: string }) {
  const t = useTranslations("map");
  const f = useFormatter();
  const bar = useMemo(() => scaleBar(cam.scale), [cam.scale]);
  const km = bar.len * DEGREES_PER_PIXEL * 111.32; // km at the equator: 1° ≈ 111.32 km
  const btn = "btn btn-ghost !bg-white !min-h-11 !w-11 !px-0 text-lg shadow-float";
  return (
    <div className={`pointer-events-none flex items-end gap-3 ${className}`}>
      <div className="pointer-events-auto hidden rounded-full bg-white/90 px-3 py-1.5 text-[0.7rem] shadow-float sm:block" aria-hidden>
        <div className="flex items-center gap-2">
          <div className="h-1.5 border-x-2 border-b-2 border-ink" style={{ width: bar.px }} />
          <span className="pixel-num whitespace-nowrap">{f.number(bar.len)} px ≈ {km >= 1 ? `${f.number(km, { maximumFractionDigits: 0 })} km` : `${f.number(km * 1000, { maximumFractionDigits: 0 })} m`}</span>
        </div>
      </div>
      <div className="pointer-events-auto flex flex-col gap-1.5">
        <div className="rounded-full bg-white/90 px-2.5 py-1 text-center text-xs shadow-float" role="status" aria-label={t("zoomLevel")}>
          <span className="pixel-num" data-testid="zoom-level">{cam.scale >= 10 ? Math.round(cam.scale) : cam.scale >= 1 ? cam.scale.toFixed(1) : cam.scale.toFixed(2)}×</span>
        </div>
        <button className={btn} onClick={onZoomIn} aria-label={t("zoomIn")} title={t("zoomIn")}>+</button>
        <button className={btn} onClick={onZoomOut} aria-label={t("zoomOut")} title={t("zoomOut")}>−</button>
        <button className={btn} onClick={onFit} aria-label={t("recenter")} title={t("recenter")}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
        </button>
      </div>
    </div>
  );
}

export function CursorReadout({ x, y }: { x: number; y: number }) {
  const f = useFormatter();
  const locale = useLocale();
  const { lon, lat } = pixelToLonLat(x, y);
  const dir = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(3)}°${v >= 0 ? pos : neg}`;
  void locale;
  return (
    <p className="pixel-num pointer-events-none hidden rounded-full bg-white/90 px-3 py-1 text-[0.7rem] shadow-float md:block" aria-hidden data-testid="cursor-readout">
      x {f.number(Math.floor(x))} · y {f.number(Math.floor(y))} <span className="text-ink-faint">| {dir(lat, "N", "S")} {dir(lon, "E", "W")}</span>
    </p>
  );
}
