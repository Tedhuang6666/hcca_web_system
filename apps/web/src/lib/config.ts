export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api";

export const API_INTERNAL_BASE =
  process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export function serverApiUrl(path: string): string {
  return `${API_INTERNAL_BASE}${path}`;
}
