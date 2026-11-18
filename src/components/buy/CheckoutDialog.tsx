"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { ParcelEditor, type ParcelEditorHandle } from "@/components/editor/ParcelEditor";
import { Link } from "@/i18n/navigation";
import { fitSize } from "@/components/map/ParcelCard";
import { formatMoney, quote, type ParcelKind } from "@/lib/grid/pricing";
import { tintedBlob } from "@/lib/images/waterTintBrowser";
import type { Rect } from "@/lib/grid/geometry";
import { DESCRIPTION_MAX, DESCRIPTION_MIN, TITLE_MAX, TITLE_MIN, isValidDescription, isValidTitle } from "@/lib/security/text";
import { CAMPAIGN_DAYS, DEFAULT_CAMPAIGN_DAYS, type CampaignDays } from "@/lib/campaign";
import type { Pricing } from "./BuyPanel";
import { ArchiveFields, EMPTY_ARCHIVE, type ArchiveValue } from "@/components/archive/ArchiveFields";
import { draftStore, draftsSupported, expiresAt, type Draft } from "@/lib/editor/drafts";

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
   * (nothing is paid here). `free`: a free imprint (1 to 24 pixels): the same design, no payment, the pixels are placed at once and a paid
   * parcel that touches them covers them.
   */
  mode?: "buy" | "collective" | "free";
  /** The project was sent: the page leaves the buying mode. */
  onSent?: () => void;
  /** Who the saved project belongs to (the user name): a project saved in the editor is kept in this browser, for this account, for 24 hours. Null: no saving. */
  draftOwner?: string | null;
}

type DraftFieldsLike = { title: string; description: string; link: string; commercial: boolean; archive: ArchiveValue; days: number };

export function CheckoutDialog({ rect, kind, pricing, landPixels, onClose, onPreviewOnMap, onUnavailable, mode = "buy", onSent, draftOwner = null }: Props) {
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
  const free = mode === "free";
  const [days, setDays] = useState<CampaignDays>(DEFAULT_CAMPAIGN_DAYS);
  const [sent, setSent] = useState<{ days: CampaignDays } | null>(null);
  const water = kind === "water";
  const q = quote(rect, pricing.unitPriceCents, { landPixels: landPixels ?? (water ? 0 : null), kind, seaPercent: pricing.seaPercent, waterPercent: pricing.waterPercent, landCutPercent: pricing.landCutPercent, currency: pricing.currency });
  const onChange = useCallback((v: boolean) => setHas(v), []);

  /* ---------- the saved project (kept in this browser for 24 hours) ---------- */
  const canSave = Boolean(draftOwner) && draftsSupported();
  const [pending, setPending] = useState<Draft | null>(null); // a saved project of this parcel's size, offered
  const [saved, setSaved] = useState<Draft | null>(null); // the one just saved
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [closing, setClosing] = useState(false);
  // what changed since the last save: the editor tells when the drawing changes, the fields are compared
  const version = useRef(0);
  const [edits, setEdits] = useState(0), [cleanEdits, setCleanEdits] = useState(0);
  const baselineNext = useRef(false); // set just before a saved project is put back: the editor's report of that very change is the new "saved" state
  const onEdit = useCallback(() => {
    version.current += 1;
    setEdits(version.current);
    if (baselineNext.current) { baselineNext.current = false; setCleanEdits(version.current); }
  }, []);
  const keyOf = (v: DraftFieldsLike) => JSON.stringify([v.title, v.description, v.link, v.commercial, v.archive, v.days]);
  const fieldsKey = keyOf({ title, description, link, commercial, archive, days });
  const [cleanKey, setCleanKey] = useState(fieldsKey);
  const dirty = has && (edits !== cleanEdits || fieldsKey !== cleanKey);
  const when = (ts: number) => f.dateTime(ts, { weekday: "short", hour: "numeric", minute: "2-digit" });

  useEffect(() => {
    if (!canSave) return;
    let alive = true;
    draftStore.load(draftOwner!).then((d) => { if (alive && d && d.rect.w === rect.w && d.rect.h === rect.h) setPending(d); }).catch(() => undefined);
    return () => { alive = false; };
  }, [canSave, draftOwner, rect.w, rect.h]);

  const save = async (): Promise<boolean> => {
    if (!canSave || !editor.current || !has) return false;
    setSaveState("saving");
    const v = version.current, key = fieldsKey;
    try {
      const draft: Draft = { v: 1, savedAt: Date.now(), rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, fields: { title, description, link, commercial, archive, days }, editor: await editor.current.snapshot() };
      await draftStore.save(draftOwner!, draft);
      setSaved(draft); setCleanEdits(v); setCleanKey(key); setSaveState("saved");
      return true;
    } catch { setSaveState("error"); return false; }
  };
  const resume = async () => {
    const d = pending;
    if (!d || !editor.current) return;
    if (has && !confirm(t("discardConfirm"))) return;
    try {
      baselineNext.current = true;
      await editor.current.restore(d.editor);
      const restoredDays = (CAMPAIGN_DAYS as readonly number[]).includes(d.fields.days) ? (d.fields.days as CampaignDays) : days;
      setTitle(d.fields.title); setDescription(d.fields.description); setLink(d.fields.link); setCommercial(d.fields.commercial); setArchive(d.fields.archive); setDays(restoredDays);
      setPending(null); setSaved(d); setSaveState("saved"); setStep("design");
      setCleanKey(keyOf({ ...d.fields, days: restoredDays })); // (the drawing's own baseline is taken when the editor reports the change: see `onEdit`)
    } catch { // a project that cannot be opened is no use: it is deleted
      baselineNext.current = false;
      await draftStore.remove(draftOwner!).catch(() => undefined);
      setPending(null); setSaveState("idle"); setError(t("draft.corrupt"));
    }
  };
  const discardSaved = async () => { await draftStore.remove(draftOwner!).catch(() => undefined); setPending(null); setSaved(null); setSaveState("idle"); };
  /** The project went where it was going (sent, or placed): nothing left to resume. */
  const forget = async () => { if (canSave) await draftStore.remove(draftOwner!).catch(() => undefined); };

  /** The × button and the Escape key: with something not saved yet, the visitor is asked (and can save it for 24 hours). */
  const requestClose = () => {
    if (sent) { onSent?.(); return; }
    if (!has) { onClose(); return; }
    if (canSave) { if (dirty) setClosing(true); else onClose(); return; }
    if (confirm(t("discardConfirm"))) onClose();
  };

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
      if (free) fd.delete("currency"); // a free imprint is placed on land or on the sea (`kind` is sent), and nothing is paid
      const r = await fetch(free ? "/api/free-parcel" : collective ? "/api/campaigns" : "/api/checkout", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (collective && r.ok && j.code) { await forget(); setSent({ days }); setBusy(false); return; } // sent to moderation: nothing to pay
      if (free && r.ok && j.code) { await forget(); window.location.assign(`${locale === "en" ? "" : `/${locale}`}/archive/${j.code}`); return; } // placed: its own archive page
      if (!collective && !free && r.ok && j.url) { window.location.assign(j.url); return; }
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
      <dialog ref={dlg} onCancel={(e) => { e.preventDefault(); requestClose(); }} aria-labelledby="co-title"
        className="m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto bg-paper p-0 text-ink backdrop:bg-ink/50 md:m-auto md:h-auto md:max-h-[94dvh] md:w-[min(64rem,96vw)] md:rounded-[var(--radius-card)] md:shadow-[var(--shadow-float)]">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-paper/95 px-5 py-3 backdrop-blur">
          <div>
            <h2 id="co-title" className="text-lg font-extrabold">{sent ? t("collective.sentTitle") : collective ? (step === "design" ? t("collective.designTitle") : t("collective.reviewTitle")) : free ? (step === "design" ? t("free.designTitle") : t("free.reviewTitle")) : step === "design" ? t("designTitle") : t("reviewTitle")}</h2>
            <p className="pixel-num text-xs text-ink-soft">{rect.w}×{rect.h} · {f.number(q.area)} px · {free ? t("free.price") : <>{collective && `${t("collective.goal")} `}{formatMoney(q.totalCents, locale, pricing.currency)}</>}</p>
          </div>
          <div className="flex items-center gap-2">
            <ol className="hidden items-center gap-1 text-xs font-semibold text-ink-faint sm:flex" aria-label={t("steps")}>
              <li className={step === "design" ? "text-ink" : ""}>1 · {t("stepDesign")}</li><li aria-hidden>→</li><li className={step === "review" ? "text-ink" : ""}>2 · {collective ? t("collective.stepSend") : t("stepPay")}</li>
            </ol>
            {canSave && !sent && (
              <button className="btn btn-ghost btn-sm" onClick={() => void save()} disabled={!has || saveState === "saving"} title={t("draft.hint")} data-testid="draft-save">
                {saveState === "saving" ? t("draft.saving") : saveState === "saved" && !dirty ? `✓ ${t("draft.saved")}` : t("draft.save")}
              </button>
            )}
            <button className="btn btn-ghost btn-icon btn-sm text-lg" aria-label={t("close")} onClick={requestClose}>×</button>
          </div>
        </div>

        {closing && (
          <div role="alertdialog" aria-labelledby="co-close-title" className="mx-5 mt-4 rounded-xl border border-line bg-paper-2 p-4" data-testid="co-close-prompt">
            <p id="co-close-title" className="font-extrabold">{t("draft.closeTitle")}</p>
            <p className="mt-1 text-sm text-ink-soft">{t("draft.closeText")} {t("draft.hint")}</p>
            {saveState === "error" && <p role="alert" className="mt-2 text-sm font-semibold text-danger">{t("draft.error")}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn btn-primary btn-sm" onClick={async () => { if (await save()) onClose(); }} data-testid="co-close-save">{t("draft.closeSave")}</button>
              <button className="btn btn-ghost btn-sm" onClick={onClose} data-testid="co-close-discard">{t("draft.closeDiscard")}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setClosing(false)} data-testid="co-close-keep">{t("draft.closeKeep")}</button>
            </div>
          </div>
        )}

        <div className="p-5">
          {pending && !sent && (
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-paper-2 px-3 py-2.5" role="region" aria-label={t("draft.bannerTitle")} data-testid="co-draft-banner">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-extrabold">{t("draft.bannerTitle")}</p>
                <p className="text-xs text-ink-soft">{t("draft.bannerText", { size: `${pending.rect.w}×${pending.rect.h}`, saved: when(pending.savedAt), until: when(expiresAt(pending)) })}</p>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => void resume()} data-testid="co-draft-resume">{t("draft.resume")}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => void discardSaved()} data-testid="co-draft-discard">{t("draft.discard")}</button>
            </div>
          )}
          {saveState === "saved" && !dirty && saved && !sent && <p role="status" className="mb-3 text-xs font-semibold text-(--color-mint-ink)" data-testid="draft-status">✓ {t("draft.saved")} · {t("draft.savedNote", { until: when(expiresAt(saved)) })}</p>}
          {saveState === "error" && !closing && <p role="alert" className="mb-3 text-xs font-semibold text-danger" data-testid="draft-error">{t("draft.error")}</p>}
          <div hidden={step !== "design"}>
            {collective && <p className="mb-3 rounded-xl bg-paper-2 px-3 py-2 text-sm text-ink-soft" data-testid="co-collective-note">{t("collective.designNote", { goal: formatMoney(q.totalCents, locale, pricing.currency) })}</p>}
            {free && <p className="mb-3 rounded-xl bg-paper-2 px-3 py-2 text-sm text-ink-soft" data-testid="co-free-note">{t("free.designNote")}</p>}
            {water && <p className="mb-3 rounded-xl bg-sky px-3 py-2 text-sm font-semibold text-cobalt" data-testid="co-water-note">{t("kind.waterHint")}</p>}
            <ParcelEditor ref={editor} w={rect.w} h={rect.h} onChange={onChange} onEdit={onEdit} />
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
                <div><label className="label" htmlFor="co-desc">{t("fields.description")}</label><textarea id="co-desc" className="field !min-h-20" required minLength={DESCRIPTION_MIN} maxLength={DESCRIPTION_MAX} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} data-testid="co-description" /><p className="mt-1 text-xs text-ink-faint">{t("fields.descriptionHint", { min: DESCRIPTION_MIN })}</p></div>
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
                    {q.cutPixels > 0 && !water && !free && (
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
                    <div className="flex justify-between border-t border-line pt-2"><dt className="font-semibold">{collective ? t("collective.goalLabel") : free ? t("free.priceLabel") : t("summary.total")}</dt><dd className="pixel-display text-4xl text-signal" data-testid="co-total">{free ? t("free.price") : formatMoney(q.totalCents, locale, pricing.currency)}</dd></div>
                  </dl>
                  <p className="mt-1 text-xs text-ink-faint">{collective ? t("collective.goalNote") : free ? t("free.coverNote") : t("taxNote")}</p>
                </div>
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} data-testid="co-accept" />
                  <span>{t.rich(collective ? "collective.accept" : free ? "free.accept" : "accept", { terms: (c) => <Link href="/terms" target="_blank" className="underline">{c}</Link>, rules: (c) => <Link href="/rules" target="_blank" className="underline">{c}</Link> })}</span></label>
                {error && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm font-semibold text-danger" data-testid="co-error">{error}</p>}
                <button className="btn btn-primary w-full" type="submit" disabled={busy || !accepted || !isValidTitle(title) || !isValidDescription(description) || !archive.category} data-testid="co-pay">{collective ? (busy ? t("collective.sending") : t("collective.send")) : free ? (busy ? t("free.placing") : t("free.place")) : busy ? t("redirecting") : t("pay", { price: formatMoney(q.totalCents, locale, pricing.currency) })}</button>
                <p className="text-center text-xs text-ink-faint">{collective ? t("collective.nothingPaid") : free ? t("free.nothingPaid") : t("securePayment")}</p>
              </form>
            </div>
          )}
        </div>
      </dialog>

      {previewing && (
        <div className="pointer-events-auto fixed inset-x-3 bottom-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-full bg-ink px-4 py-2.5 text-paper shadow-float md:bottom-6">
          <span className="text-sm font-semibold">{t("previewing")}</span>
          <button className="btn btn-primary btn-sm" onClick={backFromPreview}>{t("backToEditor")}</button>
        </div>
      )}
    </>
  );
}
