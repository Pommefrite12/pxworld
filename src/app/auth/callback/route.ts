import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/auth/session";
import { supabaseConfigured } from "@/lib/env";

function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/";
}

const OTP_TYPES = ["email", "magiclink", "signup", "recovery"] as const;
type OtpType = (typeof OTP_TYPES)[number];

/**
 * OAuth / email-confirmation / password-recovery / sign-in-link landing: turns the one-time proof in the URL into a
 * session cookie. Two shapes exist:
 *  - `code` (PKCE: Google, and links opened in the browser that asked for them);
 *  - `token_hash` + `type` (the e-mail templates of docs/LAUNCH_CHECKLIST.md): works on any device, which matters for
 *    the link a buyer without an account receives after paying — they may open it on their phone.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as OtpType | null;
  if (supabaseConfigured() && code) {
    const { error } = await (await supabaseServer()).auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  } else if (supabaseConfigured() && tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await (await supabaseServer()).auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL("/auth/sign-in?error=callback", url.origin));
}
