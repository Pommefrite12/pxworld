import { NextResponse } from "next/server";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

/** Business error codes raised by SQL functions → HTTP status. */
const PX_STATUS: Record<string, number> = {
  px_parcel_unavailable: 409,
  px_invalid_rect: 400,
  px_not_on_land: 422,
  px_not_on_water: 422,
  px_sales_closed: 503,
  px_edition_not_open: 503, // pre-launch: the archive has not opened yet
  px_edition_closed: 403, // after the closing: nothing can be bought
  px_edition_frozen: 423, // the creations are frozen (the archive)
  px_edition_bad_state: 409,
  px_edition_bad_date: 400,
  px_edition_confirm_mismatch: 400,
  px_edition_not_empty: 409,
  px_bad_currency: 400,
  px_account_suspended: 403,
  px_no_profile: 403,
  px_too_many_reservations: 429,
  px_forbidden: 403,
  px_not_found: 404,
  px_bad_dimensions: 400,
  px_parcel_not_editable: 409,
  px_collab_closed: 404, // unknown, switched off, hidden… all look the same from outside
  px_collab_bad_batch: 400,
  px_collab_out_of_bounds: 400,
  px_not_pending: 409,
  px_parcel_not_active: 409,
  px_bad_decision: 400,
  px_bad_setting: 400,
  px_comment_invalid: 400,
  px_comment_duplicate: 409,
  px_campaign_too_small: 422,
  px_invalid_campaign: 400,
  px_campaign_already_active: 409,
  px_not_cancellable: 409,
  px_campaign_closed: 409,
  px_campaign_full: 409,
  px_contribution_in_progress: 409,
  px_invalid_amount: 400,
  px_amount_too_high: 422,
  px_amount_too_low: 422,
  px_amount_leaves_dust: 422,
};

export function statusForPx(code: string): number {
  return PX_STATUS[code] ?? 500;
}

export function json(data: unknown, init?: ResponseInit & { cache?: string }) {
  const headers = new Headers(init?.headers);
  if (init?.cache) headers.set("Cache-Control", init.cache);
  return NextResponse.json(data, { ...init, headers });
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
  const code = (e as { message?: string } | null)?.message;
  if (code && /^px_[a-z_]+$/.test(code)) return NextResponse.json({ error: code }, { status: statusForPx(code) });
  // a column or a function the code expects is not in the database: the migrations were not applied after an update (the usual cause of a map without parcels)
  const pg = (e as { code?: string } | null)?.code;
  if (pg === "42703" || pg === "42883" || pg === "42P01") console.error("[alert] The database is out of date: run `node scripts/migrate.mjs` (deployment guide, step 1F). Underlying error:", (e as Error).message);
  else console.error("Unhandled API error", e);
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}
