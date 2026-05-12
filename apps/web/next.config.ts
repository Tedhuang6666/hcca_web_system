import type { NextConfig } from "next";
import path from "node:path";

const apiInternalUrl = process.env.API_INTERNAL_URL || "http://localhost:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: __dirname,
  turbopack: {
    root: path.resolve(__dirname),
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
    ];
  },
};

export default nextConfig;
