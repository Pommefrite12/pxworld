"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { PRESET_SIZES, MAX_SIDE } from "@/lib/grid/constants";
import { validateRect, type Rect } from "@/lib/grid/geometry";
import { formatMoney, quote, type ParcelKind, type Pricing } from "@/lib/grid/pricing";
import type { SelectionState } from "@/components/map/engine";
import { freePresets, type FreeInfo } from "@/lib/free";

export type { Pricing };
export type ServerFree = boolean | "checking" | null;

interface Props {
  pricing: Pricing;
  locale: string;
  size: { w: number; h: number };
  onSize: (w: number, h: number) => void;
  selection: Rect | null;
  state: SelectionState | null;
  /** What is being bought: land or water (the sea; shown in three blues). */
  kind: ParcelKind;
  onKind: (kind: ParcelKind) => void;
  /** Land pixels inside the selection (null while unknown): the sea part of a coastal parcel is discounted. */
  landPixels: number | null;
  serverFree: ServerFree;
  /** An account is needed to buy: anonymous visitors are sent to sign in (the spot is kept). */
  signedIn: boolean;
  onContinue: () => void;
  /** "Fund it together": the same design step, then the project goes to moderation instead of to the payment. */
  onCollective: () => void;
  onClose: () => void;
  /** The free period for this visitor, whether the selection is a free one (land, 1 to the biggest free size), and how many free imprints a PAID selection would cover. */
  free: FreeInfo | null;
  freeSel: boolean;
  covers: number;
}

const num = (v: string) => (v === "" ? 0 : Math.max(0, Math.min(99999, Math.floor(Number(v)) || 0)));

export function BuyPanel({ pricing, locale, size, onSize, selection, state, kind, onKind, landPixels, serverFree, signedIn, onContinue, onCollective, onClose, free, freeSel, covers }: Props) {
  const t = useTranslations("buy");
  const f = useFormatter();
  const [fine, setFine] = useState(false); // mobile: position fine-tuning is folded away to keep the map visible
  // a free imprint is smaller than the smallest paid parcel: the paid minimum does not apply to it
  const sizeErr = validateRect({ x: 0, y: 0, ...size }, freeSel && free ? { minArea: 1, maxArea: free.maxArea } : { minArea: pricing.minArea, maxArea: pricing.maxArea });
  const water = kind === "water";
  const rates = { kind, seaPercent: pricing.seaPercent, waterPercent: pricing.waterPercent, landCutPercent: pricing.landCutPercent, currency: pricing.currency };
  const q = size.w > 0 && size.h > 0 ? quote(size, pricing.unitPriceCents, { landPixels: selection ? landPixels : water ? 0 : null, ...rates }) : null;
  const unit = water ? Math.floor((pricing.unitPriceCents * pricing.waterPercent) / 100) : pricing.unitPriceCents; // what one pixel costs (the shown rate)
  const blocked = state === "blocked" || state === "out" || state === "water" || state === "land" || serverFree === false;
  const ready = Boolean(selection && !sizeErr && !blocked && state === "ok" && serverFree !== "checking" && (freeSel || pricing.salesOpen));
  const freeWhy = free && free.open && free.userReason ? free.userReason : null; // free is open, but this account has used it
  // a project funded by several people is for BIG parcels: below this area one pays alone
  const tooSmall = size.w * size.h < pricing.campaignMinArea;

  const status = !freeSel && !pricing.salesOpen ? { tone: "bad", text: t(pricing.editionState === "prelaunch" ? "status.notOpen" : pricing.editionState === "closed" ? "status.editionClosed" : "status.closed") }
    : sizeErr === "area_too_small" && freeWhy ? { tone: "bad", text: t(`free.why.${freeWhy}`, { max: free?.lifetimeMax ?? 3 }) }
    : sizeErr ? { tone: "bad", text: t(`sizeError.${sizeErr}`, { min: f.number(pricing.minArea), max: f.number(pricing.maxArea), side: MAX_SIDE }) }
    : !selection ? { tone: "info", text: t("status.place") }
    : state === "out" ? { tone: "bad", text: t("status.out") }
    : state === "water" ? { tone: "bad", text: t("status.water", { pct: pricing.minLandPercent }) }
    : state === "land" ? { tone: "bad", text: t("status.land", { pct: pricing.minWaterPercent }) }
    : state === "blocked" ? { tone: "bad", text: t("status.blocked") }
    : serverFree === false ? { tone: "bad", text: t("status.reserved") }
    : state === "checking" || serverFree === "checking" ? { tone: "info", text: t("status.checking") }
    : freeSel ? { tone: "ok", text: t("free.statusOk") }
    : covers > 0 ? { tone: "ok", text: t("free.statusCovers", { n: covers }) }
    : { tone: "ok", text: t("status.free") };

  const tone = { ok: "bg-mint/12 text-(--color-mint-ink)", bad: "bg-danger/10 text-danger", info: "bg-paper-2 text-ink-soft" }[status.tone as "ok" | "bad" | "info"];

  return (
    <aside aria-label={t("title")} data-testid="buy-panel"
      className="card pointer-events-auto absolute inset-x-2 bottom-2 z-30 flex max-h-[60vh] flex-col p-3.5 md:inset-x-auto md:bottom-4 md:right-4 md:top-4 md:max-h-none md:w-[23.5rem] md:p-5 animate-rise">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold leading-tight md:text-xl">{t("title")}</h2>
          <p className="mt-0.5 text-xs text-ink-soft">{freeSel ? t("free.subtitle") : t("unitPrice", { price: formatMoney(unit, locale, pricing.currency) })}</p>
        </div>
        <button className="btn btn-ghost btn-icon btn-sm shrink-0 text-lg" onClick={onClose} aria-label={t("close")}>×</button>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-0.5">
        <fieldset data-testid="buy-kind">
          <legend className="label">{t("kind.label")}</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {(["land", "water"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => onKind(k)} data-testid={`buy-kind-${k}`} className="btn btn-secondary">{t(`kind.${k}`)}</button>
            ))}
          </div>
          <p className="mt-1.5 text-[0.7rem] leading-snug text-ink-faint">{water ? t("kind.waterHint") : t("kind.landHint")}</p>
        </fieldset>

        {free && free.open && (
          <fieldset className="mt-3" data-testid="buy-free">
            <legend className="label">{t("free.title")}</legend>
            {free.userReason ? (
              <p className="text-[0.7rem] leading-snug text-ink-soft" data-testid="buy-free-why">{t(`free.why.${free.userReason}`, { max: free.lifetimeMax })}</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-1.5">
                  {freePresets(free.maxArea).map((p) => (
                    <button key={`free-${p.w}x${p.h}`} aria-pressed={freeSel && size.w === p.w && size.h === p.h} onClick={() => { if (kind === "water") onKind("land"); onSize(p.w, p.h); }}
                      className="btn btn-secondary !min-h-14 !flex-col !gap-0 !px-1 text-center" data-testid={`buy-free-${p.w}x${p.h}`}>
                      <span className="pixel-num block whitespace-nowrap text-[0.8rem] leading-none">{p.w}×{p.h}</span>
                      <span className="mt-1 block text-[0.65rem] font-semibold text-mint">{t("free.price")}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[0.7rem] leading-snug text-ink-faint">{t("free.hint", { max: free.maxArea, date: free.endsAt ? f.dateTime(new Date(free.endsAt), { dateStyle: "medium" }) : "" })}</p>
              </>
            )}
          </fieldset>
        )}

        <fieldset className="mt-3">
          <legend className="label">{t("presets")}</legend>
          <div className="grid grid-cols-3 gap-1.5">
            {PRESET_SIZES.map((p) => {
              const on = size.w === p.w && size.h === p.h;
              return (
                <button key={`${p.w}x${p.h}`} aria-pressed={on} onClick={() => onSize(p.w, p.h)}
                  className="btn btn-secondary !min-h-14 !flex-col !gap-0 !px-1 text-center">
                  <span className="pixel-num block whitespace-nowrap text-[0.8rem] leading-none">{p.w}×{p.h}</span>
                  <span className="mt-1 block text-[0.65rem] font-semibold text-ink-soft">{formatMoney(quote(p, pricing.unitPriceCents, { landPixels: water ? 0 : null, ...rates }).totalCents, locale, pricing.currency)}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <button className="mt-2 text-xs font-semibold text-cobalt underline md:hidden" onClick={() => setFine((v) => !v)} aria-expanded={fine}>{t("fineTune")}</button>
        <div className={`${fine ? "" : "hidden md:block"}`}>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div><label className="label" htmlFor="bp-w">{t("width")}</label><input id="bp-w" className="field pixel-num" inputMode="numeric" value={size.w || ""} onChange={(e) => onSize(num(e.target.value), size.h)} /></div>
            <div><label className="label" htmlFor="bp-h">{t("height")}</label><input id="bp-h" className="field pixel-num" inputMode="numeric" value={size.h || ""} onChange={(e) => onSize(size.w, num(e.target.value))} /></div>
          </div>
        </div>

        <div className="mt-3 rounded-2xl bg-paper-2 p-3 md:mt-4 md:p-3.5" aria-live="polite">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-ink-soft">{t("area")}</span>
            <span className="pixel-num text-base md:text-lg" data-testid="buy-area">{q ? f.number(q.area) : "—"} <span className="text-xs text-ink-faint">px</span></span>
          </div>
          <div className="mt-0.5 flex items-baseline justify-between">
            <span className="text-sm text-ink-soft">{t("price")}</span>
            <span className="pixel-display text-[2.1rem] text-signal md:text-[2.4rem]" data-testid="buy-price">{freeSel ? t("free.price") : q ? formatMoney(q.totalCents, locale, pricing.currency) : "—"}</span>
          </div>
          {freeSel && <p className="mt-1 text-xs text-ink-soft" data-testid="buy-free-note">{t("free.coverNote")}</p>}
          {q && q.cutPixels > 0 && !water && !freeSel && (
            <p className="mt-1 text-xs text-ink-soft" data-testid="buy-sea-note">
              {pricing.seaPercent === 0 ? t("seaFree", { land: f.number(q.landPixels), sea: f.number(q.seaPixels) }) : t("seaDiscount", { land: f.number(q.landPixels), sea: f.number(q.seaPixels), pct: pricing.seaPercent })}
            </p>
          )}
          {q && q.cutPixels > 0 && water && (
            <p className="mt-1 text-xs text-ink-soft" data-testid="buy-land-note">
              {pricing.landCutPercent === 0 ? t("landFree", { land: f.number(q.cutPixels), water: f.number(q.ownedPixels) }) : t("landDiscount", { land: f.number(q.cutPixels), water: f.number(q.ownedPixels), pct: pricing.landCutPercent })}
            </p>
          )}
        </div>
      </div>

      <div className="shrink-0 pt-3">
        <p role="status" data-testid="buy-status" className={`rounded-[8px] px-3 py-2 text-sm font-semibold ${tone}`}>{status.text}</p>
        <button className="btn btn-primary mt-2.5 w-full" disabled={!ready} onClick={onContinue} data-testid="buy-continue">
          {signedIn ? (freeSel ? t("free.continue") : t("continue")) : t("signInToContinue")}
        </button>
        {!freeSel && <button className="btn btn-secondary mt-1.5 w-full" disabled={!ready || tooSmall} onClick={onCollective} data-testid="buy-collective" aria-describedby="buy-collective-note">
          {t("collective.button")}
        </button>}
        {!freeSel && <p id="buy-collective-note" className="mt-1 text-[0.7rem] leading-snug text-ink-faint" data-testid="buy-collective-note">
          {ready && tooSmall ? t("collective.tooSmall", { min: f.number(pricing.campaignMinArea) }) : t("collective.hint")}{" "}
          <Link href="/projects" className="font-semibold text-cobalt underline" data-testid="buy-collective-browse">{t("collective.browse")}</Link>
        </p>}
        <p className="mt-2 hidden text-[0.7rem] leading-snug text-ink-faint md:block">
          {t("legal")} <Link href="/terms" className="underline">{t("terms")}</Link> · <Link href="/rules" className="underline">{t("rules")}</Link>
        </p>
      </div>
    </aside>
  );
}
