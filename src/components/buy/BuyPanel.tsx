"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { PRESET_SIZES, GRID_HEIGHT, GRID_WIDTH, MAX_SIDE } from "@/lib/grid/constants";
import { validateRect, type Rect } from "@/lib/grid/geometry";
import { formatMoney, quote } from "@/lib/grid/pricing";
import type { SelectionState } from "@/components/map/engine";

export interface Pricing { unitPriceCents: number; currency: string; minArea: number; maxArea: number; salesOpen: boolean }
export type ServerFree = boolean | "checking" | null;

interface Props {
  pricing: Pricing;
  locale: string;
  size: { w: number; h: number };
  onSize: (w: number, h: number) => void;
  selection: Rect | null;
  onMoveSelection: (r: Rect) => void;
  state: SelectionState | null;
  serverFree: ServerFree;
  signedIn: boolean;
  onContinue: () => void;
  onClose: () => void;
}

const num = (v: string) => (v === "" ? 0 : Math.max(0, Math.min(99999, Math.floor(Number(v)) || 0)));

export function BuyPanel({ pricing, locale, size, onSize, selection, onMoveSelection, state, serverFree, signedIn, onContinue, onClose }: Props) {
  const t = useTranslations("buy");
  const f = useFormatter();
  const [fine, setFine] = useState(false); // mobile: position fine-tuning is folded away to keep the map visible
  const sizeErr = validateRect({ x: 0, y: 0, ...size }, { minArea: pricing.minArea, maxArea: pricing.maxArea });
  const q = size.w > 0 && size.h > 0 ? quote(size, pricing.unitPriceCents) : null;
  const blocked = state === "blocked" || state === "out" || serverFree === false;
  const ready = Boolean(selection && !sizeErr && !blocked && state === "ok" && serverFree !== "checking" && pricing.salesOpen);

  const status = !pricing.salesOpen ? { tone: "bad", text: t("status.closed") }
    : sizeErr ? { tone: "bad", text: t(`sizeError.${sizeErr}`, { min: f.number(pricing.minArea), max: f.number(pricing.maxArea), side: MAX_SIDE }) }
    : !selection ? { tone: "info", text: t("status.place") }
    : state === "out" ? { tone: "bad", text: t("status.out") }
    : state === "blocked" ? { tone: "bad", text: t("status.blocked") }
    : serverFree === false ? { tone: "bad", text: t("status.reserved") }
    : state === "checking" || serverFree === "checking" ? { tone: "info", text: t("status.checking") }
    : { tone: "ok", text: t("status.free") };

  const tone = { ok: "bg-mint/12 text-[#0b7a5a]", bad: "bg-danger/10 text-danger", info: "bg-paper-2 text-ink-soft" }[status.tone as "ok" | "bad" | "info"];
  const move = (dx: number, dy: number) => selection && onMoveSelection({ ...selection, x: Math.max(0, Math.min(GRID_WIDTH - selection.w, selection.x + dx)), y: Math.max(0, Math.min(GRID_HEIGHT - selection.h, selection.y + dy)) });

  return (
    <aside aria-label={t("title")} data-testid="buy-panel"
      className="card pointer-events-auto absolute inset-x-2 bottom-2 z-30 flex max-h-[60vh] flex-col p-3.5 md:inset-x-auto md:bottom-4 md:right-4 md:top-4 md:max-h-none md:w-[23.5rem] md:p-5 animate-rise">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold leading-tight md:text-xl">{t("title")}</h2>
          <p className="mt-0.5 text-xs text-ink-soft">{t("unitPrice", { price: formatMoney(pricing.unitPriceCents, locale, pricing.currency) })}</p>
        </div>
        <button className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-paper-2 text-lg" onClick={onClose} aria-label={t("close")}>×</button>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-0.5">
        <fieldset>
          <legend className="label">{t("presets")}</legend>
          <div className="grid grid-cols-5 gap-1.5">
            {PRESET_SIZES.map((p) => {
              const on = size.w === p.w && size.h === p.h;
              return (
                <button key={`${p.w}x${p.h}`} aria-pressed={on} onClick={() => onSize(p.w, p.h)}
                  className={`rounded-xl px-1 py-2 text-center transition ${on ? "bg-ink text-white" : "bg-paper-2 hover:bg-line"}`}>
                  <span className="pixel-num block text-[0.95rem] leading-none">{p.w}²</span>
                  <span className={`mt-1 block text-[0.65rem] ${on ? "text-white/70" : "text-ink-faint"}`}>{formatMoney(p.w * p.h * pricing.unitPriceCents, locale, pricing.currency)}</span>
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
          {selection && (
            <fieldset className="mt-3">
              <legend className="label">{t("position")}</legend>
              <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <div><label className="sr-only" htmlFor="bp-x">x</label><input id="bp-x" className="field pixel-num" inputMode="numeric" value={selection.x} onChange={(e) => onMoveSelection({ ...selection, x: Math.min(GRID_WIDTH - selection.w, num(e.target.value)) })} aria-label="x" /></div>
                <div><label className="sr-only" htmlFor="bp-y">y</label><input id="bp-y" className="field pixel-num" inputMode="numeric" value={selection.y} onChange={(e) => onMoveSelection({ ...selection, y: Math.min(GRID_HEIGHT - selection.h, num(e.target.value)) })} aria-label="y" /></div>
                <div className="grid grid-cols-3 gap-0.5" role="group" aria-label={t("nudge")}>
                  <span /><button className="btn btn-ghost btn-sm !min-h-8 !w-8 !px-0" onClick={() => move(0, -1)} aria-label={t("up")}>↑</button><span />
                  <button className="btn btn-ghost btn-sm !min-h-8 !w-8 !px-0" onClick={() => move(-1, 0)} aria-label={t("left")}>←</button>
                  <button className="btn btn-ghost btn-sm !min-h-8 !w-8 !px-0" onClick={() => move(0, 1)} aria-label={t("down")}>↓</button>
                  <button className="btn btn-ghost btn-sm !min-h-8 !w-8 !px-0" onClick={() => move(1, 0)} aria-label={t("right")}>→</button>
                </div>
              </div>
            </fieldset>
          )}
        </div>

        <div className="mt-3 rounded-2xl bg-paper-2 p-3 md:mt-4 md:p-3.5" aria-live="polite">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-ink-soft">{t("area")}</span>
            <span className="pixel-num text-base md:text-lg" data-testid="buy-area">{q ? f.number(q.area) : "—"} <span className="text-xs text-ink-faint">px</span></span>
          </div>
          <div className="mt-0.5 flex items-baseline justify-between">
            <span className="text-sm text-ink-soft">{t("price")}</span>
            <span className="pixel-display text-[2.1rem] text-signal md:text-[2.4rem]" data-testid="buy-price">{q ? formatMoney(q.totalCents, locale, pricing.currency) : "—"}</span>
          </div>
          <p className="mt-1 hidden text-[0.7rem] text-ink-faint md:block">{t("taxNote")}</p>
        </div>
      </div>

      <div className="shrink-0 pt-3">
        <p role="status" data-testid="buy-status" className={`rounded-xl px-3 py-2 text-sm font-semibold ${tone}`}>{status.text}</p>
        <button className="btn btn-primary mt-2.5 w-full" disabled={!ready} onClick={onContinue} data-testid="buy-continue">
          {signedIn ? t("continue") : t("signInToContinue")}
        </button>
        <p className="mt-2 hidden text-[0.7rem] leading-snug text-ink-faint md:block">
          {t("legal")} <Link href="/terms" className="underline">{t("terms")}</Link> · <Link href="/rules" className="underline">{t("rules")}</Link>
        </p>
      </div>
    </aside>
  );
}
