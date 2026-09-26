import { BRANDING } from "@/lib/branding";

export const SOCIAL_SHARE_TITLE = BRANDING.appName;
export const SOCIAL_SITE_NAME = BRANDING.appName;
export const SOCIAL_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: `${BRANDING.appName}｜${BRANDING.orgShortName}`,
  type: "image/png",
};

export function contentOgImagePath(path: string) {
  return `/og/${path.replace(/^\/+|\/+$/g, "")}`;
}

export function socialDescription(kind: string, detail: string | null | undefined, fallback: string) {
  const value = detail?.trim();
  return value ? `${kind}：${value}` : fallback;
}
