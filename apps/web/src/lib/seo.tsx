import type { Metadata } from "next";

import { BRAND_TITLE, BRANDING } from "@/lib/branding";
import { SOCIAL_IMAGE, SOCIAL_SITE_NAME } from "@/lib/social-metadata";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

function resolveSiteUrl(configuredUrl: string | undefined): string {
  const productionFallback = `https://${BRANDING.domain}`;
  const developmentFallback = "http://localhost:3000";
  const fallback = process.env.NODE_ENV === "production" ? productionFallback : developmentFallback;
  const value = configuredUrl?.trim();
  if (!value) return fallback;

  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return fallback;
    if (process.env.NODE_ENV === "production" && LOCAL_HOSTNAMES.has(url.hostname)) {
      return productionFallback;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

export const SITE_URL = resolveSiteUrl(
  process.env.NEXT_PUBLIC_SITE_URL || process.env.FRONTEND_BASE_URL,
);

export const SITE_BRAND = BRAND_TITLE;
export const DEFAULT_SEO_DESCRIPTION = BRANDING.description;

export function absoluteUrl(path: string) {
  return new URL(path, SITE_URL).toString();
}

export function stripMarkdown(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function excerpt(value: string | null | undefined, fallback: string, max = 140) {
  const text = stripMarkdown(value ?? "");
  if (!text) return fallback;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function pageMetadata({
  title,
  description,
  path,
  type = "article",
  imagePath = SOCIAL_IMAGE.url,
}: {
  title: string;
  description: string;
  path: string;
  type?: "article" | "website";
  imagePath?: string;
}): Metadata {
  const canonical = absoluteUrl(path);
  const image = absoluteUrl(imagePath);
  const fullTitle = `${title}｜${SITE_BRAND}`;

  return {
    title: { absolute: fullTitle },
    description,
    alternates: { canonical },
    openGraph: {
      title: fullTitle,
      description,
      url: canonical,
      type,
      siteName: SOCIAL_SITE_NAME,
      locale: "zh_TW",
      images: [{ url: image, width: SOCIAL_IMAGE.width, height: SOCIAL_IMAGE.height, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [{ url: image, alt: title }],
    },
  };
}

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
