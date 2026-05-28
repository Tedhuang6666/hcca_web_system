"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export default function PwaInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // PWA install remains browser-controlled if registration is unavailable.
    });
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setDismissed(localStorage.getItem("hcca-pwa-install-dismissed") === "true");
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      localStorage.setItem("hcca-pwa-install-dismissed", "true");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  if (!installPrompt || dismissed) return null;

  const install = async () => {
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const dismiss = () => {
    localStorage.setItem("hcca-pwa-install-dismissed", "true");
    setDismissed(true);
  };

  return (
    <div
      className="fixed bottom-20 right-4 z-[120] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-lg px-3 py-2 md:bottom-5"
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-strong)",
        boxShadow: "var(--shadow-xl)",
        color: "var(--text-primary)",
      }}
      role="dialog"
      aria-label="安裝 HCCA">
      <button
        type="button"
        onClick={install}
        className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium"
        style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
        <Download size={15} aria-hidden={true} />
        安裝 HCCA
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md"
        style={{ color: "var(--text-muted)" }}
        aria-label="關閉安裝提示">
        <X size={15} aria-hidden={true} />
      </button>
    </div>
  );
}
