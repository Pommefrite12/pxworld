import "server-only";
import { query, queryOne } from "@/lib/db/pool";
import { HttpError } from "@/lib/http/errors";
import type { EditionInfo, EditionState } from "@/lib/edition";

/** The edition, read from PostgreSQL (which computes the state from its own clock). Null when the database has no migration 19 yet. */
export async function getEdition(): Promise<EditionInfo | null> {
  try {
    const r = await queryOne<{ i: EditionInfo | null }>("select public.px_edition_info() as i");
    return r?.i ?? null;
  } catch (e) {
    console.error("edition unavailable (is migration 19 applied? `node scripts/migrate.mjs`):", (e as Error).message);
    return null;
  }
}

/**
 * Records what the clock already decided (ends the open group projects, takes the snapshot once the payments under way have settled).
 * Idempotent, never throws: it runs from the scheduled job and when somebody opens the back office.
 */
export async function settleEdition(): Promise<string> {
  try {
    const rows = await query<{ r: string }>("select public.px_edition_sweep() as r");
    return rows[0]?.r ?? "idle";
  } catch (e) {
    console.error("edition sweep failed", (e as Error).message);
    return "error";
  }
}

/** The sale routes call this first: the same refusals as the database (which stays the judge), with the codes the interface translates. */
export function assertSalesOpen(p: { salesOpen: boolean; editionState: EditionState }): void {
  if (p.editionState === "prelaunch") throw new HttpError(503, "px_edition_not_open");
  if (p.editionState === "closed") throw new HttpError(403, "px_edition_closed");
  if (!p.salesOpen) throw new HttpError(503, "px_sales_closed");
}
