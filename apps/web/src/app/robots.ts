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
          "/documents",
          "/regulations",
          "/meetings",
        ],
        disallow: [
          "/admin",
          "/analytics",
          "/audit-logs",
          "/auth",
          "/documents/new",
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
