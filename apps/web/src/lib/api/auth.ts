import { ApiError, get, post } from "./core";

type AuthenticatedUser = {
  id: string;
  display_name: string;
  email: string;
  avatar_url?: string | null;
  is_superuser?: boolean;
  is_owner?: boolean;
  permissions: string[];
};

// /auth/me is used by the shell on every navigation. Keep the session check
// fresh enough to notice permission changes, while avoiding a blocking request
// for every client-side route transition.
const AUTH_ME_CACHE_TTL_MS = 30_000;
let cachedUser: AuthenticatedUser | null = null;
let cachedAt = 0;
let cachedUserId: string | null = null;
let authMePromise: Promise<AuthenticatedUser> | null = null;

function localUserId(): string | null {
  return typeof window === "undefined" ? null : window.localStorage.getItem("user_id");
}

function cachedAuthUser(): AuthenticatedUser | null {
  const userId = localUserId();
  if (!userId || !cachedUser || cachedUserId !== userId) return null;
  if (Date.now() - cachedAt >= AUTH_ME_CACHE_TTL_MS) return null;
  return cachedUser;
}

function fetchCurrentUser(): Promise<AuthenticatedUser> {
  if (authMePromise) return authMePromise;

  const nextRequest = get<AuthenticatedUser>("/auth/me")
    .then((user) => {
      cachedUser = user;
      cachedUserId = user.id;
      cachedAt = Date.now();
      return user;
    })
    .catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        cachedUser = null;
        cachedUserId = null;
        cachedAt = 0;
      }
      throw error;
    })
    .finally(() => {
      authMePromise = null;
    });

  authMePromise = nextRequest;
  return nextRequest;
}

export const authApi = {
  me: () => Promise.resolve(cachedAuthUser() ?? fetchCurrentUser()),
  googleOneTap: (credential: string, next?: string) =>
    post<{
      mfa_required: boolean;
      challenge?: string;
      next: string;
      user?: {
        id: string;
        display_name: string;
        email: string;
        avatar_url?: string | null;
        is_superuser?: boolean;
        is_owner?: boolean;
        permissions: string[];
      };
    }>("/auth/google/one-tap", { credential, next }),
};
