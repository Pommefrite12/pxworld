import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { AdminButton } from "@/components/admin/AdminButton";
import { Link } from "@/i18n/navigation";
import { PAGE_SIZE, recentComments } from "@/lib/data/admin";

/** The latest comments under parcels: to read what is being said, and to remove what must not stay (the author's and the owner's own removals are kept too). */
export default async function AdminComments({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ status?: string; offset?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const status = sp.status === "removed" ? "removed" : "visible";
  const offset = Math.max(0, Math.min(100_000, Number(sp.offset) || 0));
  const [t, f, items] = await Promise.all([getTranslations("admin.comments"), getFormatter(), recentComments(status, offset)]);
  return (
    <div>
      <h1 className="text-3xl font-extrabold">{t("title")}</h1>
      <p className="mt-1 max-w-2xl text-ink-soft">{t("lead")}</p>
      <nav aria-label={t("filter")} className="mt-4 flex gap-2">
        {(["visible", "removed"] as const).map((s) => (
          <Link key={s} href={{ pathname: "/admin/comments", query: { status: s } }} aria-current={status === s ? "true" : undefined} data-testid={`comments-${s}`}
            className={`btn btn-sm ${status === s ? "btn-ink" : "btn-ghost"}`}>{t(`status.${s}`)}</Link>
        ))}
      </nav>
      {items.length === 0 ? <p className="card mt-6 p-8 text-center text-ink-soft" data-testid="comments-empty">{t("empty")}</p> : (
        <ul className="mt-6 space-y-3">
          {items.map((c) => (
            <li key={c.id} className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between" data-testid="admin-comment">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-line break-words" data-testid="admin-comment-body">{c.body}</p>
                <p className="mt-1 text-xs text-ink-soft">
                  {t("by")} <Link className="font-semibold underline" href={`/u/${c.author}`}>{c.author}</Link> · {t("on")} <Link className="font-semibold underline" href={`/p/${c.code}`}>{c.title ?? c.code}</Link>
                  {" "}({t("owner")} {c.owner}{c.hidden ? ` · ${t("hidden")}` : ""}) · {f.dateTime(c.created_at, { dateStyle: "medium", timeStyle: "short" })}
                  {c.status === "removed" && c.removed_role && <> · <span className="chip">{t("removedBy", { role: t(`roles.${c.removed_role as "author" | "owner" | "moderator" | "admin"}`) })}</span></>}
                </p>
              </div>
              {c.status === "visible" && <AdminButton payload={{ action: "remove_comment", commentId: c.id }} label={t("remove")} tone="danger" askReason testId="remove-comment" />}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-6 flex gap-2">
        {offset > 0 && <Link className="btn btn-ghost btn-sm" href={{ pathname: "/admin/comments", query: { status, offset: Math.max(0, offset - PAGE_SIZE) } }}>← {t("newer")}</Link>}
        {items.length === PAGE_SIZE && <Link className="btn btn-ghost btn-sm" href={{ pathname: "/admin/comments", query: { status, offset: offset + PAGE_SIZE } }} data-testid="comments-next">{t("older")} →</Link>}
      </div>
    </div>
  );
}
