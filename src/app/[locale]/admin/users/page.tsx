import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { AdminButton } from "@/components/admin/AdminButton";
import { Link } from "@/i18n/navigation";
import { PAGE_SIZE, usersList } from "@/lib/data/admin";
import { requirePageStaff } from "@/lib/auth/guards";

export default async function AdminUsers({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string; page?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tc = await getTranslations("common");
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 60), page = Math.max(0, Number(sp.page ?? 0) || 0);
  const [t, f, rows, staff] = await Promise.all([getTranslations("admin.users"), getFormatter(), usersList(q, page * PAGE_SIZE), requirePageStaff(locale)]);
  return (
    <div>
      <h1 className="text-3xl font-extrabold">{t("title")}</h1>
      <p className="mt-1 text-sm text-ink-soft">{t("rolesNote")}</p>
      <form className="mt-4 flex gap-2" role="search"><input name="q" defaultValue={q} className="field max-w-sm" placeholder={t("search")} aria-label={t("search")} /><button className="btn btn-ink">{t("searchBtn")}</button></form>
      <div className="card mt-6 overflow-x-auto">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-faint"><tr><th className="p-3">{t("user")}</th><th className="p-3">{t("email")}</th><th className="p-3">{t("holdings")}</th><th className="p-3">{t("joined")}</th><th className="p-3">{t("status")}</th><th className="p-3">{t("actions")}</th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-b border-line last:border-0" data-testid="user-row">
                <td className="p-3 font-semibold"><Link href={`/u/${u.username}`} className="underline">{u.username}</Link> {u.role && <span className="chip !bg-cobalt/10 !text-cobalt">{u.role}</span>}</td>
                <td className="p-3">{u.email ?? "—"}</td>
                <td className="p-3 pixel-num">{u.parcels} · {f.number(u.pixels)} px</td>
                <td className="p-3">{f.dateTime(u.created_at, { dateStyle: "medium" })}</td>
                <td className="p-3">{u.status === "suspended" ? <span className="chip !bg-danger/10 !text-danger" title={u.suspended_reason ?? ""}>{t("suspended")}</span> : <span className="chip">{t("active")}</span>}</td>
                <td className="p-3">{staff.staffRole === "admin" && u.id !== staff.user.id && (
                  u.status === "suspended"
                    ? <AdminButton payload={{ action: "suspend_user", userId: u.id, suspended: false }} label={t("unsuspend")} />
                    : <AdminButton payload={{ action: "suspend_user", userId: u.id, suspended: true }} label={t("suspend")} tone="danger" askReason confirm={t("confirmSuspend")} testId="suspend" />)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav className="mt-4 flex gap-2" aria-label={tc("pagination")}>
        {page > 0 && <Link className="btn btn-ghost btn-sm" href={`/admin/users?q=${encodeURIComponent(q)}&page=${page - 1}`}>←</Link>}
        {rows.length === PAGE_SIZE && <Link className="btn btn-ghost btn-sm" href={`/admin/users?q=${encodeURIComponent(q)}&page=${page + 1}`}>→</Link>}
      </nav>
    </div>
  );
}
