import { get, post } from "./core";

export const authApi = {
  me: () => get<{
    id: string;
    display_name: string;
    email: string;
    avatar_url?: string | null;
    is_superuser?: boolean;
    is_owner?: boolean;
    permissions: string[];
  }>("/auth/me"),
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
