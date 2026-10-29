import { setRequestLocale } from "next-intl/server";
import { MapShell } from "@/components/map/MapShell";
import { getHeaderViewer } from "@/lib/auth/session";
import { getPricing, getPublicStats } from "@/lib/data/map";
import { GRID_HEIGHT, GRID_WIDTH } from "@/lib/grid/constants";
import { validateRect } from "@/lib/grid/geometry";

export const dynamic = "force-dynamic";

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
  const [stats, pricing, viewer] = await Promise.all([safe(getPublicStats), safe(getPricing), getHeaderViewer()]);

  // Deep links: ?x=&y=&z= (camera) and ?bx=&by=&bw=&bh= (resume a purchase after signing in)
  const x = num(sp.x), y = num(sp.y), z = num(sp.z);
  const camera = x !== null && y !== null && z !== null && x >= 0 && x <= GRID_WIDTH && y >= 0 && y <= GRID_HEIGHT && z > 0 && z <= 48 ? { x, y, scale: z } : null;
  const b = { x: num(sp.bx), y: num(sp.by), w: num(sp.bw), h: num(sp.bh) };
  const buy = b.x !== null && b.y !== null && b.w !== null && b.h !== null && !validateRect({ x: b.x, y: b.y, w: b.w, h: b.h }) ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;

  return (
    <main id="main">
      <MapShell
        stats={stats}
        viewer={viewer}
        pricing={pricing ?? { unitPriceCents: 100, currency: "eur", minArea: 100, maxArea: 250_000, salesOpen: false }}
        initial={{ camera, parcelCode: typeof sp.p === "string" && /^[0-9a-f]{8}$/.test(sp.p) ? sp.p : null, buy }}
      />
    </main>
  );
}
