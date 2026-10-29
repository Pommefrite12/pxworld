import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/layout/PageShell";
import { EditCreation } from "@/components/account/EditCreation";
import { Link } from "@/i18n/navigation";
import { requirePageViewer } from "@/lib/auth/guards";
import { getLatestAssetsOf, getOwnedParcelByCode } from "@/lib/data/parcels";
import { queryOne } from "@/lib/db/pool";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false } };

export default async function EditParcel({ params }: { params: Promise<{ locale: string; code: string }> }) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  const v = await requirePageViewer(locale, `/account/parcels/${code}/edit`);
  const parcel = await getOwnedParcelByCode(v.user.id, code);
  if (!parcel || parcel.status !== "active") notFound();
  const [t, f, versions, published] = await Promise.all([
    getTranslations("account.edit"), getFormatter(), getLatestAssetsOf(parcel.id),
    queryOne<{ id: string; title: string | null; description: string | null; link_url: string | null }>(
      "select a.id, a.title, a.description, a.link_url from public.parcels p join public.parcel_assets a on a.id = p.published_asset_id where p.id = $1", [parcel.id]),
  ]);
  return (
    <PageShell>
      <Link href="/account/parcels" className="text-sm font-semibold text-cobalt underline">← {t("back")}</Link>
      <h1 className="mt-2 text-3xl font-extrabold">{t("title")}</h1>
      <p className="pixel-num mt-1 text-ink-soft">{parcel.w}×{parcel.h} · @{parcel.x},{parcel.y}</p>
      <div className="mt-8">
        <EditCreation code={code} w={parcel.w} h={parcel.h} current={{ assetId: published?.id ?? versions[0]?.id ?? null, title: published?.title ?? null, description: published?.description ?? null, link: published?.link_url ?? null }} />
      </div>
      <section className="mt-12" aria-label={t("history")}>
        <h2 className="text-xl font-bold">{t("history")}</h2>
        <ul className="mt-3 divide-y divide-line rounded-2xl bg-white shadow-float">
          {versions.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span>v{a.version} · {f.dateTime(a.created_at, { dateStyle: "medium", timeStyle: "short" })} {a.title ? `· ${a.title}` : ""}</span>
              <span className="chip">{t(`status.${a.status}`)}{a.status === "rejected" && a.rejection_reason ? ` — ${a.rejection_reason}` : ""}</span>
            </li>
          ))}
        </ul>
      </section>
    </PageShell>
  );
}
