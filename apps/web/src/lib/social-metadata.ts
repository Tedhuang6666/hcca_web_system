export const SOCIAL_SHARE_TITLE = "校園自治整合系統";
export const SOCIAL_SITE_NAME = "HCCA 校園自治整合系統";
export const SOCIAL_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: SOCIAL_SHARE_TITLE,
};

export function socialDescription(kind: string, detail: string | null | undefined, fallback: string) {
  const value = detail?.trim();
  return value ? `${kind}：${value}` : fallback;
}
