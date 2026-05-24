"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronRight } from "lucide-react";

export type SortDirection = "asc" | "desc";

export interface ResponsiveTableColumn<T> {
  /** 欄位識別碼，配合 onSort 使用。 */
  key: string;
  /** 表頭顯示文字。 */
  label: string;
  /** 渲染函式。 */
  render: (row: T) => ReactNode;
  /** 是否可排序（顯示排序圖示並回呼 onSort）。 */
  sortable?: boolean;
  /** 行動裝置：是否作為卡片標題（同一表格只能有一個 primary）。 */
  primary?: boolean;
  /**
   * 行動裝置顯示策略：
   * - "always"：標題下方獨立顯示（常用於狀態徽章）
   * - "meta"（預設）：合併到次要區，以「label：value」呈現
   * - "never"：不在手機顯示
   */
  mobileShow?: "always" | "meta" | "never";
  /** 桌面對齊。 */
  align?: "left" | "right" | "center";
  /** 桌面欄寬（CSS length，例如 "120px" 或 "20%"）。 */
  width?: string;
}

interface ResponsiveTableProps<T> {
  rows: T[];
  columns: ResponsiveTableColumn<T>[];
  rowKey: (row: T) => string;
  /** 點擊整列導向（同時提供卡片版可點性）。 */
  rowHref?: (row: T) => string;
  /** 排序狀態 + 變更回呼（若提供則排序欄會變成互動 button）。 */
  sort?: { key: string; direction: SortDirection };
  onSort?: (key: string, direction: SortDirection) => void;
  /** 空資料訊息。 */
  emptyMessage?: string;
  /** 載入中骨架行數。 */
  loadingRows?: number;
  /** 緊湊模式（縮小 padding）。 */
  dense?: boolean;
}

function nextDirection(current: SortDirection | null): SortDirection {
  return current === "asc" ? "desc" : "asc";
}

export function ResponsiveTable<T>({
  rows,
  columns,
  rowKey,
  rowHref,
  sort,
  onSort,
  emptyMessage = "尚無資料",
  loadingRows,
  dense = false,
}: ResponsiveTableProps<T>) {
  const isLoading = loadingRows !== undefined;
  const primaryCol = columns.find((c) => c.primary) ?? columns[0];

  if (!isLoading && rows.length === 0) {
    return (
      <div
        className="text-center py-10 text-sm"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          color: "var(--text-muted)",
        }}>
        {emptyMessage}
      </div>
    );
  }

  const padX = dense ? "px-3" : "px-4";
  const padY = dense ? "py-2" : "py-3";

  return (
    <>
      {/* ── 桌面 (md+)：標準表格 ─────────────────────────────────────── */}
      <div className="hidden md:block overflow-x-auto rounded-lg"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--bg-hover)" }}>
              {columns.map((c) => {
                const isSorted = sort?.key === c.key;
                const dir: SortDirection | null = isSorted ? sort!.direction : null;
                const align = c.align ?? "left";
                const widthStyle = c.width ? { width: c.width, minWidth: c.width } : {};
                return (
                  <th
                    key={c.key}
                    scope="col"
                    className={`${padX} ${padY} text-xs font-semibold whitespace-nowrap`}
                    style={{
                      color: "var(--text-secondary)",
                      borderBottom: "1px solid var(--border)",
                      textAlign: align,
                      ...widthStyle,
                    }}>
                    {c.sortable && onSort ? (
                      <button
                        type="button"
                        onClick={() => onSort(c.key, nextDirection(dir))}
                        className="inline-flex items-center gap-1 hover:opacity-80"
                        style={{ color: "var(--text-secondary)" }}>
                        {c.label}
                        {dir === "asc" ? (
                          <ChevronUp size={12} aria-hidden={true} />
                        ) : dir === "desc" ? (
                          <ChevronDown size={12} aria-hidden={true} />
                        ) : (
                          <ChevronsUpDown size={12} aria-hidden={true}
                            style={{ opacity: 0.4 }} />
                        )}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: loadingRows! }).map((_, i) => (
                  <tr key={`skel-${i}`} style={{ borderBottom: "1px solid var(--border)" }}>
                    {columns.map((c) => (
                      <td key={c.key} className={`${padX} ${padY}`}>
                        <div className="h-3 w-3/4 rounded animate-pulse"
                          style={{ background: "var(--bg-hover)" }} />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((r, idx) => {
                  const href = rowHref?.(r);
                  return (
                    <tr
                      key={rowKey(r)}
                      style={{
                        borderBottom: idx < rows.length - 1 ? "1px solid var(--border)" : undefined,
                        cursor: href ? "pointer" : undefined,
                      }}
                      onClick={href ? (e) => {
                        // 不在 button/link 內點擊時才導頁
                        const target = e.target as HTMLElement;
                        if (target.closest("a,button,input,select,textarea")) return;
                        window.location.href = href;
                      } : undefined}
                      onMouseEnter={href ? (e) => (e.currentTarget.style.background = "var(--bg-hover)") : undefined}
                      onMouseLeave={href ? (e) => (e.currentTarget.style.background = "transparent") : undefined}>
                      {columns.map((c) => (
                        <td
                          key={c.key}
                          className={`${padX} ${padY}`}
                          style={{
                            color: "var(--text-primary)",
                            textAlign: c.align ?? "left",
                          }}>
                          {c.render(r)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>

      {/* ── 手機 (md-)：卡片列表 ────────────────────────────────────── */}
      <ul className="md:hidden space-y-2">
        {isLoading
          ? Array.from({ length: loadingRows! }).map((_, i) => (
              <li key={`skel-m-${i}`}>
                <div className="p-4 rounded-lg animate-pulse"
                  style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
                  <div className="h-4 w-3/4 rounded mb-2"
                    style={{ background: "var(--bg-hover)" }} />
                  <div className="h-3 w-1/2 rounded"
                    style={{ background: "var(--bg-hover)" }} />
                </div>
              </li>
            ))
          : rows.map((r) => {
              const href = rowHref?.(r);
              const titleNode = primaryCol.render(r);
              const alwaysCols = columns.filter(
                (c) => c.mobileShow === "always" && c.key !== primaryCol.key
              );
              const metaCols = columns.filter(
                (c) => (!c.mobileShow || c.mobileShow === "meta") && c.key !== primaryCol.key
              );

              const inner = (
                <div className="p-4 rounded-lg transition-colors"
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border)",
                  }}>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate"
                        style={{ color: "var(--text-primary)" }}>
                        {titleNode}
                      </div>
                      {alwaysCols.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-1.5">
                          {alwaysCols.map((c) => (
                            <span key={c.key}>{c.render(r)}</span>
                          ))}
                        </div>
                      )}
                      {metaCols.length > 0 && (
                        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                          {metaCols.map((c) => (
                            <div key={c.key} className="min-w-0">
                              <dt className="text-[10px] uppercase tracking-wide"
                                style={{ color: "var(--text-muted)" }}>
                                {c.label}
                              </dt>
                              <dd className="text-xs truncate"
                                style={{ color: "var(--text-secondary)" }}>
                                {c.render(r)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </div>
                    {href && (
                      <ChevronRight size={16} aria-hidden={true}
                        style={{ color: "var(--text-disabled)", flexShrink: 0, marginTop: 2 }} />
                    )}
                  </div>
                </div>
              );

              return (
                <li key={rowKey(r)}>
                  {href ? (
                    <Link href={href} style={{ textDecoration: "none", display: "block" }}>
                      {inner}
                    </Link>
                  ) : inner}
                </li>
              );
            })}
      </ul>
    </>
  );
}

export default ResponsiveTable;
