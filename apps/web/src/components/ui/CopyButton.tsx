"use client";

import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { Copy, Link } from "lucide-react";
import { toast } from "sonner";

import { useCopyFeedback } from "@/hooks/useCopyFeedback";

type CopyButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "value" | "children"
> & {
  /** 要複製的文字；傳函式時在點擊當下才取值（例如目前網址）。 */
  value: string | (() => string);
  /** 按鈕上的文字；省略時只顯示圖示。 */
  label?: ReactNode;
  copiedLabel?: ReactNode;
  failedLabel?: ReactNode;
  icon?: "copy" | "link" | "none";
  iconSize?: number;
  /** 成功時給螢幕閱讀器的說明。 */
  announcement?: string;
  /** 失敗且未提供 onCopyError 時，以提示告訴使用者如何手動複製。 */
  failureHint?: string;
  onCopied?: () => void;
  /** 失敗時改由呼叫端處理（例如選取輸入框讓人手動複製），不再顯示預設提示。 */
  onCopyError?: () => void;
};

const CHECK_PATH = "M20 6 9 17l-5-5";
const CROSS_PATH = "M18 6 6 18M6 6l12 12";

/**
 * 全站唯一的複製按鈕。結果顯示在按下的按鈕上：原圖示收起、勾號沿筆畫畫出、
 * 文字像翻牌一樣往上換成「已複製」，停留後再翻回來。外觀沿用呼叫端給的 className。
 */
export default function CopyButton({
  value,
  label,
  copiedLabel = "已複製",
  failedLabel = "複製失敗",
  icon = "copy",
  iconSize = 15,
  announcement = "已複製到剪貼簿",
  failureHint = "瀏覽器未允許複製，請手動選取文字",
  onCopied,
  onCopyError,
  onClick,
  className,
  ...buttonProps
}: CopyButtonProps) {
  const { state, result, attempt, copy } = useCopyFeedback();

  const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
    // 呼叫端可先處理事件（例如阻止點擊傳到可選取的列），或以 preventDefault 取消複製。
    onClick?.(event);
    if (event.defaultPrevented) return;
    const text = typeof value === "function" ? value() : value;
    if (await copy(text)) {
      onCopied?.();
      return;
    }
    if (onCopyError) onCopyError();
    else toast.error(failureHint);
  };

  const Glyph = icon === "link" ? Link : Copy;
  const ariaLabel = buttonProps["aria-label"] ?? (typeof label === "string" ? label : "複製");
  const iconOnly = label === undefined;
  const classes = [
    "copy-button",
    className ? className : "copy-button--plain",
    iconOnly ? "copy-button--icon-only" : "",
  ].filter(Boolean).join(" ");

  return (
    <button
      {...buttonProps}
      type="button"
      className={classes}
      data-copy-state={state}
      data-copy-used={attempt > 0 ? "true" : undefined}
      aria-label={ariaLabel}
      onClick={(event) => void handleClick(event)}
    >
      {icon !== "none" && (
        <span className="copy-button__icon" aria-hidden="true" key={attempt}>
          <Glyph className="copy-button__glyph" size={iconSize} strokeWidth={2} />
          <svg
            className="copy-button__result"
            width={iconSize}
            height={iconSize}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            focusable="false"
          >
            <path d={result === "failed" ? CROSS_PATH : CHECK_PATH} pathLength={1} />
          </svg>
        </span>
      )}
      {!iconOnly && (
        <span className="copy-button__labels">
          <span className="copy-button__label">{label}</span>
          <span className="copy-button__label copy-button__label--result" aria-hidden="true">
            {result === "failed" ? failedLabel : copiedLabel}
          </span>
        </span>
      )}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {state === "copied" ? announcement : ""}
      </span>
    </button>
  );
}
