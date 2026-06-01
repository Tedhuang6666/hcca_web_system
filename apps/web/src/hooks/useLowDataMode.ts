"use client";

import { useEffect, useState } from "react";
import { prefersReducedNetworkUsage } from "@/lib/data-saver";

export function useLowDataMode() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const sync = () => setEnabled(prefersReducedNetworkUsage());
    sync();
    window.addEventListener("hcca:low-data-mode-change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("hcca:low-data-mode-change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return enabled;
}
