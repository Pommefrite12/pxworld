"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { ParcelEditor, type ParcelEditorHandle } from "@/components/editor/ParcelEditor";
import { Link } from "@/i18n/navigation";
import { fitSize } from "@/components/map/ParcelCard";
import { formatMoney, quote, type ParcelKind } from "@/lib/grid/pricing";
import { tintedBlob } from "@/lib/images/waterTintBrowser";
import type { Rect } from "@/lib/grid/geometry";
import { TITLE_MAX, TITLE_MIN, isValidTitle } from "@/lib/security/text";
import { CAMPAIGN_DAYS, DEFAULT_CAMPAIGN_DAYS, type CampaignDays } from "@/lib/campaign";
import type { Pricing } from "./BuyPanel";
import { ArchiveFields, EMPTY_ARCHIVE, type ArchiveValue } from "@/components/archive/ArchiveFields";

interface Props {
  rect: Rect;
  /** Land or water: what the buyer is acquiring. A water creation is shown in three blues. */
  kind: ParcelKind;
  pricing: Pricing;
  /** Land pixels of the parcel (from the map data); the rest is sea, offered or discounted. */
  landPixels: number | null;
  onClose: () => void;
  /** Show (blob) or clear (null) the creation inside the selection on the map; the dialog hides itself meanwhile. */
  onPreviewOnMap: (img: ImageBitmap | null) => void;
  /** Called when the server says the spot is gone, so the map can refresh. */
  onUnavailable: () => void;
  /**
   * `buy`: design, review, pay. `collective`: the same design, then the project is sent to moderation to be funded by several people
   * (nothing is paid here).
   */
  mode?: "buy" | "collective";
  /** The project was sent: the page leaves the buying mode. */
  onSent?: () => void;
}

export function CheckoutDialog({ rect, kind, pricing, landPixels, onClose, onPreviewOnMap, onUnavailable, mode = "buy", onSent }: Props) {
  const t = useTranslations("buy");
  const locale = useLocale();
  const f = useFormatter();
  const dlg = useRef<HTMLDialogElement>(null);
  const editor = useRef<ParcelEditorHandle>(null);
  const [step, setStep] = useState<"design" | "review">("design");
  const [has, setHas] = useState(false);
  const [finalUrl, setFinalUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [link, setLink] = useState("");
  const [commercial, setCommercial] = useState(false);
  const [archive, setArchive] = useState<ArchiveValue>(EMPTY_ARCHIVE);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const collective = mode === "collective";
  const [days, setDays] = useState<CampaignDays>(DEFAULT_CAMPAIGN_DAYS);
  const [sent, setSent] = useState<{ days: CampaignDays } | null>(null);
  const water = kind === "water";
  const q = quote(rect, pricing.unitPriceCents, { landPixels: landPixels ?? (water ? 0 : null), kind, seaPercent: pricing.seaPercent, waterPercent: pricing.waterPercent, landCutPercent: pricing.landCutPercent, currency: pricing.currency });
  const onChange = useCallback((v: boolean) => setHas(v), []);

  useEffect(() => {
    const d = dlg.current;
    if (d && !d.open) d.showModal();
    return () => { if (d?.open) d.close(); };
  }, []);
  useEffect(() => () => { if (finalUrl) URL.revokeObjectURL(finalUrl); }, [finalUrl]);

  const goReview = async () => {
    const blob = water ? await tintedBlob(await editor.current!.exportPng()) : await editor.current!.exportPng(); // the review shows what the public will see
    setFinalUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
    setStep("review");
  };

  const previewOnMap = async () => {
    const blob = await editor.current!.exportPng();
    onPreviewOnMap(await createImageBitmap(blob));
    dlg.current?.close();
    setPreviewing(true);
  };
  const backFromPreview = () => { onPreviewOnMap(null); setPreviewing(false); dlg.current?.showModal(); };

  const pay = async () => {
    setBusy(true); setError(null);
    try {
      const blob = await editor.current!.exportPng();
      const fd = new FormData();
      fd.set("kind", kind); fd.set("x", String(rect.x)); fd.set("y", String(rect.y)); fd.set("w", String(rect.w)); fd.set("h", String(rect.h));
      fd.set("image", new File([blob], "creation.png", { type: "image/png" }));
      fd.set("title", title); fd.set("description", description); fd.set("link", link); fd.set("commercial", String(commercial)); fd.set("category", archive.category); fd.set("placeLabel", archive.placeLabel); fd.set("placeCountry", archive.placeCountry); fd.set("locale", locale); fd.set("currency", pricing.currency);
      if (collective) fd.set("days", String(days));
      const r = await fetch(collective ? "/api/campaigns" : "/api/checkout", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (collective && r.ok && j.code) { setSent({ days }); setBusy(false); return; } // sent to moderation: nothing to pay
      if (!collective && r.ok && j.url) { window.location.assign(j.url); return; }
      const code = String(j.error ?? (r.status === 401 ? "unauthenticated" : "internal_error"));
      if (code === "px_parcel_unavailable") onUnavailable();
      if (code === "unauthenticated") { window.location.assign(`/auth/sign-in?next=${encodeURIComponent("/")}`); return; }
      // an error nobody anticipated keeps its code, so that it can be reported (and found in the logs)
      setError(t.has(`errors.${code}`) ? t(`errors.${code}`) : `${t("errors.generic")} (${code})`);
    } catch { setError(t("errors.network")); }
    setBusy(false);
  };

  return (
    <>
      <dialog ref={dlg} onCancel={(e) => { if (sent) { e.preventDefault(); onSent?.(); } else if (has && !confirm(t("discardConfirm"))) e.preventDefault(); else onClose(); }} aria-labelledby="co-title"
        className="m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto bg-paper p-0 text-ink backdrop:bg-ink/50 md:m-auto md:h-auto md:max-h-[94dvh] md:w-[min(64rem,96vw)] md:rounded-[var(--radius-card)] md:shadow-[var(--shadow-float)]">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-paper/95 px-5 py-3 backdrop-blur">
          <div>
            <h2 id="co-title" className="text-lg font-extrabold">{sent ? t("collective.sentTitle") : collective ? (step === "design" ? t("collective.designTitle") : t("collective.reviewTitle")) : step === "design" ? t("designTitle") : t("reviewTitle")}</h2>
            <p className="pixel-num text-xs text-ink-soft">{rect.w}×{rect.h} · {f.number(q.area)} px · {collective && `${t("collective.goal")} `}{formatMoney(q.totalCents, locale, pricing.currency)}</p>
          </div>
          <div className="flex items-center gap-2">
            <ol className="hidden items-center gap-1 text-xs font-semibold text-ink-faint sm:flex" aria-label={t("steps")}>
              <li className={step === "design" ? "text-ink" : ""}>1 · {t("stepDesign")}</li><li aria-hidden>→</li><li className={step === "review" ? "text-ink" : ""}>2 · {collective ? t("collective.stepSend") : t("stepPay")}</li>
            </ol>
            <button className="btn btn-ghost btn-icon btn-sm text-lg" aria-label={t("close")} onClick={() => { if (sent) onSent?.(); else if (!has || confirm(t("discardConfirm"))) onClose(); }}>×</button>
          </div>
        </div>

        <div className="p-5">
          <div hidden={step !== "design"}>
            {collective && <p className="mb-3 rounded-xl bg-paper-2 px-3 py-2 text-sm text-ink-soft" data-testid="co-collective-note">{t("collective.designNote", { goal: formatMoney(q.totalCents, locale, pricing.currency) })}</p>}
            {water && <p className="mb-3 rounded-xl bg-sky px-3 py-2 text-sm font-semibold text-cobalt" data-testid="co-water-note">{t("kind.waterHint")}</p>}
            <ParcelEditor ref={editor} w={rect.w} h={rect.h} onChange={onChange} />
            <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
              <p className="mr-auto text-xs text-ink-soft">{has ? t("designReady") : t("designEmpty")}</p>
              <button className="btn btn-ghost" onClick={previewOnMap} disabled={!has}>{t("previewOnMap")}</button>
              <button className="btn btn-primary" onClick={goReview} disabled={!has} data-testid="to-review">{t("toReview")}</button>
            </div>
          </div>

          {sent && (
            <div className="mx-auto max-w-xl py-6 text-center" data-testid="co-collective-sent">
              <p className="pixel-display text-5xl text-signal">✓</p>
              <h3 className="mt-2 text-xl font-extrabold">{t("collective.sentTitle")}</h3>
              <p className="mt-2 text-ink-soft">{t("collective.sentText", { days: sent.days })}</p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <Link href="/account/campaigns" className="btn btn-primary" data-testid="co-collective-mine">{t("collective.seeMine")}</Link>
                <button className="btn btn-ghost" onClick={() => onSent?.()} data-testid="co-collective-close">{t("close")}</button>
              </div>
            </div>
          )}

          {step === "review" && !sent && (
            <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
              <div>
                <p className="label">{t("finalRender")}</p>
                <div className="grid place-items-center rounded-xl bg-paper-2 p-3 shadow-[0_0_0_1.5px_var(--color-line)]">
                  {finalUrl && <img src={finalUrl} alt={t("finalRender")} width={rect.w} height={rect.h} className="pixelated max-w-full" style={{ imageRendering: "pixelated", ...fitSize(rect.w, rect.h, 384) }} />}
                </div>
                <div className="mt-3 flex gap-2">
                  <button className="btn btn-ghost btn-sm" onClick={() => setStep("design")}>← {t("backToEditor")}</button>
                  <button className="btn btn-ghost btn-sm" onClick={previewOnMap}>{t("previewOnMap")}</button>
                </div>
                <p className="mt-3 text-xs text-ink-soft">{collective ? t("collective.moderationNote") : t("moderationNote")}</p>
              </div>
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void pay(); }}>
                <div><label className="label" htmlFor="co-title-in">{t("fields.title")}</label><input id="co-title-in" className="field" required minLength={TITLE_MIN} maxLength={TITLE_MAX} autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="co-title" /><p className="mt-1 text-xs text-ink-faint">{t("fields.titleHint", { min: TITLE_MIN })}</p></div>
                <div><label className="label" htmlFor="co-desc">{t("fields.description")}</label><textarea id="co-desc" className="field !min-h-20" maxLength={280} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
                <ArchiveFields id="co" value={archive} onChange={setArchive} />
                <div><label className="label" htmlFor="co-link">{t("fields.link")}</label><input id="co-link" className="field" type="url" inputMode="url" placeholder="https://" maxLength={500} value={link} onChange={(e) => setLink(e.target.value)} /><p className="mt-1 text-xs text-ink-faint">{t("fields.linkHint")}</p></div>
                {collective && (
                  <fieldset data-testid="co-days">
                    <legend className="label">{t("collective.duration")}</legend>
                    <div className="grid grid-cols-3 gap-1.5">
                      {CAMPAIGN_DAYS.map((d) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} data-testid={`co-days-${d}`} className="btn btn-secondary btn-sm">{t("collective.days", { n: d })}</button>)}
                    </div>
                    <p className="mt-1 text-xs text-ink-faint">{t("collective.durationHint", { days })}</p>
                  </fieldset>
                )}
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={commercial} onChange={(e) => setCommercial(e.target.checked)} /><span>{t("fields.commercial")}</span></label>
                <div className="rounded-2xl bg-paper-2 p-4">
                  <dl className="space-y-1 text-sm">
                    <div className="flex justify-between"><dt className="text-ink-soft">{t("summary.parcel")}</dt><dd className="pixel-num">{rect.w}×{rect.h}</dd></div>
                    <div className="flex justify-between"><dt className="text-ink-soft">{t("area")}</dt><dd className="pixel-num" data-testid="co-area">{f.number(q.area)} px</dd></div>
                    {water && (
                      <div className="flex justify-between"><dt className="text-ink-soft">{t("summary.kind")}</dt><dd className="font-semibold" data-testid="co-kind">{t("kind.water")}</dd></div>
                    )}
                    {q.cutPixels > 0 && !water && (
                      <>
                        <div className="flex justify-between"><dt className="text-ink-soft">{t("summary.land")}</dt><dd className="pixel-num">{f.number(q.landPixels)} px · {formatMoney(q.landPixels * q.unitPriceCents, locale, pricing.currency)}</dd></div>
                        <div className="flex justify-between"><dt className="text-ink-soft">{t("summary.sea")}</dt><dd className="pixel-num" data-testid="co-sea">{f.number(q.seaPixels)} px · {pricing.seaPercent === 0 ? t("summary.seaFree") : formatMoney(q.totalCents - q.landPixels * q.unitPriceCents, locale, pricing.currency)}</dd></div>
                      </>
                    )}
                    {q.cutPixels > 0 && water && (
                      <>
                        <div className="flex justify-between"><dt className="text-ink-soft">{t("summary.water")}</dt><dd className="pixel-num">{f.number(q.ownedPixels)} px · {formatMoney(q.totalCents - Math.floor((q.landPixels * q.unitPriceCents * q.seaPercent) / 100), locale, pricing.currency)}</dd></div>
                        <div className="flex justify-between"><dt className="text-ink-soft">{t("summary.land")}</dt><dd className="pixel-num" data-testid="co-land">{f.number(q.cutPixels)} px · {pricing.landCutPercent === 0 ? t("summary.seaFree") : formatMoney(Math.floor((q.landPixels * q.unitPriceCents * q.seaPercent) / 100), locale, pricing.currency)}</dd></div>
                      </>
                    )}
                    <div className="flex justify-between border-t border-line pt-2"><dt className="font-semibold">{collective ? t("collective.goalLabel") : t("summary.total")}</dt><dd className="pixel-display text-4xl text-signal" data-testid="co-total">{formatMoney(q.totalCents, locale, pricing.currency)}</dd></div>
                  </dl>
                  <p className="mt-1 text-xs text-ink-faint">{collective ? t("collective.goalNote") : t("taxNote")}</p>
                </div>
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} data-testid="co-accept" />
                  <span>{t.rich(collective ? "collective.accept" : "accept", { terms: (c) => <Link href="/terms" target="_blank" className="underline">{c}</Link>, rules: (c) => <Link href="/rules" target="_blank" className="underline">{c}</Link> })}</span></label>
                {error && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm font-semibold text-danger" data-testid="co-error">{error}</p>}
                <button className="btn btn-primary w-full" type="submit" disabled={busy || !accepted || !isValidTitle(title) || !archive.category} data-testid="co-pay">{collective ? (busy ? t("collective.sending") : t("collective.send")) : busy ? t("redirecting") : t("pay", { price: formatMoney(q.totalCents, locale, pricing.currency) })}</button>
                <p className="text-center text-xs text-ink-faint">{collective ? t("collective.nothingPaid") : t("securePayment")}</p>
              </form>
            </div>
          )}
        </div>
      </dialog>

      {previewing && (
        <div className="pointer-events-auto fixed inset-x-3 bottom-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-full bg-ink px-4 py-2.5 text-white shadow-float md:bottom-6">
          <span className="text-sm font-semibold">{t("previewing")}</span>
          <button className="btn btn-primary btn-sm" onClick={backFromPreview}>{t("backToEditor")}</button>
        </div>
      )}
    </>
  );
}
