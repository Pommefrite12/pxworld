"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { GRID_WIDTH } from "@/lib/grid/constants";
import { pixelToLonLat } from "@/lib/grid/geometry";
import { SearchBox, type SearchTarget } from "@/components/map/SearchBox";
import { StatsCard } from "@/components/map/Hud";
import type { PublicStats } from "@/lib/data/map";
import { flyGlobeTo, startBuyFromGlobe } from "./bus";

/** Search in the home page's header: turns the globe to the place; a pixel position or a parcel opens the flat map. */
export function GlobeSearch() {
  const router = useRouter();
  const onGo = (t: SearchTarget) => {
    if (t.kind === "parcel") { router.push(`/p/${t.code}`); return; }
    if (t.kind === "point") {
      if (t.scale >= 10) { router.push(`/map?x=${Math.round(t.x)}&y=${Math.round(t.y)}&z=${t.scale}`); return; }
      const ll = pixelToLonLat(t.x, t.y);
      flyGlobeTo({ lon: ll.lon, lat: ll.lat, zoom: 2.5 });
      return;
    }
    // a country: turn to its centre, zoom so that it fills about 60% of the globe's width
    const ll = pixelToLonLat(t.rect.x + t.rect.w / 2, t.rect.y + t.rect.h / 2);
    const angW = (t.rect.w / GRID_WIDTH) * 2 * Math.PI;
    flyGlobeTo({ lon: ll.lon, lat: ll.lat, zoom: Math.max(1, Math.min(2.6, 1.2 / Math.max(0.05, angW * Math.cos((ll.lat * Math.PI) / 180)))) });
  };
  return <SearchBox onGo={onGo} />;
}

export function GlobeCta() {
  const t = useTranslations("map");
  return <button className="btn btn-primary btn-sm sm:!min-h-10 sm:!px-5" onClick={startBuyFromGlobe} data-testid="find-your-spot">{t("findYourSpot")}</button>;
}

/** The real counter, refreshed like on the flat map. */
export function GlobeStats({ initial }: { initial: PublicStats | null }) {
  const t = useTranslations("map");
  const [stats, setStats] = useState(initial);
  useEffect(() => {
    const tick = () => fetch("/api/stats").then((r) => (r.ok ? r.json() : null)).then((s: PublicStats | null) => s && setStats(s)).catch(() => undefined);
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="pointer-events-none absolute inset-3 z-10 flex flex-col items-start justify-end gap-2 sm:inset-5">
      <div className="flex max-w-[calc(100%-4.5rem)] flex-col items-start gap-2 sm:max-w-none">
        {stats ? <StatsCard stats={stats} compact={false} /> : <p className="card pointer-events-auto px-4 py-3 text-sm text-ink-soft">{t("statsUnavailable")}</p>}
        <p className="pointer-events-auto rounded-full bg-white/85 px-3 py-1 text-[0.65rem] text-ink-faint shadow-float">
          © Natural Earth · GeoNames · <Link href="/credits" className="underline">{t("credits")}</Link>
        </p>
      </div>
    </div>
  );
}
