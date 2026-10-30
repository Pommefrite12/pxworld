import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

export const dynamic = "force-dynamic";

/** The globe used to live here while it was a prototype: it is the home page now. */
export default async function GlobeAlias({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") qs.set(k, v);
  redirect({ href: qs.size ? `/?${qs}` : "/", locale });
}
