import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/components/layout/LegalPage";
import { operator } from "@/lib/legal";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "pages" });
  return { title: t("contact.title") };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("pages.contact");
  const email = operator().email;
  return (
    <LegalPage k="contact">
      <p className="mt-4"><strong>{t("email")}:</strong> {email.includes("@") ? <a href={`mailto:${email}`}>{email}</a> : email}</p>
      <p className="mt-4 text-sm text-ink-soft">{t("reportHint")}</p>
    </LegalPage>
  );
}
