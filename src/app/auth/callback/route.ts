import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/auth/session";
import { supabaseConfigured } from "@/lib/env";

function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/";
}

/** OAuth / email-confirmation / password-recovery landing: exchanges the one-time code for a session cookie. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  if (supabaseConfigured() && code) {
    const { error } = await (await supabaseServer()).auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL("/auth/sign-in?error=callback", url.origin));
}
