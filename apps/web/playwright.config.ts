import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const storageState = process.env.E2E_AUTH_STORAGE;
const anonymousState = { cookies: [], origins: [] };

if (process.env.CI && (!storageState || !existsSync(storageState))) {
  throw new Error("CI requires E2E_AUTH_STORAGE to point to a generated authenticated session.");
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 2,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...(storageState ? { storageState } : {}),
  },
  projects: [
    {
      name: "public-chromium",
      testMatch: /public\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], storageState: anonymousState },
    },
    {
      name: "mobile-chromium",
      testMatch: /public\.spec\.ts$/,
      use: { ...devices["Pixel 7"], storageState: anonymousState },
    },
    {
      name: "authenticated-chromium",
      testMatch: /(?:authenticated|document_approval|ticket_purchase)\.spec\.ts$/,
      workers: 1,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "accessibility-chromium",
      testMatch: /a11y\.spec\.ts$/,
      workers: 1,
      use: { ...devices["Desktop Chrome"], storageState: anonymousState },
    },
  ],
  webServer: {
    command: process.env.E2E_WEB_SERVER_COMMAND || "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
