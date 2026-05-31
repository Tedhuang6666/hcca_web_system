"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import { PermCheckboxes } from "@/components/admin/PermissionCatalog";
import { adminApi, ApiError } from "@/lib/api";
import type { OrgWithPositions, PermissionCodeInfo, PositionSummary } from "@/lib/types";

// ── 預先建立帳號 Modal ────────────────────────────────────────────────────────
export function PreRegisterModal({
  positions, permCodes, orgs, onClose, onDone,
}: {
  positions: PositionSummary[];
  permCodes: PermissionCodeInfo[];
  orgs: OrgWithPositions[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [sid, setSid] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [posId, setPosId] = useState("");
  const [permOrgId, setPermOrgId] = useState("");
  const [customCodes, setCustomCodes] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!name.trim()) { toast.error("請填寫姓名"); return; }
    if (!sid.trim() && !email.trim()) { toast.error("請填學號或自訂 Email"); return; }
    if (customCodes.length > 0 && !permOrgId) { toast.error("使用自訂權限時請選擇組織"); return; }
    setLoading(true);
    try {
      await adminApi.preRegister({
        student_id: sid.trim() || null,
        email: email.trim() || null,
        display_name: name.trim(),
        position_ids: posId ? [posId] : [],
        custom_permission_org_id: permOrgId || null,
        custom_permission_codes: customCodes,
        start_date: startDate,
        end_date: endDate || null,
      });
      toast.success("預先帳號已建立");
      onDone();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "建立失敗"); }
    finally { setLoading(false); }
  };

  return (
    <Modal title="預先建立帳號（含外部人員）" onClose={onClose}>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        可用學號自動生成校內信箱，或直接輸入外部 Email（教師、外校人士）。
      </p>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>學號（擇一）</label>
            <input value={sid} onChange={e => setSid(e.target.value)} placeholder="例：112040101"
              className="w-full bg-transparent text-sm px-3 py-2 rounded-lg outline-none"
              style={{ border: "1px solid var(--border)" }} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>自訂 Email（擇一）</label>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="例：teacher@example.edu.tw"
              className="w-full bg-transparent text-sm px-3 py-2 rounded-lg outline-none"
              style={{ border: "1px solid var(--border)" }} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>姓名 *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="例：王小明"
              className="w-full bg-transparent text-sm px-3 py-2 rounded-lg outline-none"
              style={{ border: "1px solid var(--border)" }} />
          </div>
          <div />
        </div>
        <div>
          <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>立即指派職位（選填）</label>
          <select value={posId} onChange={e => setPosId(e.target.value)}
            className="w-full text-sm rounded-lg px-3 py-2 outline-none"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
            <option value="">不指派</option>
            {positions.map(p => <option key={p.id} value={p.id}>{p.org_name} / {p.name}</option>)}
          </select>
        </div>
        {posId && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>任期開始</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="w-full bg-transparent text-sm px-3 py-2 rounded-lg outline-none"
                style={{ border: "1px solid var(--border)", colorScheme: "dark" }} />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>任期結束（留空=無限）</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="w-full bg-transparent text-sm px-3 py-2 rounded-lg outline-none"
                style={{ border: "1px solid var(--border)", colorScheme: "dark" }} />
            </div>
          </div>
        )}
        <div>
          <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>自訂權限組織（選填）</label>
          <select value={permOrgId} onChange={e => setPermOrgId(e.target.value)}
            className="w-full text-sm rounded-lg px-3 py-2 outline-none"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
            <option value="">不設定自訂權限</option>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        {permOrgId && (
          <div>
            <label className="text-xs mb-2 block" style={{ color: "var(--text-muted)" }}>自訂權限</label>
            <PermCheckboxes selected={customCodes} onChange={setCustomCodes} permCodes={permCodes} />
          </div>
        )}
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl" style={{ color: "var(--text-muted)" }}>取消</button>
        <button onClick={submit} disabled={loading}
          className="px-5 py-2 text-sm rounded-xl font-medium disabled:opacity-50 transition-all"
          style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
          {loading ? "建立中..." : "建立帳號"}
        </button>
      </div>
    </Modal>
  );
}

// ── 新增組織 Modal ────────────────────────────────────────────────────────────
export function NewOrgModal({
  orgs, onClose, onDone,
}: {
  orgs: OrgWithPositions[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentId, setParentId] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!name.trim()) { toast.error("請填寫組織名稱"); return; }
    setLoading(true);
    try {
      await adminApi.createOrg({
        name: name.trim(),
        description: description.trim() || undefined,
        parent_id: parentId || null,
      });
      toast.success("組織已建立");
      onDone();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "建立失敗"); }
    finally { setLoading(false); }
  };

  return (
    <Modal title="新增組織" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>組織名稱 *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="例：班聯會"
            className="w-full bg-transparent text-sm px-3 py-2 rounded-lg outline-none"
            style={{ border: "1px solid var(--border)" }} />
        </div>
        <div>
          <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>描述（選填）</label>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="簡短描述"
            className="w-full bg-transparent text-sm px-3 py-2 rounded-lg outline-none"
            style={{ border: "1px solid var(--border)" }} />
        </div>
        <div>
          <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>上層組織（選填）</label>
          <select value={parentId} onChange={e => setParentId(e.target.value)}
            className="w-full text-sm rounded-lg px-3 py-2 outline-none"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
            <option value="">無（頂層組織）</option>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl" style={{ color: "var(--text-muted)" }}>取消</button>
        <button onClick={submit} disabled={loading}
          className="px-5 py-2 text-sm rounded-xl font-medium disabled:opacity-50"
          style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
          {loading ? "建立中..." : "建立組織"}
        </button>
      </div>
    </Modal>
  );
}

// ── 新增職位 Modal ────────────────────────────────────────────────────────────
export function NewPositionModal({
  orgs, permCodes, onClose, onDone,
}: {
  orgs: OrgWithPositions[];
  permCodes: PermissionCodeInfo[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [orgId, setOrgId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [relationMode, setRelationMode] = useState<"none" | "parent" | "sibling">("none");
  const [relationTargetId, setRelationTargetId] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const orgPositions = useMemo(
    () => orgs.find(o => o.id === orgId)?.positions ?? [],
    [orgId, orgs],
  );

  const submit = async () => {
    if (!name.trim() || !orgId) { toast.error("請填寫職位名稱並選擇組織"); return; }
    if (relationMode !== "none" && !relationTargetId) {
      toast.error("請選擇職位關係目標");
      return;
    }
    let parentId: string | null = null;
    if (relationMode === "parent") parentId = relationTargetId;
    if (relationMode === "sibling") {
      const target = orgPositions.find(p => p.id === relationTargetId);
      parentId = target?.parent_id ?? null;
    }
    setLoading(true);
    try {
      await adminApi.createPosition({
        org_id: orgId,
        name: name.trim(),
        description: description.trim() || undefined,
        parent_id: parentId,
        permission_codes: codes,
      });
      toast.success("職位已建立");
      onDone();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "建立失敗"); }
    finally { setLoading(false); }
  };

  return (
    <Modal title="新增職位（身份組）" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>所屬組織 *</label>
            <select value={orgId} onChange={e => setOrgId(e.target.value)}
              className="w-full text-sm rounded-lg px-3 py-2 outline-none"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
              <option value="">選擇組織...</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>職位名稱 *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="例：公文審核委員"
              className="w-full bg-transparent text-sm px-3 py-2 rounded-lg outline-none"
              style={{ border: "1px solid var(--border)" }} />
          </div>
        </div>
        <div>
          <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>描述（選填）</label>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="職位描述"
            className="w-full bg-transparent text-sm px-3 py-2 rounded-lg outline-none"
            style={{ border: "1px solid var(--border)" }} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>階層關係</label>
            <select value={relationMode} onChange={e => setRelationMode(e.target.value as "none" | "parent" | "sibling")}
              className="w-full text-sm rounded-lg px-3 py-2 outline-none"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
              <option value="none">無（頂層/平級）</option>
              <option value="parent">指定上級</option>
              <option value="sibling">與某職位平級</option>
            </select>
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>關係目標</label>
            <select
              value={relationTargetId}
              onChange={e => setRelationTargetId(e.target.value)}
              disabled={relationMode === "none" || !orgId}
              className="w-full text-sm rounded-lg px-3 py-2 outline-none disabled:opacity-50"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
              <option value="">選擇職位...</option>
              {orgPositions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs mb-2 block" style={{ color: "var(--text-muted)" }}>賦予的權限碼</label>
          <PermCheckboxes selected={codes} onChange={setCodes} permCodes={permCodes} />
        </div>
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl" style={{ color: "var(--text-muted)" }}>取消</button>
        <button onClick={submit} disabled={loading}
          className="px-5 py-2 text-sm rounded-xl font-medium disabled:opacity-50"
          style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
          {loading ? "建立中..." : "建立職位"}
        </button>
      </div>
    </Modal>
  );
}
