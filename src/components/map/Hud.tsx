"use client";

import { useMemo } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { metersPerPixel, pixelToLonLat } from "@/lib/grid/geometry";
import { assetUrl } from "@/lib/images/sizes";
import type { Camera } from "./engine";
import type { PublicStats } from "@/lib/data/map";

/** Pixels sold, from the database. No placeholder numbers: until the first sale it truthfully reads 0. */
export function StatsCard({ stats, compact }: { stats: PublicStats; compact: boolean }) {
  const t = useTranslations("stats");
  const f = useFormatter();
  const pct = stats.fillPercent;
  // the share of the land sold, with enough digits to never read "0 %" once something is sold: 0.015 %, 2.5 %, 40 %
  const pctLabel = f.number(pct / 100, { style: "percent", ...(pct < 1 ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 1 }) });
  return (
    <section aria-label={t("label")} className={`card pointer-events-auto w-full max-w-[22rem] ${compact ? "p-3" : "p-4"}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{t("sold")}</p>
      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 leading-none">
        <span className="pixel-display text-[2.7rem] text-signal" data-testid="sold-pixels">{f.number(stats.soldPixels)}</span>
        <span className="pixel-num text-sm text-ink-faint">/ {f.number(stats.totalPixels)}</span>
      </p>
      <div className="mt-2.5 flex items-center gap-2.5">
        <div className="h-2.5 flex-1 overflow-hidden rounded-[3px] bg-paper-2 shadow-[inset_0_0_0_1.5px_var(--color-line)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 10000) / 10000} aria-valuetext={pctLabel} aria-label={t("filled")}>
          {/* the bar is at least 3px wide as soon as one pixel is sold, so progress is always visible */}
          <div className="h-full rounded-[2px] bg-signal" style={{ width: stats.soldPixels > 0 ? `max(3px, ${pct}%)` : 0 }} />
        </div>
        <span className="pixel-num shrink-0 text-xs font-bold text-ink-soft" data-testid="sold-percent">{pctLabel}</span>
      </div>
      {!compact && (
        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div><dt className="text-ink-faint">{t("available")}</dt><dd className="pixel-num text-[0.8rem]">{f.number(stats.availablePixels)}</dd></div>
          <div><dt className="text-ink-faint">{t("owners")}</dt><dd className="pixel-num text-sm">{f.number(stats.owners)}</dd></div>
          <div><dt className="text-ink-faint">{t("creations")}</dt><dd className="pixel-num text-sm">{f.number(stats.publishedCreations)}</dd></div>
        </dl>
      )}
    </section>
  );
}

/** What the "latest creations" tile needs of a published parcel (all of it public). */
export interface LatestCreation { code: string; x: number; y: number; w: number; h: number; assetId: string; title: string | null }

/** The newest published creations, as small pictures: click one to fly to it, the arrow opens the whole gallery. Real data only. */
export function LatestTile({ items, onPick }: { items: LatestCreation[]; onPick: (c: LatestCreation) => void }) {
  const t = useTranslations("latest");
  return (
    // not on phones (the map needs the room) nor on very short screens
    <section aria-label={t("title")} className="card pointer-events-auto w-full max-w-[22rem] p-4 max-sm:hidden [@media(max-height:639px)]:hidden" data-testid="latest-tile">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-extrabold leading-tight">{t("title")}</h2>
        <Link href="/discover" className="btn btn-ghost btn-icon btn-sm" aria-label={t("all")} title={t("all")} data-testid="latest-all">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 5l7 7-7 7" /></svg>
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft" data-testid="latest-empty">{t("empty")}</p>
      ) : (
        <ul className="mt-3 flex gap-2.5">
          {items.map((c) => {
            const label = t("open", { title: c.title ?? t("untitled") });
            return (
              <li key={c.code}>
                <button type="button" onClick={() => onPick(c)} aria-label={label} title={label} data-testid="latest-item"
                  className="block h-14 w-14 overflow-hidden rounded-[6px] bg-paper-2 shadow-[inset_0_0_0_1.5px_var(--color-line)] transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cobalt">
                  <img src={assetUrl(c.assetId, 128)} alt="" className="h-full w-full object-contain" style={{ imageRendering: "pixelated" }} loading="lazy" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
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
  // Mercator: the ground size of a pixel shrinks with cos(latitude), so the scale bar follows the latitude of the view centre
  const km = (bar.len * metersPerPixel(pixelToLonLat(cam.x, cam.y).lat)) / 1000;
  const btn = "btn btn-ghost btn-icon !min-h-11 !min-w-11 text-lg";
  return (
    <div className={`pointer-events-none flex items-end gap-3 ${className}`}>
      <div className="pointer-events-auto hidden badge-px px-3 py-1.5 text-[0.7rem] sm:block" aria-hidden>
        <div className="flex items-center gap-2">
          <div className="h-1.5 border-x-2 border-b-2 border-ink" style={{ width: bar.px }} />
          <span className="pixel-num whitespace-nowrap">{f.number(bar.len)} px ≈ {km >= 1 ? `${f.number(km, { maximumFractionDigits: 0 })} km` : `${f.number(km * 1000, { maximumFractionDigits: 0 })} m`}</span>
        </div>
      </div>
      <div className="pointer-events-auto flex flex-col gap-1.5">
        <div className="badge-px px-2.5 py-1 text-center text-xs" role="status" aria-label={t("zoomLevel")}>
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
    <p className="pixel-num pointer-events-none hidden badge-px px-3 py-1 text-[0.7rem] md:block" aria-hidden data-testid="cursor-readout">
      x {f.number(Math.floor(x))} · y {f.number(Math.floor(y))} <span className="text-ink-faint">| {dir(lat, "N", "S")} {dir(lon, "E", "W")}</span>
    </p>
  );
}
