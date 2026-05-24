"use client";
import { useEffect, useRef, type ReactNode } from "react";

interface FormShellProps {
  children: ReactNode;
  /** 底部固定動作列（送出 / 取消按鈕等）。 */
  footer?: ReactNode;
  /**
   * 手機鍵盤彈起時是否隱藏 footer（避免擠版面）。預設 false（footer 仍可見以便送出）。
   */
  hideFooterOnKeyboard?: boolean;
  /** 自訂額外 className 加到外層。 */
  className?: string;
}

/**
 * 長表單外殼：
 * - 提供 sticky bottom action bar，避免送出按鈕滑出視口
 * - 監聽輸入欄聚焦時自動 scrollIntoView，避免被鍵盤遮擋
 * - 自動加 safe-area-inset-bottom 處理 iPhone 瀏海/底部
 *
 * 用法：
 *   <FormShell footer={<button className="btn btn-primary">送出</button>}>
 *     <form>...</form>
 *   </FormShell>
 */
export default function FormShell({
  children,
  footer,
  hideFooterOnKeyboard = false,
  className,
}: FormShellProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 輸入欄聚焦時自動捲入視口（避免被鍵盤遮擋）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handler = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (!["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      // 延遲一個 frame 讓鍵盤彈起後再 scroll
      requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    };
    container.addEventListener("focusin", handler);
    return () => container.removeEventListener("focusin", handler);
  }, []);

  // 鍵盤彈起偵測（用於可選的 footer 隱藏）
  useEffect(() => {
    if (!hideFooterOnKeyboard) return;
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const handler = () => {
      const ratio = vv.height / window.innerHeight;
      const container = containerRef.current;
      if (!container) return;
      container.dataset.keyboardOpen = ratio < 0.75 ? "true" : "false";
    };
    vv.addEventListener("resize", handler);
    return () => vv.removeEventListener("resize", handler);
  }, [hideFooterOnKeyboard]);

  return (
    <div
      ref={containerRef}
      className={`flex flex-col min-h-full ${className ?? ""}`}
      data-keyboard-open="false">
      <div className={`flex-1 ${footer ? "pb-24 md:pb-6" : ""}`}>
        {children}
      </div>

      {footer && (
        <div
          className={`fixed bottom-0 left-0 right-0 z-20 md:relative md:bottom-auto md:left-auto md:right-auto md:z-auto px-4 py-3 md:px-0 md:py-4 flex flex-wrap items-center justify-end gap-2 ${
            hideFooterOnKeyboard ? "data-[keyboard-open=true]:hidden" : ""
          }`}
          style={{
            background: "var(--bg-elevated)",
            borderTop: "1px solid var(--border)",
            paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))",
            boxShadow: "0 -2px 8px rgba(0,0,0,0.04)",
          }}>
          {footer}
        </div>
      )}
    </div>
  );
}
