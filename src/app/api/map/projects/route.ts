import { mapProjects } from "@/lib/data/campaigns";
import { salesClosedByStory } from "@/lib/doom/sales";
import { json } from "@/lib/http/errors";
import { route } from "@/lib/http/route";
import type { MapProject } from "@/lib/map/projects";

/**
 * The group projects that are collecting, for the map to draw (pins and hatched zones). Public data only, anonymous like the rest.
 * It never breaks the map: without the migrations, or once the world has ended (nothing can be funded any more), the answer is an empty list.
 */
export const GET = route(async () => {
  const cache = "public, s-maxage=30, stale-while-revalidate=120";
  if (salesClosedByStory(process.env.NEXT_PUBLIC_WORLD_END_AT, Date.now())) return json([] satisfies MapProject[], { cache });
  try {
    const rows = await mapProjects();
    const list: MapProject[] = rows.map((r) => ({
      id: r.id, code: r.code, title: r.title, x: r.x, y: r.y, w: r.w, h: r.h, water: r.kind === "water", currency: r.currency,
      raisedCents: Number(r.raised_cents), goalCents: Number(r.goal_cents), contributors: r.contributors, secondsLeft: Math.floor(r.seconds_left),
    }));
    return json(list, { cache });
  } catch (e) {
    console.error("map projects failed", (e as Error).message);
    return json([] satisfies MapProject[], { cache: "no-store" });
  }
});
