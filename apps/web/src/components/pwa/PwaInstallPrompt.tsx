"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, Download, X } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export default function PwaInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [isTucked, setIsTucked] = useState(false);

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

  useEffect(() => {
    if (!installPrompt || dismissed) return;

    setIsTucked(false);
    const tuckTimer = window.setTimeout(() => setIsTucked(true), 4200);
    return () => window.clearTimeout(tuckTimer);
  }, [installPrompt, dismissed]);

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
      className={[
        "fixed right-4 bottom-20 z-[120] flex max-w-[calc(100vw-2rem)] items-center gap-2",
        "overflow-hidden rounded-lg px-2 py-2 transition-opacity duration-700 ease-out",
        "md:bottom-5",
        isTucked ? "opacity-80" : "opacity-100",
      ].join(" ")}
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-strong)",
        boxShadow: "var(--shadow-xl)",
        color: "var(--text-primary)",
      }}
      role="dialog"
      aria-label="安裝新竹高中班聯會數位整合系統">
      <button
        type="button"
        onClick={() => setIsTucked((current) => !current)}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition hover:bg-black/5 dark:hover:bg-white/10"
        style={{ color: "var(--text-muted)" }}
        aria-label={isTucked ? "展開安裝提示" : "收起安裝提示"}>
        <ChevronLeft
          size={15}
          aria-hidden={true}
          className={isTucked ? "transition-transform" : "rotate-180 transition-transform"}
        />
      </button>
      <button
        type="button"
        onClick={install}
        disabled={isTucked}
        tabIndex={isTucked ? -1 : 0}
        aria-hidden={isTucked}
        className={[
          "inline-flex h-9 min-w-0 items-center gap-2 overflow-hidden rounded-md text-sm",
          "font-medium whitespace-nowrap transition-[max-width,opacity,padding] duration-700 ease-out",
          isTucked ? "pointer-events-none max-w-0 px-0 opacity-0" : "max-w-[22rem] px-3 opacity-100",
        ].join(" ")}
        style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
        <Download size={15} aria-hidden={true} />
        安裝新竹高中班聯會數位整合系統
      </button>
      <button
        type="button"
        onClick={dismiss}
        disabled={isTucked}
        tabIndex={isTucked ? -1 : 0}
        aria-hidden={isTucked}
        className={[
          "inline-flex h-9 shrink-0 items-center justify-center rounded-md transition-[width,opacity]",
          "duration-700 ease-out hover:bg-black/5 dark:hover:bg-white/10",
          isTucked ? "pointer-events-none w-0 opacity-0" : "w-9 opacity-100",
        ].join(" ")}
        style={{ color: "var(--text-muted)" }}
        aria-label="關閉安裝提示">
        <X size={15} aria-hidden={true} />
      </button>
    </div>
  );
}
