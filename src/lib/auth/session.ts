import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { devAuthEnabled, env, supabaseConfigured } from "@/lib/env";
import { queryOne } from "@/lib/db/pool";
import { HttpError } from "@/lib/http/errors";

export const DEV_COOKIE = "px_dev_session";

export interface SessionUser {
  id: string;
  email: string | null;
}

export interface Profile {
  id: string;
  username: string;
  avatar_path: string | null;
  country: string | null;
  bio: string | null;
  status: "active" | "suspended";
  created_at: Date;
}

export interface Viewer {
  user: SessionUser;
  profile: Profile;
  staffRole: "moderator" | "admin" | null;
}

export function signDevSession(userId: string): string {
  const sig = createHmac("sha256", env().DEV_AUTH_SECRET).update(userId).digest("hex");
  return `${userId}.${sig}`;
}

function verifyDevSession(value: string | undefined): string | null {
  if (!value) return null;
  const [id, sig] = value.split(".");
  if (!id || !sig) return null;
  const expected = createHmac("sha256", env().DEV_AUTH_SECRET).update(id).digest("hex");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

/** Supabase server client bound to the request cookies (used to read/refresh the session). */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(env().NEXT_PUBLIC_SUPABASE_URL!, env().NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          /* called from a Server Component: the proxy refreshes the cookies instead */
        }
      },
    },
  });
}

/** The authenticated user for this request, verified server-side (never trust client-provided identity). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  if (supabaseConfigured()) {
    const { data, error } = await (await supabaseServer()).auth.getUser();
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  }
  if (devAuthEnabled()) {
    const id = verifyDevSession((await cookies()).get(DEV_COOKIE)?.value);
    if (!id) return null;
    const row = await queryOne<{ id: string; email: string | null }>("select id, email from auth.users where id = $1", [id]);
    return row ? { id: row.id, email: row.email } : null;
  }
  return null;
});

export const getViewer = cache(async (): Promise<Viewer | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const profile = await queryOne<Profile>(
    `select id, username, avatar_path, country, bio, status, created_at from public.profiles where id = $1 and deleted_at is null`,
    [user.id],
  );
  if (!profile) return null;
  const role = await queryOne<{ role: "moderator" | "admin" }>("select role from public.admin_roles where user_id = $1", [user.id]);
  return { user, profile, staffRole: role?.role ?? null };
});

export async function requireViewer(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) throw new HttpError(401, "unauthenticated");
  return v;
}

export async function requireActiveViewer(): Promise<Viewer> {
  const v = await requireViewer();
  if (v.profile.status !== "active") throw new HttpError(403, "px_account_suspended");
  return v;
}

/** Staff check, always re-read from the database (roles live in admin_roles, never in a client-editable field). */
export async function requireStaff(min: "moderator" | "admin" = "moderator"): Promise<Viewer & { staffRole: "moderator" | "admin" }> {
  const v = await requireViewer();
  if (!v.staffRole || (min === "admin" && v.staffRole !== "admin")) throw new HttpError(403, "forbidden");
  return v as Viewer & { staffRole: "moderator" | "admin" };
}
