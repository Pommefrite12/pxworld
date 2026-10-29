import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/ui/Logo";

export async function Footer() {
  const t = await getTranslations("footer");
  return (
    <footer className="mt-20 border-t border-line bg-paper-2/60">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-3 text-sm text-ink-soft">{t("tagline")}</p>
        </div>
        <nav aria-label={t("legal")} className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm font-medium">
          <Link href="/discover" className="hover:underline">{t("discover")}</Link>
          <Link href="/rules" className="hover:underline">{t("rules")}</Link>
          <Link href="/terms" className="hover:underline">{t("terms")}</Link>
          <Link href="/privacy" className="hover:underline">{t("privacy")}</Link>
          <Link href="/credits" className="hover:underline">{t("credits")}</Link>
          <Link href="/contact" className="hover:underline">{t("contact")}</Link>
        </nav>
      </div>
      <p className="border-t border-line py-4 text-center text-xs text-ink-faint">{t("virtual")}</p>
    </footer>
  );
}
