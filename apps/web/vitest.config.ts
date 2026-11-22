import path from "node:path";
import { defineConfig } from "vitest/config";

const existingCoverageGate = {
  lines: 80,
  functions: 70,
  statements: 80,
  branches: 60,
};

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/**/*.d.ts",
        "src/lib/api-types.ts",
        "src/lib/api-bridge.ts",
      ],
      thresholds: {
        // 全來源量測的實測基準；既有四檔的嚴格門檻逐檔保留。
        lines: 30,
        statements: 30,
        functions: 26,
        branches: 31,
        "src/hooks/usePermissions.ts": existingCoverageGate,
        "src/lib/auth-cache.ts": existingCoverageGate,
        "src/lib/api-helpers.ts": existingCoverageGate,
        "src/components/ui/FormShell.tsx": existingCoverageGate,
      },
    },
  },
});
