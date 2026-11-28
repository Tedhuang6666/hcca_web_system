import type { Ref } from "react";

import type { EmailVariableDefinition } from "@/lib/types";
import type { RecipientRow } from "@/app/(protected)/email/emailComposeConfig";

type InvalidRecipientRow = { row: RecipientRow; index: number };

type EmailRecipientDataTableProps = {
  pasteTableOpen: boolean;
  onPasteTableOpenChange: (open: boolean) => void;
  pasteTableText: string;
  onPasteTableTextChange: (value: string) => void;
  onImportPastedTable: () => void;
  variableDefinitions: EmailVariableDefinition[];
  onAddVariableDefinition: () => void;
  onUpdateVariableName: (index: number, value: string) => void;
  onRemoveVariable: (index: number) => void;
  recipientRows: RecipientRow[];
  invalidRecipientRows: InvalidRecipientRow[];
  recipientTableBottomRef: Ref<HTMLDivElement>;
  onAddRecipientRow: () => void;
  onUpdateRecipientRow: (index: number, patch: Partial<RecipientRow>) => void;
  onUpdateRecipientVariable: (index: number, key: string, value: string) => void;
  onRemoveRecipientRow: (index: number) => void;
};

export function EmailRecipientDataTable({
  pasteTableOpen,
  onPasteTableOpenChange,
  pasteTableText,
  onPasteTableTextChange,
  onImportPastedTable,
  variableDefinitions,
  onAddVariableDefinition,
  onUpdateVariableName,
  onRemoveVariable,
  recipientRows,
  invalidRecipientRows,
  recipientTableBottomRef,
  onAddRecipientRow,
  onUpdateRecipientRow,
  onUpdateRecipientVariable,
  onRemoveRecipientRow,
}: EmailRecipientDataTableProps) {
  return (
<div className="space-y-2 rounded-lg p-3" style={{ background: "var(--bg-elevated)" }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                    收件人資料表
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => onPasteTableOpenChange(!pasteTableOpen)}
                  >
                    貼上表格
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={onAddVariableDefinition}>
                    + 新增欄位
                  </button>
                </div>
              </div>
              {pasteTableOpen && (
                <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    支援姓名、Email 與自訂欄位，資料會追加至現有表格。
                  </p>
                  <textarea
                    className="input min-h-28 font-mono text-xs"
                    value={pasteTableText}
                    onChange={(event) => onPasteTableTextChange(event.target.value)}
                    placeholder={"電子郵件\t姓名\t錄取部門\t錄取部門數\nted981026@gmail.com\t黃丞廷\t資訊部\t1"}
                  />
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPasteTableOpenChange(false)}>
                      取消
                    </button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={onImportPastedTable}>
                      匯入表格
                    </button>
                  </div>
                </div>
              )}
              <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-lg border" style={{ borderColor: "var(--border)" }}>
                <table className="w-max min-w-full border-separate border-spacing-1">
                  <thead>
                    <tr className="text-left text-xs" style={{ color: "var(--text-muted)" }}>
                      <th className="min-w-56 px-1">
                        電子郵件
                        <code className="ml-2 font-normal" style={{ color: "var(--primary-text)" }}>
                          {"{{ 電子郵件 }}"}
                        </code>
                      </th>
                      <th className="min-w-40 px-1">
                        姓名
                        <code className="ml-2 font-normal" style={{ color: "var(--primary-text)" }}>
                          {"{{ 姓名 }}"}
                        </code>
                      </th>
                      {variableDefinitions.map((variable, i) => (
                        <th key={i} className="min-w-52 px-1">
                          <div className="flex items-center gap-1">
                            <input
                              className="input min-w-36 py-1 text-xs"
                              value={variable.key}
                              maxLength={64}
                              placeholder="欄位名稱"
                              aria-label={`第 ${i + 1} 個自訂欄位名稱`}
                              onChange={(event) => onUpdateVariableName(i, event.target.value)}
                            />
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              aria-label={`移除欄位 ${variable.key || i + 1}`}
                              onClick={() => onRemoveVariable(i)}
                            >
                              ×
                            </button>
                          </div>
                          <code className="mt-1 block font-normal" style={{ color: "var(--primary-text)" }}>
                            {variable.key ? `{{ ${variable.key} }}` : "輸入名稱後自動產生"}
                          </code>
                        </th>
                      ))}
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {recipientRows.map((row, i) => (
                      <tr key={i}>
                        <td>
                          {row.userId ? (
                            <span className="inline-flex min-h-11 min-w-56 items-center px-3 text-sm" style={{ color: "var(--text-secondary)" }}>
                              平台帳號收件人
                            </span>
                          ) : (
                            <input
                              className="input min-w-56"
                              type="email"
                              value={row.email}
                              placeholder="user@example.com"
                              style={{
                                borderColor:
                                  row.email.trim() &&
                                  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim())
                                    ? "var(--danger)"
                                    : undefined,
                              }}
                              onChange={(e) => onUpdateRecipientRow(i, { email: e.target.value })}
                            />
                          )}
                        </td>
                        <td>
                          <input
                            className="input min-w-36"
                            value={row.name}
                            placeholder="王小明"
                            onChange={(e) => onUpdateRecipientRow(i, { name: e.target.value })}
                          />
                        </td>
                        {variableDefinitions.map((variable, variableIndex) => (
                          <td key={`${variableIndex}-${variable.key}`}>
                            <input
                              className="input min-w-40"
                              value={row.variables[variable.key] ?? ""}
                              placeholder={variable.key}
                              onChange={(e) =>
                                onUpdateRecipientVariable(i, variable.key, e.target.value)
                              }
                            />
                          </td>
                        ))}
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-label="移除此資料列"
                            onClick={() => onRemoveRecipientRow(i)}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {recipientRows.length === 0 && (
                <p className="py-3 text-center text-xs" style={{ color: "var(--text-muted)" }}>
                  尚無資料，請新增第一列。
                </p>
              )}
              {invalidRecipientRows.length > 0 && (
                <p className="text-xs" style={{ color: "var(--danger)" }}>
                  有 {invalidRecipientRows.length} 列電子郵件格式錯誤，已以紅框標示。
                </p>
              )}
              <div ref={recipientTableBottomRef} className="flex justify-center border-t pt-3" style={{ borderColor: "var(--border)" }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={onAddRecipientRow}>
                  + 新增資料列
                </button>
              </div>
            </div>
              );
}
