import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SOCIAL_IMAGE, SOCIAL_SHARE_TITLE, SOCIAL_SITE_NAME } from "@/lib/social-metadata";

export const metadata: Metadata = {
  title: SOCIAL_SHARE_TITLE,
  description: "校園自治平台陳情案件進度查詢。",
  openGraph: {
    title: SOCIAL_SHARE_TITLE,
    description: "校園自治平台陳情案件進度查詢。",
    type: "website",
    siteName: SOCIAL_SITE_NAME,
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: SOCIAL_SHARE_TITLE,
    description: "校園自治平台陳情案件進度查詢。",
    images: [SOCIAL_IMAGE.url],
  },
};

export default function PetitionDetailLayout({ children }: { children: ReactNode }) {
  return children;
}
