import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/layout/PageShell";
import { Link } from "@/i18n/navigation";

export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <PageShell width="max-w-xl">
      <div className="py-16 text-center">
        <p className="pixel-display text-7xl text-signal">404</p>
        <h1 className="mt-4 text-3xl font-extrabold">{t("notFoundTitle")}</h1>
        <p className="mt-2 text-ink-soft">{t("notFoundLead")}</p>
        <Link href="/" className="btn btn-primary mt-6">{t("backToMap")}</Link>
      </div>
    </PageShell>
  );
}
