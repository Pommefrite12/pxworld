import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { dashboard } from "@/lib/data/admin";
import { TOTAL_PIXELS } from "@/lib/grid/constants";
import { formatMoney } from "@/lib/grid/pricing";

function Tile({ label, value, href, alert }: { label: string; value: string; href?: string; alert?: boolean }) {
  const body = <div className={`card p-4 ${alert ? "ring-2 ring-signal" : ""}`}><p className="text-xs text-ink-faint">{label}</p><p className="pixel-display mt-1 text-4xl">{value}</p></div>;
  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function AdminHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, f, d] = await Promise.all([getTranslations("admin.dashboard"), getFormatter(), dashboard()]);
  const max = Math.max(1, ...d.daily.map((x) => x.pixels));
  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-extrabold">{t("title")}</h1>
      <section aria-label={t("queues")} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={t("toModerate")} value={f.number(d.queues?.pending_assets ?? 0)} href="/admin/moderation" alert={(d.queues?.pending_assets ?? 0) > 0} />
        <Tile label={t("openReports")} value={f.number(d.queues?.open_reports ?? 0)} href="/admin/reports" alert={(d.queues?.open_reports ?? 0) > 0} />
        <Tile label={t("refundsDue")} value={f.number(d.queues?.refunds ?? 0)} href="/admin/orders" alert={(d.queues?.refunds ?? 0) > 0} />
        <Tile label={t("heldReservations")} value={f.number(d.queues?.held ?? 0)} />
      </section>
      <section aria-label={t("figures")} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={t("pixelsSold")} value={f.number(d.stats?.sold_pixels ?? 0)} />
        <Tile label={t("fill")} value={`${f.number(((d.stats?.sold_pixels ?? 0) / TOTAL_PIXELS) * 100, { maximumFractionDigits: 4 })} %`} />
        <Tile label={t("parcels")} value={f.number(d.stats?.parcels ?? 0)} />
        <Tile label={t("owners")} value={f.number(d.stats?.owners ?? 0)} />
        <Tile label={t("creations")} value={f.number(d.stats?.published_creations ?? 0)} />
        <Tile label={t("users")} value={f.number(d.queues?.users ?? 0)} href="/admin/users" />
        <Tile label={t("suspended")} value={f.number(d.queues?.suspended ?? 0)} />
        <Tile label={t("refunded")} value={formatMoney(d.revenue?.refunded ?? 0, locale)} />
      </section>
      <section aria-label={t("revenue")}>
        <h2 className="text-xl font-bold">{t("revenue")}</h2>
        <p className="text-sm text-ink-soft">{t("revenueHint")}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label={t("revAll")} value={formatMoney(d.revenue?.total ?? 0, locale)} />
          <Tile label={t("rev30")} value={formatMoney(d.revenue?.d30 ?? 0, locale)} />
          <Tile label={t("rev7")} value={formatMoney(d.revenue?.d7 ?? 0, locale)} />
          <Tile label={t("tax")} value={formatMoney(d.revenue?.tax ?? 0, locale)} />
        </div>
      </section>
      <section aria-label={t("daily")}>
        <h2 className="text-xl font-bold">{t("daily")}</h2>
        <div className="card mt-3 flex h-40 items-end gap-1 p-4" role="img" aria-label={t("daily")}>
          {d.daily.map((x) => (
            <div key={x.day} className="group relative flex h-full flex-1 items-end" title={`${x.day}: ${f.number(x.pixels)} px · ${x.orders}`}>
              <div className="w-full rounded-t bg-signal/80" style={{ height: `${Math.max(x.pixels ? 4 : 1, (x.pixels / max) * 100)}%`, minHeight: 2 }} />
            </div>
          ))}
        </div>
      </section>
      <section aria-label={t("ordersByStatus")}>
        <h2 className="text-xl font-bold">{t("ordersByStatus")}</h2>
        <ul className="mt-3 flex flex-wrap gap-2">{d.ordersByStatus.map((o) => <li key={o.status} className="chip">{o.status}: {o.n}</li>)}{d.ordersByStatus.length === 0 && <li className="text-sm text-ink-soft">—</li>}</ul>
      </section>
    </div>
  );
}
