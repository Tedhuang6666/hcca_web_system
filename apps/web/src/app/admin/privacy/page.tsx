"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Download,
  FileLock2,
  Lock,
  RefreshCcw,
  ShieldOff,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";

import { usePermissions } from "@/hooks/usePermissions";
import {
  ApiError,
  privacyApi,
  type PrivacyExportFile,
  type PrivacyExportResult,
} from "@/lib/api";

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export default function PrivacyPage() {
  const { isAdmin } = usePermissions();
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [exports, setExports] = useState<PrivacyExportFile[]>([]);
  const [lastExport, setLastExport] = useState<PrivacyExportResult | null>(null);

  const loadExports = useCallback(async () => {
    try {
      const items = await privacyApi.listExports();
      setExports(items);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "讀取匯出列表失敗");
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void loadExports();
  }, [isAdmin, loadExports]);

  const onExport = async () => {
    const uid = userId.trim();
    if (!uid) {
      toast.error("請填入使用者 UUID");
      return;
    }
    setBusy(true);
    try {
      const result = await privacyApi.exportUser(uid);
      setLastExport(result);
      toast.success(
        `已生成：${result.file_path}（${fmtSize(result.size_bytes)}，${result.file_count} 個檔）`,
      );
      await loadExports();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "匯出失敗");
    } finally {
      setBusy(false);
    }
  };

  const onAnonymize = async () => {
    const uid = userId.trim();
    if (!uid) {
      toast.error("請填入使用者 UUID");
      return;
    }
    const confirm1 = window.prompt(
      `即將假名化使用者 ${uid}\n\n` +
        `會把：display_name / email / phone / avatar_url 等 PII 欄位替換為去識別字串，\n` +
        `並把 is_active 設為 false。已存在的 audit log、公文、簽核、訂單等紀錄保留不動。\n\n` +
        `此操作不可逆。請輸入「假名化」以確認：`,
    );
    if (confirm1?.trim() !== "假名化") {
      toast.info("已取消");
      return;
    }
    setBusy(true);
    try {
      const result = await privacyApi.anonymizeUser(uid, "假名化");
      toast.success(`完成，更新 ${result.fields_updated.length} 個欄位`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "假名化失敗");
    } finally {
      setBusy(false);
    }
  };

  if (!isAdmin) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <section
          className="rounded-lg border p-8 text-center"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
          <Lock className="mx-auto mb-3 text-[var(--danger)]" size={32} aria-hidden />
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            需要超級管理員權限
          </h1>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-4 md:p-6">
      <header className="mb-5">
        <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
          <FileLock2 size={14} aria-hidden />
          個資處理（個資法 §10 / §11 義務）
        </div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">個資匯出與假名化</h1>
        <p className="mt-1 max-w-3xl text-xs text-[var(--text-muted)]">
          當事人請求查閱自己資料或請求刪除時使用。執行前請參考{" "}
          <code>docs/LEGAL_EXPORT_SOP.md</code>，並確認已驗證當事人身分。
        </p>
      </header>

      <section
        className="mb-6 rounded-lg border bg-[var(--bg-surface)] p-4"
        style={{ borderColor: "var(--border)" }}>
        <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">當事人 UUID</h2>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            className="input min-w-[24rem] flex-1 font-mono text-xs"
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !userId.trim()}
            onClick={onExport}>
            <Download size={14} aria-hidden />
            匯出全部資料 ZIP
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy || !userId.trim()}
            onClick={onAnonymize}>
            <ShieldOff size={14} aria-hidden />
            假名化（不可逆）
          </button>
        </div>
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">
          UUID 從 <code>/admin/permissions</code> 中找對應使用者的「ID」欄位複製。
        </p>
        {lastExport && (
          <div className="mt-3 rounded-md border border-[var(--success)] bg-[var(--success-dim)] p-3 text-xs">
            <UserCheck size={14} aria-hidden className="mr-1 inline" />
            匯出成功：<code>{lastExport.file_path}</code>（{fmtSize(lastExport.size_bytes)}，
            {lastExport.file_count} 個檔，{new Date(lastExport.generated_at).toLocaleString()}）
          </div>
        )}
      </section>

      <section
        className="mb-6 rounded-lg border bg-[var(--bg-surface)]"
        style={{ borderColor: "var(--border)" }}>
        <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">已生成的匯出檔</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={loadExports}>
            <RefreshCcw size={14} aria-hidden />
            重新整理
          </button>
        </header>
        {exports.length === 0 ? (
          <p className="p-6 text-center text-sm text-[var(--text-muted)]">尚無匯出檔。</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[var(--text-secondary)]">
              <tr className="border-b border-[var(--border)]">
                <th className="px-3 py-2 text-left">檔名</th>
                <th className="px-3 py-2 text-right">大小</th>
                <th className="px-3 py-2 text-right">生成時間</th>
                <th className="px-3 py-2 text-right">下載</th>
              </tr>
            </thead>
            <tbody>
              {exports.map((f) => (
                <tr key={f.filename} className="border-b border-[var(--border)]">
                  <td className="px-3 py-2 font-mono text-[10px]">{f.filename}</td>
                  <td className="px-3 py-2 text-right">{fmtSize(f.size_bytes)}</td>
                  <td className="px-3 py-2 text-right">
                    {new Date(f.modified_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <a
                      href={privacyApi.exportDownloadUrl(f.filename)}
                      className="btn-sm btn-primary inline-flex"
                      download>
                      <Download size={12} aria-hidden />
                      下載
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div
        className="flex items-start gap-2 rounded-md border px-4 py-3 text-xs"
        style={{
          background: "var(--warning-dim)",
          borderColor: "var(--warning-border)",
          color: "var(--warning)",
        }}
        role="status">
        <AlertTriangle size={14} aria-hidden className="mt-0.5 flex-shrink-0" />
        <span>
          匯出 ZIP 含完整 PII，請以加密方式交付（壓縮加密 + 密碼分開傳遞）。
          下載動作均寫入 <code>/audit-logs</code>。假名化操作不可復原。
        </span>
      </div>
    </main>
  );
}
