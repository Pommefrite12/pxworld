import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { AdminButton } from "@/components/admin/AdminButton";
import { Link } from "@/i18n/navigation";
import { openReports } from "@/lib/data/admin";

export default async function Reports({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ status?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const status = ["open", "actioned", "dismissed", "all"].includes((await searchParams).status ?? "") ? (await searchParams).status! : "open";
  const [t, f, reports] = await Promise.all([getTranslations("admin.reports"), getFormatter(), openReports(status)]);
  return (
    <div>
      <h1 className="text-3xl font-extrabold">{t("title")}</h1>
      <p className="mt-1 text-ink-soft">{t("lead")}</p>
      <nav className="mt-4 flex gap-2" aria-label={t("filter")}>
        {["open", "actioned", "dismissed", "all"].map((s) => <Link key={s} href={`/admin/reports?status=${s}`} className={`btn btn-sm ${s === status ? "btn-ink" : "btn-ghost"}`}>{t(`status.${s}`)}</Link>)}
      </nav>
      {reports.length === 0 ? <p className="card mt-6 p-8 text-center text-ink-soft" data-testid="reports-empty">{t("empty")}</p> : (
        <ul className="mt-6 space-y-4">
          {reports.map((r) => {
            const ev = r.evidence as { title?: string; link_url?: string; content_hash?: string; captured_at?: string; asset_id?: string };
            return (
              <li key={r.id} className="card space-y-2 p-4" data-testid="report-item">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip !bg-danger/10 !text-danger">{t(`reasons.${r.reason}`)}</span>
                  <span className="chip">{t(`status.${r.status === "reviewing" ? "open" : r.status}`)}</span>
                  {r.hidden && <span className="chip !bg-warn/15 !text-warn">{t("hidden")}</span>}
                  {r.same_parcel > 1 && <span className="chip">{t("reportsOnParcel", { n: r.same_parcel })}</span>}
                  <span className="ml-auto text-xs text-ink-faint">{f.dateTime(r.created_at, { dateStyle: "medium", timeStyle: "short" })}</span>
                </div>
                <p className="text-sm">{t("parcelOf")} <Link className="font-semibold underline" href={`/p/${r.code}`}>{r.code}</Link> · {t("owner")} <span className="font-semibold">{r.owner}</span> · {t("reporter")} {r.reporter ?? "—"}</p>
                {r.details && <p className="rounded-lg bg-paper-2 px-3 py-2 text-sm">{r.details}</p>}
                <details className="text-xs text-ink-soft">
                  <summary className="cursor-pointer font-semibold">{t("evidence")}</summary>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                    <dt>{t("capturedAt")}</dt><dd>{ev.captured_at}</dd><dt>{t("evTitle")}</dt><dd>{ev.title ?? "—"}</dd><dt>{t("link")}</dt><dd className="break-all">{ev.link_url ?? "—"}</dd><dt>SHA-256</dt><dd className="break-all font-mono">{ev.content_hash ?? "—"}</dd>
                  </dl>
                </details>
                {r.resolution_note && <p className="text-xs text-ink-soft">{t("note")}: {r.resolution_note}</p>}
                {(r.status === "open" || r.status === "reviewing") && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {!r.hidden && <AdminButton payload={{ action: "hide_parcel", parcelId: r.parcel_id, hidden: true }} label={t("hide")} tone="danger" askReason testId="report-hide" />}
                    <AdminButton payload={{ action: "resolve_report", reportId: r.id, resolution: "actioned" }} label={t("markActioned")} tone="ink" askReason testId="report-actioned" />
                    <AdminButton payload={{ action: "resolve_report", reportId: r.id, resolution: "dismissed" }} label={t("dismiss")} askReason testId="report-dismiss" />
                    <AdminButton payload={{ action: "suspend_user", userId: r.owner_id, suspended: true }} label={t("suspendOwner")} tone="danger" askReason confirm={t("confirmSuspend")} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
