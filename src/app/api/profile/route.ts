import { requireActiveViewer } from "@/lib/auth/session";
import { query } from "@/lib/db/pool";
import { HttpError, json } from "@/lib/http/errors";
import { assertSameOrigin, route } from "@/lib/http/route";
import { LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import { cleanText, USERNAME_RE } from "@/lib/security/text";
import { objectStore } from "@/lib/storage";
import { ImageError, processAvatar } from "@/lib/images/validate";

/** Edit own profile: username, optional country (ISO 3166-1 alpha-2), short bio. */
export const PATCH = route(async (req) => {
  assertSameOrigin(req);
  const v = await requireActiveViewer();
  await enforceRateLimit(req, LIMITS.profile, v.user.id);
  const b = (await req.json().catch(() => null)) as { username?: unknown; country?: unknown; bio?: unknown } | null;
  if (!b) throw new HttpError(400, "invalid_request");
  const username = b.username === undefined ? v.profile.username : String(b.username).trim();
  if (!USERNAME_RE.test(username)) throw new HttpError(400, "invalid_username");
  const country = b.country === undefined ? v.profile.country : b.country === "" || b.country === null ? null : String(b.country).toUpperCase();
  if (country !== null && !/^[A-Z]{2}$/.test(country)) throw new HttpError(400, "invalid_country");
  const bio = b.bio === undefined ? v.profile.bio : cleanText(b.bio, 280);
  try {
    await query("update public.profiles set username = $2, country = $3, bio = $4 where id = $1", [v.user.id, username, country, bio]);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new HttpError(409, "username_taken");
    throw e;
  }
  return json({ ok: true }, { cache: "no-store" });
});

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const v = await requireActiveViewer();
  await enforceRateLimit(req, LIMITS.profile, v.user.id);
  const form = await req.formData();
  const file = form.get("avatar");
  if (!(file instanceof File)) throw new HttpError(400, "image_required");
  try {
    const { png, sha256 } = await processAvatar(Buffer.from(await file.arrayBuffer()));
    const key = `avatars/${v.user.id}-${sha256.slice(0, 12)}.png`;
    await objectStore().put(key, png, "image/png");
    await query("update public.profiles set avatar_path = $2 where id = $1", [v.user.id, key]);
  } catch (e) {
    if (e instanceof ImageError) throw new HttpError(422, `image_${e.code}`);
    throw e;
  }
  return json({ ok: true }, { cache: "no-store" });
});
