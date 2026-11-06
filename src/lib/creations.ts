import "server-only";
import { query } from "@/lib/db/pool";
import { HttpError } from "@/lib/http/errors";
import { objectStore } from "@/lib/storage";
import { TITLE_MAX, cleanText, isValidTitle } from "@/lib/security/text";
import { sanitizeExternalUrl } from "@/lib/security/url";
import { ImageError, MAX_UPLOAD_BYTES, processCreation, type ProcessedImage } from "@/lib/images/validate";
import { PLACE_MAX, isCategory, normalizeCountry, type ArchiveFields } from "@/lib/archive";

export interface CreationMeta extends ArchiveFields {
  /** Required (see `isValidTitle`): it is what people read when they click the parcel on the map. */
  title: string;
  description: string | null;
  link: string | null;
  commercial: boolean;
}

export function parseCreationMeta(form: FormData): CreationMeta {
  const rawLink = form.get("link");
  const link = typeof rawLink === "string" && rawLink.trim() ? sanitizeExternalUrl(rawLink) : null;
  if (typeof rawLink === "string" && rawLink.trim() && !link) throw new HttpError(400, "invalid_link");
  const title = cleanText(form.get("title"), TITLE_MAX);
  if (!title || !isValidTitle(title)) throw new HttpError(400, "title_required");
  // the archive fields: all optional for the API (a creation made before had none), but never wrong
  const rawCategory = form.get("category");
  const category = typeof rawCategory === "string" && rawCategory.trim() ? rawCategory.trim() : null;
  if (category !== null && !isCategory(category)) throw new HttpError(400, "invalid_category");
  const rawCountry = form.get("placeCountry");
  const placeCountry = typeof rawCountry === "string" && rawCountry.trim() ? normalizeCountry(rawCountry) : null;
  if (typeof rawCountry === "string" && rawCountry.trim() && !placeCountry) throw new HttpError(400, "invalid_country");
  return {
    title,
    description: cleanText(form.get("description"), 280),
    link,
    commercial: form.get("commercial") === "true" || form.get("commercial") === "on",
    category,
    placeLabel: cleanText(form.get("placeLabel"), PLACE_MAX),
    placeCountry,
  };
}

/** Reads and validates the uploaded image. Maps image errors to 4xx responses. */
export async function readCreationImage(form: FormData, size: { w: number; h: number }): Promise<ProcessedImage> {
  const file = form.get("image");
  if (!(file instanceof File)) throw new HttpError(400, "image_required");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "too_large");
  try {
    return await processCreation(Buffer.from(await file.arrayBuffer()), size);
  } catch (e) {
    if (e instanceof ImageError) throw new HttpError(e.code === "too_large" ? 413 : 422, `image_${e.code}`);
    throw e;
  }
}

/** Persists a validated creation as a new PENDING version of the parcel (moderation decides if it is shown). */
export async function storeCreation(userId: string, parcelId: string, img: ProcessedImage, meta: CreationMeta) {
  const key = `creations/${parcelId}/${Date.now()}-${img.sha256.slice(0, 12)}.png`;
  await objectStore().put(key, img.png, "image/png");
  // ONE statement: the new version and its archive fields are recorded together or not at all
  const [asset] = await query<{ id: string; version: number }>(
    `with a as (select id, version from public.px_add_asset($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12))
     select a.id, a.version, public.px_set_asset_archive($1, a.id, $13, $14, $15) as archived from a`,
    [userId, parcelId, key, img.sha256, img.width, img.height, img.bytes, img.avgColor, meta.title, meta.description, meta.link, meta.commercial, meta.category, meta.placeLabel, meta.placeCountry],
  );
  if (!asset) throw new Error("asset insert returned no row");
  return asset;
}
