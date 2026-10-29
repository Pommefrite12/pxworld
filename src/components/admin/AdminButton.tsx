"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

type Payload = Record<string, unknown> & { action: string };

/** A back-office action button. Optionally asks for a reason (always for destructive actions). */
export function AdminButton({ payload, label, tone = "ghost", askReason = false, confirm, testId }: {
  payload: Payload; label: string; tone?: "ghost" | "ink" | "danger" | "primary"; askReason?: boolean; confirm?: string; testId?: string;
}) {
  const t = useTranslations("admin.common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cls = { ghost: "btn-ghost", ink: "btn-ink", primary: "btn-primary", danger: "btn-ghost !text-danger" }[tone];

  const run = async () => {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true); setErr(null);
    const r = await fetch("/api/admin/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, ...(askReason ? { reason: reason || undefined, note: reason || undefined } : {}) }) });
    setBusy(false);
    if (r.ok) { setOpen(false); setReason(""); router.refresh(); }
    else setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "error");
  };

  if (askReason && !open) return <button className={`btn btn-sm ${cls}`} onClick={() => setOpen(true)} data-testid={testId}>{label}</button>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {askReason && <input autoFocus className="field !min-h-9 !w-48 !py-1 text-sm" placeholder={t("reason")} aria-label={t("reason")} value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void run()} />}
      <button className={`btn btn-sm ${cls}`} disabled={busy} onClick={run} data-testid={testId}>{label}</button>
      {askReason && <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>{t("cancel")}</button>}
      {err && <span role="alert" className="text-xs font-semibold text-danger">{err}</span>}
    </span>
  );
}
