import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/admin", "/fr/admin", "/account", "/fr/account", "/auth/", "/fr/auth/", "/checkout/", "/fr/checkout/", "/dev/"] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
