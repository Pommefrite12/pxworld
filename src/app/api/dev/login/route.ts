import { NextResponse } from "next/server";
import { DEV_COOKIE, signDevSession } from "@/lib/auth/session";
import { devAuthEnabled } from "@/lib/env";
import { query } from "@/lib/db/pool";

/**
 * DEVELOPMENT ONLY. Signs in without Supabase Auth so the whole product can be exercised locally.
 * Disabled (404) whenever NODE_ENV=production or a Supabase project is configured.
 */
export async function POST(req: Request) {
  if (!devAuthEnabled()) return new Response("Not found", { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { email?: string; username?: string; role?: "admin" | "moderator" };
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  const username = (body.username ?? email.split("@")[0] ?? "dev").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 20) || "dev";
  const [existing] = await query<{ id: string }>("select id from auth.users where lower(email) = $1", [email]);
  const id = existing?.id ?? (await query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('username', $2::text)) returning id", [email, username],
  ))[0]!.id;
  if (body.role === "admin" || body.role === "moderator") {
    await query("insert into public.admin_roles (user_id, role) values ($1, $2) on conflict (user_id) do update set role = excluded.role", [id, body.role]);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(DEV_COOKIE, signDevSession(id), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
  return res;
}

export async function DELETE() {
  if (!devAuthEnabled()) return new Response("Not found", { status: 404 });
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(DEV_COOKIE);
  return res;
}
