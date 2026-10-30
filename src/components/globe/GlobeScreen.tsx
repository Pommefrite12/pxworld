import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { getHeaderViewer } from "@/lib/auth/session";
import { getPublicStats } from "@/lib/data/map";
import { GlobeView } from "./GlobeView";
import { GlobeCta, GlobeSearch, GlobeStats } from "./GlobeChrome";

const num = (v: string | string[] | undefined) => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null);

/** The header needs the signed-in user (a database round trip): it streams in after the globe instead of delaying it. */
async function Header() {
  const viewer = await getHeaderViewer().catch(() => null);
  return <SiteHeader viewer={viewer} center={<GlobeSearch />} cta={<GlobeCta />} />;
}

/** Real numbers, streamed in too: the globe never waits for the database. */
async function Stats() {
  const stats = await getPublicStats().catch((e: Error) => { console.error("home stats unavailable:", e.message); return null; });
  return <GlobeStats initial={stats} />;
}

/**
 * The home page: the planet as a 3D globe. `lon`, `lat` and `zoom` in the address start it somewhere specific (that is
 * how the flat map hands over when you zoom out); without them it turns by itself.
 */
export async function GlobeScreen({ locale, searchParams }: { locale: string; searchParams: Record<string, string | string[] | undefined> }) {
  const t = await getTranslations({ locale, namespace: "map" });
  const lon = num(searchParams.lon), lat = num(searchParams.lat), zoom = num(searchParams.zoom);
  const given = lon !== null && lat !== null && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
  return (
    <main id="main" className="flex h-dvh flex-col">
      <Suspense fallback={<SiteHeader viewer={null} cta={<GlobeCta />} />}>
        <Header />
      </Suspense>
      <h1 className="sr-only">{t("sloganA")} {t("sloganB")} {t("sloganC")}</h1>
      <div className="relative min-h-0 flex-1">
        <GlobeView initial={{ lon: given ? lon : 10, lat: given ? lat : 28, spin: !given, zoom: given && zoom !== null ? zoom : undefined }} />
        <Suspense>
          <Stats />
        </Suspense>
      </div>
    </main>
  );
}
