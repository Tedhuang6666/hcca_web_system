import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/announcements",
          "/public",
          "/public/regulations",
          "/public/documents",
          "/meetings",
        ],
        disallow: [
          "/admin",
          "/analytics",
          "/audit-logs",
          "/auth",
          "/documents/new",
          "/documents",
          "/regulations",
          "/email",
          "/login",
          "/profile",
          "/settings",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
