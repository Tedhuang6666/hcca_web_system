// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

import { getServerSentryDsn } from "./src/lib/sentry-config";

const dsn = getServerSentryDsn();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_ENVIRONMENT || process.env.NODE_ENV,

    // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || "0.05"),

    // Enable logs to be sent to Sentry
    enableLogs: true,

    // 不主動上傳使用者 PII（IP / headers / 使用者資料）— 學生平台隱私考量
    sendDefaultPii: false,
  });
}
