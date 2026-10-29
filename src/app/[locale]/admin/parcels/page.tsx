import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { AdminButton } from "@/components/admin/AdminButton";
import { Link } from "@/i18n/navigation";
import { PAGE_SIZE, parcelsList } from "@/lib/data/admin";
import { requirePageStaff } from "@/lib/auth/guards";

export default async function AdminParcels({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string; page?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 60), page = Math.max(0, Number(sp.page ?? 0) || 0);
  const [t, f, rows, staff] = await Promise.all([getTranslations("admin.parcels"), getFormatter(), parcelsList(q, page * PAGE_SIZE), requirePageStaff(locale)]);
  return (
    <div>
      <h1 className="text-3xl font-extrabold">{t("title")}</h1>
      <form className="mt-4 flex gap-2" role="search"><input name="q" defaultValue={q} className="field max-w-sm" placeholder={t("search")} aria-label={t("search")} /><button className="btn btn-ink">{t("searchBtn")}</button></form>
      <div className="card mt-6 overflow-x-auto">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-faint"><tr><th className="p-3">{t("code")}</th><th className="p-3">{t("owner")}</th><th className="p-3">{t("size")}</th><th className="p-3">{t("titleCol")}</th><th className="p-3">{t("status")}</th><th className="p-3">{t("actions")}</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-line last:border-0 align-top" data-testid="parcel-row">
                <td className="p-3"><Link href={`/p/${p.code}`} className="font-mono underline">{p.code}</Link><br /><span className="text-xs text-ink-faint">{f.dateTime(p.created_at, { dateStyle: "short" })}</span></td>
                <td className="p-3">{p.username}</td>
                <td className="p-3 pixel-num">{p.w}×{p.h}<br /><span className="text-xs text-ink-faint">@{p.x},{p.y} · {f.number(p.area)} px</span></td>
                <td className="p-3">{p.title ?? "—"}</td>
                <td className="p-3"><span className="chip">{p.status}</span> {p.hidden && <span className="chip !bg-danger/10 !text-danger">{t("hidden")}</span>} {p.featured && <span className="chip !bg-cobalt/10 !text-cobalt">★</span>}</td>
                <td className="p-3"><div className="flex flex-wrap gap-1.5">
                  {p.status === "active" && <AdminButton payload={{ action: "hide_parcel", parcelId: p.id, hidden: !p.hidden }} label={p.hidden ? t("unhide") : t("hide")} askReason={!p.hidden} />}
                  {p.status === "active" && <AdminButton payload={{ action: "feature_parcel", parcelId: p.id, featured: !p.featured }} label={p.featured ? t("unfeature") : t("feature")} askReason={!p.featured} />}
                  {p.status === "active" && staff.staffRole === "admin" && <AdminButton payload={{ action: "revoke_parcel", parcelId: p.id }} label={t("revoke")} tone="danger" askReason confirm={t("confirmRevoke")} />}
                </div></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="p-6 text-center text-ink-soft" colSpan={6}>{t("empty")}</td></tr>}
          </tbody>
        </table>
      </div>
      <nav className="mt-4 flex gap-2" aria-label="Pagination">
        {page > 0 && <Link className="btn btn-ghost btn-sm" href={`/admin/parcels?q=${encodeURIComponent(q)}&page=${page - 1}`}>←</Link>}
        {rows.length === PAGE_SIZE && <Link className="btn btn-ghost btn-sm" href={`/admin/parcels?q=${encodeURIComponent(q)}&page=${page + 1}`}>→</Link>}
      </nav>
    </div>
  );
}
