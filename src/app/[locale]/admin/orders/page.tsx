import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { AdminButton } from "@/components/admin/AdminButton";
import { Link } from "@/i18n/navigation";
import { PAGE_SIZE, ordersList } from "@/lib/data/admin";
import { requirePageStaff } from "@/lib/auth/guards";
import { formatMoney } from "@/lib/grid/pricing";

const STATUSES = ["all", "pending", "paid", "refund_required", "refunded", "disputed", "dispute_lost", "expired", "canceled", "failed"];

export default async function AdminOrders({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ status?: string; page?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tc = await getTranslations("common");
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status ?? "") ? sp.status! : "all", page = Math.max(0, Number(sp.page ?? 0) || 0);
  const [t, f, rows, staff] = await Promise.all([getTranslations("admin.orders"), getFormatter(), ordersList(status, page * PAGE_SIZE), requirePageStaff(locale)]);
  return (
    <div>
      <h1 className="text-3xl font-extrabold">{t("title")}</h1>
      <p className="mt-1 text-sm text-ink-soft">{t("lead")}</p>
      <nav className="mt-4 flex flex-wrap gap-1.5" aria-label={t("filter")}>{STATUSES.map((s) => <Link key={s} href={`/admin/orders?status=${s}`} className={`btn btn-sm ${s === status ? "btn-ink" : "btn-ghost"}`}>{s}</Link>)}</nav>
      <div className="card mt-6 overflow-x-auto">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-faint"><tr><th className="p-3">{t("order")}</th><th className="p-3">{t("buyer")}</th><th className="p-3">{t("parcel")}</th><th className="p-3">{t("amount")}</th><th className="p-3">{t("status")}</th><th className="p-3">{t("payment")}</th><th className="p-3">{t("actions")}</th></tr></thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className="border-b border-line last:border-0 align-top" data-testid="admin-order">
                <td className="p-3 font-mono text-xs">{o.id.slice(0, 8)}<br /><span className="font-sans text-ink-faint">{f.dateTime(o.created_at, { dateStyle: "short", timeStyle: "short" })}</span></td>
                <td className="p-3">{o.username}</td>
                <td className="p-3 pixel-num">{o.w}×{o.h}<br /><Link className="text-xs underline" href={`/p/${o.code}`}>{o.code}</Link></td>
                <td className="p-3 pixel-num">{formatMoney(o.amount_cents, locale, o.currency)}{o.amount_tax_cents ? <span className="block text-xs text-ink-faint">+ {formatMoney(o.amount_tax_cents, locale, o.currency)}</span> : null}</td>
                <td className="p-3"><span className={`chip ${o.status === "refund_required" ? "!bg-danger/10 !text-danger" : ""}`}>{o.status}</span></td>
                <td className="p-3 text-xs">{o.payment_status ?? "—"}{o.refunded ? ` · ${formatMoney(o.refunded, locale, o.currency)}` : ""}<br /><span className="font-mono text-ink-faint">{o.stripe_payment_intent_id ?? ""}</span></td>
                <td className="p-3">{staff.staffRole === "admin" && ["paid", "refund_required", "disputed"].includes(o.status) && o.stripe_payment_intent_id && <AdminButton payload={{ action: "refund_order", orderId: o.id }} label={t("refund")} tone="danger" askReason confirm={t("confirmRefund")} />}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="p-6 text-center text-ink-soft" colSpan={7}>{t("empty")}</td></tr>}
          </tbody>
        </table>
      </div>
      <nav className="mt-4 flex gap-2" aria-label={tc("pagination")}>
        {page > 0 && <Link className="btn btn-ghost btn-sm" href={`/admin/orders?status=${status}&page=${page - 1}`}>←</Link>}
        {rows.length === PAGE_SIZE && <Link className="btn btn-ghost btn-sm" href={`/admin/orders?status=${status}&page=${page + 1}`}>→</Link>}
      </nav>
    </div>
  );
}
