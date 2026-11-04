"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

/** The creator withdraws their project (waiting for moderation, or open): an open one gives its zone back at once. */
export function CancelCampaignButton({ id }: { id: string }) {
  const t = useTranslations("account.campaigns");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    if (!window.confirm(t("withdrawConfirm"))) return;
    setBusy(true); setErr(null);
    const r = await fetch(`/api/campaigns/${id}/cancel`, { method: "POST" });
    setBusy(false);
    if (r.ok) router.refresh();
    else setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "error");
  };
  return (
    <span className="inline-flex items-center gap-2">
      <button className="btn btn-ghost btn-sm !text-danger" onClick={run} disabled={busy} data-testid="campaign-withdraw">{t("withdraw")}</button>
      {err && <span role="alert" className="text-xs font-semibold text-danger">{err}</span>}
    </span>
  );
}
