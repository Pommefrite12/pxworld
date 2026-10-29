import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import createIntlProxy from "next-intl/middleware";
import { createServerClient } from "@supabase/ssr";
import { routing } from "@/i18n/routing";

const intl = createIntlProxy(routing);

/**
 * 1. Locale negotiation / prefixing (next-intl).
 * 2. Supabase Auth: refresh the session cookie on every navigation so Server Components see a valid session.
 */
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const response = pathname.startsWith("/api/") || pathname.startsWith("/auth/callback") ? NextResponse.next({ request }) : intl(request);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const hasSession = request.cookies.getAll().some((c) => c.name.startsWith("sb-"));
  const publicApi = /^\/api\/(stripe|cron|map|assets|avatar|og|stats|availability|parcels\/[0-9a-f]{10}$)/.test(pathname);
  if (url && anon && hasSession && !publicApi) {
    const supabase = createServerClient(url, anon, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value, options } of list) {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          }
        },
      },
    });
    await supabase.auth.getUser(); // validates the JWT and rotates the refresh token when needed
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml|data/|.*\\.(?:png|jpg|jpeg|webp|svg|ico|json|txt|woff2?)$).*)"],
};
