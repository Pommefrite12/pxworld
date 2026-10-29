import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthForm } from "@/components/auth/AuthForm";
import { PageShell } from "@/components/layout/PageShell";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("sign-up.title"), robots: { index: false } };
}

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string; error?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "auth" });
  return (
    <PageShell width="max-w-lg">
      {sp.error && <p role="alert" className="mx-auto mb-4 max-w-md rounded-xl bg-danger/10 px-3 py-2 text-sm font-semibold text-danger">{t("callbackError")}</p>}
      <AuthForm mode="sign-up" next={sp.next} />
    </PageShell>
  );
}
