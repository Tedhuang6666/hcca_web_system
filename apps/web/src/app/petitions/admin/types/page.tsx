"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError, orgsApi, petitionsApi } from "@/lib/api";
import type { PetitionTypeOut } from "@/lib/types";

export default function PetitionTypesAdminPage() {
  const [types, setTypes] = useState<PetitionTypeOut[]>([]);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [orgId, setOrgId] = useState("");
  const [sortOrder, setSortOrder] = useState(0);

  const load = useCallback(async () => {
    const [typeItems, orgItems] = await Promise.all([petitionsApi.listAdminTypes(), orgsApi.list()]);
    setTypes(typeItems);
    setOrgs(orgItems);
    if (!orgId && orgItems[0]) setOrgId(orgItems[0].id);
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
      setName("");
      setDescription("");
      setSortOrder(0);
      await load();
      toast.success("已新增陳情類型");
    } catch (err) {
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

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>陳情類型管理</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>設定前台可選類型與預設負責機關</p>
      </div>

      <form onSubmit={create} className="card p-5 grid md:grid-cols-[1fr_1fr_120px_auto] gap-3 items-end">
        <label className="block">
          <span className="text-sm font-medium">類型名稱</span>
          <input className="input w-full mt-1" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block">
          <span className="text-sm font-medium">負責機關</span>
          <select className="input w-full mt-1" value={orgId} onChange={(e) => setOrgId(e.target.value)} required>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium">排序</span>
          <input className="input w-full mt-1" type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
        </label>
        <button className="btn btn-primary">新增</button>
        <textarea className="input md:col-span-4 w-full" placeholder="描述（選填）" value={description} onChange={(e) => setDescription(e.target.value)} />
      </form>

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
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid sm:grid-cols-[1fr_120px_auto] gap-2">
              <input className="input" defaultValue={type.name} onBlur={(e) => e.target.value !== type.name && update(type.id, { name: e.target.value })} />
              <input className="input" type="number" defaultValue={type.sort_order} min={0} onBlur={(e) => Number(e.target.value) !== type.sort_order && update(type.id, { sort_order: Number(e.target.value) })} />
              <span className="text-sm self-center" style={{ color: type.is_active ? "var(--success)" : "var(--text-muted)" }}>{type.is_active ? "啟用中" : "已停用"}</span>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
