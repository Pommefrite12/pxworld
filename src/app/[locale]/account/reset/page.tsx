import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { AuthForm } from "@/components/auth/AuthForm";
import { PageShell } from "@/components/layout/PageShell";

export const metadata: Metadata = { robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <PageShell width="max-w-lg"><AuthForm mode="reset" /></PageShell>;
}
