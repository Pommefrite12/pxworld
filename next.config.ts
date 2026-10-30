import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const config: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // GitHub Codespaces serves the dev site from https://<name>-3000.app.github.dev
  allowedDevOrigins: ["*.app.github.dev"],
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["sharp", "pg"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // map reference data (land, borders, départements, cities) only changes with `npm run data:world`
      { source: "/data/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
    ];
  },
};

export default withNextIntl(config);
