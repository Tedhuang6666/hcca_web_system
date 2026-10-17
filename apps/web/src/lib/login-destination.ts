import { safeNextPath } from "./safe-redirect";

export function confirmationReturnPath(value?: string | null): string {
  const next = safeNextPath(value);
  const pathname = new URL(next, "https://hcca.invalid").pathname;
  return pathname.replace(/\/+$/, "") === "/profile/complete" ? "/" : next;
}

export function loginDestination(
  user: { requires_class_confirmation?: boolean },
  value?: string | null,
): string {
  const next = confirmationReturnPath(value);
  return user.requires_class_confirmation
    ? `/profile/complete?${new URLSearchParams({ next })}`
    : next;
}
