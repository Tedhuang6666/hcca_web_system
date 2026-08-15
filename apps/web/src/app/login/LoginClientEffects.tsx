"use client";

import { useEffect } from "react";

export default function LoginClientEffects({ nextPath }: { nextPath: string }) {
  useEffect(() => {
    try {
      if (localStorage.getItem("user_id")) {
        window.location.replace(nextPath);
      }
    } catch {
      // Storage is optional; the normal login flow remains available.
    }
  }, [nextPath]);

  return null;
}
