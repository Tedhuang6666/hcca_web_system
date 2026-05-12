"use client";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { serialTemplatesApi, orgsApi, ApiError } from "@/lib/api";
import type { OrgRead } from "@/lib/api";
import type { SerialTemplateOut } from "@/lib/types";
import { usePermissions } from "@/hooks/usePermissions";

type YearMode = "roc" | "ce";

interface CreateForm {
  org_id: string;
  category_char: string;
  year_mode: YearMode;
  reset_on_new_year: boolean;
  description: string;
  is_default: boolean;
  is_default_president_publish: boolean;
}

const EMPTY_FORM: CreateForm = {
  org_id: "",
  category_char: "",
  year_mode: "roc",
  reset_on_new_year: true,
  description: "",
  is_default: false,
  is_default_president_publish: false,
};

type FormErrorKey = "org_id" | "category_char";

export default function SerialTemplatesPage() {
  const { can } = usePermissions();
  const canManageOrg = can("org:manage") || can("admin:all");

  const [templates, setTemplates] = useState<SerialTemplateOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);
  const [formTouched, setFormTouched] = useState<Record<string, boolean>>({});

  // 可用的組織列表（擁有 document:create 權限）
  const [orgs, setOrgs] = useState<OrgRead[]>([]);
  // 當前選取組織的 prefix（可能被 org:manage 使用者修改）
  const [orgPrefixInput, setOrgPrefixInput] = useState<string>("");

  const selectedOrg = orgs.find(o => o.id === form.org_id) ?? null;

  const formErrors = {
    org_id:       !form.org_id.trim()        ? "請選擇組織" : "",
    category_char: !form.category_char.trim() ? "必填"       : "",
  };
  const touchField = (k: string) => setFormTouched(p => ({ ...p, [k]: true }));
  const showFErr = (k: FormErrorKey) => formTouched[k] && formErrors[k];

  const load = useCallback(() => {
    setLoading(true);
    serialTemplatesApi.list({ active_only: activeOnly })
      .then(setTemplates)
      .catch(e => toast.error(e instanceof ApiError ? e.message : "載入失敗"))
      .finally(() => setLoading(false));
  }, [activeOnly]);

  useEffect(() => { load(); }, [load]);

  // 載入可選的組織列表
  useEffect(() => {
    orgsApi.myCreateOrgs()
      .then(setOrgs)
      .catch(() => {});
  }, []);

  // 當使用者選擇組織時，自動帶入該組織的前綴
  const handleOrgChange = (orgId: string) => {
    setForm(p => ({ ...p, org_id: orgId }));
    const org = orgs.find(o => o.id === orgId);
    setOrgPrefixInput(org?.prefix ?? "");
  };

  const handleCreate = async () => {
    setFormTouched({ org_id: true, category_char: true });
    if (formErrors.org_id || formErrors.category_char) { toast.error("請填寫必填欄位"); return; }
    setSaving(true);
    try {
      // 若使用者有 org:manage 且修改了前綴，先更新組織前綴
      const originalPrefix = selectedOrg?.prefix ?? "";
      if (canManageOrg && orgPrefixInput !== originalPrefix) {
        await orgsApi.updateOrg(form.org_id, { prefix: orgPrefixInput || null });
      }
      await serialTemplatesApi.create({
        org_id: form.org_id,
        category_char: form.category_char.trim(),
        year_mode: form.year_mode,
        reset_on_new_year: form.reset_on_new_year,
        description: form.description.trim() || undefined,
        is_default: form.is_default,
        is_default_president_publish: form.is_default_president_publish,
      });
      toast.success("字號模板已建立");
      setShowCreate(false);
      setForm(EMPTY_FORM);
      setOrgPrefixInput("");
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "建立失敗");
    } finally { setSaving(false); }
  };

  const handleDeactivate = async (id: string, prefix: string) => {
    if (!confirm(`確定要停用字號模板「${prefix}」？停用後無法用於新公文。`)) return;
    try {
      await serialTemplatesApi.deactivate(id);
      toast.success("已停用");
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "停用失敗");
    }
  };

  // 預覽字號格式（使用已輸入的前綴或佔位符）
  const preview = (() => {
    const pfx = orgPrefixInput || (selectedOrg ? "○○" : "○○");
    const cat = form.category_char || "?";
    const year = form.year_mode === "roc"
      ? `${new Date().getFullYear() - 1911}`
      : `${new Date().getFullYear()}`;
    return `${pfx}${cat}字第 ${year}0000001 號`;
  })();

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* 頁首 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold ">字號模板管理</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
            管理公文字號格式，例如：嶺代生字第 1150000001 號
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: "var(--text-muted)" }}>
            <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)}
              className="accent-blue-600" />
            僅顯示有效
          </label>
          <button onClick={() => setShowCreate(p => !p)}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90"
            style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
            ＋ 新增模板
          </button>
        </div>
      </div>

      {/* 建立表單 */}
      {showCreate && (
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold">新增字號模板</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Step 1：選擇組織 */}
            <div className="sm:col-span-2">
              <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>發文組織 *</label>
              <select
                value={form.org_id}
                onChange={e => { handleOrgChange(e.target.value); touchField("org_id"); }}
                onBlur={() => touchField("org_id")}
                className="w-full text-sm outline-none rounded-lg px-3 py-2"
                style={{
                  background: "var(--bg-elevated)",
                  border: `1px solid ${showFErr("org_id") ? "var(--danger)" : "var(--border)"}`,
                }}>
                <option value="">選擇組織…</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              {showFErr("org_id") && (
                <p className="text-[10px] mt-1" style={{ color: "var(--danger)" }} role="alert">請選擇組織</p>
              )}
            </div>

            {/* Step 2：組織前綴（自動帶入，org:manage 可編輯） */}
            {form.org_id && (
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>
                  組織前綴{canManageOrg ? "（可修改）" : "（唯讀）"}
                </label>
                <input
                  value={orgPrefixInput}
                  onChange={e => canManageOrg && setOrgPrefixInput(e.target.value)}
                  readOnly={!canManageOrg}
                  placeholder={canManageOrg ? "例：嶺代" : "（尚未設定）"}
                  maxLength={10}
                  className="w-full bg-transparent text-sm px-3 py-2 rounded-lg outline-none"
                  style={{
                    border: "1px solid var(--border)",
                    opacity: canManageOrg ? 1 : 0.6,
                    cursor: canManageOrg ? "text" : "not-allowed",
                  }} />
                <p className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
                  {canManageOrg
                    ? "修改後將同步更新組織設定"
                    : "前綴由組織管理員設定，請聯繫管理員修改"}
                </p>
              </div>
            )}

            {/* Step 3：分類字元（細別） */}
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>分類字元 *</label>
              <input value={form.category_char}
                onChange={e => setForm(p => ({ ...p, category_char: e.target.value }))}
                onBlur={() => touchField("category_char")}
                placeholder="例：生"
                maxLength={4}
                className="w-full bg-transparent text-sm px-3 py-2 rounded-lg outline-none"
                style={{ border: `1px solid ${showFErr("category_char") ? "var(--danger)" : "var(--border)"}` }}
                aria-invalid={!!showFErr("category_char")} />
              {showFErr("category_char")
                ? <p className="text-[10px] mt-1" style={{ color: "var(--danger)" }} role="alert">必填欄位</p>
                : <p className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>細別，如「嶺代生字」中的「生」</p>
              }
            </div>

            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>年份格式</label>
              <select value={form.year_mode} onChange={e => setForm(p => ({ ...p, year_mode: e.target.value as YearMode }))}
                className="w-full text-sm outline-none rounded-lg px-3 py-2"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                <option value="roc">民國年（ROC）</option>
                <option value="ce">西元年（CE）</option>
              </select>
            </div>
            <div className="flex flex-col justify-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.reset_on_new_year}
                  onChange={e => setForm(p => ({ ...p, reset_on_new_year: e.target.checked }))}
                  className="accent-blue-600 w-4 h-4" />
                <span className="text-sm">每年重置流水號</span>
              </label>
              <p className="text-[10px] mt-1 ml-6" style={{ color: "var(--text-muted)" }}>
                勾選後，新年度第一份公文從 0000001 重新計數
              </p>
            </div>
            <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg px-4 py-3"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={e => setForm(p => ({ ...p, is_default: e.target.checked }))}
                  className="accent-blue-600 w-4 h-4 mt-0.5"
                />
                <span className="text-sm">
                  設為一般公文預設模板
                  <span className="block text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
                    同組織起草公文時，會優先自動帶入這個模板
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_default_president_publish}
                  onChange={e => setForm(p => ({ ...p, is_default_president_publish: e.target.checked }))}
                  className="accent-blue-600 w-4 h-4 mt-0.5"
                />
                <span className="text-sm">
                  設為主席公布預設模板
                  <span className="block text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
                    主席公布法規時，系統會優先使用這個模板
                  </span>
                </span>
              </label>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>備註說明（選填）</label>
              <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                placeholder="例：學生會行政公文字號"
                className="w-full bg-transparent text-sm px-3 py-2 rounded-lg outline-none"
                style={{ border: "1px solid var(--border)" }} />
            </div>
          </div>

          {/* 預覽 */}
          <div className="rounded-lg px-4 py-3" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <p className="text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>字號預覽</p>
            <p className="text-sm font-mono">{preview}</p>
          </div>

          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowCreate(false); setForm(EMPTY_FORM); setOrgPrefixInput(""); setFormTouched({}); }}
              className="px-4 py-2 rounded-lg text-sm hover:opacity-80 transition-colors">
              取消
            </button>
            <button onClick={handleCreate} disabled={saving}
              className="px-5 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
              {saving ? "建立中..." : "建立模板"}
            </button>
          </div>
        </div>
      )}

      {/* 模板列表 */}
      {loading ? (
        <div className="py-20 text-center ">載入中...</div>
      ) : templates.length === 0 ? (
        <div className="card py-16 text-center">
          <p className=" text-sm">尚無字號模板</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            點擊「新增模板」建立第一個字號格式，需要 doc.issue 權限
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map(t => (
            <TemplateCard key={t.id} template={t} onDeactivate={handleDeactivate} onUpdated={load} />
          ))}
        </div>
      )}

      {/* 說明 */}
      <div className="card p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>
          字號格式說明
        </h3>
        <dl className="space-y-2 text-xs" style={{ color: "var(--text-muted)" }}>
          <div className="flex gap-2">
            <dt className="font-semibold  w-24 flex-shrink-0">格式結構</dt>
            <dd>{"{機關縮寫}{分類字}{第 {年度}{流水號} 號}"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold  w-24 flex-shrink-0">範例</dt>
            <dd>嶺代生字第 1150000001 號</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold  w-24 flex-shrink-0">流水號</dt>
            <dd>7 位數字，每年可重置（依設定），並發保證唯一（SELECT FOR UPDATE）</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold  w-24 flex-shrink-0">權限要求</dt>
            <dd>建立/停用需要 doc.issue 權限；查詢/選用對所有有效使用者開放</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold  w-24 flex-shrink-0">預設用途</dt>
            <dd>可指定「一般公文預設」與「主席公布預設」，同組織各保留一個</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

// ── 模板卡片 ──────────────────────────────────────────────────────────────────

function TemplateCard({
  template: t,
  onDeactivate,
  onUpdated,
}: {
  template: SerialTemplateOut;
  onDeactivate: (id: string, prefix: string) => void;
  onUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editDesc, setEditDesc] = useState(t.description ?? "");
  const [editYearMode, setEditYearMode] = useState<"roc" | "ce">(t.year_mode as "roc" | "ce");
  const [editReset, setEditReset] = useState(t.reset_on_new_year);
  const [editDefault, setEditDefault] = useState(t.is_default);
  const [editPresidentDefault, setEditPresidentDefault] = useState(t.is_default_president_publish);
  const [saving, setSaving] = useState(false);

  const handleEdit = async () => {
    setSaving(true);
    try {
      await serialTemplatesApi.update(t.id, {
        description: editDesc || null,
        year_mode: editYearMode,
        reset_on_new_year: editReset,
        is_default: editDefault,
        is_default_president_publish: editPresidentDefault,
      });
      toast.success("已更新");
      setEditing(false);
      onUpdated();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "更新失敗");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card p-4">
      <div className="flex items-start gap-4">
        {/* 狀態指示 */}
        <div className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: t.is_active ? "var(--success)" : "var(--text-disabled)" }} />

        {/* 主要資訊 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold font-mono">
              {t.org_prefix}{t.category_char}字第 …
            </span>
            {t.is_default && (
              <span className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ color: "var(--primary)", background: "var(--primary-dim)" }}>
                一般預設
              </span>
            )}
            {t.is_default_president_publish && (
              <span className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ color: "#c2410c", background: "rgba(251,146,60,0.18)" }}>
                主席公布預設
              </span>
            )}
            {!t.is_active && (
              <span className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ color: "#f87171", background: "rgba(248,113,113,0.1)" }}>
                已停用
              </span>
            )}
          </div>

          {t.preview && (
            <p className="text-xs mt-0.5 font-mono" style={{ color: "var(--primary)" }}>
              預覽：{t.preview}
            </p>
          )}

          <div className="flex flex-wrap gap-3 mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
            <span>年份：{t.year_mode === "roc" ? "民國年" : "西元年"}</span>
            <span>流水號：{t.reset_on_new_year ? "每年重置" : "不重置"}</span>
            <span>目前計數：{t.counter.toLocaleString()}</span>
            {t.description && <span>{t.description}</span>}
          </div>

          <p className="text-[10px] mt-1.5" style={{ color: "var(--text-muted)" }}>
            建立於 {new Date(t.created_at).toLocaleDateString("zh-TW")}
          </p>
        </div>

        {/* 操作按鈕 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {t.is_active && (
            <button onClick={() => setEditing(p => !p)}
              className="text-xs px-3 py-1.5 rounded-lg transition-colors"
              style={{ color: "var(--primary)", border: "1px solid var(--border)" }}>
              編輯
            </button>
          )}
          {t.is_active && (
            <button onClick={() => onDeactivate(t.id, `${t.org_prefix}${t.category_char}`)}
              className="text-xs px-3 py-1.5 rounded-lg transition-colors hover:text-red-400"
              style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>
              停用
            </button>
          )}
        </div>
      </div>

      {/* 編輯面板（收合式） */}
      {editing && (
        <div className="mt-4 pt-4 space-y-3" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>年份格式</label>
              <select value={editYearMode} onChange={e => setEditYearMode(e.target.value as "roc" | "ce")}
                className="w-full text-sm outline-none rounded-lg px-3 py-2"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                <option value="roc">民國年（ROC）</option>
                <option value="ce">西元年（CE）</option>
              </select>
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editReset}
                  onChange={e => setEditReset(e.target.checked)} />
                <span className="text-sm">每年重置流水號</span>
              </label>
            </div>
            <label className="flex items-start gap-2 cursor-pointer rounded-lg px-3 py-2"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
              <input
                type="checkbox"
                checked={editDefault}
                onChange={e => setEditDefault(e.target.checked)}
                className="accent-blue-600 w-4 h-4 mt-0.5"
              />
              <span className="text-sm">
                設為一般公文預設模板
                <span className="block text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
                  同組織只會保留一個一般預設
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer rounded-lg px-3 py-2"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
              <input
                type="checkbox"
                checked={editPresidentDefault}
                onChange={e => setEditPresidentDefault(e.target.checked)}
                className="accent-blue-600 w-4 h-4 mt-0.5"
              />
              <span className="text-sm">
                設為主席公布預設模板
                <span className="block text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
                  主席公布法規時會優先使用這個模板
                </span>
              </span>
            </label>
            <div className="sm:col-span-2">
              <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>備註說明（選填）</label>
              <input value={editDesc} onChange={e => setEditDesc(e.target.value)}
                placeholder="模板用途說明"
                className="w-full bg-transparent text-sm px-3 py-2 rounded-lg outline-none"
                style={{ border: "1px solid var(--border)" }} />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setEditing(false)}
              className="text-xs px-4 py-2 rounded-lg hover:opacity-80">
              取消
            </button>
            <button onClick={handleEdit} disabled={saving}
              className="text-xs px-5 py-2 rounded-lg font-medium disabled:opacity-50"
              style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
              {saving ? "儲存中…" : "儲存"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
