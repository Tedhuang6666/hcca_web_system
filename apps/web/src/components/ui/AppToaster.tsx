"use client";

import { Toaster } from "sonner";

/** 全站唯一的 toast 容器：公開區、登入區、管理區共用，避免某些路由群組的提示訊息不顯示。 */
export default function AppToaster() {
  return (
    <Toaster
      position="top-right"
      richColors
      toastOptions={{
        style: {
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-strong)",
          color: "var(--text-primary)",
          fontSize: "0.875rem",
        },
      }}
    />
  );
}
