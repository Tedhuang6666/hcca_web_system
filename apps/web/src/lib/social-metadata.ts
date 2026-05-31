import { BRANDING } from "@/lib/branding";

export const SOCIAL_SHARE_TITLE = BRANDING.appName;
export const SOCIAL_SITE_NAME = `${BRANDING.orgShortName} ${BRANDING.acronym}`;
export const SOCIAL_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: `${BRANDING.orgShortName} Open Graph image`,
};

export function socialDescription(kind: string, detail: string | null | undefined, fallback: string) {
  const value = detail?.trim();
  return value ? `${kind}：${value}` : fallback;
}
