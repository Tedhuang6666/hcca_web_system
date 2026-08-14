import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { BRANDING } from "@/lib/branding";

export const CONTENT_OG_SIZE = {
  width: 1200,
  height: 630,
} as const;

export const CONTENT_OG_CONTENT_TYPE = "image/png" as const;

type ContentOgImageInput = {
  title: string;
  category: string;
  date?: string | null;
};

function trimTitle(value: string) {
  const title = value.trim() || "公開資訊";
  return title.length > 64 ? `${title.slice(0, 63)}…` : title;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

async function emblemSource() {
  const data = await readFile(join(process.cwd(), "public/brand/hcca-emblem.png"), "base64");
  return `data:image/png;base64,${data}`;
}

export async function renderContentOgImage({ title, category, date }: ContentOgImageInput) {
  const emblemSrc = await emblemSource();
  const publishedDate = formatDate(date);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 68,
          background: BRANDING.themeColor,
          color: "#f8fafc",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                width: 92,
                height: 92,
                borderRadius: 46,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#f8fafc",
                overflow: "hidden",
              }}
            >
              {/* ImageResponse requires a plain img element for embedded assets. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={emblemSrc}
                alt={BRANDING.emblemAlt}
                width={82}
                height={82}
                style={{ objectFit: "contain" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ display: "flex", fontSize: 32, fontWeight: 800 }}>
                {BRANDING.orgShortName}
              </div>
              <div style={{ display: "flex", fontSize: 20, color: "#d9e8f7" }}>
                {BRANDING.acronym} · 校園自治
              </div>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              padding: "12px 20px",
              borderRadius: 999,
              color: BRANDING.themeColor,
              background: BRANDING.accentColor,
              fontSize: 24,
              fontWeight: 800,
            }}
          >
            {category}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 1040 }}>
          <div
            style={{
              display: "flex",
              fontSize: 56,
              fontWeight: 900,
              lineHeight: 1.18,
              maxHeight: 200,
              overflow: "hidden",
            }}
          >
            {trimTitle(title)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 18, color: "#cbd5e1", fontSize: 26 }}>
            <span>{BRANDING.appName}</span>
            {publishedDate && <span>· {publishedDate}</span>}
          </div>
        </div>
      </div>
    ),
    CONTENT_OG_SIZE,
  );
}
