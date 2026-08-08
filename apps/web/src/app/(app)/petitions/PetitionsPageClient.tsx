"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ApiError } from "@/lib/api-helpers";
import { petitionsApi } from "@/lib/api/petitions";
import type { PetitionCaseListItem, PetitionCaseOut, PetitionPublicListItem, PetitionStatsOut } from "@/lib/types";
import { PetitionStatusBadge } from "@/components/ui/StatusBadge";
import { usePermissions } from "@/hooks/usePermissions";

const PetitionPublicConsent = dynamic(() => import("@/components/petitions/PetitionPublicConsent"), { ssr: false });
const PetitionContentEditor = dynamic(() => import("@/components/petitions/PetitionContentEditor"), { ssr: false });
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
  const [stats, setStats] = useState<PetitionStatsOut | null>(null);
  const [caseNumber, setCaseNumber] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [lookup, setLookup] = useState<PetitionCaseOut | null>(null);
  const [loadingLookup, setLoadingLookup] = useState(false);
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
    if (!localStorage.getItem("user_id")) return;
    petitionsApi.my().then(setMyCases).catch(() => null);
    if (can("petition:view_org") || can("petition:handle") || can("petition:assign") || can("petition:analytics_org")) {
      petitionsApi.stats().then(setStats).catch(() => null);
    }
  }, [can]);

  const doLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoadingLookup(true);
    try {
      setLookup(await petitionsApi.lookup(caseNumber, verificationCode));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "查詢失敗");
      setLookup(null);
    } finally {
      setLoadingLookup(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="workspace-header flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>陳情</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            提出陳情或查詢案件進度。
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/petitions/public" className="btn btn-ghost">公開陳情</Link>
          <Link href="/petitions/new" className="btn btn-primary">我要陳情</Link>
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

      <div className="grid lg:grid-cols-[1fr_1.2fr] gap-5">
        <section className="card p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>案號查詢</h2>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              訪客或未登入狀態可使用七碼案號與五碼驗證碼查看進度
            </p>
          </div>
          <form onSubmit={doLookup} className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="petition-case-number" className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                案號
              </label>
              <input
                id="petition-case-number"
                name="case_number"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                spellCheck={false}
                className="input w-full"
                placeholder="七碼案號，例如 1150001…"
                value={caseNumber}
                maxLength={7}
                onChange={(e) => setCaseNumber(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="petition-verification-code" className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                驗證碼
              </label>
              <input
                id="petition-verification-code"
                name="verification_code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                spellCheck={false}
                className="input w-full"
                placeholder="五碼驗證碼，例如 12345…"
                value={verificationCode}
                maxLength={5}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <button type="submit" className="btn btn-primary w-full" disabled={loadingLookup || caseNumber.length !== 7 || verificationCode.length !== 5}>
              {loadingLookup ? "查詢中…" : "查詢案件"}
            </button>
          </form>
          {lookup && (
            <>
              <div className="rounded-lg p-4 space-y-2" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium" style={{ color: "var(--text-primary)" }}>{lookup.title}</p>
                  <PetitionStatusBadge status={lookup.status} />
                </div>
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>{lookup.status_public_message}</p>
                <Link href={`/petitions/${caseNumber}/${verificationCode}`} className="btn btn-ghost mt-2">查看進度分享頁</Link>
              </div>
              {lookup.can_respond_public && <PetitionPublicConsent item={lookup} verificationCode={verificationCode} onUpdated={setLookup} />}
              {lookup.can_edit_content && (
                <PetitionContentEditor item={lookup} verificationCode={verificationCode} onUpdated={setLookup} />
              )}
            </>
          )}
        </section>

        <section className="card p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>我的案件</h2>
              <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>登入後可直接追蹤自己送出的陳情</p>
            </div>
            <Link href="/petitions/new" className="btn btn-ghost">新增</Link>
          </div>
          {myCases.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>尚無案件，或目前未登入。</p>
          ) : (
            <div className="space-y-2">
              {myCases.slice(0, 8).map((item) => (
                <Link key={item.id} href={`/petitions/${item.id}`} className="block rounded-lg p-3" style={{ border: "1px solid var(--border)", textDecoration: "none" }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{item.title}</p>
                      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>#{item.case_number} · {fmt(item.updated_at)} · {item.next_action}</p>
                    </div>
                    <PetitionStatusBadge status={item.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

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
