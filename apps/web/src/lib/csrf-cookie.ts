const SECURE_CSRF_COOKIE = "__Host-csrf_token";
const INSECURE_CSRF_COOKIE = "csrf_token";

export function readCsrfToken(cookieHeader: string, secureContext: boolean): string | null {
  const cookieName = secureContext ? SECURE_CSRF_COOKIE : INSECURE_CSRF_COOKIE;
  const prefix = `${cookieName}=`;
  const value = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length);
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const secureContext = typeof window !== "undefined" && window.location.protocol === "https:";
  return readCsrfToken(document.cookie, secureContext);
}
