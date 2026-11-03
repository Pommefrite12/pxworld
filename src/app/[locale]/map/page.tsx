import { isParcelCode } from "@/lib/grid/code";
import { DEFAULT_PRICING } from "@/lib/grid/pricing";
import { setRequestLocale } from "next-intl/server";
import { MapShell } from "@/components/map/MapShell";
import { getHeaderViewer } from "@/lib/auth/session";
import { getPricing, getPublicStats } from "@/lib/data/map";
import { latestCreations } from "@/lib/data/parcels";
import { GRID_HEIGHT, GRID_WIDTH } from "@/lib/grid/constants";
import { validateRect } from "@/lib/grid/geometry";
import { headers } from "next/headers";
import { requestCurrency } from "@/lib/currency-server";

export const dynamic = "force-dynamic";

/** The flat map: where pixels are bought and drawn. It is the home page (`/`) too; this address stays for existing links. */

const num = (v: string | string[] | undefined) => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null);

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.error("home data unavailable:", (e as Error).message);
    return null;
  }
}

export default async function HomePage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const currency = requestCurrency(await headers()); // euros in the euro area, dollars elsewhere
  const startBuy = sp.buy === "1";
  const [stats, pricing, viewer, latest] = await Promise.all([safe(getPublicStats), safe(() => getPricing(currency)), getHeaderViewer(), safe(() => latestCreations(4))]);

  // Deep links: ?x=&y=&z= (camera) and ?bx=&by=&bw=&bh= (resume a purchase after signing in)
  const x = num(sp.x), y = num(sp.y), z = num(sp.z);
  const camera = x !== null && y !== null && z !== null && x >= 0 && x <= GRID_WIDTH && y >= 0 && y <= GRID_HEIGHT && z > 0 && z <= 48 ? { x, y, scale: z } : null;
  const b = { x: num(sp.bx), y: num(sp.by), w: num(sp.bw), h: num(sp.bh) };
  const buy = b.x !== null && b.y !== null && b.w !== null && b.h !== null && !validateRect({ x: b.x, y: b.y, w: b.w, h: b.h }) ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;

  return (
    <main id="main">
      <MapShell
        stats={stats}
        latest={(latest ?? []).map((c) => ({ code: c.code, x: c.x, y: c.y, w: c.w, h: c.h, assetId: c.asset_id, title: c.title }))}
        viewer={viewer}
        pricing={pricing ?? DEFAULT_PRICING}
        initial={{ camera, parcelCode: isParcelCode(sp.p) ? sp.p : null, buy, startBuy }}
      />
    </main>
  );
}
