import { apiUrl } from "./config";

const MAX_MESSAGE_LENGTH = 1000;
const MAX_STACK_LENGTH = 6000;
const MAX_SCOPE_LENGTH = 100;
const MAX_PATH_LENGTH = 500;

export interface ClientErrorInput {
  message: string;
  stack?: string;
  scope?: string;
  pathname?: string;
}

function limit(value: string | undefined, length: number): string {
  return (value ?? "").slice(0, length);
}

function csrfHeader(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const token = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("csrf_token="))
    ?.slice("csrf_token=".length);
  return token ? { "X-CSRF-Token": decodeURIComponent(token) } : {};
}

/** 將瀏覽器錯誤送到後端；回報失敗絕不能再製造一個未處理 rejection。 */
export function reportClientError(input: ClientErrorInput): void {
  if (typeof window === "undefined") return;

  const payload = JSON.stringify({
    message: limit(input.message || "Unknown client error", MAX_MESSAGE_LENGTH),
    stack: limit(input.stack, MAX_STACK_LENGTH),
    scope: limit(input.scope || "runtime", MAX_SCOPE_LENGTH),
    pathname: limit(input.pathname || window.location.pathname, MAX_PATH_LENGTH),
  });

  void fetch(apiUrl("/system/client-errors"), {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: {
      "content-type": "application/json",
      ...csrfHeader(),
    },
    body: payload,
  }).catch(() => undefined);
}

function errorDetails(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) {
    return { message: value.message || value.name, stack: value.stack };
  }
  if (typeof value === "string") return { message: value };
  try {
    return { message: JSON.stringify(value) };
  } catch {
    return { message: String(value) };
  }
}

/** 安裝 window error / unhandledrejection 入口，涵蓋未經 React boundary 的錯誤。 */
export function installGlobalClientErrorReporter(): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onError = (event: ErrorEvent) => {
    const target = event.target;
    const details = errorDetails(event.error ?? event.message);
    const resource = target instanceof Element;
    reportClientError({
      ...details,
      scope: resource ? `resource:${target.tagName.toLowerCase()}` : "window.error",
    });
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const details = errorDetails(event.reason);
    reportClientError({ ...details, scope: "unhandledrejection" });
  };

  window.addEventListener("error", onError, true);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  return () => {
    window.removeEventListener("error", onError, true);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}
