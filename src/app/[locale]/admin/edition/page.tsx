import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { EditionPanel } from "@/components/admin/EditionPanel";
import { requirePageStaff } from "@/lib/auth/guards";
import { getEdition, settleEdition } from "@/lib/data/edition";

export default async function EditionPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, f, staff] = await Promise.all([getTranslations("admin.edition"), getFormatter({ locale }), requirePageStaff(locale)]);
  // looking at this page records what the clock already decided (the scheduled job only runs once a day): idempotent
  await settleEdition();
  const info = await getEdition();
  if (!info) return (<div><h1 className="text-3xl font-extrabold">{t("title")}</h1><p role="alert" className="mt-4 font-semibold text-danger">{t("unavailable")}</p></div>);
  const at = (iso: string | null) => (iso ? f.dateTime(new Date(iso), { dateStyle: "long", timeStyle: "short" }) : null);
  return (
    <div>
      <h1 className="text-3xl font-extrabold">{t("title")}</h1>
      <p className="mb-6 mt-1 max-w-2xl text-ink-soft">{t("lead")}</p>
      <EditionPanel
        canEdit={staff.staffRole === "admin"}
        info={info}
        text={{ opensAt: at(info.opensAt), closesAt: at(info.closesAt), settlesAt: at(info.settlesAt), closedAt: at(info.closedAt), snapshotAt: at(info.snapshot?.takenAt ?? null) }}
      />
    </div>
  );
}
