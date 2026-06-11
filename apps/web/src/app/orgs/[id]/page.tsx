"use client";
import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { orgsApi, adminApi, withFallback, apiErrorMessage } from "@/lib/api";
import { apiUrl } from "@/lib/config";
import type { OrgRead } from "@/lib/api";
import type { OrgWithPositions, AdminUserDetail } from "@/lib/types";
import GovernanceLinkPanel from "@/components/governance/GovernanceLinkPanel";

interface PositionBasic {
  id: string;
  name: string;
  permission_codes: string[];
}

export default function OrgDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [org, setOrg] = useState<OrgRead | null>(null);
  const [allOrgs, setAllOrgs] = useState<OrgRead[]>([]);
  const [positions, setPositions] = useState<PositionBasic[]>([]);
  const [users, setUsers] = useState<AdminUserDetail[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const superuser = typeof window !== "undefined" && localStorage.getItem("is_superuser") === "true";
    setIsAdmin(superuser);

    Promise.all([
      orgsApi.get(id),
      withFallback(orgsApi.list(), []),
    ]).then(([o, all]) => {
      setOrg(o);
      setAllOrgs(all);
    }).catch(e => toast.error(apiErrorMessage(e, "載入組織資訊失敗")))
      .finally(() => setLoading(false));

    // 嘗試載入職位（帶 permission codes）
    adminApi.listOrgsWithPositions()
      .then((orgsWithPos: OrgWithPositions[]) => {
        const found = orgsWithPos.find(o => o.id === id);
        if (found) setPositions(found.positions);
      })
      .catch(() => {
        // 非管理員：fallback 到 GET /orgs/{id}/positions（無 permission_codes）
        fetch(apiUrl(`/orgs/${id}/positions`), {
          credentials: "include",
        })
          .then(r => r.json())
          .then((ps: { id: string; name: string }[]) =>
            setPositions(ps.map(p => ({ id: p.id, name: p.name, permission_codes: [] })))
          )
          .catch(() => {});
      });

    // 嘗試載入成員（需 admin）
    adminApi.listUsers()
      .then(setUsers)
      .catch(() => setUsers([]));

  }, [id]);

  const parent = useMemo(() => allOrgs.find(o => o.id === org?.parent_id), [allOrgs, org]);
  const children = useMemo(() => allOrgs.filter(o => o.parent_id === id), [allOrgs, id]);

  // 各職位的成員
  const membersByPos = useMemo(() => {
    const m: Record<string, AdminUserDetail[]> = {};
    positions.forEach(p => {
      m[p.id] = users.filter(u => u.positions.some(up => up.id === p.id));
    });
    return m;
  }, [positions, users]);

  // 整個組織的所有成員（去重）
  const orgMembers = useMemo(() => {
    const seen = new Set<string>();
    const result: AdminUserDetail[] = [];
    positions.forEach(p => {
      (membersByPos[p.id] ?? []).forEach(u => {
        if (!seen.has(u.id)) { seen.add(u.id); result.push(u); }
      });
    });
    return result;
  }, [positions, membersByPos]);

  if (loading || !org) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 size={32} className="animate-spin" style={{ color: "var(--primary)" }} aria-label="載入中" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* 頁首 */}
      <div className="flex items-start gap-3">
        <Link href="/orgs" className="topbar-icon-btn mt-0.5" aria-label="返回組織列表">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {parent && (
              <>
                <Link href={`/orgs/${parent.id}`} className="text-sm hover:underline"
                  style={{ color: "var(--text-muted)" }}>
                  {parent.name}
                </Link>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.5" style={{ color: "var(--text-disabled)" }}>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </>
            )}
            <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>{org.name}</h1>
          </div>
          {org.description && (
            <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>{org.description}</p>
          )}
          <p className="text-xs mt-1" style={{ color: "var(--text-disabled)" }}>
            {positions.length} 個職位 · {orgMembers.length} 位成員
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <GovernanceLinkPanel
            entityType="org"
            entityId={org.id}
            title={org.name}
            href={`/orgs/${org.id}`}
            compact
          />
          {isAdmin && (
            <Link href="/admin/permissions"
              className="text-xs px-3 py-1.5 rounded-lg flex-shrink-0 transition-colors"
              style={{ color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
              管理權限
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 左欄：職位 + 成員 */}
        <div className="lg:col-span-2 space-y-4">

          {/* 職位列表 */}
          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between px-4 py-3"
              style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                職位列表
                <span className="ml-2 text-xs font-normal" style={{ color: "var(--text-muted)" }}>
                  ({positions.length})
                </span>
              </h2>
            </div>
            {positions.length === 0 ? (
              <div className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                此組織尚無職位
              </div>
            ) : (
              <ul>
                {positions.map((pos, idx) => {
                  const members = membersByPos[pos.id] ?? [];
                  return (
                    <li key={pos.id}
                      className="px-4 py-3 space-y-2"
                      style={idx < positions.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ background: "var(--primary)" }} />
                        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                          {pos.name}
                        </span>
                        <span className="text-xs px-1.5 py-0.5 rounded ml-auto"
                          style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                          {members.length} 人
                        </span>
                      </div>
                      {/* 權限碼 */}
                      {pos.permission_codes.length > 0 && (
                        <div className="flex flex-wrap gap-1 ml-3.5">
                          {pos.permission_codes.map(code => (
                            <span key={code}
                              className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                              style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--primary-dim)" }}>
                              {code}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* 成員 */}
                      {members.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 ml-3.5">
                          {members.map(u => (
                            <span key={u.id}
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg"
                              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                              <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                                style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
                                {u.display_name.charAt(0)}
                              </span>
                              {u.display_name}
                              {u.student_id && (
                                <span style={{ color: "var(--text-disabled)" }}>#{u.student_id}</span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* 所有成員（去重） */}
          {orgMembers.length > 0 && (
            <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
              <div className="px-4 py-3" style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  成員名單
                  <span className="ml-2 text-xs font-normal" style={{ color: "var(--text-muted)" }}>
                    ({orgMembers.length} 人)
                  </span>
                </h2>
              </div>
              <ul>
                {orgMembers.map((u, idx) => {
                  const myPositions = u.positions.filter(p => positions.some(pos => pos.id === p.id));
                  return (
                    <li key={u.id}
                      className="flex items-center gap-3 px-4 py-3"
                      style={idx < orgMembers.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                      <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
                        style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
                        {u.display_name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                            {u.display_name}
                          </span>
                          {!u.is_active && (
                            <span className="text-[10px] px-1 py-0.5 rounded"
                              style={{ color: "#f87171", background: "rgba(248,113,113,0.1)" }}>停用</span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {myPositions.map(p => (
                            <span key={p.id} className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                              {p.name}
                            </span>
                          ))}
                        </div>
                      </div>
                      {u.student_id && (
                        <span className="text-xs flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                          #{u.student_id}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* 右欄：組織資訊 */}
        <div className="space-y-4">
          {/* 上下層組織 */}
          <div className="rounded-2xl p-4 space-y-3" style={{ border: "1px solid var(--border)" }}>
            <h2 className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: "var(--text-muted)" }}>組織架構</h2>

            {parent ? (
              <div>
                <p className="text-[10px] mb-1" style={{ color: "var(--text-disabled)" }}>上層組織</p>
                <Link href={`/orgs/${parent.id}`}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl transition-colors hover:bg-white/5"
                  style={{ border: "1px solid var(--border)", textDecoration: "none" }}>
                  <div className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                    style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
                    {parent.name.charAt(0)}
                  </div>
                  <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{parent.name}</span>
                </Link>
              </div>
            ) : (
              <p className="text-xs" style={{ color: "var(--text-disabled)" }}>頂層組織</p>
            )}

            {children.length > 0 && (
              <div>
                <p className="text-[10px] mb-1.5" style={{ color: "var(--text-disabled)" }}>
                  下層組織（{children.length}）
                </p>
                <div className="space-y-1">
                  {children.map(c => (
                    <Link key={c.id} href={`/orgs/${c.id}`}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-xl transition-colors hover:bg-white/5"
                      style={{ border: "1px solid var(--border)", textDecoration: "none" }}>
                      <div className="w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                        style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                        {c.name.charAt(0)}
                      </div>
                      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{c.name}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 統計 */}
          <div className="rounded-2xl p-4 space-y-3" style={{ border: "1px solid var(--border)" }}>
            <h2 className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: "var(--text-muted)" }}>統計</h2>
            {[
              { label: "職位數", value: positions.length },
              { label: "成員人數", value: orgMembers.length },
              { label: "下層組織", value: children.length },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</span>
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
