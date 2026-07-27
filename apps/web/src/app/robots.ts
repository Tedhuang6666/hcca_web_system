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
          "/regulations",
          "/regulations/",
          "/documents",
          "/documents/",
          "/meetings",
        ],
        disallow: [
          "/admin",
          "/analytics",
          "/audit-logs",
          "/auth",
          "/documents/new",
          "/documents/*/edit",
          "/public/regulations",
          "/public/documents",
          "/regulations/new",
          "/regulations/pending",
          "/regulations/archived",
          "/regulations/*/edit",
          "/regulations/*/amendment",
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
