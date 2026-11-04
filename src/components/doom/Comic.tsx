"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { PANEL_COUNT, PANEL_HEIGHT, PANEL_WIDTH, PANELS, WIPE_MS, panelSrc } from "@/lib/doom/comic";
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
  /** A picture has just been replaced: the one that goes (still shown under the new one) and which way the new one comes in. */
  const [wipe, setWipe] = useState<{ from: number; dir: "next" | "prev" } | null>(null);
  const last = PANEL_COUNT - 1;
  const n = index + 1; // the pictures are numbered from 1

  const go = useCallback((to: number) => {
    const next = Math.max(0, Math.min(last, to));
    if (next === index) return;
    setWipe({ from: index, dir: next > index ? "next" : "prev" });
    setIndex(next);
  }, [index, last]);

  useEffect(() => {
    const el = dlg.current;
    if (el && !el.open) el.showModal();
  }, []);

  // the pictures on each side are fetched while this one is read
  useEffect(() => {
    for (const k of [index + 2, index]) if (k >= 1 && k <= PANEL_COUNT) { const img = new Image(); img.src = panelSrc(k); }
  }, [index]);

  // once the new picture is in, the old one under it can go (also for those who asked for less motion: then it is there for nothing)
  useEffect(() => {
    if (!wipe) return;
    const id = setTimeout(() => setWipe(null), WIPE_MS + 250);
    return () => clearTimeout(id);
  }, [wipe]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(index + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(index - 1); }
  };
  const arrow = "absolute top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/40 bg-black/55 text-2xl leading-none text-white transition-opacity hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-0 sm:h-11 sm:w-11";

  return (
    <dialog ref={dlg} onCancel={(e) => { e.preventDefault(); onClose(); }} onKeyDown={onKeyDown} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} aria-labelledby="comic-title" data-testid="comic"
      className="comic pointer-events-auto m-0 mx-auto mt-[2dvh] mb-0 max-h-[96dvh] max-w-none w-[min(62rem,calc(100vw-1rem),calc((100dvh-23rem)*1.7778+2.5rem))] overflow-y-auto rounded-[var(--radius-card)] bg-[#0b0a14] p-0 text-white shadow-[var(--shadow-float)] backdrop:bg-transparent">
      {/* no visible title (the owner asked for it to go); it stays as the window's name for screen readers, and the close button sits on the picture */}
      <h2 id="comic-title" className="sr-only">{t("title")}</h2>

      <div className="px-3 pt-3 sm:px-5 sm:pt-4"
        onTouchStart={(e) => { touch.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => {
          const from = touch.current; touch.current = null;
          const to = e.changedTouches[0]?.clientX;
          if (from === null || to === undefined || Math.abs(to - from) < SWIPE_PX) return;
          go(index + (to < from ? 1 : -1));
        }}>
        {/* the picture comes in with a wipe, from the right when going on and from the left when going back, over the one that goes (still, for those who asked for less motion) */}
        <div className="relative aspect-video w-full overflow-hidden rounded-[10px] bg-black shadow-[0_0_0_2px_var(--color-glitch-magenta),4px_4px_0_var(--color-glitch-cyan)]">
          {wipe && <img src={panelSrc(wipe.from + 1)} alt="" aria-hidden="true" width={PANEL_WIDTH} height={PANEL_HEIGHT} className="absolute inset-0 h-full w-full object-contain" data-testid="comic-image-old" draggable={false} />}
          <img key={n} src={panelSrc(n)} alt={t(`panels.p${n}.alt`)} width={PANEL_WIDTH} height={PANEL_HEIGHT} className="comic-wipe absolute inset-0 h-full w-full object-contain" data-wipe={wipe?.dir} data-testid="comic-image" draggable={false} />
          <button type="button" className="absolute right-2 top-2 z-10 grid h-9 w-9 place-items-center rounded-full border border-white/40 bg-black/55 text-xl leading-none text-white hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white sm:h-10 sm:w-10" aria-label={t("close")} onClick={onClose} data-testid="comic-close"><span aria-hidden="true">×</span></button>
          <button type="button" className={`${arrow} left-2`} aria-label={t("previous")} onClick={() => go(index - 1)} disabled={index === 0} data-testid="comic-prev"><span aria-hidden="true">‹</span></button>
          <button type="button" className={`${arrow} right-2`} aria-label={t("next")} onClick={() => go(index + 1)} disabled={index === last} data-testid="comic-next"><span aria-hidden="true">›</span></button>
        </div>
      </div>

      {/* the words are in the picture: nothing to read under it, only the dots; screen readers get the position and the caption as text (in the language of the page) */}
      <div className="sr-only" aria-live="polite" data-testid="comic-caption">
        <p data-testid="comic-position">{t("position", { n, total: PANEL_COUNT })}</p>
        <p data-testid="comic-text">{t(`panels.p${n}.text`)}</p>
      </div>
      <ol className="flex items-center justify-center gap-1.5 px-4 pb-3 pt-3" aria-label={t("pictures")}>
        {PANELS.map((p, i) => (
          <li key={p}>
            <button type="button" onClick={() => go(i)} aria-label={t("position", { n: p, total: PANEL_COUNT })} aria-current={i === index ? "step" : undefined}
              className={`block h-3 w-3 rounded-[2px] ${i === index ? "bg-[var(--color-glitch-magenta)]" : "bg-white/35 hover:bg-white/60"}`} />
          </li>
        ))}
      </ol>

      {index === last && (
        <div className="px-4 pb-3 sm:px-6" data-testid="comic-cta">
          {ended
            ? <Link href="/discover" className="btn btn-primary w-full sm:w-auto" onClick={onClose} data-testid="comic-survivors">{td("ctaOver")}</Link>
            : <button type="button" className="btn btn-primary doom-cta w-full sm:w-auto" onClick={onSave} data-testid="comic-save">{td("cta")}</button>}
        </div>
      )}
    </dialog>
  );
}
