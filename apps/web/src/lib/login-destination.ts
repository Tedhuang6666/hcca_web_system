import { safeNextPath } from "./safe-redirect";

function loginReturnPath(value?: string | null): string {
  const next = safeNextPath(value);
  const pathname = new URL(next, "https://hcca.invalid").pathname;
  return pathname.replace(/\/+$/, "") === "/profile/complete" ? "/" : next;
}

export function loginDestination(value?: string | null): string {
  return loginReturnPath(value);
}
