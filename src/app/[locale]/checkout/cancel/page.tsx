import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { CheckoutCancel } from "@/components/account/CheckoutReturn";
import { PageShell } from "@/components/layout/PageShell";

export const metadata: Metadata = { robots: { index: false } };

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ order?: string }> }) {
  setRequestLocale((await params).locale);
  const { order } = await searchParams;
  const valid = typeof order === "string" && /^[0-9a-f-]{36}$/.test(order);
  return <PageShell width="max-w-2xl">{valid ? <CheckoutCancel orderId={order} /> : null}</PageShell>;
}
