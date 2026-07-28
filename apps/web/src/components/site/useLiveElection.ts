"use client";

import { useEffect, useState } from "react";

import { useModuleStatus } from "@/contexts/ModuleStatusContext";
import { useResilientPoll } from "@/hooks/useResilientPoll";
import { electionsApi } from "@/lib/api";
import { apiUrl } from "@/lib/config";
import type { CandidateTally, ElectionLiveSummary, ElectionStatus } from "@/lib/types";

interface PublicElectionItem {
  id: string;
  title: string;
  status: ElectionStatus;
  updated_at: string;
}

export interface ActiveLiveElection {
  id: string;
  title: string;
  status: ElectionStatus;
  /** 即時摘要；首次載入或暫時取不到時為 null（仍會顯示標題與狀態）。 */
  summary: ElectionLiveSummary | null;
}

async function fetchPublicElections(): Promise<PublicElectionItem[]> {
  const res = await fetch(apiUrl("/elections/public"), { credentials: "include" });
  if (!res.ok) return [];
  return (await res.json()) as PublicElectionItem[];
}

/**
 * 公開站「正在發生」的單一資料來源：找出進行中（live 優先，其次 paused）的選舉，
 * 並抓取即時摘要，供站台級 banner 與首頁卡片共用，避免兩處各抓一份。
 * 用 useResilientPoll 週期更新，分頁隱藏 / 離線時自動暫停。
 */
export function useLiveElection(pollMs = 25_000, enabled = true): ActiveLiveElection | null {
  const [active, setActive] = useState<ActiveLiveElection | null>(null);
  const { moduleInfo } = useModuleStatus();
  const electionModule = moduleInfo("elections");
  // 模組狀態尚未完成初次讀取，或選舉模組正在維護／關閉時，不發公開選舉請求。
  // 這也避免後端的保護性 503 被當成正常結果而持續輪詢。
  const pollingEnabled = electionModule !== null && !electionModule.on;

  useEffect(() => {
    if (!enabled || !pollingEnabled) setActive(null);
  }, [enabled, pollingEnabled]);

  useResilientPoll(
    async () => {
      const elections = await fetchPublicElections();
      const current =
        elections.find((item) => item.status === "live") ??
        elections.find((item) => item.status === "paused") ??
        null;
      if (!current) {
        setActive(null);
        return "ok";
      }
      let summary: ElectionLiveSummary | null = null;
      try {
        summary = await electionsApi.live(current.id);
      } catch {
        summary = null;
      }
      setActive({
        id: current.id,
        title: current.title,
        status: current.status,
        summary,
      });
      return "ok";
    },
    { enabled: enabled && pollingEnabled, intervalMs: pollMs },
  );

  return active;
}

/** 取目前領先的候選組合：優先用後端標記的 leader，否則退而取得票最高者。 */
export function liveLeader(summary: ElectionLiveSummary | null): CandidateTally | null {
  if (!summary || summary.candidates.length === 0) return null;
  if (summary.leader_candidate_id) {
    const flagged = summary.candidates.find(
      (candidate) => candidate.candidate_id === summary.leader_candidate_id,
    );
    if (flagged) return flagged;
  }
  return [...summary.candidates].sort((a, b) => b.votes - a.votes)[0] ?? null;
}
