export function isValidSentryDsn(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    const projectId = url.pathname.split("/").filter(Boolean).at(-1);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      Boolean(url.username) &&
      Boolean(projectId && /^\d+$/.test(projectId))
    );
  } catch {
    return false;
  }
}

export function getPublicSentryDsn(): string | undefined {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  return isValidSentryDsn(dsn) ? dsn : undefined;
}

export function getServerSentryDsn(): string | undefined {
  const serverDsn = process.env.SENTRY_DSN?.trim();
  if (isValidSentryDsn(serverDsn)) {
    return serverDsn;
  }
  return getPublicSentryDsn();
}
