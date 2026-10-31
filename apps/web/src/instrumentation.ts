import * as Sentry from "@sentry/nextjs";
import type { Instrumentation } from "next";
import { reportServerError } from "./lib/server-error-reporter";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
    const { initOpenTelemetry } = await import("./lib/observability");
    await initOpenTelemetry();
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  await Promise.allSettled([
    Promise.resolve().then(() => Sentry.captureRequestError(...args)),
    reportServerError(...args),
  ]);
};
