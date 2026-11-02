import { TOKEN_RE, paint, parsePaintBody } from "@/lib/collab";
import { HttpError, json } from "@/lib/http/errors";
import { assertSameOrigin, route } from "@/lib/http/route";
import { LIMITS, enforceKeyLimit, enforceRateLimit } from "@/lib/rate-limit";

/**
 * Paints pixels on a shared parcel. No account: the link is the permission. Everything else is bounded — a request holds at
 * most 2 000 pixels, each address and each link has a budget per minute, and the database refuses anything outside the
 * parcel — so a public link cannot be turned against the site.
 */
export const POST = route(async (req, ctx: { params: Promise<{ token: string }> }) => {
  assertSameOrigin(req);
  await enforceRateLimit(req, LIMITS.drawWrite);
  const { token } = await ctx.params;
  if (!TOKEN_RE.test(token)) throw new HttpError(404, "collab_closed");
  await enforceKeyLimit(`${LIMITS.drawWriteLink.name}:link:${token}`, LIMITS.drawWriteLink);
  if (Number(req.headers.get("content-length") ?? 0) > 64 * 1024) throw new HttpError(413, "too_large");
  const body = await req.json().catch(() => null);
  const version = await paint(token, parsePaintBody(body));
  return json({ version }, { cache: "no-store" });
});
