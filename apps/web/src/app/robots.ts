import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/seo";
import { robotsAllowPaths, robotsDisallowPaths } from "@/lib/route-access";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: [...robotsAllowPaths()],
        disallow: [...robotsDisallowPaths()],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
