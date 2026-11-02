import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DrawBoard } from "@/components/draw/DrawBoard";
import { PageShell } from "@/components/layout/PageShell";
import { Link } from "@/i18n/navigation";
import { openCollab } from "@/lib/collab";
import { creationScale } from "@/lib/grid/constants";

export const dynamic = "force-dynamic";
// the link is a secret: never indexed, never sent along as a referrer to anything the page links to
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function DrawPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const [t, info] = await Promise.all([getTranslations("draw"), openCollab(token).catch(() => null)]);

  if (!info) {
    return (
      <PageShell width="max-w-xl">
        <div className="card p-8 text-center" data-testid="draw-closed">
          <h1 className="text-2xl font-extrabold">{t("closedTitle")}</h1>
          <p className="mt-2 text-ink-soft">{t("closedLead")}</p>
          <Link href="/" className="btn btn-primary mt-5">{t("home")}</Link>
        </div>
      </PageShell>
    );
  }
  return (
    <PageShell width="max-w-5xl">
      <h1 className="text-3xl font-extrabold">{t("title")}</h1>
      <p className="mt-1 text-ink-soft">{info.title ? t("leadTitled", { title: info.title, owner: info.owner }) : t("lead", { owner: info.owner })}</p>
      <p className="mt-1 text-sm text-ink-faint">{t("rule")}</p>
      <div className="mt-6 pb-10">
        <DrawBoard token={token} w={info.w} h={info.h} scale={creationScale(info.w, info.h)} baseAssetId={info.baseAssetId} />
      </div>
    </PageShell>
  );
}
