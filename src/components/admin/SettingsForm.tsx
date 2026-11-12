"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatMoney } from "@/lib/grid/pricing";

export function SettingsForm({ values, locale, canEdit }: { values: { price_unit_cents: number; price_unit_cents_usd: number; min_area: number; max_area: number; reservation_ttl_minutes: number; max_active_reservations_per_user: number; sales_open: boolean; sea_price_percent: number; min_land_percent: number; water_price_percent: number; min_water_percent: number; land_cut_price_percent: number; campaign_min_area: number; campaign_min_contribution_cents: number; free_parcels_open: boolean; free_parcels_days: number; free_parcels_cap: number; free_max_area: number; free_lifetime_max: number }; locale: string; canEdit: boolean }) {
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
  const num = (key: Exclude<keyof typeof v, "sales_open" | "free_parcels_open">, label: string, hint?: string) => (
    <div><label className="label" htmlFor={`s-${key}`}>{label}</label><input id={`s-${key}`} className="field pixel-num" inputMode="numeric" disabled={!canEdit} value={v[key]} onChange={(e) => setV({ ...v, [key]: Number(e.target.value.replace(/\D/g, "")) })} />{hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}</div>
  );
  return (
    <form onSubmit={save} className="card max-w-xl space-y-4 p-6">
      {num("price_unit_cents", t("price"), t("priceHint", { price: formatMoney(v.price_unit_cents, locale, "eur") }))}
      {num("price_unit_cents_usd", t("priceUsd"), t("priceUsdHint", { price: formatMoney(v.price_unit_cents_usd, locale, "usd") }))}
      {num("min_area", t("minArea"))}
      {num("min_land_percent", t("minLand"), t("minLandHint"))}
      {num("sea_price_percent", t("seaPrice"), t("seaPriceHint"))}
      {num("water_price_percent", t("waterPrice"), t("waterPriceHint"))}
      {num("min_water_percent", t("minWater"), t("minWaterHint"))}
      {num("land_cut_price_percent", t("landCut"), t("landCutHint"))}
      {num("max_area", t("maxArea"))}
      {num("campaign_min_area", t("campaignMinArea"), t("campaignMinAreaHint"))}
      {num("campaign_min_contribution_cents", t("campaignMinContribution"), t("campaignMinContributionHint", { price: formatMoney(v.campaign_min_contribution_cents, locale, "eur") }))}
      {num("reservation_ttl_minutes", t("ttl"), t("ttlHint"))}
      {num("max_active_reservations_per_user", t("maxHolds"))}
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" disabled={!canEdit} checked={v.sales_open} onChange={(e) => setV({ ...v, sales_open: e.target.checked })} />{t("salesOpen")}</label>
      <fieldset className="space-y-4 rounded-2xl bg-paper-2 p-4" data-testid="settings-free">
        <legend className="label">{t("freeTitle")}</legend>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" data-testid="s-free-open" disabled={!canEdit} checked={v.free_parcels_open} onChange={(e) => setV({ ...v, free_parcels_open: e.target.checked })} />{t("freeOpen")}</label>
        {num("free_parcels_days", t("freeDays"), t("freeDaysHint"))}
        {num("free_parcels_cap", t("freeCap"), t("freeCapHint"))}
        {num("free_max_area", t("freeMaxArea"), t("freeMaxAreaHint"))}
        {num("free_lifetime_max", t("freeLifetime"), t("freeLifetimeHint"))}
      </fieldset>
      {msg && <p role="status" className={`text-sm font-semibold ${msg.ok ? "text-mint" : "text-danger"}`}>{msg.text}</p>}
      {canEdit ? <button className="btn btn-ink" disabled={busy}>{t("save")}</button> : <p className="text-sm text-ink-soft">{t("adminOnly")}</p>}
    </form>
  );
}
