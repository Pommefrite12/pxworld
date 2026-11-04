import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { CheckoutSuccess, ContributionSuccess } from "@/components/account/CheckoutReturn";
import { PageShell } from "@/components/layout/PageShell";

export const metadata: Metadata = { robots: { index: false } };

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ order?: string; contribution?: string }> }) {
  setRequestLocale((await params).locale);
  const { order, contribution } = await searchParams;
  const valid = typeof order === "string" && /^[0-9a-f-]{36}$/.test(order);
  const validContribution = typeof contribution === "string" && /^[0-9a-f-]{36}$/.test(contribution);
  return <PageShell width="max-w-2xl">{valid ? <CheckoutSuccess orderId={order} /> : validContribution ? <ContributionSuccess contributionId={contribution} /> : null}</PageShell>;
}
