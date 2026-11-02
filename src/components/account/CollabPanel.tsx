"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";

interface State { enabled: boolean; token: string | null; pixels: number }

/** The owner's controls for "draw together": create / copy / renew / stop the link, reset it, publish the result. */
export function CollabPanel({ code, initial }: { code: string; initial: State | null }) {
  const t = useTranslations("collab");
  const f = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const [state, setState] = useState<State>(initial ?? { enabled: false, token: null, pixels: 0 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // "" while rendering on the server (hydration-safe), the real origin in the browser
  const origin = useSyncExternalStore(() => () => undefined, () => window.location.origin, () => "");

  const path = state.token ? `${locale === "en" ? "" : `/${locale}`}/draw/${state.token}` : "";
  const url = `${origin}${path}`;

  const act = async (action: "enable" | "rotate" | "disable" | "reset" | "publish") => {
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/parcels/${code}/collab`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: t.has(`errors.${j.error}`) ? t(`errors.${j.error}`) : t("errors.generic") }); return; }
    if (action === "publish") { setMsg({ ok: true, text: t("published") }); router.refresh(); return; }
    setState({ enabled: j.enabled, token: j.token, pixels: j.pixels });
    router.refresh();
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the field below can be copied by hand */ }
  };

  return (
    <section id="collab" aria-labelledby="collab-title" className="card mt-12 p-6" data-testid="collab-panel">
      <h2 id="collab-title" className="text-xl font-bold">{t("title")}</h2>
      <p className="mt-1 text-sm text-ink-soft">{t("lead")}</p>

      {!state.token && (
        <button className="btn btn-primary mt-4" disabled={busy} onClick={() => act("enable")} data-testid="collab-create">{t("create")}</button>
      )}

      {state.token && !state.enabled && (
        <div className="mt-4 space-y-3">
          <p className="rounded-xl bg-paper-2 px-3 py-2 text-sm" data-testid="collab-off">{t("off")}</p>
          <button className="btn btn-primary" disabled={busy} onClick={() => act("enable")} data-testid="collab-enable">{t("enable")}</button>
        </div>
      )}

      {state.token && state.enabled && (
        <div className="mt-4 space-y-4">
          <div>
            <label className="label" htmlFor="collab-url">{t("link")}</label>
            <div className="flex gap-2">
              <input id="collab-url" className="field pixel-num flex-1" readOnly value={url} onFocus={(e) => e.currentTarget.select()} data-testid="collab-url" />
              <button className="btn btn-ink" onClick={copy} data-testid="collab-copy">{copied ? t("copied") : t("copy")}</button>
            </div>
            <p className="mt-1.5 text-xs text-ink-faint">{t("base")}</p>
            <a href={path || undefined} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm font-semibold text-cobalt underline">{t("open")} ↗</a>
          </div>

          <p className="text-sm" data-testid="collab-pixels">{state.pixels > 0 ? t("painted", { n: f.number(state.pixels) }) : t("empty")}</p>

          <div className="rounded-xl bg-paper-2 p-4">
            <button className="btn btn-primary" disabled={busy || state.pixels === 0} onClick={() => act("publish")} data-testid="collab-publish">{t("publish")}</button>
            <p className="mt-2 text-xs text-ink-soft">{t("publishHint")}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn btn-ghost btn-sm" disabled={busy || state.pixels === 0} data-testid="collab-reset"
              onClick={() => { if (confirm(t("resetConfirm"))) void act("reset"); }}>{t("reset")}</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} title={t("rotateHint")} data-testid="collab-rotate"
              onClick={() => { if (confirm(t("rotateConfirm"))) void act("rotate"); }}>{t("rotate")}</button>
            <button className="btn btn-ghost btn-sm text-danger" disabled={busy} onClick={() => act("disable")} data-testid="collab-disable">{t("disable")}</button>
          </div>
        </div>
      )}
      {msg && <p role="status" className={`mt-3 text-sm font-semibold ${msg.ok ? "text-mint" : "text-danger"}`} data-testid="collab-msg">{msg.text}</p>}
    </section>
  );
}
