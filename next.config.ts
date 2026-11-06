import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { contentSecurityPolicy } from "./src/lib/security/csp";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

// The Content-Security-Policy is sent in REPORT-ONLY mode (production only: the development server needs eval): browsers report what it
// would block to /api/csp-report and nothing is blocked. See src/lib/security/csp.ts and docs/SECURITY.md before enforcing it.
const cspReportOnly = process.env.NODE_ENV === "production"
  ? [{ key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy({ supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, reportUri: "/api/csp-report" }) }]
  : [];

const config: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // GitHub Codespaces serves the dev site from https://<name>-3000.app.github.dev
  allowedDevOrigins: ["*.app.github.dev"],
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["sharp", "pg"],
  // the purchase checks read the map's land data files at runtime: make sure serverless bundles carry them
  outputFileTracingIncludes: {
    "/api/checkout": ["./public/data/geo/**/*"],
    "/api/availability": ["./public/data/geo/**/*"],
    // the share images (the home page, a trace) are set in the site's pixel font, read from disk
    "/api/og/home": ["./node_modules/@fontsource/jersey-10/files/jersey-10-latin-400-normal.woff"],
    "/api/og/parcel/[code]": ["./node_modules/@fontsource/jersey-10/files/jersey-10-latin-400-normal.woff"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: [...securityHeaders, ...cspReportOnly] },
      // map reference data (land, borders, départements, cities) only changes with `npm run data:world`
      { source: "/data/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
    ];
  },
};

export default withNextIntl(config);
