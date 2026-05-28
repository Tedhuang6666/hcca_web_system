export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
}

export const onRequestError = (...args: Parameters<typeof import("@sentry/nextjs").captureRequestError>) => {
  return import("@sentry/nextjs").then((Sentry) => Sentry.captureRequestError(...args));
};
