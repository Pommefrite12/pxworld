import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/layout/PageShell";
import { Link } from "@/i18n/navigation";
import { requirePageStaff } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const staff = await requirePageStaff(locale); // role re-read from the database on every request
  const t = await getTranslations("admin.nav");
  const items = [
    ["/admin", t("dashboard")], ["/admin/moderation", t("moderation")], ["/admin/reports", t("reports")], ["/admin/parcels", t("parcels")],
    ["/admin/users", t("users")], ["/admin/orders", t("orders")], ["/admin/settings", t("settings")], ["/admin/audit", t("audit")],
  ] as const;
  return (
    <PageShell width="max-w-7xl">
      <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Admin" className="lg:sticky lg:top-6 lg:self-start">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("role", { role: staff.staffRole })}</p>
          <ul className="flex flex-wrap gap-1 lg:block lg:space-y-1">
            {items.map(([href, label]) => <li key={href}><Link href={href} className="block rounded-lg px-3 py-2 text-sm font-semibold hover:bg-paper-2">{label}</Link></li>)}
          </ul>
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </PageShell>
  );
}
