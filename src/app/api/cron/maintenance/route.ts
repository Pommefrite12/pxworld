import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { runMaintenance } from "@/lib/stripe/reconcile";

export const maxDuration = 60;

/** Vercel Cron (see vercel.json): expire reservations, recover late payments, retry failed refunds. */
export async function GET(req: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return new Response("cron not configured", { status: 503 });
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return new Response("unauthorized", { status: 401 });
  return Response.json(await runMaintenance(), { headers: { "Cache-Control": "no-store" } });
}
