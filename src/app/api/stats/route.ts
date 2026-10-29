import { getPublicStats } from "@/lib/data/map";
import { json } from "@/lib/http/errors";
import { route } from "@/lib/http/route";

export const GET = route(async () => {
  return json(await getPublicStats(), { cache: "public, s-maxage=15, stale-while-revalidate=60" });
});
