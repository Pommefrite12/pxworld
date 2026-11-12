import "server-only";
import { queryOne } from "@/lib/db/pool";
import type { FreeInfo } from "@/lib/free";

/** Where the free period stands, for the site and (with a user) for that account. The database decides; this only reads. */
export async function getFreeStatus(userId: string | null): Promise<FreeInfo | null> {
  try {
    const r = await queryOne<{ s: FreeInfo }>("select public.px_free_status($1) as s", [userId]);
    return r?.s ?? null;
  } catch (e) {
    // a database without migration 23: no free parcels, and nothing else breaks
    console.error("free status unavailable:", (e as Error).message);
    return null;
  }
}
