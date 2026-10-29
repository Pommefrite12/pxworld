import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/layout/PageShell";
import { Link } from "@/i18n/navigation";
import { requirePageViewer } from "@/lib/auth/guards";
import { getOrdersOf } from "@/lib/data/parcels";
import { formatMoney } from "@/lib/grid/pricing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false } };

export default async function Orders({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const v = await requirePageViewer(locale, "/account/orders");
  const [t, f, orders] = await Promise.all([getTranslations("account.orders"), getFormatter(), getOrdersOf(v.user.id)]);
  return (
    <PageShell>
      <h1 className="text-3xl font-extrabold">{t("title")}</h1>
      <p className="mt-1 text-ink-soft">{t("lead")}</p>
      {orders.length === 0 ? <p className="card mt-8 p-8 text-center text-ink-soft">{t("empty")}</p> : (
        <div className="card mt-8 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
              <tr><th className="p-4">{t("date")}</th><th className="p-4">{t("parcel")}</th><th className="p-4">{t("amount")}</th><th className="p-4">{t("status")}</th><th className="p-4"><span className="sr-only">{t("actions")}</span></th></tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-line last:border-0" data-testid="order-row">
                  <td className="p-4 whitespace-nowrap">{f.dateTime(o.created_at, { dateStyle: "medium", timeStyle: "short" })}</td>
                  <td className="p-4 pixel-num">{o.w}×{o.h} · {f.number(o.area)} px<br /><span className="text-xs text-ink-faint">#{o.id.slice(0, 8)}</span></td>
                  <td className="p-4 pixel-num">{formatMoney(o.amount_total_cents ?? o.amount_cents, locale, o.currency)}{o.amount_tax_cents ? <span className="block text-xs text-ink-faint">{t("incTax", { tax: formatMoney(o.amount_tax_cents, locale, o.currency) })}</span> : null}</td>
                  <td className="p-4"><span className="chip" data-testid="order-status">{t(`statuses.${o.status}`)}</span></td>
                  <td className="p-4 text-right">{o.status === "paid" && <Link className="font-semibold text-cobalt underline" href={`/p/${o.parcel_code}`}>{t("viewParcel")}</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
