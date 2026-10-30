import { setRequestLocale } from "next-intl/server";
import { GlobeScreen } from "@/components/globe/GlobeScreen";
import { redirect } from "@/i18n/navigation";
import { isParcelCode } from "@/lib/grid/code";

export const dynamic = "force-dynamic";

const isNum = (v: string | string[] | undefined) => typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v);

/** Addresses that mean "the flat map": the camera, a purchase to resume, a highlighted parcel, "find your spot". */
function wantsFlatMap(sp: Record<string, string | string[] | undefined>) {
  return (isNum(sp.x) && isNum(sp.y) && isNum(sp.z)) || (isNum(sp.bx) && isNum(sp.by)) || isParcelCode(sp.p) || sp.buy === "1";
}

export default async function HomePage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  // links made before the globe existed (shared camera positions, sign-in return addresses) keep working
  if (wantsFlatMap(sp)) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string") qs.set(k, v);
    redirect({ href: `/map?${qs}`, locale });
  }
  return <GlobeScreen locale={locale} searchParams={sp} />;
}
