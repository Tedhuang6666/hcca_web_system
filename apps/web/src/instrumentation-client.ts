import { getPublicSentryDsn } from "./lib/sentry-config";

const dsn = getPublicSentryDsn();
type SentryClient = typeof import("@sentry/nextjs");
type RouterTransitionArgs = Parameters<SentryClient["captureRouterTransitionStart"]>;

let sentryPromise: Promise<SentryClient> | null = null;

function loadSentry(): Promise<SentryClient> {
  if (!sentryPromise) {
    sentryPromise = import("@sentry/nextjs").then((Sentry) => {
      Sentry.init({
        dsn,
        environment: process.env.NEXT_PUBLIC_ENVIRONMENT || process.env.NODE_ENV,
        tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || "0.05"),
        sendDefaultPii: false,
      });
      return Sentry;
    });
  }
  return sentryPromise;
}

if (dsn) {
  const load = () => void loadSentry();
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(load, { timeout: 5_000 });
  } else {
    window.setTimeout(load, 3_000);
  }
}

export function onRouterTransitionStart(...args: RouterTransitionArgs): void {
  if (!dsn) return;
  void loadSentry().then((Sentry) => Sentry.captureRouterTransitionStart(...args));
}
