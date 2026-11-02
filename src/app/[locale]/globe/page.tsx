import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

export const dynamic = "force-dynamic";

/** There is no globe any more (the map is flat); old links to it land on the home page, which is the map. */
export default async function GlobeAlias({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  redirect({ href: "/", locale });
}
