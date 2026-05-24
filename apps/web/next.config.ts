import type { NextConfig } from "next";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";

const apiInternalUrl = process.env.API_INTERNAL_URL || "http://localhost:8000";

const nextConfig: NextConfig = {
  devIndicators: false,
  output: "standalone",
  outputFileTracingRoot: __dirname,
  allowedDevOrigins: [
    "*.trycloudflare.com",
    "*.devtunnels.ms",
  ],
  turbopack: {
    root: path.resolve(__dirname),
  },
  // 圖片優化：自動轉 WebP/AVIF、長 CDN 快取（1 天）；
  // remotePatterns 允許後端 /uploads 路徑與 Cloudflare 隧道測試環境。
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 86400,
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    remotePatterns: [
      { protocol: "https", hostname: "**.trycloudflare.com" },
      { protocol: "https", hostname: "**.devtunnels.ms" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      // S3 / MinIO 後端附件（依實際 bucket domain 自行調整）
      { protocol: "https", hostname: "*.s3.amazonaws.com" },
    ],
  },
  async rewrites() {
    return [
      {
        source: "/auth/google/:path*",
        destination: `${apiInternalUrl}/auth/google/:path*`,
      },
      {
        source: "/api/:path*",
        destination: `${apiInternalUrl}/:path*`,
      },
      {
        source: "/ws/:path*",
        destination: `${apiInternalUrl}/ws/:path*`,
      },
      {
        source: "/public/meetings/:path*",
        destination: `${apiInternalUrl}/public/meetings/:path*`,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
  widenClientFileUpload: true,
});
