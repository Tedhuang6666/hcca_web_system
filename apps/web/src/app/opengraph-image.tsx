import { ImageResponse } from "next/og";

import { BRANDING } from "@/lib/branding";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: BRANDING.themeColor,
          color: "#f8fafc",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
          }}
        >
          <div
            style={{
              width: 104,
              height: 104,
              borderRadius: 26,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: BRANDING.accentColor,
              color: "#102033",
              fontSize: 48,
              fontWeight: 800,
            }}
          >
            {BRANDING.acronym}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 38, fontWeight: 800 }}>{BRANDING.orgShortName}</div>
            <div style={{ fontSize: 22, color: "#d9e8f7" }}>{BRANDING.englishName}</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 62, fontWeight: 900, lineHeight: 1.15 }}>
            {BRANDING.slogan}
          </div>
          <div style={{ fontSize: 28, color: "#cbd5e1", lineHeight: 1.45 }}>
            {`${BRANDING.schoolName}公文、法規、公告與校園自治服務整合平台`}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
