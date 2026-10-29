import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PAGE_SIZE, reservationsList } from "@/lib/data/admin";
import { formatMoney } from "@/lib/grid/pricing";

const STATUSES = ["held", "converted", "expired", "canceled", "all"];

export default async function Reservations({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ status?: string; page?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status ?? "") ? sp.status! : "held", page = Math.max(0, Number(sp.page ?? 0) || 0);
  const [t, tc, f, rows] = await Promise.all([getTranslations("admin.reservations"), getTranslations("common"), getFormatter(), reservationsList(status, page * PAGE_SIZE)]);
  return (
    <div>
      <h1 className="text-3xl font-extrabold">{t("title")}</h1>
      <p className="mt-1 text-sm text-ink-soft">{t("lead")}</p>
      <nav className="mt-4 flex flex-wrap gap-1.5" aria-label={t("filter")}>{STATUSES.map((s) => <Link key={s} href={`/admin/reservations?status=${s}`} className={`btn btn-sm ${s === status ? "btn-ink" : "btn-ghost"}`}>{s}</Link>)}</nav>
      <div className="card mt-6 overflow-x-auto">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-faint"><tr><th className="p-3">{t("user")}</th><th className="p-3">{t("parcel")}</th><th className="p-3">{t("amount")}</th><th className="p-3">{t("created")}</th><th className="p-3">{t("expires")}</th><th className="p-3">{t("status")}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0" data-testid="reservation-row">
                <td className="p-3">{r.username}</td>
                <td className="p-3 pixel-num">{r.w}×{r.h} @{r.x},{r.y}</td>
                <td className="p-3 pixel-num">{r.amount_cents ? formatMoney(r.amount_cents, locale, r.currency ?? "eur") : "—"}</td>
                <td className="p-3 whitespace-nowrap">{f.dateTime(r.created_at, { dateStyle: "short", timeStyle: "short" })}</td>
                <td className="p-3 whitespace-nowrap">{f.dateTime(r.expires_at, { dateStyle: "short", timeStyle: "short" })}{r.status === "held" && r.expired ? <span className="chip ml-2 !bg-warn/15 !text-warn">{t("lapsed")}</span> : null}</td>
                <td className="p-3"><span className="chip">{r.status}</span>{r.order_status ? <span className="chip ml-1">{r.order_status}</span> : null}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="p-6 text-center text-ink-soft" colSpan={6}>{t("empty")}</td></tr>}
          </tbody>
        </table>
      </div>
      <nav className="mt-4 flex gap-2" aria-label={tc("pagination")}>
        {page > 0 && <Link className="btn btn-ghost btn-sm" href={`/admin/reservations?status=${status}&page=${page - 1}`}>←</Link>}
        {rows.length === PAGE_SIZE && <Link className="btn btn-ghost btn-sm" href={`/admin/reservations?status=${status}&page=${page + 1}`}>→</Link>}
      </nav>
    </div>
  );
}
