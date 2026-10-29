"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatMoney } from "@/lib/grid/pricing";

export function SettingsForm({ values, locale, canEdit }: { values: { price_unit_cents: number; min_area: number; max_area: number; reservation_ttl_minutes: number; max_active_reservations_per_user: number; sales_open: boolean }; locale: string; canEdit: boolean }) {
  const t = useTranslations("admin.settings");
  const router = useRouter();
  const [v, setV] = useState(values);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    for (const key of Object.keys(v) as (keyof typeof v)[]) {
      if (v[key] === values[key]) continue;
      const r = await fetch("/api/admin/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "set_setting", key, value: v[key] }) });
      if (!r.ok) { setMsg({ ok: false, text: `${key}: ${(await r.json().catch(() => ({}))).error ?? "error"}` }); setBusy(false); return; }
    }
    setBusy(false); setMsg({ ok: true, text: t("saved") }); router.refresh();
  };
  const num = (key: Exclude<keyof typeof v, "sales_open">, label: string, hint?: string) => (
    <div><label className="label" htmlFor={`s-${key}`}>{label}</label><input id={`s-${key}`} className="field pixel-num" inputMode="numeric" disabled={!canEdit} value={v[key]} onChange={(e) => setV({ ...v, [key]: Number(e.target.value.replace(/\D/g, "")) })} />{hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}</div>
  );
  return (
    <form onSubmit={save} className="card max-w-xl space-y-4 p-6">
      {num("price_unit_cents", t("price"), t("priceHint", { price: formatMoney(v.price_unit_cents, locale) }))}
      {num("min_area", t("minArea"))}
      {num("max_area", t("maxArea"))}
      {num("reservation_ttl_minutes", t("ttl"), t("ttlHint"))}
      {num("max_active_reservations_per_user", t("maxHolds"))}
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" disabled={!canEdit} checked={v.sales_open} onChange={(e) => setV({ ...v, sales_open: e.target.checked })} />{t("salesOpen")}</label>
      {msg && <p role="status" className={`text-sm font-semibold ${msg.ok ? "text-mint" : "text-danger"}`}>{msg.text}</p>}
      {canEdit ? <button className="btn btn-ink" disabled={busy}>{t("save")}</button> : <p className="text-sm text-ink-soft">{t("adminOnly")}</p>}
    </form>
  );
}
