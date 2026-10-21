"use client";

import { useEffect } from "react";
import { authApi } from "@/lib/api/auth";
import { loginDestination } from "@/lib/login-destination";

export default function LoginClientEffects({ nextPath }: { nextPath: string }) {
  useEffect(() => {
    try {
      if (localStorage.getItem("user_id")) {
        void authApi.me().then(() => {
          window.location.replace(loginDestination(nextPath));
        }).catch(() => {
          // 無法驗證既有 session 時保留登入選項。
        });
      }
    } catch {
      // Storage is optional; the normal login flow remains available.
    }
  }, [nextPath]);

  return null;
}
