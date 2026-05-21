import { ImageResponse } from "next/og";

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
          background: "#0f172a",
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
              background: "#38bdf8",
              color: "#082f49",
              fontSize: 48,
              fontWeight: 800,
            }}
          >
            自
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 38, fontWeight: 800 }}>校園自治整合系統</div>
            <div style={{ fontSize: 22, color: "#bae6fd" }}>HCCA Campus Self-Governance Platform</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 62, fontWeight: 900, lineHeight: 1.15 }}>
            學生代表大會的數位治理系統
          </div>
          <div style={{ fontSize: 28, color: "#cbd5e1", lineHeight: 1.45 }}>
            公文管理、法規查詢、問卷填答、購票與學餐服務整合平台
          </div>
        </div>
      </div>
    ),
    size,
  );
}
