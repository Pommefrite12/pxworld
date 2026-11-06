"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { EditionInfo } from "@/lib/edition";

type Action = { action: string } & Record<string, unknown>;

/**
 * The 100 days. Every button here calls a function of the database that checks the role again, asks for the name of the edition when the
 * move is serious, and writes to the audit log. The state shown is the database's own (computed from its clock), never the browser's.
 */
export function EditionPanel({ info, text, canEdit }: {
  info: EditionInfo;
  text: { opensAt: string | null; closesAt: string | null; settlesAt: string | null; closedAt: string | null; snapshotAt: string | null };
  canEdit: boolean;
}) {
  const t = useTranslations("admin.edition");
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState("");
  const [note, setNote] = useState("");
  const [days, setDays] = useState(7);

  const run = async (key: string, payload: Action) => {
    setBusy(key); setMsg(null);
    const r = await fetch("/api/admin/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    setBusy(null);
    if (r.ok) { setConfirm(""); setNote(""); setMsg({ ok: true, text: t("done") }); router.refresh(); return; }
    const code = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? "error";
    setMsg({ ok: false, text: t.has(`errors.${code}`) ? t(`errors.${code}`) : `${t("errors.generic")} (${code})` });
  };

  const settling = info.state === "closed" && info.status === "open"; // the sales are over, the payments under way are still settling
  const label = info.status === "closed" ? "closed" : settling ? "settling" : info.state;
  const typed = (
    <div>
      <label className="label" htmlFor="ed-confirm">{t("confirmLabel", { name: info.name })}</label>
      <input id="ed-confirm" className="field" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={info.name} data-testid="edition-confirm" />
    </div>
  );
  const ok = confirm.trim().toLowerCase() === info.name.toLowerCase();
  const tone = { prelaunch: "bg-paper-2", open: "bg-mint/15", settling: "bg-signal/10", closed: "bg-sky" }[label];

  return (
    <div className="max-w-2xl space-y-5">
      <section className={`card space-y-3 p-6 ${tone}`} aria-label={t("current")} data-testid="edition-state" data-state={label}>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{info.name}</p>
        <p className="font-display text-2xl font-extrabold">{t(`state.${label}`)}</p>
        <p className="text-sm text-ink-soft">{t(`explain.${label}`)}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-soft">{t("opens")}</dt><dd className="font-semibold">{text.opensAt ?? t("none")}</dd>
          <dt className="text-ink-soft">{t("closes")}</dt><dd className="font-semibold" data-testid="edition-closes">{text.closesAt ?? t("none")}</dd>
          {info.state !== "prelaunch" && <><dt className="text-ink-soft">{t("settles")}</dt><dd className="font-semibold">{text.settlesAt}{info.frozen ? ` — ${t("frozen")}` : ""}</dd></>}
          {info.status === "closed" && <><dt className="text-ink-soft">{t("closedAt")}</dt><dd className="font-semibold">{text.closedAt}</dd></>}
          <dt className="text-ink-soft">{t("duration")}</dt><dd className="font-semibold">{t("days", { n: info.durationDays })}</dd>
        </dl>
        {info.snapshot && (
          <p className="rounded-lg bg-white/70 p-3 text-sm" data-testid="edition-snapshot">
            <span className="font-semibold">{t("snapshot", { rev: info.snapshot.revision, n: info.snapshot.parcelCount })}</span> · {text.snapshotAt}<br />
            <code className="break-all text-xs text-ink-soft">sha256 {info.snapshot.hash}</code>
          </p>
        )}
      </section>

      {msg && <p role="status" className={`text-sm font-semibold ${msg.ok ? "text-mint" : "text-danger"}`}>{msg.text}</p>}
      {!canEdit && <p className="text-sm text-ink-soft">{t("adminOnly")}</p>}

      {canEdit && info.status === "prelaunch" && (
        <section className="card space-y-3 p-6" aria-label={t("open.title")}>
          <h2 className="text-lg font-extrabold">{t("open.title")}</h2>
          <p className="text-sm text-ink-soft">{t("open.help", { n: info.durationDays })}</p>
          {typed}
          <button className="btn btn-primary" disabled={!ok || busy !== null} onClick={() => run("open", { action: "edition_open", confirm })} data-testid="edition-open">{busy === "open" ? t("working") : t("open.button")}</button>
        </section>
      )}

      {canEdit && info.state === "open" && (
        <>
          <section className="card space-y-3 p-6" aria-label={t("extend.title")}>
            <h2 className="text-lg font-extrabold">{t("extend.title")}</h2>
            <p className="text-sm text-ink-soft">{t("extend.help")}</p>
            <div className="flex flex-wrap items-end gap-3">
              <div><label className="label" htmlFor="ed-days">{t("extend.days")}</label><input id="ed-days" className="field pixel-num !w-28" inputMode="numeric" value={days} onChange={(e) => setDays(Math.max(1, Math.min(366, Number(e.target.value.replace(/\D/g, "")) || 1)))} /></div>
              <div className="min-w-[14rem] flex-1"><label className="label" htmlFor="ed-note">{t("extend.note")}</label><input id="ed-note" className="field" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></div>
              <button className="btn btn-ink" disabled={busy !== null || !info.closesAt} data-testid="edition-extend"
                onClick={() => run("extend", { action: "edition_extend", closesAt: new Date(Date.parse(info.closesAt!) + days * 86_400_000).toISOString(), note: note || undefined })}>{busy === "extend" ? t("working") : t("extend.button", { n: days })}</button>
            </div>
          </section>
          <section className="card space-y-3 p-6" aria-label={t("close.title")}>
            <h2 className="text-lg font-extrabold">{t("close.title")}</h2>
            <p className="text-sm text-ink-soft">{t("close.help")}</p>
            {typed}
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-ghost !text-danger" disabled={!ok || busy !== null} onClick={() => run("close", { action: "edition_close_now", confirm })} data-testid="edition-close">{busy === "close" ? t("working") : t("close.button")}</button>
              <button className="btn btn-ghost" disabled={!ok || busy !== null} onClick={() => run("reset", { action: "edition_reset", confirm })} data-testid="edition-reset">{busy === "reset" ? t("working") : t("reset.button")}</button>
            </div>
            <p className="text-xs text-ink-faint">{t("reset.help")}</p>
          </section>
        </>
      )}

      {canEdit && info.status === "closed" && (
        <section className="card space-y-3 p-6" aria-label={t("snap.title")}>
          <h2 className="text-lg font-extrabold">{t("snap.title")}</h2>
          <p className="text-sm text-ink-soft">{t("snap.help")}</p>
          <button className="btn btn-ink" disabled={busy !== null} onClick={() => run("snap", { action: "edition_snapshot" })} data-testid="edition-snap">{busy === "snap" ? t("working") : t("snap.button")}</button>
        </section>
      )}

      {settling && <button className="btn btn-ghost btn-sm" onClick={() => router.refresh()}>{t("refresh")}</button>}
    </div>
  );
}
