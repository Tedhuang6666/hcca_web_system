"use client";

import Script from "next/script";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { authApi } from "@/lib/api";
import { cacheCurrentUser } from "@/lib/auth-cache";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
            cancel_on_tap_outside?: boolean;
            context?: "signin" | "signup" | "use";
          }) => void;
          prompt: () => void;
          cancel: () => void;
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const BARE_PATH_PREFIXES = ["/auth", "/profile/complete", "/public", "/unsubscribe"];

function canShowOneTap(pathname: string): boolean {
  if (!GOOGLE_CLIENT_ID) return false;
  if (typeof window === "undefined") return false;
  if (localStorage.getItem("user_id")) return false;
  if (pathname === "/login") return true;
  return !BARE_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default function GoogleOneTap() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [scriptReady, setScriptReady] = useState(false);
  const nextPath = searchParams.get("next") || (pathname === "/login" ? "/" : pathname);

  const handleCredential = useCallback(
    async (response: { credential?: string }) => {
      if (!response.credential) return;

      try {
        const result = await authApi.googleOneTap(response.credential, nextPath);
        if (result.mfa_required && result.challenge) {
          const next = encodeURIComponent(result.next || nextPath || "/");
          router.replace(`/auth/mfa?challenge=${encodeURIComponent(result.challenge)}&next=${next}`);
          return;
        }
        if (result.user) {
          cacheCurrentUser(result.user);
          window.location.replace(result.next || nextPath || "/");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Google 快速登入失敗";
        toast.error(message);
      }
    },
    [nextPath, router],
  );

  useEffect(() => {
    if (!scriptReady || !canShowOneTap(pathname)) return;
    const clientId = GOOGLE_CLIENT_ID;
    if (!clientId) return;
    window.google?.accounts.id.initialize({
      client_id: clientId,
      callback: handleCredential,
      cancel_on_tap_outside: true,
      context: "signin",
    });
    let prompted = false;
    const promptTimer = window.setTimeout(() => {
      prompted = true;
      window.google?.accounts.id.prompt();
    }, 0);

    return () => {
      window.clearTimeout(promptTimer);
      if (prompted) window.google?.accounts.id.cancel();
    };
  }, [handleCredential, pathname, scriptReady]);

  if (!GOOGLE_CLIENT_ID) return null;

  return (
    <Script
      id="google-identity-services"
      src="https://accounts.google.com/gsi/client"
      strategy="afterInteractive"
      onLoad={() => setScriptReady(true)}
    />
  );
}
