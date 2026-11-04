"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { AUTO_MS, PANEL_COUNT, PANEL_HEIGHT, PANEL_WIDTH, PANELS, panelSrc } from "@/lib/doom/comic";
import { useDoom } from "./useDoom";

/**
 * The story: eight pictures, one at a time, opened from a button. Nothing is fetched until it is opened
 * (the pictures are static files in `public/story`, prepared by `scripts/build-story.mts` from the owner's originals). Without the countdown (no story), the button is not there.
 */

const SWIPE_PX = 40;

export function ComicButton({ onSave, ended = false, className = "" }: { onSave: () => void; ended?: boolean; className?: string }) {
  const d = useDoom();
  const t = useTranslations("comic");
  const [open, setOpen] = useState(false);
  if (!d) return null;
  return (
    <>
      <button type="button" className={`btn btn-secondary btn-sm pointer-events-auto ${className}`} onClick={() => setOpen(true)} data-testid="comic-open">{t("open")}</button>
      {open && <ComicReader ended={ended} onClose={() => setOpen(false)} onSave={() => { setOpen(false); onSave(); }} />}
    </>
  );
}

function ComicReader({ ended, onClose, onSave }: { ended: boolean; onClose: () => void; onSave: () => void }) {
  const t = useTranslations("comic");
  const td = useTranslations("doom");
  const dlg = useRef<HTMLDialogElement>(null);
  const touch = useRef<number | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const last = PANEL_COUNT - 1;
  const n = index + 1; // the pictures are numbered from 1
  const auto = playing && index < last; // automatic reading stops by itself on the last picture

  const go = useCallback((to: number) => setIndex(Math.max(0, Math.min(last, to))), [last]);

  useEffect(() => {
    const el = dlg.current;
    if (el && !el.open) el.showModal();
  }, []);

  // the next picture is fetched while this one is read
  useEffect(() => {
    if (index < last) { const img = new Image(); img.src = panelSrc(index + 2); }
  }, [index, last]);

  // automatic reading (off until asked for)
  useEffect(() => {
    if (!auto) return;
    const id = setTimeout(() => setIndex((i) => Math.min(last, i + 1)), AUTO_MS);
    return () => clearTimeout(id);
  }, [auto, index, last]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(index + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(index - 1); }
  };

  return (
    <dialog ref={dlg} onCancel={(e) => { e.preventDefault(); onClose(); }} onKeyDown={onKeyDown} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} aria-labelledby="comic-title" data-testid="comic"
      className="comic pointer-events-auto m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto bg-[#0b0a14] p-0 text-white backdrop:bg-black/80 md:m-auto md:h-auto md:max-h-[96dvh] md:w-[min(62rem,96vw)] md:rounded-[var(--radius-card)] md:shadow-[var(--shadow-float)]">
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <h2 id="comic-title" className="pixel-display text-xl tracking-wider text-[var(--color-glitch-cyan)] sm:text-2xl">{t("title")}</h2>
        <button type="button" className="btn btn-secondary btn-icon btn-sm text-lg" aria-label={t("close")} onClick={onClose} data-testid="comic-close">×</button>
      </div>

      <div className="px-3 sm:px-5"
        onTouchStart={(e) => { touch.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => {
          const from = touch.current; touch.current = null;
          const to = e.changedTouches[0]?.clientX;
          if (from === null || to === undefined || Math.abs(to - from) < SWIPE_PX) return;
          go(index + (to < from ? 1 : -1));
        }}>
        {/* the picture; the key restarts the fade at each change (still, for those who asked for less motion) */}
        <div className="relative aspect-video w-full overflow-hidden rounded-[10px] bg-black shadow-[0_0_0_2px_var(--color-glitch-magenta),4px_4px_0_var(--color-glitch-cyan)]">
          <img key={n} src={panelSrc(n)} alt={t(`panels.p${n}.alt`)} width={PANEL_WIDTH} height={PANEL_HEIGHT} className="comic-panel absolute inset-0 h-full w-full object-contain" data-testid="comic-image" draggable={false} />
        </div>
      </div>

      {/* the caption is in the picture too (in French, small on a phone): here it is text, in the language of the page, readable at every size */}
      <div className="px-4 pb-1 pt-3 sm:px-6" aria-live="polite" data-testid="comic-caption">
        <p className="min-h-[4.5rem] max-w-prose text-base leading-relaxed text-white sm:min-h-[3.5rem] sm:text-lg" data-testid="comic-text">{t(`panels.p${n}.text`)}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3 pt-2 sm:px-6">
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => go(index - 1)} disabled={index === 0} data-testid="comic-prev">{t("previous")}</button>
          <p className="pixel-num min-w-24 text-center text-sm text-white/80" data-testid="comic-position">{t("position", { n, total: PANEL_COUNT })}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => go(index + 1)} disabled={index === last} data-testid="comic-next">{t("next")}</button>
        </div>
        <div className="flex items-center gap-3">
          <ol className="flex items-center gap-1.5" aria-label={t("pictures")}>
            {PANELS.map((p, i) => (
              <li key={p}>
                <button type="button" onClick={() => go(i)} aria-label={t("position", { n: p, total: PANEL_COUNT })} aria-current={i === index ? "step" : undefined}
                  className={`block h-3 w-3 rounded-[2px] ${i === index ? "bg-[var(--color-glitch-magenta)]" : "bg-white/35 hover:bg-white/60"}`} />
              </li>
            ))}
          </ol>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { if (auto) setPlaying(false); else { if (index >= last) setIndex(0); setPlaying(true); } }} aria-pressed={auto} data-testid="comic-play">
            {auto ? t("pause") : t("play")}
          </button>
        </div>
      </div>

      {index === last && (
        <div className="px-4 pb-4 sm:px-6" data-testid="comic-cta">
          {ended
            ? <Link href="/discover" className="btn btn-primary w-full sm:w-auto" onClick={onClose} data-testid="comic-survivors">{td("ctaOver")}</Link>
            : <button type="button" className="btn btn-primary doom-cta w-full sm:w-auto" onClick={onSave} data-testid="comic-save">{td("cta")}</button>}
        </div>
      )}
      <p className="px-4 pb-4 text-xs text-white/60 sm:px-6">{t("fiction")}</p>
    </dialog>
  );
}
