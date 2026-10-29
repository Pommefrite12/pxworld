import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PAGE_SIZE, auditList } from "@/lib/data/admin";

export default async function Audit({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ page?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tc = await getTranslations("common");
  const page = Math.max(0, Number((await searchParams).page ?? 0) || 0);
  const [t, f, rows] = await Promise.all([getTranslations("admin.audit"), getFormatter(), auditList(page * PAGE_SIZE * 2)]);
  return (
    <div>
      <h1 className="text-3xl font-extrabold">{t("title")}</h1>
      <p className="mt-1 text-ink-soft">{t("lead")}</p>
      <div className="card mt-6 overflow-x-auto">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-faint"><tr><th className="p-3">{t("when")}</th><th className="p-3">{t("who")}</th><th className="p-3">{t("action")}</th><th className="p-3">{t("target")}</th><th className="p-3">{t("details")}</th></tr></thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="border-b border-line last:border-0 align-top" data-testid="audit-row">
                <td className="p-3 whitespace-nowrap text-xs">{f.dateTime(l.created_at, { dateStyle: "short", timeStyle: "medium" })}</td>
                <td className="p-3">{l.actor ?? l.actor_role ?? "system"}{l.actor && l.actor_role ? <span className="chip ml-1">{l.actor_role}</span> : null}</td>
                <td className="p-3 font-mono text-xs">{l.action}</td>
                <td className="p-3 text-xs">{l.target_type}<br /><span className="font-mono text-ink-faint">{l.target_id?.slice(0, 13)}</span></td>
                <td className="p-3 break-all font-mono text-xs text-ink-soft">{Object.keys(l.metadata).length ? JSON.stringify(l.metadata) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav className="mt-4 flex gap-2" aria-label={tc("pagination")}>
        {page > 0 && <Link className="btn btn-ghost btn-sm" href={`/admin/audit?page=${page - 1}`}>←</Link>}
        {rows.length === PAGE_SIZE * 2 && <Link className="btn btn-ghost btn-sm" href={`/admin/audit?page=${page + 1}`}>→</Link>}
      </nav>
    </div>
  );
}
