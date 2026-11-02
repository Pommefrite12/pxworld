import "server-only";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { devAuthEnabled, env, siteUrl, supabaseConfigured } from "@/lib/env";
import { query, queryOne } from "@/lib/db/pool";
import { HttpError } from "@/lib/http/errors";
import { LIMITS, enforceRateLimit } from "@/lib/rate-limit";

/**
 * Buying without an account.
 *
 * The buyer types an e-mail address, nothing else. Behind the scenes that address gets a *guest account*: a real user (so
 * every rule that hangs on an owner — one parcel, one owner, moderation, audit — stays exactly as it is), with no password
 * and, above all, NO SESSION: typing someone's address proves nothing, so nobody is signed in by it. The buyer follows
 * their order with a signed link (see ./orderToken) and manages the parcel afterwards by signing in with the link we
 * e-mail them once they have paid (proof that they own the address).
 *
 * Guest accounts are flagged in `auth.users.raw_user_meta_data.guest`. An address that already belongs to a regular
 * account (password, Google…) is never used this way: that person must sign in, otherwise a stranger could attach
 * purchases and content to somebody else's profile.
 */
const emailSchema = z.email().max(254);

/** Lower-cased, trimmed address, or null when it is not a plausible e-mail. */
export function normalizeEmail(value: unknown): string | null {
  const parsed = emailSchema.safeParse(typeof value === "string" ? value.trim().toLowerCase() : "");
  return parsed.success ? parsed.data : null;
}

export interface Buyer { id: string; email: string }

interface UserRow { id: string; guest: boolean }
const findUser = (email: string) =>
  queryOne<UserRow>("select id, coalesce(raw_user_meta_data ->> 'guest', 'false') = 'true' as guest from auth.users where lower(email) = $1 limit 1", [email]);

/** Neutral public name: the e-mail address (or its local part) must never end up on a public parcel. */
const guestUsername = () => `pixel-${randomBytes(3).toString("hex")}`;

async function createGuest(email: string): Promise<void> {
  const meta = { username: guestUsername(), guest: true };
  if (supabaseConfigured()) {
    const key = env().SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new HttpError(503, "guest_checkout_unavailable");
    const admin = createClient(env().NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } });
    // not confirmed: the address becomes verified only when its owner uses the link we send after payment
    const { error } = await admin.auth.admin.createUser({ email, email_confirm: false, user_metadata: meta });
    if (error && !/already|exists|registered/i.test(error.message)) throw new HttpError(502, "guest_account_failed", error.message);
    return;
  }
  if (devAuthEnabled()) {
    await query("insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb)", [email, JSON.stringify(meta)]);
    return;
  }
  throw new HttpError(503, "guest_checkout_unavailable");
}

/**
 * The buyer for this address: an existing guest account, or a new one. Throws 409 `account_exists` for a regular account,
 * 403 `px_account_suspended` for a suspended one.
 */
export async function ensureGuestBuyer(req: Request, email: string): Promise<Buyer> {
  let user = await findUser(email);
  if (!user) {
    await enforceRateLimit(req, LIMITS.guestAccount); // only creations count: returning buyers are not slowed down
    await createGuest(email);
    user = await findUser(email); // also covers two requests racing to create the same address
  }
  if (!user) throw new HttpError(500, "guest_account_failed");
  if (!user.guest) throw new HttpError(409, "account_exists");
  const profile = await queryOne<{ status: string }>("select status from public.profiles where id = $1 and deleted_at is null", [user.id]);
  if (!profile) throw new HttpError(403, "px_no_profile");
  if (profile.status !== "active") throw new HttpError(403, "px_account_suspended");
  return { id: user.id, email };
}

/** `ab•••@ex•••.com`: enough for the buyer to recognise their address, not to read it out of a URL or a log. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain, tld = dot > 0 ? domain.slice(dot) : "";
  return `${local.slice(0, 2)}•••@${host.slice(0, 2)}•••${tld}`;
}

/** The address of a guest buyer (null for a regular account). */
export async function guestEmailOfOrder(orderId: string): Promise<string | null> {
  const row = await queryOne<{ email: string | null }>(
    `select u.email from public.orders o join auth.users u on u.id = o.user_id
      where o.id = $1 and coalesce(u.raw_user_meta_data ->> 'guest', 'false') = 'true'`, [orderId]);
  return row?.email ?? null;
}

/**
 * After a guest has paid: e-mail them a one-time sign-in link, which is how they manage and edit their parcel. Sent by
 * Supabase Auth (its templates and SMTP), so it needs no mail provider of our own. Best effort: the sign-in page can
 * always send the same link again, so a failure here must never undo or retry a payment.
 */
export async function sendManageLink(orderId: string): Promise<void> {
  if (!supabaseConfigured()) return; // development: there is no mailbox; the success page offers a dev sign-in instead
  const email = await guestEmailOfOrder(orderId);
  if (!email) return;
  try {
    const sb = createClient(env().NEXT_PUBLIC_SUPABASE_URL!, env().NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent("/account/parcels")}` },
    });
    if (error) throw error;
  } catch (e) {
    console.error("could not send the sign-in link for order", orderId, (e as Error).message);
  }
}
