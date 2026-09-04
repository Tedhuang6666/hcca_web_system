"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ApiError, orgsApi, petitionsApi, usersApi, withFallback } from "@/lib/api";
import UserPicker from "@/components/surveys/UserPicker";
import type {
  PetitionNotificationRuleOut,
  PetitionNotificationSettingsOut,
  PetitionTypeOut,
  UserSummary,
} from "@/lib/types";
import { orgDisplayName } from "@/lib/orgs";
import DraftStatus from "@/components/ui/DraftStatus";
import { useDraftAutosave } from "@/hooks/useDraftAutosave";

type PetitionTypeDraft = {
  name: string;
  description: string;
  orgId: string;
  sortOrder: number;
};

function NotificationRecipientPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const idsKey = value.join(",");
  const selectedIds = useMemo(() => (idsKey ? idsKey.split(",") : []), [idsKey]);

  useEffect(() => {
    void usersApi.listByIds(selectedIds).then(setUsers).catch(() => undefined);
  }, [idsKey, selectedIds]);

  return (
    <UserPicker
      value={users}
      onChange={(nextUsers) => {
        setUsers(nextUsers);
        onChange(nextUsers.map((user) => user.id));
      }}
    />
  );
}

export default function PetitionTypesAdminPage() {
  const [types, setTypes] = useState<PetitionTypeOut[]>([]);
  const [orgs, setOrgs] = useState<{ id: string; name: string; parent_id?: string | null }[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [orgId, setOrgId] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [notificationSettings, setNotificationSettings] =
    useState<PetitionNotificationSettingsOut | null>(null);
  const [notificationRules, setNotificationRules] = useState<PetitionNotificationRuleOut[]>([]);
  const [savingNotifications, setSavingNotifications] = useState(false);

  const restoreDraft = useCallback((draft: PetitionTypeDraft) => {
    setName(draft.name);
    setDescription(draft.description);
    setOrgId(draft.orgId);
    setSortOrder(draft.sortOrder);
    toast.info("已復原未送出的陳情類型草稿");
  }, []);

  const { clearDraft, flushDraft, lastSavedAt } = useDraftAutosave<PetitionTypeDraft>({
    key: "petitions:admin-types:new",
    value: { name, description, orgId, sortOrder },
    onRestore: restoreDraft,
    isEmpty: useCallback((draft: PetitionTypeDraft) => !draft.name.trim(), []),
  });

  const load = useCallback(async () => {
    const failedSections: string[] = [];
    const noteFailure = (label: string) => () => failedSections.push(label);
    const [typeItems, orgItems, nextNotificationSettings, nextNotificationRules] = await Promise.all([
      withFallback(petitionsApi.listAdminTypes(), [], noteFailure("陳情類型")),
      withFallback(orgsApi.list({ active_only: true }), [], noteFailure("組織")),
      withFallback(petitionsApi.getNotificationSettings(), null, noteFailure("陳情通知設定")),
      withFallback(petitionsApi.listNotificationRules(), [], noteFailure("陳情通知規則")),
    ]);
    setTypes(typeItems);
    setOrgs(orgItems);
    setNotificationSettings(nextNotificationSettings);
    setNotificationRules(nextNotificationRules);
    if (!orgId && orgItems[0]) setOrgId(orgItems[0].id);
    if (failedSections.length) {
      toast.warning(`${failedSections.join("、")}暫時無法載入，其餘資料仍可使用`);
    }
  }, [orgId]);

  useEffect(() => { load().catch(() => toast.error("載入失敗")); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await petitionsApi.createType({
        name,
        description: description || null,
        responsible_org_id: orgId,
        sort_order: sortOrder,
        is_active: true,
      });
      clearDraft();
      setName("");
      setDescription("");
      setSortOrder(0);
      await load();
      toast.success("已新增陳情類型");
    } catch (err) {
      flushDraft();
      toast.error(err instanceof ApiError ? err.message : "新增失敗");
    }
  };

  const update = async (id: string, body: Partial<{ name: string; description: string | null; responsible_org_id: string; is_active: boolean; sort_order: number }>) => {
    try {
      await petitionsApi.updateType(id, body);
      await load();
      toast.success("已更新");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "更新失敗");
    }
  };

  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name ?? id;

  const saveNotificationSettings = async () => {
    if (!notificationSettings) return;
    setSavingNotifications(true);
    try {
      const updated = await petitionsApi.updateNotificationSettings({
        enabled: notificationSettings.enabled,
        recipient_user_ids: notificationSettings.recipient_user_ids,
      });
      setNotificationSettings(updated);
      toast.success("陳情全域通知設定已儲存");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "通知設定儲存失敗");
    } finally {
      setSavingNotifications(false);
    }
  };

  const createNotificationRule = async (scope: { petition_type_id?: string; org_id?: string }) => {
    try {
      const rule = await petitionsApi.createNotificationRule({
        petition_type_id: scope.petition_type_id ?? null,
        org_id: scope.org_id ?? null,
        enabled: true,
        recipient_user_ids: [],
      });
      setNotificationRules((current) => [...current, rule]);
      toast.success("已建立通知覆寫規則");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "通知規則建立失敗");
    }
  };

  const saveNotificationRule = async (rule: PetitionNotificationRuleOut) => {
    try {
      const updated = await petitionsApi.updateNotificationRule(rule.id, {
        enabled: rule.enabled,
        recipient_user_ids: rule.recipient_user_ids,
        is_active: rule.is_active,
      });
      setNotificationRules((current) => current.map((item) => item.id === updated.id ? updated : item));
      toast.success("通知覆寫規則已儲存");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "通知規則儲存失敗");
    }
  };

  const deleteNotificationRule = async (rule: PetitionNotificationRuleOut) => {
    try {
      await petitionsApi.deleteNotificationRule(rule.id);
      setNotificationRules((current) => current.filter((item) => item.id !== rule.id));
      toast.success("已恢復沿用上層通知設定");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "通知規則刪除失敗");
    }
  };

  const changeNotificationRule = (
    ruleId: string,
    change: Partial<Pick<PetitionNotificationRuleOut, "enabled" | "recipient_user_ids">>,
  ) => {
    setNotificationRules((current) =>
      current.map((rule) => rule.id === ruleId ? { ...rule, ...change } : rule),
    );
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>陳情類型管理</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>設定前台可選類型與預設負責機關</p>
        <DraftStatus lastSavedAt={lastSavedAt} className="mt-2" />
      </div>

      <form onSubmit={create} className="card p-5 grid md:grid-cols-[1fr_1fr_120px_auto] gap-3 items-end">
        <label className="block">
          <span className="text-sm font-medium">類型名稱</span>
          <input className="input w-full mt-1" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block">
          <span className="text-sm font-medium">負責機關</span>
          <select className="input w-full mt-1" value={orgId} onChange={(e) => setOrgId(e.target.value)} required>
            {orgs.map((o) => <option key={o.id} value={o.id}>{orgDisplayName(o, orgs)}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium">排序</span>
          <input className="input w-full mt-1" type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
        </label>
        <button className="btn btn-primary">新增</button>
        <textarea className="input md:col-span-4 w-full" placeholder="描述（選填）" value={description} onChange={(e) => setDescription(e.target.value)} />
      </form>

      {notificationSettings && (
        <section className="card p-5 space-y-4">
          <div>
            <h2 className="font-semibold">負責人通知設定</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              新陳情與案件更新會通知負責人；類型覆寫優先於機關覆寫，再沒有覆寫才使用全域設定。
            </p>
          </div>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={notificationSettings.enabled}
              onChange={(event) =>
                setNotificationSettings({ ...notificationSettings, enabled: event.target.checked })
              }
            />
            啟用全域陳情負責人通知
          </label>
          <div>
            <p className="mb-1.5 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              指定全域收件人（留空則自動通知具陳情處理權限者）
            </p>
            <NotificationRecipientPicker
              value={notificationSettings.recipient_user_ids}
              onChange={(ids) =>
                setNotificationSettings({ ...notificationSettings, recipient_user_ids: ids })
              }
            />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className="btn btn-primary"
              disabled={savingNotifications}
              onClick={() => void saveNotificationSettings()}
            >
              {savingNotifications ? "儲存中…" : "儲存全域通知設定"}
            </button>
          </div>
        </section>
      )}

      <section className="card p-5 space-y-3">
        {types.map((type) => (
          <div key={type.id} className="rounded-lg p-4 space-y-3" style={{ border: "1px solid var(--border)" }}>
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <p className="font-medium">{type.name}</p>
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>{type.description || "無描述"} · {orgName(type.responsible_org_id)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-ghost" onClick={() => update(type.id, { is_active: !type.is_active })}>
                  {type.is_active ? "停用" : "啟用"}
                </button>
                <select className="input" value={type.responsible_org_id} onChange={(e) => update(type.id, { responsible_org_id: e.target.value })}>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{orgDisplayName(o, orgs)}</option>)}
                </select>
              </div>
            </div>
            <div className="grid sm:grid-cols-[1fr_120px_auto] gap-2">
              <input className="input" defaultValue={type.name} onBlur={(e) => e.target.value !== type.name && update(type.id, { name: e.target.value })} />
              <input className="input" type="number" defaultValue={type.sort_order} min={0} onBlur={(e) => Number(e.target.value) !== type.sort_order && update(type.id, { sort_order: Number(e.target.value) })} />
              <span className="text-sm self-center" style={{ color: type.is_active ? "var(--success)" : "var(--text-muted)" }}>{type.is_active ? "啟用中" : "已停用"}</span>
            </div>
            {(() => {
              const rule = notificationRules.find((item) => item.petition_type_id === type.id);
              return rule ? (
                <div className="rounded-lg border p-3 space-y-3" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">此類型通知覆寫</p>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(event) => changeNotificationRule(rule.id, { enabled: event.target.checked })}
                      />
                      啟用
                    </label>
                  </div>
                  <NotificationRecipientPicker
                    value={rule.recipient_user_ids}
                    onChange={(ids) => changeNotificationRule(rule.id, { recipient_user_ids: ids })}
                  />
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn btn-ghost text-xs" onClick={() => void deleteNotificationRule(rule)}>恢復全域設定</button>
                    <button type="button" className="btn btn-primary text-xs" onClick={() => void saveNotificationRule(rule)}>儲存類型設定</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn btn-ghost text-xs" onClick={() => void createNotificationRule({ petition_type_id: type.id })}>
                  設定此類型通知覆寫
                </button>
              );
            })()}
          </div>
        ))}
      </section>

      <section className="card p-5 space-y-3">
        <div>
          <h2 className="font-semibold">負責機關通知覆寫</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            機關規則會套用到該機關承辦的所有陳情；同時有類型規則時，以類型規則為準。
          </p>
        </div>
        {orgs.map((org) => {
          const rule = notificationRules.find((item) => item.org_id === org.id);
          return (
            <div key={org.id} className="rounded-lg border p-4 space-y-3" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{orgDisplayName(org, orgs)}</p>
                {!rule && (
                  <button type="button" className="btn btn-ghost text-xs" onClick={() => void createNotificationRule({ org_id: org.id })}>
                    新增機關覆寫
                  </button>
                )}
              </div>
              {rule && (
                <>
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={rule.enabled} onChange={(event) => changeNotificationRule(rule.id, { enabled: event.target.checked })} />
                    啟用此機關通知
                  </label>
                  <NotificationRecipientPicker
                    value={rule.recipient_user_ids}
                    onChange={(ids) => changeNotificationRule(rule.id, { recipient_user_ids: ids })}
                  />
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn btn-ghost text-xs" onClick={() => void deleteNotificationRule(rule)}>恢復全域設定</button>
                    <button type="button" className="btn btn-primary text-xs" onClick={() => void saveNotificationRule(rule)}>儲存機關設定</button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
