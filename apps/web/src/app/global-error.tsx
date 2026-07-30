"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

import { reportClientError } from "@/lib/client-error-reporter";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
    void reportClientError({
      scope: "global-error",
      message: error.message || "Global error",
      stack: error.stack,
    });
  }, [error]);

  return (
    <html lang="zh-TW">
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
