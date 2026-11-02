"use client";

import { useEffect, useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { hostOf } from "@/lib/security/url";

/** Integer upscale (crisp pixels) up to `box` px; downscale smoothly beyond. */
export function fitSize(w: number, h: number, box: number) {
  const k = Math.floor(box / Math.max(w, h));
  return k >= 1 ? { width: w * k, height: h * k } : { width: Math.round((w * box) / Math.max(w, h)), height: Math.round((h * box) / Math.max(w, h)) };
}

export interface ParcelInfo {
  code: string; x: number; y: number; w: number; h: number; area: number; hidden: boolean; likes: number; activatedAt: string | null;
  owner: { username: string; country: string | null; avatarId: string | null };
  creation: null | { assetId: string; title: string | null; description: string | null; link: string | null; commercial: boolean; publishedAt: string | null; color: string };
}

/** Small public "card" of a parcel: shown on the map and reused by the permalink page. */
export function ParcelCard(props: { code: string; onClose: () => void; signedIn: boolean; className?: string }) {
  // keyed by code: switching parcels remounts the card, so its state never leaks from one parcel to the next
  return <ParcelCardInner key={props.code} {...props} />;
}

function ParcelCardInner({ code, onClose, signedIn, className = "" }: { code: string; onClose: () => void; signedIn: boolean; className?: string }) {
  const t = useTranslations("parcel");
  const f = useFormatter();
  const locale = useLocale();
  const [info, setInfo] = useState<ParcelInfo | null | "error">(null);
  const [likes, setLikes] = useState(0);
  const [liked, setLiked] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/parcels/${code}`).then((r) => (r.ok ? r.json() : Promise.reject())).then((p: ParcelInfo) => { if (alive) { setInfo(p); setLikes(p.likes); } }).catch(() => alive && setInfo("error"));
    return () => { alive = false; };
  }, [code]);

  const url = typeof window === "undefined" ? "" : `${window.location.origin}${locale === "en" ? "" : `/${locale}`}/p/${code}`;
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: typeof info === "object" && info?.creation?.title || "Pixel World", url });
      else { await navigator.clipboard.writeText(url); setMsg(t("copied")); }
    } catch { /* cancelled */ }
  };
  const like = async () => {
    if (!signedIn) { window.location.href = `/auth/sign-in?next=${encodeURIComponent(`/p/${code}`)}`; return; }
    const r = await fetch("/api/likes", { method: liked ? "DELETE" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
    if (r.ok) { const j = await r.json(); setLiked(j.liked); setLikes(j.likes); }
  };
  const report = async (reason: string) => {
    const r = await fetch("/api/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, reason }) });
    setReporting(false);
    setMsg(r.ok ? t("reported") : r.status === 401 ? t("signInToReport") : t("reportFailed"));
  };

  return (
    <article className={`card pointer-events-auto relative w-full max-w-sm overflow-hidden ${className}`} aria-label={t("label")}>
      <button onClick={onClose} className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-lg shadow-float" aria-label={t("close")}>×</button>
      {info === null && <div className="p-6 text-sm text-ink-soft" aria-busy>…</div>}
      {info === "error" && <div className="p-6 text-sm text-ink-soft">{t("notFound")}</div>}
      {info && info !== "error" && (
        <>
          <div className="checker grid place-items-center border-b border-line p-3" style={{ minHeight: 120 }}>
            {info.creation ? (
              <img src={`/api/assets/${info.creation.assetId}`} alt={info.creation.title ?? t("untitled")}
                className="pixelated max-w-full" style={{ imageRendering: "pixelated", ...fitSize(info.w, info.h, 208) }} loading="lazy" />
            ) : (
              <p className="px-4 py-6 text-center text-sm text-ink-soft">{info.hidden ? t("hidden") : t("pending")}</p>
            )}
          </div>
          <div className="space-y-2 p-4">
            <h2 className="pr-8 text-lg font-bold leading-tight">{info.creation?.title ?? t("untitled")}</h2>
            {info.creation?.commercial && <span className="chip !bg-warn/15 !text-warn">{t("ad")}</span>}
            <p className="text-sm text-ink-soft">
              <Link href={`/u/${info.owner.username}`} className="font-semibold text-ink underline-offset-2 hover:underline">{info.owner.username}</Link>
              {info.owner.country && <span> · {new Intl.DisplayNames([locale], { type: "region" }).of(info.owner.country)}</span>}
            </p>
            {info.creation?.description && <p className="text-sm">{info.creation.description}</p>}
            {info.creation?.link && (
              <a href={info.creation.link} target="_blank" rel={`noopener noreferrer nofollow ugc${info.creation.commercial ? " sponsored" : ""}`} className="inline-block break-all text-sm font-semibold text-cobalt underline underline-offset-2">
                {hostOf(info.creation.link)} ↗
              </a>
            )}
            <dl className="grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs text-ink-soft">
              <div><dt>{t("size")}</dt><dd className="pixel-num text-sm text-ink">{info.w}×{info.h}</dd></div>
              <div><dt>{t("area")}</dt><dd className="pixel-num text-sm text-ink">{f.number(info.area)} px</dd></div>
              <div><dt>{t("published")}</dt><dd className="text-sm text-ink">{info.creation?.publishedAt ? f.dateTime(new Date(info.creation.publishedAt), { dateStyle: "medium" }) : "—"}</dd></div>
            </dl>
            <div className="flex flex-wrap gap-2 pt-1">
              <button className="btn btn-ink btn-sm" onClick={share}>{t("share")}</button>
              <button className="btn btn-ghost btn-sm" onClick={like} aria-pressed={liked}>{liked ? "♥" : "♡"} {likes}</button>
              <Link className="btn btn-ghost btn-sm" href={`/p/${code}`}>{t("openPage")}</Link>
              <button className="btn btn-ghost btn-sm" onClick={() => setReporting((v) => !v)} aria-expanded={reporting}>{t("report")}</button>
            </div>
            {reporting && (
              <div role="group" aria-label={t("reportReason")} className="grid gap-1 rounded-xl bg-paper-2 p-2 text-sm">
                {["copyright", "hate", "sexual", "scam", "illegal_ad", "violence", "other"].map((r) => (
                  <button key={r} className="rounded-lg px-2 py-1.5 text-left hover:bg-white" onClick={() => void report(r)}>{t(`reasons.${r}`)}</button>
                ))}
              </div>
            )}
            {msg && <p role="status" className="text-xs font-semibold text-mint">{msg}</p>}
          </div>
        </>
      )}
    </article>
  );
}
