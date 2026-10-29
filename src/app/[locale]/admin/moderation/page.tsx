import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { AdminButton } from "@/components/admin/AdminButton";
import { Link } from "@/i18n/navigation";
import { moderationQueue } from "@/lib/data/admin";
import { hostOf } from "@/lib/security/url";

export default async function Moderation({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, f, items] = await Promise.all([getTranslations("admin.moderation"), getFormatter(), moderationQueue()]);
  return (
    <div>
      <h1 className="text-3xl font-extrabold">{t("title")}</h1>
      <p className="mt-1 text-ink-soft">{t("lead")}</p>
      {items.length === 0 ? <p className="card mt-6 p-8 text-center text-ink-soft" data-testid="queue-empty">{t("empty")}</p> : (
        <ul className="mt-6 space-y-4">
          {items.map((a) => (
            <li key={a.id} className="card flex flex-col gap-4 p-4 sm:flex-row" data-testid="queue-item">
              <div className="checker grid h-44 w-44 shrink-0 place-items-center rounded-xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/assets/${a.id}`} alt="" width={a.width} height={a.height} className="pixelated max-h-full max-w-full" style={{ imageRendering: "pixelated" }} />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="font-bold">{a.title ?? t("untitled")} {a.is_commercial && <span className="chip !bg-warn/15 !text-warn">{t("ad")}</span>} {a.has_published && <span className="chip">{t("edit")}</span>}</p>
                {a.description && <p className="text-sm">{a.description}</p>}
                {a.link_url && <p className="break-all text-sm"><a className="text-cobalt underline" href={a.link_url} target="_blank" rel="noopener noreferrer nofollow">{hostOf(a.link_url)} ↗</a> <span className="text-xs text-ink-faint">({a.link_url})</span></p>}
                <p className="text-xs text-ink-soft">{t("by")} <Link className="font-semibold underline" href={`/u/${a.username}`}>{a.username}</Link> · {a.width}×{a.height} · v{a.version} · {f.dateTime(a.created_at, { dateStyle: "medium", timeStyle: "short" })} · <Link className="underline" href={`/p/${a.code}`}>{a.code}</Link></p>
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <AdminButton payload={{ action: "review_asset", assetId: a.id, decision: "approve" }} label={t("approve")} tone="primary" testId="approve" />
                  <AdminButton payload={{ action: "review_asset", assetId: a.id, decision: "reject" }} label={t("reject")} tone="danger" askReason testId="reject" />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
