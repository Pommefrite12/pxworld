"use client";

import { createBrowserClient } from "@supabase/ssr";

export const supabaseEnabled = () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
export const devAuthUi = () => process.env.NEXT_PUBLIC_DEV_AUTH === "true" && !supabaseEnabled();

let client: ReturnType<typeof createBrowserClient> | undefined;
export function browserSupabase() {
  return (client ??= createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!));
}

export async function signOut() {
  if (supabaseEnabled()) await browserSupabase().auth.signOut();
  else await fetch("/api/dev/login", { method: "DELETE" });
}

/** Only same-site relative paths are accepted as post-login destinations (prevents open redirects). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}
