import { requireActiveViewer } from "@/lib/auth/session";
import { query } from "@/lib/db/pool";
import { getPricing } from "@/lib/data/map";
import { HttpError, json } from "@/lib/http/errors";
import { assertSameOrigin, intParam, route } from "@/lib/http/route";
import { LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import { validateRect } from "@/lib/grid/geometry";
import { landPixelsIn } from "@/lib/geo/landServer";
import { enoughForKind, isParcelKind, type ParcelKind } from "@/lib/grid/pricing";
import { parseCreationMeta, readCreationImage } from "@/lib/creations";
import { assertSalesOpen } from "@/lib/data/edition";
import { requestCurrency } from "@/lib/currency-server";
import { objectStore } from "@/lib/storage";
import { isCampaignDays } from "@/lib/campaign";

export const maxDuration = 30;

/**
 * Sends a project to moderation: a parcel that several people will pay for. Validates the creation and the rectangle like a purchase
 * does, prices the parcel in PostgreSQL (the goal) and records the project as PENDING. Nothing is paid and nothing is held: the zone
 * is held when a moderator approves.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const viewer = await requireActiveViewer();
  await enforceRateLimit(req, LIMITS.campaign, viewer.user.id);

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 4 * 1024 * 1024) throw new HttpError(413, "too_large");
  const form = await req.formData();
  const rect = { x: intParam(String(form.get("x")), 0, 1e9), y: intParam(String(form.get("y")), 0, 1e9), w: intParam(String(form.get("w")), 1, 1e9), h: intParam(String(form.get("h")), 1, 1e9) };
  if (rect.x === null || rect.y === null || rect.w === null || rect.h === null) throw new HttpError(400, "px_invalid_rect");
  const r = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  const kindField = form.get("kind");
  if (kindField !== null && kindField !== "" && !isParcelKind(kindField)) throw new HttpError(400, "px_invalid_rect");
  const kind: ParcelKind = kindField === "water" ? "water" : "land";
  const days = Number(form.get("days"));
  if (!isCampaignDays(days)) throw new HttpError(400, "px_invalid_campaign");

  // the project's currency is the creator's (euros in the euro area, dollars elsewhere), like a purchase; every contributor pays in it
  const currency = requestCurrency(req.headers);
  const shown = form.get("currency");
  if (typeof shown === "string" && shown.toLowerCase() !== currency) throw new HttpError(409, "px_currency_changed");
  const pricing = await getPricing(currency);
  assertSalesOpen(pricing); // nothing can be bought outside the open edition, so nothing can be funded either
  if (validateRect(r, { minArea: pricing.campaignMinArea, maxArea: pricing.maxArea })) throw new HttpError(r.w * r.h < pricing.campaignMinArea ? 422 : 400, r.w * r.h < pricing.campaignMinArea ? "px_campaign_too_small" : "px_invalid_rect");
  const landPx = await landPixelsIn(r);
  if (!enoughForKind(kind, landPx, r.w * r.h, pricing)) throw new HttpError(422, kind === "water" ? "px_not_on_water" : "px_not_on_land");

  const meta = parseCreationMeta(form);
  const img = await readCreationImage(form, r); // fail fast, before anything is stored

  const key = `campaigns/${viewer.user.id}/${Date.now()}-${img.sha256.slice(0, 12)}.png`;
  await objectStore().put(key, img.png, "image/png");
  try {
    const [c] = await query<{ id: string; code: string; goal_cents: string; currency: string }>(
      "select id, code, goal_cents, currency from public.px_create_campaign($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)",
      [viewer.user.id, r.x, r.y, r.w, r.h, landPx, currency, kind, days, key, img.sha256, img.width, img.height, img.bytes, img.avgColor, meta.title, meta.description, meta.link, meta.commercial],
    );
    if (!c) throw new HttpError(500, "campaign_not_created");
    await query("select public.px_set_campaign_archive($1, $2, $3, $4, $5)", [viewer.user.id, c.id, meta.category, meta.placeLabel, meta.placeCountry]);
    return json({ id: c.id, code: c.code, goalCents: Number(c.goal_cents), currency: c.currency }, { status: 201, cache: "no-store" });
  } catch (e) {
    await objectStore().remove(key).catch(() => undefined); // the project was not recorded: do not leave its image behind
    throw e;
  }
});
