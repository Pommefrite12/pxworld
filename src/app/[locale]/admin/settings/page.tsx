import { getTranslations, setRequestLocale } from "next-intl/server";
import { SettingsForm } from "@/components/admin/SettingsForm";
import { settingsList } from "@/lib/data/admin";
import { requirePageStaff } from "@/lib/auth/guards";
import { DEFAULT_UNIT_PRICE_CENTS, MIN_AREA } from "@/lib/grid/constants";

export default async function Settings({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, rows, staff] = await Promise.all([getTranslations("admin.settings"), settingsList(), requirePageStaff(locale)]);
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return (
    <div>
      <h1 className="text-3xl font-extrabold">{t("title")}</h1>
      <p className="mb-6 mt-1 max-w-xl text-ink-soft">{t("lead")}</p>
      <SettingsForm locale={locale} canEdit={staff.staffRole === "admin"} values={{
        price_unit_cents: Number(m.price_unit_cents ?? DEFAULT_UNIT_PRICE_CENTS), price_unit_cents_usd: Number(m.price_unit_cents_usd ?? DEFAULT_UNIT_PRICE_CENTS), min_area: Number(m.min_area ?? MIN_AREA), max_area: Number(m.max_area ?? 250000),
        reservation_ttl_minutes: Number(m.reservation_ttl_minutes ?? 35), max_active_reservations_per_user: Number(m.max_active_reservations_per_user ?? 3), sales_open: m.sales_open !== false,
        sea_price_percent: Number(m.sea_price_percent ?? 0), min_land_percent: Number(m.min_land_percent ?? 50),
      }} />
    </div>
  );
}
