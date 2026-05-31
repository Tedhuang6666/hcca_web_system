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
      // 本機後端（dev / docker compose）
      { protocol: "http", hostname: "localhost" },
      { protocol: "http", hostname: "127.0.0.1" },
      { protocol: "http", hostname: "0.0.0.0" },
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
        source: "/discord/:path*",
        destination: `${apiInternalUrl}/discord/:path*`,
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

// Bundle analyzer wrapper：跑 `npm run analyze` 時自動開啟視覺化報告
// 條件 require 避免 prod build 載入 dev-only 套件
let configWithAnalyzer: NextConfig = nextConfig;
if (process.env.ANALYZE === "true") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const withBundleAnalyzer = require("@next/bundle-analyzer")({
    enabled: true,
    openAnalyzer: false,
  });
  configWithAnalyzer = withBundleAnalyzer(nextConfig);
}

export default withSentryConfig(configWithAnalyzer, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "92b4e60ed3e7",

  project: "javascript-nextjs",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
