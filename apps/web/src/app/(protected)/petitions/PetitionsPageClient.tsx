"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import { usersApi } from "@/lib/api";
import { ApiError } from "@/lib/api-helpers";
import { petitionsApi } from "@/lib/api/petitions";
import type { PetitionCaseListItem, PetitionPublicListItem, PetitionStatsOut } from "@/lib/types";
import { PetitionStatusBadge } from "@/components/ui/StatusBadge";
import { usePermissions } from "@/hooks/usePermissions";

const EMPTY_PUBLIC_CASES: PetitionPublicListItem[] = [];

function fmt(iso: string) {
  return new Date(iso).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function PetitionsPageClient({
  initialPublicCases = EMPTY_PUBLIC_CASES,
}: {
  initialPublicCases?: PetitionPublicListItem[];
}) {
  const [myCases, setMyCases] = useState<PetitionCaseListItem[]>([]);
  const [myCasesLoading, setMyCasesLoading] = useState(true);
  const [myCasesError, setMyCasesError] = useState<string | null>(null);
  const [authState, setAuthState] = useState<"checking" | "authenticated" | "unauthenticated">("checking");
  const [stats, setStats] = useState<PetitionStatsOut | null>(null);
  const [publicCases, setPublicCases] = useState(initialPublicCases);
  const [publicCasesLoading, setPublicCasesLoading] = useState(initialPublicCases.length === 0);
  const { can } = usePermissions();

  useEffect(() => {
    if (initialPublicCases.length > 0) return;
    let cancelled = false;
    petitionsApi.publicList({ limit: 6 })
      .then((cases) => {
        if (!cancelled) setPublicCases(cases);
      })
      .catch(() => null)
      .finally(() => {
        if (!cancelled) setPublicCasesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialPublicCases]);

  useEffect(() => {
    let cancelled = false;
    void usersApi.me()
      .then(() => {
        if (!cancelled) setAuthState("authenticated");
      })
      .catch(() => {
        if (!cancelled) setAuthState("unauthenticated");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authState === "checking") return;
    if (authState === "unauthenticated") {
      setMyCasesLoading(false);
      return;
    }
    let cancelled = false;
    setMyCasesLoading(true);
    petitionsApi.my({ limit: 200 })
      .then((cases) => {
        if (!cancelled) setMyCases(cases);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMyCasesError(error instanceof ApiError ? error.message : "無法載入本人案件，請稍後重試");
        }
      })
      .finally(() => {
        if (!cancelled) setMyCasesLoading(false);
      });
    if (can("petition:view_org") || can("petition:handle") || can("petition:assign") || can("petition:analytics_org")) {
      petitionsApi.stats().then(setStats).catch(() => null);
    }
    return () => {
      cancelled = true;
    };
  }, [authState, can]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="workspace-header flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>陳情中心</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            提出校園問題、建議或申訴，並追蹤案件辦理進度。
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Link href="/petitions/new" className="btn btn-primary min-h-11 w-full gap-2 px-4 sm:w-auto">
            <FilePlus2 size={16} aria-hidden />
            提出陳情
          </Link>
          <Link href="/petitions/public" className="btn btn-ghost min-h-11 w-full px-4 sm:w-auto">
            公開陳情
          </Link>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {[
            ["待分案", stats.pending_assignment],
            ["我承辦", stats.my_assigned],
            ["補件中", stats.needs_info],
            ["處理中", stats.in_progress],
            ["已回覆", stats.resolved],
            ["本月結案", stats.closed_this_month],
          ].map(([label, value]) => (
            <Link key={label} href="/petitions/manage" className="card card-hover p-4" style={{ textDecoration: "none" }}>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</p>
              <p className="text-2xl font-semibold mt-1" style={{ color: "var(--text-primary)" }}>{value}</p>
            </Link>
          ))}
        </div>
      )}

      {authState === "checking" ? (
        <section className="card p-5 text-sm" style={{ color: "var(--text-muted)" }} role="status" aria-live="polite">
          正在確認登入狀態…
        </section>
      ) : authState === "unauthenticated" ? (
        <section className="card p-5 space-y-3" aria-labelledby="petition-login-heading">
          <h2 id="petition-login-heading" className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            登入後查看本人案件
          </h2>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            登入後即可查看並追蹤你送出的陳情。
          </p>
          <Link href="/login?next=%2Fpetitions" className="btn btn-primary w-fit">
            登入後查看案件
          </Link>
        </section>
      ) : (
        <section className="card p-5 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>我的案件</h2>
              <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>查看並追蹤本人送出的陳情</p>
            </div>
          </div>
          {myCasesError ? (
            <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">{myCasesError}</p>
          ) : myCasesLoading ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }} role="status" aria-live="polite">案件載入中…</p>
          ) : myCases.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>尚無案件。</p>
          ) : (
            <div className="space-y-2">
              {myCases.map((item) => (
                <Link key={item.id} href={`/petitions/${item.id}`} className="block rounded-lg p-3" style={{ border: "1px solid var(--border)", textDecoration: "none" }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{item.title}</p>
                        {item.is_confidential && (
                          <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: "var(--warning-dim)", color: "var(--warning)" }}>
                            密件處理
                          </span>
                        )}
                      </div>
                      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>#{item.case_number} · {fmt(item.updated_at)} · {item.next_action}</p>
                    </div>
                    <PetitionStatusBadge status={item.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>公開陳情</h2>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              經陳情人同意公開的案件，分享校園中正在被處理的問題與回覆。
            </p>
          </div>
          <Link href="/petitions/public" className="btn btn-ghost shrink-0">查看全部</Link>
        </div>
        {publicCasesLoading ? (
          <div className="card p-5 text-sm" style={{ color: "var(--text-muted)" }} role="status" aria-live="polite">
            公開陳情載入中…
          </div>
        ) : publicCases.length === 0 ? (
          <div className="card p-5 text-sm" style={{ color: "var(--text-muted)" }}>
            目前尚無已公開陳情。
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {publicCases.map((item) => (
              <Link
                key={item.id}
                href={`/petitions/public/${item.id}`}
                className="card card-hover p-4 space-y-2"
                style={{ textDecoration: "none" }}
              >
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  #{item.case_number} · {item.current_org_name} · {item.type_name}
                </p>
                <h3 className="font-medium line-clamp-2" style={{ color: "var(--text-primary)" }}>
                  {item.title}
                </h3>
                <p className="text-sm line-clamp-3" style={{ color: "var(--text-muted)" }}>
                  {item.reply || "已結案，暫無公開回覆。"}
                </p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  公開於 {fmt(item.published_at)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
